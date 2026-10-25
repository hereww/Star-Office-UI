package service

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

func TestUserTelemetryCredentialEntropyAndNoSerialization(t *testing.T) {
	a, ha, e := NewUserTelemetrySecret()
	if e != nil {
		t.Fatal(e)
	}
	b, hb, e := NewUserTelemetrySecret()
	if e != nil {
		t.Fatal(e)
	}
	if len(a) != 48 || a == b || bytes.Equal(ha, hb) || !bytes.Equal(ha, UserTelemetrySecretHash(a)) {
		t.Fatal("invalid scoped credential entropy/hash")
	}
	expiresAt := time.Now()
	raw, e := json.Marshal(UserTelemetryCredential{TokenHash: ha, ExpiresAt: &expiresAt})
	if e != nil || bytes.Contains(raw, ha) || bytes.Contains(raw, []byte(a)) || bytes.Contains(raw, []byte("token_hash")) {
		t.Fatal("credential hash disclosed")
	}
}

func TestUserTelemetryCredentialPermanentExpirySerializesAsNull(t *testing.T) {
	raw, err := json.Marshal(UserTelemetryCredential{ExpiresAt: nil})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"expires_at":null`)) || bytes.Contains(raw, []byte("token_hash")) {
		t.Fatalf("permanent credential serialization is not safe: %s", raw)
	}
}
