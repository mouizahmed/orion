package resourceevents

import (
	"context"
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type failingPublisher struct{}

func (failingPublisher) PublishChanged(context.Context, string, Resource, *string) error {
	return errors.New("transport unavailable")
}

func TestPublisherRejectsInvalidIdentityAndResource(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	metrics := NewMetrics()
	publisher := NewPublisher(client, metrics)
	if err := publisher.PublishChanged(context.Background(), "", ResourceVocabulary, nil); err == nil {
		t.Fatal("empty account ID accepted")
	}
	if err := publisher.PublishChanged(context.Background(), uuid.NewString(), "unknown", nil); err == nil {
		t.Fatal("unknown resource accepted")
	}
	if got := metrics.Value(MetricPublishFailures, string(ResourceVocabulary)); got != 1 {
		t.Fatalf("identity failure metric = %d, want 1", got)
	}
	if got := metrics.Value(MetricPublishFailures, "unknown"); got != 1 {
		t.Fatalf("resource failure metric = %d, want 1", got)
	}
}

func TestPublisherRecordsRedisFailure(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	metrics := NewMetrics()
	publisher := NewPublisher(client, metrics)
	server.Close()
	if err := publisher.PublishChanged(context.Background(), uuid.NewString(), ResourceBillingStatus, nil); err == nil {
		t.Fatal("Redis failure not returned")
	}
	if got := metrics.Value(MetricPublishFailures, string(ResourceBillingStatus)); got != 1 {
		t.Fatalf("publish failure metric = %d, want 1", got)
	}
}

func TestPublishBestEffortDoesNotPropagateFailure(t *testing.T) {
	PublishBestEffort(context.Background(), failingPublisher{}, uuid.NewString(), ResourceVocabulary, nil)
}
