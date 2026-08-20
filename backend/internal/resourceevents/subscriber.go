package resourceevents

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"time"

	"github.com/redis/go-redis/v9"
)

type DeliverFunc func(accountID string, change Change) int

type Subscriber struct {
	redis   *redis.Client
	deliver DeliverFunc
	metrics *Metrics
}

func NewSubscriber(redisClient *redis.Client, deliver DeliverFunc, metrics *Metrics) *Subscriber {
	return &Subscriber{redis: redisClient, deliver: deliver, metrics: metrics}
}

func (s *Subscriber) Run(ctx context.Context) {
	if s == nil || s.redis == nil || s.deliver == nil {
		return
	}
	backoff := time.Second
	for ctx.Err() == nil {
		pubsub := s.redis.Subscribe(ctx, RedisChannel)
		for ctx.Err() == nil {
			received, err := pubsub.ReceiveTimeout(ctx, time.Second)
			if err != nil {
				if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
					continue
				}
				break
			}
			message, ok := received.(*redis.Message)
			if !ok {
				continue
			}
			s.handlePayload(message.Payload)
			backoff = time.Second
		}
		_ = pubsub.Close()
		if ctx.Err() != nil {
			return
		}
		log.Printf("resource events: Redis subscription interrupted; retrying")
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

func (s *Subscriber) handlePayload(payload string) {
	if len(payload) == 0 || len(payload) > MaxMessageBytes {
		s.metrics.Inc(MetricInvalid, "size")
		return
	}
	var envelope Envelope
	if err := json.Unmarshal([]byte(payload), &envelope); err != nil {
		s.metrics.Inc(MetricInvalid, "json")
		return
	}
	if err := envelope.Validate(); err != nil {
		s.metrics.Inc(MetricInvalid, "contract")
		return
	}
	s.metrics.Inc(MetricReceived, string(envelope.Event.Resource))
	deliveries := s.deliver(envelope.AccountID, envelope.Event)
	if deliveries > 0 {
		s.metrics.Add(MetricWSDeliveries, string(envelope.Event.Resource), uint64(deliveries))
	}
	log.Printf("resource events: delivered event_id=%s resource=%s", envelope.Event.EventID, envelope.Event.Resource)
}
