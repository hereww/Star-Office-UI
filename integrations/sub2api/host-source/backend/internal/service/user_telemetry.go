package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"time"

	"github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	"github.com/lib/pq"
)

const userTelemetryMaxAPIKeys = 10000

// Explicit column allowlists keep credentials and billing fields out of the
// reader, not merely out of its JSON. All parameters are bound, including IDs.
const userTelemetryUsersSQL = `SELECT id, email, username, concurrency, status
FROM users
WHERE deleted_at IS NULL AND id = ANY($1::bigint[]) AND id > $2
ORDER BY id ASC LIMIT $3`

const userTelemetryAPIKeysSQL = `SELECT id, user_id, name, status
FROM api_keys
WHERE deleted_at IS NULL AND user_id = ANY($1::bigint[])
ORDER BY user_id ASC, id ASC LIMIT $2`

// Cast EACH operand before adding: both a single row and the aggregate may
// exceed bigint. Deliberately do not join api_keys: deleted/rotated keys still
// contribute recorded usage. The 5m/1h cache-creation counters are subitems.
const userTelemetryTokensSQL = `SELECT user_id,
SUM((input_tokens::numeric) + (output_tokens::numeric) + (cache_creation_tokens::numeric) + (cache_read_tokens::numeric))::text
FROM usage_logs
WHERE user_id = ANY($1::bigint[]) AND created_at >= $2 AND created_at < $3
GROUP BY user_id`

var ErrUserTelemetryAPIKeyLimit = errors.New("user telemetry API key resource limit exceeded (maximum 10000 keys per page; request a smaller user page)")

// UserTelemetryService performs uncached, request-scoped reads. It must only be
// called after the administrator's user scope has been enforced by the caller.
// Normalize is repeated here so private RPC cannot bypass input validation.
type UserTelemetryService struct {
	db          *sql.DB
	concurrency *ConcurrencyService
	now         func() time.Time
}

func NewUserTelemetryService(db *sql.DB, concurrency *ConcurrencyService) *UserTelemetryService {
	return &UserTelemetryService{db: db, concurrency: concurrency, now: time.Now}
}

func (s *UserTelemetryService) ReadUserTelemetry(ctx context.Context, query json.RawMessage) (json.RawMessage, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("user telemetry database unavailable")
	}
	q, err := usertelemetry.DecodeQuery(query)
	if err != nil {
		return nil, err
	}
	q, start, end, err := q.Normalize(s.now())
	if err != nil {
		return nil, err
	}
	ids := make([]int64, 0, len(q.UserIDs))
	for _, value := range q.UserIDs {
		id, err := usertelemetry.ParseID(value)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	var cursor int64
	if q.Cursor != "" {
		cursor, err = usertelemetry.ParseID(q.Cursor)
		if err != nil {
			return nil, err
		}
	}
	users, nextCursor, err := s.readTelemetryUsers(ctx, ids, cursor, q.PageSize)
	if err != nil {
		return nil, fmt.Errorf("user telemetry identity read failed: %w", err)
	}
	snapshot := usertelemetry.Snapshot{
		SchemaVersion: usertelemetry.APIVersion,
		Window:        usertelemetry.Window{Start: q.Start, End: q.End, Timezone: q.Timezone},
		Users:         users, NextCursor: nextCursor,
	}
	if len(users) == 0 {
		return json.Marshal(snapshot)
	}
	pageIDs := make([]int64, len(users))
	for i := range users {
		pageIDs[i], err = usertelemetry.ParseID(users[i].UserID)
		if err != nil {
			return nil, err
		}
	}
	keys, err := s.readTelemetryAPIKeys(ctx, pageIDs)
	if err != nil {
		// The contract's APIKeys slice cannot distinguish an incomplete list
		// from a complete empty list. Fail explicitly; never silently truncate.
		return nil, fmt.Errorf("user telemetry API key read failed: %w", err)
	}
	keysObserved := s.telemetrySampleTime()
	for i, id := range pageIDs {
		if list := keys[id]; list != nil {
			users[i].APIKeys = list
		}
		users[i].Quality.APIKeys = "fresh"
		users[i].ObservedAt.APIKeys = &keysObserved
	}

	tokens, tokensErr := s.readTelemetryTokens(ctx, pageIDs, start, end)
	if tokensErr == nil {
		tokensObserved := s.telemetrySampleTime()
		for i, id := range pageIDs {
			total, found := tokens[id]
			if !found {
				// Only a successful complete GROUP BY read proves no usage.
				total = "0"
			}
			users[i].TokenUsage.Total = &total
			users[i].Quality.TokenUsage = "fresh"
			users[i].ObservedAt.TokenUsage = &tokensObserved
		}
	}
	s.readTelemetryConcurrency(ctx, users, pageIDs)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return json.Marshal(snapshot)
}

func (s *UserTelemetryService) telemetrySampleTime() string {
	return s.now().UTC().Format(time.RFC3339Nano)
}

func (s *UserTelemetryService) readTelemetryUsers(ctx context.Context, ids []int64, cursor int64, pageSize int) ([]usertelemetry.User, *string, error) {
	rows, err := s.db.QueryContext(ctx, userTelemetryUsersSQL, pq.Array(ids), cursor, pageSize+1)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	users := make([]usertelemetry.User, 0, pageSize)
	allowed := make(map[int64]bool, len(ids))
	for _, id := range ids {
		allowed[id] = true
	}
	previous := cursor
	var hasMore bool
	for rows.Next() {
		var id int64
		var email, username, status string
		var limit int
		if err := rows.Scan(&id, &email, &username, &limit, &status); err != nil {
			return nil, nil, err
		}
		if !allowed[id] || id <= previous {
			return nil, nil, errors.New("invalid user telemetry identity result")
		}
		previous = id
		if len(users) == pageSize {
			hasMore = true
			continue
		}
		users = append(users, usertelemetry.User{
			UserID: strconv.FormatInt(id, 10), Email: email, Username: username,
			APIKeys:     []usertelemetry.APIKey{},
			Concurrency: usertelemetry.Concurrency{Limit: limit},
			Quality:     usertelemetry.Quality{Identity: "fresh", APIKeys: "unavailable", TokenUsage: "unavailable", Concurrency: "unavailable"},
		})
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	observed := s.telemetrySampleTime()
	for i := range users {
		users[i].ObservedAt.Identity = observed
	}
	if hasMore {
		next := users[len(users)-1].UserID
		return users, &next, nil
	}
	return users, nil, nil
}

func (s *UserTelemetryService) readTelemetryAPIKeys(ctx context.Context, ids []int64) (map[int64][]usertelemetry.APIKey, error) {
	rows, err := s.db.QueryContext(ctx, userTelemetryAPIKeysSQL, pq.Array(ids), userTelemetryMaxAPIKeys+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := make(map[int64][]usertelemetry.APIKey, len(ids))
	allowed := make(map[int64]bool, len(ids))
	for _, id := range ids {
		allowed[id] = true
	}
	count := 0
	for rows.Next() {
		count++
		if count > userTelemetryMaxAPIKeys {
			return nil, ErrUserTelemetryAPIKeyLimit
		}
		var keyID, userID int64
		var name, status string
		if err := rows.Scan(&keyID, &userID, &name, &status); err != nil {
			return nil, err
		}
		if keyID <= 0 || !allowed[userID] {
			return nil, errors.New("invalid user telemetry API key result")
		}
		keys[userID] = append(keys[userID], usertelemetry.APIKey{ID: strconv.FormatInt(keyID, 10), Name: name, Status: status})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return keys, nil
}

func (s *UserTelemetryService) readTelemetryTokens(ctx context.Context, ids []int64, start, end time.Time) (map[int64]string, error) {
	rows, err := s.db.QueryContext(ctx, userTelemetryTokensSQL, pq.Array(ids), start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tokens := make(map[int64]string, len(ids))
	allowed := make(map[int64]bool, len(ids))
	for _, id := range ids {
		allowed[id] = true
	}
	for rows.Next() {
		var id int64
		var total string
		if err := rows.Scan(&id, &total); err != nil {
			return nil, err
		}
		if _, duplicate := tokens[id]; duplicate || !allowed[id] || !telemetryDecimalInteger(total) {
			return nil, errors.New("invalid user telemetry token aggregate")
		}
		tokens[id] = total
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return tokens, nil
}

// PostgreSQL SUM(numeric)::text stays a decimal integer without any conversion
// through float64 or int64; reject corrupt/negative counters instead of a zero.
func telemetryDecimalInteger(value string) bool {
	if value == "" {
		return false
	}
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return false
		}
	}
	return true
}

func (s *UserTelemetryService) readTelemetryConcurrency(ctx context.Context, users []usertelemetry.User, ids []int64) {
	tracked := make([]UserWithConcurrency, 0, len(users))
	for i, id := range ids {
		if users[i].Concurrency.Limit <= 0 {
			users[i].Quality.Concurrency = "untracked"
			continue
		}
		tracked = append(tracked, UserWithConcurrency{ID: id, MaxConcurrency: users[i].Concurrency.Limit})
	}
	if len(tracked) == 0 || s.concurrency == nil || telemetryNilCache(s.concurrency.cache) {
		return
	}
	load, err := s.concurrency.GetUsersLoadBatch(ctx, tracked)
	if err != nil {
		return
	}
	observed := s.telemetrySampleTime()
	for i, id := range ids {
		if users[i].Concurrency.Limit <= 0 {
			continue
		}
		entry, found := load[id]
		if !found || entry == nil || entry.UserID != id || entry.CurrentConcurrency < 0 {
			continue
		}
		current := entry.CurrentConcurrency
		users[i].Concurrency.Current = &current
		users[i].Quality.Concurrency = "fresh"
		users[i].ObservedAt.Concurrency = &observed
	}
}

func telemetryNilCache(cache ConcurrencyCache) bool {
	if cache == nil {
		return true
	}
	// A typed nil pointer in an interface is also an uninitialized cache.
	value := reflect.ValueOf(cache)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return value.IsNil()
	default:
		return false
	}
}
