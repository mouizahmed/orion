package handlers

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"golang.org/x/oauth2"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func oauthResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestIntegrationOAuthExchangeDoesNotExposeTokenEndpointPayload(t *testing.T) {
	secret := "provider-secret-description"
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return oauthResponse(http.StatusBadRequest, `{"error":"invalid_grant","error_description":"`+secret+`"}`), nil
	})}
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, client)
	config := &oauth2.Config{Endpoint: oauth2.Endpoint{TokenURL: "https://token.invalid"}}
	_, _, err := exchangeMicrosoftIntegrationCode(ctx, config, "code")
	if err == nil || strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "invalid_grant") {
		t.Fatalf("token response escaped redaction: %v", err)
	}
}

func TestIntegrationOAuthProfileErrorDoesNotExposePayload(t *testing.T) {
	secret := "provider-profile-secret"
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host == "token.invalid" {
			return oauthResponse(http.StatusOK, `{"access_token":"token","token_type":"Bearer","expires_in":3600}`), nil
		}
		return oauthResponse(http.StatusBadRequest, `{"error":{"message":"`+secret+`"}}`), nil
	})}
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, client)
	config := &oauth2.Config{Endpoint: oauth2.Endpoint{TokenURL: "https://token.invalid"}}
	_, _, err := exchangeMicrosoftIntegrationCode(ctx, config, "code")
	if err == nil || strings.Contains(err.Error(), secret) {
		t.Fatalf("profile response escaped redaction: %v", err)
	}
}
