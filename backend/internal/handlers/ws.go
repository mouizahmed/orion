package handlers

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	orionauth "github.com/mouizahmed/justscribe-backend/internal/auth"
)

type WsHandler struct {
	hub              *WsHub
	principalService *orionauth.PrincipalService
}

func NewWsHandler(hub *WsHub, principalService *orionauth.PrincipalService) *WsHandler {
	return &WsHandler{hub: hub, principalService: principalService}
}

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     checkWebSocketOrigin,
}

func (h *WsHandler) Handle(c *gin.Context) {
	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(maxWSMessageBytes)

	principal, token, err := authenticateWSConn(conn, h.principalService)
	if err != nil {
		_ = conn.WriteJSON(gin.H{"type": "auth.error", "data": wsAuthErrorData(err)})
		_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(4001, "unauthorized"))
		return
	}
	_ = conn.WriteJSON(gin.H{"type": "auth.ok"})
	userID := principal.UserID()

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
		revalidate := time.NewTicker(wsRevalidationInterval)
		expires := time.NewTimer(wsMaximumLifetime)
		defer ticker.Stop()
		defer revalidate.Stop()
		defer expires.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if writeErr := writeWSMessage(conn, &writeMu, websocket.PingMessage, nil); writeErr != nil {
					errCh <- writeErr
					return
				}
			case <-revalidate.C:
				if _, authErr := h.principalService.Resolve(token); authErr != nil {
					errCh <- authErr
					return
				}
			case <-expires.C:
				errCh <- newWSAuthError("auth_reauthentication_required", "Authentication must be renewed.", nil)
				return
			}
		}
	}()

	<-errCh
	_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
}
