package billing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

type Status struct {
	Enabled            bool            `json:"enabled"`
	EffectivePlan      models.UserPlan `json:"effective_plan"`
	Offer              *OfferKey       `json:"offer,omitempty"`
	SubscriptionStatus *string         `json:"subscription_status,omitempty"`
	RenewsOrEndsAt     *time.Time      `json:"renews_or_ends_at,omitempty"`
	CancelAtPeriodEnd  bool            `json:"cancel_at_period_end"`
	ScheduledToEnd     bool            `json:"scheduled_to_end"`
	TrialEndsAt        *time.Time      `json:"trial_ends_at,omitempty"`
}

type StatusService struct {
	config        Config
	subscriptions *repository.SubscriptionRepository
}

func NewStatusService(runtime *Runtime, subscriptions *repository.SubscriptionRepository) *StatusService {
	if runtime == nil {
		return &StatusService{subscriptions: subscriptions}
	}
	return &StatusService{config: runtime.config, subscriptions: subscriptions}
}

func (s *StatusService) Get(ctx context.Context, user *models.User) (Status, error) {
	if user == nil {
		return Status{}, ErrUnavailable
	}
	status := Status{Enabled: s != nil && s.config.Enabled, EffectivePlan: user.Plan}
	if !status.Enabled {
		return status, nil
	}
	current, err := s.subscriptions.GetCurrentForAccount(ctx, user.ID, s.config.Livemode())
	if errors.Is(err, sql.ErrNoRows) {
		return status, nil
	}
	if err != nil {
		return Status{}, fmt.Errorf("load billing status: %w", err)
	}
	status.SubscriptionStatus = &current.Status
	status.CancelAtPeriodEnd = current.CancelAtPeriodEnd
	status.ScheduledToEnd = current.CancelAtPeriodEnd || current.CancelAt != nil
	status.TrialEndsAt = current.TrialEndsAt
	status.RenewsOrEndsAt = current.CurrentPeriodEndsAt
	if current.CancelAt != nil {
		status.RenewsOrEndsAt = current.CancelAt
	}
	if offer, err := s.config.OfferForPrice(current.ProviderPriceID, s.config.Livemode()); err == nil {
		status.Offer = &offer.Key
	} else {
		return Status{}, err
	}
	return status, nil
}
