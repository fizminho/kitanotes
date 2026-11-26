-- Preserve the existing lock-screen privacy behaviour for accounts that already
-- have notification preferences. Users without a row use the API's detailed default.
ALTER TABLE notification_preferences
  ADD COLUMN push_preview_mode TEXT NOT NULL DEFAULT 'generic'
  CHECK (push_preview_mode IN ('detailed','generic'));

-- Atomic 120-second note-edit debounce, scoped to note + actor + recipient.
CREATE TABLE IF NOT EXISTS push_debounce (
  debounce_key TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_push_debounce_expires_at ON push_debounce(expires_at);
