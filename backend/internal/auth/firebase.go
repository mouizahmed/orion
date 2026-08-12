package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	firebase "firebase.google.com/go/v4"
	firebaseauth "firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

var (
	firebaseClient *FirebaseClient
)

type FirebaseClient struct {
	Auth *firebaseauth.Client
}

type firebaseServiceAccount struct {
	ProjectID string `json:"project_id"`
}

type FirebaseTokenErrorCode string

const (
	FirebaseTokenExpired    FirebaseTokenErrorCode = "expired"
	FirebaseTokenRevoked    FirebaseTokenErrorCode = "revoked"
	FirebaseUserDisabled    FirebaseTokenErrorCode = "user_disabled"
	FirebaseUserMissing     FirebaseTokenErrorCode = "user_missing"
	FirebaseTokenInvalid    FirebaseTokenErrorCode = "invalid"
	FirebaseVerifierFailure FirebaseTokenErrorCode = "verifier_failure"
)

type FirebaseTokenError struct {
	Code  FirebaseTokenErrorCode
	Cause error
}

func (e *FirebaseTokenError) Error() string {
	return "firebase token validation failed: " + string(e.Code)
}

func (e *FirebaseTokenError) Unwrap() error {
	return e.Cause
}

// Initialize Firebase Admin SDK
func InitFirebase() error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Get Firebase service account key from environment
	serviceAccountKey := os.Getenv("FIREBASE_SERVICE_ACCOUNT_KEY")
	if serviceAccountKey == "" {
		return fmt.Errorf("FIREBASE_SERVICE_ACCOUNT_KEY environment variable not set")
	}

	// Parse the service account key JSON
	var serviceAccount firebaseServiceAccount
	if err := json.Unmarshal([]byte(serviceAccountKey), &serviceAccount); err != nil {
		return fmt.Errorf("failed to parse Firebase service account key: %w", err)
	}
	if serviceAccount.ProjectID == "" {
		return fmt.Errorf("Firebase service account is missing project_id")
	}
	if expectedProjectID := os.Getenv("FIREBASE_PROJECT_ID"); expectedProjectID != "" && expectedProjectID != serviceAccount.ProjectID {
		return fmt.Errorf("Firebase project mismatch: service account is for %q, FIREBASE_PROJECT_ID is %q", serviceAccount.ProjectID, expectedProjectID)
	}

	// Create Firebase config
	config := &firebase.Config{
		ProjectID: serviceAccount.ProjectID,
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
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var (
		token string
		err   error
	)
	if len(customClaims) == 0 {
		token, err = c.Auth.CustomToken(ctx, userID)
	} else {
		token, err = c.Auth.CustomTokenWithClaims(ctx, userID, customClaims)
	}
	if err != nil {
		return "", fmt.Errorf("failed to create custom token: %w", err)
	}
	return token, nil
}

// VerifyIDTokenAndCheckRevoked verifies a Firebase ID token and rejects revoked sessions.
func (c *FirebaseClient) VerifyIDTokenAndCheckRevoked(idToken string) (*firebaseauth.Token, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	token, err := c.Auth.VerifyIDTokenAndCheckRevoked(ctx, idToken)
	if err != nil {
		code := FirebaseTokenInvalid
		switch {
		case firebaseauth.IsIDTokenExpired(err):
			code = FirebaseTokenExpired
		case firebaseauth.IsIDTokenRevoked(err):
			code = FirebaseTokenRevoked
		case firebaseauth.IsUserDisabled(err):
			code = FirebaseUserDisabled
		case firebaseauth.IsUserNotFound(err):
			code = FirebaseUserMissing
		case firebaseauth.IsCertificateFetchFailed(err):
			code = FirebaseVerifierFailure
		}
		return nil, &FirebaseTokenError{Code: code, Cause: err}
	}
	return token, nil
}

// CreateOrUpdateUser creates or updates a user in Firebase Auth
func (c *FirebaseClient) CreateOrUpdateUser(parent context.Context, userID, email, name, photoURL string) (*firebaseauth.UserRecord, error) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()

	params := &firebaseauth.UserToCreate{}
	params.UID(userID).Email(email).DisplayName(name)

	if photoURL != "" {
		params.PhotoURL(photoURL)
	}

	// Try to create user, if exists then update
	user, err := c.Auth.CreateUser(ctx, params)
	if err != nil {
		if !firebaseauth.IsUIDAlreadyExists(err) {
			return nil, fmt.Errorf("failed to create Firebase user: %w", err)
		}

		updateParams := &firebaseauth.UserToUpdate{}
		updateParams.Email(email).DisplayName(name)

		if photoURL != "" {
			updateParams.PhotoURL(photoURL)
		}

		user, err = c.Auth.UpdateUser(ctx, userID, updateParams)
		if err != nil {
			return nil, fmt.Errorf("failed to create or update user: %w", err)
		}
		log.Printf("Firebase user updated")
	} else {
		log.Printf("Firebase user created")
	}

	return user, nil
}

// RevokeRefreshTokens revokes all refresh tokens for a user
func (c *FirebaseClient) RevokeRefreshTokens(userID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := c.Auth.RevokeRefreshTokens(ctx, userID)
	if err != nil {
		return fmt.Errorf("failed to revoke refresh tokens: %w", err)
	}
	log.Printf("Firebase refresh tokens revoked")
	return nil
}
