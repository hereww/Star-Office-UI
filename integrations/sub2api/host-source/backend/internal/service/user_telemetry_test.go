package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	"github.com/stretchr/testify/require"
)

var telemetryTestNow = time.Date(2026, 10, 4, 8, 30, 0, 0, time.UTC)

const telemetryTestQuery = `{"user_ids":["1"],"start":"2026-10-04T00:00:00+08:00","end":"2026-10-04T16:00:00+08:00"}`

type telemetryConcurrencyStub struct {
	ConcurrencyCache
	load  map[int64]*UserLoadInfo
	err   error
	calls int
	users []UserWithConcurrency
}

func (c *telemetryConcurrencyStub) GetUsersLoadBatch(_ context.Context, users []UserWithConcurrency) (map[int64]*UserLoadInfo, error) {
	c.calls++
	c.users = append([]UserWithConcurrency(nil), users...)
	return c.load, c.err
}

func newTelemetryTestService(t *testing.T, concurrency *ConcurrencyService) (*UserTelemetryService, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	require.NoError(t, err)
	t.Cleanup(func() {
		mock.ExpectClose()
		require.NoError(t, db.Close())
		require.NoError(t, mock.ExpectationsWereMet())
	})
	svc := NewUserTelemetryService(db, concurrency)
	svc.now = func() time.Time { return telemetryTestNow }
	return svc, mock
}

func telemetryUsersRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "email", "username", "concurrency", "status"})
}

func telemetryKeysRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "user_id", "name", "status"})
}

func telemetryTokensRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"user_id", "total"})
}

func expectTelemetryOneUser(mock sqlmock.Sqlmock, limit int, status string) {
	mock.ExpectQuery(userTelemetryUsersSQL).WithArgs("{1}", int64(0), 101).
		WillReturnRows(telemetryUsersRows().AddRow(int64(1), "a@example.test", "", limit, status))
}

func expectTelemetryEmptyKeys(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(userTelemetryAPIKeysSQL).WithArgs("{1}", 10001).WillReturnRows(telemetryKeysRows())
}

func expectTelemetryNoUsage(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(userTelemetryTokensSQL).WithArgs("{1}", sqlmock.AnyArg(), sqlmock.AnyArg()).WillReturnRows(telemetryTokensRows())
}

func readTelemetrySnapshot(t *testing.T, svc *UserTelemetryService, query string) (usertelemetry.Snapshot, json.RawMessage) {
	t.Helper()
	raw, err := svc.ReadUserTelemetry(context.Background(), json.RawMessage(query))
	require.NoError(t, err)
	var snapshot usertelemetry.Snapshot
	require.NoError(t, json.Unmarshal(raw, &snapshot))
	return snapshot, raw
}

func TestUserTelemetryBatchLargeIDsMultiKeyAndSecretAllowlist(t *testing.T) {
	const first int64 = 9007199254740993
	const second int64 = 9223372036854775807
	cache := &telemetryConcurrencyStub{load: map[int64]*UserLoadInfo{
		first: {UserID: first, CurrentConcurrency: 2}, second: {UserID: second, CurrentConcurrency: 0},
	}}
	svc, mock := newTelemetryTestService(t, NewConcurrencyService(cache))
	query := fmt.Sprintf(`{"user_ids":["%d","%d"],"page_size":2}`, second, first)
	mock.ExpectQuery(userTelemetryUsersSQL).WithArgs("{9223372036854775807,9007199254740993}", int64(0), 3).
		WillReturnRows(telemetryUsersRows().AddRow(first, "first@example.test", "", 5, "disabled").AddRow(second, "second@example.test", "second", 7, "active"))
	mock.ExpectQuery(userTelemetryAPIKeysSQL).WithArgs("{9007199254740993,9223372036854775807}", 10001).
		WillReturnRows(telemetryKeysRows().AddRow(first, first, "rotated-1", "disabled").AddRow(first+1, first, "rotated-2", "active").AddRow(second, second, "separate", "active"))
	loc, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)
	start := time.Date(2026, 10, 4, 0, 0, 0, 0, loc)
	mock.ExpectQuery(userTelemetryTokensSQL).WithArgs("{9007199254740993,9223372036854775807}", start, telemetryTestNow.In(loc)).
		WillReturnRows(telemetryTokensRows().AddRow(first, "184467440737095516160000").AddRow(second, "41"))
	snapshot, raw := readTelemetrySnapshot(t, svc, query)
	require.Equal(t, 1, snapshot.SchemaVersion)
	require.Nil(t, snapshot.NextCursor)
	require.Len(t, snapshot.Users, 2)
	require.Equal(t, strconv.FormatInt(first, 10), snapshot.Users[0].UserID)
	require.Empty(t, snapshot.Users[0].Username)
	require.NotNil(t, snapshot.Users[0].TokenUsage.Total)
	require.NotNil(t, snapshot.Users[1].TokenUsage.Total)
	require.Equal(t, "184467440737095516160000", *snapshot.Users[0].TokenUsage.Total)
	require.Equal(t, "41", *snapshot.Users[1].TokenUsage.Total)
	require.Len(t, snapshot.Users[0].APIKeys, 2)
	require.Len(t, snapshot.Users[1].APIKeys, 1)
	require.Equal(t, strconv.FormatInt(second, 10), snapshot.Users[1].APIKeys[0].ID)
	require.Equal(t, 2, *snapshot.Users[0].Concurrency.Current, "disabled users can still occupy slots")
	require.Zero(t, *snapshot.Users[1].Concurrency.Current)
	require.Equal(t, 1, cache.calls)
	require.Equal(t, []UserWithConcurrency{{ID: first, MaxConcurrency: 5}, {ID: second, MaxConcurrency: 7}}, cache.users)
	for _, user := range snapshot.Users {
		require.Equal(t, usertelemetry.Quality{Identity: "fresh", APIKeys: "fresh", TokenUsage: "fresh", Concurrency: "fresh"}, user.Quality)
		require.NotNil(t, user.ObservedAt.APIKeys)
		require.NotNil(t, user.ObservedAt.TokenUsage)
		require.NotNil(t, user.ObservedAt.Concurrency)
	}
	// Check exact JSON keys, rather than searching names that may legitimately
	// contain words such as "key". No source domain object is serialized.
	var wire map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(raw, &wire))
	require.Len(t, wire, 4)
	var users []map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(wire["users"], &users))
	for _, user := range users {
		require.Len(t, user, 8)
		var keys []map[string]json.RawMessage
		require.NoError(t, json.Unmarshal(user["api_keys"], &keys))
		for _, key := range keys {
			require.Len(t, key, 3)
			require.Contains(t, key, "id")
			require.Contains(t, key, "name")
			require.Contains(t, key, "status")
			require.NotContains(t, key, "key")
		}
	}
}

func TestUserTelemetrySQLTokenDefinitionAndReadOnlyAllowlists(t *testing.T) {
	require.Equal(t, "SELECT id, email, username, concurrency, status", strings.Split(userTelemetryUsersSQL, "\n")[0])
	require.Equal(t, "SELECT id, user_id, name, status", strings.Split(userTelemetryAPIKeysSQL, "\n")[0])
	require.Contains(t, userTelemetryUsersSQL, "deleted_at IS NULL")
	require.Contains(t, userTelemetryAPIKeysSQL, "deleted_at IS NULL")
	require.Contains(t, userTelemetryTokensSQL, "SUM((input_tokens::numeric) + (output_tokens::numeric) + (cache_creation_tokens::numeric) + (cache_read_tokens::numeric))::text")
	require.Contains(t, userTelemetryTokensSQL, "created_at >= $2 AND created_at < $3")
	for _, forbidden := range []string{"JOIN", "api_keys", "deleted_at", "cache_creation_5m", "cache_creation_1h", "cost"} {
		require.NotContains(t, userTelemetryTokensSQL, forbidden)
	}
	for _, query := range []string{userTelemetryUsersSQL, userTelemetryAPIKeysSQL, userTelemetryTokensSQL} {
		require.True(t, strings.HasPrefix(query, "SELECT "))
		for _, forbidden := range []string{"password", "secret", "UPDATE ", "INSERT ", "DELETE "} {
			require.NotContains(t, query, forbidden)
		}
	}
}

func TestUserTelemetrySuccessfulNoUsageIsRealZero(t *testing.T) {
	svc, mock := newTelemetryTestService(t, nil)
	expectTelemetryOneUser(mock, 5, "active")
	expectTelemetryEmptyKeys(mock)
	expectTelemetryNoUsage(mock)
	snapshot, raw := readTelemetrySnapshot(t, svc, telemetryTestQuery)
	user := snapshot.Users[0]
	require.Equal(t, "0", *user.TokenUsage.Total)
	require.Equal(t, "fresh", user.Quality.TokenUsage)
	require.NotNil(t, user.ObservedAt.TokenUsage)
	require.Empty(t, user.APIKeys)
	require.NotNil(t, user.APIKeys)
	require.Contains(t, string(raw), `"api_keys":[]`)
	require.Contains(t, string(raw), `"current":null`)
}

func TestUserTelemetryQueryValidationBeforeSQL(t *testing.T) {
	queries := []string{
		``, `null`, `{}`, `[]`, `{"user_ids":[]}`, `{"user_ids":["1"],"key":"secret"}`,
		`{"user_ids":["1"]} {}`, `{"user_ids":["1"]} trailing`,
		`{"user_ids":[1]}`, `{"user_ids":["0"]}`, `{"user_ids":["-1"]}`, `{"user_ids":["01"]}`,
		`{"user_ids":["+1"]}`, `{"user_ids":[" 1"]}`, `{"user_ids":["1 "]}`, `{"user_ids":["9223372036854775808"]}`,
		`{"user_ids":["1","1"]}`, `{"user_ids":["1"],"cursor":"00"}`,
		`{"user_ids":["1"],"cursor":"9223372036854775808"}`,
		`{"user_ids":["1"],"page_size":-1}`, `{"user_ids":["1"],"page_size":501}`,
		`{"user_ids":["1"],"timezone":"invalid/location"}`,
		`{"user_ids":["1"],"start":"2026-10-04T00:00:00Z"}`,
		`{"user_ids":["1"],"end":"2026-10-04T00:00:00Z"}`,
		`{"user_ids":["1"],"start":"bad","end":"2026-10-04T08:00:00Z"}`,
		`{"user_ids":["1"],"start":"2026-10-04T07:00:00Z","end":"bad"}`,
		`{"user_ids":["1"],"start":"2026-10-04T08:00:00Z","end":"2026-10-04T08:00:00Z"}`,
		`{"user_ids":["1"],"start":"2026-10-04T08:00:00Z","end":"2026-10-03T08:00:00Z"}`,
		`{"user_ids":["1"],"start":"2026-09-03T08:00:00Z","end":"2026-10-04T08:00:01Z"}`,
		`{"user_ids":["1"],"start":"2026-10-04T08:00:00Z","end":"2026-10-04T09:00:00Z"}`,
	}
	ids := make([]string, 501)
	for i := range ids {
		ids[i] = strconv.Itoa(i + 1)
	}
	tooMany, err := json.Marshal(usertelemetry.Query{UserIDs: ids})
	require.NoError(t, err)
	queries = append(queries, string(tooMany))
	for _, query := range queries {
		t.Run(query, func(t *testing.T) {
			svc, _ := newTelemetryTestService(t, nil)
			raw, err := svc.ReadUserTelemetry(context.Background(), json.RawMessage(query))
			require.Error(t, err)
			require.Nil(t, raw)
		})
	}
}

func TestUserTelemetryKeysetPaginationBatchesOnlyVisiblePage(t *testing.T) {
	svc, mock := newTelemetryTestService(t, nil)
	mock.ExpectQuery(userTelemetryUsersSQL).WithArgs("{1,2,3}", int64(0), 3).
		WillReturnRows(telemetryUsersRows().AddRow(1, "a", "", 0, "active").AddRow(2, "b", "b", 5, "active").AddRow(3, "c", "c", 5, "active"))
	mock.ExpectQuery(userTelemetryAPIKeysSQL).WithArgs("{1,2}", 10001).WillReturnRows(telemetryKeysRows())
	mock.ExpectQuery(userTelemetryTokensSQL).WithArgs("{1,2}", sqlmock.AnyArg(), sqlmock.AnyArg()).WillReturnRows(telemetryTokensRows())
	snapshot, _ := readTelemetrySnapshot(t, svc, `{"user_ids":["1","2","3"],"page_size":2}`)
	require.Equal(t, "2", *snapshot.NextCursor)
	require.Len(t, snapshot.Users, 2)
	mock.ExpectQuery(userTelemetryUsersSQL).WithArgs("{1,2,3}", int64(2), 3).
		WillReturnRows(telemetryUsersRows().AddRow(3, "c", "renamed", 5, "active"))
	mock.ExpectQuery(userTelemetryAPIKeysSQL).WithArgs("{3}", 10001).WillReturnRows(telemetryKeysRows())
	mock.ExpectQuery(userTelemetryTokensSQL).WithArgs("{3}", sqlmock.AnyArg(), sqlmock.AnyArg()).WillReturnRows(telemetryTokensRows())
	snapshot, _ = readTelemetrySnapshot(t, svc, `{"user_ids":["1","2","3"],"cursor":"2","page_size":2}`)
	require.Nil(t, snapshot.NextCursor)
	require.Equal(t, "3", snapshot.Users[0].UserID)
	require.Equal(t, "renamed", snapshot.Users[0].Username)
}

func TestUserTelemetryWindowBoundariesAndEmptyPage(t *testing.T) {
	for _, test := range []struct {
		name, query, start, end, timezone string
		cursor                            int64
		limit                             int
	}{
		{"Shanghai default", `{"user_ids":["1"]}`, "2026-10-04T00:00:00+08:00", "2026-10-04T16:30:00+08:00", "Asia/Shanghai", 0, 101},
		{"31 days and 500 page", `{"user_ids":["1"],"page_size":500,"start":"2026-09-03T08:30:00Z","end":"2026-10-04T08:30:00Z","timezone":"UTC"}`, "2026-09-03T08:30:00Z", "2026-10-04T08:30:00Z", "UTC", 0, 501},
		{"large cursor", `{"user_ids":["1"],"cursor":"9007199254740993"}`, "2026-10-04T00:00:00+08:00", "2026-10-04T16:30:00+08:00", "Asia/Shanghai", 9007199254740993, 101},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, mock := newTelemetryTestService(t, nil)
			mock.ExpectQuery(userTelemetryUsersSQL).WithArgs("{1}", test.cursor, test.limit).WillReturnRows(telemetryUsersRows())
			snapshot, raw := readTelemetrySnapshot(t, svc, test.query)
			require.Equal(t, usertelemetry.Window{Start: test.start, End: test.end, Timezone: test.timezone}, snapshot.Window)
			require.Empty(t, snapshot.Users)
			require.Nil(t, snapshot.NextCursor)
			require.Contains(t, string(raw), `"users":[]`)
		})
	}
}

func TestUserTelemetryIdentityErrorsFailQuery(t *testing.T) {
	for _, kind := range []string{"query", "scan", "iteration", "wrong user", "duplicate"} {
		t.Run(kind, func(t *testing.T) {
			svc, mock := newTelemetryTestService(t, nil)
			expectation := mock.ExpectQuery(userTelemetryUsersSQL)
			switch kind {
			case "query":
				expectation.WillReturnError(errors.New("database unavailable"))
			case "scan":
				expectation.WillReturnRows(telemetryUsersRows().AddRow(1, "a", nil, 5, "active"))
			case "iteration":
				expectation.WillReturnRows(telemetryUsersRows().AddRow(1, "a", "", 5, "active").RowError(0, errors.New("read interrupted")))
			case "wrong user":
				expectation.WillReturnRows(telemetryUsersRows().AddRow(2, "b", "", 5, "active"))
			case "duplicate":
				expectation.WillReturnRows(telemetryUsersRows().AddRow(1, "a", "", 5, "active").AddRow(1, "a", "", 5, "active"))
			}
			raw, err := svc.ReadUserTelemetry(context.Background(), json.RawMessage(telemetryTestQuery))
			require.ErrorContains(t, err, "identity read failed")
			require.Nil(t, raw)
		})
	}
	raw, err := NewUserTelemetryService(nil, nil).ReadUserTelemetry(context.Background(), json.RawMessage(telemetryTestQuery))
	require.ErrorContains(t, err, "database unavailable")
	require.Nil(t, raw)
}

func TestUserTelemetryAPIKeyFailuresNeverReturnEmptyOrTruncatedList(t *testing.T) {
	for _, kind := range []string{"query", "iteration", "scan", "wrong user", "overflow"} {
		t.Run(kind, func(t *testing.T) {
			svc, mock := newTelemetryTestService(t, nil)
			expectTelemetryOneUser(mock, 5, "active")
			expectation := mock.ExpectQuery(userTelemetryAPIKeysSQL).WithArgs("{1}", 10001)
			switch kind {
			case "query":
				expectation.WillReturnError(errors.New("key metadata unavailable"))
			case "iteration":
				expectation.WillReturnRows(telemetryKeysRows().AddRow(1, 1, "k", "active").RowError(0, errors.New("read interrupted")))
			case "scan":
				expectation.WillReturnRows(telemetryKeysRows().AddRow(1, 1, nil, "active"))
			case "wrong user":
				expectation.WillReturnRows(telemetryKeysRows().AddRow(1, 2, "k", "active"))
			case "overflow":
				rows := telemetryKeysRows()
				for i := 1; i <= userTelemetryMaxAPIKeys+1; i++ {
					rows.AddRow(i, 1, "k", "active")
				}
				expectation.WillReturnRows(rows)
			}
			raw, err := svc.ReadUserTelemetry(context.Background(), json.RawMessage(telemetryTestQuery))
			require.ErrorContains(t, err, "API key read failed")
			require.Nil(t, raw)
			if kind == "overflow" {
				require.ErrorIs(t, err, ErrUserTelemetryAPIKeyLimit)
			}
		})
	}
}

func TestUserTelemetryAPIKeyLimitInclusive(t *testing.T) {
	svc, mock := newTelemetryTestService(t, nil)
	expectTelemetryOneUser(mock, 5, "active")
	rows := telemetryKeysRows()
	for i := 1; i <= userTelemetryMaxAPIKeys; i++ {
		rows.AddRow(i, 1, "key metadata only", "active")
	}
	mock.ExpectQuery(userTelemetryAPIKeysSQL).WithArgs("{1}", 10001).WillReturnRows(rows)
	expectTelemetryNoUsage(mock)
	snapshot, _ := readTelemetrySnapshot(t, svc, telemetryTestQuery)
	require.Len(t, snapshot.Users[0].APIKeys, 10000)
	require.Equal(t, "fresh", snapshot.Users[0].Quality.APIKeys)
}

func TestUserTelemetryTokenFailuresRemainNullWithoutSample(t *testing.T) {
	for _, kind := range []string{"query", "iteration", "null", "negative", "invalid decimal", "wrong user", "duplicate"} {
		t.Run(kind, func(t *testing.T) {
			svc, mock := newTelemetryTestService(t, nil)
			expectTelemetryOneUser(mock, 5, "active")
			expectTelemetryEmptyKeys(mock)
			expectation := mock.ExpectQuery(userTelemetryTokensSQL)
			switch kind {
			case "query":
				expectation.WillReturnError(errors.New("usage table unavailable"))
			case "iteration":
				expectation.WillReturnRows(telemetryTokensRows().AddRow(1, "42").AddRow(2, "99").RowError(1, errors.New("incomplete result")))
			case "null":
				expectation.WillReturnRows(telemetryTokensRows().AddRow(1, nil))
			case "negative":
				expectation.WillReturnRows(telemetryTokensRows().AddRow(1, "-1"))
			case "invalid decimal":
				expectation.WillReturnRows(telemetryTokensRows().AddRow(1, "NaN"))
			case "wrong user":
				expectation.WillReturnRows(telemetryTokensRows().AddRow(2, "42"))
			case "duplicate":
				expectation.WillReturnRows(telemetryTokensRows().AddRow(1, "42").AddRow(1, "99"))
			}
			snapshot, raw := readTelemetrySnapshot(t, svc, telemetryTestQuery)
			user := snapshot.Users[0]
			require.Nil(t, user.TokenUsage.Total)
			require.Equal(t, "unavailable", user.Quality.TokenUsage)
			require.Nil(t, user.ObservedAt.TokenUsage)
			require.Equal(t, "fresh", user.Quality.Identity)
			require.Equal(t, "fresh", user.Quality.APIKeys)
			require.Contains(t, string(raw), `"total":null`)
		})
	}
}

func TestUserTelemetryConcurrencyQuality(t *testing.T) {
	var typedNil *telemetryConcurrencyStub
	for _, test := range []struct {
		name        string
		concurrency *ConcurrencyService
		cache       *telemetryConcurrencyStub
		limit       int
		quality     string
		current     *int
	}{
		{name: "nil service", limit: 5, quality: "unavailable"},
		{name: "nil cache", concurrency: NewConcurrencyService(nil), limit: 5, quality: "unavailable"},
		{name: "typed nil cache", concurrency: NewConcurrencyService(typedNil), limit: 5, quality: "unavailable"},
		{name: "Redis failure", cache: &telemetryConcurrencyStub{err: errors.New("Redis failed")}, limit: 5, quality: "unavailable"},
		{name: "nil result", cache: &telemetryConcurrencyStub{}, limit: 5, quality: "unavailable"},
		{name: "missing user", cache: &telemetryConcurrencyStub{load: map[int64]*UserLoadInfo{2: {UserID: 2}}}, limit: 5, quality: "unavailable"},
		{name: "nil entry", cache: &telemetryConcurrencyStub{load: map[int64]*UserLoadInfo{1: nil}}, limit: 5, quality: "unavailable"},
		{name: "mismatched user", cache: &telemetryConcurrencyStub{load: map[int64]*UserLoadInfo{1: {UserID: 2, CurrentConcurrency: 3}}}, limit: 5, quality: "unavailable"},
		{name: "negative count", cache: &telemetryConcurrencyStub{load: map[int64]*UserLoadInfo{1: {UserID: 1, CurrentConcurrency: -1}}}, limit: 5, quality: "unavailable"},
		{name: "confirmed Redis zero", cache: &telemetryConcurrencyStub{load: map[int64]*UserLoadInfo{1: {UserID: 1}}}, limit: 5, quality: "fresh", current: telemetryIntPtr(0)},
		{name: "disabled but running", cache: &telemetryConcurrencyStub{load: map[int64]*UserLoadInfo{1: {UserID: 1, CurrentConcurrency: 3}}}, limit: 5, quality: "fresh", current: telemetryIntPtr(3)},
		{name: "zero limit", cache: &telemetryConcurrencyStub{load: map[int64]*UserLoadInfo{1: {UserID: 1}}}, limit: 0, quality: "untracked"},
		{name: "negative limit", cache: &telemetryConcurrencyStub{load: map[int64]*UserLoadInfo{1: {UserID: 1}}}, limit: -1, quality: "untracked"},
	} {
		t.Run(test.name, func(t *testing.T) {
			concurrency := test.concurrency
			if test.cache != nil {
				concurrency = NewConcurrencyService(test.cache)
			}
			svc, mock := newTelemetryTestService(t, concurrency)
			expectTelemetryOneUser(mock, test.limit, "disabled")
			expectTelemetryEmptyKeys(mock)
			expectTelemetryNoUsage(mock)
			snapshot, _ := readTelemetrySnapshot(t, svc, telemetryTestQuery)
			user := snapshot.Users[0]
			require.Equal(t, test.current, user.Concurrency.Current)
			require.Equal(t, test.limit, user.Concurrency.Limit)
			require.Equal(t, test.quality, user.Quality.Concurrency)
			if test.quality == "fresh" {
				require.NotNil(t, user.ObservedAt.Concurrency)
			} else {
				require.Nil(t, user.ObservedAt.Concurrency)
			}
			if test.cache != nil {
				if test.limit <= 0 {
					require.Zero(t, test.cache.calls)
				} else {
					require.Equal(t, 1, test.cache.calls)
				}
			}
		})
	}
}

func telemetryIntPtr(n int) *int { return &n }

func TestUserTelemetryConcurrencyPartialBatchDoesNotInventMissingZero(t *testing.T) {
	cache := &telemetryConcurrencyStub{load: map[int64]*UserLoadInfo{1: {UserID: 1, CurrentConcurrency: 2}}}
	svc, mock := newTelemetryTestService(t, NewConcurrencyService(cache))
	mock.ExpectQuery(userTelemetryUsersSQL).WillReturnRows(telemetryUsersRows().AddRow(1, "a", "a", 5, "active").AddRow(2, "b", "b", 5, "active").AddRow(3, "c", "c", 0, "active"))
	mock.ExpectQuery(userTelemetryAPIKeysSQL).WithArgs("{1,2,3}", 10001).WillReturnRows(telemetryKeysRows())
	mock.ExpectQuery(userTelemetryTokensSQL).WithArgs("{1,2,3}", sqlmock.AnyArg(), sqlmock.AnyArg()).WillReturnRows(telemetryTokensRows())
	snapshot, _ := readTelemetrySnapshot(t, svc, `{"user_ids":["1","2","3"]}`)
	require.Equal(t, "fresh", snapshot.Users[0].Quality.Concurrency)
	require.Equal(t, "unavailable", snapshot.Users[1].Quality.Concurrency)
	require.Nil(t, snapshot.Users[1].Concurrency.Current)
	require.Nil(t, snapshot.Users[1].ObservedAt.Concurrency)
	require.Equal(t, "untracked", snapshot.Users[2].Quality.Concurrency)
	require.Equal(t, []UserWithConcurrency{{ID: 1, MaxConcurrency: 5}, {ID: 2, MaxConcurrency: 5}}, cache.users)
}

// Keep the database/sql import explicit to prove this constructor accepts the
// host's existing *sql.DB, not an ORM client or new credential-bearing reader.
var _ func(*sql.DB, *ConcurrencyService) *UserTelemetryService = NewUserTelemetryService

func TestUserTelemetryMaxUserIDsAccepted(t *testing.T) {
	svc, mock := newTelemetryTestService(t, nil)
	ids := make([]string, usertelemetry.MaxPageSize)
	for i := range ids {
		ids[i] = strconv.Itoa(i + 1)
	}
	query, err := json.Marshal(usertelemetry.Query{UserIDs: ids, PageSize: 500})
	require.NoError(t, err)
	mock.ExpectQuery(userTelemetryUsersSQL).WithArgs("{"+strings.Join(ids, ",")+"}", int64(0), 501).WillReturnRows(telemetryUsersRows())
	snapshot, _ := readTelemetrySnapshot(t, svc, string(query))
	require.Empty(t, snapshot.Users)
}

func TestUserTelemetryObservedAtPerSuccessfulField(t *testing.T) {
	cache := &telemetryConcurrencyStub{load: map[int64]*UserLoadInfo{1: {UserID: 1, CurrentConcurrency: 0}}}
	svc, mock := newTelemetryTestService(t, NewConcurrencyService(cache))
	calls := 0
	svc.now = func() time.Time {
		instant := telemetryTestNow.Add(time.Duration(calls) * time.Second)
		calls++
		return instant
	}
	expectTelemetryOneUser(mock, 5, "active")
	expectTelemetryEmptyKeys(mock)
	expectTelemetryNoUsage(mock)
	snapshot, _ := readTelemetrySnapshot(t, svc, telemetryTestQuery)
	observed := snapshot.Users[0].ObservedAt
	require.Equal(t, telemetryTestNow.Add(time.Second).Format(time.RFC3339Nano), observed.Identity)
	require.Equal(t, telemetryTestNow.Add(2*time.Second).Format(time.RFC3339Nano), *observed.APIKeys)
	require.Equal(t, telemetryTestNow.Add(3*time.Second).Format(time.RFC3339Nano), *observed.TokenUsage)
	require.Equal(t, telemetryTestNow.Add(4*time.Second).Format(time.RFC3339Nano), *observed.Concurrency)
}

func TestUserTelemetryFailedTokenBatchInvalidatesWholePage(t *testing.T) {
	cache := &telemetryConcurrencyStub{err: errors.New("Redis unavailable")}
	svc, mock := newTelemetryTestService(t, NewConcurrencyService(cache))
	mock.ExpectQuery(userTelemetryUsersSQL).WithArgs("{1,2}", int64(0), 101).
		WillReturnRows(telemetryUsersRows().AddRow(1, "a", "", 5, "active").AddRow(2, "b", "", 5, "active"))
	mock.ExpectQuery(userTelemetryAPIKeysSQL).WithArgs("{1,2}", 10001).WillReturnRows(telemetryKeysRows())
	mock.ExpectQuery(userTelemetryTokensSQL).WithArgs("{1,2}", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(telemetryTokensRows().AddRow(1, "123").AddRow(2, "456").RowError(1, errors.New("incomplete aggregate")))
	snapshot, _ := readTelemetrySnapshot(t, svc, `{"user_ids":["1","2"]}`)
	for _, user := range snapshot.Users {
		require.Nil(t, user.TokenUsage.Total)
		require.Nil(t, user.ObservedAt.TokenUsage)
		require.Equal(t, "unavailable", user.Quality.TokenUsage)
		require.Nil(t, user.Concurrency.Current)
		require.Nil(t, user.ObservedAt.Concurrency)
		require.Equal(t, "unavailable", user.Quality.Concurrency)
		require.Equal(t, "fresh", user.Quality.Identity)
		require.Equal(t, "fresh", user.Quality.APIKeys)
	}
	require.Equal(t, 1, cache.calls)
}

func TestUserTelemetryCancelledContextFailsClosed(t *testing.T) {
	svc, _ := newTelemetryTestService(t, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	raw, err := svc.ReadUserTelemetry(ctx, json.RawMessage(telemetryTestQuery))
	require.ErrorIs(t, err, context.Canceled)
	require.Nil(t, raw)
}
