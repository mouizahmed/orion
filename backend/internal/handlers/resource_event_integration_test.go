package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
	"github.com/redis/go-redis/v9"
)

func TestResourceEventRedisFanoutRoutesOnlyToAccountSockets(t *testing.T) {
	redisServer := miniredis.RunT(t)
	redisA := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	redisB := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { _ = redisA.Close(); _ = redisB.Close() })
	accountA, accountB := uuid.NewString(), uuid.NewString()
	hubA, hubB := NewWsHub(), NewWsHub()
	connA1 := connectHubSocket(t, hubA, accountA)
	connA2 := connectHubSocket(t, hubB, accountA)
	connB := connectHubSocket(t, hubB, accountB)
	ctx, cancel := context.WithCancel(context.Background())
	var workers sync.WaitGroup
	startSubscriber := func(client *redis.Client, hub *WsHub) {
		workers.Add(1)
		subscriber := resourceevents.NewSubscriber(client, func(accountID string, change resourceevents.Change) int {
			return hub.SendToUser(accountID, map[string]any{"type": "resource.changed", "data": change})
		}, resourceevents.NewMetrics())
		go func() { defer workers.Done(); subscriber.Run(ctx) }()
	}
	startSubscriber(redisA, hubA)
	startSubscriber(redisB, hubB)
	defer func() { cancel(); workers.Wait() }()
	waitForResourceSubscribers(t, redisA, 2)
	if err := resourceevents.NewPublisher(redisA, resourceevents.NewMetrics()).PublishChanged(ctx, accountA, resourceevents.ResourceVocabulary, nil); err != nil {
		t.Fatal(err)
	}
	for i, connection := range []*websocket.Conn{connA1, connA2} {
		connection.SetReadDeadline(time.Now().Add(2 * time.Second))
		var message struct {
			Type string `json:"type"`
			Data struct {
				Resource string `json:"resource"`
			} `json:"data"`
			AccountID string `json:"account_id"`
		}
		if err := connection.ReadJSON(&message); err != nil {
			t.Fatalf("account A socket %d did not receive event: %v", i, err)
		}
		if message.Type != "resource.changed" || message.Data.Resource != "vocabulary" || message.AccountID != "" {
			t.Fatalf("wrong payload: %+v", message)
		}
	}
	connB.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if _, _, err := connB.ReadMessage(); err == nil {
		t.Fatal("account B received account A event")
	}
}

func connectHubSocket(t *testing.T, hub *WsHub, accountID string) *websocket.Conn {
	t.Helper()
	registered := make(chan struct{})
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		connection, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			return
		}
		var writeMu sync.Mutex
		hub.Register(accountID, connection, &writeMu)
		close(registered)
		for {
			if _, _, err := connection.ReadMessage(); err != nil {
				break
			}
		}
		hub.Unregister(accountID, connection)
		_ = connection.Close()
	}))
	t.Cleanup(server.Close)
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	select {
	case <-registered:
	case <-time.After(time.Second):
		t.Fatal("socket was not registered")
	}
	return connection
}

func waitForResourceSubscribers(t *testing.T, client *redis.Client, want int64) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		counts, err := client.PubSubNumSub(context.Background(), resourceevents.RedisChannel).Result()
		if err == nil && counts[resourceevents.RedisChannel] == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("Redis subscriber count did not reach %d", want)
}
