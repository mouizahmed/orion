package billing

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/stripe/stripe-go/v86"
)

type CustomerService struct {
	config    Config
	client    *stripe.Client
	customers *repository.BillingCustomerRepository
}

func NewCustomerService(runtime *Runtime, customers *repository.BillingCustomerRepository) *CustomerService {
	if runtime == nil {
		return &CustomerService{customers: customers}
	}
	return &CustomerService{config: runtime.config, client: runtime.client, customers: customers}
}

func (s *CustomerService) GetOrCreate(ctx context.Context, user *models.User) (*repository.BillingCustomer, error) {
	if s == nil || !s.config.Enabled || s.client == nil || s.customers == nil {
		return nil, fmt.Errorf("billing is unavailable")
	}
	if user == nil || strings.TrimSpace(user.ID) == "" || strings.TrimSpace(user.Email) == "" {
		return nil, fmt.Errorf("active application user is required")
	}

	mapping, err := s.customers.GetForAccount(ctx, user.ID, s.config.Livemode())
	if err == nil {
		return mapping, nil
	}
	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("load billing customer mapping: %w", err)
	}

	params := &stripe.CustomerCreateParams{
		Email: stripe.String(strings.TrimSpace(user.Email)),
		Name:  stripe.String(strings.TrimSpace(user.Name)),
		Metadata: map[string]string{
			"orion_account_id": user.ID,
		},
	}
	params.SetIdempotencyKey(fmt.Sprintf("orion:customer:%s:%s", s.config.Mode, user.ID))
	customer, err := s.client.V1Customers.Create(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("create Stripe customer: %w", err)
	}
	if customer == nil || !strings.HasPrefix(customer.ID, "cus_") {
		return nil, fmt.Errorf("Stripe returned an invalid customer")
	}
	if customer.Livemode != s.config.Livemode() {
		return nil, fmt.Errorf("Stripe customer mode does not match backend billing mode")
	}

	providerCreatedAt := time.Unix(customer.Created, 0).UTC()
	mapping, err = s.customers.Insert(ctx, user.ID, customer.ID, customer.Livemode, providerCreatedAt)
	if err != nil {
		return nil, fmt.Errorf("persist billing customer mapping: %w", err)
	}
	return mapping, nil
}
