ALTER TABLE workspaces ADD COLUMN color TEXT NOT NULL DEFAULT '#7565d8' CHECK (length(color)=7 AND substr(color,1,1)='#');
ALTER TABLE workspaces ADD COLUMN icon TEXT NOT NULL DEFAULT '📁';
