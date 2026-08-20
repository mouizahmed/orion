package resourceevents

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestChangeValidation(t *testing.T) {
	valid := Change{Version: SchemaVersion, EventID: uuid.NewString(), Resource: ResourceVocabulary, OccurredAt: time.Now().UTC()}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid event rejected: %v", err)
	}
	tests := []struct {
		name   string
		mutate func(*Change)
	}{
		{"version", func(change *Change) { change.Version = 2 }},
		{"event id", func(change *Change) { change.EventID = "not-a-uuid" }},
		{"resource", func(change *Change) { change.Resource = "unknown" }},
		{"timestamp", func(change *Change) { change.OccurredAt = time.Time{} }},
		{"resource id", func(change *Change) { value := "not-a-uuid"; change.ResourceID = &value }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			change := valid
			test.mutate(&change)
			if err := change.Validate(); err == nil {
				t.Fatal("invalid event accepted")
			}
		})
	}
}

func TestEnvelopeRejectsInvalidAccount(t *testing.T) {
	change, err := NewChange(ResourceCalendarSettings, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := (Envelope{AccountID: "wrong-account", Event: change}).Validate(); err == nil {
		t.Fatal("invalid account accepted")
	}
}
