package billing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/stripe/stripe-go/v86"
)

type PortalService struct {
	config      Config
	client      *stripe.Client
	customers   *repository.BillingCustomerRepository
	rateLimiter *RateLimiter
}

func NewPortalService(runtime *Runtime, customers *repository.BillingCustomerRepository, rateLimiter *RateLimiter) *PortalService {
	if runtime == nil {
		return &PortalService{customers: customers, rateLimiter: rateLimiter}
	}
	return &PortalService{config: runtime.config, client: runtime.client, customers: customers, rateLimiter: rateLimiter}
}

func (s *PortalService) Create(ctx context.Context, user *models.User) (string, error) {
	if s == nil || !s.config.Enabled || s.client == nil || s.customers == nil || s.rateLimiter == nil || user == nil {
		return "", ErrUnavailable
	}
	allowed, err := s.rateLimiter.Allow(ctx, "portal", user.ID, 5, time.Minute)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if !allowed {
		return "", ErrRateLimited
	}
	mapping, err := s.customers.GetForAccount(ctx, user.ID, s.config.Livemode())
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrSubscriptionConflict
	}
	if err != nil {
		return "", fmt.Errorf("%w: load billing customer: %v", ErrUnavailable, err)
	}
	params := &stripe.BillingPortalSessionCreateParams{
		Customer:      stripe.String(mapping.ProviderCustomerID),
		Configuration: stripe.String(s.config.CustomerPortalConfigurationID),
		ReturnURL:     stripe.String(s.config.PortalReturnURL),
	}
	session, err := s.client.V1BillingPortalSessions.Create(ctx, params)
	if err != nil {
		return "", fmt.Errorf("%w: create Stripe Customer Portal Session: %v", ErrUnavailable, err)
	}
	if session == nil || session.Livemode != s.config.Livemode() {
		return "", fmt.Errorf("%w: Stripe returned an incompatible portal session", ErrUnavailable)
	}
	portalURL, err := validatedStripeHostedURL(session.URL)
	if err != nil {
		return "", fmt.Errorf("%w: invalid Stripe Customer Portal URL", ErrUnavailable)
	}
	return portalURL, nil
}
