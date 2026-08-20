package billing

import (
	"fmt"
	"net/url"
	"strings"
)

func validatedStripeHostedURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("Stripe returned an invalid hosted URL")
	}
	hostname := strings.ToLower(parsed.Hostname())
	// Stripe Checkout URLs may include an opaque fragment used by Stripe's
	// hosted client. Fragments are not sent to the origin server, so retain it
	// while continuing to enforce HTTPS and an exact Stripe-owned hostname.
	if parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil ||
		(hostname != "stripe.com" && !strings.HasSuffix(hostname, ".stripe.com")) {
		return "", fmt.Errorf("Stripe returned an invalid hosted URL")
	}
	return parsed.String(), nil
}
