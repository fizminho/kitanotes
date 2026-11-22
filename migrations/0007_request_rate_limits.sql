CREATE TABLE IF NOT EXISTS request_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_request_rate_limits_expiry ON request_rate_limits(expires_at);
