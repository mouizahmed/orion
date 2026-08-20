package resourceevents

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	SchemaVersion   = 1
	RedisChannel    = "orion:resource-events:v1"
	MaxMessageBytes = 4 * 1024
)

type Resource string

const (
	ResourceVocabulary       Resource = "vocabulary"
	ResourceCalendarSettings Resource = "calendar_settings"
	ResourceCalendarEvents   Resource = "calendar_events"
	ResourceBillingStatus    Resource = "billing_status"
	ResourceExtractFields    Resource = "extract_fields"
)

func (r Resource) Valid() bool {
	switch r {
	case ResourceVocabulary,
		ResourceCalendarSettings,
		ResourceCalendarEvents,
		ResourceBillingStatus,
		ResourceExtractFields:
		return true
	default:
		return false
	}
}

type Change struct {
	Version    int       `json:"version"`
	EventID    string    `json:"event_id"`
	Resource   Resource  `json:"resource"`
	ResourceID *string   `json:"resource_id,omitempty"`
	OccurredAt time.Time `json:"occurred_at"`
}

type Envelope struct {
	AccountID string `json:"account_id"`
	Event     Change `json:"event"`
}

func NewChange(resource Resource, resourceID *string) (Change, error) {
	change := Change{
		Version:    SchemaVersion,
		EventID:    uuid.NewString(),
		Resource:   resource,
		ResourceID: resourceID,
		OccurredAt: time.Now().UTC(),
	}
	if err := change.Validate(); err != nil {
		return Change{}, err
	}
	return change, nil
}

func (c Change) Validate() error {
	if c.Version != SchemaVersion {
		return fmt.Errorf("unsupported resource event version")
	}
	if _, err := uuid.Parse(c.EventID); err != nil {
		return fmt.Errorf("invalid resource event id")
	}
	if !c.Resource.Valid() {
		return fmt.Errorf("unsupported resource")
	}
	if c.ResourceID != nil {
		if _, err := uuid.Parse(*c.ResourceID); err != nil {
			return fmt.Errorf("invalid resource id")
		}
	}
	if c.OccurredAt.IsZero() {
		return fmt.Errorf("missing resource event timestamp")
	}
	return nil
}

func (e Envelope) Validate() error {
	if _, err := uuid.Parse(e.AccountID); err != nil {
		return fmt.Errorf("invalid account id")
	}
	return e.Event.Validate()
}
