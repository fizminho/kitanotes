from pathlib import Path
import sqlite3

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for migration_path in sorted(Path("migrations").glob("*.sql")):
    db.executescript(migration_path.read_text(encoding="utf-8"))

tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
required = {"users", "workspaces", "workspace_members", "invitations", "categories", "notes", "activity_events", "sessions", "calendar_events", "reminders", "notifications"}
missing = required - tables
if missing:
    raise SystemExit(f"Missing expected tables: {sorted(missing)}")

db.execute("INSERT INTO users (id, google_sub, email, email_normalized, email_verified, created_at, updated_at) VALUES ('u1','sub1','a@example.com','a@example.com',1,'now','now')")
db.execute("INSERT INTO users (id, google_sub, email, email_normalized, email_verified, created_at, updated_at) VALUES ('u2','sub2','b@example.com','b@example.com',1,'now','now')")
db.execute("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES ('w1','One','u1','personal','now','now')")
db.execute("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES ('w2','Two','u2','personal','now','now')")
db.execute("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w1','u1','owner','now')")
db.execute("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('w2','u2','owner','now')")
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

try:
    db.execute("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES ('w1b','Duplicate personal','u1','personal','now','now')")
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Duplicate personal workspace was not rejected")

db.execute("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES ('s1','u1','hash-1','2099-01-01T00:00:00.000Z','now')")
try:
    db.execute("INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES ('s2','u2','hash-1','2099-01-01T00:00:00.000Z','now')")
except sqlite3.IntegrityError:
    pass
else:
    raise SystemExit("Duplicate session token hash was not rejected")

print("D1 migrations valid; foreign keys, workspace/category guard, membership isolation, personal workspace uniqueness and session token uniqueness verified.")
