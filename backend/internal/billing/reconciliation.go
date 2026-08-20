package billing

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/stripe/stripe-go/v86"
)

type Reconciler struct {
	config        Config
	client        *stripe.Client
	customers     *repository.BillingCustomerRepository
	subscriptions *repository.SubscriptionRepository
	processor     *EventProcessor
}

func NewReconciler(
	runtime *Runtime,
	customers *repository.BillingCustomerRepository,
	subscriptions *repository.SubscriptionRepository,
	processor *EventProcessor,
) *Reconciler {
	if runtime == nil {
		return &Reconciler{customers: customers, subscriptions: subscriptions, processor: processor}
	}
	return &Reconciler{
		config:        runtime.config,
		client:        runtime.client,
		customers:     customers,
		subscriptions: subscriptions,
		processor:     processor,
	}
}

func (r *Reconciler) Start(ctx context.Context) {
	if r == nil || !r.config.Enabled || r.client == nil || r.customers == nil || r.subscriptions == nil || r.processor == nil {
		return
	}
	if !waitFor(ctx, 30*time.Second) {
		return
	}
	for {
		if err := r.ReconcileOnce(ctx); err != nil {
			log.Printf("billing reconciliation completed with failures")
		}
		if !waitFor(ctx, 15*time.Minute) {
			return
		}
	}
}

func (r *Reconciler) ReconcileOnce(ctx context.Context) error {
	customers, err := r.customers.ListActive(ctx, r.config.Livemode())
	if err != nil {
		return err
	}
	failures := 0
	for i := range customers {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := r.reconcileCustomer(ctx, &customers[i]); err != nil {
			// Provider errors can contain request-log URLs and identifiers. Keep
			// detailed diagnostics out of ordinary application logs.
			log.Printf("billing customer reconciliation failed")
			failures++
		}
	}
	if failures > 0 {
		return fmt.Errorf("%d billing customer reconciliations failed", failures)
	}
	return nil
}

func (r *Reconciler) reconcileCustomer(ctx context.Context, customer *repository.BillingCustomer) error {
	return r.processor.syncCustomerSubscriptions(
		ctx,
		customer,
		"reconciliation:"+customer.ProviderCustomerID,
		"reconciliation",
	)
}

func terminalSubscriptionStatus(status string) bool {
	return status == "canceled" || status == "incomplete_expired"
}
