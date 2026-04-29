package handlers

import (
	"context"
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

func NewOAuthHandler(userRepo *repository.UserRepository, oauthTokenRepo repository.OAuthTokenRepository, redisClient *redis.Client) *OAuthHandler {
	firebaseClient := auth.GetFirebaseClient()
	codeManager := auth.NewCodeManager(redisClient)

	// Google OAuth config - redirect to backend first
	googleConfig := &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		Endpoint:     google.Endpoint,
		Scopes:       []string{"openid", "email", "profile"},
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

// isRateLimited checks if the request should be rate limited
func (h *OAuthHandler) isRateLimited(ip, endpoint string, limit int, window time.Duration) bool {
	ctx := context.Background()
	key := fmt.Sprintf("rate_limit:%s:%s", ip, endpoint)

	// Get current count
	count, err := h.redisClient.Get(ctx, key).Int()
	if err != nil && err != redis.Nil {
		return false // Allow on Redis error to avoid blocking legitimate users
	}

	if count >= limit {
		return true // Rate limited
	}

	// Increment counter
	h.redisClient.Incr(ctx, key)
	h.redisClient.Expire(ctx, key, window)

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

	state := c.Query("state")
	platform := c.Query("platform")

	// Validate parameters
	if state == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Missing required parameter: state is required",
		})
		return
	}

	provider := "google" // Only Google is supported
	log.Printf("🚀 Started OAuth flow: %s (provider: %s, platform: %s)", state, provider, platform)

	// Store platform metadata in Redis for callback routing (NOT for state validation)
	// State validation is done client-side; this is just for determining callback URL
	// Key: oauth_state:{state} → JSON { platform, ip, created_at }
	{
		ctx := context.Background()
		key := fmt.Sprintf("oauth_state:%s", state)
		payload, _ := json.Marshal(map[string]any{
			"platform":   platform,
			"ip":         c.ClientIP(),
			"created_at": time.Now().UTC().Format(time.RFC3339Nano),
		})
		if err := h.redisClient.SetEx(ctx, key, payload, 10*time.Minute).Err(); err != nil {
			// Non-fatal: log and proceed to avoid blocking auth on transient Redis issues
			log.Printf("⚠️ Failed to store platform metadata in Redis: %v", err)
		}
	}

	// Get OAuth URL with offline access for refresh tokens
	authURL := h.googleConfig.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.ApprovalForce,
		oauth2.SetAuthURLParam("include_granted_scopes", "true"))

	log.Printf("🌐 Redirecting to OAuth provider: %s", authURL)

	// Redirect to OAuth provider
	c.Redirect(http.StatusFound, authURL)
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

		log.Printf("❌ OAuth error: %s", errorMsg)

		// Redirect to frontend with error parameters
		h.redirectToFrontendWithError(c, errorParam, errorDesc)
		return
	}

	// Validate parameters
	if code == "" || state == "" {
		errorMsg := "Missing authorization code or state parameter"
		log.Printf("❌ OAuth callback error: %s", errorMsg)
		h.redirectToFrontendWithError(c, "invalid_request", errorMsg)
		return
	}

	// Retrieve platform from Redis (for routing to correct callback URL)
	// Note: State validation is done client-side (desktop app), not here
	// We only use Redis to determine the callback platform (desktop vs web)
	var callbackPlatform string
	{
		ctx := context.Background()
		key := fmt.Sprintf("oauth_state:%s", state)
		res := h.redisClient.GetDel(ctx, key)
		if err := res.Err(); err == nil && res.Val() != "" {
			var meta struct {
				Platform string `json:"platform"`
			}
			if err := json.Unmarshal([]byte(res.Val()), &meta); err == nil {
				callbackPlatform = meta.Platform
			}
		} else {
			// Redis lookup failed or expired - default to desktop
			callbackPlatform = "desktop"
		}
	}

	// Exchange code for token and get user info from Google
	user, oauthToken, err := h.handleGoogleCallback(code)
	if err != nil {
		log.Printf("❌ Failed to get user info from Google: %v", err)
		h.redirectToFrontendWithError(c, "server_error", fmt.Sprintf("Failed to authenticate with Google: %v", err), callbackPlatform)
		return
	}

	// Create or update user in database (returns actual user ID for Firebase)
	actualUserID, err := h.createOrUpdateUser(user)
	if err != nil {
		log.Printf("❌ Failed to create/update user: %v", err)
		h.redirectToFrontendWithError(c, "server_error", "Failed to create user account", callbackPlatform)
		return
	}

	// Create Firebase custom token using the actual user ID (handles account linking)
	firebaseToken, err := h.firebaseClient.CreateCustomToken(actualUserID, nil)
	if err != nil {
		log.Printf("❌ Failed to create Firebase token: %v", err)
		h.redirectToFrontendWithError(c, "server_error", "Failed to create authentication token", callbackPlatform)
		return
	}

	// Create or update user in Firebase Auth using the actual user ID
	_, err = h.firebaseClient.CreateOrUpdateUser(actualUserID, user.Email, user.Name, user.Picture)
	if err != nil {
		log.Printf("⚠️ Failed to create/update Firebase user (continuing anyway): %v", err)
	}

	// Store OAuth tokens in database
	err = h.storeOAuthTokens(actualUserID, provider, oauthToken)
	if err != nil {
		log.Printf("⚠️ Failed to store OAuth tokens (continuing anyway): %v", err)
	}

	// Update the user object with the actual ID for session storage
	user.ID = actualUserID

	// Generate one-time code using platform derived from state (default to desktop)
	if callbackPlatform == "" {
		callbackPlatform = "desktop"
	}
	oneTimeCode := h.codeManager.GenerateCode(user, firebaseToken, provider, callbackPlatform)

	log.Printf("✅ OAuth completed successfully for user: %s (%s)", user.Name, user.Email)
	log.Printf("🔑 Generated one-time code: %s", oneTimeCode)

	// Determine callback URL based on platform
	// For desktop platform, redirect to frontend which will then open the desktop app
	// The desktop app will then call the /complete endpoint
	var frontendCallbackURL string
	frontendCallbackURL = os.Getenv("FRONTEND_CALLBACK_URL")
	if frontendCallbackURL == "" {
		frontendCallbackURL = "http://localhost:3000/auth/callback"
	}

	// Add one-time code and state to URL
	redirectURL := fmt.Sprintf("%s?code=%s&state=%s", frontendCallbackURL, url.QueryEscape(oneTimeCode), url.QueryEscape(state))

	log.Printf("🔗 Redirecting to frontend with one-time code: %s", redirectURL)
	c.Redirect(http.StatusFound, redirectURL)
}

// Helper method to redirect to frontend with error
// Always redirects to the frontend HTTP callback URL, regardless of platform
// The frontend will handle opening desktop app if needed
func (h *OAuthHandler) redirectToFrontendWithError(c *gin.Context, error, errorDescription string, platform ...string) {
	// Always redirect to frontend HTTP callback URL
	// The frontend page will handle opening the desktop app if platform is "desktop"
	frontendCallbackURL := os.Getenv("FRONTEND_CALLBACK_URL")
	if frontendCallbackURL == "" {
		frontendCallbackURL = "http://localhost:3000/auth/callback"
	}

	redirectURL := fmt.Sprintf("%s?error=%s", frontendCallbackURL, url.QueryEscape(error))
	if errorDescription != "" {
		redirectURL += fmt.Sprintf("&error_description=%s", url.QueryEscape(errorDescription))
	}

	log.Printf("🔗 Redirecting to frontend with error: %s", redirectURL)
	c.Redirect(http.StatusFound, redirectURL)
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
func (h *OAuthHandler) createOrUpdateUser(oauthUser *auth.OAuthUser) (string, error) {
	// Validate required fields before creating/updating
	if oauthUser.ID == "" {
		return "", fmt.Errorf("user ID is empty - cannot create/update user")
	}
	if oauthUser.Email == "" {
		return "", fmt.Errorf("user email is empty - cannot create/update user")
	}
	if oauthUser.Name == "" {
		return "", fmt.Errorf("user name is empty - cannot create/update user")
	}

	log.Printf("👤 Creating/updating user: ID=%s, Email=%s, Name=%s", oauthUser.ID, oauthUser.Email, oauthUser.Name)

	// First check if a user exists with this email (account linking)
	existingUserByEmail, err := h.userRepo.GetUserByEmail(oauthUser.Email)
	if err != nil && err.Error() != "user not found" {
		return "", fmt.Errorf("failed to check existing user by email: %w", err)
	}

	// Then check if user exists with this OAuth ID
	existingUserByID, err := h.userRepo.GetUserByID(oauthUser.ID)
	if err != nil && err.Error() != "user not found" {
		return "", fmt.Errorf("failed to check existing user by ID: %w", err)
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
			return "", err
		}
		return existingUser.ID, nil // Return the linked account's ID
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
			return "", err
		}
		return oauthUser.ID, nil // Return the new account's ID
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
