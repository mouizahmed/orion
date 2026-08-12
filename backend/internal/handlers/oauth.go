package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/auth"
	authproviders "github.com/mouizahmed/justscribe-backend/internal/auth/providers"
	"github.com/mouizahmed/justscribe-backend/internal/email"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/profile"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/redis/go-redis/v9"
)

type OAuthHandler struct {
	authIdentityRepo *repository.UserAuthIdentityRepository
	firebaseClient   *auth.FirebaseClient
	codeManager      *auth.CodeManager
	redisClient      *redis.Client
	providerRegistry *authproviders.Registry
	avatarService    *profile.AvatarService
	emailSvc         *email.Service
	wsHub            *WsHub
}

type LoginOAuthState struct {
	Purpose             string `json:"purpose"`
	Provider            string `json:"provider"`
	Platform            string `json:"platform"`
	CodeChallenge       string `json:"code_challenge,omitempty"`
	CodeChallengeMethod string `json:"code_challenge_method,omitempty"`
	CreatedAt           string `json:"created_at"`
}

const loginOAuthStateTTL = 10 * time.Minute

func NewOAuthHandler(authIdentityRepo *repository.UserAuthIdentityRepository, redisClient *redis.Client, avatarService *profile.AvatarService, emailSvc *email.Service, wsHub *WsHub) *OAuthHandler {
	firebaseClient := auth.GetFirebaseClient()
	codeManager := auth.NewCodeManager(redisClient)

	return &OAuthHandler{
		authIdentityRepo: authIdentityRepo,
		firebaseClient:   firebaseClient,
		codeManager:      codeManager,
		redisClient:      redisClient,
		providerRegistry: authproviders.NewDefaultRegistry(),
		avatarService:    avatarService,
		emailSvc:         emailSvc,
		wsHub:            wsHub,
	}
}

func generateSecureState() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func normalizeOAuthPlatform(platform string) (string, bool) {
	switch platform {
	case "", "desktop":
		return "desktop", true
	case "web":
		return "web", true
	default:
		return "", false
	}
}

func isWebLoginEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ENABLE_WEB_LOGIN"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func normalizeLoginProvider(provider string) (models.AuthProvider, bool) {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "", string(models.AuthProviderGoogle):
		return models.AuthProviderGoogle, true
	case string(models.AuthProviderMicrosoft):
		return models.AuthProviderMicrosoft, true
	default:
		return "", false
	}
}

func normalizeCodeChallengeMethod(method string) (string, bool) {
	if strings.EqualFold(strings.TrimSpace(method), "S256") {
		return "S256", true
	}
	return "", false
}

func isValidPKCEValue(value string) bool {
	if len(value) < 43 || len(value) > 128 {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '.' || r == '_' || r == '~' {
			continue
		}
		return false
	}
	return true
}

func codeChallengeFromVerifier(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// isRateLimited checks if the request should be rate limited
func (h *OAuthHandler) isRateLimited(ctx context.Context, ip, endpoint string, limit int, window time.Duration) (bool, error) {
	key := fmt.Sprintf("rate_limit:%s:%s", ip, endpoint)

	const rateLimitScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return count
`
	count, err := h.redisClient.Eval(ctx, rateLimitScript, []string{key}, window.Milliseconds()).Int()
	if err != nil {
		return false, err
	}

	if count > limit {
		return true, nil
	}

	return false, nil
}

// StartOAuth initiates the OAuth flow
func (h *OAuthHandler) StartOAuth(c *gin.Context) {
	// Rate limiting: 5 attempts per minute per IP
	clientIP := c.ClientIP()
	limited, err := h.isRateLimited(c.Request.Context(), clientIP, "start", 5, time.Minute)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": "auth_service_unavailable", "error": "Authentication service is unavailable"})
		return
	}
	if limited {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": "Too many requests. Please try again later.",
		})
		return
	}

	platform, ok := normalizeOAuthPlatform(c.Query("platform"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Unsupported platform",
		})
		return
	}
	if platform == "web" && !isWebLoginEnabled() {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Web login is not enabled",
		})
		return
	}

	state, err := generateSecureState()
	if err != nil {
		log.Printf("Failed to generate OAuth state: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to start authentication",
		})
		return
	}

	provider, ok := normalizeLoginProvider(c.Query("provider"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Unsupported provider",
		})
		return
	}
	codeChallenge := strings.TrimSpace(c.Query("code_challenge"))
	codeChallengeMethod := strings.TrimSpace(c.Query("code_challenge_method"))
	if platform == "desktop" || platform == "web" {
		method, ok := normalizeCodeChallengeMethod(codeChallengeMethod)
		if !ok || !isValidPKCEValue(codeChallenge) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Missing or invalid auth verifier challenge",
			})
			return
		}
		codeChallengeMethod = method
	} else if codeChallenge != "" || codeChallengeMethod != "" {
		method, ok := normalizeCodeChallengeMethod(codeChallengeMethod)
		if !ok || !isValidPKCEValue(codeChallenge) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Invalid auth verifier challenge",
			})
			return
		}
		codeChallengeMethod = method
	}
	log.Printf("Started OAuth login flow (provider: %s, platform: %s)", provider, platform)

	ctx := c.Request.Context()
	key := fmt.Sprintf("oauth_state:%s", state)
	payload, err := json.Marshal(LoginOAuthState{
		Purpose:             "app_login",
		Provider:            string(provider),
		Platform:            platform,
		CodeChallenge:       codeChallenge,
		CodeChallengeMethod: codeChallengeMethod,
		CreatedAt:           time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		log.Printf("Failed to encode OAuth state payload: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to start authentication",
		})
		return
	}
	if err := h.redisClient.SetEx(ctx, key, payload, loginOAuthStateTTL).Err(); err != nil {
		log.Printf("Failed to store OAuth state in Redis: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to start authentication",
		})
		return
	}

	loginProvider, ok := h.providerRegistry.Get(provider)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Unsupported provider",
		})
		return
	}
	authURL := loginProvider.AuthCodeURL(state)

	log.Printf("Redirecting to OAuth provider (provider: %s, platform: %s)", provider, platform)

	if c.Query("response") == "json" {
		c.JSON(http.StatusOK, gin.H{
			"auth_url":           authURL,
			"state":              state,
			"expires_in_seconds": int(loginOAuthStateTTL.Seconds()),
		})
		return
	}

	c.Redirect(http.StatusFound, authURL)
}

// CancelOAuth invalidates a pending OAuth login state.
func (h *OAuthHandler) CancelOAuth(c *gin.Context) {
	var request struct {
		State string `json:"state" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"status": "error",
			"error":  "Missing or invalid state parameter",
		})
		return
	}

	key := fmt.Sprintf("oauth_state:%s", request.State)
	if err := h.redisClient.Del(c.Request.Context(), key).Err(); err != nil {
		log.Printf("Failed to cancel OAuth state: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"status": "error",
			"error":  "Failed to cancel authentication",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (h *OAuthHandler) consumeLoginOAuthState(ctx context.Context, state string) (*LoginOAuthState, error) {
	if state == "" {
		return nil, fmt.Errorf("missing state")
	}

	key := fmt.Sprintf("oauth_state:%s", state)
	res := h.redisClient.GetDel(ctx, key)
	if err := res.Err(); err != nil {
		if err == redis.Nil {
			return nil, fmt.Errorf("state missing or expired")
		}
		return nil, fmt.Errorf("failed to read state: %w", err)
	}

	var payload LoginOAuthState
	if err := json.Unmarshal([]byte(res.Val()), &payload); err != nil {
		return nil, fmt.Errorf("invalid state payload: %w", err)
	}
	if payload.Purpose != "app_login" {
		return nil, fmt.Errorf("invalid state purpose")
	}
	if _, ok := normalizeOAuthPlatform(payload.Platform); !ok {
		return nil, fmt.Errorf("invalid state platform")
	}
	if _, ok := normalizeLoginProvider(payload.Provider); !ok {
		return nil, fmt.Errorf("invalid state provider")
	}
	if payload.CodeChallenge != "" || payload.CodeChallengeMethod != "" {
		if !isValidPKCEValue(payload.CodeChallenge) {
			return nil, fmt.Errorf("invalid state code challenge")
		}
		if _, ok := normalizeCodeChallengeMethod(payload.CodeChallengeMethod); !ok {
			return nil, fmt.Errorf("invalid state code challenge method")
		}
	}

	return &payload, nil
}

// HandleCallback handles OAuth callback from Google
func (h *OAuthHandler) HandleCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	errorParam := c.Query("error")

	// Check for OAuth errors
	if errorParam != "" {
		errorDesc := c.Query("error_description")
		errorMsg := fmt.Sprintf("OAuth error: %s", errorParam)
		if errorDesc != "" {
			errorMsg += fmt.Sprintf(" (%s)", errorDesc)
		}

		log.Printf("OAuth provider returned error: %s", errorMsg)

		if statePayload, err := h.consumeLoginOAuthState(c.Request.Context(), state); err == nil {
			h.redirectToFrontendWithError(c, errorParam, errorDesc, statePayload.Platform, state)
		} else {
			h.redirectToFrontendWithError(c, errorParam, errorDesc, "", state)
		}
		return
	}

	// Validate parameters
	if code == "" || state == "" {
		errorMsg := "Missing authorization code or state parameter"
		log.Printf("OAuth callback error: %s", errorMsg)
		h.redirectToFrontendWithError(c, "invalid_request", errorMsg, "", state)
		return
	}

	statePayload, err := h.consumeLoginOAuthState(c.Request.Context(), state)
	if err != nil {
		log.Printf("OAuth callback rejected due to invalid state: %v", err)
		h.redirectToFrontendWithError(c, "invalid_state", "Authentication session is invalid or expired", "", state)
		return
	}
	callbackPlatform := statePayload.Platform
	provider, _ := normalizeLoginProvider(statePayload.Provider)

	loginProvider, ok := h.providerRegistry.Get(provider)
	if !ok {
		log.Printf("OAuth callback rejected due to unsupported provider in state: %s", provider)
		h.redirectToFrontendWithError(c, "unsupported_provider", "Authentication provider is not supported", callbackPlatform, state)
		return
	}

	exchangeCtx, cancelExchange := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancelExchange()
	profile, err := loginProvider.Exchange(exchangeCtx, code)
	if err != nil {
		log.Printf("Failed to exchange OAuth code with %s: %v", provider, err)
		h.redirectToFrontendWithError(c, "server_error", fmt.Sprintf("Failed to authenticate with %s", provider), callbackPlatform, state)
		return
	}
	// Resolve the database identity and synchronize Firebase before the database
	// transaction commits. A Firebase failure therefore leaves no new DB user or
	// provider identity behind.
	actualUserID, isNewUser, err := h.resolveOrCreateUserIdentity(c.Request.Context(), profile)
	if err != nil {
		log.Printf("Failed to create/update user: %v", err)
		switch {
		case errors.Is(err, repository.ErrIdentityConflict):
			h.redirectToFrontendWithError(c, "identity_conflict", "This provider identity is already associated with another account", callbackPlatform, state)
		case errors.Is(err, repository.ErrExternalPrincipalSync):
			h.redirectToFrontendWithError(c, "identity_conflict", "Failed to synchronize sign-in identity", callbackPlatform, state)
		case errors.Is(err, repository.ErrAccountInactive):
			h.redirectToFrontendWithError(c, "account_inactive", "This account is not active", callbackPlatform, state)
		default:
			h.redirectToFrontendWithError(c, "server_error", "Failed to create user account", callbackPlatform, state)
		}
		return
	}

	if cachedAvatarURL := h.cacheProfileAvatar(actualUserID, profile); cachedAvatarURL != "" {
		profile.AvatarURL = cachedAvatarURL
		avatarCtx, cancelAvatar := context.WithTimeout(c.Request.Context(), 5*time.Second)
		identity := h.buildAuthIdentity(actualUserID, profile)
		if err := h.authIdentityRepo.SetResolvedAvatar(avatarCtx, actualUserID, identity, cachedAvatarURL); err != nil {
			log.Printf("Failed to persist provider avatar: %v", err)
		}
		cancelAvatar()
	}
	user := oauthUserFromProfile(profile)

	// Create Firebase custom token using the actual user ID (handles account linking)
	firebaseToken, err := h.firebaseClient.CreateCustomToken(actualUserID, nil)
	if err != nil {
		log.Printf("Failed to create Firebase token: %v", err)
		h.redirectToFrontendWithError(c, "server_error", "Failed to create authentication token", callbackPlatform, state)
		return
	}

	// Update the user object with the actual ID for session storage
	user.ID = actualUserID

	oneTimeCode, err := h.codeManager.GenerateCode(c.Request.Context(), user, firebaseToken, string(provider), callbackPlatform, state, statePayload.CodeChallenge, statePayload.CodeChallengeMethod, isNewUser)
	if err != nil {
		log.Printf("Failed to create one-time auth code: %v", err)
		h.redirectToFrontendWithError(c, "server_error", "Failed to create authentication code", callbackPlatform, state)
		return
	}
	// User-facing side effects happen only after database provisioning, Firebase
	// synchronization, token minting, and one-time-code persistence all succeed.
	if isNewUser && h.emailSvc != nil {
		go func(email, name string) {
			if err := h.emailSvc.SendWelcome(email, name); err != nil {
				log.Printf("email: failed to send welcome message: %v", err)
			}
		}(user.Email, user.Name)
	}

	log.Printf("OAuth login completed successfully (provider: %s)", provider)

	redirectURL := buildCallbackURL(getFrontendCallbackURL(), map[string]string{
		"code":     oneTimeCode,
		"state":    state,
		"platform": callbackPlatform,
	})

	log.Printf("Redirecting to frontend auth callback (platform: %s)", callbackPlatform)
	c.Redirect(http.StatusFound, redirectURL)
}

// Helper method to redirect to frontend with error
func (h *OAuthHandler) redirectToFrontendWithError(c *gin.Context, error, errorDescription string, values ...string) {
	callbackPlatform := ""
	if len(values) > 0 {
		callbackPlatform = values[0]
	}
	state := ""
	if len(values) > 1 {
		state = values[1]
	}

	redirectURL := buildCallbackURL(getFrontendCallbackURL(), map[string]string{
		"error":             error,
		"error_description": errorDescription,
		"platform":          callbackPlatform,
		"state":             state,
	})

	log.Printf("Redirecting to auth callback with error")
	c.Redirect(http.StatusFound, redirectURL)
}

func getFrontendCallbackURL() string {
	frontendCallbackURL := os.Getenv("FRONTEND_CALLBACK_URL")
	if frontendCallbackURL == "" {
		return "http://localhost:3000/auth/callback"
	}
	return frontendCallbackURL
}

func buildCallbackURL(base string, values map[string]string) string {
	separator := "?"
	if strings.Contains(base, "?") {
		separator = "&"
	}

	query := url.Values{}
	for key, value := range values {
		if value != "" {
			query.Set(key, value)
		}
	}

	encoded := query.Encode()
	if encoded == "" {
		return base
	}
	return base + separator + encoded
}

func oauthUserFromProfile(profile *authproviders.NormalizedAuthProfile) *auth.OAuthUser {
	if profile == nil {
		return nil
	}
	return &auth.OAuthUser{
		ID:       profile.ProviderUserID,
		Email:    profile.Email,
		Name:     profile.DisplayName,
		Picture:  profile.AvatarURL,
		Provider: string(profile.Provider),
	}
}

func canAutoLinkOAuthProfileByEmail(profile *authproviders.NormalizedAuthProfile) bool {
	if profile == nil || !profile.EmailVerified {
		return false
	}

	switch profile.Provider {
	case models.AuthProviderGoogle:
		return true
	default:
		return false
	}
}

// CompleteAuth validates and consumes a one-time code
func (h *OAuthHandler) CompleteAuth(c *gin.Context) {
	// Rate limiting: 10 attempts per minute per IP (most critical endpoint)
	clientIP := c.ClientIP()
	limited, err := h.isRateLimited(c.Request.Context(), clientIP, "complete", 10, time.Minute)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": "auth_service_unavailable", "error": "Authentication service is unavailable"})
		return
	}
	if limited {
		c.JSON(http.StatusTooManyRequests, gin.H{
			"status": "error",
			"error":  "Too many requests. Please try again later.",
		})
		return
	}

	var request struct {
		Code         string `json:"code" binding:"required"`
		State        string `json:"state" binding:"required"`
		CodeVerifier string `json:"code_verifier"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"status": "error",
			"error":  "Missing or invalid code or state parameter",
		})
		return
	}

	expectedCodeChallenge := ""
	if isValidPKCEValue(request.CodeVerifier) {
		expectedCodeChallenge = codeChallengeFromVerifier(request.CodeVerifier)
	}

	// Validate and consume the one-time code. Redis only deletes it after state
	// and any stored verifier challenge both match.
	oneTimeCode, err := h.codeManager.ValidateAndConsumeCode(c.Request.Context(), request.Code, request.State, expectedCodeChallenge)
	if err != nil {
		log.Printf("❌ Invalid one-time code: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"status": "error",
			"error":  "Invalid or expired code",
		})
		return
	}

	log.Printf("One-time authentication code validated")

	// Return the user data and Firebase token
	c.JSON(http.StatusOK, gin.H{
		"status":        "success",
		"user":          oneTimeCode.User,
		"firebaseToken": oneTimeCode.FirebaseToken,
		"provider":      oneTimeCode.Provider,
		"platform":      oneTimeCode.Platform,
		"is_new_user":   oneTimeCode.IsNewUser,
	})
}

// LogoutAllDevices revokes all Firebase refresh tokens and closes active
// sockets. Ordinary logout is deliberately local to the current device.
func (h *OAuthHandler) LogoutAllDevices(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"status": "error",
			"error":  "User not authenticated",
		})
		return
	}

	// Revoke all refresh tokens for this user
	err = h.firebaseClient.RevokeRefreshTokens(userID)
	if err != nil {
		log.Printf("Failed to revoke refresh tokens: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"status": "error",
			"error":  "Failed to revoke refresh tokens",
		})
		return
	}
	if h.wsHub != nil {
		h.wsHub.DisconnectUser(userID, "session revoked")
	}

	log.Printf("All-device logout completed")
	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Logged out successfully from all devices",
	})
}

// resolveOrCreateUserIdentity resolves provider identity to an app-owned user ID.
func (h *OAuthHandler) resolveOrCreateUserIdentity(parent context.Context, profile *authproviders.NormalizedAuthProfile) (string, bool, error) {
	if profile == nil {
		return "", false, fmt.Errorf("auth profile is nil")
	}
	if profile.ProviderUserID == "" {
		return "", false, fmt.Errorf("user ID is empty - cannot create/update user")
	}
	if profile.Email == "" {
		return "", false, fmt.Errorf("user email is empty - cannot create/update user")
	}
	if profile.DisplayName == "" {
		return "", false, fmt.Errorf("user name is empty - cannot create/update user")
	}

	var avatarURL *string
	if profile.AvatarURL != "" {
		avatarURL = &profile.AvatarURL
	}
	identity := h.buildAuthIdentity("", profile)
	resolveCtx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	user, isNewUser, err := h.authIdentityRepo.ResolveOrCreateUser(
		resolveCtx, identity, profile.Email, profile.DisplayName, avatarURL,
		canAutoLinkOAuthProfileByEmail(profile),
		func(resolvedUser *models.User) error {
			photoURL := ""
			if resolvedUser.AvatarURL != nil {
				photoURL = *resolvedUser.AvatarURL
			}
			_, err := h.firebaseClient.CreateOrUpdateUser(
				resolveCtx, resolvedUser.ID, resolvedUser.Email, resolvedUser.Name, photoURL,
			)
			return err
		},
	)
	if err != nil {
		return "", false, err
	}
	profile.Email = user.Email
	profile.DisplayName = user.Name
	if user.AvatarURL != nil {
		profile.AvatarURL = *user.AvatarURL
	}
	return user.ID, isNewUser, nil
}

func (h *OAuthHandler) buildAuthIdentity(userID string, profile *authproviders.NormalizedAuthProfile) *models.UserAuthIdentity {
	providerEmail := profile.Email
	displayName := profile.DisplayName
	avatarURL := profile.AvatarURL

	identity := &models.UserAuthIdentity{
		UserID:           userID,
		Provider:         profile.Provider,
		ProviderTenantID: profile.ProviderTenantID,
		ProviderUserID:   profile.ProviderUserID,
		ProviderEmail:    &providerEmail,
		EmailVerified:    profile.EmailVerified,
		DisplayName:      &displayName,
		AvatarURL:        &avatarURL,
	}
	if avatarURL == "" {
		identity.AvatarURL = nil
	}

	return identity
}

func (h *OAuthHandler) cacheProfileAvatar(userID string, profile *authproviders.NormalizedAuthProfile) string {
	if h.avatarService == nil || profile == nil || len(profile.AvatarData) == 0 || profile.AvatarMimeType == "" {
		return ""
	}

	avatarURL, err := h.avatarService.UploadUserAvatar(userID, profile.AvatarData, profile.AvatarMimeType)
	if err != nil {
		log.Printf("auth: failed to cache provider avatar: %v", err)
		return ""
	}

	return avatarURL
}
