package repository

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/Wei-Shaw/sub2api/pkg/usertelemetry"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

// Exercise the actual cache implementation, not a stub or private Redis keys.
// A missing sorted set must produce an explicit confirmed-zero entry on a
// successful batch, while a Redis failure must produce an error, never a zero.
func TestUserTelemetryCacheBatchConfirmedZeroAndLiveOccupancy(t *testing.T) {
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	cache := NewConcurrencyCache(client, 15, 900)
	concurrency := service.NewConcurrencyService(cache)
	ctx := context.Background()
	const userID int64 = 9007199254740993
	users := []service.UserWithConcurrency{{ID: userID, MaxConcurrency: 5}, {ID: userID + 1, MaxConcurrency: 5}}
	load, err := concurrency.GetUsersLoadBatch(ctx, users)
	require.NoError(t, err)
	require.Len(t, load, 2)
	for _, user := range users {
		require.NotNil(t, load[user.ID])
		require.Equal(t, user.ID, load[user.ID].UserID)
		require.Zero(t, load[user.ID].CurrentConcurrency)
	}
	acquired, err := cache.AcquireUserSlot(ctx, userID, 5, "telemetry-test-regular-slot")
	require.NoError(t, err)
	require.True(t, acquired)
	live, ok := cache.(service.LiveConcurrencyCache)
	require.True(t, ok)
	acquired, err = live.AcquireLiveLease(ctx, 41, 5, userID, 5, 42, "telemetry-test-live-slot", false)
	require.NoError(t, err)
	require.True(t, acquired)
	load, err = concurrency.GetUsersLoadBatch(ctx, users)
	require.NoError(t, err)
	require.Equal(t, 2, load[userID].CurrentConcurrency)
	require.Zero(t, load[userID+1].CurrentConcurrency)
	require.NoError(t, cache.ReleaseUserSlot(ctx, userID, "telemetry-test-regular-slot"))
	require.NoError(t, live.ReleaseLiveLease(ctx, 41, userID, 42, "telemetry-test-live-slot"))
	load, err = concurrency.GetUsersLoadBatch(ctx, users)
	require.NoError(t, err)
	require.Zero(t, load[userID].CurrentConcurrency)
}

func TestUserTelemetryReaderActualRedisSuccessAndFailure(t *testing.T) {
	for _, failed := range []bool{false, true} {
		name := "confirmed_zero"
		if failed {
			name = "redis_failure"
		}
		t.Run(name, func(t *testing.T) {
			server := miniredis.RunT(t)
			client := redis.NewClient(&redis.Options{Addr: server.Addr()})
			t.Cleanup(func() { _ = client.Close() })
			cache := NewConcurrencyCache(client, 15, 900)
			if failed {
				require.NoError(t, client.Close())
				load, err := cache.GetUsersLoadBatch(context.Background(), []service.UserWithConcurrency{{ID: 1, MaxConcurrency: 5}})
				require.Error(t, err)
				require.Nil(t, load)
			}
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			t.Cleanup(func() {
				mock.ExpectClose()
				require.NoError(t, db.Close())
				require.NoError(t, mock.ExpectationsWereMet())
			})
			mock.ExpectQuery(`^SELECT id, email, username, concurrency, status`).WithArgs("{1}", int64(0), 101).
				WillReturnRows(sqlmock.NewRows([]string{"id", "email", "username", "concurrency", "status"}).AddRow(1, "a@example.test", "", 5, "disabled"))
			mock.ExpectQuery(`^SELECT id, user_id, name, status`).WithArgs("{1}", 10001).
				WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "name", "status"}))
			mock.ExpectQuery(`^SELECT user_id,`).WithArgs("{1}", sqlmock.AnyArg(), sqlmock.AnyArg()).
				WillReturnRows(sqlmock.NewRows([]string{"user_id", "total"}))
			svc := service.NewUserTelemetryService(db, service.NewConcurrencyService(cache))
			raw, err := svc.ReadUserTelemetry(context.Background(), json.RawMessage(`{"user_ids":["1"],"start":"2020-01-01T00:00:00Z","end":"2020-01-02T00:00:00Z"}`))
			require.NoError(t, err)
			var snapshot usertelemetry.Snapshot
			require.NoError(t, json.Unmarshal(raw, &snapshot))
			user := snapshot.Users[0]
			if failed {
				require.Nil(t, user.Concurrency.Current)
				require.Nil(t, user.ObservedAt.Concurrency)
				require.Equal(t, "unavailable", user.Quality.Concurrency)
			} else {
				require.NotNil(t, user.Concurrency.Current)
				require.Zero(t, *user.Concurrency.Current)
				require.NotNil(t, user.ObservedAt.Concurrency)
				require.Equal(t, "fresh", user.Quality.Concurrency)
			}
		})
	}
}
