package handlers

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/recordingfinalizer"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

type RecordingsHandler struct {
	noteRepo      *repository.NoteRepository
	recordingRepo *repository.RecordingSessionRepository
	finalizer     *recordingfinalizer.Finalizer
}

type CreateRecordingRequest struct {
	NoteID          string `json:"note_id"`
	ClientSessionID string `json:"client_session_id"`
}

type UpdateRecordingRequest struct {
	Status      string `json:"status"`
	AudioStored string `json:"audio_stored,omitempty"`
}

func NewRecordingsHandler(
	noteRepo *repository.NoteRepository,
	recordingRepo *repository.RecordingSessionRepository,
	finalizer *recordingfinalizer.Finalizer,
) *RecordingsHandler {
	return &RecordingsHandler{
		noteRepo:      noteRepo,
		recordingRepo: recordingRepo,
		finalizer:     finalizer,
	}
}

func parseRecordingUUID(value, field string) (string, string) {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", field + " must be a valid UUID"
	}
	return parsed.String(), ""
}

func (h *RecordingsHandler) Create(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	var request CreateRecordingRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_request", "error": "invalid request payload"})
		return
	}

	noteID, message := parseRecordingUUID(request.NoteID, "note_id")
	if message != "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_request", "error": message})
		return
	}
	clientSessionID, message := parseRecordingUUID(request.ClientSessionID, "client_session_id")
	if message != "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_request", "error": message})
		return
	}

	if _, err := h.noteRepo.GetNoteByID(userID, noteID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "note_not_found", "error": "note not found"})
		return
	}

	session, err := h.recordingRepo.CreateForClient(c.Request.Context(), noteID, userID, clientSessionID)
	if err == nil {
		c.JSON(http.StatusCreated, gin.H{"session": session})
		return
	}

	if errors.Is(err, repository.ErrRecordingClientSessionConflict) || errors.Is(err, repository.ErrActiveRecordingSessionExists) {
		existing, loadErr := h.recordingRepo.GetSessionByClientID(c.Request.Context(), clientSessionID, userID)
		if loadErr == nil && existing.NoteID == noteID {
			c.JSON(http.StatusOK, gin.H{"session": existing})
			return
		}
		if loadErr != nil && !errors.Is(loadErr, repository.ErrRecordingSessionNotFound) {
			log.Printf("recordings: failed to resolve client session replay: %v", loadErr)
			c.JSON(http.StatusInternalServerError, gin.H{"code": "recording_create_failed", "error": "failed to create recording"})
			return
		}
		if errors.Is(err, repository.ErrRecordingClientSessionConflict) {
			c.JSON(http.StatusConflict, gin.H{"code": "client_session_conflict", "error": "client session id is already in use"})
			return
		}
		c.JSON(http.StatusConflict, gin.H{"code": "recording_already_active", "error": "a recording is already active"})
		return
	}

	log.Printf("recordings: failed to create session: %v", err)
	c.JSON(http.StatusInternalServerError, gin.H{"code": "recording_create_failed", "error": "failed to create recording"})
}

func (h *RecordingsHandler) GetActive(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	session, err := h.recordingRepo.GetActiveSessionForUser(c.Request.Context(), userID)
	if err != nil {
		log.Printf("recordings: failed to load active session: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"code": "recording_load_failed", "error": "failed to load active recording"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": session})
}

func (h *RecordingsHandler) Get(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	sessionID, message := parseRecordingUUID(c.Param("sessionID"), "session id")
	if message != "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_id", "error": message})
		return
	}

	session, err := h.recordingRepo.GetSession(c.Request.Context(), sessionID, userID)
	if errors.Is(err, repository.ErrRecordingSessionNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"code": "recording_not_found", "error": "recording not found"})
		return
	}
	if err != nil {
		log.Printf("recordings: failed to load session: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"code": "recording_load_failed", "error": "failed to load recording"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": session})
}

func (h *RecordingsHandler) Finalize(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	sessionID, message := parseRecordingUUID(c.Param("sessionID"), "session id")
	if message != "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_id", "error": message})
		return
	}

	var request struct {
		AudioStored string `json:"audio_stored"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_finalization", "error": "invalid request payload"})
		return
	}
	request.AudioStored = strings.TrimSpace(request.AudioStored)
	if !isRecordingAudioStorage(request.AudioStored) {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_finalization", "error": "audio_stored must be one of none, local, or cloud"})
		return
	}

	session, err := h.finalizer.Finalize(c.Request.Context(), sessionID, userID, request.AudioStored)
	if errors.Is(err, repository.ErrRecordingSessionNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"code": "recording_not_found", "error": "recording not found"})
		return
	}
	if errors.Is(err, repository.ErrRecordingSessionTransition) {
		c.JSON(http.StatusConflict, gin.H{"code": "recording_transition_rejected", "error": "recording transition rejected"})
		return
	}
	if err != nil {
		log.Printf("recordings: failed to finalize session: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"code": "recording_finalization_failed", "error": "failed to finalize recording"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": session})
}

func (h *RecordingsHandler) Update(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	sessionID, message := parseRecordingUUID(c.Param("sessionID"), "session id")
	if message != "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_id", "error": message})
		return
	}

	var request UpdateRecordingRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_transition", "error": "invalid request payload"})
		return
	}
	request.Status = strings.TrimSpace(request.Status)
	request.AudioStored = strings.TrimSpace(request.AudioStored)

	var session *models.RecordingSession
	switch request.Status {
	case models.RecordingSessionRecording:
		if request.AudioStored != "" {
			c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_transition", "error": "audio_stored is valid only when completing a recording"})
			return
		}
		session, err = h.recordingRepo.MarkRecording(c.Request.Context(), sessionID, userID)
	case models.RecordingSessionFailed:
		if request.AudioStored != "" {
			c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_transition", "error": "audio_stored is valid only when completing a recording"})
			return
		}
		session, err = h.recordingRepo.MarkFailed(c.Request.Context(), sessionID, userID)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_recording_transition", "error": "unsupported recording status"})
		return
	}

	if errors.Is(err, repository.ErrRecordingSessionTransition) {
		existing, loadErr := h.recordingRepo.GetSession(c.Request.Context(), sessionID, userID)
		if loadErr == nil && existing.Status == request.Status {
			c.JSON(http.StatusOK, gin.H{"session": existing})
			return
		}
		if errors.Is(loadErr, repository.ErrRecordingSessionNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": "recording_not_found", "error": "recording not found"})
			return
		}
		if loadErr != nil {
			log.Printf("recordings: failed to resolve transition replay: %v", loadErr)
			c.JSON(http.StatusInternalServerError, gin.H{"code": "recording_update_failed", "error": "failed to update recording"})
			return
		}
		c.JSON(http.StatusConflict, gin.H{"code": "recording_transition_rejected", "error": "recording transition rejected"})
		return
	}
	if err != nil {
		log.Printf("recordings: failed to transition session: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"code": "recording_update_failed", "error": "failed to update recording"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": session})
}

func isRecordingAudioStorage(value string) bool {
	switch value {
	case models.RecordingAudioStoredNone, models.RecordingAudioStoredLocal, models.RecordingAudioStoredCloud:
		return true
	default:
		return false
	}
}
