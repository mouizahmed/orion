package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/mouizahmed/justscribe-backend/internal/auth"
)

type TranscriptionHandler struct{}

func NewTranscriptionHandler() *TranscriptionHandler {
	return &TranscriptionHandler{}
}

var transcriptionUpgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin: func(_ *http.Request) bool {
		return true
	},
}

type wsAuthMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

const authTimeout = 10 * time.Second
const maxWSMessageBytes = 1 << 20 // 1 MiB safety limit
const wsReadTimeout = 70 * time.Second
const wsPingInterval = 25 * time.Second
const wsWriteTimeout = 10 * time.Second

// Stream authenticates the client and proxies two-channel audio/results through AssemblyAI.
func (h *TranscriptionHandler) Stream(c *gin.Context) {
	key := os.Getenv("ASSEMBLYAI_API_KEY")
	if key == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "transcription service unavailable"})
		return
	}

	clientConn, err := transcriptionUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer clientConn.Close()
	clientConn.SetReadLimit(maxWSMessageBytes)

	if err := h.authenticateClientConn(clientConn); err != nil {
		_ = clientConn.WriteJSON(gin.H{"type": "error", "message": err.Error()})
		_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "unauthorized"))
		return
	}
	_ = clientConn.WriteJSON(gin.H{"type": "auth_ok"})

	assemblyConns, err := dialAssemblyAIChannels(key, 2)
	if err != nil {
		_ = clientConn.WriteJSON(gin.H{"type": "error", "message": "failed to connect transcription provider"})
		return
	}
	defer func() {
		for _, conn := range assemblyConns {
			_ = conn.WriteJSON(gin.H{"type": "Terminate"})
			_ = conn.Close()
		}
	}()

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
	channelTurns := make([]map[int]assemblyTurnState, len(assemblyConns))
	for i := range channelTurns {
		channelTurns[i] = map[int]assemblyTurnState{}
	}
	var clientWriteMu sync.Mutex

	sendAudioToAssembly := func(payload []byte) error {
		if len(payload) == 0 {
			for i, conn := range assemblyConns {
				if err := writeWSJSON(conn, &assemblyWriteMu[i], gin.H{"type": "Terminate"}); err != nil {
					return err
				}
			}
			return nil
		}

		ch0, ch1, err := splitInterleavedStereoPCM16(payload)
		if err != nil {
			return err
		}
		if len(ch0) > 0 {
			if err := writeWSMessage(assemblyConns[0], &assemblyWriteMu[0], websocket.BinaryMessage, ch0); err != nil {
				return err
			}
		}
		if len(ch1) > 0 {
			if err := writeWSMessage(assemblyConns[1], &assemblyWriteMu[1], websocket.BinaryMessage, ch1); err != nil {
				return err
			}
		}
		return nil
	}

	forwardAssemblyMessage := func(channel int, payload []byte) error {
		response, ok, err := convertAssemblyAIMessage(channel, payload, channelTurns[channel])
		if err != nil {
			return err
		}
		if !ok {
			return nil
		}
		return writeWSJSON(clientConn, &clientWriteMu, response)
	}

	errCh := make(chan error, 4)
	done := make(chan struct{})
	defer close(done)

	for channel, conn := range assemblyConns {
		channel := channel
		conn := conn
		go func() {
			for {
				messageType, payload, readErr := conn.ReadMessage()
				if readErr != nil {
					errCh <- readErr
					return
				}
				if messageType != websocket.TextMessage {
					continue
				}
				if writeErr := forwardAssemblyMessage(channel, payload); writeErr != nil {
					errCh <- writeErr
					return
				}
			}
		}()
	}

	go func() {
		for {
			messageType, payload, readErr := clientConn.ReadMessage()
			if readErr != nil {
				errCh <- readErr
				return
			}
			if messageType != websocket.BinaryMessage {
				continue
			}
			if writeErr := sendAudioToAssembly(payload); writeErr != nil {
				errCh <- writeErr
				return
			}
		}
	}()

	go func() {
		ticker := time.NewTicker(wsPingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if writeErr := writeWSMessage(clientConn, &clientWriteMu, websocket.PingMessage, nil); writeErr != nil {
					errCh <- writeErr
					return
				}
			}
		}
	}()

	<-errCh
	_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
}

// authenticateWSConn performs the WS auth handshake and returns the authenticated userID.
func authenticateWSConn(conn *websocket.Conn) (string, error) {
	firebaseClient := auth.GetFirebaseClient()
	if firebaseClient == nil {
		return "", errors.New("auth service unavailable")
	}

	_ = conn.SetReadDeadline(time.Now().Add(authTimeout))
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		return "", errors.New("missing auth message")
	}
	_ = conn.SetReadDeadline(time.Time{})
	if messageType != websocket.TextMessage {
		return "", errors.New("invalid auth message")
	}

	var authMsg wsAuthMessage
	if err := json.Unmarshal(payload, &authMsg); err != nil {
		return "", errors.New("invalid auth payload")
	}
	if authMsg.Type != "auth" || authMsg.Token == "" {
		return "", errors.New("invalid auth payload")
	}

	token, err := firebaseClient.VerifyIDTokenAndCheckRevoked(authMsg.Token)
	if err != nil {
		return "", errors.New("invalid token")
	}
	return token.UID, nil
}

func (h *TranscriptionHandler) authenticateClientConn(clientConn *websocket.Conn) error {
	_, err := authenticateWSConn(clientConn)
	return err
}

type assemblyAIWord struct {
	Start      int     `json:"start"`
	End        int     `json:"end"`
	Text       string  `json:"text"`
	Confidence float64 `json:"confidence"`
}

type assemblyAIMessage struct {
	Type            string           `json:"type"`
	Error           string           `json:"error"`
	Message         string           `json:"message"`
	TurnOrder       int              `json:"turn_order"`
	TurnIsFormatted bool             `json:"turn_is_formatted"`
	EndOfTurn       bool             `json:"end_of_turn"`
	Transcript      string           `json:"transcript"`
	Words           []assemblyAIWord `json:"words"`
}

type assemblyTurnState struct {
	SentFinal bool
}

type providerWord struct {
	Word           string  `json:"word"`
	Start          float64 `json:"start"`
	End            float64 `json:"end"`
	Confidence     float64 `json:"confidence"`
	PunctuatedWord string  `json:"punctuated_word,omitempty"`
}

type providerAlternative struct {
	Transcript string         `json:"transcript"`
	Confidence float64        `json:"confidence"`
	Words      []providerWord `json:"words"`
}

type providerChannel struct {
	Alternatives []providerAlternative `json:"alternatives"`
}

type providerResponse struct {
	Type         string          `json:"type"`
	ChannelIndex []int           `json:"channel_index"`
	IsFinal      bool            `json:"is_final"`
	SpeechFinal  bool            `json:"speech_final"`
	Channel      providerChannel `json:"channel"`
}

func dialAssemblyAIChannels(key string, count int) ([]*websocket.Conn, error) {
	params := url.Values{}
	params.Set("sample_rate", "48000")
	params.Set("encoding", "pcm_s16le")
	params.Set("speech_model", "universal-streaming-english")
	params.Set("format_turns", "true")
	params.Set("min_turn_silence", "400")
	params.Set("max_turn_silence", "1800")
	params.Set("end_of_turn_confidence_threshold", "0.4")
	params.Set("inactivity_timeout", "3600")

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
			return nil, fmt.Errorf("dial assemblyai channel %d: %w", i, err)
		}
		conns = append(conns, conn)
	}
	return conns, nil
}

func splitInterleavedStereoPCM16(payload []byte) ([]byte, []byte, error) {
	if len(payload)%4 != 0 {
		return nil, nil, fmt.Errorf("invalid stereo pcm16 payload length %d", len(payload))
	}

	samples := len(payload) / 4
	ch0 := make([]byte, samples*2)
	ch1 := make([]byte, samples*2)
	for i := 0; i < samples; i++ {
		src := i * 4
		dst := i * 2
		copy(ch0[dst:dst+2], payload[src:src+2])
		copy(ch1[dst:dst+2], payload[src+2:src+4])
	}
	return ch0, ch1, nil
}

func convertAssemblyAIMessage(channel int, payload []byte, turns map[int]assemblyTurnState) (providerResponse, bool, error) {
	var msg assemblyAIMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		return providerResponse{}, false, err
	}

	switch msg.Type {
	case "Begin", "Termination":
		return providerResponse{}, false, nil
	case "Error":
		message := msg.Error
		if message == "" {
			message = msg.Message
		}
		if message == "" {
			message = "assemblyai streaming error"
		}
		return providerResponse{}, false, errors.New(message)
	case "Turn":
	default:
		return providerResponse{}, false, nil
	}

	transcript := msg.Transcript
	if transcript == "" {
		return providerResponse{}, false, nil
	}

	state := turns[msg.TurnOrder]
	if state.SentFinal {
		return providerResponse{}, false, nil
	}

	isFinal := msg.EndOfTurn
	if msg.EndOfTurn && msg.TurnIsFormatted {
		isFinal = true
		state.SentFinal = true
		turns[msg.TurnOrder] = state
	} else if msg.EndOfTurn {
		// With format_turns=true, AssemblyAI emits a formatted final turn shortly after
		// end_of_turn. Keep this as an interim update to avoid duplicate final segments.
		isFinal = false
	}

	words := make([]providerWord, 0, len(msg.Words))
	var confidenceTotal float64
	for _, word := range msg.Words {
		confidenceTotal += word.Confidence
		words = append(words, providerWord{
			Word:           word.Text,
			Start:          float64(word.Start) / 1000,
			End:            float64(word.End) / 1000,
			Confidence:     word.Confidence,
			PunctuatedWord: word.Text,
		})
	}

	confidence := 0.0
	if len(msg.Words) > 0 {
		confidence = confidenceTotal / float64(len(msg.Words))
	}

	return providerResponse{
		Type:         "Results",
		ChannelIndex: []int{channel},
		IsFinal:      isFinal,
		SpeechFinal:  msg.EndOfTurn,
		Channel: providerChannel{
			Alternatives: []providerAlternative{{
				Transcript: transcript,
				Confidence: confidence,
				Words:      words,
			}},
		},
	}, true, nil
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
