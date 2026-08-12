package models

import (
	"encoding/json"
	"time"
)

type IntegrationProvider string
type IntegrationConnectionStatus string

const (
	IntegrationProviderGoogle    IntegrationProvider = "google"
	IntegrationProviderMicrosoft IntegrationProvider = "microsoft"

	IntegrationConnectionStatusActive         IntegrationConnectionStatus = "active"
	IntegrationConnectionStatusNeedsReconnect IntegrationConnectionStatus = "needs_reconnect"
	IntegrationConnectionStatusDisconnected   IntegrationConnectionStatus = "disconnected"
)

type IntegrationConnection struct {
	ID                   string                      `db:"id" json:"id"`
	UserID               string                      `db:"user_id" json:"user_id"`
	Provider             IntegrationProvider         `db:"provider" json:"provider"`
	ProviderAccountID    string                      `db:"provider_account_id" json:"provider_account_id"`
	ProviderEmail        *string                     `db:"provider_email" json:"provider_email,omitempty"`
	DisplayName          *string                     `db:"display_name" json:"display_name,omitempty"`
	AccessToken          string                      `db:"access_token" json:"-"`
	RefreshToken         *string                     `db:"refresh_token" json:"-"`
	EncryptionKeyVersion int                         `db:"encryption_key_version" json:"-"`
	ExpiresAt            *time.Time                  `db:"expires_at" json:"expires_at,omitempty"`
	Scopes               *string                     `db:"scopes" json:"scopes,omitempty"`
	Metadata             *json.RawMessage            `db:"metadata" json:"metadata,omitempty"`
	Status               IntegrationConnectionStatus `db:"status" json:"status"`
	ConnectedAt          time.Time                   `db:"connected_at" json:"connected_at"`
	UpdatedAt            time.Time                   `db:"updated_at" json:"updated_at"`
	DisconnectedAt       *time.Time                  `db:"disconnected_at" json:"disconnected_at,omitempty"`
}

type CreateIntegrationConnectionRequest struct {
	UserID            string              `json:"user_id" validate:"required"`
	Provider          IntegrationProvider `json:"provider" validate:"required,oneof=google microsoft"`
	ProviderAccountID string              `json:"provider_account_id" validate:"required"`
	ProviderEmail     *string             `json:"provider_email"`
	DisplayName       *string             `json:"display_name"`
	AccessToken       string              `json:"access_token" validate:"required"`
	RefreshToken      *string             `json:"refresh_token"`
	ExpiresAt         *time.Time          `json:"expires_at"`
	Scopes            *string             `json:"scopes"`
	Metadata          *json.RawMessage    `json:"metadata"`
}

type UpdateIntegrationConnectionTokensRequest struct {
	AccessToken  *string    `json:"access_token"`
	RefreshToken *string    `json:"refresh_token"`
	ExpiresAt    *time.Time `json:"expires_at"`
	Scopes       *string    `json:"scopes"`
}

type CalendarPreference struct {
	UserID       string    `db:"user_id" json:"user_id"`
	ConnectionID string    `db:"connection_id" json:"connection_id"`
	CalendarID   string    `db:"calendar_id" json:"calendar_id"`
	Visible      bool      `db:"visible" json:"visible"`
	CreatedAt    time.Time `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time `db:"updated_at" json:"updated_at"`
}
