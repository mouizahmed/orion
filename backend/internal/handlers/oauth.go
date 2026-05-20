package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
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
	userRepo         *repository.UserRepository
	authIdentityRepo *repository.UserAuthIdentityRepository
	firebaseClient   *auth.FirebaseClient
	codeManager      *auth.CodeManager
	redisClient      *redis.Client
	providerRegistry *authproviders.Registry
	avatarService    *profile.AvatarService
	emailSvc         *email.Service
}

type LoginOAuthState struct {
	Purpose             string `json:"purpose"`
	Provider            string `json:"provider"`
	Platform            string `json:"platform"`
	CodeChallenge       string `json:"code_challenge,omitempty"`
	CodeChallengeMethod string `json:"code_challenge_method,omitempty"`
	IP                  string `json:"ip"`
	UserAgent           string `json:"user_agent"`
	CreatedAt           string `json:"created_at"`
}

const loginOAuthStateTTL = 10 * time.Minute

func NewOAuthHandler(userRepo *repository.UserRepository, authIdentityRepo *repository.UserAuthIdentityRepository, redisClient *redis.Client, avatarService *profile.AvatarService, emailSvc *email.Service) *OAuthHandler {
	firebaseClient := auth.GetFirebaseClient()
	codeManager := auth.NewCodeManager(redisClient)

	return &OAuthHandler{
		userRepo:         userRepo,
		authIdentityRepo: authIdentityRepo,
		firebaseClient:   firebaseClient,
		codeManager:      codeManager,
		redisClient:      redisClient,
		providerRegistry: authproviders.NewDefaultRegistry(),
		avatarService:    avatarService,
		emailSvc:         emailSvc,
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
func (h *OAuthHandler) isRateLimited(ip, endpoint string, limit int, window time.Duration) bool {
	ctx := context.Background()
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
		return false // Allow on Redis error to avoid blocking legitimate users
	}

	if count > limit {
		return true // Rate limited
	}

	return false
}

// StartOAuth initiates the OAuth flow
func (h *OAuthHandler) StartOAuth(c *gin.Context) {
	// Rate limiting: 5 attempts per minute per IP
	clientIP := c.ClientIP()
	if h.isRateLimited(clientIP, "start", 5, time.Minute) {
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

	ctx := context.Background()
	key := fmt.Sprintf("oauth_state:%s", state)
	payload, err := json.Marshal(LoginOAuthState{
		Purpose:             "app_login",
		Provider:            string(provider),
		Platform:            platform,
		CodeChallenge:       codeChallenge,
		CodeChallengeMethod: codeChallengeMethod,
		IP:                  c.ClientIP(),
		UserAgent:           c.GetHeader("User-Agent"),
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
	if err := h.redisClient.Del(context.Background(), key).Err(); err != nil {
		log.Printf("Failed to cancel OAuth state: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"status": "error",
			"error":  "Failed to cancel authentication",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (h *OAuthHandler) consumeLoginOAuthState(state string) (*LoginOAuthState, error) {
	if state == "" {
		return nil, fmt.Errorf("missing state")
	}

	ctx := context.Background()
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

		if statePayload, err := h.consumeLoginOAuthState(state); err == nil {
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

	statePayload, err := h.consumeLoginOAuthState(state)
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

	profile, err := loginProvider.Exchange(code)
	if err != nil {
		log.Printf("Failed to exchange OAuth code with %s: %v", provider, err)
		h.redirectToFrontendWithError(c, "server_error", fmt.Sprintf("Failed to authenticate with %s", provider), callbackPlatform, state)
		return
	}
	// Create or update user in database (returns actual user ID for Firebase)
	actualUserID, isNewUser, err := h.resolveOrCreateUserIdentity(profile)
	if err != nil {
		log.Printf("Failed to create/update user: %v", err)
		h.redirectToFrontendWithError(c, "server_error", "Failed to create user account", callbackPlatform, state)
		return
	}
	user := oauthUserFromProfile(profile)

	// Create Firebase custom token using the actual user ID (handles account linking)
	firebaseToken, err := h.firebaseClient.CreateCustomToken(actualUserID, nil)
	if err != nil {
		log.Printf("Failed to create Firebase token: %v", err)
		h.redirectToFrontendWithError(c, "server_error", "Failed to create authentication token", callbackPlatform, state)
		return
	}

	// Create or update user in Firebase Auth using the actual user ID
	_, err = h.firebaseClient.CreateOrUpdateUser(actualUserID, user.Email, user.Name, user.Picture)
	if err != nil {
		log.Printf("Failed to create/update Firebase user (continuing anyway): %v", err)
	}

	// Update the user object with the actual ID for session storage
	user.ID = actualUserID

	oneTimeCode, err := h.codeManager.GenerateCode(user, firebaseToken, string(provider), callbackPlatform, state, statePayload.CodeChallenge, statePayload.CodeChallengeMethod, isNewUser)
	if err != nil {
		log.Printf("Failed to create one-time auth code: %v", err)
		h.redirectToFrontendWithError(c, "server_error", "Failed to create authentication code", callbackPlatform, state)
		return
	}

	log.Printf("OAuth completed successfully for user: %s (%s)", user.Name, user.Email)

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
		ID:           profile.ProviderUserID,
		Email:        profile.Email,
		Name:         profile.DisplayName,
		Picture:      profile.AvatarURL,
		Provider:     string(profile.Provider),
		ProviderData: profile.RawClaims,
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
	if h.isRateLimited(clientIP, "complete", 10, time.Minute) {
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
	oneTimeCode, err := h.codeManager.ValidateAndConsumeCode(request.Code, request.State, expectedCodeChallenge)
	if err != nil {
		log.Printf("❌ Invalid one-time code: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"status": "error",
			"error":  "Invalid or expired code",
		})
		return
	}

	log.Printf("One-time code validated successfully for user: %s (%s)", oneTimeCode.User.Name, oneTimeCode.User.Email)

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

// Logout revokes all refresh tokens for the authenticated user
func (h *OAuthHandler) Logout(c *gin.Context) {
	// Get user ID from context (set by FirebaseAuthMiddleware)
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"status": "error",
			"error":  "User not authenticated",
		})
		return
	}

	userIDStr, ok := userID.(string)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{
			"status": "error",
			"error":  "Invalid user ID format",
		})
		return
	}

	// Revoke all refresh tokens for this user
	err := h.firebaseClient.RevokeRefreshTokens(userIDStr)
	if err != nil {
		log.Printf("❌ Failed to revoke refresh tokens for user %s: %v", userIDStr, err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"status": "error",
			"error":  "Failed to revoke refresh tokens",
		})
		return
	}

	log.Printf("✅ Successfully revoked refresh tokens for user: %s", userIDStr)
	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Logged out successfully from all devices",
	})
}

// resolveOrCreateUserIdentity resolves provider identity to an app-owned user ID.
func (h *OAuthHandler) resolveOrCreateUserIdentity(profile *authproviders.NormalizedAuthProfile) (string, bool, error) {
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

	log.Printf("Resolving OAuth identity: provider=%s, provider_user_id=%s, email=%s, email_verified=%t", profile.Provider, profile.ProviderUserID, profile.Email, profile.EmailVerified)

	var existingUser *models.User
	identity, err := h.authIdentityRepo.GetByProviderSubject(profile.Provider, profile.ProviderUserID)
	if err != nil {
		return "", false, err
	}
	if identity != nil {
		existingUser, err = h.userRepo.GetUserByID(identity.UserID)
		if err != nil {
			return "", false, fmt.Errorf("failed to load user for auth identity: %w", err)
		}
	}

	if existingUser == nil {
		existingUserByEmail, err := h.userRepo.GetUserByEmail(profile.Email)
		if err != nil && err.Error() != "user not found" {
			return "", false, fmt.Errorf("failed to check existing user by email: %w", err)
		}
		if existingUserByEmail != nil {
			if !canAutoLinkOAuthProfileByEmail(profile) {
				return "", false, fmt.Errorf("account with email already exists; sign in first to link %s", profile.Provider)
			}
			log.Printf("Linking OAuth identity by email: provider=%s, email=%s, user_id=%s", profile.Provider, profile.Email, existingUserByEmail.ID)
			existingUser = existingUserByEmail
		}
	}

	if existingUser != nil {
		name := existingUser.Name
		if name == "" {
			name = profile.DisplayName
		}

		avatarURL := existingUser.AvatarURL
		if (avatarURL == nil || *avatarURL == "") && len(profile.AvatarData) > 0 {
			if cachedAvatarURL := h.cacheProfileAvatar(existingUser.ID, profile); cachedAvatarURL != "" {
				profile.AvatarURL = cachedAvatarURL
				avatarURL = &profile.AvatarURL
			}
		} else if profile.AvatarURL != "" {
			avatarURL = &profile.AvatarURL
		}
		if avatarURL != nil {
			profile.AvatarURL = *avatarURL
		}

		user := &models.User{
			ID:        existingUser.ID,
			Email:     existingUser.Email,
			Name:      name,
			AvatarURL: avatarURL,
			Plan:      existingUser.Plan,
			Status:    existingUser.Status,
			UpdatedAt: time.Now(),
		}
		if profile.EmailVerified {
			user.Email = profile.Email
		}

		log.Printf("Updating existing user %s with OAuth profile data", existingUser.ID)
		if err := h.userRepo.UpdateUser(existingUser.ID, user); err != nil {
			return "", false, err
		}
		if err := h.upsertAuthIdentityForUserProvider(existingUser.ID, profile); err != nil {
			return "", false, err
		}
		if !profile.EmailVerified {
			profile.Email = user.Email
		}
		return existingUser.ID, false, nil
	}

	var avatarURL *string
	if profile.AvatarURL != "" {
		avatarURL = &profile.AvatarURL
	}

	user := &models.User{
		Email:     profile.Email,
		Name:      profile.DisplayName,
		AvatarURL: avatarURL,
		Plan:      models.UserPlanFree,
		Status:    models.UserStatusActive,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	log.Printf("Creating new app user account for %s", profile.Email)
	if err := h.userRepo.CreateUser(user); err != nil {
		return "", false, err
	}
	go func() {
		if err := h.emailSvc.SendWelcome(user.Email, user.Name); err != nil {
			log.Printf("email: welcome to %s: %v", user.Email, err)
		}
	}()
	if cachedAvatarURL := h.cacheProfileAvatar(user.ID, profile); cachedAvatarURL != "" {
		profile.AvatarURL = cachedAvatarURL
		user.AvatarURL = &profile.AvatarURL
		if err := h.userRepo.UpdateUser(user.ID, user); err != nil {
			log.Printf("Failed to update cached provider avatar for user %s: %v", user.ID, err)
		}
	}
	if err := h.upsertAuthIdentity(user.ID, profile); err != nil {
		return "", false, err
	}
	return user.ID, true, nil
}

func (h *OAuthHandler) upsertAuthIdentity(userID string, profile *authproviders.NormalizedAuthProfile) error {
	return h.authIdentityRepo.Upsert(h.buildAuthIdentity(userID, profile))
}

func (h *OAuthHandler) upsertAuthIdentityForUserProvider(userID string, profile *authproviders.NormalizedAuthProfile) error {
	return h.authIdentityRepo.UpsertForUserProvider(h.buildAuthIdentity(userID, profile))
}

func (h *OAuthHandler) buildAuthIdentity(userID string, profile *authproviders.NormalizedAuthProfile) *models.UserAuthIdentity {
	providerEmail := profile.Email
	displayName := profile.DisplayName
	avatarURL := profile.AvatarURL

	rawClaims, _ := json.Marshal(profile.RawClaims)

	identity := &models.UserAuthIdentity{
		UserID:         userID,
		Provider:       profile.Provider,
		ProviderUserID: profile.ProviderUserID,
		ProviderEmail:  &providerEmail,
		EmailVerified:  profile.EmailVerified,
		DisplayName:    &displayName,
		AvatarURL:      &avatarURL,
		RawClaims:      rawClaims,
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

// renderSuccessPage renders a success page after OAuth completion
func (h *OAuthHandler) renderSuccessPage(c *gin.Context, userName string) {
	html := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <title>Authentication Complete</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            text-align: center; 
            padding: 60px 20px; 
            background: linear-gradient(135deg, #667eea 0%%, #764ba2 100%%);
            color: white;
            margin: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
        }
        .container { max-width: 400px; }
        h1 { font-size: 2.5em; margin-bottom: 20px; }
        p { font-size: 1.2em; margin-bottom: 30px; opacity: 0.9; }
        .close-btn { 
            background: rgba(255,255,255,0.2); 
            border: 2px solid rgba(255,255,255,0.3);
            color: white; 
            padding: 12px 24px; 
            border-radius: 25px; 
            cursor: pointer;
            font-size: 16px;
            transition: all 0.3s ease;
        }
        .close-btn:hover { background: rgba(255,255,255,0.3); }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎉 Success!</h1>
        <p>Welcome %s!<br>Authentication completed successfully.<br>You can now close this browser and return to Orion.</p>
        <button class="close-btn" onclick="window.close()">Close Browser</button>
    </div>
    <script>
        setTimeout(() => window.close(), 3000);
    </script>
</body>
</html>`, html.EscapeString(userName))

	c.Header("Content-Type", "text/html")
	c.String(http.StatusOK, html)
}

// renderErrorPage renders an error page
func (h *OAuthHandler) renderErrorPage(c *gin.Context, title, message string) {
	html := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <title>Authentication Error</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            text-align: center;
            padding: 60px 20px;
            background: linear-gradient(135deg, #ff6b6b 0%%, #ee5a24 100%%);
            color: white;
            margin: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
        }
        .container { max-width: 400px; }
        h1 { font-size: 2.5em; margin-bottom: 20px; }
        p { font-size: 1.2em; margin-bottom: 30px; opacity: 0.9; }
        .close-btn {
            background: rgba(255,255,255,0.2);
            border: 2px solid rgba(255,255,255,0.3);
            color: white;
            padding: 12px 24px;
            border-radius: 25px;
            cursor: pointer;
            font-size: 16px;
            transition: all 0.3s ease;
        }
        .close-btn:hover { background: rgba(255,255,255,0.3); }
    </style>
</head>
<body>
    <div class="container">
        <h1>❌ %s</h1>
        <p>%s<br>Please try again or contact support.</p>
        <button class="close-btn" onclick="window.close()">Close Browser</button>
    </div>
</body>
</html>`, html.EscapeString(title), html.EscapeString(message))

	c.Header("Content-Type", "text/html")
	c.String(http.StatusOK, html)
}
