-- Only scoped read-only telemetry credentials; model/API secrets are never stored here.
CREATE TABLE IF NOT EXISTS sub2api_user_telemetry_credentials (
 id BIGSERIAL PRIMARY KEY,
 plugin_id BIGINT NOT NULL REFERENCES sub2api_plugin_installations(id) ON DELETE CASCADE,
 name VARCHAR(100) NOT NULL,
 user_ids JSONB NOT NULL,
 token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 revoked_at TIMESTAMPTZ,
 CHECK (jsonb_typeof(user_ids)='array' AND jsonb_array_length(user_ids) BETWEEN 1 AND 500)
);
CREATE INDEX IF NOT EXISTS idx_user_telemetry_credentials_plugin ON sub2api_user_telemetry_credentials(plugin_id);
