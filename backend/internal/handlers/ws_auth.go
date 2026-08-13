package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	orionauth "github.com/mouizahmed/justscribe-backend/internal/auth"
)

const authTimeout = 10 * time.Second

const (
	wsCloseUnauthorized   = 4001
	wsCloseReauthenticate = 4002
	wsCloseForbidden      = 4003
)

type wsAuthMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

type wsAuthError struct {
	Code    string
	Message string
	Cause   error
}

func (e *wsAuthError) Error() string {
	return e.Message
}

func (e *wsAuthError) Unwrap() error {
	return e.Cause
}

// authenticateWSConn applies the same active-principal checks as HTTP after a
// bounded first-message authentication handshake.
func authenticateWSConn(conn *websocket.Conn, service *orionauth.PrincipalService) (*orionauth.Principal, string, error) {
	_ = conn.SetReadDeadline(time.Now().Add(authTimeout))
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		return nil, "", newWSAuthError("auth_message_missing", "Authentication message was not received.", err)
	}
	_ = conn.SetReadDeadline(time.Time{})
	if messageType != websocket.TextMessage {
		return nil, "", newWSAuthError("auth_message_invalid", "Authentication message is invalid.", nil)
	}

	var authMsg wsAuthMessage
	if err := json.Unmarshal(payload, &authMsg); err != nil {
		return nil, "", newWSAuthError("auth_message_invalid", "Authentication message is invalid.", err)
	}
	if authMsg.Type != "auth" || strings.TrimSpace(authMsg.Token) == "" {
		return nil, "", newWSAuthError("auth_message_invalid", "Authentication message is invalid.", nil)
	}

	principal, err := service.Resolve(context.Background(), authMsg.Token)
	if err != nil {
		var principalErr *orionauth.PrincipalError
		if errors.As(err, &principalErr) {
			return nil, "", newWSAuthError(string(principalErr.Code), principalErr.Message, err)
		}
		return nil, "", newWSAuthError(string(orionauth.PrincipalServiceUnavailable), "Authentication service is unavailable.", err)
	}
	return principal, authMsg.Token, nil
}

func newWSAuthError(code, message string, cause error) *wsAuthError {
	return &wsAuthError{Code: code, Message: message, Cause: cause}
}

func wsAuthErrorData(err error) map[string]string {
	var authErr *wsAuthError
	if errors.As(err, &authErr) {
		return map[string]string{"code": authErr.Code, "message": authErr.Message}
	}
	return map[string]string{
		"code":    string(orionauth.PrincipalServiceUnavailable),
		"message": "Authentication service is unavailable.",
	}
}

func wsCloseForError(err error) (int, string) {
	var authErr *wsAuthError
	if errors.As(err, &authErr) {
		switch authErr.Code {
		case "auth_reauthentication_required":
			return wsCloseReauthenticate, "reauthentication required"
		case string(orionauth.PrincipalUserSuspended),
			string(orionauth.PrincipalUserDeleted),
			string(orionauth.PrincipalUserInactive):
			return wsCloseForbidden, "account unavailable"
		case string(orionauth.PrincipalServiceUnavailable):
			return websocket.CloseTryAgainLater, "authentication unavailable"
		default:
			return wsCloseUnauthorized, "unauthorized"
		}
	}

	var principalErr *orionauth.PrincipalError
	if errors.As(err, &principalErr) {
		switch orionauth.StatusForPrincipalError(principalErr) {
		case http.StatusForbidden:
			return wsCloseForbidden, "account unavailable"
		case http.StatusServiceUnavailable:
			return websocket.CloseTryAgainLater, "authentication unavailable"
		default:
			return wsCloseUnauthorized, "unauthorized"
		}
	}

	return websocket.CloseNormalClosure, ""
}

func checkWebSocketOrigin(request *http.Request) bool {
	origin, ok := canonicalWebSocketOrigin(request.Header.Get("Origin"))
	if !ok {
		return false
	}

	for _, configured := range webSocketAllowedOrigins() {
		allowed, valid := canonicalWebSocketOrigin(configured)
		if valid && origin == allowed {
			return true
		}
	}
	return false
}

func webSocketAllowedOrigins() []string {
	raw := strings.TrimSpace(os.Getenv("WEBSOCKET_ALLOWED_ORIGINS"))
	if raw == "" {
		return []string{
			"file://",
			"null",
			"http://localhost:5173",
			"http://127.0.0.1:5173",
		}
	}

	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		if origin := strings.TrimSpace(part); origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}

func canonicalWebSocketOrigin(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "file://" || raw == "null" {
		return raw, true
	}

	parsed, err := url.Parse(raw)
	if err != nil || parsed.User != nil || parsed.Host == "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", false
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", false
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host), true
}
