package auth

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

// ValidateConfiguration makes authentication fail at startup, before any
// callback can be issued with partial or unsafe OAuth configuration.
func ValidateConfiguration() error {
	production := strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "production")
	required := []string{
		"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URL",
		"MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_REDIRECT_URL",
		"FRONTEND_CALLBACK_URL",
	}
	if production {
		required = append(required, "FIREBASE_PROJECT_ID", "GOOGLE_INTEGRATION_REDIRECT_URL",
			"MICROSOFT_INTEGRATION_REDIRECT_URL", "FRONTEND_INTEGRATION_CALLBACK_URL")
	}
	for _, name := range required {
		if strings.TrimSpace(os.Getenv(name)) == "" {
			return fmt.Errorf("%s environment variable is required", name)
		}
	}

	for _, item := range []struct {
		name           string
		allowedPath    string
		frontendTarget bool
	}{
		{"GOOGLE_REDIRECT_URL", "/auth/callback", false},
		{"MICROSOFT_REDIRECT_URL", "/auth/callback", false},
		{"GOOGLE_INTEGRATION_REDIRECT_URL", "/integrations/oauth/callback", false},
		{"MICROSOFT_INTEGRATION_REDIRECT_URL", "/integrations/oauth/callback", false},
		{"FRONTEND_CALLBACK_URL", "/auth/callback", true},
		{"FRONTEND_INTEGRATION_CALLBACK_URL", "/integrations/callback", true},
	} {
		raw := strings.TrimSpace(os.Getenv(item.name))
		if raw == "" {
			continue
		}
		parsed, err := url.Parse(raw)
		if err != nil || parsed.User != nil || parsed.Host == "" || parsed.Path != item.allowedPath {
			return fmt.Errorf("%s must be an absolute callback URL with path %s", item.name, item.allowedPath)
		}
		allowedScheme := parsed.Scheme == "https" || (!production && parsed.Scheme == "http")
		if item.frontendTarget {
			allowedScheme = allowedScheme || parsed.Scheme == "orion"
		}
		if !allowedScheme {
			return fmt.Errorf("%s uses an unsafe URL scheme", item.name)
		}
	}
	return nil
}
