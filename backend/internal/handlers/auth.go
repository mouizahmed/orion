package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	orionauth "github.com/mouizahmed/justscribe-backend/internal/auth"
	"github.com/mouizahmed/justscribe-backend/internal/email"
	"github.com/mouizahmed/justscribe-backend/internal/middleware"
)

type AuthHandler struct {
	principals *orionauth.PrincipalService
	supabase   *orionauth.SupabaseClient
	emailSvc   *email.Service
	wsHub      *WsHub
}

func NewAuthHandler(principals *orionauth.PrincipalService, supabase *orionauth.SupabaseClient, emailSvc *email.Service, wsHub *WsHub) *AuthHandler {
	return &AuthHandler{principals: principals, supabase: supabase, emailSvc: emailSvc, wsHub: wsHub}
}

// Session validates an authoritative managed Supabase session and provisions
// the matching application profile when it is genuinely absent.
func (h *AuthHandler) Session(c *gin.Context) {
	accessToken, code, message := middleware.BearerToken(c.GetHeader("Authorization"))
	if code != "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": code, "error": message, "message": message})
		return
	}
	principal, created, err := h.principals.Bootstrap(c.Request.Context(), accessToken)
	if err != nil {
		writePrincipalError(c, err)
		return
	}
	if created && h.emailSvc != nil {
		emailAddress, name := principal.User.Email, principal.User.Name
		go func() {
			if err := h.emailSvc.SendWelcome(emailAddress, name); err != nil {
				log.Printf("failed to send welcome email: %v", err)
			}
		}()
	}
	c.JSON(http.StatusOK, gin.H{"status": "success", "user": principal.User})
}

func (h *AuthHandler) LogoutAllDevices(c *gin.Context) {
	principal, ok := middleware.GetPrincipal(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "auth_required", "error": "Authentication is required."})
		return
	}
	accessToken, code, message := middleware.BearerToken(c.GetHeader("Authorization"))
	if code != "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": code, "error": message})
		return
	}
	if err := h.supabase.SignOut(c.Request.Context(), accessToken, "global"); err != nil {
		writePrincipalError(c, mapAuthClientError(err))
		return
	}
	h.wsHub.DisconnectUser(principal.UserID(), "session revoked")
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func mapAuthClientError(err error) error {
	var sessionErr *orionauth.SessionError
	if errors.As(err, &sessionErr) && sessionErr.Code == orionauth.SessionUpstreamFailure {
		return &orionauth.PrincipalError{Code: orionauth.PrincipalServiceUnavailable, Message: "Authentication service is unavailable.", Cause: err}
	}
	return &orionauth.PrincipalError{Code: orionauth.PrincipalTokenInvalid, Message: "Your session is no longer valid.", Cause: err}
}

func writePrincipalError(c *gin.Context, err error) {
	var principalErr *orionauth.PrincipalError
	if !errors.As(err, &principalErr) {
		principalErr = &orionauth.PrincipalError{Code: orionauth.PrincipalServiceUnavailable, Message: "Authentication service is unavailable.", Cause: err}
	}
	status := orionauth.StatusForPrincipalError(principalErr)
	if status == http.StatusServiceUnavailable {
		log.Printf("authentication unavailable: %v", principalErr)
	}
	c.JSON(status, gin.H{"code": string(principalErr.Code), "error": principalErr.Message, "message": principalErr.Message})
}
