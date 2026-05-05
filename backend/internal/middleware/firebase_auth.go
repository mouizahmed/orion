package middleware

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/auth"
)

type firebaseContextKey string
type contextKey string

const UserIDKey contextKey = "userID" // For compatibility with existing handlers
const FirebaseUserIDKey firebaseContextKey = "firebase_user_id"

// FirebaseAuthMiddleware validates Firebase JWT tokens and extracts user ID
func FirebaseAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get the authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "Authentication required",
				"message": "Missing Authorization header. Please include 'Authorization: Bearer <token>' in your request.",
			})
			c.Abort()
			return
		}

		// Extract token from "Bearer <token>" format
		tokenParts := strings.Split(authHeader, " ")
		if len(tokenParts) != 2 || tokenParts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "Invalid authorization format",
				"message": "Authorization header must be in format 'Bearer <token>'.",
			})
			c.Abort()
			return
		}

		token := tokenParts[1]

		// Get Firebase client
		firebaseClient := auth.GetFirebaseClient()
		if firebaseClient == nil {
			log.Printf("Firebase client not initialized")
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "Server configuration error",
				"message": "Authentication service is not properly configured. Please contact support.",
			})
			c.Abort()
			return
		}

		// Verify the Firebase ID token and reject sessions revoked by logout-everywhere.
		firebaseToken, err := firebaseClient.VerifyIDTokenAndCheckRevoked(token)
		if err != nil {
			// Provide specific error messages based on the error type
			var errorMsg, userMsg string

			errorStr := err.Error()
			if strings.Contains(errorStr, "token is expired") {
				errorMsg = "Token expired"
				userMsg = "Your session has expired. Please sign in again."
			} else if strings.Contains(errorStr, "token issued in the future") {
				errorMsg = "Token timing issue"
				userMsg = "Authentication timing error. Please try again in a few seconds."
			} else if strings.Contains(errorStr, "signature is invalid") {
				errorMsg = "Invalid token signature"
				userMsg = "Invalid authentication token. Please sign in again."
			} else if strings.Contains(errorStr, "token is malformed") {
				errorMsg = "Malformed token"
				userMsg = "Invalid token format. Please sign in again."
			} else {
				errorMsg = "Token validation failed"
				userMsg = "Authentication failed. Please sign in again."
			}

			log.Printf("Firebase token verification failed: %v", err)
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   errorMsg,
				"message": userMsg,
			})
			c.Abort()
			return
		}

		// Extract user ID from Firebase token
		userID := firebaseToken.UID
		if userID == "" {
			log.Printf("No user ID found in Firebase token claims")
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":   "Invalid token claims",
				"message": "Token is missing required user information. Please sign in again.",
			})
			c.Abort()
			return
		}

		// Store user ID in context for use by handlers (compatible with existing code)
		c.Set(string(UserIDKey), userID) // Use existing UserIDKey for compatibility
		c.Set(string(FirebaseUserIDKey), userID)
		c.Next()
	}
}

// GetFirebaseUserIDFromContext extracts the Firebase user ID from the Gin context
func GetFirebaseUserIDFromContext(c *gin.Context) (string, bool) {
	userID, exists := c.Get(string(FirebaseUserIDKey))
	if !exists {
		return "", false
	}

	userIDStr, ok := userID.(string)
	return userIDStr, ok
}
