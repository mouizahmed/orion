package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/integrationworker"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"
)

const integrationOAuthStatePrefix = "integration_oauth_state"

func generateSecureState() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func validIntegrationOAuthState(state string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(state)
	return err == nil && len(state) == 43 && len(decoded) == 32
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

func buildCallbackURL(rawURL string, values map[string]string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	query := parsed.Query()
	for key, value := range values {
		if value != "" {
			query.Set(key, value)
		}
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

type IntegrationOAuthHandler struct {
	connectionRepo  repository.IntegrationConnectionRepository
	redisClient     *redis.Client
	googleConfig    *oauth2.Config
	microsoftConfig *oauth2.Config
	events          resourceevents.Publisher
	jobRepository   *repository.IntegrationControlPlaneRepository
	subscriptions   calendarSubscriptionLifecycle
}

type calendarSubscriptionLifecycle interface {
	PrepareConnectionCleanup(context.Context, *models.IntegrationConnection) (func(context.Context) error, error)
}

type IntegrationOAuthState struct {
	Purpose   string `json:"purpose"`
	UserID    string `json:"user_id"`
	Provider  string `json:"provider"`
	Feature   string `json:"feature"`
	Platform  string `json:"platform"`
	CreatedAt string `json:"created_at"`
}

type startIntegrationConnectionRequest struct {
	Provider string `json:"provider" binding:"required"`
	Feature  string `json:"feature" binding:"required"`
	Platform string `json:"platform"`
}

type integrationConnectionResponse struct {
	ID            string                             `json:"id"`
	Provider      models.IntegrationProvider         `json:"provider"`
	ProviderEmail *string                            `json:"provider_email,omitempty"`
	DisplayName   *string                            `json:"display_name,omitempty"`
	Status        models.IntegrationConnectionStatus `json:"status"`
	ConnectedAt   time.Time                          `json:"connected_at"`
}

func NewIntegrationOAuthHandler(connectionRepo repository.IntegrationConnectionRepository, redisClient *redis.Client, events resourceevents.Publisher, jobRepository *repository.IntegrationControlPlaneRepository, subscriptions calendarSubscriptionLifecycle) *IntegrationOAuthHandler {
	return &IntegrationOAuthHandler{
		connectionRepo: connectionRepo,
		redisClient:    redisClient,
		events:         events,
		jobRepository:  jobRepository,
		subscriptions:  subscriptions,
		googleConfig: &oauth2.Config{
			ClientID:     os.Getenv("GOOGLE_INTEGRATION_CLIENT_ID"),
			ClientSecret: os.Getenv("GOOGLE_INTEGRATION_CLIENT_SECRET"),
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://accounts.google.com/o/oauth2/v2/auth",
				TokenURL: "https://oauth2.googleapis.com/token",
			},
			Scopes:      googleIntegrationScopes("calendar"),
			RedirectURL: getIntegrationRedirectURL(string(models.IntegrationProviderGoogle)),
		},
		microsoftConfig: &oauth2.Config{
			ClientID:     os.Getenv("MICROSOFT_INTEGRATION_CLIENT_ID"),
			ClientSecret: os.Getenv("MICROSOFT_INTEGRATION_CLIENT_SECRET"),
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
				TokenURL: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
			},
			Scopes:      microsoftIntegrationScopes("calendar"),
			RedirectURL: getIntegrationRedirectURL(string(models.IntegrationProviderMicrosoft)),
		},
	}
}

func (h *IntegrationOAuthHandler) StartConnection(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"status": "error", "error": err.Error()})
		return
	}

	var request startIntegrationConnectionRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "error": "Invalid connection request"})
		return
	}

	provider := strings.ToLower(strings.TrimSpace(request.Provider))
	feature := strings.ToLower(strings.TrimSpace(request.Feature))
	platform, ok := normalizeOAuthPlatform(request.Platform)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "error": "Unsupported platform"})
		return
	}
	if provider != string(models.IntegrationProviderGoogle) && provider != string(models.IntegrationProviderMicrosoft) {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "error": "Unsupported provider"})
		return
	}

	requiredScopes, err := integrationScopes(provider, feature)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "error": err.Error()})
		return
	}

	state, err := generateSecureState()
	if err != nil {
		log.Printf("Failed to generate integration OAuth state: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Failed to start connection"})
		return
	}

	payload, err := json.Marshal(IntegrationOAuthState{
		Purpose:   "integration_connect",
		UserID:    userID,
		Provider:  provider,
		Feature:   feature,
		Platform:  platform,
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		log.Printf("Failed to encode integration OAuth state: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Failed to start connection"})
		return
	}

	key := fmt.Sprintf("%s:%s", integrationOAuthStatePrefix, state)
	if err := h.redisClient.SetEx(c.Request.Context(), key, payload, 10*time.Minute).Err(); err != nil {
		log.Printf("Failed to store integration OAuth state in Redis: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Failed to start connection"})
		return
	}

	config := h.oauthConfigForProviderAndScopes(provider, requiredScopes)
	authURL := integrationAuthCodeURL(provider, config, state)

	log.Printf("Started integration OAuth flow (provider: %s, feature: %s, platform: %s)", provider, feature, platform)
	c.JSON(http.StatusOK, gin.H{
		"status":   "success",
		"auth_url": authURL,
	})
}

func (h *IntegrationOAuthHandler) HandleCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	errorParam := c.Query("error")
	errorDescription := c.Query("error_description")
	query := c.Request.URL.Query()
	if len(query["code"]) > 1 || len(query["state"]) > 1 || len(query["error"]) > 1 || len(query["error_description"]) > 1 ||
		len(code) > 4096 || len(state) > 128 || len(errorParam) > 128 || len(errorDescription) > 512 {
		h.redirectIntegrationCallback(c, false, "", "", "desktop", "invalid_request", "Invalid authorization response")
		return
	}

	if errorParam != "" {
		if statePayload, err := h.consumeIntegrationOAuthState(c.Request.Context(), state); err == nil {
			h.redirectIntegrationCallback(c, false, statePayload.Provider, statePayload.Feature, statePayload.Platform, errorParam, errorDescription)
		} else {
			h.redirectIntegrationCallback(c, false, "", "", "desktop", errorParam, errorDescription)
		}
		return
	}

	if code == "" || state == "" {
		h.redirectIntegrationCallback(c, false, "", "", "desktop", "invalid_request", "Missing authorization code or state")
		return
	}

	statePayload, err := h.consumeIntegrationOAuthState(c.Request.Context(), state)
	if err != nil {
		log.Printf("Integration OAuth callback rejected due to invalid state: %v", err)
		h.redirectIntegrationCallback(c, false, "", "", "desktop", "invalid_state", "Connection session is invalid or expired")
		return
	}

	scopes, err := integrationScopes(statePayload.Provider, statePayload.Feature)
	if err != nil {
		h.redirectIntegrationCallback(c, false, statePayload.Provider, statePayload.Feature, statePayload.Platform, "unsupported_feature", err.Error())
		return
	}

	config := h.oauthConfigForProviderAndScopes(statePayload.Provider, scopes)
	exchangeCtx, cancelExchange := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancelExchange()
	token, integrationUser, err := exchangeIntegrationCode(exchangeCtx, statePayload.Provider, config, code)
	if err != nil {
		log.Printf("Failed to complete %s integration OAuth: %v", statePayload.Provider, err)
		h.redirectIntegrationCallback(c, false, statePayload.Provider, statePayload.Feature, statePayload.Platform, "server_error", "Failed to connect calendar account")
		return
	}

	scopesStr := grantedScopes(token, scopes)
	provider := models.IntegrationProvider(statePayload.Provider)
	connection := &models.IntegrationConnection{
		UserID:            statePayload.UserID,
		Provider:          provider,
		ProviderAccountID: integrationUser.ID,
		ProviderEmail:     stringPtrIfNotEmpty(integrationUser.Email),
		DisplayName:       stringPtrIfNotEmpty(integrationUser.Name),
		AccessToken:       token.AccessToken,
		Scopes:            &scopesStr,
	}
	if token.RefreshToken != "" {
		connection.RefreshToken = &token.RefreshToken
	}
	if !token.Expiry.IsZero() {
		connection.ExpiresAt = &token.Expiry
	}

	if err := h.connectionRepo.CreateOrUpdate(connection); err != nil {
		log.Printf("Failed to store integration connection: %v", err)
		h.redirectIntegrationCallback(c, false, statePayload.Provider, statePayload.Feature, statePayload.Platform, "server_error", "Failed to store calendar connection")
		return
	}

	log.Printf("Integration OAuth completed (provider: %s, feature: %s)", statePayload.Provider, statePayload.Feature)
	if h.jobRepository != nil {
		job, jobErr := integrationworker.CalendarConnectionFullSyncJob(connection.UserID, connection.ID, time.Now())
		if jobErr == nil {
			if _, enqueueErr := h.jobRepository.EnqueueJob(c.Request.Context(), job); enqueueErr != nil {
				log.Printf("Failed to enqueue initial calendar sync: %v", enqueueErr)
			}
		}
	}
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, statePayload.UserID, resourceevents.ResourceCalendarSettings, nil)
	h.redirectIntegrationCallback(c, true, statePayload.Provider, statePayload.Feature, statePayload.Platform, "", "")
}

func (h *IntegrationOAuthHandler) ListConnections(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"status": "error", "error": err.Error()})
		return
	}

	connections, err := h.connectionRepo.GetActiveByUser(userID)
	if err != nil {
		log.Printf("Failed to list integration connections: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Failed to list connections"})
		return
	}

	response := make([]integrationConnectionResponse, 0, len(connections))
	for _, connection := range connections {
		response = append(response, integrationConnectionResponse{
			ID:            connection.ID,
			Provider:      connection.Provider,
			ProviderEmail: connection.ProviderEmail,
			DisplayName:   connection.DisplayName,
			Status:        connection.Status,
			ConnectedAt:   connection.ConnectedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"status":      "success",
		"connections": response,
	})
}

func (h *IntegrationOAuthHandler) DisconnectConnection(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"status": "error", "error": err.Error()})
		return
	}

	connectionID := strings.TrimSpace(c.Param("connectionID"))
	if connectionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "error": "Missing connection ID"})
		return
	}

	connection, err := h.connectionRepo.GetByID(userID, connectionID)
	if err != nil {
		log.Printf("Failed to load integration connection %s for disconnect: %v", connectionID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Failed to disconnect calendar account"})
		return
	}
	if connection == nil {
		c.JSON(http.StatusNotFound, gin.H{"status": "error", "error": "Connection not found"})
		return
	}

	var cleanupSubscriptions func(context.Context) error
	if h.subscriptions != nil {
		cleanupSubscriptions, err = h.subscriptions.PrepareConnectionCleanup(c.Request.Context(), connection)
		if err != nil {
			log.Printf("Failed to snapshot provider subscriptions before disconnect for integration %s: %v", connectionID, err)
		}
	}
	affectedNoteIDs, err := h.connectionRepo.DisconnectLocal(c.Request.Context(), userID, connectionID)
	if err != nil {
		log.Printf("Failed to erase integration connection %s: %v", connectionID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Failed to disconnect calendar account"})
		return
	}
	if cleanupSubscriptions != nil {
		cleanupCtx, cancelCleanup := context.WithTimeout(context.Background(), 12*time.Second)
		if cleanupErr := cleanupSubscriptions(cleanupCtx); cleanupErr != nil {
			log.Printf("Provider subscription cleanup failed after local disconnect for integration %s: %v", connectionID, cleanupErr)
		}
		cancelCleanup()
	}

	if err := revokeIntegrationToken(c.Request.Context(), connection); err != nil {
		log.Printf("Provider token revocation failed after local disconnect for integration %s: %v", connectionID, err)
	}

	log.Printf("Integration connection disconnected (provider: %s)", connection.Provider)
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourceCalendarSettings, nil)
	resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourceCalendarEvents, nil)
	for _, noteID := range affectedNoteIDs {
		noteID := noteID
		resourceevents.PublishBestEffort(c.Request.Context(), h.events, userID, resourceevents.ResourceNotes, &noteID)
	}
	c.JSON(http.StatusOK, gin.H{
		"status":        "success",
		"connection_id": connectionID,
	})
}

func revokeIntegrationToken(parent context.Context, connection *models.IntegrationConnection) error {
	if connection == nil || connection.AccessToken == "" {
		return nil
	}
	if connection.Provider != models.IntegrationProviderGoogle {
		// Microsoft does not expose a per-access-token OAuth revocation endpoint.
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	form := url.Values{"token": []string{connection.AccessToken}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth2.googleapis.com/revoke", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("provider returned status %d", resp.StatusCode)
	}
	return nil
}

func (h *IntegrationOAuthHandler) consumeIntegrationOAuthState(ctx context.Context, state string) (*IntegrationOAuthState, error) {
	if !validIntegrationOAuthState(state) {
		return nil, fmt.Errorf("missing or invalid state")
	}

	key := fmt.Sprintf("%s:%s", integrationOAuthStatePrefix, state)
	res := h.redisClient.GetDel(ctx, key)
	if err := res.Err(); err != nil {
		if err == redis.Nil {
			return nil, fmt.Errorf("state missing or expired")
		}
		return nil, fmt.Errorf("failed to read state: %w", err)
	}

	var payload IntegrationOAuthState
	if err := json.Unmarshal([]byte(res.Val()), &payload); err != nil {
		return nil, fmt.Errorf("invalid state payload: %w", err)
	}
	if payload.Purpose != "integration_connect" {
		return nil, fmt.Errorf("invalid state purpose")
	}
	if payload.UserID == "" || payload.Provider == "" || payload.Feature == "" {
		return nil, fmt.Errorf("invalid state payload")
	}
	if _, ok := normalizeOAuthPlatform(payload.Platform); !ok {
		return nil, fmt.Errorf("invalid state platform")
	}

	return &payload, nil
}

func (h *IntegrationOAuthHandler) oauthConfigForProviderAndScopes(provider string, scopes []string) *oauth2.Config {
	var config oauth2.Config
	switch provider {
	case string(models.IntegrationProviderMicrosoft):
		config = *h.microsoftConfig
	default:
		config = *h.googleConfig
	}
	config.Scopes = scopes
	config.RedirectURL = getIntegrationRedirectURL(provider)
	return &config
}

func integrationAuthCodeURL(provider string, config *oauth2.Config, state string) string {
	switch provider {
	case string(models.IntegrationProviderMicrosoft):
		return config.AuthCodeURL(state,
			oauth2.AccessTypeOffline,
			oauth2.SetAuthURLParam("prompt", "consent"))
	default:
		return config.AuthCodeURL(state,
			oauth2.AccessTypeOffline,
			oauth2.SetAuthURLParam("include_granted_scopes", "true"),
			oauth2.SetAuthURLParam("prompt", "consent"))
	}
}

func (h *IntegrationOAuthHandler) redirectIntegrationCallback(c *gin.Context, success bool, provider, feature, platform, errorCode, errorDescription string) {
	base := getIntegrationCallbackURL(platform)
	values := map[string]string{
		"success":  fmt.Sprintf("%t", success),
		"provider": provider,
		"feature":  feature,
	}
	if state := strings.TrimSpace(c.Query("state")); validIntegrationOAuthState(state) {
		values["state"] = state
	}
	if errorCode != "" {
		values["error"] = errorCode
	}
	if errorDescription != "" {
		values["error_description"] = errorDescription
	}

	c.Redirect(http.StatusFound, buildCallbackURL(base, values))
}

type googleIntegrationUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

type microsoftIntegrationUser struct {
	ID                string `json:"id"`
	DisplayName       string `json:"displayName"`
	Mail              string `json:"mail"`
	UserPrincipalName string `json:"userPrincipalName"`
}

type integrationUser struct {
	ID    string
	Email string
	Name  string
}

func exchangeIntegrationCode(ctx context.Context, provider string, config *oauth2.Config, code string) (*oauth2.Token, *integrationUser, error) {
	switch provider {
	case string(models.IntegrationProviderMicrosoft):
		return exchangeMicrosoftIntegrationCode(ctx, config, code)
	case string(models.IntegrationProviderGoogle):
		return exchangeGoogleIntegrationCode(ctx, config, code)
	default:
		return nil, nil, fmt.Errorf("unsupported provider: %s", provider)
	}
}

func exchangeGoogleIntegrationCode(ctx context.Context, config *oauth2.Config, code string) (*oauth2.Token, *integrationUser, error) {
	token, err := config.Exchange(ctx, code)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to exchange Google authorization code")
	}

	client := config.Client(ctx, token)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create Google user info request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get Google user info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, fmt.Errorf("Google user info returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read Google user info: %w", err)
	}

	var googleUser googleIntegrationUser
	if err := json.Unmarshal(body, &googleUser); err != nil {
		return nil, nil, fmt.Errorf("failed to parse Google user info: %w", err)
	}
	if googleUser.ID == "" {
		return nil, nil, fmt.Errorf("Google user info did not include an account ID")
	}

	return token, &integrationUser{
		ID:    googleUser.ID,
		Email: googleUser.Email,
		Name:  googleUser.Name,
	}, nil
}

func exchangeMicrosoftIntegrationCode(ctx context.Context, config *oauth2.Config, code string) (*oauth2.Token, *integrationUser, error) {
	token, err := config.Exchange(ctx, code)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to exchange Microsoft authorization code")
	}

	client := config.Client(ctx, token)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", nil)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create Microsoft user info request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get Microsoft user info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, fmt.Errorf("Microsoft user info returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read Microsoft user info: %w", err)
	}

	var microsoftUser microsoftIntegrationUser
	if err := json.Unmarshal(body, &microsoftUser); err != nil {
		return nil, nil, fmt.Errorf("failed to parse Microsoft user info: %w", err)
	}
	if microsoftUser.ID == "" {
		return nil, nil, fmt.Errorf("Microsoft user info did not include an account ID")
	}

	email := microsoftUser.Mail
	if email == "" {
		email = microsoftUser.UserPrincipalName
	}

	return token, &integrationUser{
		ID:    microsoftUser.ID,
		Email: email,
		Name:  microsoftUser.DisplayName,
	}, nil
}

func integrationScopes(provider, feature string) ([]string, error) {
	switch provider {
	case string(models.IntegrationProviderGoogle):
		switch feature {
		case "calendar":
			return googleIntegrationScopes(feature), nil
		default:
			return nil, fmt.Errorf("Unsupported Google integration feature")
		}
	case string(models.IntegrationProviderMicrosoft):
		switch feature {
		case "calendar":
			return microsoftIntegrationScopes(feature), nil
		default:
			return nil, fmt.Errorf("Unsupported Microsoft integration feature")
		}
	default:
		return nil, fmt.Errorf("Unsupported provider")
	}
}

func microsoftIntegrationScopes(feature string) []string {
	switch feature {
	case "calendar":
		return []string{"openid", "email", "profile", "offline_access", "User.Read", "Calendars.Read"}
	default:
		return []string{"openid", "email", "profile", "offline_access", "User.Read"}
	}
}

func googleIntegrationScopes(feature string) []string {
	switch feature {
	case "calendar":
		return []string{"openid", "email", "profile", "https://www.googleapis.com/auth/calendar.readonly"}
	default:
		return []string{"openid", "email", "profile"}
	}
}

func grantedScopes(token *oauth2.Token, fallback []string) string {
	if token != nil {
		if scope, ok := token.Extra("scope").(string); ok && strings.TrimSpace(scope) != "" {
			return scope
		}
	}
	return strings.Join(fallback, " ")
}

func getIntegrationRedirectURL(provider string) string {
	if provider == string(models.IntegrationProviderMicrosoft) {
		return os.Getenv("MICROSOFT_INTEGRATION_REDIRECT_URL")
	}
	return os.Getenv("GOOGLE_INTEGRATION_REDIRECT_URL")
}

func getIntegrationCallbackURL(platform string) string {
	return os.Getenv("FRONTEND_INTEGRATION_CALLBACK_URL")
}

func stringPtrIfNotEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
