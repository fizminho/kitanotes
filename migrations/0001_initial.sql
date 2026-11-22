PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_normalized ON users(email_normalized);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  workspace_type TEXT NOT NULL DEFAULT 'personal' CHECK (workspace_type IN ('personal', 'shared')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_workspaces_owner ON workspaces(owner_user_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_workspace_members_user ON workspace_members(user_id, workspace_id);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_email_normalized TEXT NOT NULL,
  invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at TEXT NOT NULL,
  accepted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_invitations_email_status ON invitations(invited_email_normalized, status);
CREATE INDEX IF NOT EXISTS ix_invitations_workspace_status ON invitations(workspace_id, status);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name)
);
CREATE INDEX IF NOT EXISTS ix_categories_workspace_sort ON categories(workspace_id, archived_at, sort_order);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  category_id TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  archived_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_notes_workspace_updated ON notes(workspace_id, deleted_at, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_notes_category ON notes(workspace_id, category_id, updated_at DESC);\n\nCREATE TRIGGER IF NOT EXISTS trg_notes_category_workspace_insert\nBEFORE INSERT ON notes\nWHEN NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.workspace_id = NEW.workspace_id)\nBEGIN\n  SELECT RAISE(ABORT, 'note category must belong to the same workspace');\nEND;\n\nCREATE TRIGGER IF NOT EXISTS trg_notes_category_workspace_update\nBEFORE UPDATE OF workspace_id, category_id ON notes\nWHEN NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.workspace_id = NEW.workspace_id)\nBEGIN\n  SELECT RAISE(ABORT, 'note category must belong to the same workspace');\nEND;

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_activity_workspace_created ON activity_events(workspace_id, created_at DESC);
