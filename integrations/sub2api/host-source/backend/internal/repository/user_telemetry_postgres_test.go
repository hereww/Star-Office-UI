package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

// Opt in with S2A_TELEMETRY_TEST_POSTGRES_DSN. This never starts a database or
// writes production tables: search_path=pg_temp and one connection isolate all
// fixtures in temporary tables (including a deliberately secret key column).
// Optional S2A_TELEMETRY_TEST_REDIS_ADDR exercises the real cache as well; it
// performs the existing batch reader's expired-slot cleanup but creates no slots.
func TestUserTelemetryRealPostgresRecordedUsage(t *testing.T) {
	dsn := os.Getenv("S2A_TELEMETRY_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set S2A_TELEMETRY_TEST_POSTGRES_DSN to run isolated real PostgreSQL acceptance")
	}
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		u, err := url.Parse(dsn)
		require.NoError(t, err)
		q := u.Query()
		q.Set("search_path", "pg_temp")
		u.RawQuery = q.Encode()
		dsn = u.String()
	} else {
		dsn += " search_path=pg_temp"
	}
	db, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	require.NoError(t, db.PingContext(ctx))
	for _, statement := range []string{
		`CREATE TEMP TABLE users (id bigint PRIMARY KEY, email text NOT NULL, username text NOT NULL, concurrency integer NOT NULL, status text NOT NULL, deleted_at timestamptz)`,
		`CREATE TEMP TABLE api_keys (id bigint PRIMARY KEY, user_id bigint NOT NULL, name text NOT NULL, status text NOT NULL, deleted_at timestamptz, key text NOT NULL)`,
		`CREATE TEMP TABLE usage_logs (user_id bigint NOT NULL, api_key_id bigint NOT NULL, created_at timestamptz NOT NULL, input_tokens bigint NOT NULL, output_tokens bigint NOT NULL, cache_creation_tokens bigint NOT NULL, cache_read_tokens bigint NOT NULL, cache_creation_5m_tokens bigint NOT NULL DEFAULT 0, cache_creation_1h_tokens bigint NOT NULL DEFAULT 0, total_cost numeric NOT NULL DEFAULT 0)`,
		`INSERT INTO users VALUES (9007199254740993,'first@example.test','',5,'disabled',NULL), (9007199254740994,'second@example.test','second',0,'active',NULL), (9007199254740995,'deleted@example.test','deleted',5,'active','2020-01-01'), (9007199254740996,'no-usage@example.test','no-usage',5,'active',NULL)`,
		`INSERT INTO api_keys VALUES (9007199254740101,9007199254740993,'first-live','active',NULL,'NEVER_EXPORT_THIS_SECRET'), (9007199254740102,9007199254740993,'first-rotated','disabled',NULL,'NEVER_EXPORT_THIS_SECRET'), (9007199254740103,9007199254740993,'first-deleted','active','2020-01-01','NEVER_EXPORT_THIS_SECRET'), (9007199254740104,9007199254740994,'second-live','active',NULL,'NEVER_EXPORT_THIS_SECRET')`,
		// Four components produce 10; subitems/cost must not make it 9010+.
		`INSERT INTO usage_logs VALUES (9007199254740993,9007199254740101,'2020-01-01T00:00:00Z',1,2,3,4,4000,5000,999)`,
		`INSERT INTO usage_logs VALUES (9007199254740993,9007199254740102,'2020-01-01T12:00:00Z',20,0,0,0,0,0,0)`,
		// Deleted key history still contributes, with per-row numeric addition
		// and SUM exceeding bigint: 2*MaxInt64 + 30 = 18446744073709551644.
		`INSERT INTO usage_logs VALUES (9007199254740993,9007199254740103,'2020-01-01T18:00:00Z',9223372036854775807,9223372036854775807,0,0,0,0,0)`,
		`INSERT INTO usage_logs VALUES (9007199254740994,9007199254740104,'2020-01-01T01:00:00Z',7,0,0,0,0,0,0)`,
		// Out-of-window entries do not leak into [start,end).
		`INSERT INTO usage_logs VALUES (9007199254740993,9007199254740101,'2019-12-31T23:59:59Z',555,0,0,0,0,0,0), (9007199254740993,9007199254740101,'2020-01-02T00:00:00Z',777,0,0,0,0,0,0)`,
	} {
		_, err := db.ExecContext(ctx, statement)
		require.NoError(t, err)
	}
	// PostgreSQL creates a dedicated pg_temp_N schema for this session. Prove
	// every unqualified fixture name resolves there, never to the seed tables.
	var schema string
	require.NoError(t, db.QueryRowContext(ctx, `SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()`).Scan(&schema))
	require.True(t, strings.HasPrefix(schema, "pg_temp_"))
	t.Logf("isolated fixture schema: %s (session temporary; search_path=pg_temp)", schema)
	for _, table := range []string{"users", "api_keys", "usage_logs"} {
		var isolated bool
		require.NoError(t, db.QueryRowContext(ctx, `SELECT to_regclass($1)::oid = to_regclass('pg_temp.' || $1)::oid`, table).Scan(&isolated))
		require.True(t, isolated, "fixture must resolve to the private temporary schema: %s", table)
	}
	var concurrency *service.ConcurrencyService
	if addr := os.Getenv("S2A_TELEMETRY_TEST_REDIS_ADDR"); addr != "" {
		client := redis.NewClient(&redis.Options{Addr: addr})
		t.Cleanup(func() { _ = client.Close() })
		require.NoError(t, client.Ping(ctx).Err())
		concurrency = service.NewConcurrencyService(NewConcurrencyCache(client, 15, 900))
	}
	svc := service.NewUserTelemetryService(db, concurrency)
	query := json.RawMessage(`{"user_ids":["9007199254740993","9007199254740994","9007199254740995","9007199254740996"],"page_size":2,"start":"2020-01-01T00:00:00Z","end":"2020-01-02T00:00:00Z"}`)
	raw, err := svc.ReadUserTelemetry(ctx, query)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "NEVER_EXPORT_THIS_SECRET")
	var snapshot usertelemetry.Snapshot
	require.NoError(t, json.Unmarshal(raw, &snapshot))
	require.Len(t, snapshot.Users, 2)
	require.Equal(t, "9007199254740994", *snapshot.NextCursor)
	first, second := snapshot.Users[0], snapshot.Users[1]
	require.Equal(t, "9007199254740993", first.UserID)
	require.Empty(t, first.Username)
	require.Len(t, first.APIKeys, 2)
	require.Equal(t, "9007199254740101", first.APIKeys[0].ID)
	require.Equal(t, "9007199254740102", first.APIKeys[1].ID)
	require.Equal(t, "18446744073709551644", *first.TokenUsage.Total)
	require.Len(t, second.APIKeys, 1)
	require.Equal(t, "7", *second.TokenUsage.Total)
	require.Equal(t, "untracked", second.Quality.Concurrency)
	require.Nil(t, second.Concurrency.Current)
	if concurrency == nil {
		require.Equal(t, "unavailable", first.Quality.Concurrency)
		require.Nil(t, first.Concurrency.Current)
	} else {
		require.Equal(t, "fresh", first.Quality.Concurrency)
		require.NotNil(t, first.Concurrency.Current)
	}
	var nextQuery usertelemetry.Query
	require.NoError(t, json.Unmarshal(query, &nextQuery))
	nextQuery.Cursor = *snapshot.NextCursor
	query, err = json.Marshal(nextQuery)
	require.NoError(t, err)
	raw, err = svc.ReadUserTelemetry(ctx, query)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(raw, &snapshot))
	require.Len(t, snapshot.Users, 1, "soft-deleted user must not appear on the next page")
	require.Equal(t, "9007199254740996", snapshot.Users[0].UserID)
	require.Equal(t, "0", *snapshot.Users[0].TokenUsage.Total)
	require.Empty(t, snapshot.Users[0].APIKeys)
	require.Nil(t, snapshot.NextCursor)

	// Real SQL failures must remain unknown, not fabricated zeros. Only this
	// session's table is dropped; the acceptance/public usage table is untouched.
	_, err = db.ExecContext(ctx, `DROP TABLE pg_temp.usage_logs`)
	require.NoError(t, err)
	nextQuery.Cursor = ""
	query, err = json.Marshal(nextQuery)
	require.NoError(t, err)
	raw, err = svc.ReadUserTelemetry(ctx, query)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(raw, &snapshot))
	for _, user := range snapshot.Users {
		require.Nil(t, user.TokenUsage.Total)
		require.Nil(t, user.ObservedAt.TokenUsage)
		require.Equal(t, "unavailable", user.Quality.TokenUsage)
		require.Equal(t, "fresh", user.Quality.Identity)
		require.Equal(t, "fresh", user.Quality.APIKeys)
	}

	// A complete key list is mandatory even against a real database.
	_, err = db.ExecContext(ctx, `INSERT INTO pg_temp.api_keys (id,user_id,name,status,key) SELECT n,9007199254740993,'overflow-fixture','active','NEVER_EXPORT_THIS_SECRET' FROM generate_series(1,10001) AS n`)
	require.NoError(t, err)
	raw, err = svc.ReadUserTelemetry(ctx, query)
	require.ErrorIs(t, err, service.ErrUserTelemetryAPIKeyLimit)
	require.Nil(t, raw)

	_, err = db.ExecContext(ctx, `DROP TABLE pg_temp.users`)
	require.NoError(t, err)
	raw, err = svc.ReadUserTelemetry(ctx, query)
	require.ErrorContains(t, err, "identity read failed")
	require.Nil(t, raw)
}
