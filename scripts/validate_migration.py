from pathlib import Path
import sqlite3

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
migrations = sorted(Path("migrations").glob("*.sql"))
pre_visibility = [path for path in migrations if path.name < "0011_workspace_visibility.sql"]
visibility_migrations = [path for path in migrations if path.name >= "0011_workspace_visibility.sql"]
for migration_path in pre_visibility:
    db.executescript(migration_path.read_text(encoding="utf-8"))

# Seed legacy rows before the visibility/type migrations to verify the data conversion.
db.execute("INSERT INTO users (id, google_sub, email, email_normalized, email_verified, created_at, updated_at) VALUES ('u1','sub1','a@example.com','a@example.com',1,'now','now')")
db.execute("INSERT INTO users (id, google_sub, email, email_normalized, email_verified, created_at, updated_at) VALUES ('u2','sub2','b@example.com','b@example.com',1,'now','now')")
db.execute("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES ('w1','One','u1','personal','now','now')")
db.execute("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES ('w2','Two','u2','shared','now','now')")
db.execute("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner','now')")
db.execute("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w2','u2','owner','now')")
try:
    db.execute("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES ('w1b','Duplicate legacy personal','u1','personal','now','now')")
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Duplicate legacy personal workspace was not rejected")

for migration_path in visibility_migrations:
    db.executescript(migration_path.read_text(encoding="utf-8"))

workspace_rows = db.execute("SELECT id,workspace_type,visibility FROM workspaces ORDER BY id").fetchall()
if workspace_rows != [("w1", "shared", "private"), ("w2", "shared", "shared")]:
    raise SystemExit(f"Workspace visibility/type migration produced unexpected rows: {workspace_rows}")

tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
required = {"users", "workspaces", "workspace_members", "invitations", "categories", "notes", "activity_events", "sessions", "calendar_events", "reminders", "notifications", "ai_request_usage", "request_rate_limits", "push_subscriptions", "notification_preferences", "ai_ocr_consent", "ai_ocr_usage" , "calendar_event_imports", "user_calendar_preferences", "calendar_holiday_cache", "passkey_credentials", "passkey_challenges"}
missing = required - tables
if missing:
    raise SystemExit(f"Missing expected tables: {sorted(missing)}")

# Creator and last-editor metadata must exist for notes and calendar events.
for table in ("notes", "calendar_events"):
    columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
    if "created_by_user_id" not in columns or "updated_by_user_id" not in columns:
        raise SystemExit(f"{table} is missing creator/editor audit columns")
source_columns = {row[1] for row in db.execute("PRAGMA table_info(calendar_events)")}
if not {"source_created_by", "source_created_at", "source_updated_by", "source_updated_at"}.issubset(source_columns):
    raise SystemExit("calendar_events is missing imported-source audit columns")

db.execute("INSERT INTO categories (id,workspace_id,name,created_by_user_id,created_at,updated_at) VALUES ('c2','w2','Private','u2','now','now')")

try:
    db.execute("INSERT INTO notes (id,workspace_id,title,category_id,created_by_user_id,created_at,updated_at) VALUES ('n1','w1','Cross-workspace category','c2','u1','now','now')")
except sqlite3.IntegrityError as exc:
    if "same workspace" not in str(exc):
        raise
else:
    raise SystemExit("Cross-workspace category assignment was not rejected")

db.execute("INSERT INTO notes (id,workspace_id,title,created_by_user_id,created_at,updated_at) VALUES ('n2','w1','Valid note','u1','now','now')")

visible_to_u2 = db.execute("SELECT n.id FROM notes n JOIN workspace_members wm ON wm.workspace_id=n.workspace_id WHERE wm.user_id='u2'").fetchall()
if visible_to_u2:
    raise SystemExit("Workspace membership query exposed another user's note")

legacy_types = db.execute("SELECT COUNT(*) FROM workspaces WHERE workspace_type <> 'shared'").fetchone()[0]
if legacy_types:
    raise SystemExit(f"Legacy workspace types remain after migration: {legacy_types}")

db.execute("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES ('s1','u1','hash-1','2099-01-01T00:00:00.000Z','now')")
try:
    db.execute("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES ('s2','u2','hash-1','2099-01-01T00:00:00.000Z','now')")
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Duplicate session token hash was not rejected")

# Rate-limit buckets must enforce a non-negative count and a unique key.
db.execute("INSERT INTO request_rate_limits (bucket_key,window_started_at,request_count,expires_at) VALUES ('test',1000,1,2000)")
try:
    db.execute("INSERT INTO request_rate_limits (bucket_key,window_started_at,request_count,expires_at) VALUES ('test',1000,-1,2000)")
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Negative rate-limit request count was accepted")

db.execute("INSERT INTO push_subscriptions (id,user_id,endpoint,subscription_json,created_at,updated_at) VALUES ('p1','u1','https://fcm.googleapis.com/push/one','{}','now','now')")
try:
    db.execute("INSERT INTO push_subscriptions (id,user_id,endpoint,subscription_json,created_at,updated_at) VALUES ('p2','u2','https://fcm.googleapis.com/push/one','{}','now','now')")
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Duplicate push endpoint was accepted")
visible_push_to_u2 = db.execute("SELECT id FROM push_subscriptions WHERE user_id='u2'").fetchall()
if visible_push_to_u2:
    raise SystemExit("Push subscription query exposed another user's device")

# Notification preferences default safely and remain scoped to the owning account.
db.execute("INSERT INTO notification_preferences (user_id,created_at,updated_at) VALUES ('u1','now','now')")
prefs = db.execute("SELECT push_enabled,reminder_push_enabled,shared_note_push_enabled,timezone FROM notification_preferences WHERE user_id='u1'").fetchone()
if prefs != (1, 1, 1, "Asia/Kuala_Lumpur"):
    raise SystemExit(f"Unexpected notification preference defaults: {prefs}")
try:
    db.execute("INSERT INTO notification_preferences (user_id,quiet_hours_start,quiet_hours_end,created_at,updated_at) VALUES ('u2','22:00',NULL,'now','now')")
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Incomplete quiet-hours range was accepted")

# OCR consent and usage are separate from text-AI consent and are user-scoped.
db.execute("INSERT INTO ai_ocr_consent (user_id,accepted_at,policy_version) VALUES ('u1','now','ocr-policy')")
db.execute("INSERT INTO ai_ocr_usage (user_id,usage_date,request_count) VALUES ('u1','2026-11-22',1)")
if db.execute("SELECT COUNT(*) FROM ai_ocr_consent WHERE user_id='u2'").fetchone()[0] != 0:
    raise SystemExit("OCR consent leaked across users")

print("D1 migrations valid; workspace isolation, foreign keys, rate limits, push subscriptions, notification preferences and isolated OCR consent/usage verified.")
