package providers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"golang.org/x/oauth2"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/profile"
)

type MicrosoftProvider struct {
	config *oauth2.Config
}

func NewMicrosoftProvider() *MicrosoftProvider {
	return &MicrosoftProvider{
		config: &oauth2.Config{
			ClientID:     os.Getenv("MICROSOFT_CLIENT_ID"),
			ClientSecret: os.Getenv("MICROSOFT_CLIENT_SECRET"),
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
				TokenURL: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
			},
			Scopes:      []string{"openid", "email", "profile", "offline_access", "User.Read"},
			RedirectURL: os.Getenv("MICROSOFT_REDIRECT_URL"),
		},
	}
}

func (p *MicrosoftProvider) Name() models.AuthProvider {
	return models.AuthProviderMicrosoft
}

func (p *MicrosoftProvider) Config() *oauth2.Config {
	return p.config
}

func (p *MicrosoftProvider) AuthCodeURL(state string) string {
	return p.config.AuthCodeURL(state, oauth2.AccessTypeOffline)
}

func (p *MicrosoftProvider) Exchange(code string) (*NormalizedAuthProfile, error) {
	token, err := p.config.Exchange(oauth2.NoContext, code)
	if err != nil {
		return nil, fmt.Errorf("failed to exchange authorization code: %w", err)
	}

	client := p.config.Client(oauth2.NoContext, token)
	resp, err := client.Get("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName")
	if err != nil {
		return nil, fmt.Errorf("failed to get Microsoft profile: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Microsoft profile returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Microsoft profile response: %w", err)
	}

	var microsoftUser struct {
		ID                string `json:"id"`
		DisplayName       string `json:"displayName"`
		Mail              string `json:"mail"`
		UserPrincipalName string `json:"userPrincipalName"`
	}
	if err := json.Unmarshal(body, &microsoftUser); err != nil {
		return nil, fmt.Errorf("failed to parse Microsoft profile: %w", err)
	}

	email := microsoftUser.Mail
	if email == "" {
		email = microsoftUser.UserPrincipalName
	}
	if microsoftUser.ID == "" {
		return nil, fmt.Errorf("Microsoft profile missing id")
	}
	if email == "" {
		return nil, fmt.Errorf("Microsoft profile missing email")
	}

	rawClaims := map[string]any{}
	if err := json.Unmarshal(body, &rawClaims); err != nil {
		rawClaims = map[string]any{
			"id":                microsoftUser.ID,
			"displayName":       microsoftUser.DisplayName,
			"mail":              microsoftUser.Mail,
			"userPrincipalName": microsoftUser.UserPrincipalName,
		}
	}
	avatarData, avatarMimeType := fetchMicrosoftProfilePhoto(client)

	return &NormalizedAuthProfile{
		Provider:       models.AuthProviderMicrosoft,
		ProviderUserID: microsoftUser.ID,
		Email:          email,
		EmailVerified:  true,
		DisplayName:    microsoftUser.DisplayName,
		AvatarData:     avatarData,
		AvatarMimeType: avatarMimeType,
		RawClaims:      rawClaims,
	}, nil
}

func fetchMicrosoftProfilePhoto(client *http.Client) ([]byte, string) {
	resp, err := client.Get("https://graph.microsoft.com/v1.0/me/photo/$value")
	if err != nil {
		return nil, ""
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ""
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, ""
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, profile.MaxAvatarBytes+1))
	if err != nil || len(data) == 0 || len(data) > profile.MaxAvatarBytes {
		return nil, ""
	}

	mimeType := resp.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}
	if profile.IsSupportedAvatarMimeType(mimeType) {
		return data, mimeType
	}
	return nil, ""
}
