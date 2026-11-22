# ADR-0003: D1 workspace-scoped data model

- **Status:** Accepted for MVP foundation
- **Date:** 2026-11-22

Every note is stored in a workspace, including personal notes. Workspace membership is the authorization boundary. Google subject ID is the stable identity key; verified, normalised email is used only for invitation matching.

D1 uses SQLite with foreign keys, prepared statements and indexed workspace-scoped queries. Invitations store only a hash of a cryptographically random one-time token and are accepted atomically with membership creation.

The first migration establishes users, workspaces, members, invitations, categories, notes and activity events. Calendar, reminders, push subscriptions and AI generation audit tables will be introduced with their respective feature phases.

The migration is committed but must not be applied until a dedicated KitaNotes D1 database has been created.
