package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

var (
	firebaseApp    *firebase.App
	firebaseAuth   *auth.Client
	firebaseClient *FirebaseClient
)

type FirebaseClient struct {
	Auth *auth.Client
}

// Initialize Firebase Admin SDK
func InitFirebase() error {
	ctx := context.Background()

	// Get Firebase service account key from environment
	serviceAccountKey := os.Getenv("FIREBASE_SERVICE_ACCOUNT_KEY")
	if serviceAccountKey == "" {
		return fmt.Errorf("FIREBASE_SERVICE_ACCOUNT_KEY environment variable not set")
	}

	// Parse the service account key JSON
	var serviceAccount map[string]interface{}
	if err := json.Unmarshal([]byte(serviceAccountKey), &serviceAccount); err != nil {
		return fmt.Errorf("failed to parse Firebase service account key: %w", err)
	}

	// Create Firebase config
	config := &firebase.Config{
		ProjectID: serviceAccount["project_id"].(string),
	}

	// Initialize Firebase app with service account
	opt := option.WithCredentialsJSON([]byte(serviceAccountKey))
	app, err := firebase.NewApp(ctx, config, opt)
	if err != nil {
		return fmt.Errorf("failed to initialize Firebase app: %w", err)
	}

	// Initialize Firebase Auth
	authClient, err := app.Auth(ctx)
	if err != nil {
		return fmt.Errorf("failed to initialize Firebase Auth: %w", err)
	}

	// Store globally
	firebaseApp = app
	firebaseAuth = authClient
	firebaseClient = &FirebaseClient{Auth: authClient}

	log.Printf("🔥 Firebase Admin SDK initialized successfully")
	return nil
}

// GetFirebaseClient returns the initialized Firebase client
func GetFirebaseClient() *FirebaseClient {
	return firebaseClient
}

// CreateCustomToken creates a Firebase custom token for a user
func (c *FirebaseClient) CreateCustomToken(userID string, customClaims map[string]interface{}) (string, error) {
	ctx := context.Background()
	token, err := c.Auth.CustomToken(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("failed to create custom token: %w", err)
	}
	return token, nil
}

// VerifyIDToken verifies a Firebase ID token
func (c *FirebaseClient) VerifyIDToken(idToken string) (*auth.Token, error) {
	ctx := context.Background()
	token, err := c.Auth.VerifyIDToken(ctx, idToken)
	if err != nil {
		return nil, fmt.Errorf("failed to verify ID token: %w", err)
	}
	return token, nil
}

// VerifyIDTokenAndCheckRevoked verifies a Firebase ID token and rejects revoked sessions.
func (c *FirebaseClient) VerifyIDTokenAndCheckRevoked(idToken string) (*auth.Token, error) {
	ctx := context.Background()
	token, err := c.Auth.VerifyIDTokenAndCheckRevoked(ctx, idToken)
	if err != nil {
		return nil, fmt.Errorf("failed to verify ID token with revocation check: %w", err)
	}
	return token, nil
}

// CreateOrUpdateUser creates or updates a user in Firebase Auth
func (c *FirebaseClient) CreateOrUpdateUser(userID, email, name, photoURL string) (*auth.UserRecord, error) {
	ctx := context.Background()

	params := &auth.UserToCreate{}
	params.UID(userID).Email(email).DisplayName(name)

	if photoURL != "" {
		params.PhotoURL(photoURL)
	}

	// Try to create user, if exists then update
	user, err := c.Auth.CreateUser(ctx, params)
	if err != nil {
		// If user already exists, update instead
		updateParams := &auth.UserToUpdate{}
		updateParams.Email(email).DisplayName(name)

		if photoURL != "" {
			updateParams.PhotoURL(photoURL)
		}

		user, err = c.Auth.UpdateUser(ctx, userID, updateParams)
		if err != nil {
			return nil, fmt.Errorf("failed to create or update user: %w", err)
		}
		log.Printf("👤 Updated Firebase user: %s (%s)", name, email)
	} else {
		log.Printf("👤 Created Firebase user: %s (%s)", name, email)
	}

	return user, nil
}

// RevokeRefreshTokens revokes all refresh tokens for a user
func (c *FirebaseClient) RevokeRefreshTokens(userID string) error {
	ctx := context.Background()
	err := c.Auth.RevokeRefreshTokens(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to revoke refresh tokens: %w", err)
	}
	log.Printf("🔒 Revoked all refresh tokens for user: %s", userID)
	return nil
}
