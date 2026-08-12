package providers

import (
	"context"
	"golang.org/x/oauth2"

	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type AuthProvider interface {
	Name() models.AuthProvider
	Config() *oauth2.Config
	AuthCodeURL(state string) string
	Exchange(ctx context.Context, code string) (*NormalizedAuthProfile, error)
}

type NormalizedAuthProfile struct {
	Provider         models.AuthProvider
	ProviderTenantID string
	ProviderUserID   string
	Email            string
	EmailVerified    bool
	DisplayName      string
	AvatarURL        string
	AvatarData       []byte
	AvatarMimeType   string
}
