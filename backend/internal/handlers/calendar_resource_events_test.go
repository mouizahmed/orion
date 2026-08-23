package handlers

import (
	"context"
	"testing"

	calendarservice "github.com/mouizahmed/justscribe-backend/internal/calendar"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
)

type recordingResourcePublisher struct {
	resources   []resourceevents.Resource
	resourceIDs []*string
}

func (publisher *recordingResourcePublisher) PublishChanged(_ context.Context, _ string, resource resourceevents.Resource, resourceID *string) error {
	publisher.resources = append(publisher.resources, resource)
	if resourceID == nil {
		publisher.resourceIDs = append(publisher.resourceIDs, nil)
	} else {
		copy := *resourceID
		publisher.resourceIDs = append(publisher.resourceIDs, &copy)
	}
	return nil
}

func TestCalendarSyncPublishesResourcesForScope(t *testing.T) {
	tests := []struct {
		name  string
		scope calendarservice.SyncScope
		want  []resourceevents.Resource
	}{
		{"calendars", calendarservice.SyncScopeCalendars, []resourceevents.Resource{resourceevents.ResourceCalendarSettings}},
		{"events", calendarservice.SyncScopeEvents, []resourceevents.Resource{resourceevents.ResourceCalendarEvents}},
		{"all", calendarservice.SyncScopeAll, []resourceevents.Resource{resourceevents.ResourceCalendarSettings, resourceevents.ResourceCalendarEvents}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			publisher := &recordingResourcePublisher{}
			(&CalendarHandler{events: publisher}).publishSyncChanges(context.Background(), "8f648b85-e709-499b-af4b-845d4f88cd6c", test.scope)
			if len(publisher.resources) != len(test.want) {
				t.Fatalf("published %v, want %v", publisher.resources, test.want)
			}
			for index := range test.want {
				if publisher.resources[index] != test.want[index] {
					t.Fatalf("published %v, want %v", publisher.resources, test.want)
				}
			}
		})
	}
}

func TestCalendarSyncPublishesTargetedNoteInvalidations(t *testing.T) {
	publisher := &recordingResourcePublisher{}
	handler := &CalendarHandler{events: publisher}
	handler.publishChangedNotes(context.Background(), "8f648b85-e709-499b-af4b-845d4f88cd6c", []string{"note-one", "note-one", "", "note-two"})

	if len(publisher.resources) != 2 {
		t.Fatalf("published %d invalidations, want 2", len(publisher.resources))
	}
	for index, wantID := range []string{"note-one", "note-two"} {
		if publisher.resources[index] != resourceevents.ResourceNotes || publisher.resourceIDs[index] == nil || *publisher.resourceIDs[index] != wantID {
			t.Fatalf("publication %d = %v/%v, want notes/%s", index, publisher.resources[index], publisher.resourceIDs[index], wantID)
		}
	}
}
