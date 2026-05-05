package providers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"

	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type GoogleProvider struct {
	config *oauth2.Config
}

func NewGoogleProvider() *GoogleProvider {
	return &GoogleProvider{
		config: &oauth2.Config{
			ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
			ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
			Endpoint:     google.Endpoint,
			Scopes:       []string{"openid", "email", "profile"},
			RedirectURL:  os.Getenv("GOOGLE_REDIRECT_URL"),
		},
	}
}

func (p *GoogleProvider) Name() models.AuthProvider {
	return models.AuthProviderGoogle
}

func (p *GoogleProvider) Config() *oauth2.Config {
	return p.config
}

func (p *GoogleProvider) AuthCodeURL(state string) string {
	return p.config.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.ApprovalForce,
		oauth2.SetAuthURLParam("include_granted_scopes", "true"))
}

func (p *GoogleProvider) Exchange(code string) (*NormalizedAuthProfile, error) {
	token, err := p.config.Exchange(oauth2.NoContext, code)
	if err != nil {
		return nil, fmt.Errorf("failed to exchange authorization code: %w", err)
	}

	client := p.config.Client(oauth2.NoContext, token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return nil, fmt.Errorf("failed to get Google user info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Google user info returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Google user info response: %w", err)
	}

	var googleUser struct {
		ID            string `json:"id"`
		Email         string `json:"email"`
		VerifiedEmail bool   `json:"verified_email"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := json.Unmarshal(body, &googleUser); err != nil {
		return nil, fmt.Errorf("failed to parse Google user info: %w", err)
	}
	if googleUser.ID == "" {
		return nil, fmt.Errorf("Google user info missing id")
	}
	if googleUser.Email == "" {
		return nil, fmt.Errorf("Google user info missing email")
	}
	if !googleUser.VerifiedEmail {
		return nil, fmt.Errorf("Google email is not verified")
	}

	rawClaims := map[string]any{}
	if err := json.Unmarshal(body, &rawClaims); err != nil {
		rawClaims = map[string]any{
			"id":             googleUser.ID,
			"email":          googleUser.Email,
			"verified_email": googleUser.VerifiedEmail,
			"name":           googleUser.Name,
			"picture":        googleUser.Picture,
		}
	}

	return &NormalizedAuthProfile{
		Provider:       models.AuthProviderGoogle,
		ProviderUserID: googleUser.ID,
		Email:          googleUser.Email,
		EmailVerified:  googleUser.VerifiedEmail,
		DisplayName:    googleUser.Name,
		AvatarURL:      googleUser.Picture,
		RawClaims:      rawClaims,
	}, nil
}
