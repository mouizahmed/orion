package handlers

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

// WsHub tracks active WebSocket connections per user for server-push messaging.
type WsHub struct {
	mu    sync.RWMutex
	conns map[string]map[*websocket.Conn]*sync.Mutex
}

func NewWsHub() *WsHub {
	return &WsHub{
		conns: make(map[string]map[*websocket.Conn]*sync.Mutex),
	}
}

func (h *WsHub) Register(userID string, conn *websocket.Conn, mu *sync.Mutex) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.conns[userID] == nil {
		h.conns[userID] = make(map[*websocket.Conn]*sync.Mutex)
	}
	h.conns[userID][conn] = mu
}

func (h *WsHub) Unregister(userID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if conns, ok := h.conns[userID]; ok {
		delete(conns, conn)
		if len(conns) == 0 {
			delete(h.conns, userID)
		}
	}
}

func (h *WsHub) SendToUser(userID string, msg any) {
	raw, err := json.Marshal(msg)
	if err != nil {
		log.Printf("ws_hub: marshal error for user %s: %v", userID, err)
		return
	}

	h.mu.RLock()
	inner := h.conns[userID]
	conns := make(map[*websocket.Conn]*sync.Mutex, len(inner))
	for c, m := range inner {
		conns[c] = m
	}
	h.mu.RUnlock()

	for conn, mu := range conns {
		if err := writeWSMessage(conn, mu, websocket.TextMessage, raw); err != nil {
			log.Printf("ws_hub: send error for user %s: %v", userID, err)
		}
	}
}
