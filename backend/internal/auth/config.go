package auth

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	SupabaseURL            string
	SupabasePublishableKey string
}

func LoadConfig() (Config, error) {
	config := Config{
		SupabaseURL:            strings.TrimRight(strings.TrimSpace(os.Getenv("SUPABASE_URL")), "/"),
		SupabasePublishableKey: strings.TrimSpace(os.Getenv("SUPABASE_PUBLISHABLE_KEY")),
	}
	if config.SupabaseURL == "" {
		return Config{}, fmt.Errorf("SUPABASE_URL environment variable is required")
	}
	parsed, err := url.Parse(config.SupabaseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil ||
		(parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return Config{}, fmt.Errorf("SUPABASE_URL must be an absolute HTTPS project URL")
	}
	if config.SupabasePublishableKey == "" {
		return Config{}, fmt.Errorf("SUPABASE_PUBLISHABLE_KEY environment variable is required")
	}
	if !strings.HasPrefix(config.SupabasePublishableKey, "sb_publishable_") {
		return Config{}, fmt.Errorf("SUPABASE_PUBLISHABLE_KEY must be a modern Supabase publishable key")
	}
	return config, nil
}

// ValidateIntegrationConfiguration keeps calendar authorization independent
// from login and rejects partial or unsafe OAuth callback configuration.
func ValidateIntegrationConfiguration() error {
	production := strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "production")
	required := []string{
		"GOOGLE_INTEGRATION_CLIENT_ID", "GOOGLE_INTEGRATION_CLIENT_SECRET", "GOOGLE_INTEGRATION_REDIRECT_URL",
		"MICROSOFT_INTEGRATION_CLIENT_ID", "MICROSOFT_INTEGRATION_CLIENT_SECRET", "MICROSOFT_INTEGRATION_REDIRECT_URL",
		"FRONTEND_INTEGRATION_CALLBACK_URL",
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
		{"GOOGLE_INTEGRATION_REDIRECT_URL", "/integrations/oauth/callback", false},
		{"MICROSOFT_INTEGRATION_REDIRECT_URL", "/integrations/oauth/callback", false},
		{"FRONTEND_INTEGRATION_CALLBACK_URL", "/integrations/callback", true},
	} {
		parsed, err := url.Parse(strings.TrimSpace(os.Getenv(item.name)))
		if err != nil || parsed.User != nil || parsed.Host == "" || parsed.Path != item.allowedPath || parsed.RawQuery != "" || parsed.Fragment != "" {
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
