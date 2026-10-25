package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"
)

var ErrTelemetryUnauthorized = errors.New("invalid telemetry credential")
var ErrTelemetryCredentialNotFound = errors.New("telemetry credential not found")

type UserTelemetryCredential struct {
	ID        int64      `json:"id"`
	PluginID  int64      `json:"plugin_id"`
	Name      string     `json:"name"`
	UserIDs   []string   `json:"user_ids"`
	TokenHash []byte     `json:"-"`
	ExpiresAt *time.Time `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
	RevokedAt *time.Time `json:"revoked_at"`
}
type UserTelemetryCredentialPage struct {
	Credentials []UserTelemetryCredential `json:"credentials"`
	NextCursor  *string                   `json:"next_cursor"`
}
type UserTelemetryCredentialStore interface {
	Create(context.Context, *UserTelemetryCredential) error
	Authenticate(context.Context, int64, []byte) (*UserTelemetryCredential, error)
	List(context.Context, int64, int64, int) (*UserTelemetryCredentialPage, error)
	Revoke(context.Context, int64, int64) error
}

func NewUserTelemetrySecret() (string, []byte, error) {
	var entropy [32]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", nil, err
	}
	token := "s2ut_" + base64.RawURLEncoding.EncodeToString(entropy[:])
	hash := sha256.Sum256([]byte(token))
	return token, hash[:], nil
}
func UserTelemetrySecretHash(token string) []byte { h := sha256.Sum256([]byte(token)); return h[:] }
