package integrationworker

import (
	"context"
	"errors"
	"testing"
	"time"

	calendarservice "github.com/mouizahmed/justscribe-backend/internal/calendar"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type fakeControlPlane struct {
	completed bool
	failed    bool
}

func (*fakeControlPlane) ListDueJobTenants(context.Context, int) ([]string, error) { return nil, nil }
func (*fakeControlPlane) ClaimJobs(context.Context, string, string, int, time.Duration) ([]models.IntegrationJob, error) {
	return nil, nil
}
func (f *fakeControlPlane) CompleteJob(context.Context, string, string, string) error {
	f.completed = true
	return nil
}
func (f *fakeControlPlane) FailJob(context.Context, string, string, string, string, time.Time) error {
	f.failed = true
	return nil
}
func (*fakeControlPlane) DeadLetterJob(context.Context, string, string, string, string) error {
	return nil
}
func (*fakeControlPlane) PurgeExpiredControlPlane(context.Context, int) (int64, int64, int64, error) {
	return 0, 0, 0, nil
}

type fakeCalendarSyncer struct{ err error }

func (f fakeCalendarSyncer) SyncUser(context.Context, string, calendarservice.SyncScope) ([]string, error) {
	return []string{"note-1"}, f.err
}

func TestCalendarSyncJobCoalescesOnlyWithinBucket(t *testing.T) {
	now := time.Date(2026, 8, 27, 12, 0, 7, 0, time.UTC)
	first, err := CalendarSyncJob("10a0ed8f-bcb7-4394-a0e6-a83e44cf4e54", calendarservice.SyncScopeEvents, now)
	if err != nil {
		t.Fatal(err)
	}
	same, _ := CalendarSyncJob(first.UserID, calendarservice.SyncScopeEvents, now.Add(7*time.Second))
	next, _ := CalendarSyncJob(first.UserID, calendarservice.SyncScopeEvents, now.Add(9*time.Second))
	if first.IdempotencyKey != same.IdempotencyKey {
		t.Fatal("jobs in one bucket should coalesce")
	}
	if first.IdempotencyKey == next.IdempotencyKey {
		t.Fatal("later bucket should permit another refresh")
	}
}

func TestRetryDelayIsBounded(t *testing.T) {
	if retryDelay(1) != 5*time.Second {
		t.Fatalf("unexpected first retry: %s", retryDelay(1))
	}
	if retryDelay(100) != 15*time.Minute {
		t.Fatalf("retry cap not applied: %s", retryDelay(100))
	}
}

func TestProcessCompletesAndClearsSyncing(t *testing.T) {
	repository := &fakeControlPlane{}
	var notified bool
	var stale bool
	worker := New(repository, fakeCalendarSyncer{}, nil, func(_ string, syncing, isStale bool) {
		notified = !syncing
		stale = isStale
	})
	worker.process(context.Background(), models.IntegrationJob{
		ID: "job-1", UserID: "10a0ed8f-bcb7-4394-a0e6-a83e44cf4e54",
		Kind: CalendarSyncJobKind, Payload: []byte(`{"scope":"events"}`), Attempts: 1,
	})
	if !repository.completed || repository.failed || !notified || stale {
		t.Fatalf("unexpected completion state: %#v notified=%v stale=%v", repository, notified, stale)
	}
}

func TestProcessReschedulesFailureAndClearsSyncingAsStale(t *testing.T) {
	repository := &fakeControlPlane{}
	var notified bool
	var stale bool
	worker := New(repository, fakeCalendarSyncer{err: errors.New("provider failed")}, nil, func(_ string, syncing, isStale bool) {
		notified = !syncing
		stale = isStale
	})
	worker.process(context.Background(), models.IntegrationJob{
		ID: "job-1", UserID: "10a0ed8f-bcb7-4394-a0e6-a83e44cf4e54",
		Kind: CalendarSyncJobKind, Payload: []byte(`{"scope":"events"}`), Attempts: 1,
	})
	if repository.completed || !repository.failed || !notified || !stale {
		t.Fatalf("unexpected failure state: %#v notified=%v stale=%v", repository, notified, stale)
	}
}
