package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/database"
)

type SubscriptionProjection struct {
	BillingCustomerID          int64
	ProviderSubscriptionID     string
	ProviderSubscriptionItemID string
	ProviderPriceID            string
	ProviderLatestInvoiceID    *string
	PlanKey                    string
	Status                     string
	CurrentPeriodStartedAt     *time.Time
	CurrentPeriodEndsAt        *time.Time
	TrialStartedAt             *time.Time
	TrialEndsAt                *time.Time
	CancelAtPeriodEnd          bool
	CancelAt                   *time.Time
	CanceledAt                 *time.Time
	EndedAt                    *time.Time
	ProviderCreatedAt          time.Time
	LastSyncedAt               time.Time
}

type SubscriptionRepository struct {
	db *database.DB
}

type CurrentSubscription struct {
	Status              string
	ProviderPriceID     string
	CurrentPeriodEndsAt *time.Time
	TrialEndsAt         *time.Time
	CancelAtPeriodEnd   bool
	CancelAt            *time.Time
}

func NewSubscriptionRepository(db *database.DB) *SubscriptionRepository {
	return &SubscriptionRepository{db: db}
}

func (r *SubscriptionRepository) CurrentStatusForAccount(ctx context.Context, accountID string, livemode bool) (string, error) {
	var status string
	err := r.db.QueryRowContext(ctx, `
		SELECT subscription.status
		FROM billing_customers AS customer
		JOIN subscriptions AS subscription
		  ON subscription.billing_customer_id=customer.id
		 AND subscription.is_current
		WHERE customer.account_id=$1
		  AND customer.provider='stripe'
		  AND customer.livemode=$2
		  AND customer.deleted_at IS NULL
		LIMIT 1
	`, accountID, livemode).Scan(&status)
	if err != nil {
		return "", err
	}
	return status, nil
}

func (r *SubscriptionRepository) GetCurrentForAccount(ctx context.Context, accountID string, livemode bool) (*CurrentSubscription, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT
			subscription.status,
			subscription.provider_price_id,
			subscription.current_period_ends_at,
			subscription.trial_ends_at,
			subscription.cancel_at_period_end,
			subscription.cancel_at
		FROM billing_customers AS customer
		JOIN subscriptions AS subscription
		  ON subscription.billing_customer_id=customer.id
		 AND subscription.is_current
		WHERE customer.account_id=$1
		  AND customer.provider='stripe'
		  AND customer.livemode=$2
		  AND customer.deleted_at IS NULL
		LIMIT 1
	`, accountID, livemode)
	var current CurrentSubscription
	var periodEnd, trialEnd, cancelAt sql.NullTime
	if err := row.Scan(
		&current.Status,
		&current.ProviderPriceID,
		&periodEnd,
		&trialEnd,
		&current.CancelAtPeriodEnd,
		&cancelAt,
	); err != nil {
		return nil, err
	}
	if periodEnd.Valid {
		current.CurrentPeriodEndsAt = &periodEnd.Time
	}
	if trialEnd.Valid {
		current.TrialEndsAt = &trialEnd.Time
	}
	if cancelAt.Valid {
		current.CancelAt = &cancelAt.Time
	}
	return &current, nil
}

func (r *SubscriptionRepository) HasTrialHistory(ctx context.Context, accountID string, livemode bool) (bool, error) {
	var hasTrial bool
	err := r.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM billing_customers AS customer
			JOIN subscriptions AS subscription
			  ON subscription.billing_customer_id=customer.id
			WHERE customer.account_id=$1
			  AND customer.provider='stripe'
			  AND customer.livemode=$2
			  AND subscription.trial_started_at IS NOT NULL
		)
	`, accountID, livemode).Scan(&hasTrial)
	if err != nil && err != sql.ErrNoRows {
		return false, fmt.Errorf("check subscription trial history: %w", err)
	}
	return hasTrial, nil
}

func (r *SubscriptionRepository) ApplyProjection(
	ctx context.Context,
	accountID string,
	projection SubscriptionProjection,
	effectivePlan string,
	planValidUntil *time.Time,
	planSource string,
	changeSource string,
	sourceReference string,
	reason string,
) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin subscription projection: %w", err)
	}
	defer tx.Rollback()

	// Serialize every projection for an account before changing the partial
	// unique current-subscription set. Webhook processing and reconciliation run
	// concurrently and must not race each other into conflicting current rows.
	var previousPlan, previousSource string
	var previousValidUntil sql.NullTime
	if err := tx.QueryRowContext(ctx, `
		SELECT effective_plan_key,plan_source,plan_valid_until
		FROM accounts
		WHERE id=$1
		FOR UPDATE
	`, accountID).Scan(&previousPlan, &previousSource, &previousValidUntil); err != nil {
		return fmt.Errorf("lock projected account: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE subscriptions
		SET is_current=false,updated_at=now()
		WHERE billing_customer_id=$1
		  AND provider_subscription_id<>$2
		  AND is_current
	`, projection.BillingCustomerID, projection.ProviderSubscriptionID); err != nil {
		return fmt.Errorf("retire previous subscription projection: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO subscriptions (
			billing_customer_id,provider_subscription_id,provider_subscription_item_id,
			provider_price_id,provider_latest_invoice_id,plan_key,status,is_current,
			current_period_started_at,current_period_ends_at,trial_started_at,trial_ends_at,
			cancel_at_period_end,cancel_at,canceled_at,ended_at,provider_created_at,last_synced_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
		)
		ON CONFLICT (billing_customer_id,provider_subscription_id) DO UPDATE SET
			provider_subscription_item_id=EXCLUDED.provider_subscription_item_id,
			provider_price_id=EXCLUDED.provider_price_id,
			provider_latest_invoice_id=EXCLUDED.provider_latest_invoice_id,
			plan_key=EXCLUDED.plan_key,
			status=EXCLUDED.status,
			is_current=true,
			current_period_started_at=EXCLUDED.current_period_started_at,
			current_period_ends_at=EXCLUDED.current_period_ends_at,
			trial_started_at=EXCLUDED.trial_started_at,
			trial_ends_at=EXCLUDED.trial_ends_at,
			cancel_at_period_end=EXCLUDED.cancel_at_period_end,
			cancel_at=EXCLUDED.cancel_at,
			canceled_at=EXCLUDED.canceled_at,
			ended_at=EXCLUDED.ended_at,
			provider_created_at=EXCLUDED.provider_created_at,
			last_synced_at=EXCLUDED.last_synced_at,
			updated_at=now()
	`,
		projection.BillingCustomerID,
		projection.ProviderSubscriptionID,
		projection.ProviderSubscriptionItemID,
		projection.ProviderPriceID,
		projection.ProviderLatestInvoiceID,
		projection.PlanKey,
		projection.Status,
		projection.CurrentPeriodStartedAt,
		projection.CurrentPeriodEndsAt,
		projection.TrialStartedAt,
		projection.TrialEndsAt,
		projection.CancelAtPeriodEnd,
		projection.CancelAt,
		projection.CanceledAt,
		projection.EndedAt,
		projection.ProviderCreatedAt,
		projection.LastSyncedAt,
	); err != nil {
		return fmt.Errorf("upsert subscription projection: %w", err)
	}

	now := time.Now().UTC()
	overrideActive := (previousSource == "admin" || previousSource == "promotion") &&
		(!previousValidUntil.Valid || previousValidUntil.Time.After(now))
	if !overrideActive {
		if _, err := tx.ExecContext(ctx, `
			UPDATE accounts
			SET
				effective_plan_key=$2,
				plan_source=$3,
				plan_valid_until=$4,
				plan_changed_at=CASE WHEN effective_plan_key IS DISTINCT FROM $2 THEN $5 ELSE plan_changed_at END,
				updated_at=$5
			WHERE id=$1
			`, accountID, effectivePlan, planSource, planValidUntil, now); err != nil {
			return fmt.Errorf("update effective account plan: %w", err)
		}
		if previousPlan != effectivePlan {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO account_plan_changes (
					account_id,previous_plan_key,new_plan_key,source,source_reference,reason,changed_at
				) VALUES ($1,$2,$3,$4,$5,$6,$7)
				`, accountID, previousPlan, effectivePlan, changeSource, sourceReference, reason, now); err != nil {
				return fmt.Errorf("record effective plan transition: %w", err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit subscription projection: %w", err)
	}
	return nil
}

func (r *SubscriptionRepository) ApplyNoCurrentSubscription(
	ctx context.Context,
	accountID string,
	billingCustomerID int64,
	sourceReference string,
) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin empty subscription reconciliation: %w", err)
	}
	defer tx.Rollback()
	var previousPlan, previousSource string
	var previousValidUntil sql.NullTime
	if err := tx.QueryRowContext(ctx, `
		SELECT effective_plan_key,plan_source,plan_valid_until
		FROM accounts WHERE id=$1 FOR UPDATE
	`, accountID).Scan(&previousPlan, &previousSource, &previousValidUntil); err != nil {
		return fmt.Errorf("lock account without current subscription: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE subscriptions
		SET is_current=false,updated_at=now()
		WHERE billing_customer_id=$1 AND is_current
	`, billingCustomerID); err != nil {
		return fmt.Errorf("retire absent subscription projection: %w", err)
	}
	now := time.Now().UTC()
	overrideActive := (previousSource == "admin" || previousSource == "promotion") &&
		(!previousValidUntil.Valid || previousValidUntil.Time.After(now))
	if !overrideActive {
		if _, err := tx.ExecContext(ctx, `
			UPDATE accounts
			SET effective_plan_key='free',plan_source='subscription',plan_valid_until=NULL,
				plan_changed_at=CASE WHEN effective_plan_key IS DISTINCT FROM 'free' THEN $2 ELSE plan_changed_at END,
				updated_at=$2
			WHERE id=$1
		`, accountID, now); err != nil {
			return fmt.Errorf("remove absent subscription access: %w", err)
		}
		if previousPlan != "free" {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO account_plan_changes (
					account_id,previous_plan_key,new_plan_key,source,source_reference,reason,changed_at
				) VALUES ($1,$2,'free','reconciliation',$3,'No current Stripe subscription',$4)
			`, accountID, previousPlan, sourceReference, now); err != nil {
				return fmt.Errorf("record absent subscription transition: %w", err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit empty subscription reconciliation: %w", err)
	}
	return nil
}
