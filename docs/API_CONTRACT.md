# KitaNotes API contract (initial)

All routes are same-origin under the Cloudflare Worker. JSON responses are marked `Cache-Control: no-store`. Protected routes derive the user identity from the opaque server-side session cookie. A caller cannot choose its own user ID.

## Authentication

- `GET /auth/google`: start Google OIDC login (state, nonce and PKCE).
- `GET /auth/google/link`: while signed in, explicitly link a verified Google identity to the current passkey account; no email-only auto-linking.
- `GET /auth/google/callback`: validate Google identity, upsert user, create personal workspace and issue session cookie.
- `GET /api/auth/status`: return whether D1 and Google OAuth configuration are present; exposes no secret values.
- `GET /api/auth/me`: return `{ authenticated: true, user }` or HTTP 401.
- `POST /api/auth/logout`: revoke current session. Requires a same-origin `Origin` header.
- `POST /api/auth/passkeys/signup/options` and `POST /api/auth/passkeys/signup/verify`: create a new account with a discoverable passkey, create its personal workspace and session, and return one-time recovery codes.
- `POST /api/auth/passkeys/recovery/verify`: consume one recovery code and issue a normal session.
- `POST /api/auth/passkeys/recovery/regenerate`: replace all existing recovery codes for the authenticated user and return a new one-time set.
- `POST /api/auth/passkeys/register/options` and `POST /api/auth/passkeys/register/verify`: register a discoverable passkey for the currently authenticated user.
- `POST /api/auth/passkeys/authenticate/options` and `POST /api/auth/passkeys/authenticate/verify`: authenticate a discoverable passkey and issue the same session cookie as Google login.
- `GET /api/auth/passkeys`: list current-user passkeys. `DELETE /api/auth/passkeys/:credentialId`: revoke a current-user passkey.

Recovery codes are generated as ten random 128-bit values, stored only as SHA-256 hashes, and can each be used once. Regenerating codes invalidates every previous code. Passkey signup email is initially unverified; link Google from the authenticated account to verify it and enable email-verified invitation acceptance.

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

## Calendar 2.0

- `POST /api/calendar/ics/import`: body `{ workspaceId, ics }`; imports supported VEVENTs into a workspace. Requires owner/editor access and same-origin request. Stable iCalendar UIDs are tracked per workspace so repeated imports update matching events rather than creating duplicates. Recurring rules are not expanded.
- `GET /api/calendar/ics/export?workspaceId=`: downloads the workspace's active events as an RFC 5545 `.ics` file. Any workspace member may export; event details follow workspace access.
- `GET /api/calendar/preferences`: returns the user's selected Malaysia holiday state (defaults to Selangor).
- `PUT /api/calendar/preferences`: body `{ holidayState }`; saves the user's selected state.
- `GET /api/calendar/holidays?state=selangor&from=YYYY-MM-DD&to=YYYY-MM-DD`: returns cached public/state holidays from HolidayWise and KPM school-break periods for configured academic years using the state's Group A/B assignment. If the public cache is missing, it fetches the state feed directly; if the feed is unavailable, the last valid cache is retained. The response includes `sources.holidayWise`, `sources.kpm`, event counts and a feed error when applicable. Public holidays and school breaks are read-only; no Google Calendar OAuth permission is requested.
- Scheduled refresh: the Worker refreshes all state feeds monthly from August through December and on 31 December. KPM date ranges are curated from official KPM academic calendars and cached by the same scheduled job; add a new academic year to the source data when KPM publishes it.

Existing Google Calendar-imported events remain in the workspace as editable KitaNotes events. The retired OAuth connection and event-map tables are dropped by migration `0016_calendar_2_0.sql`.
