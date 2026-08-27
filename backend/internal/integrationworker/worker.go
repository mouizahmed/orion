package integrationworker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	calendarservice "github.com/mouizahmed/justscribe-backend/internal/calendar"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
	"golang.org/x/sync/semaphore"
)

const CalendarSyncJobKind = "calendar.sync"

type calendarSyncer interface {
	SyncUser(context.Context, string, calendarservice.SyncScope) ([]string, error)
}

type controlPlane interface {
	ListDueJobTenants(context.Context, int) ([]string, error)
	ClaimJobs(context.Context, string, string, int, time.Duration) ([]models.IntegrationJob, error)
	CompleteJob(context.Context, string, string, string) error
	FailJob(context.Context, string, string, string, string, time.Time) error
	DeadLetterJob(context.Context, string, string, string, string) error
	PurgeExpiredControlPlane(context.Context, int) (int64, int64, int64, error)
}

type Worker struct {
	repository controlPlane
	calendar   calendarSyncer
	events     resourceevents.Publisher
	notify     func(userID string, syncing, stale bool)
	workerID   string
	parallel   *semaphore.Weighted
	lastPurge  time.Time
}

func New(repository controlPlane, calendar calendarSyncer, events resourceevents.Publisher, notify func(userID string, syncing, stale bool)) *Worker {
	return &Worker{
		repository: repository,
		calendar:   calendar,
		events:     events,
		notify:     notify,
		workerID:   "integration-" + uuid.NewString(),
		parallel:   semaphore.NewWeighted(4),
	}
}

func (w *Worker) Start(ctx context.Context) {
	if w == nil || w.repository == nil || w.calendar == nil {
		log.Println("integration worker: dependencies unavailable, worker disabled")
		return
	}
	log.Println("integration worker: started")
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		w.dispatchDue(ctx)
		w.purgeExpired(ctx)
		select {
		case <-ctx.Done():
			log.Println("integration worker: shutting down")
			return
		case <-ticker.C:
		}
	}
}

func (w *Worker) purgeExpired(ctx context.Context) {
	if !w.lastPurge.IsZero() && time.Since(w.lastPurge) < time.Hour {
		return
	}
	w.lastPurge = time.Now()
	jobs, receipts, outbox, err := w.repository.PurgeExpiredControlPlane(ctx, 1000)
	if err != nil {
		log.Printf("integration worker: retention purge failed: %v", err)
		return
	}
	if jobs+receipts+outbox > 0 {
		log.Printf("integration worker: purged terminal records jobs=%d receipts=%d outbox=%d", jobs, receipts, outbox)
	}
}

func (w *Worker) dispatchDue(ctx context.Context) {
	tenants, err := w.repository.ListDueJobTenants(ctx, 100)
	if err != nil {
		log.Printf("integration worker: tenant discovery failed: %v", err)
		return
	}
	for _, userID := range tenants {
		jobs, err := w.repository.ClaimJobs(ctx, userID, w.workerID, 10, 3*time.Minute)
		if err != nil {
			log.Printf("integration worker: job claim failed: %v", err)
			continue
		}
		for i := range jobs {
			job := jobs[i]
			if err := w.parallel.Acquire(ctx, 1); err != nil {
				return
			}
			go func() {
				defer w.parallel.Release(1)
				w.process(ctx, job)
			}()
		}
	}
}

func (w *Worker) process(parent context.Context, job models.IntegrationJob) {
	ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
	defer cancel()
	stale := true
	defer func() {
		if w.notify != nil {
			w.notify(job.UserID, false, stale)
		}
	}()
	if job.Kind != CalendarSyncJobKind {
		_ = w.repository.DeadLetterJob(ctx, job.UserID, job.ID, w.workerID, "unsupported_job_kind")
		return
	}
	var payload struct {
		Scope calendarservice.SyncScope `json:"scope"`
	}
	if err := json.Unmarshal(job.Payload, &payload); err != nil || !validCalendarScope(payload.Scope) {
		_ = w.repository.DeadLetterJob(ctx, job.UserID, job.ID, w.workerID, "invalid_job_payload")
		return
	}
	noteIDs, err := w.calendar.SyncUser(ctx, job.UserID, payload.Scope)
	if err != nil {
		log.Printf("integration worker: calendar sync failed for user %s: %v", job.UserID, err)
		if failErr := w.repository.FailJob(context.Background(), job.UserID, job.ID, w.workerID, "calendar_sync_failed", time.Now().Add(retryDelay(job.Attempts))); failErr != nil {
			log.Printf("integration worker: failed to reschedule calendar job: %v", failErr)
		}
		w.publish(job.UserID, payload.Scope, noteIDs)
		return
	}
	if err := w.repository.CompleteJob(context.Background(), job.UserID, job.ID, w.workerID); err != nil {
		log.Printf("integration worker: failed to complete calendar job: %v", err)
		w.publish(job.UserID, payload.Scope, noteIDs)
		return
	}
	stale = false
	w.publish(job.UserID, payload.Scope, noteIDs)
}

func (w *Worker) publish(userID string, scope calendarservice.SyncScope, noteIDs []string) {
	ctx := context.Background()
	if scope == calendarservice.SyncScopeAll || scope == calendarservice.SyncScopeCalendars {
		resourceevents.PublishBestEffort(ctx, w.events, userID, resourceevents.ResourceCalendarSettings, nil)
	}
	if scope == calendarservice.SyncScopeAll || scope == calendarservice.SyncScopeEvents {
		resourceevents.PublishBestEffort(ctx, w.events, userID, resourceevents.ResourceCalendarEvents, nil)
	}
	seen := make(map[string]struct{}, len(noteIDs))
	for _, noteID := range noteIDs {
		if _, exists := seen[noteID]; noteID == "" || exists {
			continue
		}
		seen[noteID] = struct{}{}
		resourceevents.PublishBestEffort(ctx, w.events, userID, resourceevents.ResourceNotes, &noteID)
	}
}

func validCalendarScope(scope calendarservice.SyncScope) bool {
	return scope == calendarservice.SyncScopeAll || scope == calendarservice.SyncScopeCalendars || scope == calendarservice.SyncScopeEvents
}

func retryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := time.Duration(1<<min(attempt-1, 8)) * 5 * time.Second
	if delay > 15*time.Minute {
		return 15 * time.Minute
	}
	return delay
}

func CalendarSyncJob(userID string, scope calendarservice.SyncScope, now time.Time) (*models.IntegrationJob, error) {
	if _, err := uuid.Parse(userID); err != nil || !validCalendarScope(scope) {
		return nil, fmt.Errorf("invalid calendar sync job")
	}
	payload, err := json.Marshal(struct {
		Scope calendarservice.SyncScope `json:"scope"`
	}{Scope: scope})
	if err != nil {
		return nil, err
	}
	// A short bucket coalesces stale reads and repeated button presses, while a
	// completed bucket never prevents a later refresh from being queued.
	bucket := now.UTC().Truncate(15 * time.Second).Unix()
	return &models.IntegrationJob{
		UserID:         userID,
		CapabilityKey:  "calendar.read",
		Kind:           CalendarSyncJobKind,
		IdempotencyKey: fmt.Sprintf("calendar:%s:%d", scope, bucket),
		Payload:        payload,
		MaxAttempts:    8,
		AvailableAt:    now.UTC(),
	}, nil
}
