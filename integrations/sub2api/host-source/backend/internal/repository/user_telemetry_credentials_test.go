package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestUserTelemetryCredentialPostgresIsolationPaginationAndRevocation(t *testing.T) {
	dsn := os.Getenv("S2A_TELEMETRY_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("isolated PostgreSQL DSN required")
	}
	if u, err := url.Parse(dsn); err == nil && u.Scheme != "" {
		q := u.Query()
		q.Set("search_path", "pg_temp")
		u.RawQuery = q.Encode()
		dsn = u.String()
	} else {
		dsn += " search_path=pg_temp"
	}
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := context.Background()
	require.NoError(t, db.PingContext(ctx))
	_, err = db.ExecContext(ctx, `CREATE TEMP TABLE sub2api_user_telemetry_credentials(id BIGSERIAL PRIMARY KEY,plugin_id BIGINT NOT NULL,name TEXT NOT NULL,user_ids JSONB NOT NULL,token_hash BYTEA UNIQUE NOT NULL CHECK(octet_length(token_hash)=32),expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),revoked_at TIMESTAMPTZ)`)
	require.NoError(t, err)
	var namespace string
	require.NoError(t, db.QueryRowContext(ctx, `SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid='sub2api_user_telemetry_credentials'::regclass`).Scan(&namespace))
	require.True(t, strings.HasPrefix(namespace, "pg_temp_"))
	_, err = db.ExecContext(ctx, `INSERT INTO sub2api_user_telemetry_credentials(plugin_id,name,user_ids,token_hash,expires_at) SELECT 1,'pagination fixture','["42"]'::jsonb,decode(lpad(to_hex(n),64,'0'),'hex'),NOW()+INTERVAL '1 hour' FROM generate_series(1,1002) n`)
	require.NoError(t, err)
	store := NewUserTelemetryCredentialStore(db)
	seen := map[int64]bool{}
	var cursor int64
	pages := 0
	for {
		page, err := store.List(ctx, 1, cursor, 100)
		require.NoError(t, err)
		require.LessOrEqual(t, len(page.Credentials), 100)
		pages++
		for _, credential := range page.Credentials {
			require.False(t, seen[credential.ID])
			seen[credential.ID] = true
		}
		raw, err := json.Marshal(page)
		require.NoError(t, err)
		require.NotContains(t, string(raw), "token_hash")
		if page.NextCursor == nil {
			break
		}
		cursor, err = strconv.ParseInt(*page.NextCursor, 10, 64)
		require.NoError(t, err)
		require.Equal(t, cursor, page.Credentials[len(page.Credentials)-1].ID)
		require.Less(t, pages, 20)
	}
	require.Len(t, seen, 1002)
	require.Equal(t, 11, pages)
	require.True(t, seen[1])
	token, hash, err := service.NewUserTelemetrySecret()
	require.NoError(t, err)
	expiresAt := time.Now().Add(time.Hour)
	credential := &service.UserTelemetryCredential{PluginID: 2, Name: "auth fixture", UserIDs: []string{"42"}, TokenHash: hash, ExpiresAt: &expiresAt}
	require.NoError(t, store.Create(ctx, credential))
	authenticated, err := store.Authenticate(ctx, 2, service.UserTelemetrySecretHash(token))
	require.NoError(t, err)
	require.Equal(t, credential.ID, authenticated.ID)
	_, err = store.Authenticate(ctx, 1, hash)
	require.ErrorIs(t, err, service.ErrTelemetryUnauthorized)
	require.Error(t, store.Revoke(ctx, 1, credential.ID))
	require.NoError(t, store.Revoke(ctx, 2, credential.ID))
	_, err = store.Authenticate(ctx, 2, hash)
	require.ErrorIs(t, err, service.ErrTelemetryUnauthorized)
	permanentToken, permanentHash, err := service.NewUserTelemetrySecret()
	require.NoError(t, err)
	permanent := &service.UserTelemetryCredential{PluginID: 2, Name: "permanent fixture", UserIDs: []string{"42"}, TokenHash: permanentHash}
	require.NoError(t, store.Create(ctx, permanent))
	authenticated, err = store.Authenticate(ctx, 2, service.UserTelemetrySecretHash(permanentToken))
	require.NoError(t, err)
	require.Nil(t, authenticated.ExpiresAt)
	page, err := store.List(ctx, 2, 0, 100)
	require.NoError(t, err)
	rawPage, err := json.Marshal(page)
	require.NoError(t, err)
	require.Contains(t, string(rawPage), `"expires_at":null`)
	require.NoError(t, store.Revoke(ctx, 2, permanent.ID))
	_, err = store.Authenticate(ctx, 2, service.UserTelemetrySecretHash(permanentToken))
	require.ErrorIs(t, err, service.ErrTelemetryUnauthorized)
	_, expiredHash, err := service.NewUserTelemetrySecret()
	require.NoError(t, err)
	expiredAt := time.Now().Add(-time.Minute)
	require.NoError(t, store.Create(ctx, &service.UserTelemetryCredential{PluginID: 2, Name: "expiry fixture", UserIDs: []string{"42"}, TokenHash: expiredHash, ExpiresAt: &expiredAt}))
	_, err = store.Authenticate(ctx, 2, expiredHash)
	require.ErrorIs(t, err, service.ErrTelemetryUnauthorized)
	t.Log("real PostgreSQL temporary schema; 1002 credentials across 11 pages; plugin binding, expiry, immediate revocation")
}
