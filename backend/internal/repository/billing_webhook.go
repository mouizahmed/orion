package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/database"
)

type BillingWebhookRepository struct {
	db *database.DB
}

type BillingWebhookEvent struct {
	ID              int64
	ProviderEventID string
	EventType       string
	Livemode        bool
	Payload         []byte
	AttemptCount    int
}

type BillingWebhookFailureCode string

const BillingWebhookFailureSubscriptionSync BillingWebhookFailureCode = "subscription_sync_failed"

func (r *BillingWebhookRepository) PurgeExpiredPayloads(ctx context.Context) (int64, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE billing_webhook_events
		SET payload='{}'::jsonb,updated_at=now()
		WHERE purge_after <= now()
		  AND payload <> '{}'::jsonb
		  AND (
			processing_status IN ('processed','ignored')
			OR (processing_status='failed' AND attempt_count >= 10)
		  )
	`)
	if err != nil {
		return 0, fmt.Errorf("purge expired billing event payloads: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("confirm purged billing event payloads: %w", err)
	}
	return count, nil
}

func NewBillingWebhookRepository(db *database.DB) *BillingWebhookRepository {
	return &BillingWebhookRepository{db: db}
}

func (r *BillingWebhookRepository) ClaimNext(ctx context.Context) (*BillingWebhookEvent, error) {
	row := r.db.QueryRowContext(ctx, `
		UPDATE billing_webhook_events AS event
		SET
			processing_status='processing',
			attempt_count=event.attempt_count+1,
			processing_started_at=now(),
			next_attempt_at=NULL,
			last_error=NULL,
			updated_at=now()
		WHERE event.id = (
			SELECT candidate.id
			FROM billing_webhook_events AS candidate
			WHERE candidate.attempt_count < 10
			  AND (
				(candidate.processing_status IN ('pending','failed') AND
				 (candidate.next_attempt_at IS NULL OR candidate.next_attempt_at <= now()))
				OR
				(candidate.processing_status='processing' AND
				 candidate.processing_started_at < now() - interval '10 minutes')
			  )
			ORDER BY candidate.received_at,candidate.id
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING event.id,event.provider_event_id,event.event_type,event.livemode,event.payload,event.attempt_count
	`)
	var event BillingWebhookEvent
	if err := row.Scan(&event.ID, &event.ProviderEventID, &event.EventType, &event.Livemode, &event.Payload, &event.AttemptCount); err != nil {
		return nil, err
	}
	return &event, nil
}

func (r *BillingWebhookRepository) MarkProcessed(ctx context.Context, id int64) error {
	return r.finish(ctx, id, "processed", nil, nil)
}

func (r *BillingWebhookRepository) MarkIgnored(ctx context.Context, id int64) error {
	return r.finish(ctx, id, "ignored", nil, nil)
}

func (r *BillingWebhookRepository) MarkFailed(ctx context.Context, id int64, retryAt *time.Time, failureCode BillingWebhookFailureCode) error {
	if failureCode != BillingWebhookFailureSubscriptionSync {
		return fmt.Errorf("invalid billing webhook failure code")
	}
	processingError := string(failureCode)
	return r.finish(ctx, id, "failed", retryAt, &processingError)
}

func (r *BillingWebhookRepository) finish(
	ctx context.Context,
	id int64,
	status string,
	retryAt *time.Time,
	processingError *string,
) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE billing_webhook_events
		SET
			processing_status=$2,
			next_attempt_at=$3,
			processing_started_at=NULL,
			processed_at=CASE WHEN $2 IN ('processed','ignored') THEN now() ELSE NULL END,
			last_error=$4,
			updated_at=now()
		WHERE id=$1 AND processing_status='processing'
	`, id, status, retryAt, processingError)
	if err != nil {
		return fmt.Errorf("finish billing event: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("confirm billing event completion: %w", err)
	}
	if rows != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *BillingWebhookRepository) InsertVerified(
	ctx context.Context,
	providerEventID string,
	eventType string,
	livemode bool,
	providerCreatedAt time.Time,
	payload []byte,
	purgeAfter time.Time,
) (bool, error) {
	result, err := r.db.ExecContext(ctx, `
		INSERT INTO billing_webhook_events (
			provider,provider_event_id,event_type,livemode,provider_created_at,payload,purge_after
		) VALUES ('stripe',$1,$2,$3,$4,$5::jsonb,$6)
		ON CONFLICT (provider,provider_event_id) DO NOTHING
	`, providerEventID, eventType, livemode, providerCreatedAt, string(payload), purgeAfter)
	if err != nil {
		return false, fmt.Errorf("store verified billing event: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("confirm verified billing event: %w", err)
	}
	return rows == 1, nil
}
