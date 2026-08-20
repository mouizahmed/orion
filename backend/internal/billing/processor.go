package billing

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
	"github.com/stripe/stripe-go/v86"
)

var errEventIgnored = errors.New("billing event ignored")

type EventProcessor struct {
	config        Config
	client        *stripe.Client
	customers     *repository.BillingCustomerRepository
	subscriptions *repository.SubscriptionRepository
	events        *repository.BillingWebhookRepository
	resources     resourceevents.Publisher
}

func NewEventProcessor(
	runtime *Runtime,
	customers *repository.BillingCustomerRepository,
	subscriptions *repository.SubscriptionRepository,
	events *repository.BillingWebhookRepository,
	resources resourceevents.Publisher,
) *EventProcessor {
	if runtime == nil {
		return &EventProcessor{customers: customers, subscriptions: subscriptions, events: events, resources: resources}
	}
	return &EventProcessor{
		config:        runtime.config,
		client:        runtime.client,
		customers:     customers,
		subscriptions: subscriptions,
		events:        events,
		resources:     resources,
	}
}

func (p *EventProcessor) Start(ctx context.Context) {
	if p == nil || !p.config.Enabled || p.client == nil || p.customers == nil || p.subscriptions == nil || p.events == nil {
		return
	}
	log.Printf("billing event processor started in %s mode", p.config.Mode)
	nextPayloadPurge := time.Now().UTC()
	for {
		if ctx.Err() != nil {
			return
		}
		if now := time.Now().UTC(); !now.Before(nextPayloadPurge) {
			if purged, err := p.events.PurgeExpiredPayloads(ctx); err != nil {
				log.Printf("expired billing event payload purge failed")
			} else if purged > 0 {
				log.Printf("purged %d expired billing event payloads", purged)
			}
			nextPayloadPurge = now.Add(time.Hour)
		}
		event, err := p.events.ClaimNext(ctx)
		if errors.Is(err, sql.ErrNoRows) {
			if !waitFor(ctx, 2*time.Second) {
				return
			}
			continue
		}
		if err != nil {
			log.Printf("billing event claim failed")
			if !waitFor(ctx, 5*time.Second) {
				return
			}
			continue
		}

		if err := p.process(ctx, event, "subscription"); err != nil {
			if errors.Is(err, errEventIgnored) {
				if markErr := p.events.MarkIgnored(ctx, event.ID); markErr != nil {
					log.Printf("billing event %d ignore state could not be recorded", event.ID)
				}
				continue
			}
			var retryAt *time.Time
			if event.AttemptCount < 10 {
				next := time.Now().UTC().Add(retryDelay(event.AttemptCount))
				retryAt = &next
			}
			if markErr := p.events.MarkFailed(ctx, event.ID, retryAt, repository.BillingWebhookFailureSubscriptionSync); markErr != nil {
				log.Printf("billing event %d failure could not be recorded", event.ID)
			} else {
				log.Printf("billing event %d failed on attempt %d", event.ID, event.AttemptCount)
			}
			continue
		}
		if err := p.events.MarkProcessed(ctx, event.ID); err != nil {
			log.Printf("billing event %d completion could not be recorded", event.ID)
		}
	}
}

func (p *EventProcessor) process(ctx context.Context, stored *repository.BillingWebhookEvent, transitionSource string) error {
	if stored == nil || stored.Livemode != p.config.Livemode() {
		return fmt.Errorf("stored event mode mismatch")
	}
	var event stripe.Event
	if err := json.Unmarshal(stored.Payload, &event); err != nil {
		return fmt.Errorf("decode verified event envelope")
	}
	if event.ID != stored.ProviderEventID || string(event.Type) != stored.EventType || event.Data == nil {
		return fmt.Errorf("stored event envelope mismatch")
	}
	if _, ok := processedWebhookTypes[stored.EventType]; !ok {
		return errEventIgnored
	}
	var object struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(event.Data.Raw, &object); err != nil || !strings.HasPrefix(object.ID, "sub_") {
		return fmt.Errorf("event does not identify a subscription")
	}

	subscription, err := p.client.V1Subscriptions.Retrieve(ctx, object.ID, nil)
	if err != nil {
		return fmt.Errorf("retrieve current Stripe subscription: %w", err)
	}
	mapping, err := p.resolveCustomerMapping(ctx, subscription)
	if err != nil {
		return err
	}
	return p.syncCustomerSubscriptions(ctx, mapping, stored.ProviderEventID, transitionSource)
}

func (p *EventProcessor) syncCustomerSubscriptions(
	ctx context.Context,
	mapping *repository.BillingCustomer,
	sourceReference string,
	transitionSource string,
) error {
	if mapping == nil || !strings.HasPrefix(mapping.ProviderCustomerID, "cus_") || mapping.Livemode != p.config.Livemode() {
		return fmt.Errorf("invalid Stripe customer mapping")
	}
	params := &stripe.SubscriptionListParams{
		Customer: stripe.String(mapping.ProviderCustomerID),
		Status:   stripe.String("all"),
	}
	providerSubscriptions := make([]*stripe.Subscription, 0, 1)
	for subscription, err := range p.client.V1Subscriptions.List(ctx, params).All(ctx) {
		if err != nil {
			return fmt.Errorf("list current Stripe subscriptions: %w", err)
		}
		if subscription == nil || subscription.Livemode != p.config.Livemode() || subscription.Customer == nil || subscription.Customer.ID != mapping.ProviderCustomerID {
			return fmt.Errorf("Stripe subscription does not match its customer mapping")
		}
		providerSubscriptions = append(providerSubscriptions, subscription)
	}
	if len(providerSubscriptions) == 0 {
		if err := p.subscriptions.ApplyNoCurrentSubscription(ctx, mapping.AccountID, mapping.ID, sourceReference); err != nil {
			return err
		}
		resourceevents.PublishBestEffort(ctx, p.resources, mapping.AccountID, resourceevents.ResourceBillingStatus, nil)
		return nil
	}

	nonterminal := make([]*stripe.Subscription, 0, 1)
	for _, subscription := range providerSubscriptions {
		if !terminalSubscriptionStatus(string(subscription.Status)) {
			nonterminal = append(nonterminal, subscription)
		}
	}
	if len(nonterminal) > 1 {
		return fmt.Errorf("Stripe customer has multiple nonterminal subscriptions")
	}
	current := providerSubscriptions[0]
	if len(nonterminal) == 1 {
		current = nonterminal[0]
	} else {
		sort.Slice(providerSubscriptions, func(i, j int) bool {
			return providerSubscriptions[i].Created > providerSubscriptions[j].Created
		})
		current = providerSubscriptions[0]
	}
	if err := p.projectSubscription(ctx, mapping, current, sourceReference, transitionSource); err != nil {
		return err
	}
	resourceevents.PublishBestEffort(ctx, p.resources, mapping.AccountID, resourceevents.ResourceBillingStatus, nil)
	return nil
}

func (p *EventProcessor) projectSubscription(
	ctx context.Context,
	mapping *repository.BillingCustomer,
	subscription *stripe.Subscription,
	sourceReference string,
	transitionSource string,
) error {
	if subscription == nil || !strings.HasPrefix(subscription.ID, "sub_") || subscription.Customer == nil ||
		!strings.HasPrefix(subscription.Customer.ID, "cus_") {
		return fmt.Errorf("Stripe returned an invalid subscription")
	}
	if subscription.Livemode != p.config.Livemode() {
		return fmt.Errorf("Stripe subscription mode mismatch")
	}
	if subscription.Items == nil || len(subscription.Items.Data) != 1 {
		return fmt.Errorf("subscription must contain exactly one item")
	}
	item := subscription.Items.Data[0]
	if item == nil || !strings.HasPrefix(item.ID, "si_") || item.Price == nil ||
		!strings.HasPrefix(item.Price.ID, "price_") || item.Quantity != 1 {
		return fmt.Errorf("Stripe returned an invalid subscription item")
	}
	offer, err := p.config.OfferForPrice(item.Price.ID, subscription.Livemode)
	if err != nil {
		return err
	}

	if mapping == nil || mapping.ProviderCustomerID != subscription.Customer.ID || mapping.Livemode != subscription.Livemode {
		return fmt.Errorf("Stripe subscription does not match its customer mapping")
	}

	projection := repository.SubscriptionProjection{
		BillingCustomerID:          mapping.ID,
		ProviderSubscriptionID:     subscription.ID,
		ProviderSubscriptionItemID: item.ID,
		ProviderPriceID:            item.Price.ID,
		PlanKey:                    string(offer.Plan),
		Status:                     string(subscription.Status),
		CurrentPeriodStartedAt:     unixTimePointer(item.CurrentPeriodStart),
		CurrentPeriodEndsAt:        unixTimePointer(item.CurrentPeriodEnd),
		TrialStartedAt:             unixTimePointer(subscription.TrialStart),
		TrialEndsAt:                unixTimePointer(subscription.TrialEnd),
		CancelAtPeriodEnd:          subscription.CancelAtPeriodEnd,
		CancelAt:                   unixTimePointer(subscription.CancelAt),
		CanceledAt:                 unixTimePointer(subscription.CanceledAt),
		EndedAt:                    unixTimePointer(subscription.EndedAt),
		ProviderCreatedAt:          time.Unix(subscription.Created, 0).UTC(),
		LastSyncedAt:               time.Now().UTC(),
	}
	if subscription.LatestInvoice != nil && strings.TrimSpace(subscription.LatestInvoice.ID) != "" {
		invoiceID := subscription.LatestInvoice.ID
		projection.ProviderLatestInvoiceID = &invoiceID
	}
	effectivePlan, validUntil, err := effectiveAccess(projection, projection.LastSyncedAt)
	if err != nil {
		return err
	}
	return p.subscriptions.ApplyProjection(
		ctx,
		mapping.AccountID,
		projection,
		string(effectivePlan),
		validUntil,
		"subscription",
		transitionSource,
		sourceReference,
		"Verified Stripe subscription state",
	)
}

func (p *EventProcessor) resolveCustomerMapping(ctx context.Context, subscription *stripe.Subscription) (*repository.BillingCustomer, error) {
	if subscription == nil || subscription.Customer == nil || !strings.HasPrefix(subscription.Customer.ID, "cus_") {
		return nil, fmt.Errorf("Stripe subscription has no valid customer")
	}
	mapping, err := p.customers.GetByProviderID(ctx, subscription.Customer.ID, subscription.Livemode)
	if errors.Is(err, sql.ErrNoRows) {
		mapping, err = p.repairCustomerMapping(ctx, subscription)
	}
	if err != nil {
		return nil, fmt.Errorf("resolve Stripe customer mapping: %w", err)
	}
	return mapping, nil
}

func (p *EventProcessor) repairCustomerMapping(ctx context.Context, subscription *stripe.Subscription) (*repository.BillingCustomer, error) {
	customerID := subscription.Customer.ID
	livemode := subscription.Livemode
	customer, err := p.client.V1Customers.Retrieve(ctx, customerID, nil)
	if err != nil {
		return nil, fmt.Errorf("retrieve Stripe customer: %w", err)
	}
	if customer == nil || customer.Deleted || customer.Livemode != livemode {
		return nil, fmt.Errorf("Stripe customer is unavailable or has the wrong mode")
	}
	accountID := strings.TrimSpace(customer.Metadata["orion_account_id"])
	if accountID == "" {
		return nil, fmt.Errorf("Stripe customer has no Orion ownership metadata")
	}
	subscriptionAccountID := strings.TrimSpace(subscription.Metadata["orion_account_id"])
	if subscriptionAccountID == "" || subscriptionAccountID != accountID {
		return nil, fmt.Errorf("Stripe ownership metadata does not agree")
	}
	if _, err := uuid.Parse(accountID); err != nil {
		return nil, fmt.Errorf("Stripe ownership metadata is invalid")
	}
	return p.customers.Insert(ctx, accountID, customer.ID, customer.Livemode, time.Unix(customer.Created, 0).UTC())
}

func effectiveAccess(projection repository.SubscriptionProjection, now time.Time) (models.UserPlan, *time.Time, error) {
	professionalUntil := func(deadline *time.Time) (models.UserPlan, *time.Time) {
		if deadline == nil || !deadline.After(now) {
			return models.UserPlanFree, nil
		}
		return models.UserPlanPro, deadline
	}
	switch projection.Status {
	case "trialing":
		deadline := earlierDeadline(projection.TrialEndsAt, projection.CancelAt)
		returnValue, validUntil := professionalUntil(deadline)
		return returnValue, validUntil, nil
	case "active":
		deadline := earlierDeadline(projection.CurrentPeriodEndsAt, projection.CancelAt)
		returnValue, validUntil := professionalUntil(deadline)
		return returnValue, validUntil, nil
	case "past_due":
		if projection.CurrentPeriodStartedAt == nil {
			return models.UserPlanFree, nil, nil
		}
		deadline := projection.CurrentPeriodStartedAt.Add(72 * time.Hour)
		returnValue, validUntil := professionalUntil(&deadline)
		return returnValue, validUntil, nil
	case "incomplete", "incomplete_expired", "unpaid", "paused", "canceled":
		return models.UserPlanFree, nil, nil
	default:
		return models.UserPlanFree, nil, fmt.Errorf("unknown Stripe subscription status")
	}
}

func earlierDeadline(first, second *time.Time) *time.Time {
	if first == nil || (second != nil && second.Before(*first)) {
		return second
	}
	return first
}

func unixTimePointer(value int64) *time.Time {
	if value <= 0 {
		return nil
	}
	result := time.Unix(value, 0).UTC()
	return &result
}

func retryDelay(attempt int) time.Duration {
	delay := 5 * time.Second
	for i := 1; i < attempt && delay < time.Hour; i++ {
		delay *= 2
	}
	if delay > time.Hour {
		return time.Hour
	}
	return delay
}

func waitFor(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
