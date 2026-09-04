package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	orionauth "github.com/mouizahmed/justscribe-backend/internal/auth"
	"github.com/mouizahmed/justscribe-backend/internal/entitlements"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/recordingaudio"
	"github.com/mouizahmed/justscribe-backend/internal/recordingfinalizer"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

type TranscriptionHandler struct {
	principalService *orionauth.PrincipalService
	usageRepository  *repository.AccountUsageRepository
	vocabularyRepo   *repository.AccountVocabularyRepository
	recordingRepo    *repository.RecordingSessionRepository
	transcriptRepo   *repository.TranscriptRepository
	finalizer        *recordingfinalizer.Finalizer
	audioSpool       *recordingaudio.Store
	hub              *WsHub
	replayRegistry   *transcriptionReplayRegistry
}

func NewTranscriptionHandler(
	principalService *orionauth.PrincipalService,
	usageRepository *repository.AccountUsageRepository,
	vocabularyRepo *repository.AccountVocabularyRepository,
	recordingRepo *repository.RecordingSessionRepository,
	transcriptRepo *repository.TranscriptRepository,
	finalizer *recordingfinalizer.Finalizer,
	audioSpool *recordingaudio.Store,
	hub *WsHub,
) *TranscriptionHandler {
	return &TranscriptionHandler{
		principalService: principalService,
		usageRepository:  usageRepository,
		vocabularyRepo:   vocabularyRepo,
		recordingRepo:    recordingRepo,
		transcriptRepo:   transcriptRepo,
		finalizer:        finalizer,
		audioSpool:       audioSpool,
		hub:              hub,
		replayRegistry:   newTranscriptionReplayRegistry(),
	}
}

var transcriptionUpgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin:     checkWebSocketOrigin,
}

const maxWSMessageBytes = 1 << 20 // 1 MiB safety limit
const wsReadTimeout = 70 * time.Second
const wsPingInterval = 25 * time.Second
const wsWriteTimeout = 10 * time.Second
const wsMaximumLifetime = 50 * time.Minute
const wsRevalidationInterval = time.Minute
const wsRecordingHeartbeatInterval = 25 * time.Second
const wsRecordingOperationTimeout = 5 * time.Second
const transcriptionSampleRate = int64(48000)

type transcriptionAudioAck struct {
	Type     string `json:"type"`
	Source   string `json:"source"`
	Sequence string `json:"sequence"`
}

type transcriptionFinalizeAck struct {
	Type               string `json:"type"`
	RecordingSessionID string `json:"recording_session_id"`
	Status             string `json:"status"`
	AudioStored        string `json:"audio_stored"`
}

type transcriptionFinalizeOptions struct {
	Type        string `json:"type"`
	AudioStored string `json:"audio_stored"`
}

var errTranscriptionFinalized = errors.New("transcription finalized")
var errTranscriptionProviderUnavailable = errors.New("transcription provider unavailable")

func writeTranscriptionAdmissionError(conn *websocket.Conn, err error) {
	data := wsAuthErrorData(err)
	_ = conn.WriteJSON(gin.H{"type": "error", "code": data["code"], "message": data["message"]})
	closeCode, closeReason := wsCloseForError(err)
	_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(closeCode, closeReason))
}

// Stream authenticates the client and proxies two-channel audio/results through AssemblyAI.
func (h *TranscriptionHandler) Stream(c *gin.Context) {
	clientConn, err := transcriptionUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer clientConn.Close()
	clientConn.SetReadLimit(maxWSMessageBytes)

	principal, token, authMessage, err := authenticateWSConnWithMessage(clientConn, h.principalService)
	if err != nil {
		authError := wsAuthErrorData(err)
		_ = clientConn.WriteJSON(gin.H{"type": "error", "code": authError["code"], "message": authError["message"]})
		closeCode, closeReason := wsCloseForError(err)
		_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(closeCode, closeReason))
		return
	}
	recordingSessionID := strings.TrimSpace(authMessage.RecordingSessionID)
	recordingSession, err := h.admitRecordingSession(recordingSessionID, principal.UserID())
	if err != nil {
		sessionError := wsAuthErrorData(err)
		_ = clientConn.WriteJSON(gin.H{"type": "error", "code": sessionError["code"], "message": sessionError["message"]})
		closeCode, closeReason := wsCloseForError(err)
		_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(closeCode, closeReason))
		return
	}
	if h.transcriptRepo == nil {
		_ = clientConn.WriteJSON(gin.H{"type": "error", "code": "transcript_persistence_unavailable", "message": "Transcript persistence is unavailable."})
		return
	}
	audioStorage := recordingaudio.ModeNone
	audioStorageSpecified := strings.TrimSpace(authMessage.AudioStorage) != ""
	if audioStorageSpecified {
		audioStorage, err = recordingaudio.ParseMode(authMessage.AudioStorage)
		if err != nil {
			writeTranscriptionAdmissionError(clientConn, newWSAuthError("recording_storage_invalid", "Audio storage mode is invalid.", err))
			return
		}
	}
	if audioStorage == recordingaudio.ModeServer {
		if h.audioSpool == nil {
			writeTranscriptionAdmissionError(clientConn, newWSAuthError("recording_storage_unavailable", "Recording storage is unavailable.", nil))
			return
		}
		if err := h.audioSpool.Open(recordingSession.UserID, recordingSession.ID); err != nil {
			writeTranscriptionAdmissionError(clientConn, newWSAuthError("recording_storage_unavailable", "Recording storage is unavailable.", err))
			return
		}
	}
	sequenceContext, cancelSequenceContext := context.WithTimeout(context.Background(), wsRecordingOperationTimeout)
	sequenceStarts, err := h.transcriptRepo.GetNextSegmentIndexes(
		sequenceContext,
		recordingSession.ID,
		recordingSession.UserID,
	)
	cancelSequenceContext()
	if err != nil {
		_ = clientConn.WriteJSON(gin.H{"type": "error", "code": "transcript_persistence_unavailable", "message": "Transcript persistence is unavailable."})
		return
	}
	meterLimit, meterErr := entitlements.ResolveMeterLimit(
		principal.User.Plan,
		entitlements.MeterTranscriptionSeconds,
	)
	transcriptAvailable := true
	transcriptUnavailableCode := ""
	transcriptUnavailableMessage := ""
	key := strings.TrimSpace(os.Getenv("ASSEMBLYAI_API_KEY"))
	if key == "" {
		transcriptAvailable = false
		transcriptUnavailableCode = "transcription_provider_unavailable"
		transcriptUnavailableMessage = "Live transcription is unavailable."
	} else if meterErr != nil || h.usageRepository == nil {
		transcriptAvailable = false
		transcriptUnavailableCode = "usage_service_unavailable"
		transcriptUnavailableMessage = "Usage authorization is unavailable."
	}
	terms := []string{}
	if transcriptAvailable && h.vocabularyRepo != nil {
		vocabulary, vocabularyErr := h.vocabularyRepo.Get(c.Request.Context(), principal.UserID())
		if vocabularyErr != nil {
			log.Printf("transcription: vocabulary unavailable; continuing without keyterms")
		} else {
			terms = vocabulary.Terms
		}
	}
	assemblyConns := []*websocket.Conn{}
	if transcriptAvailable {
		assemblyConns, err = dialAssemblyAIChannels(key, terms, 2)
		if err != nil {
			log.Printf("transcription: provider unavailable; retaining audio without live transcript")
			transcriptAvailable = false
			transcriptUnavailableCode = "transcription_provider_unavailable"
			transcriptUnavailableMessage = "Live transcription is unavailable."
		}
	}
	defer func() {
		for _, conn := range assemblyConns {
			_ = conn.WriteJSON(gin.H{"type": "Terminate"})
			_ = conn.Close()
		}
	}()
	var clientWriteMu sync.Mutex
	var entitlementMu sync.RWMutex
	if err := writeWSJSON(clientConn, &clientWriteMu, gin.H{
		"type":                           "auth_ok",
		"transcript_available":           transcriptAvailable,
		"transcript_unavailable_code":    transcriptUnavailableCode,
		"transcript_unavailable_message": transcriptUnavailableMessage,
	}); err != nil {
		return
	}
	h.hub.Register(principal.UserID(), clientConn, &clientWriteMu)
	defer h.hub.Unregister(principal.UserID(), clientConn)

	clientConn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	clientConn.SetPongHandler(func(_ string) error {
		return clientConn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	})
	for _, conn := range assemblyConns {
		conn.SetReadLimit(maxWSMessageBytes)
		conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
		conn.SetPongHandler(func(_ string) error {
			return conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
		})
	}

	assemblyWriteMu := make([]sync.Mutex, len(assemblyConns))
	channelStates := make([]assemblyChannelState, len(assemblyConns))
	for i := range channelStates {
		channelStates[i].Turns = map[int]assemblyTurnState{}
		channelStates[i].FinalizedTurns = map[int]struct{}{}
		channelStates[i].SequenceOffset = sequenceStarts[i]
	}
	usageOperationKey := uuid.NewString()
	var usagePeriod entitlements.UsagePeriod
	var receivedFramesBySource [2]int64
	var authorizedSeconds int64
	var finalizeAudioStored atomic.Int32
	var finalizeOptionsSet atomic.Bool
	var finalizationRequested atomic.Bool
	finalizationStarted := make(chan struct{})
	providerUnavailable := make(chan struct{})
	var providerUnavailableOnce sync.Once
	var providerEnabled atomic.Bool
	providerEnabled.Store(transcriptAvailable)
	if !transcriptAvailable {
		providerUnavailableOnce.Do(func() { close(providerUnavailable) })
	}
	disableProvider := func(code, message string) {
		providerUnavailableOnce.Do(func() {
			providerEnabled.Store(false)
			close(providerUnavailable)
			for _, conn := range assemblyConns {
				_ = conn.Close()
			}
			_ = writeWSJSON(clientConn, &clientWriteMu, gin.H{
				"type":    "transcript_unavailable",
				"code":    code,
				"message": message,
			})
		})
	}
	authorizeAudio := func(source transcriptionAudioSource, frameCount int64) error {
		entitlementMu.RLock()
		currentLimit := meterLimit
		entitlementMu.RUnlock()

		currentPeriod, periodErr := entitlements.PeriodFor(currentLimit, time.Now())
		if periodErr != nil {
			return newWSAuthError(
				"usage_service_unavailable",
				"Usage authorization is unavailable.",
				periodErr,
			)
		}
		if usagePeriod.StartedAt.IsZero() || !usagePeriod.StartedAt.Equal(currentPeriod.StartedAt) {
			usagePeriod = currentPeriod
			receivedFramesBySource = [2]int64{}
			authorizedSeconds = 0
		}

		sourceIndex := source.providerChannel()
		nextSourceFrames := receivedFramesBySource[sourceIndex] + frameCount
		nextReceivedFrames := nextSourceFrames
		for index, receivedFrames := range receivedFramesBySource {
			if index != sourceIndex && receivedFrames > nextReceivedFrames {
				nextReceivedFrames = receivedFrames
			}
		}
		requestedSeconds := (nextReceivedFrames + transcriptionSampleRate - 1) / transcriptionSampleRate
		if requestedSeconds > authorizedSeconds {
			consumption, consumeErr := h.usageRepository.Consume(
				context.Background(),
				principal.UserID(),
				entitlements.MeterTranscriptionSeconds,
				usagePeriod,
				usageOperationKey,
				requestedSeconds,
				currentLimit.IncludedQuantity,
			)
			if consumeErr != nil {
				return newWSAuthError(
					"usage_service_unavailable",
					"Usage authorization is unavailable.",
					consumeErr,
				)
			}
			if !consumption.Allowed {
				return newWSAuthError(
					"usage_limit_exceeded",
					"Your monthly transcription allowance has been used.",
					nil,
				)
			}
			authorizedSeconds = requestedSeconds
		}
		receivedFramesBySource[sourceIndex] = nextSourceFrames
		return nil
	}
	sendAudioToAssembly := func(payload []byte) error {
		if len(payload) == 0 {
			if !finalizationRequested.CompareAndSwap(false, true) {
				return newWSAuthError("audio_frame_invalid", "Transcription finalization was already requested.", nil)
			}
			close(finalizationStarted)
			if !providerEnabled.Load() {
				return nil
			}
			for i, conn := range assemblyConns {
				if err := writeWSJSON(conn, &assemblyWriteMu[i], gin.H{"type": "Terminate"}); err != nil {
					disableProvider("transcription_provider_unavailable", "Live transcription is unavailable.")
					break
				}
			}
			return nil
		}
		if finalizationRequested.Load() {
			return newWSAuthError("audio_frame_invalid", "Audio was received after transcription finalization.", nil)
		}

		frame, err := decodeTranscriptionAudioFrame(payload)
		if err != nil {
			return newWSAuthError("audio_frame_invalid", "Audio frame is invalid.", err)
		}
		processErr := h.replayRegistry.process(
			recordingSession.ID,
			frame,
			func() error {
				if audioStorage == recordingaudio.ModeServer {
					source := recordingaudio.SourceMicrophone
					if frame.source == transcriptionAudioSourceSystem {
						source = recordingaudio.SourceSystem
					}
					if err := h.audioSpool.Append(recordingSession.UserID, recordingSession.ID, source, frame.sequence, frame.pcm); err != nil {
						return newWSAuthError("recording_storage_unavailable", "Recording storage is unavailable.", err)
					}
				}
				if !providerEnabled.Load() {
					return nil
				}
				if err := authorizeAudio(frame.source, int64(frame.frameCount)); err != nil {
					var authorizationError *wsAuthError
					if errors.As(err, &authorizationError) &&
						(authorizationError.Code == "usage_limit_exceeded" || authorizationError.Code == "usage_service_unavailable") {
						disableProvider(authorizationError.Code, authorizationError.Message)
						return nil
					}
					return err
				}
				channel := frame.source.providerChannel()
				if err := writeWSMessage(
					assemblyConns[channel],
					&assemblyWriteMu[channel],
					websocket.BinaryMessage,
					frame.pcm,
				); err != nil {
					disableProvider("transcription_provider_unavailable", "Live transcription is unavailable.")
				}
				return nil
			},
			func() error {
				return writeWSJSON(clientConn, &clientWriteMu, transcriptionAudioAck{
					Type:     "audio_ack",
					Source:   frame.source.clientName(),
					Sequence: strconv.FormatUint(frame.sequence, 10),
				})
			},
		)
		var sequenceErr *transcriptionReplaySequenceError
		if errors.As(processErr, &sequenceErr) {
			return newWSAuthError("audio_frame_invalid", "Audio frame sequence is invalid.", sequenceErr)
		}
		return processErr
	}

	forwardAssemblyMessage := func(channel int, payload []byte) error {
		response, ok, err := convertAssemblyAIMessage(
			channel,
			payload,
			&channelStates[channel],
			recordingSession,
		)
		if err != nil {
			return fmt.Errorf("%w: %v", errTranscriptionProviderUnavailable, err)
		}
		if !ok {
			return nil
		}
		if response.IsFinal {
			if err := h.persistFinalTranscriptEvent(response, recordingSession); err != nil {
				return err
			}
		}
		return writeWSJSON(clientConn, &clientWriteMu, response)
	}

	errCh := make(chan error, 8)
	providerTerminated := make(chan int, len(assemblyConns))
	done := make(chan struct{})
	defer close(done)

	for channel, conn := range assemblyConns {
		channel := channel
		conn := conn
		go func() {
			for {
				messageType, payload, readErr := conn.ReadMessage()
				if readErr != nil {
					disableProvider("transcription_provider_unavailable", "Live transcription is unavailable.")
					return
				}
				if messageType != websocket.TextMessage {
					continue
				}
				var envelope struct {
					Type string `json:"type"`
				}
				if unmarshalErr := json.Unmarshal(payload, &envelope); unmarshalErr != nil {
					disableProvider("transcription_provider_unavailable", "Live transcription is unavailable.")
					return
				}
				if envelope.Type == "Termination" {
					if !finalizationRequested.Load() {
						disableProvider("transcription_provider_unavailable", "Live transcription is unavailable.")
						return
					}
					select {
					case providerTerminated <- channel:
					case <-done:
					}
					return
				}
				if writeErr := forwardAssemblyMessage(channel, payload); writeErr != nil {
					if errors.Is(writeErr, errTranscriptionProviderUnavailable) {
						disableProvider("transcription_provider_unavailable", "Live transcription is unavailable.")
						return
					}
					errCh <- writeErr
					return
				}
			}
		}()
	}

	go func() {
		select {
		case <-done:
			return
		case <-finalizationStarted:
		}
		terminated := make([]bool, len(assemblyConns))
		remaining := len(assemblyConns)
		for remaining > 0 && providerEnabled.Load() {
			select {
			case <-done:
				return
			case <-providerUnavailable:
				remaining = 0
			case channel := <-providerTerminated:
				if channel < 0 || channel >= len(terminated) || terminated[channel] {
					disableProvider("transcription_provider_unavailable", "Live transcription is unavailable.")
					remaining = 0
					continue
				}
				terminated[channel] = true
				remaining--
			}
		}
		if h.finalizer == nil {
			errCh <- newWSAuthError("recording_finalization_unavailable", "Recording finalization is unavailable.", nil)
			return
		}
		finalizeContext, cancelFinalize := context.WithTimeout(context.Background(), 30*time.Minute)
		completed, finalizeErr := h.finalizer.Finalize(
			finalizeContext,
			recordingSession.ID,
			recordingSession.UserID,
			decodeFinalizeAudioStorage(finalizeAudioStored.Load()),
		)
		cancelFinalize()
		if finalizeErr != nil {
			errCh <- newWSAuthError("recording_finalization_unavailable", "Recording finalization is unavailable.", finalizeErr)
			return
		}
		if writeErr := writeWSJSON(clientConn, &clientWriteMu, transcriptionFinalizeAck{
			Type:               "finalize_ack",
			RecordingSessionID: recordingSession.ID,
			Status:             completed.Status,
			AudioStored:        completed.AudioStored,
		}); writeErr != nil {
			errCh <- writeErr
			return
		}
		errCh <- errTranscriptionFinalized
	}()

	go func() {
		for {
			messageType, payload, readErr := clientConn.ReadMessage()
			if readErr != nil {
				errCh <- readErr
				return
			}
			if messageType == websocket.TextMessage {
				var options transcriptionFinalizeOptions
				if unmarshalErr := json.Unmarshal(payload, &options); unmarshalErr != nil || options.Type != "finalize_options" {
					errCh <- newWSAuthError("audio_frame_invalid", "Transcription control message is invalid.", unmarshalErr)
					return
				}
				storageCode, ok := encodeFinalizeAudioStorage(options.AudioStored)
				if !ok || (audioStorageSpecified && !finalizeStorageMatchesMode(audioStorage, options.AudioStored)) || finalizationRequested.Load() {
					errCh <- newWSAuthError("audio_frame_invalid", "Transcription finalization options are invalid.", nil)
					return
				}
				if finalizeOptionsSet.Load() && finalizeAudioStored.Load() != storageCode {
					errCh <- newWSAuthError("audio_frame_invalid", "Transcription finalization options changed.", nil)
					return
				}
				finalizeAudioStored.Store(storageCode)
				finalizeOptionsSet.Store(true)
				continue
			}
			if messageType != websocket.BinaryMessage {
				continue
			}
			if len(payload) == 0 && !finalizeOptionsSet.Load() {
				errCh <- newWSAuthError("audio_frame_invalid", "Transcription finalization options are required.", nil)
				return
			}
			if writeErr := sendAudioToAssembly(payload); writeErr != nil {
				errCh <- writeErr
				return
			}
		}
	}()

	go func() {
		ticker := time.NewTicker(wsPingInterval)
		revalidate := time.NewTicker(wsRevalidationInterval)
		heartbeat := time.NewTicker(wsRecordingHeartbeatInterval)
		expires := time.NewTimer(wsMaximumLifetime)
		defer ticker.Stop()
		defer revalidate.Stop()
		defer heartbeat.Stop()
		defer expires.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if writeErr := writeWSMessage(clientConn, &clientWriteMu, websocket.PingMessage, nil); writeErr != nil {
					errCh <- writeErr
					return
				}
			case <-revalidate.C:
				if finalizationRequested.Load() {
					continue
				}
				refreshedPrincipal, authErr := h.principalService.Resolve(context.Background(), token)
				if authErr != nil {
					errCh <- authErr
					return
				}
				if !providerEnabled.Load() {
					continue
				}
				refreshedLimit, limitErr := entitlements.ResolveMeterLimit(
					refreshedPrincipal.User.Plan,
					entitlements.MeterTranscriptionSeconds,
				)
				if limitErr != nil {
					disableProvider(
						"usage_service_unavailable",
						"Usage authorization is unavailable.",
					)
					continue
				}
				entitlementMu.Lock()
				meterLimit = refreshedLimit
				entitlementMu.Unlock()
			case <-heartbeat.C:
				if finalizationRequested.Load() {
					continue
				}
				if heartbeatErr := h.heartbeatRecordingSession(recordingSessionID, principal.UserID()); heartbeatErr != nil {
					errCh <- heartbeatErr
					return
				}
			case <-expires.C:
				if finalizationRequested.Load() {
					continue
				}
				errCh <- newWSAuthError("auth_reauthentication_required", "Authentication must be renewed.", nil)
				return
			}
		}
	}()

	terminationErr := <-errCh
	if errors.Is(terminationErr, errTranscriptionFinalized) {
		_ = writeWSMessage(clientConn, &clientWriteMu, websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "transcription finalized"))
		return
	}
	var streamErr *wsAuthError
	if errors.As(terminationErr, &streamErr) &&
		(streamErr.Code == "usage_limit_exceeded" ||
			streamErr.Code == "usage_service_unavailable" ||
			streamErr.Code == "audio_frame_invalid" ||
			streamErr.Code == "recording_session_unavailable" ||
			streamErr.Code == "recording_session_service_unavailable" ||
			streamErr.Code == "transcript_persistence_unavailable" ||
			streamErr.Code == "recording_storage_unavailable" ||
			streamErr.Code == "recording_finalization_unavailable") {
		_ = writeWSJSON(clientConn, &clientWriteMu, gin.H{
			"type":    "error",
			"code":    streamErr.Code,
			"message": streamErr.Message,
		})
	}
	closeCode, closeReason := wsCloseForError(terminationErr)
	_ = writeWSMessage(clientConn, &clientWriteMu, websocket.CloseMessage, websocket.FormatCloseMessage(closeCode, closeReason))
}

func encodeFinalizeAudioStorage(value string) (int32, bool) {
	switch value {
	case models.RecordingAudioStoredNone:
		return 0, true
	case models.RecordingAudioStoredLocal:
		return 1, true
	case models.RecordingAudioStoredCloud:
		return 2, true
	default:
		return 0, false
	}
}

func decodeFinalizeAudioStorage(value int32) string {
	switch value {
	case 1:
		return models.RecordingAudioStoredLocal
	case 2:
		return models.RecordingAudioStoredCloud
	default:
		return models.RecordingAudioStoredNone
	}
}

func finalizeStorageMatchesMode(mode recordingaudio.Mode, stored string) bool {
	switch mode {
	case recordingaudio.ModeServer:
		return stored == models.RecordingAudioStoredCloud
	case recordingaudio.ModeLocal:
		return stored == models.RecordingAudioStoredLocal || stored == models.RecordingAudioStoredNone
	case recordingaudio.ModeNone:
		return stored == models.RecordingAudioStoredNone
	default:
		return false
	}
}

func (h *TranscriptionHandler) admitRecordingSession(sessionID, userID string) (*models.RecordingSession, error) {
	if sessionID == "" {
		return nil, newWSAuthError("recording_session_required", "A recording session is required.", nil)
	}
	if _, err := uuid.Parse(sessionID); err != nil {
		return nil, newWSAuthError("recording_session_invalid", "The recording session is invalid.", err)
	}
	if h.recordingRepo == nil {
		return nil, newWSAuthError("recording_session_service_unavailable", "Recording session authorization is unavailable.", nil)
	}

	ctx, cancel := context.WithTimeout(context.Background(), wsRecordingOperationTimeout)
	defer cancel()
	session, err := h.recordingRepo.GetSession(ctx, sessionID, userID)
	if err != nil {
		if errors.Is(err, repository.ErrRecordingSessionNotFound) {
			return nil, newWSAuthError("recording_session_unavailable", "The recording session is unavailable.", err)
		}
		return nil, newWSAuthError("recording_session_service_unavailable", "Recording session authorization is unavailable.", err)
	}
	if !isNonTerminalRecordingSession(session.Status) {
		return nil, newWSAuthError("recording_session_unavailable", "The recording session is unavailable.", nil)
	}
	if err := h.recordingRepo.Heartbeat(ctx, sessionID, userID); err != nil {
		return nil, recordingSessionHeartbeatError(err)
	}
	return session, nil
}

func (h *TranscriptionHandler) heartbeatRecordingSession(sessionID, userID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), wsRecordingOperationTimeout)
	defer cancel()
	return recordingSessionHeartbeatError(h.recordingRepo.Heartbeat(ctx, sessionID, userID))
}

func (h *TranscriptionHandler) persistFinalTranscriptEvent(
	event transcriptionEvent,
	session *models.RecordingSession,
) error {
	if h.transcriptRepo == nil || session == nil {
		return newWSAuthError(
			"transcript_persistence_unavailable",
			"Transcript persistence is unavailable.",
			nil,
		)
	}

	ctx, cancel := context.WithTimeout(context.Background(), wsRecordingOperationTimeout)
	defer cancel()
	err := h.transcriptRepo.UpsertFinalSegment(ctx, session.UserID, &models.TranscriptSegment{
		NoteID:            session.NoteID,
		SessionID:         session.ID,
		Channel:           event.channel,
		Text:              event.Text,
		StartTime:         &event.StartTime,
		EndTime:           event.EndTime,
		SegmentIndex:      event.Sequence,
		Words:             append([]models.TranscriptWord(nil), event.Words...),
		Provider:          event.provider,
		ProviderSegmentID: event.providerSegmentID,
		CreatedAt:         time.UnixMilli(event.CreatedAt).UTC(),
	})
	if err != nil {
		return newWSAuthError(
			"transcript_persistence_unavailable",
			"Transcript persistence is unavailable.",
			err,
		)
	}
	return nil
}

func recordingSessionHeartbeatError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, repository.ErrRecordingSessionTransition) {
		return newWSAuthError("recording_session_unavailable", "The recording session is unavailable.", err)
	}
	return newWSAuthError("recording_session_service_unavailable", "Recording session authorization is unavailable.", err)
}

func isNonTerminalRecordingSession(status string) bool {
	switch status {
	case models.RecordingSessionStarting, models.RecordingSessionRecording, models.RecordingSessionFinalizing:
		return true
	default:
		return false
	}
}

type assemblyAIWord struct {
	Start      int     `json:"start"`
	End        int     `json:"end"`
	Text       string  `json:"text"`
	Confidence float64 `json:"confidence"`
}

type assemblyAIMessage struct {
	Type            string           `json:"type"`
	ID              string           `json:"id"`
	TurnOrder       int              `json:"turn_order"`
	TurnIsFormatted bool             `json:"turn_is_formatted"`
	EndOfTurn       bool             `json:"end_of_turn"`
	Transcript      string           `json:"transcript"`
	Words           []assemblyAIWord `json:"words"`
}

type assemblyTurnState struct {
	CreatedAt int64
}

const maxRememberedAssemblyFinalTurns = 128

type assemblyChannelState struct {
	ProviderSessionID string
	Turns             map[int]assemblyTurnState
	FinalizedTurns    map[int]struct{}
	FinalizedOrder    []int
	SequenceOffset    int
}

type transcriptionEvent struct {
	Type              string                  `json:"type"`
	ID                string                  `json:"id"`
	SessionID         string                  `json:"session_id"`
	NoteID            string                  `json:"note_id"`
	Sequence          int                     `json:"sequence"`
	Source            string                  `json:"source"`
	Text              string                  `json:"text"`
	StartTime         float64                 `json:"start_time"`
	EndTime           *float64                `json:"end_time"`
	CreatedAt         int64                   `json:"created_at"`
	IsFinal           bool                    `json:"is_final"`
	Confidence        float64                 `json:"confidence"`
	Words             []models.TranscriptWord `json:"words,omitempty"`
	channel           int
	provider          string
	providerSegmentID string
}

func dialAssemblyAIChannels(key string, terms []string, count int) ([]*websocket.Conn, error) {
	params := url.Values{}
	params.Set("sample_rate", "48000")
	params.Set("encoding", "pcm_s16le")
	params.Set("speech_model", "universal-streaming-multilingual")
	params.Set("format_turns", "true")
	params.Set("min_turn_silence", "400")
	params.Set("max_turn_silence", "1800")
	params.Set("end_of_turn_confidence_threshold", "0.4")
	params.Set("inactivity_timeout", "3600")
	if len(terms) > 0 {
		encodedTerms, err := json.Marshal(terms)
		if err != nil {
			return nil, fmt.Errorf("encode assemblyai keyterms")
		}
		params.Set("keyterms_prompt", string(encodedTerms))
	}

	assemblyURL := "wss://streaming.assemblyai.com/v3/ws?" + params.Encode()
	header := http.Header{}
	header.Set("Authorization", key)

	conns := make([]*websocket.Conn, 0, count)
	for i := 0; i < count; i++ {
		conn, _, err := websocket.DefaultDialer.Dial(assemblyURL, header)
		if err != nil {
			for _, opened := range conns {
				_ = opened.Close()
			}
			return nil, fmt.Errorf("dial assemblyai channel %d failed", i)
		}
		conns = append(conns, conn)
	}
	return conns, nil
}

func convertAssemblyAIMessage(
	channel int,
	payload []byte,
	state *assemblyChannelState,
	session *models.RecordingSession,
) (transcriptionEvent, bool, error) {
	var msg assemblyAIMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		return transcriptionEvent{}, false, err
	}
	if state == nil {
		return transcriptionEvent{}, false, errors.New("assemblyai channel state is unavailable")
	}

	switch msg.Type {
	case "Begin":
		providerSessionID := strings.TrimSpace(msg.ID)
		if providerSessionID == "" {
			return transcriptionEvent{}, false, errors.New("assemblyai session identity is unavailable")
		}
		if state.ProviderSessionID != "" && state.ProviderSessionID != providerSessionID {
			return transcriptionEvent{}, false, errors.New("assemblyai session identity changed")
		}
		state.ProviderSessionID = providerSessionID
		return transcriptionEvent{}, false, nil
	case "Termination":
		return transcriptionEvent{}, false, nil
	case "Error":
		// Provider-controlled diagnostics may echo private vocabulary or request
		// context. Keep them out of Orion errors and application logs.
		return transcriptionEvent{}, false, errors.New("assemblyai streaming error")
	case "Turn":
	default:
		return transcriptionEvent{}, false, nil
	}

	transcript := msg.Transcript
	if strings.TrimSpace(transcript) == "" {
		return transcriptionEvent{}, false, nil
	}
	if msg.TurnOrder < 0 {
		return transcriptionEvent{}, false, fmt.Errorf("assemblyai returned negative turn order %d", msg.TurnOrder)
	}
	if session == nil || session.ClientSessionID == "" || session.NoteID == "" {
		return transcriptionEvent{}, false, errors.New("recording session context is unavailable")
	}
	if state.ProviderSessionID == "" || state.Turns == nil || state.FinalizedTurns == nil {
		return transcriptionEvent{}, false, errors.New("assemblyai session context is unavailable")
	}

	if _, finalized := state.FinalizedTurns[msg.TurnOrder]; finalized {
		return transcriptionEvent{}, false, nil
	}
	turnState := state.Turns[msg.TurnOrder]
	if turnState.CreatedAt == 0 {
		turnState.CreatedAt = time.Now().UnixMilli()
	}

	isFinal := msg.EndOfTurn
	if msg.EndOfTurn && msg.TurnIsFormatted {
		isFinal = true
	} else if msg.EndOfTurn {
		// With format_turns=true, AssemblyAI emits a formatted final turn shortly after
		// end_of_turn. Keep this as an interim update to avoid duplicate final segments.
		isFinal = false
	}
	words := make([]models.TranscriptWord, 0, len(msg.Words))
	var confidenceTotal float64
	startTime := 0.0
	var endTime *float64
	for index, word := range msg.Words {
		if strings.TrimSpace(word.Text) == "" || word.Start < 0 || word.End < word.Start ||
			word.Confidence < 0 || word.Confidence > 1 {
			return transcriptionEvent{}, false, errors.New("assemblyai returned invalid word timing")
		}
		confidenceTotal += word.Confidence
		wordStart := float64(word.Start) / 1000
		wordEnd := float64(word.End) / 1000
		if index == 0 || wordStart < startTime {
			startTime = wordStart
		}
		if endTime == nil || wordEnd > *endTime {
			endTime = &wordEnd
		}
		words = append(words, models.TranscriptWord{
			Word:       word.Text,
			Start:      wordStart,
			End:        wordEnd,
			Confidence: word.Confidence,
		})
	}

	confidence := 0.0
	if len(msg.Words) > 0 {
		confidence = confidenceTotal / float64(len(msg.Words))
	}

	source := "microphone"
	if channel == 1 {
		source = "system"
	} else if channel != 0 {
		return transcriptionEvent{}, false, fmt.Errorf("unsupported transcription channel %d", channel)
	}
	if !isFinal {
		endTime = nil
	}

	sequence := state.SequenceOffset + msg.TurnOrder
	if sequence < state.SequenceOffset {
		return transcriptionEvent{}, false, errors.New("transcript sequence overflow")
	}

	event := transcriptionEvent{
		Type:              "transcript",
		ID:                fmt.Sprintf("%s:%s:%d", session.ClientSessionID, source, sequence),
		SessionID:         session.ClientSessionID,
		NoteID:            session.NoteID,
		Sequence:          sequence,
		Source:            source,
		Text:              transcript,
		StartTime:         startTime,
		EndTime:           endTime,
		CreatedAt:         turnState.CreatedAt,
		IsFinal:           isFinal,
		Confidence:        confidence,
		Words:             words,
		channel:           channel,
		provider:          "assemblyai",
		providerSegmentID: fmt.Sprintf("%s:%d", state.ProviderSessionID, msg.TurnOrder),
	}
	if isFinal {
		delete(state.Turns, msg.TurnOrder)
		state.FinalizedTurns[msg.TurnOrder] = struct{}{}
		state.FinalizedOrder = append(state.FinalizedOrder, msg.TurnOrder)
		if len(state.FinalizedOrder) > maxRememberedAssemblyFinalTurns {
			oldest := state.FinalizedOrder[0]
			state.FinalizedOrder = state.FinalizedOrder[1:]
			delete(state.FinalizedTurns, oldest)
		}
	} else {
		state.Turns[msg.TurnOrder] = turnState
	}

	return event, true, nil
}

func writeWSMessage(conn *websocket.Conn, mu *sync.Mutex, messageType int, payload []byte) error {
	mu.Lock()
	defer mu.Unlock()
	if err := conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout)); err != nil {
		return err
	}
	return conn.WriteMessage(messageType, payload)
}

func writeWSJSON(conn *websocket.Conn, mu *sync.Mutex, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return writeWSMessage(conn, mu, websocket.TextMessage, raw)
}
