package handlers

import (
	"testing"
	"time"

	calendarservice "github.com/mouizahmed/justscribe-backend/internal/calendar"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

func TestCalendarCacheMetadataTreatsErrorAndExpiredSyncAsStale(t *testing.T) {
	now := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	windowStart, windowEnd := calendarservice.AnchoredSyncWindow(now)
	lastSync := now.Add(-time.Minute)
	errorText := "calendar sync failed"

	metadata := calendarCacheMetadataFromStates([]*models.CalendarSyncState{{
		EventsStatus:       "error",
		EventsLastSyncedAt: &lastSync,
		EventsLastError:    &errorText,
		EventsWindowStart:  &windowStart,
		EventsWindowEnd:    &windowEnd,
	}}, calendarservice.SyncScopeEvents, now)
	if !metadata.Stale || metadata.LastError != errorText {
		t.Fatalf("error state must be stale: %#v", metadata)
	}

	oldStart := now.Add(-3 * time.Minute)
	metadata = calendarCacheMetadataFromStates([]*models.CalendarSyncState{{
		EventsStatus:        "syncing",
		EventsSyncStartedAt: &oldStart,
		EventsLastSyncedAt:  &lastSync,
		EventsWindowStart:   &windowStart,
		EventsWindowEnd:     &windowEnd,
	}}, calendarservice.SyncScopeEvents, now)
	if !metadata.Stale || metadata.Syncing {
		t.Fatalf("expired sync must be retryable stale state: %#v", metadata)
	}
}

func TestCalendarCacheMetadataRecognizesActiveSync(t *testing.T) {
	now := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	windowStart, windowEnd := calendarservice.AnchoredSyncWindow(now)
	started := now.Add(-time.Minute)
	lastSync := now.Add(-time.Minute)
	metadata := calendarCacheMetadataFromStates([]*models.CalendarSyncState{{
		EventsStatus:        "syncing",
		EventsSyncStartedAt: &started,
		EventsLastSyncedAt:  &lastSync,
		EventsWindowStart:   &windowStart,
		EventsWindowEnd:     &windowEnd,
	}}, calendarservice.SyncScopeEvents, now)
	if !metadata.Syncing || metadata.Stale {
		t.Fatalf("active sync should coalesce stale triggers: %#v", metadata)
	}
}
