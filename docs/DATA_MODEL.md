# KitaNotes data model

The initial D1 migration is `migrations/0001_initial.sql`. It creates the identity, workspace, membership, invitation, category, note and activity foundations.

## Key decisions

- Google `sub` is the immutable identity key. Email is normalised for invitation matching and must be verified before invitation acceptance.
- Every note belongs to a workspace, including personal notes. This makes authorization consistent.
- Workspace membership is the access-control boundary. Every note/category query must join or validate membership before returning data.
- Roles are `owner`, `editor` and `viewer`. Invitations can grant only editor or viewer.
- Invitation tokens are represented only by a unique hash in D1. Raw tokens must be shown once in the acceptance URL and never stored.
- Timestamps are ISO-8601 UTC strings. User timezone belongs in user preferences and event records, not as an implicit database timezone.
- Note updates use an integer `version` for optimistic concurrency.
- Notes use soft-delete and archive timestamps. A deleted note is not returned by ordinary list/search APIs.

## Authorization invariants

1. Resolve the authenticated user from a server-validated session, never from request-supplied user IDs.
2. Before reading or changing workspace content, verify active membership in that workspace.
3. Viewer may read only. Editor may create/update notes and categories subject to workspace policy. Owner controls membership, invitations and workspace deletion.
4. Verify category and note workspace IDs match in the same query/transaction.
5. Accept an invitation only when the signed-in Google identity has a verified email matching the invitation email.
6. Consume invitation token and create membership atomically; token use is single-use.
7. Do not expose note titles or content from invitation lookup endpoints before authentication and membership acceptance.

## Migration operation

The migration is committed but has not been applied. Apply it only after creating a separate KitaNotes D1 database and configuring the database ID in Wrangler. Never point KitaNotes migrations at the Investlah database.

## Workspace type and visibility

All workspaces use `workspace_type = 'shared'`. The `visibility` column controls access: `private` means only the owner has membership; `shared` means the owner may invite members. Converting to private removes other memberships and revokes pending invitations without changing workspace type or deleting notes/categories. Making it shared again allows new invitations but does not restore removed members.
