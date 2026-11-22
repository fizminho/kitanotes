CREATE TABLE IF NOT EXISTS calendar_holiday_cache (
  state TEXT NOT NULL,
  holiday_year INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('public', 'school')),
  events_json TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (state, holiday_year, source)
);

CREATE INDEX IF NOT EXISTS idx_calendar_holiday_cache_synced
  ON calendar_holiday_cache (synced_at);
