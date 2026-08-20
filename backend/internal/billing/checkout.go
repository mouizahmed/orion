package billing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/stripe/stripe-go/v86"
)

type CheckoutService struct {
	config        Config
	client        *stripe.Client
	customers     *CustomerService
	subscriptions *repository.SubscriptionRepository
	rateLimiter   *RateLimiter
}

func NewCheckoutService(
	runtime *Runtime,
	customers *CustomerService,
	subscriptions *repository.SubscriptionRepository,
	rateLimiter *RateLimiter,
) *CheckoutService {
	if runtime == nil {
		return &CheckoutService{customers: customers, subscriptions: subscriptions, rateLimiter: rateLimiter}
	}
	return &CheckoutService{
		config:        runtime.config,
		client:        runtime.client,
		customers:     customers,
		subscriptions: subscriptions,
		rateLimiter:   rateLimiter,
	}
}

func (s *CheckoutService) Create(
	ctx context.Context,
	user *models.User,
	offerKey OfferKey,
	requestID string,
) (string, error) {
	if s == nil || !s.config.Enabled || s.client == nil || s.customers == nil || s.subscriptions == nil || s.rateLimiter == nil {
		return "", ErrUnavailable
	}
	if user == nil || user.Status != models.UserStatusActive || user.DeletedAt != nil {
		return "", ErrUnavailable
	}
	if _, err := uuid.Parse(requestID); err != nil {
		return "", fmt.Errorf("%w: request_id must be a UUID", ErrInvalidRequest)
	}
	offer, err := s.config.Offer(offerKey)
	if err != nil {
		return "", fmt.Errorf("%w: unknown offer", ErrInvalidRequest)
	}
	allowed, err := s.rateLimiter.Allow(ctx, "checkout", user.ID, 5, time.Minute)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if !allowed {
		return "", ErrRateLimited
	}

	status, err := s.subscriptions.CurrentStatusForAccount(ctx, user.ID, s.config.Livemode())
	if err == nil && !checkoutAllowedForStatus(status) {
		return "", ErrSubscriptionConflict
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("%w: inspect current subscription: %v", ErrUnavailable, err)
	}
	reservationID := fmt.Sprintf("%s:%s", offer.Key, requestID)
	checkoutReserved, err := s.rateLimiter.ReserveCheckout(ctx, s.config.Mode, user.ID, reservationID)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if !checkoutReserved {
		// A previous create may have reached Stripe even if its response never
		// reached the desktop. Recover that still-open Session instead of forcing
		// the user to wait for the reservation to expire.
		customer, customerErr := s.customers.GetOrCreate(ctx, user)
		if customerErr != nil {
			return "", fmt.Errorf("%w: %v", ErrUnavailable, customerErr)
		}
		_, providerHasNonterminalSubscription, inspectErr := s.inspectProviderSubscriptions(ctx, customer.ProviderCustomerID)
		if inspectErr != nil {
			return "", fmt.Errorf("%w: inspect Stripe subscriptions: %v", ErrUnavailable, inspectErr)
		}
		if providerHasNonterminalSubscription {
			return "", ErrSubscriptionConflict
		}
		checkoutURL, found, recoveryErr := s.reusableOpenCheckoutURL(ctx, customer.ProviderCustomerID, user.ID, offer.Key)
		if recoveryErr != nil {
			return "", fmt.Errorf("%w: recover Stripe Checkout Session: %v", ErrUnavailable, recoveryErr)
		}
		if found {
			return checkoutURL, nil
		}
		return "", ErrCheckoutInProgress
	}
	releaseReservation := true
	defer func() {
		if releaseReservation {
			releaseCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			s.rateLimiter.ReleaseCheckoutReservation(releaseCtx, s.config.Mode, user.ID, reservationID)
		}
	}()

	hasTrialHistory, err := s.subscriptions.HasTrialHistory(ctx, user.ID, s.config.Livemode())
	if err != nil {
		return "", fmt.Errorf("%w: inspect trial eligibility: %v", ErrUnavailable, err)
	}

	customer, err := s.customers.GetOrCreate(ctx, user)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	providerHasTrialHistory, providerHasNonterminalSubscription, err := s.inspectProviderSubscriptions(ctx, customer.ProviderCustomerID)
	if err != nil {
		return "", fmt.Errorf("%w: inspect Stripe subscriptions: %v", ErrUnavailable, err)
	}
	if providerHasNonterminalSubscription {
		return "", ErrSubscriptionConflict
	}
	hasTrialHistory = hasTrialHistory || providerHasTrialHistory
	expiresAt := time.Now().UTC().Add(31 * time.Minute).Unix()
	params := &stripe.CheckoutSessionCreateParams{
		Mode:                    stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		Customer:                stripe.String(customer.ProviderCustomerID),
		ClientReferenceID:       stripe.String(user.ID),
		SuccessURL:              stripe.String(s.config.CheckoutSuccessURL),
		CancelURL:               stripe.String(s.config.CheckoutCancelURL),
		PaymentMethodCollection: stripe.String(string(stripe.CheckoutSessionPaymentMethodCollectionAlways)),
		ExpiresAt:               stripe.Int64(expiresAt),
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{
			{Price: stripe.String(offer.PriceID), Quantity: stripe.Int64(1)},
		},
		Metadata: map[string]string{
			"orion_account_id": user.ID,
			"orion_offer_key":  string(offer.Key),
		},
		SubscriptionData: &stripe.CheckoutSessionCreateSubscriptionDataParams{
			Metadata: map[string]string{
				"orion_account_id": user.ID,
				"orion_offer_key":  string(offer.Key),
			},
		},
	}
	if !hasTrialHistory {
		params.SubscriptionData.TrialPeriodDays = stripe.Int64(offer.TrialDays)
	}
	params.SetIdempotencyKey(fmt.Sprintf("orion:checkout:%s:%s:%s:%s", s.config.Mode, user.ID, offer.Key, requestID))
	// Once Stripe receives the create request its outcome can be ambiguous to the
	// caller. Retain the reservation so only this operation ID can be retried and
	// Stripe's idempotency record, rather than a second Checkout Session, wins.
	releaseReservation = false
	session, err := s.client.V1CheckoutSessions.Create(ctx, params)
	if err != nil {
		return "", fmt.Errorf("%w: create Stripe Checkout Session: %v", ErrUnavailable, err)
	}
	if session == nil || session.Livemode != s.config.Livemode() || session.Mode != stripe.CheckoutSessionModeSubscription {
		return "", fmt.Errorf("%w: Stripe returned an incompatible Checkout Session", ErrUnavailable)
	}
	checkoutURL, err := validatedStripeHostedURL(session.URL)
	if err != nil {
		return "", fmt.Errorf("%w: invalid Stripe Checkout URL", ErrUnavailable)
	}
	return checkoutURL, nil
}

func (s *CheckoutService) inspectProviderSubscriptions(ctx context.Context, customerID string) (bool, bool, error) {
	params := &stripe.SubscriptionListParams{
		Customer: stripe.String(customerID),
		Status:   stripe.String("all"),
	}
	hasTrialHistory := false
	for subscription, err := range s.client.V1Subscriptions.List(ctx, params).All(ctx) {
		if err != nil {
			return false, false, err
		}
		if subscription == nil || subscription.Livemode != s.config.Livemode() {
			return false, false, fmt.Errorf("Stripe subscription mode mismatch")
		}
		if subscription.TrialStart > 0 {
			hasTrialHistory = true
		}
		if !terminalSubscriptionStatus(string(subscription.Status)) {
			return hasTrialHistory, true, nil
		}
	}
	return hasTrialHistory, false, nil
}

func (s *CheckoutService) reusableOpenCheckoutURL(
	ctx context.Context,
	customerID string,
	accountID string,
	offerKey OfferKey,
) (string, bool, error) {
	params := &stripe.CheckoutSessionListParams{
		Customer: stripe.String(customerID),
		Status:   stripe.String(string(stripe.CheckoutSessionStatusOpen)),
	}
	params.Limit = stripe.Int64(10)
	for session, err := range s.client.V1CheckoutSessions.List(ctx, params).All(ctx) {
		if err != nil {
			return "", false, err
		}
		if session == nil || session.Livemode != s.config.Livemode() {
			return "", false, fmt.Errorf("Stripe Checkout Session mode mismatch")
		}
		if session.Mode != stripe.CheckoutSessionModeSubscription ||
			session.Status != stripe.CheckoutSessionStatusOpen ||
			session.ExpiresAt <= time.Now().UTC().Unix() ||
			session.Metadata["orion_account_id"] != accountID ||
			session.Metadata["orion_offer_key"] != string(offerKey) {
			continue
		}
		checkoutURL, err := validatedStripeHostedURL(session.URL)
		if err != nil {
			return "", false, err
		}
		return checkoutURL, true, nil
	}
	return "", false, nil
}

func checkoutAllowedForStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "canceled", "incomplete_expired":
		return true
	case "incomplete", "trialing", "active", "past_due", "unpaid", "paused":
		return false
	default:
		return false
	}
}
