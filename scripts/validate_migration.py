from pathlib import Path
import sqlite3

migration = Path("migrations/0001_initial.sql").read_text(encoding="utf-8")
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(migration)

tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
required = {"users", "workspaces", "workspace_members", "invitations", "categories", "notes", "activity_events"}
missing = required - tables
if missing:
    raise SystemExit(f"Missing expected tables: {sorted(missing)}")

db.execute("INSERT INTO users (id, google_sub, email, email_normalized, email_verified, created_at, updated_at) VALUES ('u1','sub1','a@example.com','a@example.com',1,'now','now')")
db.execute("INSERT INTO users (id, google_sub, email, email_normalized, email_verified, created_at, updated_at) VALUES ('u2','sub2','b@example.com','b@example.com',1,'now','now')")
db.execute("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES ('w1','One','u1','personal','now','now')")
db.execute("INSERT INTO workspaces (id,name,owner_user_id,workspace_type,created_at,updated_at) VALUES ('w2','Two','u2','personal','now','now')")
db.execute("INSERT INTO categories (id,workspace_id,name,created_by_user_id,created_at,updated_at) VALUES ('c2','w2','Private','u2','now','now')")

try:
    db.execute("INSERT INTO notes (id,workspace_id,title,category_id,created_by_user_id,created_at,updated_at) VALUES ('n1','w1','Cross-workspace category','c2','u1','now','now')")
except sqlite3.IntegrityError as exc:
    if "same workspace" not in str(exc):
        raise
else:
    raise SystemExit("Cross-workspace category assignment was not rejected")

db.execute("INSERT INTO notes (id,workspace_id,title,created_by_user_id,created_at,updated_at) VALUES ('n2','w1','Valid note','u1','now','now')")
print("D1 migration SQL valid; required tables, foreign keys and workspace-category guard verified.")
