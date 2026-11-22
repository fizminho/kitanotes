ALTER TABLE workspaces
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared'
  CHECK (visibility IN ('private', 'shared'));

-- The existing personal workspace remains private. Shared spaces start shared.
UPDATE workspaces SET visibility = 'private' WHERE workspace_type = 'personal';
