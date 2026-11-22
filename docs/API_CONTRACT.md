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

## Invitations

- `POST /api/invitations`: owner-only. Body: `{ workspaceId, email, role: "editor" | "viewer" }`. Returns a one-time invitation URL and a prefilled Gmail compose URL. The API does not send email.
- `GET /api/invitations?workspaceId=`: owner-only list without token hashes or raw tokens.
- `POST /api/invitations/accept`: signed-in user accepts with `{ token }`; verified Google email must match the invitation address.
- `DELETE /api/invitations/:id`: owner revokes a pending invitation.

Invitation tokens are cryptographically random, stored only as SHA-256 hashes, expire after seven days and are single-use. An SQLite trigger creates membership in the same database transaction as the accepted status update.

## Calendar events

- `GET /api/events?from=&to=&workspaceId=&limit=100`: list events overlapping the requested range in workspaces the user belongs to. Default range is 30 days back through 90 days ahead.
- `POST /api/events`: create event. Body: `{ title, description?, startsAt, endsAt, timezone, allDay?, linkedNoteId?, workspaceId? }`.
- `GET /api/events/:id`: retrieve an event with workspace membership.
- `PATCH /api/events/:id`: update event with optimistic `version`.
- `DELETE /api/events/:id`: soft-delete event and cancel pending linked reminders.

Timestamps must include an explicit UTC offset or `Z`; the API stores UTC instants and retains the IANA timezone for display. End must be after start. A linked note must belong to the same workspace.

## Reminders

- `GET /api/reminders?workspaceId=&limit=50`: list reminders in accessible workspaces.
- `POST /api/reminders`: create a reminder. Body: `{ title, dueAt, timezone, workspaceId?, eventId?, noteId? }`.
- `DELETE /api/reminders/:id`: cancel a pending reminder.

## Notifications

- `GET /api/notifications?limit=50&unreadOnly=1`: return the signed-in user's in-app inbox and unread count.
- `POST /api/notifications/:id/read`: mark one notification read.
- `POST /api/notifications/read-all`: mark all of the current user's notifications read.

A free Cloudflare Cron Trigger runs every five minutes. Due reminders create idempotent in-app notifications for workspace members. Deleted linked notes/events cancel pending reminders. This MVP does not send email or browser push notifications.

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
