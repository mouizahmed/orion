package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/auth"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

type OAuthHandler struct {
	userRepo       *repository.UserRepository
	oauthTokenRepo repository.OAuthTokenRepository
	firebaseClient *auth.FirebaseClient
	codeManager    *auth.CodeManager
	redisClient    *redis.Client
	googleConfig   *oauth2.Config
}

type LoginOAuthState struct {
	Purpose   string `json:"purpose"`
	Platform  string `json:"platform"`
	IP        string `json:"ip"`
	UserAgent string `json:"user_agent"`
	CreatedAt string `json:"created_at"`
}

func NewOAuthHandler(userRepo *repository.UserRepository, oauthTokenRepo repository.OAuthTokenRepository, redisClient *redis.Client) *OAuthHandler {
	firebaseClient := auth.GetFirebaseClient()
	codeManager := auth.NewCodeManager(redisClient)

	// Google OAuth config - redirect to backend first
	googleConfig := &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		Endpoint:     google.Endpoint,
		Scopes:       []string{"openid", "email", "profile", "https://www.googleapis.com/auth/calendar.readonly"},
		RedirectURL:  os.Getenv("GOOGLE_REDIRECT_URL"), // e.g., http://localhost:8080/auth/callback
	}

	return &OAuthHandler{
		userRepo:       userRepo,
		oauthTokenRepo: oauthTokenRepo,
		firebaseClient: firebaseClient,
		codeManager:    codeManager,
		redisClient:    redisClient,
		googleConfig:   googleConfig,
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

	state, err := generateSecureState()
	if err != nil {
		log.Printf("Failed to generate OAuth state: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to start authentication",
		})
		return
	}

	provider := "google" // Only Google is supported
	log.Printf("Started OAuth login flow (provider: %s, platform: %s)", provider, platform)

	ctx := context.Background()
	key := fmt.Sprintf("oauth_state:%s", state)
	payload, err := json.Marshal(LoginOAuthState{
		Purpose:   "app_login",
		Platform:  platform,
		IP:        c.ClientIP(),
		UserAgent: c.GetHeader("User-Agent"),
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		log.Printf("Failed to encode OAuth state payload: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to start authentication",
		})
		return
	}
	if err := h.redisClient.SetEx(ctx, key, payload, 10*time.Minute).Err(); err != nil {
		log.Printf("Failed to store OAuth state in Redis: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to start authentication",
		})
		return
	}

	// Get OAuth URL with offline access for refresh tokens
	authURL := h.googleConfig.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.ApprovalForce,
		oauth2.SetAuthURLParam("include_granted_scopes", "true"))

	log.Printf("Redirecting to OAuth provider (provider: %s, platform: %s)", provider, platform)

	// Redirect to OAuth provider
	c.Redirect(http.StatusFound, authURL)
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

	return &payload, nil
}

// HandleCallback handles OAuth callback from Google
func (h *OAuthHandler) HandleCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	errorParam := c.Query("error")
	provider := "google" // Only Google is supported

	// Check for OAuth errors
	if errorParam != "" {
		errorDesc := c.Query("error_description")
		errorMsg := fmt.Sprintf("OAuth error: %s", errorParam)
		if errorDesc != "" {
			errorMsg += fmt.Sprintf(" (%s)", errorDesc)
		}

		log.Printf("OAuth provider returned error: %s", errorMsg)

		if statePayload, err := h.consumeLoginOAuthState(state); err == nil {
			h.redirectToFrontendWithError(c, errorParam, errorDesc, statePayload.Platform)
		} else {
			h.redirectToFrontendWithError(c, errorParam, errorDesc)
		}
		return
	}

	// Validate parameters
	if code == "" || state == "" {
		errorMsg := "Missing authorization code or state parameter"
		log.Printf("OAuth callback error: %s", errorMsg)
		h.redirectToFrontendWithError(c, "invalid_request", errorMsg)
		return
	}

	statePayload, err := h.consumeLoginOAuthState(state)
	if err != nil {
		log.Printf("OAuth callback rejected due to invalid state: %v", err)
		h.redirectToFrontendWithError(c, "invalid_state", "Authentication session is invalid or expired")
		return
	}
	callbackPlatform := statePayload.Platform

	// Exchange code for token and get user info from Google
	user, oauthToken, err := h.handleGoogleCallback(code)
	if err != nil {
		log.Printf("Failed to get user info from Google: %v", err)
		h.redirectToFrontendWithError(c, "server_error", fmt.Sprintf("Failed to authenticate with Google: %v", err), callbackPlatform)
		return
	}

	// Create or update user in database (returns actual user ID for Firebase)
	actualUserID, isNewUser, err := h.createOrUpdateUser(user)
	if err != nil {
		log.Printf("Failed to create/update user: %v", err)
		h.redirectToFrontendWithError(c, "server_error", "Failed to create user account", callbackPlatform)
		return
	}

	// Create Firebase custom token using the actual user ID (handles account linking)
	firebaseToken, err := h.firebaseClient.CreateCustomToken(actualUserID, nil)
	if err != nil {
		log.Printf("Failed to create Firebase token: %v", err)
		h.redirectToFrontendWithError(c, "server_error", "Failed to create authentication token", callbackPlatform)
		return
	}

	// Create or update user in Firebase Auth using the actual user ID
	_, err = h.firebaseClient.CreateOrUpdateUser(actualUserID, user.Email, user.Name, user.Picture)
	if err != nil {
		log.Printf("Failed to create/update Firebase user (continuing anyway): %v", err)
	}

	// Store OAuth tokens in database
	err = h.storeOAuthTokens(actualUserID, provider, oauthToken)
	if err != nil {
		log.Printf("Failed to store OAuth tokens (continuing anyway): %v", err)
	}

	// Update the user object with the actual ID for session storage
	user.ID = actualUserID

	oneTimeCode, err := h.codeManager.GenerateCode(user, firebaseToken, provider, callbackPlatform, isNewUser)
	if err != nil {
		log.Printf("Failed to create one-time auth code: %v", err)
		h.redirectToFrontendWithError(c, "server_error", "Failed to create authentication code", callbackPlatform)
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
func (h *OAuthHandler) redirectToFrontendWithError(c *gin.Context, error, errorDescription string, platform ...string) {
	callbackPlatform := ""
	if len(platform) > 0 {
		callbackPlatform = platform[0]
	}

	redirectURL := buildCallbackURL(getFrontendCallbackURL(), map[string]string{
		"error":             error,
		"error_description": errorDescription,
		"platform":          callbackPlatform,
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
		Code string `json:"code" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"status": "error",
			"error":  "Missing or invalid code parameter",
		})
		return
	}

	// Validate and consume the one-time code
	oneTimeCode, err := h.codeManager.ValidateAndConsumeCode(request.Code)
	if err != nil {
		log.Printf("❌ Invalid one-time code: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{
			"status": "error",
			"error":  "Invalid or expired code",
		})
		return
	}

	log.Printf("✅ One-time code validated successfully for user: %s (%s)", oneTimeCode.User.Name, oneTimeCode.User.Email)

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

// handleGoogleCallback exchanges code for token and gets user info from Google
func (h *OAuthHandler) handleGoogleCallback(code string) (*auth.OAuthUser, *oauth2.Token, error) {
	// Exchange authorization code for token
	token, err := h.googleConfig.Exchange(oauth2.NoContext, code)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to exchange authorization code: %w", err)
	}

	// Get user info from Google
	client := h.googleConfig.Client(oauth2.NoContext, token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get user info from Google: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read user info response: %w", err)
	}

	var googleUser struct {
		ID      string `json:"id"`
		Email   string `json:"email"`
		Name    string `json:"name"`
		Picture string `json:"picture"`
	}

	if err := json.Unmarshal(body, &googleUser); err != nil {
		return nil, nil, fmt.Errorf("failed to parse user info: %w", err)
	}

	user := &auth.OAuthUser{
		ID:       googleUser.ID,
		Email:    googleUser.Email,
		Name:     googleUser.Name,
		Picture:  googleUser.Picture,
		Provider: "google",
	}

	return user, token, nil
}

// createOrUpdateUser creates or updates user in the database, returns the actual user ID to use for Firebase
func (h *OAuthHandler) createOrUpdateUser(oauthUser *auth.OAuthUser) (string, bool, error) {
	// Validate required fields before creating/updating
	if oauthUser.ID == "" {
		return "", false, fmt.Errorf("user ID is empty - cannot create/update user")
	}
	if oauthUser.Email == "" {
		return "", false, fmt.Errorf("user email is empty - cannot create/update user")
	}
	if oauthUser.Name == "" {
		return "", false, fmt.Errorf("user name is empty - cannot create/update user")
	}

	log.Printf("👤 Creating/updating user: ID=%s, Email=%s, Name=%s", oauthUser.ID, oauthUser.Email, oauthUser.Name)

	// First check if a user exists with this email (account linking)
	existingUserByEmail, err := h.userRepo.GetUserByEmail(oauthUser.Email)
	if err != nil && err.Error() != "user not found" {
		return "", false, fmt.Errorf("failed to check existing user by email: %w", err)
	}

	// Then check if user exists with this OAuth ID
	existingUserByID, err := h.userRepo.GetUserByID(oauthUser.ID)
	if err != nil && err.Error() != "user not found" {
		return "", false, fmt.Errorf("failed to check existing user by ID: %w", err)
	}

	// Determine which user account to use
	var existingUser *models.User
	if existingUserByEmail != nil {
		// Account linking: user exists with this email but different OAuth provider
		log.Printf("🔗 Account linking detected: Email %s exists with ID %s, linking new OAuth ID %s",
			oauthUser.Email, existingUserByEmail.ID, oauthUser.ID)
		existingUser = existingUserByEmail
	} else if existingUserByID != nil {
		// Normal case: same OAuth provider login
		existingUser = existingUserByID
	}

	if existingUser != nil {
		// Update existing user with latest info from OAuth provider
		avatarURL := existingUser.AvatarURL
		if oauthUser.Picture != "" {
			avatarURL = &oauthUser.Picture
		}

		user := &models.User{
			ID:        existingUser.ID, // Keep the original account ID
			Email:     oauthUser.Email,
			Name:      oauthUser.Name,
			AvatarURL: avatarURL,
			Plan:      existingUser.Plan,   // Preserve existing plan
			Status:    existingUser.Status, // Preserve existing status
			UpdatedAt: time.Now(),
		}

		log.Printf("📝 Updating existing user %s with new OAuth data", existingUser.ID)
		err := h.userRepo.UpdateUser(existingUser.ID, user)
		if err != nil {
			return "", false, err
		}
		return existingUser.ID, false, nil // Return the linked account's ID
	} else {
		// Create new user
		var avatarURL *string
		if oauthUser.Picture != "" {
			avatarURL = &oauthUser.Picture
		}

		user := &models.User{
			ID:        oauthUser.ID,
			Email:     oauthUser.Email,
			Name:      oauthUser.Name,
			AvatarURL: avatarURL,
			Plan:      models.UserPlanFree,
			Status:    models.UserStatusActive,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		log.Printf("✨ Creating new user account for %s", oauthUser.Email)
		err := h.userRepo.CreateUser(user)
		if err != nil {
			return "", false, err
		}
		return oauthUser.ID, true, nil // Return the new account's ID
	}
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
        <p>Welcome %s!<br>Authentication completed successfully.<br>You can now close this browser and return to Orionly.</p>
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

// storeOAuthTokens stores OAuth tokens in the database
func (h *OAuthHandler) storeOAuthTokens(userID, provider string, token *oauth2.Token) error {
	if token == nil {
		return fmt.Errorf("token is nil")
	}

	// Convert scopes array to comma-separated string
	var scopesStr *string
	if provider == "google" && len(h.googleConfig.Scopes) > 0 {
		scopes := strings.Join(h.googleConfig.Scopes, ",")
		scopesStr = &scopes
	}

	// Prepare OAuth token model
	oauthToken := &models.OAuthToken{
		UserID:      userID,
		Provider:    provider,
		AccessToken: token.AccessToken,
		Scopes:      scopesStr,
	}

	// Add refresh token if present
	if token.RefreshToken != "" {
		oauthToken.RefreshToken = &token.RefreshToken
	}

	// Add expiry if present and valid
	if !token.Expiry.IsZero() {
		oauthToken.ExpiresAt = &token.Expiry
	}

	// Store in database (upsert operation)
	err := h.oauthTokenRepo.Create(oauthToken)
	if err != nil {
		return fmt.Errorf("failed to store OAuth token: %w", err)
	}

	log.Printf("🔐 Stored OAuth tokens for user %s (provider: %s)", userID, provider)
	return nil
}
