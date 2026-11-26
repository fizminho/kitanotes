-- Index deleted notes for bounded 30-day retention cleanup.
CREATE INDEX IF NOT EXISTS ix_notes_deleted_at ON notes(deleted_at) WHERE deleted_at IS NOT NULL;
