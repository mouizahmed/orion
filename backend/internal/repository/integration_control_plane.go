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
