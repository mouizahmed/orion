package providers

import (
	"golang.org/x/oauth2"

	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type AuthProvider interface {
	Name() models.AuthProvider
	Config() *oauth2.Config
	AuthCodeURL(state string) string
	Exchange(code string) (*NormalizedAuthProfile, error)
}

type NormalizedAuthProfile struct {
	Provider       models.AuthProvider
	ProviderUserID string
	Email          string
	EmailVerified  bool
	DisplayName    string
	AvatarURL      string
	RawClaims      map[string]any
}
