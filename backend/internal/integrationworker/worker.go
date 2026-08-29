package integrationworker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
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
	SyncConnection(context.Context, string, string, calendarservice.SyncScope) ([]string, error)
	ForceFullSyncConnection(context.Context, string, string) ([]string, error)
}

type controlPlane interface {
	ListDueJobTenants(context.Context, int) ([]string, error)
	ListDueCalendarSyncConnections(context.Context, time.Duration, time.Duration, int) ([]models.DueCalendarConnection, error)
	EnqueueJob(context.Context, *models.IntegrationJob) (string, error)
	ClaimJobs(context.Context, string, string, int, time.Duration) ([]models.IntegrationJob, error)
	CompleteJob(context.Context, string, string, string) error
	FailJob(context.Context, string, string, string, string, time.Time) error
	DeadLetterJob(context.Context, string, string, string, string) error
	PurgeExpiredControlPlane(context.Context, int) (int64, int64, int64, error)
}

type subscriptionLifecycle interface {
	ReconcileConnection(context.Context, string, string) error
}

type Worker struct {
	repository                 controlPlane
	calendar                   calendarSyncer
	events                     resourceevents.Publisher
	notify                     func(userID string, syncing, stale bool)
	workerID                   string
	parallel                   *semaphore.Weighted
	lastPurge                  time.Time
	lastSchedule               time.Time
	reconciliationInterval     time.Duration
	fullReconciliationInterval time.Duration
	schedulerInterval          time.Duration
	subscriptions              subscriptionLifecycle
}

func (w *Worker) SetSubscriptionLifecycle(lifecycle subscriptionLifecycle) {
	w.subscriptions = lifecycle
}

func New(repository controlPlane, calendar calendarSyncer, events resourceevents.Publisher, notify func(userID string, syncing, stale bool)) *Worker {
	return &Worker{
		repository:                 repository,
		calendar:                   calendar,
		events:                     events,
		notify:                     notify,
		workerID:                   "integration-" + uuid.NewString(),
		parallel:                   semaphore.NewWeighted(4),
		reconciliationInterval:     durationFromEnv("CALENDAR_RECONCILIATION_INTERVAL", 5*time.Minute, time.Minute, 24*time.Hour),
		fullReconciliationInterval: durationFromEnv("CALENDAR_FULL_RECONCILIATION_INTERVAL", 7*24*time.Hour, 24*time.Hour, 30*24*time.Hour),
		schedulerInterval:          durationFromEnv("CALENDAR_SCHEDULER_INTERVAL", 30*time.Second, 10*time.Second, 5*time.Minute),
	}
}

func (w *Worker) Start(ctx context.Context) {
	if w == nil || w.repository == nil || w.calendar == nil {
		log.Println("integration worker: dependencies unavailable, worker disabled")
		return
	}
	log.Printf("integration worker: started calendar_reconciliation=%s calendar_full_reconciliation=%s calendar_scheduler=%s",
		w.reconciliationInterval, w.fullReconciliationInterval, w.schedulerInterval)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		w.enqueueScheduledSyncs(ctx)
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

func (w *Worker) enqueueScheduledSyncs(ctx context.Context) {
	if !w.lastSchedule.IsZero() && time.Since(w.lastSchedule) < w.schedulerInterval {
		return
	}
	w.lastSchedule = time.Now()
	due, err := w.repository.ListDueCalendarSyncConnections(ctx, w.reconciliationInterval, w.fullReconciliationInterval, 250)
	if err != nil {
		log.Printf("integration worker: calendar schedule discovery failed: %v", err)
		return
	}
	for _, item := range due {
		var job *models.IntegrationJob
		if item.ForceFull {
			job, err = CalendarConnectionFullSyncJob(item.UserID, item.ConnectionID, time.Now())
		} else {
			job, err = CalendarConnectionSyncJob(item.UserID, item.ConnectionID, calendarservice.SyncScopeAll, time.Now(), w.reconciliationInterval)
		}
		if err != nil {
			log.Printf("integration worker: invalid scheduled calendar connection: %v", err)
			continue
		}
		if _, err := w.repository.EnqueueJob(ctx, job); err != nil {
			log.Printf("integration worker: failed to enqueue scheduled calendar sync: %v", err)
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
		Scope        calendarservice.SyncScope `json:"scope"`
		ConnectionID string                    `json:"connection_id,omitempty"`
		ForceFull    bool                      `json:"force_full,omitempty"`
	}
	if err := json.Unmarshal(job.Payload, &payload); err != nil || !validCalendarScope(payload.Scope) {
		_ = w.repository.DeadLetterJob(ctx, job.UserID, job.ID, w.workerID, "invalid_job_payload")
		return
	}
	connectionID := strings.TrimSpace(payload.ConnectionID)
	if connectionID == "" && job.ConnectionID != nil {
		connectionID = strings.TrimSpace(*job.ConnectionID)
	}
	var noteIDs []string
	var err error
	if connectionID != "" && payload.ForceFull {
		noteIDs, err = w.calendar.ForceFullSyncConnection(ctx, job.UserID, connectionID)
	} else if connectionID != "" {
		noteIDs, err = w.calendar.SyncConnection(ctx, job.UserID, connectionID, payload.Scope)
	} else {
		noteIDs, err = w.calendar.SyncUser(ctx, job.UserID, payload.Scope)
	}
	if err != nil {
		log.Printf("integration worker: calendar sync failed for user %s: %v", job.UserID, err)
		if failErr := w.repository.FailJob(context.Background(), job.UserID, job.ID, w.workerID, "calendar_sync_failed", time.Now().Add(retryDelay(job.Attempts))); failErr != nil {
			log.Printf("integration worker: failed to reschedule calendar job: %v", failErr)
		}
		w.publish(job.UserID, payload.Scope, noteIDs)
		return
	}
	if connectionID != "" && w.subscriptions != nil {
		if lifecycleErr := w.subscriptions.ReconcileConnection(ctx, job.UserID, connectionID); lifecycleErr != nil {
			log.Printf("integration worker: calendar subscription reconciliation failed for user %s: %v", job.UserID, lifecycleErr)
			if failErr := w.repository.FailJob(context.Background(), job.UserID, job.ID, w.workerID, "calendar_subscription_reconcile_failed", time.Now().Add(retryDelay(job.Attempts))); failErr != nil {
				log.Printf("integration worker: failed to reschedule calendar subscription job: %v", failErr)
			}
			w.publish(job.UserID, payload.Scope, noteIDs)
			return
		}
	}
	if err := w.repository.CompleteJob(context.Background(), job.UserID, job.ID, w.workerID); err != nil {
		log.Printf("integration worker: failed to complete calendar job: %v", err)
		w.publish(job.UserID, payload.Scope, noteIDs)
		return
	}
	stale = false
	w.publish(job.UserID, payload.Scope, noteIDs)
}

func CalendarConnectionFullSyncJob(userID, connectionID string, now time.Time) (*models.IntegrationJob, error) {
	job, err := CalendarConnectionSyncJob(userID, connectionID, calendarservice.SyncScopeAll, now, 15*time.Second)
	if err != nil {
		return nil, err
	}
	job.IdempotencyKey = fmt.Sprintf("calendar:%s:full:%d", connectionID, now.UTC().Truncate(15*time.Second).Unix())
	job.Payload, err = json.Marshal(struct {
		Scope        calendarservice.SyncScope `json:"scope"`
		ConnectionID string                    `json:"connection_id"`
		ForceFull    bool                      `json:"force_full"`
	}{Scope: calendarservice.SyncScopeAll, ConnectionID: connectionID, ForceFull: true})
	return job, err
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

func CalendarConnectionSyncJob(userID, connectionID string, scope calendarservice.SyncScope, now time.Time, bucketSize time.Duration) (*models.IntegrationJob, error) {
	if _, err := uuid.Parse(userID); err != nil || !validCalendarScope(scope) {
		return nil, fmt.Errorf("invalid calendar sync job")
	}
	if _, err := uuid.Parse(connectionID); err != nil {
		return nil, fmt.Errorf("invalid calendar connection sync job")
	}
	if bucketSize < 15*time.Second {
		bucketSize = 15 * time.Second
	}
	payload, err := json.Marshal(struct {
		Scope        calendarservice.SyncScope `json:"scope"`
		ConnectionID string                    `json:"connection_id"`
	}{Scope: scope, ConnectionID: connectionID})
	if err != nil {
		return nil, err
	}
	bucket := now.UTC().Truncate(bucketSize).Unix()
	return &models.IntegrationJob{
		UserID: userID, ConnectionID: &connectionID, CapabilityKey: "calendar.read",
		Kind:           CalendarSyncJobKind,
		IdempotencyKey: fmt.Sprintf("calendar:%s:%s:%d", connectionID, scope, bucket),
		Payload:        payload, MaxAttempts: 8, AvailableAt: now.UTC(),
	}, nil
}

func durationFromEnv(name string, fallback, minimum, maximum time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	if seconds, err := strconv.Atoi(raw); err == nil {
		raw = fmt.Sprintf("%ds", seconds)
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value < minimum || value > maximum {
		return fallback
	}
	return value
}
