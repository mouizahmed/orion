package repository

import (
	"encoding/json"
	"testing"
	"time"
)

func TestConnectorControlPlaneHelpers(t *testing.T) {
	t.Parallel()
	if got := string(normalizedJSON(json.RawMessage(`{"ok":true}`))); got != `{"ok":true}` {
		t.Fatalf("valid JSON changed: %s", got)
	}
	if got := string(normalizedJSON(json.RawMessage(`not-json`))); got != `{}` {
		t.Fatalf("invalid JSON was retained: %s", got)
	}
	if got := safeOperationalCode("private email@example.com"); got != "redacted_error" {
		t.Fatalf("unsafe error code was retained: %s", got)
	}
	if got := safeOperationalCode("provider.rate_limited"); got != "provider.rate_limited" {
		t.Fatalf("safe error code changed: %s", got)
	}
	if got := intervalString(1500 * time.Millisecond); got != "1.500000 seconds" {
		t.Fatalf("interval = %s", got)
	}
}
