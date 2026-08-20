package resourceevents

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestSubscriberRejectsMalformedAndOversizedPayloads(t *testing.T) {
	metrics := NewMetrics()
	deliveries := 0
	subscriber := NewSubscriber(nil, func(string, Change) int { deliveries++; return 1 }, metrics)
	subscriber.handlePayload("not-json")
	subscriber.handlePayload(strings.Repeat("x", MaxMessageBytes+1))
	subscriber.handlePayload(`{"account_id":"bad","event":{}}`)
	if deliveries != 0 {
		t.Fatalf("delivered %d invalid messages", deliveries)
	}
	if got := metrics.Value(MetricInvalid, "json") + metrics.Value(MetricInvalid, "size") + metrics.Value(MetricInvalid, "contract"); got != 3 {
		t.Fatalf("invalid metric = %d, want 3", got)
	}
}

func TestRedisFanoutAcrossSubscribersPreservesAccountScope(t *testing.T) {
	server := miniredis.RunT(t)
	clientA := redis.NewClient(&redis.Options{Addr: server.Addr()})
	clientB := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = clientA.Close(); _ = clientB.Close() })
	accountID, otherAccountID := uuid.NewString(), uuid.NewString()
	ctx, cancel := context.WithCancel(context.Background())
	type received struct {
		accountID string
		change    Change
	}
	channels := []chan received{make(chan received, 2), make(chan received, 2)}
	subscribers := []*Subscriber{
		NewSubscriber(clientA, func(id string, change Change) int { channels[0] <- received{id, change}; return 1 }, NewMetrics()),
		NewSubscriber(clientB, func(id string, change Change) int { channels[1] <- received{id, change}; return 1 }, NewMetrics()),
	}
	var workers sync.WaitGroup
	defer func() { cancel(); workers.Wait() }()
	for _, subscriber := range subscribers {
		workers.Add(1)
		go func() { defer workers.Done(); subscriber.Run(ctx) }()
	}
	waitForSubscriptions(t, clientA, 2)
	publisher := NewPublisher(clientA, NewMetrics())
	if err := publisher.PublishChanged(ctx, accountID, ResourceCalendarEvents, nil); err != nil {
		t.Fatal(err)
	}
	for i, channel := range channels {
		select {
		case event := <-channel:
			if event.accountID != accountID || event.change.Resource != ResourceCalendarEvents {
				t.Fatalf("subscriber %d received wrong routing data: %+v", i, event)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("subscriber %d did not receive event", i)
		}
	}
	if err := publisher.PublishChanged(ctx, otherAccountID, ResourceVocabulary, nil); err != nil {
		t.Fatal(err)
	}
	for i, channel := range channels {
		select {
		case event := <-channel:
			if event.accountID != otherAccountID {
				t.Fatalf("subscriber %d crossed account scope: %+v", i, event)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("subscriber %d did not receive second event", i)
		}
	}
}

func TestSubscriberAcceptsValidEnvelope(t *testing.T) {
	accountID := uuid.NewString()
	change, err := NewChange(ResourceBillingStatus, nil)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(Envelope{AccountID: accountID, Event: change})
	if err != nil {
		t.Fatal(err)
	}
	var deliveredAccount string
	subscriber := NewSubscriber(nil, func(id string, event Change) int {
		deliveredAccount = id
		if event.EventID != change.EventID {
			t.Error("event changed during delivery")
		}
		return 2
	}, NewMetrics())
	subscriber.handlePayload(string(payload))
	if deliveredAccount != accountID {
		t.Fatalf("delivered account %q, want %q", deliveredAccount, accountID)
	}
	if got := subscriber.metrics.Value(MetricWSDeliveries, string(ResourceBillingStatus)); got != 2 {
		t.Fatalf("delivery metric = %d, want 2", got)
	}
}

func TestSubscriberRestartReceivesOnlyNewEvents(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	publisher := NewPublisher(client, NewMetrics())
	accountID := uuid.NewString()
	deliveries := make(chan Change, 2)
	start := func() (context.CancelFunc, <-chan struct{}) {
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		subscriber := NewSubscriber(client, func(_ string, change Change) int { deliveries <- change; return 1 }, NewMetrics())
		go func() { defer close(done); subscriber.Run(ctx) }()
		waitForSubscriptions(t, client, 1)
		return cancel, done
	}
	cancelFirst, firstDone := start()
	cancelFirst()
	select {
	case <-firstDone:
	case <-time.After(2 * time.Second):
		t.Fatal("first subscriber did not stop")
	}
	waitForSubscriptions(t, client, 0)
	if err := publisher.PublishChanged(context.Background(), accountID, ResourceVocabulary, nil); err != nil {
		t.Fatal(err)
	}
	cancelSecond, secondDone := start()
	defer func() { cancelSecond(); <-secondDone }()
	select {
	case <-deliveries:
		t.Fatal("Redis replayed a missed event")
	case <-time.After(150 * time.Millisecond):
	}
	if err := publisher.PublishChanged(context.Background(), accountID, ResourceCalendarEvents, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case change := <-deliveries:
		if change.Resource != ResourceCalendarEvents {
			t.Fatalf("received %s after restart", change.Resource)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("restarted subscriber did not receive new event")
	}
}

func TestSubscriberRecoversAfterRedisInterruption(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	ctx, cancel := context.WithCancel(context.Background())
	deliveries, done := make(chan Change, 1), make(chan struct{})
	subscriber := NewSubscriber(client, func(_ string, change Change) int { deliveries <- change; return 1 }, NewMetrics())
	go func() { defer close(done); subscriber.Run(ctx) }()
	defer func() { cancel(); <-done }()
	waitForSubscriptions(t, client, 1)
	server.Close()
	if err := server.Restart(); err != nil {
		t.Fatal(err)
	}
	waitForSubscriptionsWithin(t, client, 1, 4*time.Second)
	if err := NewPublisher(client, NewMetrics()).PublishChanged(ctx, uuid.NewString(), ResourceBillingStatus, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-deliveries:
	case <-time.After(2 * time.Second):
		t.Fatal("subscriber did not recover")
	}
}

func waitForSubscriptions(t *testing.T, client *redis.Client, want int64) {
	waitForSubscriptionsWithin(t, client, want, 2*time.Second)
}

func waitForSubscriptionsWithin(t *testing.T, client *redis.Client, want int64, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		counts, err := client.PubSubNumSub(context.Background(), RedisChannel).Result()
		if err == nil && counts[RedisChannel] == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("Redis subscriber count did not reach %d", want)
}
