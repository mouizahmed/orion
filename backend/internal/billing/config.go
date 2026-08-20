package billing

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/mouizahmed/justscribe-backend/internal/entitlements"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type Mode string

const (
	ModeTest Mode = "test"
	ModeLive Mode = "live"
)

type OfferKey string

const (
	OfferProfessionalMonthly OfferKey = "professional_monthly"
	OfferProfessionalAnnual  OfferKey = "professional_annual"
)

type Offer struct {
	Key       OfferKey
	Plan      models.UserPlan
	PriceID   string
	Interval  string
	TrialDays int64
}

type Config struct {
	Enabled                       bool
	Mode                          Mode
	APIKey                        string
	WebhookSecret                 string
	CustomerPortalConfigurationID string
	CheckoutSuccessURL            string
	CheckoutCancelURL             string
	PortalReturnURL               string
	offers                        map[OfferKey]Offer
	prices                        map[string]Offer
}

func LoadConfig() (Config, error) {
	enabled, err := parseEnabled(os.Getenv("STRIPE_BILLING_ENABLED"))
	if err != nil {
		return Config{}, err
	}
	if !enabled {
		return Config{Enabled: false}, nil
	}

	config := Config{
		Enabled:                       true,
		APIKey:                        strings.TrimSpace(os.Getenv("STRIPE_API_KEY")),
		WebhookSecret:                 strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET")),
		CustomerPortalConfigurationID: strings.TrimSpace(os.Getenv("STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID")),
		CheckoutSuccessURL:            strings.TrimSpace(os.Getenv("STRIPE_CHECKOUT_SUCCESS_URL")),
		CheckoutCancelURL:             strings.TrimSpace(os.Getenv("STRIPE_CHECKOUT_CANCEL_URL")),
		PortalReturnURL:               strings.TrimSpace(os.Getenv("STRIPE_PORTAL_RETURN_URL")),
	}

	config.Mode, err = modeFromAPIKey(config.APIKey)
	if err != nil {
		return Config{}, err
	}
	if !strings.HasPrefix(config.WebhookSecret, "whsec_") {
		return Config{}, fmt.Errorf("STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret")
	}
	if !strings.HasPrefix(config.CustomerPortalConfigurationID, "bpc_") {
		return Config{}, fmt.Errorf("STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID must be a Stripe portal configuration ID")
	}

	appEnvironment := strings.TrimSpace(os.Getenv("APP_ENV"))
	production := strings.EqualFold(appEnvironment, "production")
	if config.Mode == ModeLive && !production {
		return Config{}, fmt.Errorf("APP_ENV must be production when live Stripe billing is enabled")
	}
	for name, value := range map[string]string{
		"STRIPE_CHECKOUT_SUCCESS_URL": config.CheckoutSuccessURL,
		"STRIPE_CHECKOUT_CANCEL_URL":  config.CheckoutCancelURL,
		"STRIPE_PORTAL_RETURN_URL":    config.PortalReturnURL,
	} {
		if err := validateReturnURL(name, value, production || config.Mode == ModeLive); err != nil {
			return Config{}, err
		}
	}
	if !strings.Contains(config.CheckoutSuccessURL, "{CHECKOUT_SESSION_ID}") {
		return Config{}, fmt.Errorf("STRIPE_CHECKOUT_SUCCESS_URL must include {CHECKOUT_SESSION_ID}")
	}

	config.offers = make(map[OfferKey]Offer)
	for _, catalogOffer := range entitlements.ProductCatalog().Offers {
		key := OfferKey(catalogOffer.Key)
		var priceEnvironmentVariable string
		switch key {
		case OfferProfessionalMonthly:
			priceEnvironmentVariable = "STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID"
		case OfferProfessionalAnnual:
			priceEnvironmentVariable = "STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID"
		default:
			return Config{}, fmt.Errorf("product catalog contains unknown offer %q", key)
		}
		if catalogOffer.PlanKey != models.UserPlanPro || (catalogOffer.Interval != "month" && catalogOffer.Interval != "year") || catalogOffer.TrialDays < 0 {
			return Config{}, fmt.Errorf("product catalog offer %q is invalid", key)
		}
		config.offers[key] = Offer{
			Key:       key,
			Plan:      catalogOffer.PlanKey,
			PriceID:   strings.TrimSpace(os.Getenv(priceEnvironmentVariable)),
			Interval:  catalogOffer.Interval,
			TrialDays: catalogOffer.TrialDays,
		}
	}
	if len(config.offers) != 2 {
		return Config{}, fmt.Errorf("product catalog must define both Professional offers")
	}
	config.prices = make(map[string]Offer, len(config.offers))
	for _, offer := range config.offers {
		if !strings.HasPrefix(offer.PriceID, "price_") {
			return Config{}, fmt.Errorf("price ID for offer %q is invalid", offer.Key)
		}
		if _, exists := config.prices[offer.PriceID]; exists {
			return Config{}, fmt.Errorf("Stripe price IDs must be unique")
		}
		config.prices[offer.PriceID] = offer
	}

	return config, nil
}

func (c Config) Livemode() bool {
	return c.Mode == ModeLive
}

func (c Config) Offer(key OfferKey) (Offer, error) {
	if !c.Enabled {
		return Offer{}, fmt.Errorf("billing is disabled")
	}
	offer, ok := c.offers[key]
	if !ok {
		return Offer{}, fmt.Errorf("unknown billing offer %q", key)
	}
	return offer, nil
}

func (c Config) OfferForPrice(priceID string, livemode bool) (Offer, error) {
	if !c.Enabled {
		return Offer{}, fmt.Errorf("billing is disabled")
	}
	if livemode != c.Livemode() {
		return Offer{}, fmt.Errorf("Stripe object mode does not match backend billing mode")
	}
	offer, ok := c.prices[strings.TrimSpace(priceID)]
	if !ok {
		return Offer{}, fmt.Errorf("unknown Stripe price")
	}
	return offer, nil
}

func parseEnabled(raw string) (bool, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false, nil
	}
	enabled, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("STRIPE_BILLING_ENABLED must be true or false")
	}
	return enabled, nil
}

func modeFromAPIKey(key string) (Mode, error) {
	switch {
	case strings.HasPrefix(key, "rk_test_"):
		return ModeTest, nil
	case strings.HasPrefix(key, "rk_live_"):
		return ModeLive, nil
	default:
		return "", fmt.Errorf("STRIPE_API_KEY must be a restricted Stripe API key")
	}
}

func validateReturnURL(name, value string, production bool) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return fmt.Errorf("%s must be an absolute HTTP(S) URL without credentials or a fragment", name)
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && !production && isLoopbackHost(parsed.Hostname())) {
		return fmt.Errorf("%s must use HTTPS, except for a development loopback URL", name)
	}
	if production && isLoopbackHost(parsed.Hostname()) {
		return fmt.Errorf("%s must not use a loopback host in production", name)
	}
	return nil
}

func isLoopbackHost(host string) bool {
	return strings.EqualFold(host, "localhost") || host == "127.0.0.1" || host == "::1"
}
