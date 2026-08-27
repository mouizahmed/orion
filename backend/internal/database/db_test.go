package database

import (
	"context"
	"testing"
)

func TestBeginTenantTxRejectsInvalidTenantBeforeDatabaseAccess(t *testing.T) {
	t.Parallel()
	db := &DB{}
	if _, err := db.BeginTenantTx(context.Background(), "not-a-uuid", nil); err == nil {
		t.Fatal("invalid tenant was accepted")
	}
}
