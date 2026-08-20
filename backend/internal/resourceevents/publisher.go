package resourceevents

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type Publisher interface {
	PublishChanged(ctx context.Context, accountID string, resource Resource, resourceID *string) error
}

func PublishBestEffort(ctx context.Context, publisher Publisher, accountID string, resource Resource, resourceID *string) {
	if publisher == nil {
		return
	}
	publishCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := publisher.PublishChanged(publishCtx, accountID, resource, resourceID); err != nil {
		log.Printf("resource events: failed to publish %s invalidation", resource)
	}
}

type RedisPublisher struct {
	redis   *redis.Client
	metrics *Metrics
}

func NewPublisher(redisClient *redis.Client, metrics *Metrics) *RedisPublisher {
	return &RedisPublisher{redis: redisClient, metrics: metrics}
}

func (p *RedisPublisher) PublishChanged(ctx context.Context, accountID string, resource Resource, resourceID *string) error {
	if p == nil || p.redis == nil {
		return fmt.Errorf("resource event publisher unavailable")
	}
	if _, err := uuid.Parse(accountID); err != nil {
		p.metrics.Inc(MetricPublishFailures, string(resource))
		return fmt.Errorf("invalid account id")
	}
	change, err := NewChange(resource, resourceID)
	if err != nil {
		p.metrics.Inc(MetricPublishFailures, string(resource))
		return err
	}
	payload, err := json.Marshal(Envelope{AccountID: accountID, Event: change})
	if err != nil {
		p.metrics.Inc(MetricPublishFailures, string(resource))
		return fmt.Errorf("marshal resource event: %w", err)
	}
	if len(payload) > MaxMessageBytes {
		p.metrics.Inc(MetricPublishFailures, string(resource))
		return fmt.Errorf("resource event exceeds size limit")
	}
	if err := p.redis.Publish(ctx, RedisChannel, payload).Err(); err != nil {
		p.metrics.Inc(MetricPublishFailures, string(resource))
		return fmt.Errorf("publish resource event: %w", err)
	}
	p.metrics.Inc(MetricPublished, string(resource))
	return nil
}
