package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/entitlements"
)

type AccountUsageRepository struct {
	db *database.DB
}

type UsageConsumption struct {
	Allowed                   bool
	PeriodConsumedQuantity    int64
	LimitQuantity             int64
	OperationConsumedQuantity int64
	Replayed                  bool
}

func NewAccountUsageRepository(db *database.DB) *AccountUsageRepository {
	return &AccountUsageRepository{db: db}
}

// Consume applies the cumulative quantity for one operation through the
// database-owned atomic quota primitive. Reusing an operation key with the
// same cumulative total returns the original result without charging twice.
func (r *AccountUsageRepository) Consume(
	ctx context.Context,
	accountID string,
	meter entitlements.MeterKey,
	period entitlements.UsagePeriod,
	operationKey string,
	operationTotalQuantity int64,
	effectiveLimit int64,
) (UsageConsumption, error) {
	var result UsageConsumption
	if r == nil || r.db == nil {
		return result, fmt.Errorf("account usage repository is unavailable")
	}
	if strings.TrimSpace(accountID) == "" || strings.TrimSpace(operationKey) == "" {
		return result, fmt.Errorf("account and operation keys are required")
	}
	if operationTotalQuantity <= 0 || effectiveLimit < 0 {
		return result, fmt.Errorf("usage quantities are invalid")
	}

	err := r.db.QueryRowContext(ctx, `
		SELECT
			allowed,
			period_consumed_quantity,
			limit_quantity,
			operation_consumed_quantity,
			replayed
		FROM orion_internal.consume_account_usage(
			$1::uuid,
			$2,
			$3,
			$4,
			$5,
			$6,
			$7
		)
	`,
		accountID,
		string(meter),
		period.StartedAt,
		period.EndsAt,
		operationKey,
		operationTotalQuantity,
		effectiveLimit,
	).Scan(
		&result.Allowed,
		&result.PeriodConsumedQuantity,
		&result.LimitQuantity,
		&result.OperationConsumedQuantity,
		&result.Replayed,
	)
	if err != nil {
		return UsageConsumption{}, fmt.Errorf("consume account usage: %w", err)
	}
	return result, nil
}
