package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/database"
)

type BillingCustomer struct {
	ID                 int64
	AccountID          string
	ProviderCustomerID string
	Livemode           bool
	ProviderCreatedAt  *time.Time
}

type BillingCustomerRepository struct {
	db *database.DB
}

func NewBillingCustomerRepository(db *database.DB) *BillingCustomerRepository {
	return &BillingCustomerRepository{db: db}
}

func (r *BillingCustomerRepository) GetForAccount(ctx context.Context, accountID string, livemode bool) (*BillingCustomer, error) {
	return scanBillingCustomer(r.db.QueryRowContext(ctx, `
		SELECT id,account_id,provider_customer_id,livemode,provider_created_at
		FROM billing_customers
		WHERE account_id=$1 AND provider='stripe' AND livemode=$2 AND deleted_at IS NULL
		LIMIT 1
	`, accountID, livemode))
}

func (r *BillingCustomerRepository) GetByProviderID(ctx context.Context, providerCustomerID string, livemode bool) (*BillingCustomer, error) {
	return scanBillingCustomer(r.db.QueryRowContext(ctx, `
		SELECT id,account_id,provider_customer_id,livemode,provider_created_at
		FROM billing_customers
		WHERE provider='stripe' AND provider_customer_id=$1 AND livemode=$2 AND deleted_at IS NULL
		LIMIT 1
	`, providerCustomerID, livemode))
}

func (r *BillingCustomerRepository) Insert(
	ctx context.Context,
	accountID string,
	providerCustomerID string,
	livemode bool,
	providerCreatedAt time.Time,
) (*BillingCustomer, error) {
	row := r.db.QueryRowContext(ctx, `
		INSERT INTO billing_customers (
			account_id,provider,provider_customer_id,livemode,provider_created_at
		) VALUES ($1,'stripe',$2,$3,$4)
		ON CONFLICT (account_id,provider,livemode) DO NOTHING
		RETURNING id,account_id,provider_customer_id,livemode,provider_created_at
	`, accountID, providerCustomerID, livemode, providerCreatedAt)

	mapping, err := scanBillingCustomer(row)
	if err != nil {
		if err != sql.ErrNoRows {
			return nil, fmt.Errorf("insert billing customer mapping: %w", err)
		}
		mapping, err = r.GetForAccount(ctx, accountID, livemode)
	}
	if err != nil {
		return nil, fmt.Errorf("load billing customer mapping after insert: %w", err)
	}
	if mapping.ProviderCustomerID != providerCustomerID {
		return nil, fmt.Errorf("account is already mapped to a different Stripe customer")
	}
	return mapping, nil
}

func (r *BillingCustomerRepository) ListActive(ctx context.Context, livemode bool) ([]BillingCustomer, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id,account_id,provider_customer_id,livemode,provider_created_at
		FROM billing_customers
		WHERE provider='stripe' AND livemode=$1 AND deleted_at IS NULL
		ORDER BY id
	`, livemode)
	if err != nil {
		return nil, fmt.Errorf("list billing customers: %w", err)
	}
	defer rows.Close()
	customers := make([]BillingCustomer, 0)
	for rows.Next() {
		customer, err := scanBillingCustomer(rows)
		if err != nil {
			return nil, fmt.Errorf("scan billing customer: %w", err)
		}
		customers = append(customers, *customer)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate billing customers: %w", err)
	}
	return customers, nil
}

func scanBillingCustomer(row interface{ Scan(...any) error }) (*BillingCustomer, error) {
	var customer BillingCustomer
	var providerCreatedAt sql.NullTime
	if err := row.Scan(
		&customer.ID,
		&customer.AccountID,
		&customer.ProviderCustomerID,
		&customer.Livemode,
		&providerCreatedAt,
	); err != nil {
		return nil, err
	}
	if providerCreatedAt.Valid {
		customer.ProviderCreatedAt = &providerCreatedAt.Time
	}
	return &customer, nil
}
