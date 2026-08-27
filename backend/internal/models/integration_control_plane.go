package models

import (
	"encoding/json"
	"time"
)

type IntegrationJob struct {
	ID                  string
	UserID              string
	ConnectionID        *string
	CapabilityKey       string
	ProviderResourceKey string
	Kind                string
	IdempotencyKey      string
	Payload             json.RawMessage
	Status              string
	Attempts            int
	MaxAttempts         int
	AvailableAt         time.Time
	LeaseExpiresAt      *time.Time
}

type IntegrationOutboxEvent struct {
	ID             string
	UserID         string
	SubscriptionID *string
	EventType      string
	AggregateType  string
	AggregateID    string
	IdempotencyKey string
	Payload        json.RawMessage
	Status         string
	Attempts       int
	MaxAttempts    int
	AvailableAt    time.Time
	LeaseExpiresAt *time.Time
}

type IntegrationDeliveryAttempt struct {
	Outcome        string
	ResponseStatus *int
	ErrorCode      *string
}
