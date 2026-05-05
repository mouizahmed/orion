package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const integrationOAuthStatePrefix = "integration_oauth_state"

type IntegrationOAuthHandler struct {
	connectionRepo  repository.IntegrationConnectionRepository
	redisClient     *redis.Client
	googleConfig    *oauth2.Config
	microsoftConfig *oauth2.Config
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

func NewIntegrationOAuthHandler(connectionRepo repository.IntegrationConnectionRepository, redisClient *redis.Client) *IntegrationOAuthHandler {
	return &IntegrationOAuthHandler{
		connectionRepo: connectionRepo,
		redisClient:    redisClient,
		googleConfig: &oauth2.Config{
			ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
			ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
			Endpoint:     google.Endpoint,
			Scopes:       googleIntegrationScopes("calendar"),
			RedirectURL:  getIntegrationRedirectURL(string(models.IntegrationProviderGoogle)),
		},
		microsoftConfig: &oauth2.Config{
			ClientID:     os.Getenv("MICROSOFT_CLIENT_ID"),
			ClientSecret: os.Getenv("MICROSOFT_CLIENT_SECRET"),
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
	if err := h.redisClient.SetEx(context.Background(), key, payload, 10*time.Minute).Err(); err != nil {
		log.Printf("Failed to store integration OAuth state in Redis: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Failed to start connection"})
		return
	}

	config := h.oauthConfigForProviderAndScopes(provider, requiredScopes)
	authURL := integrationAuthCodeURL(provider, config, state)

	log.Printf("Started integration OAuth flow (user: %s, provider: %s, feature: %s, platform: %s)", userID, provider, feature, platform)
	c.JSON(http.StatusOK, gin.H{
		"status":   "success",
		"auth_url": authURL,
	})
}

func (h *IntegrationOAuthHandler) HandleCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	errorParam := c.Query("error")

	if errorParam != "" {
		errorDesc := c.Query("error_description")
		if statePayload, err := h.consumeIntegrationOAuthState(state); err == nil {
			h.redirectIntegrationCallback(c, false, statePayload.Provider, statePayload.Feature, statePayload.Platform, errorParam, errorDesc)
		} else {
			h.redirectIntegrationCallback(c, false, "", "", "desktop", errorParam, errorDesc)
		}
		return
	}

	if code == "" || state == "" {
		h.redirectIntegrationCallback(c, false, "", "", "desktop", "invalid_request", "Missing authorization code or state")
		return
	}

	statePayload, err := h.consumeIntegrationOAuthState(state)
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
	token, integrationUser, err := exchangeIntegrationCode(statePayload.Provider, config, code)
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

	log.Printf("Integration OAuth completed (user: %s, provider: %s, feature: %s, connection: %s)", statePayload.UserID, statePayload.Provider, statePayload.Feature, connection.ID)
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
		log.Printf("Failed to list integration connections for user %s: %v", userID, err)
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

	if err := h.connectionRepo.SoftDisconnect(userID, connectionID); err != nil {
		log.Printf("Failed to soft disconnect integration connection %s: %v", connectionID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Failed to disconnect calendar account"})
		return
	}

	log.Printf("Integration connection disconnected (user: %s, connection: %s, provider: %s)", userID, connectionID, connection.Provider)
	c.JSON(http.StatusOK, gin.H{
		"status":        "success",
		"connection_id": connectionID,
	})
}

func (h *IntegrationOAuthHandler) consumeIntegrationOAuthState(state string) (*IntegrationOAuthState, error) {
	if state == "" {
		return nil, fmt.Errorf("missing state")
	}

	key := fmt.Sprintf("%s:%s", integrationOAuthStatePrefix, state)
	res := h.redisClient.GetDel(context.Background(), key)
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

func exchangeIntegrationCode(provider string, config *oauth2.Config, code string) (*oauth2.Token, *integrationUser, error) {
	switch provider {
	case string(models.IntegrationProviderMicrosoft):
		return exchangeMicrosoftIntegrationCode(config, code)
	case string(models.IntegrationProviderGoogle):
		return exchangeGoogleIntegrationCode(config, code)
	default:
		return nil, nil, fmt.Errorf("unsupported provider: %s", provider)
	}
}

func exchangeGoogleIntegrationCode(config *oauth2.Config, code string) (*oauth2.Token, *integrationUser, error) {
	token, err := config.Exchange(oauth2.NoContext, code)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to exchange authorization code: %w", err)
	}

	client := config.Client(oauth2.NoContext, token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get Google user info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, fmt.Errorf("Google user info returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
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

func exchangeMicrosoftIntegrationCode(config *oauth2.Config, code string) (*oauth2.Token, *integrationUser, error) {
	token, err := config.Exchange(oauth2.NoContext, code)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to exchange authorization code: %w", err)
	}

	client := config.Client(oauth2.NoContext, token)
	resp, err := client.Get("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get Microsoft user info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, nil, fmt.Errorf("Microsoft user info returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
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
		if value := os.Getenv("MICROSOFT_INTEGRATION_REDIRECT_URL"); value != "" {
			return value
		}
		if value := os.Getenv("MICROSOFT_REDIRECT_URL"); value != "" {
			return strings.Replace(value, "/auth/callback", "/integrations/oauth/callback", 1)
		}
		return "http://localhost:8080/integrations/oauth/callback"
	}

	if value := os.Getenv("GOOGLE_INTEGRATION_REDIRECT_URL"); value != "" {
		return value
	}
	if value := os.Getenv("GOOGLE_REDIRECT_URL"); value != "" {
		return strings.Replace(value, "/auth/callback", "/integrations/oauth/callback", 1)
	}
	return "http://localhost:8080/integrations/oauth/callback"
}

func getIntegrationCallbackURL(platform string) string {
	if value := os.Getenv("FRONTEND_INTEGRATION_CALLBACK_URL"); value != "" {
		return value
	}
	if value := os.Getenv("FRONTEND_CALLBACK_URL"); value != "" {
		return strings.Replace(value, "/auth/callback", "/integrations/callback", 1)
	}
	return "http://localhost:3000/integrations/callback"
}

func stringPtrIfNotEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
