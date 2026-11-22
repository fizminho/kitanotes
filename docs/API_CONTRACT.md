# KitaNotes API contract (initial)

All routes are same-origin under the Cloudflare Worker. JSON responses are marked `Cache-Control: no-store`. Protected routes derive the user identity from the opaque server-side session cookie. A caller cannot choose its own user ID.

## Authentication

- `GET /auth/google`: start Google OIDC login (state, nonce and PKCE).
- `GET /auth/google/callback`: validate Google identity, upsert user, create personal workspace and issue session cookie.
- `GET /api/auth/status`: return whether D1 and Google OAuth configuration are present; exposes no secret values.
- `GET /api/auth/me`: return `{ authenticated: true, user }` or HTTP 401.
- `POST /api/auth/logout`: revoke current session. Requires a same-origin `Origin` header.

## Notes

- `GET /api/notes?q=&workspaceId=&limit=50&archived=0`: list active notes visible to the current user. Set `archived=1` to list archived notes. Omitting workspace ID lists notes across all workspaces where the user is a member. Search matches title and content.
- `POST /api/notes`: create a note. Body: `{ title, content, workspaceId?, categoryId? }`. Omitting workspace ID selects the user's personal workspace.
- `GET /api/notes/:id`: retrieve a note only if the user is a member of its workspace.
- `PATCH /api/notes/:id`: update title/content/category or archive state. Body includes the current integer `version`; a stale version returns HTTP 409.
- `DELETE /api/notes/:id`: soft-delete a note. The row is retained with `deleted_at`.

## Categories

- `GET /api/categories?workspaceId=`: list active categories in accessible workspaces.
- `POST /api/categories`: create category. Body: `{ name, color?, sortOrder?, workspaceId? }`.
- `PATCH /api/categories/:id`: update name, hex color or sort order.
- `DELETE /api/categories/:id`: archive the category. Notes retain their category reference.

## Authorization and validation

- Reads require active workspace membership.
- Mutations require owner or editor role; viewers are read-only.
- Mutations require a same-origin `Origin` header to mitigate CSRF.
- Note title is limited to 200 characters; content to 50,000 characters; JSON request bodies to 64 KiB.
- Category name is limited to 50 characters; colors must be six-digit hex.
- Category assignment must point to a category in the same workspace.
- Note updates use optimistic concurrency through `version`.
- Invitations, shared workspace creation, collaboration notifications and full API integration tests are not implemented yet.
