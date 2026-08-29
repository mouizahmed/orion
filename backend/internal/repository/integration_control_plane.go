package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type IntegrationControlPlaneRepository struct {
	db *database.DB
}

func NewIntegrationControlPlaneRepository(db *database.DB) *IntegrationControlPlaneRepository {
	return &IntegrationControlPlaneRepository{db: db}
}

// ListDueJobTenants uses a deliberately narrow security-definer function so a
// worker can discover tenants with due work without bypassing tenant RLS for
// job payloads or any other connector data.
func (r *IntegrationControlPlaneRepository) ListDueJobTenants(ctx context.Context, limit int) ([]string, error) {
	if limit < 1 || limit > 1000 {
		return nil, fmt.Errorf("invalid due-job tenant limit")
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT user_id::text
		FROM orion_internal.integration_job_tenants_due($1)
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list due integration job tenants: %w", err)
	}
	defer rows.Close()
	tenants := []string{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, fmt.Errorf("scan due integration job tenant: %w", err)
		}
		tenants = append(tenants, userID)
	}
	return tenants, rows.Err()
}

func (r *IntegrationControlPlaneRepository) ListDueCalendarSyncConnections(ctx context.Context, staleAfter, fullAfter time.Duration, limit int) ([]models.DueCalendarConnection, error) {
	if staleAfter < time.Minute || fullAfter < 24*time.Hour || limit < 1 || limit > 1000 {
		return nil, fmt.Errorf("invalid due calendar connection query")
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT user_id::text, connection_id::text, force_full
		FROM orion_internal.calendar_sync_connections_due($1::interval, $2::interval, $3)
	`, intervalString(staleAfter), intervalString(fullAfter), limit)
	if err != nil {
		return nil, fmt.Errorf("list due calendar sync connections: %w", err)
	}
	defer rows.Close()
	result := []models.DueCalendarConnection{}
	for rows.Next() {
		var item models.DueCalendarConnection
		if err := rows.Scan(&item.UserID, &item.ConnectionID, &item.ForceFull); err != nil {
			return nil, fmt.Errorf("scan due calendar sync connection: %w", err)
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *IntegrationControlPlaneRepository) ResolveCalendarWebhookSubscription(ctx context.Context, provider, providerSubscriptionID string) (*models.IntegrationWebhookSubscription, error) {
	var subscription models.IntegrationWebhookSubscription
	var expiresAt sql.NullTime
	err := r.db.QueryRowContext(ctx, `
		SELECT subscription_id::text, user_id::text, connection_id::text,
			capability_key, COALESCE(watched_resource_id, ''), COALESCE(provider_resource_id, ''),
			COALESCE(verification_secret_hash, ''), status, expires_at
		FROM orion_internal.resolve_calendar_webhook_subscription($1, $2)
	`, provider, providerSubscriptionID).Scan(
		&subscription.ID, &subscription.UserID, &subscription.ConnectionID,
		&subscription.CapabilityKey, &subscription.WatchedResourceID, &subscription.ProviderResourceID,
		&subscription.VerificationSecretHash, &subscription.Status, &expiresAt,
	)
	if err != nil {
		return nil, err
	}
	subscription.Provider = provider
	if expiresAt.Valid {
		subscription.ExpiresAt = &expiresAt.Time
	}
	return &subscription, nil
}

func (r *IntegrationControlPlaneRepository) ListCalendarWebhookSubscriptions(ctx context.Context, userID, connectionID string) ([]models.IntegrationWebhookSubscription, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("begin webhook subscription list: %w", err)
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `
		SELECT id::text, user_id::text, connection_id::text, provider, capability_key,
			COALESCE(provider_subscription_id, ''), COALESCE(watched_resource_id, ''),
			COALESCE(provider_resource_id, ''), supersedes_subscription_id::text,
			generation, COALESCE(callback_url, ''), COALESCE(verification_secret_hash, ''),
			status, expires_at, renewal_attempted_at, next_attempt_at,
			last_notification_at, last_error_code
		FROM integration_webhook_subscriptions
		WHERE user_id = $1 AND connection_id = $2 AND direction = 'inbound'
		ORDER BY watched_resource_id, generation DESC
	`, userID, connectionID)
	if err != nil {
		return nil, fmt.Errorf("list webhook subscriptions: %w", err)
	}
	defer rows.Close()
	result := []models.IntegrationWebhookSubscription{}
	for rows.Next() {
		item, err := scanWebhookSubscription(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return result, tx.Commit()
}

func (r *IntegrationControlPlaneRepository) CreatePendingCalendarWebhookSubscription(ctx context.Context, subscription *models.IntegrationWebhookSubscription) (string, error) {
	if subscription == nil || subscription.UserID == "" || subscription.ConnectionID == "" || subscription.Provider == "" || subscription.ProviderSubscriptionID == "" || subscription.WatchedResourceID == "" || subscription.VerificationSecretHash == "" {
		return "", fmt.Errorf("invalid pending calendar webhook subscription")
	}
	tx, err := r.db.BeginTenantTx(ctx, subscription.UserID, nil)
	if err != nil {
		return "", fmt.Errorf("begin webhook subscription create: %w", err)
	}
	defer tx.Rollback()
	var id string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO integration_webhook_subscriptions (
			user_id, connection_id, provider, capability_key, direction,
			provider_subscription_id, watched_resource_id, supersedes_subscription_id,
			generation, callback_url, verification_secret_hash, status, next_attempt_at
		) VALUES ($1,$2,$3,'calendar.read','inbound',$4,$5,$6,
			COALESCE((SELECT max(generation) + 1 FROM integration_webhook_subscriptions
			 WHERE user_id = $1 AND connection_id = $2 AND watched_resource_id = $5), 1),
			$7,$8,'pending',now())
		RETURNING id::text, generation
	`, subscription.UserID, subscription.ConnectionID, subscription.Provider,
		subscription.ProviderSubscriptionID, subscription.WatchedResourceID,
		subscription.SupersedesID, subscription.CallbackURL,
		subscription.VerificationSecretHash).Scan(&id, &subscription.Generation)
	if err != nil {
		return "", fmt.Errorf("create pending webhook subscription: %w", err)
	}
	return id, tx.Commit()
}

func (r *IntegrationControlPlaneRepository) ActivateCalendarWebhookSubscription(ctx context.Context, userID, id, providerResourceID string, expiresAt time.Time) error {
	return r.execTenant(ctx, userID, `
		UPDATE integration_webhook_subscriptions
		SET provider_resource_id = NULLIF($3, ''), expires_at = $4, status = 'active',
			next_attempt_at = NULL, last_error_code = NULL, updated_at = now()
		WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'renewing')
	`, "activate calendar webhook subscription", id, userID, providerResourceID, expiresAt)
}

func (r *IntegrationControlPlaneRepository) UpdateCalendarWebhookSubscriptionState(ctx context.Context, userID, id, status, errorCode string, nextAttemptAt *time.Time) error {
	return r.execTenant(ctx, userID, `
		UPDATE integration_webhook_subscriptions
		SET status = $3, last_error_code = NULLIF($4, ''), next_attempt_at = $5,
			renewal_attempted_at = CASE WHEN $3 IN ('renewing', 'failed') THEN now() ELSE renewal_attempted_at END,
			updated_at = now()
		WHERE id = $1 AND user_id = $2
	`, "update calendar webhook subscription", id, userID, status, safeOperationalCode(errorCode), nextAttemptAt)
}

func (r *IntegrationControlPlaneRepository) TouchCalendarWebhookSubscription(ctx context.Context, userID, id string) error {
	return r.execTenant(ctx, userID, `
		UPDATE integration_webhook_subscriptions
		SET last_notification_at = now(), updated_at = now()
		WHERE id = $1 AND user_id = $2
	`, "touch calendar webhook subscription", id, userID)
}

func (r *IntegrationControlPlaneRepository) RenewCalendarWebhookSubscription(ctx context.Context, userID, id string, expiresAt time.Time) error {
	return r.execTenant(ctx, userID, `
		UPDATE integration_webhook_subscriptions
		SET expires_at = $3, status = 'active', renewal_attempted_at = now(),
			next_attempt_at = NULL, last_error_code = NULL, updated_at = now()
		WHERE id = $1 AND user_id = $2
	`, "renew calendar webhook subscription", id, userID, expiresAt)
}

func (r *IntegrationControlPlaneRepository) AcceptCalendarWebhook(ctx context.Context, subscription *models.IntegrationWebhookSubscription, providerEventID string, payload []byte, job *models.IntegrationJob) (bool, error) {
	if subscription == nil || job == nil || subscription.UserID != job.UserID || providerEventID == "" {
		return false, fmt.Errorf("invalid calendar webhook acceptance")
	}
	digest := sha256.Sum256(payload)
	tx, err := r.db.BeginTenantTx(ctx, subscription.UserID, nil)
	if err != nil {
		return false, fmt.Errorf("begin calendar webhook acceptance: %w", err)
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
		INSERT INTO integration_webhook_receipts (
			user_id, connection_id, provider, capability_key, provider_event_id, payload_sha256,
			status, processed_at
		) VALUES ($1,$2,$3,$4,$5,$6,'processed',now())
		ON CONFLICT (user_id, provider, capability_key, provider_event_id) DO NOTHING
	`, subscription.UserID, subscription.ConnectionID, subscription.Provider,
		subscription.CapabilityKey, providerEventID, hex.EncodeToString(digest[:]))
	if err != nil {
		return false, fmt.Errorf("record calendar webhook receipt: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if rows == 0 {
		return false, tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE integration_webhook_subscriptions
		SET last_notification_at = now(), updated_at = now()
		WHERE id = $1 AND user_id = $2
	`, subscription.ID, subscription.UserID); err != nil {
		return false, fmt.Errorf("touch accepted webhook subscription: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO integration_jobs (
			user_id, connection_id, capability_key, provider_resource_key,
			job_kind, idempotency_key, payload, max_attempts, available_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (user_id, job_kind, idempotency_key) DO UPDATE SET updated_at = now()
	`, job.UserID, job.ConnectionID, job.CapabilityKey, job.ProviderResourceKey,
		job.Kind, job.IdempotencyKey, normalizedJSON(job.Payload), job.MaxAttempts, job.AvailableAt)
	if err != nil {
		return false, fmt.Errorf("enqueue accepted webhook reconciliation: %w", err)
	}
	return true, tx.Commit()
}

func (r *IntegrationControlPlaneRepository) PurgeExpiredControlPlane(ctx context.Context, limit int) (jobs, receipts, outbox int64, err error) {
	if limit < 1 || limit > 10000 {
		return 0, 0, 0, fmt.Errorf("invalid integration retention limit")
	}
	err = r.db.QueryRowContext(ctx, `
		SELECT jobs_deleted, webhook_receipts_deleted, outbox_events_deleted
		FROM orion_internal.purge_integration_control_plane($1)
	`, limit).Scan(&jobs, &receipts, &outbox)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("purge expired integration control-plane data: %w", err)
	}
	return jobs, receipts, outbox, nil
}

func (r *IntegrationControlPlaneRepository) EnqueueJob(ctx context.Context, job *models.IntegrationJob) (string, error) {
	if job == nil || job.UserID == "" || job.CapabilityKey == "" || job.Kind == "" || job.IdempotencyKey == "" {
		return "", fmt.Errorf("invalid integration job")
	}
	payload := normalizedJSON(job.Payload)
	maxAttempts := job.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 8
	}
	availableAt := job.AvailableAt
	if availableAt.IsZero() {
		availableAt = time.Now()
	}
	tx, err := r.db.BeginTenantTx(ctx, job.UserID, nil)
	if err != nil {
		return "", fmt.Errorf("begin integration job enqueue: %w", err)
	}
	defer tx.Rollback()
	var id string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO integration_jobs (
			user_id, connection_id, capability_key, provider_resource_key,
			job_kind, idempotency_key, payload, max_attempts, available_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (user_id, job_kind, idempotency_key) DO UPDATE SET
			status = CASE
				WHEN integration_jobs.status IN ('succeeded', 'dead') THEN 'pending'
				ELSE integration_jobs.status
			END,
			attempts = CASE
				WHEN integration_jobs.status IN ('succeeded', 'dead') THEN 0
				ELSE integration_jobs.attempts
			END,
			available_at = CASE
				WHEN integration_jobs.status IN ('succeeded', 'dead') THEN EXCLUDED.available_at
				ELSE integration_jobs.available_at
			END,
			leased_by = CASE
				WHEN integration_jobs.status IN ('succeeded', 'dead') THEN NULL
				ELSE integration_jobs.leased_by
			END,
			lease_expires_at = CASE
				WHEN integration_jobs.status IN ('succeeded', 'dead') THEN NULL
				ELSE integration_jobs.lease_expires_at
			END,
			last_error_code = CASE
				WHEN integration_jobs.status IN ('succeeded', 'dead') THEN NULL
				ELSE integration_jobs.last_error_code
			END,
			updated_at = now()
		RETURNING id::text
	`, job.UserID, job.ConnectionID, job.CapabilityKey, job.ProviderResourceKey,
		job.Kind, job.IdempotencyKey, payload, maxAttempts, availableAt).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("enqueue integration job: %w", err)
	}
	return id, tx.Commit()
}

func (r *IntegrationControlPlaneRepository) ClaimJobs(ctx context.Context, userID, workerID string, limit int, lease time.Duration) ([]models.IntegrationJob, error) {
	if userID == "" || workerID == "" || limit < 1 || limit > 100 || lease <= 0 {
		return nil, fmt.Errorf("invalid integration job claim")
	}
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return nil, fmt.Errorf("begin integration job claim: %w", err)
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `
		WITH due AS (
			SELECT id
			FROM integration_jobs
			WHERE user_id = $1
			  AND attempts < max_attempts
			  AND available_at <= now()
			  AND (status IN ('pending', 'failed') OR (status = 'running' AND lease_expires_at < now()))
			ORDER BY available_at, created_at
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		)
		UPDATE integration_jobs AS job
		SET status = 'running', attempts = attempts + 1, leased_by = $3,
			lease_expires_at = now() + $4::interval, updated_at = now()
		FROM due
		WHERE job.id = due.id
		RETURNING job.id::text, job.user_id::text, job.connection_id::text,
			job.capability_key, job.provider_resource_key, job.job_kind,
			job.idempotency_key, job.payload, job.status, job.attempts,
			job.max_attempts, job.available_at, job.lease_expires_at
	`, userID, limit, workerID, intervalString(lease))
	if err != nil {
		return nil, fmt.Errorf("claim integration jobs: %w", err)
	}
	defer rows.Close()
	jobs, err := scanIntegrationJobs(rows)
	if err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return jobs, tx.Commit()
}

func (r *IntegrationControlPlaneRepository) CompleteJob(ctx context.Context, userID, jobID, workerID string) error {
	return r.execTenant(ctx, userID, `
		UPDATE integration_jobs
		SET status = 'succeeded', leased_by = NULL, lease_expires_at = NULL,
			last_error_code = NULL, updated_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'running' AND leased_by = $3
	`, "complete integration job", jobID, userID, workerID)
}

func (r *IntegrationControlPlaneRepository) FailJob(ctx context.Context, userID, jobID, workerID, errorCode string, retryAt time.Time) error {
	return r.execTenant(ctx, userID, `
		UPDATE integration_jobs
		SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'failed' END,
			available_at = $4, leased_by = NULL, lease_expires_at = NULL,
			last_error_code = NULLIF($5, ''), updated_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'running' AND leased_by = $3
	`, "fail integration job", jobID, userID, workerID, retryAt, safeOperationalCode(errorCode))
}

func (r *IntegrationControlPlaneRepository) DeadLetterJob(ctx context.Context, userID, jobID, workerID, errorCode string) error {
	return r.execTenant(ctx, userID, `
		UPDATE integration_jobs
		SET status = 'dead', leased_by = NULL, lease_expires_at = NULL,
			last_error_code = NULLIF($4, ''), updated_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'running' AND leased_by = $3
	`, "dead-letter integration job", jobID, userID, workerID, safeOperationalCode(errorCode))
}

func (r *IntegrationControlPlaneRepository) RecordWebhookReceipt(ctx context.Context, userID, connectionID, provider, capabilityKey, providerEventID string, payload []byte) (bool, error) {
	digest := sha256.Sum256(payload)
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return false, fmt.Errorf("begin integration webhook receipt: %w", err)
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
		INSERT INTO integration_webhook_receipts (
			user_id, connection_id, provider, capability_key, provider_event_id, payload_sha256
		) VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (user_id, provider, capability_key, provider_event_id) DO NOTHING
	`, userID, nullString(connectionID), provider, capabilityKey, providerEventID, hex.EncodeToString(digest[:]))
	if err != nil {
		return false, fmt.Errorf("record integration webhook receipt: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows == 1, tx.Commit()
}

func EnqueueIntegrationOutboxTx(ctx context.Context, tx *sql.Tx, event *models.IntegrationOutboxEvent) (string, error) {
	if tx == nil || event == nil || event.UserID == "" || event.EventType == "" || event.AggregateType == "" || event.AggregateID == "" || event.IdempotencyKey == "" {
		return "", fmt.Errorf("invalid integration outbox event")
	}
	maxAttempts := event.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 12
	}
	availableAt := event.AvailableAt
	if availableAt.IsZero() {
		availableAt = time.Now()
	}
	var id string
	err := tx.QueryRowContext(ctx, `
		INSERT INTO integration_outbox_events (
			user_id, subscription_id, event_type, aggregate_type, aggregate_id,
			idempotency_key, payload, max_attempts, available_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (user_id, idempotency_key) DO UPDATE SET updated_at = now()
		RETURNING id::text
	`, event.UserID, event.SubscriptionID, event.EventType, event.AggregateType,
		event.AggregateID, event.IdempotencyKey, normalizedJSON(event.Payload), maxAttempts, availableAt).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("enqueue integration outbox event: %w", err)
	}
	return id, nil
}

func (r *IntegrationControlPlaneRepository) ClaimOutboxEvents(ctx context.Context, userID, workerID string, limit int, lease time.Duration) ([]models.IntegrationOutboxEvent, error) {
	if userID == "" || workerID == "" || limit < 1 || limit > 100 || lease <= 0 {
		return nil, fmt.Errorf("invalid integration outbox claim")
	}
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return nil, fmt.Errorf("begin integration outbox claim: %w", err)
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `
		WITH due AS (
			SELECT id
			FROM integration_outbox_events
			WHERE user_id = $1
			  AND attempts < max_attempts
			  AND available_at <= now()
			  AND (status IN ('pending', 'failed') OR (status = 'delivering' AND lease_expires_at < now()))
			ORDER BY available_at, created_at
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		)
		UPDATE integration_outbox_events AS event
		SET status = 'delivering', attempts = attempts + 1, leased_by = $3,
			lease_expires_at = now() + $4::interval, updated_at = now()
		FROM due
		WHERE event.id = due.id
		RETURNING event.id::text, event.user_id::text, event.subscription_id::text,
			event.event_type, event.aggregate_type, event.aggregate_id,
			event.idempotency_key, event.payload, event.status, event.attempts,
			event.max_attempts, event.available_at, event.lease_expires_at
	`, userID, limit, workerID, intervalString(lease))
	if err != nil {
		return nil, fmt.Errorf("claim integration outbox events: %w", err)
	}
	defer rows.Close()
	events, err := scanIntegrationOutboxEvents(rows)
	if err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return events, tx.Commit()
}

func (r *IntegrationControlPlaneRepository) RecordDeliveryAttempt(ctx context.Context, userID, eventID, workerID string, attempt models.IntegrationDeliveryAttempt, retryAt time.Time) error {
	if attempt.Outcome != "delivered" && attempt.Outcome != "retryable_failure" && attempt.Outcome != "permanent_failure" {
		return fmt.Errorf("invalid integration delivery outcome")
	}
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return fmt.Errorf("begin integration delivery completion: %w", err)
	}
	defer tx.Rollback()

	var attemptNumber, maxAttempts int
	if err := tx.QueryRowContext(ctx, `
		SELECT attempts, max_attempts
		FROM integration_outbox_events
		WHERE id = $1 AND user_id = $2 AND status = 'delivering' AND leased_by = $3
		FOR UPDATE
	`, eventID, userID, workerID).Scan(&attemptNumber, &maxAttempts); err != nil {
		return fmt.Errorf("lock integration outbox event: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO integration_delivery_attempts (
			user_id, outbox_event_id, attempt_number, outcome, response_status, error_code
		) VALUES ($1,$2,$3,$4,$5,$6)
	`, userID, eventID, attemptNumber, attempt.Outcome, attempt.ResponseStatus, nullableOperationalCode(attempt.ErrorCode)); err != nil {
		return fmt.Errorf("record integration delivery attempt: %w", err)
	}

	status := "dead"
	deliveredAt := false
	if attempt.Outcome == "delivered" {
		status = "delivered"
		deliveredAt = true
	} else if attempt.Outcome == "retryable_failure" && attemptNumber < maxAttempts {
		status = "failed"
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE integration_outbox_events
		SET status = $4,
			available_at = CASE WHEN $4 = 'failed' THEN $5 ELSE available_at END,
			delivered_at = CASE WHEN $6 THEN now() ELSE delivered_at END,
			leased_by = NULL, lease_expires_at = NULL,
			last_error_code = $7, updated_at = now()
		WHERE id = $1 AND user_id = $2 AND leased_by = $3
	`, eventID, userID, workerID, status, retryAt, deliveredAt, nullableOperationalCode(attempt.ErrorCode)); err != nil {
		return fmt.Errorf("complete integration outbox event: %w", err)
	}
	return tx.Commit()
}

func (r *IntegrationControlPlaneRepository) execTenant(ctx context.Context, userID, query, operation string, args ...interface{}) error {
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return fmt.Errorf("begin %s: %w", operation, err)
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, query, args...)
	if err := requireOneRow(result, err, operation); err != nil {
		return err
	}
	return tx.Commit()
}

func normalizedJSON(payload json.RawMessage) json.RawMessage {
	if len(payload) == 0 || !json.Valid(payload) {
		return json.RawMessage(`{}`)
	}
	return payload
}

func intervalString(value time.Duration) string {
	return fmt.Sprintf("%f seconds", value.Seconds())
}

func safeOperationalCode(value string) string {
	if len(value) > 120 {
		value = value[:120]
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') || character == '.' || character == '_' || character == '-' {
			continue
		}
		return "redacted_error"
	}
	return value
}

func nullableOperationalCode(value *string) interface{} {
	if value == nil || *value == "" {
		return nil
	}
	return safeOperationalCode(*value)
}

func requireOneRow(result sql.Result, err error, operation string) error {
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s: %w", operation, err)
	}
	if rows != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func scanIntegrationJobs(rows *sql.Rows) ([]models.IntegrationJob, error) {
	jobs := []models.IntegrationJob{}
	for rows.Next() {
		var job models.IntegrationJob
		var connectionID sql.NullString
		if err := rows.Scan(&job.ID, &job.UserID, &connectionID, &job.CapabilityKey,
			&job.ProviderResourceKey, &job.Kind, &job.IdempotencyKey, &job.Payload,
			&job.Status, &job.Attempts, &job.MaxAttempts, &job.AvailableAt, &job.LeaseExpiresAt); err != nil {
			return nil, fmt.Errorf("scan integration job: %w", err)
		}
		job.ConnectionID = fromNullString(connectionID)
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func scanIntegrationOutboxEvents(rows *sql.Rows) ([]models.IntegrationOutboxEvent, error) {
	events := []models.IntegrationOutboxEvent{}
	for rows.Next() {
		var event models.IntegrationOutboxEvent
		var subscriptionID sql.NullString
		if err := rows.Scan(&event.ID, &event.UserID, &subscriptionID, &event.EventType,
			&event.AggregateType, &event.AggregateID, &event.IdempotencyKey, &event.Payload,
			&event.Status, &event.Attempts, &event.MaxAttempts, &event.AvailableAt, &event.LeaseExpiresAt); err != nil {
			return nil, fmt.Errorf("scan integration outbox event: %w", err)
		}
		event.SubscriptionID = fromNullString(subscriptionID)
		events = append(events, event)
	}
	return events, rows.Err()
}

type rowScanner interface {
	Scan(...interface{}) error
}

func scanWebhookSubscription(row rowScanner) (models.IntegrationWebhookSubscription, error) {
	var item models.IntegrationWebhookSubscription
	var supersedesID, lastError sql.NullString
	var expiresAt, renewalAttemptedAt, nextAttemptAt, lastNotificationAt sql.NullTime
	if err := row.Scan(
		&item.ID, &item.UserID, &item.ConnectionID, &item.Provider, &item.CapabilityKey,
		&item.ProviderSubscriptionID, &item.WatchedResourceID, &item.ProviderResourceID,
		&supersedesID, &item.Generation, &item.CallbackURL, &item.VerificationSecretHash,
		&item.Status, &expiresAt, &renewalAttemptedAt, &nextAttemptAt,
		&lastNotificationAt, &lastError,
	); err != nil {
		return item, fmt.Errorf("scan calendar webhook subscription: %w", err)
	}
	if supersedesID.Valid {
		item.SupersedesID = &supersedesID.String
	}
	if expiresAt.Valid {
		item.ExpiresAt = &expiresAt.Time
	}
	if renewalAttemptedAt.Valid {
		item.RenewalAttemptedAt = &renewalAttemptedAt.Time
	}
	if nextAttemptAt.Valid {
		item.NextAttemptAt = &nextAttemptAt.Time
	}
	if lastNotificationAt.Valid {
		item.LastNotificationAt = &lastNotificationAt.Time
	}
	if lastError.Valid {
		item.LastErrorCode = &lastError.String
	}
	return item, nil
}
