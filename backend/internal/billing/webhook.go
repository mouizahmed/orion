package billing

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

const WebhookBodyLimit int64 = 1 << 20

var processedWebhookTypes = map[string]struct{}{
	"customer.subscription.created": {},
	"customer.subscription.updated": {},
	"customer.subscription.deleted": {},
	"customer.subscription.paused":  {},
	"customer.subscription.resumed": {},
}

type WebhookService struct {
	config  Config
	runtime *Runtime
	events  *repository.BillingWebhookRepository
}

func NewWebhookService(runtime *Runtime, events *repository.BillingWebhookRepository) *WebhookService {
	if runtime == nil {
		return &WebhookService{events: events}
	}
	return &WebhookService{config: runtime.config, runtime: runtime, events: events}
}

func (s *WebhookService) Receive(ctx context.Context, payload []byte, signature string, receivedAt time.Time) (bool, error) {
	if s == nil || !s.config.Enabled || s.runtime == nil || s.runtime.client == nil || s.events == nil {
		return false, ErrUnavailable
	}
	if len(payload) == 0 || int64(len(payload)) > WebhookBodyLimit || strings.TrimSpace(signature) == "" {
		return false, ErrInvalidRequest
	}
	event, err := s.runtime.client.ConstructEvent(payload, signature, s.config.WebhookSecret)
	if err != nil {
		return false, ErrInvalidRequest
	}
	if !strings.HasPrefix(event.ID, "evt_") || event.Created <= 0 {
		return false, ErrInvalidRequest
	}
	if event.Livemode != s.config.Livemode() {
		return false, fmt.Errorf("%w: webhook mode mismatch", ErrInvalidRequest)
	}
	if _, ok := processedWebhookTypes[string(event.Type)]; !ok {
		return false, nil
	}

	stored, err := s.events.InsertVerified(
		ctx,
		event.ID,
		string(event.Type),
		event.Livemode,
		time.Unix(event.Created, 0).UTC(),
		payload,
		receivedAt.UTC().Add(30*24*time.Hour),
	)
	if err != nil {
		return false, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return stored, nil
}
