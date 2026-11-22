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

- `POST /api/invitations`: owner-only. Body: `{ workspaceId, openLink: true, role: "editor" | "viewer" }` creates a reusable seven-day bearer link that any signed-in user with a verified Google email can use; an optional `email` retains legacy email-restricted invitations. The API does not send email.
- `GET /api/invitations?workspaceId=`: owner-only list without token hashes or raw tokens.
- `POST /api/invitations/accept`: signed-in user accepts with `{ token }`; legacy email-restricted invitations require a verified email match. Open links are reusable by multiple Google-authenticated users until expiry/revocation.
- `DELETE /api/invitations/:id`: owner revokes a pending invitation.
- `GET /api/workspaces`, `POST /api/workspaces` (creates a **shared** space, max 30 owned), `PATCH /api/workspaces/:id` (`{name}` rename; `{action:"make_private"}` removes all other members and revokes pending invitations; `{action:"make_shared"}` re-enables new invitations without restoring former members; `{action:"transfer_ownership",userId}`), `DELETE /api/workspaces/:id` (owner deletes a shared-visibility workspace and everything in it; private workspaces cannot be deleted through this route).
- `GET /api/workspaces/:id/members`: any member. `PATCH|DELETE /api/workspaces/:id/members/:userId`: owner changes role / removes; a non-owner may `DELETE` their own membership to leave.
- `GET /api/workspaces/:id/activity`: any member; last 50 sharing events (invitations, joins, leaves, removals, role changes, ownership transfers).
- Collaboration notifications: invitation accepted and member left (to owner); role changed, removed, ownership received (to the affected member).

Every workspace has `type:"shared"`; `visibility` is the access boundary (`private` or `shared`). A private workspace remains `type:"shared"` and is returned with `visibility:"private"`. Owners can make it shared again; this does not automatically restore removed members. Making a workspace private revokes pending invitations and removes other memberships while retaining notes and categories. Invitation tokens are cryptographically random and stored only as SHA-256 hashes. Legacy email-specific invitations are single-use; open workspace links are reusable for seven days and can be revoked by the owner. Each join is logged and owner-removal remains available. An SQLite trigger creates membership in the same database transaction as the accepted status update.

## Calendar events

- `GET /api/events?from=&to=&workspaceId=&limit=100`: list events overlapping the requested range in workspaces the user belongs to. Default range is 30 days back through 90 days ahead.
- `POST /api/events`: create event. The response includes creator and latest-editor identity/timestamps. Body: `{ title, description?, startsAt, endsAt, timezone, allDay?, linkedNoteId?, workspaceId? }`.
- `GET /api/events/:id`: retrieve an event with workspace membership.
- `PATCH /api/events/:id`: update event with optimistic `version`; records the last editor and an activity entry.
- `DELETE /api/events/:id`: soft-delete event, records the deleting editor and an activity entry, and cancels pending linked reminders.

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

## Gemini OCR

- `POST /api/ai/ocr/consent`: body `{ accepted: true }`; records separate, revocable image-processing consent.
- `DELETE /api/ai/ocr/consent`: revoke OCR consent.
- `POST /api/ai/ocr`: raw JPEG, PNG or WebP bytes with the matching `Content-Type`; requires authentication, same-origin request and current OCR consent. Maximum image size is 2 MiB. Returns editable extracted text only; it does not create notes or events.

OCR uses the configured free-tier Gemini model allowlist, a 5-request per-user UTC-day quota and a separate 3-request-per-user-per-minute burst limit. Images and extracted text are not persisted by the OCR handler. No user-supplied URL is fetched and no paid fallback is allowed. The frontend requires explicit consent, lets users edit extracted text and hands it to the existing organiser; the organiser still requires its own separate consent and explicit save confirmation. A rendered image preview and client-side EXIF stripping are not yet implemented.

## AI organiser

- `GET /api/ai/status`: return key configuration status, consent status and local daily usage. Never returns the key.
- `POST /api/ai/consent`: body `{ accepted: true }`; stores explicit consent and policy version.
- `DELETE /api/ai/consent`: revoke consent.
- `POST /api/ai/organize`: body `{ text, timezone, workspaceId? }`; returns a validated note/category/event/reminder/task draft. Requires consent and an owner/editor workspace role.

The AI endpoint does not persist prompts or drafts. It stores only consent metadata and a per-user UTC daily request count. It enforces a 16 KiB input limit and 10 requests per user per UTC day. All model candidates are filtered through the free-tier allowlist; paid fallback is disabled. See [AI privacy policy](AI_PRIVACY.md).

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
- Workspace invitations and verified-email acceptance are implemented. New shared-note notifications are created by a D1 trigger. Integration tests use a SQLite-backed D1 adapter. Production Google login, note persistence and two-account collaboration have been exercised, but the latest workspace visibility migrations and code still require a current-release production smoke test.
