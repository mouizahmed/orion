package handlers

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mouizahmed/justscribe-backend/internal/middleware"
)

func getUserID(c *gin.Context) (string, error) {
	principal, ok := middleware.GetPrincipal(c)
	if !ok {
		return "", fmt.Errorf("user not authenticated")
	}
	return principal.UserID(), nil
}

func sanitizeFileName(name string) string {
	cleaned := strings.ReplaceAll(name, "\\", "")
	cleaned = strings.ReplaceAll(cleaned, "/", "")
	cleaned = strings.ReplaceAll(cleaned, " ", "-")
	if cleaned == "" {
		cleaned = fmt.Sprintf("attachment-%s.bin", uuid.NewString())
	}
	return cleaned
}
