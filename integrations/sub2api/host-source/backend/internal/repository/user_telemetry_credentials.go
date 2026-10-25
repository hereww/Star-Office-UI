package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

type userTelemetryCredentialStore struct{ db *sql.DB }

func NewUserTelemetryCredentialStore(db *sql.DB) service.UserTelemetryCredentialStore {
	return &userTelemetryCredentialStore{db}
}
func (s *userTelemetryCredentialStore) Create(ctx context.Context, c *service.UserTelemetryCredential) error {
	raw, err := json.Marshal(c.UserIDs)
	if err != nil {
		return err
	}
	return s.db.QueryRowContext(ctx, `INSERT INTO sub2api_user_telemetry_credentials(plugin_id,name,user_ids,token_hash,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at`, c.PluginID, c.Name, raw, c.TokenHash, c.ExpiresAt).Scan(&c.ID, &c.CreatedAt)
}
func (s *userTelemetryCredentialStore) Authenticate(ctx context.Context, pluginID int64, hash []byte) (*service.UserTelemetryCredential, error) {
	c, err := scanTelemetryCredential(s.db.QueryRowContext(ctx, telemetryCredentialSelect+` WHERE plugin_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())`, pluginID, hash))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, service.ErrTelemetryUnauthorized
	}
	return c, err
}
func (s *userTelemetryCredentialStore) List(ctx context.Context, id, cursor int64, pageSize int) (*service.UserTelemetryCredentialPage, error) {
	if cursor < 0 || pageSize < 1 || pageSize > 500 {
		return nil, fmt.Errorf("invalid credential page")
	}
	rows, err := s.db.QueryContext(ctx, telemetryCredentialSelect+` WHERE plugin_id=$1 AND ($2::bigint=0 OR id<$2) ORDER BY id DESC LIMIT $3`, id, cursor, pageSize+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &service.UserTelemetryCredentialPage{Credentials: make([]service.UserTelemetryCredential, 0, pageSize)}
	for rows.Next() {
		c, e := scanTelemetryCredential(rows)
		if e != nil {
			return nil, e
		}
		if len(out.Credentials) == pageSize {
			next := strconv.FormatInt(out.Credentials[len(out.Credentials)-1].ID, 10)
			out.NextCursor = &next
			break
		}
		out.Credentials = append(out.Credentials, *c)
	}
	return out, rows.Err()
}
func (s *userTelemetryCredentialStore) Revoke(ctx context.Context, pluginID, id int64) error {
	r, err := s.db.ExecContext(ctx, `UPDATE sub2api_user_telemetry_credentials SET revoked_at=COALESCE(revoked_at,NOW()) WHERE plugin_id=$1 AND id=$2`, pluginID, id)
	if err != nil {
		return err
	}
	n, err := r.RowsAffected()
	if err == nil && n != 1 {
		return service.ErrTelemetryCredentialNotFound
	}
	return err
}

const telemetryCredentialSelect = `SELECT id,plugin_id,name,user_ids,token_hash,expires_at,created_at,revoked_at FROM sub2api_user_telemetry_credentials`

func scanTelemetryCredential(s interface{ Scan(...any) error }) (*service.UserTelemetryCredential, error) {
	c := new(service.UserTelemetryCredential)
	var raw []byte
	if err := s.Scan(&c.ID, &c.PluginID, &c.Name, &raw, &c.TokenHash, &c.ExpiresAt, &c.CreatedAt, &c.RevokedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &c.UserIDs); err != nil {
		return nil, err
	}
	return c, nil
}
