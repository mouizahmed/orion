package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// OneTimeCode represents a one-time authentication code
type OneTimeCode struct {
	Code          string     `json:"code"`
	User          *OAuthUser `json:"user"`
	FirebaseToken string     `json:"firebase_token"`
	Provider      string     `json:"provider"`
	Platform      string     `json:"platform"`
	IsNewUser     bool       `json:"is_new_user"`
	CreatedAt     time.Time  `json:"created_at"`
	ExpiresAt     time.Time  `json:"expires_at"`
	Used          bool       `json:"used"`
}

// CodeManager manages one-time codes in Redis
type CodeManager struct {
	redisClient *redis.Client
}

// NewCodeManager creates a new Redis-based code manager
func NewCodeManager(redisClient *redis.Client) *CodeManager {
	return &CodeManager{
		redisClient: redisClient,
	}
}

// GenerateCode creates a new one-time code and stores it in Redis
func (cm *CodeManager) GenerateCode(user *OAuthUser, firebaseToken, provider, platform string, isNewUser bool) (string, error) {
	// Generate a secure random code
	codeBytes := make([]byte, 16) // 32 character hex string
	if _, err := rand.Read(codeBytes); err != nil {
		return "", fmt.Errorf("failed to generate auth code: %w", err)
	}
	code := hex.EncodeToString(codeBytes)

	// Create the code
	oneTimeCode := &OneTimeCode{
		Code:          code,
		User:          user,
		FirebaseToken: firebaseToken,
		Provider:      provider,
		Platform:      platform,
		IsNewUser:     isNewUser,
		CreatedAt:     time.Now(),
		ExpiresAt:     time.Now().Add(5 * time.Minute), // 5 minute expiry
		Used:          false,
	}

	// Serialize to JSON
	codeData, err := json.Marshal(oneTimeCode)
	if err != nil {
		return "", fmt.Errorf("failed to marshal auth code: %w", err)
	}

	// Store in Redis with 5-minute TTL
	ctx := context.Background()
	key := fmt.Sprintf("auth_code:%s", code)
	if err := cm.redisClient.SetEx(ctx, key, codeData, 5*time.Minute).Err(); err != nil {
		return "", fmt.Errorf("failed to store auth code: %w", err)
	}

	return code, nil
}

// ValidateAndConsumeCode validates a code and atomically deletes it (one-time use)
func (cm *CodeManager) ValidateAndConsumeCode(code string) (*OneTimeCode, error) {
	ctx := context.Background()
	key := fmt.Sprintf("auth_code:%s", code)

	// Use GETDEL for atomic get-and-delete operation
	result := cm.redisClient.GetDel(ctx, key)
	if result.Err() != nil {
		if result.Err() == redis.Nil {
			return nil, fmt.Errorf("code not found")
		}
		return nil, fmt.Errorf("redis error: %w", result.Err())
	}

	// Unmarshal the code data
	var oneTimeCode OneTimeCode
	err := json.Unmarshal([]byte(result.Val()), &oneTimeCode)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal code data: %w", err)
	}

	// Check if code is expired (additional safety check)
	if time.Now().After(oneTimeCode.ExpiresAt) {
		return nil, fmt.Errorf("code expired")
	}

	// Check if code is already used (additional safety check)
	if oneTimeCode.Used {
		return nil, fmt.Errorf("code already used")
	}

	// Mark as used and return
	oneTimeCode.Used = true
	return &oneTimeCode, nil
}
