# KitaNotes security baseline

## Current implementation

- Google OIDC login uses state, nonce and PKCE (S256).
- ID tokens are signature-verified against Google's published JWKS and checked for issuer, audience, expiry, nonce and verified email.
- Google `sub` is the stable user key. Email is normalised and used for invitation matching.
- Application sessions use random opaque tokens. Only SHA-256 token hashes are stored in D1.
- Session cookies are HttpOnly, Secure, SameSite=Lax and use the `__Host-` prefix.
- OAuth state is stored in a short-lived signed HttpOnly cookie.
- Logout requires a same-origin Origin header.
- OAuth client secret and session signing secret are Worker secrets, never frontend build variables.
- Notes, categories, invitations, calendar events and reminders are workspace-scoped. Membership and role checks are enforced by API handlers.
- Invitation tokens are cryptographically random, stored only as hashes, expire after seven days, are single-use and require the invited verified Google email.
- Mutating notes, categories, invitations, calendar, reminders, notifications and AI consent routes enforce same-origin checks.
- Reminder notifications use an idempotent D1 batch and a five-minute Cron Trigger. No email or browser push provider is called.
- Google OAuth initiation is limited to 10 attempts per IP fingerprint per 10-minute window; callbacks are limited to 20 per IP fingerprint per 10-minute window. IP fingerprints are HMACed with the session secret before storage.
- Invitation creation is limited to 10 per authenticated user per hour. Fixed-window counters use atomic D1 upserts and expired buckets are removed by the scheduled reminder task.
- Security headers are applied to API, health and static asset responses, including CSP, HSTS on HTTPS, frame denial, no-sniff, referrer and permissions policies.
- Gemini is server-side only. Explicit consent is stored by policy version; raw prompts/drafts are not persisted; the adapter enforces a 16 KiB input limit, 10 requests/user/UTC day and a hard free-model allowlist. No paid-model fallback exists. See [AI privacy policy](AI_PRIVACY.md).

## Required controls before production

- [ ] Configure production Google OAuth client with exact redirect URI.
- [ ] Set `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` using Worker secrets; use at least 32 random bytes for the session secret.
- [ ] Set the production `APP_BASE_URL` to the exact HTTPS origin.
- [ ] Verify login, logout, session expiry and account switching with two real Google accounts.
- [x] Add CSRF origin validation to every state-changing authenticated API endpoint.
- [x] Add a per-user daily request cap and input-size limit for AI endpoints.
- [x] Add D1-backed rate limits for login initiation (10/IP/10m), callbacks (20/IP/10m) and invitation creation (10/user/hour); add atomic counter and expiry tests.
- [x] Add invitation-token hashing, expiry, one-time acceptance and verified-email matching tests.
- [x] Add workspace isolation and owner/editor/viewer authorization tests.
- [ ] Review XSS-safe Markdown rendering and content security policy before rendering note content.
- [ ] Define session revocation on account deletion and security events.
- [ ] Add log redaction and ensure tokens, cookies, private note text and provider secrets are never logged.
- [ ] Review dependency updates and pin GitHub Actions to reviewed immutable SHAs before production.

## Known limitations / follow-up

- Google JWKS is fetched during callback validation; production hardening may add a bounded in-memory cache with key rotation handling.
- D1 rate limits depend on a provisioned database and share its free daily read/write quotas. A database outage fails the protected action closed; consider Cloudflare edge-level protection if abuse warrants it.
- The current session store has a fixed seven-day expiry. Refresh/rotation and "log out all devices" are not implemented.
- Authentication has unit coverage for ID-token signature and key OIDC claims, but no real Google OAuth end-to-end test yet.
- Notes, categories, invitations, calendar, reminders, notifications and AI routes have D1-backed integration tests. Tests use a local SQLite adapter, not a provisioned Cloudflare D1 database.
- The app is not production-ready while any checklist item above remains open.
