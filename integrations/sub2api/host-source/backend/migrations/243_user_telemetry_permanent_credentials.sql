-- Allow explicitly permanent user-telemetry credentials on installations that
-- already applied migration 242 before permanent expiry support was added.
ALTER TABLE IF EXISTS sub2api_user_telemetry_credentials
    ALTER COLUMN expires_at DROP NOT NULL;
