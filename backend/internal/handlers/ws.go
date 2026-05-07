package handlers

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type WsHandler struct {
	hub *WsHub
}

func NewWsHandler(hub *WsHub) *WsHandler {
	return &WsHandler{hub: hub}
}

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(_ *http.Request) bool {
		return true
	},
}

func (h *WsHandler) Handle(c *gin.Context) {
	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(maxWSMessageBytes)

	userID, err := authenticateWSConn(conn)
	if err != nil {
		_ = conn.WriteJSON(gin.H{"type": "auth.error", "data": gin.H{"message": err.Error()}})
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(4001, "unauthorized"))
		return
	}
	_ = conn.WriteJSON(gin.H{"type": "auth.ok"})

	var writeMu sync.Mutex
	h.hub.Register(userID, conn, &writeMu)
	defer h.hub.Unregister(userID, conn)

	conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	conn.SetPongHandler(func(_ string) error {
		return conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	})

	errCh := make(chan error, 2)
	done := make(chan struct{})
	defer close(done)

	go func() {
		for {
			_, _, readErr := conn.ReadMessage()
			if readErr != nil {
				errCh <- readErr
				return
			}
		}
	}()

	go func() {
		ticker := time.NewTicker(wsPingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if writeErr := writeWSMessage(conn, &writeMu, websocket.PingMessage, nil); writeErr != nil {
					errCh <- writeErr
					return
				}
			}
		}
	}()

	<-errCh
	_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
}
