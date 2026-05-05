package models

import (
	"encoding/json"
	"time"
)

type AuthProvider string

const (
	AuthProviderGoogle    AuthProvider = "google"
	AuthProviderMicrosoft AuthProvider = "microsoft"
)

type UserAuthIdentity struct {
	ID             string          `db:"id" json:"id"`
	UserID         string          `db:"user_id" json:"user_id"`
	Provider       AuthProvider    `db:"provider" json:"provider"`
	ProviderUserID string          `db:"provider_user_id" json:"provider_user_id"`
	ProviderEmail  *string         `db:"provider_email" json:"provider_email,omitempty"`
	EmailVerified  bool            `db:"email_verified" json:"email_verified"`
	DisplayName    *string         `db:"display_name" json:"display_name,omitempty"`
	AvatarURL      *string         `db:"avatar_url" json:"avatar_url,omitempty"`
	RawClaims      json.RawMessage `db:"raw_claims" json:"raw_claims,omitempty"`
	CreatedAt      time.Time       `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time       `db:"updated_at" json:"updated_at"`
	LastLoginAt    *time.Time      `db:"last_login_at" json:"last_login_at,omitempty"`
}
