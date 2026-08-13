package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

type SessionErrorCode string

const (
	SessionInvalid          SessionErrorCode = "invalid"
	SessionExpired          SessionErrorCode = "expired"
	SessionRevoked          SessionErrorCode = "revoked"
	SessionUserMissing      SessionErrorCode = "user_missing"
	SessionIdentityDisabled SessionErrorCode = "identity_disabled"
	SessionUpstreamFailure  SessionErrorCode = "upstream_failure"
)

type SessionError struct {
	Code  SessionErrorCode
	Cause error
}

func (e *SessionError) Error() string { return "Supabase session validation failed: " + string(e.Code) }
func (e *SessionError) Unwrap() error { return e.Cause }

type SupabaseUser struct {
	ID               string         `json:"id"`
	Email            string         `json:"email"`
	EmailConfirmedAt *time.Time     `json:"email_confirmed_at"`
	UserMetadata     map[string]any `json:"user_metadata"`
	SessionID        string         `json:"-"`
}

type SupabaseClient struct {
	baseURL        string
	publishableKey string
	httpClient     *http.Client
}

func NewSupabaseClient(config Config) *SupabaseClient {
	return &SupabaseClient{
		baseURL:        config.SupabaseURL,
		publishableKey: config.SupabasePublishableKey,
		httpClient:     &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *SupabaseClient) ValidateAccessToken(parent context.Context, accessToken string) (*SupabaseUser, error) {
	if c == nil || strings.TrimSpace(accessToken) == "" {
		return nil, &SessionError{Code: SessionInvalid}
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/auth/v1/user", nil)
	if err != nil {
		return nil, &SessionError{Code: SessionUpstreamFailure, Cause: err}
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("apikey", c.publishableKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, &SessionError{Code: SessionUpstreamFailure, Cause: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, mapSupabaseAuthError(resp)
	}
	var user SupabaseUser
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	if err := decoder.Decode(&user); err != nil {
		return nil, &SessionError{Code: SessionUpstreamFailure, Cause: err}
	}
	if _, err := uuid.Parse(user.ID); err != nil || strings.TrimSpace(user.Email) == "" {
		return nil, &SessionError{Code: SessionInvalid, Cause: errors.New("invalid user response")}
	}
	sessionID, err := sessionIDFromAccessToken(accessToken)
	if err != nil {
		return nil, &SessionError{Code: SessionInvalid, Cause: err}
	}
	user.SessionID = sessionID
	return &user, nil
}

func sessionIDFromAccessToken(accessToken string) (string, error) {
	parts := strings.Split(accessToken, ".")
	if len(parts) != 3 || len(parts[1]) > 64<<10 {
		return "", errors.New("invalid JWT payload")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode JWT payload: %w", err)
	}
	var claims struct {
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", fmt.Errorf("decode JWT claims: %w", err)
	}
	parsed, err := uuid.Parse(claims.SessionID)
	if err != nil {
		return "", errors.New("JWT session_id claim is missing or invalid")
	}
	return parsed.String(), nil
}

func (c *SupabaseClient) SignOut(parent context.Context, accessToken, scope string) error {
	if scope != "local" && scope != "global" {
		return fmt.Errorf("invalid sign-out scope")
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	endpoint := c.baseURL + "/auth/v1/logout?scope=" + url.QueryEscape(scope)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return &SessionError{Code: SessionUpstreamFailure, Cause: err}
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("apikey", c.publishableKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return &SessionError{Code: SessionUpstreamFailure, Cause: err}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return mapSupabaseAuthError(resp)
	}
	return nil
}

func mapSupabaseAuthError(resp *http.Response) error {
	if resp.StatusCode == http.StatusRequestTimeout || resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		return &SessionError{Code: SessionUpstreamFailure, Cause: fmt.Errorf("auth upstream status %d", resp.StatusCode)}
	}
	var payload struct {
		Code string `json:"code"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&payload)
	code := strings.ToLower(payload.Code)
	mapped := SessionInvalid
	switch {
	case strings.Contains(code, "expired"):
		mapped = SessionExpired
	case strings.Contains(code, "session_not_found"), strings.Contains(code, "revoked"):
		mapped = SessionRevoked
	case strings.Contains(code, "user_not_found"):
		mapped = SessionUserMissing
	case strings.Contains(code, "banned"), strings.Contains(code, "disabled"), strings.Contains(code, "provider"):
		mapped = SessionIdentityDisabled
	}
	return &SessionError{Code: mapped, Cause: fmt.Errorf("auth upstream status %d", resp.StatusCode)}
}
