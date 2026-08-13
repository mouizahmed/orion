package middleware

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	orionauth "github.com/mouizahmed/justscribe-backend/internal/auth"
)

const principalContextKey = "authPrincipal"

func AuthMiddleware(service *orionauth.PrincipalService) gin.HandlerFunc {
	return func(c *gin.Context) {
		accessToken, code, message := BearerToken(c.GetHeader("Authorization"))
		if code != "" {
			writeAuthError(c, http.StatusUnauthorized, code, message)
			return
		}
		principal, err := service.Resolve(c.Request.Context(), accessToken)
		if err != nil {
			var principalErr *orionauth.PrincipalError
			if !errors.As(err, &principalErr) {
				log.Printf("unexpected principal resolution error: %v", err)
				writeAuthError(c, http.StatusServiceUnavailable, string(orionauth.PrincipalServiceUnavailable), "Authentication service is unavailable.")
				return
			}
			status := orionauth.StatusForPrincipalError(err)
			if status == http.StatusServiceUnavailable {
				log.Printf("principal resolution unavailable: %v", principalErr)
			}
			writeAuthError(c, status, string(principalErr.Code), principalErr.Message)
			return
		}
		c.Set(principalContextKey, principal)
		c.Next()
	}
}

func GetPrincipal(c *gin.Context) (*orionauth.Principal, bool) {
	value, exists := c.Get(principalContextKey)
	if !exists {
		return nil, false
	}
	principal, ok := value.(*orionauth.Principal)
	return principal, ok && principal != nil && principal.UserID() != ""
}

func BearerToken(header string) (token, code, message string) {
	if strings.TrimSpace(header) == "" {
		return "", "auth_header_missing", "Authentication is required."
	}
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", "auth_header_invalid", "Authorization header must use Bearer authentication."
	}
	return parts[1], "", ""
}

func writeAuthError(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"code": code, "error": message, "message": message})
}
