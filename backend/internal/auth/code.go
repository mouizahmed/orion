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
	Code                string     `json:"code"`
	State               string     `json:"state"`
	CodeChallenge       string     `json:"code_challenge,omitempty"`
	CodeChallengeMethod string     `json:"code_challenge_method,omitempty"`
	User                *OAuthUser `json:"user"`
	FirebaseToken       string     `json:"firebase_token"`
	Provider            string     `json:"provider"`
	Platform            string     `json:"platform"`
	IsNewUser           bool       `json:"is_new_user"`
	CreatedAt           time.Time  `json:"created_at"`
	ExpiresAt           time.Time  `json:"expires_at"`
	Used                bool       `json:"used"`
}

// CodeManager manages one-time codes in Redis
type CodeManager struct {
	redisClient *redis.Client
}

const validateAndConsumeCodeScript = `
local value = redis.call("GET", KEYS[1])
if not value then
  return {0, ""}
end

local ok, decoded = pcall(cjson.decode, value)
if not ok then
  return {3, ""}
end

if decoded["state"] ~= ARGV[1] then
  return {1, ""}
end

local code_challenge = decoded["code_challenge"]
if code_challenge and code_challenge ~= "" then
  if decoded["code_challenge_method"] ~= "S256" then
    return {4, ""}
  end
  if code_challenge ~= ARGV[2] then
    return {5, ""}
  end
end

redis.call("DEL", KEYS[1])
return {2, value}
`

// NewCodeManager creates a new Redis-based code manager
func NewCodeManager(redisClient *redis.Client) *CodeManager {
	return &CodeManager{
		redisClient: redisClient,
	}
}

// GenerateCode creates a new one-time code and stores it in Redis
func (cm *CodeManager) GenerateCode(ctx context.Context, user *OAuthUser, firebaseToken, provider, platform, state, codeChallenge, codeChallengeMethod string, isNewUser bool) (string, error) {
	// Generate a secure random code
	codeBytes := make([]byte, 16) // 32 character hex string
	if _, err := rand.Read(codeBytes); err != nil {
		return "", fmt.Errorf("failed to generate auth code: %w", err)
	}
	code := hex.EncodeToString(codeBytes)

	// Create the code
	oneTimeCode := &OneTimeCode{
		Code:                code,
		State:               state,
		CodeChallenge:       codeChallenge,
		CodeChallengeMethod: codeChallengeMethod,
		User:                user,
		FirebaseToken:       firebaseToken,
		Provider:            provider,
		Platform:            platform,
		IsNewUser:           isNewUser,
		CreatedAt:           time.Now(),
		ExpiresAt:           time.Now().Add(5 * time.Minute), // 5 minute expiry
		Used:                false,
	}

	// Serialize to JSON
	codeData, err := json.Marshal(oneTimeCode)
	if err != nil {
		return "", fmt.Errorf("failed to marshal auth code: %w", err)
	}

	// Store in Redis with 5-minute TTL
	key := fmt.Sprintf("auth_code:%s", code)
	if err := cm.redisClient.SetEx(ctx, key, codeData, 5*time.Minute).Err(); err != nil {
		return "", fmt.Errorf("failed to store auth code: %w", err)
	}

	return code, nil
}

// ValidateAndConsumeCode validates a code and atomically deletes it only when state and verifier match.
func (cm *CodeManager) ValidateAndConsumeCode(ctx context.Context, code, expectedState, expectedCodeChallenge string) (*OneTimeCode, error) {
	key := fmt.Sprintf("auth_code:%s", code)

	result, err := cm.redisClient.Eval(ctx, validateAndConsumeCodeScript, []string{key}, expectedState, expectedCodeChallenge).Slice()
	if err != nil {
		return nil, fmt.Errorf("redis error: %w", err)
	}
	if len(result) != 2 {
		return nil, fmt.Errorf("invalid redis response")
	}

	status, ok := result[0].(int64)
	if !ok {
		return nil, fmt.Errorf("invalid redis status response")
	}

	switch status {
	case 0:
		return nil, fmt.Errorf("code not found")
	case 1:
		return nil, fmt.Errorf("state mismatch")
	case 2:
		// Continue below.
	case 3:
		return nil, fmt.Errorf("invalid code data")
	case 4:
		return nil, fmt.Errorf("unsupported code challenge method")
	case 5:
		return nil, fmt.Errorf("code verifier mismatch")
	default:
		return nil, fmt.Errorf("unknown redis status response")
	}

	codeData, ok := result[1].(string)
	if !ok || codeData == "" {
		return nil, fmt.Errorf("invalid redis code response")
	}

	// Unmarshal the code data
	var oneTimeCode OneTimeCode
	if err := json.Unmarshal([]byte(codeData), &oneTimeCode); err != nil {
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
