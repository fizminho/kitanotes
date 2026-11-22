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
- Notes and categories are workspace-scoped. Membership and role checks must be enforced by API handlers before returning data.

## Required controls before production

- [ ] Configure production Google OAuth client with exact redirect URI.
- [ ] Set `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` using Worker secrets; use at least 32 random bytes for the session secret.
- [ ] Set the production `APP_BASE_URL` to the exact HTTPS origin.
- [ ] Verify login, logout, session expiry and account switching with two real Google accounts.
- [ ] Add CSRF origin validation to every state-changing authenticated API endpoint.
- [ ] Add rate limits for login initiation, callbacks, invitations and AI endpoints.
- [ ] Add invitation-token hashing, expiry, one-time acceptance and verified-email matching tests.
- [ ] Add workspace isolation and owner/editor/viewer authorization tests.
- [ ] Review XSS-safe Markdown rendering and content security policy before rendering note content.
- [ ] Define session revocation on account deletion and security events.
- [ ] Add log redaction and ensure tokens, cookies, private note text and provider secrets are never logged.
- [ ] Review dependency updates and pin GitHub Actions to reviewed immutable SHAs before production.

## Known limitations / follow-up

- Google JWKS is fetched during callback validation; production hardening may add a bounded in-memory cache with key rotation handling.
- The current session store has a fixed seven-day expiry. Refresh/rotation and "log out all devices" are not implemented.
- Authentication has unit coverage for ID-token signature and key OIDC claims, but no real Google OAuth end-to-end test yet.
- No note CRUD endpoint is exposed until authenticated workspace authorization is implemented.
- The app is not production-ready while any checklist item above remains open.
