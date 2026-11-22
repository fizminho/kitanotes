# Google sign-in

## Routes implemented

| Route | Method | Purpose |
|---|---|---|
| `/auth/google` | GET | Start Google OIDC login using state, nonce and PKCE. Accepts an optional same-origin `returnTo` path for invitation acceptance. |
| `/auth/google/callback` | GET | Exchange the authorization code, validate the ID token, create/update the user, create a personal workspace and issue a session cookie. |
| `/api/auth/status` | GET | Return whether D1 and Google OAuth configuration are present, without exposing secrets. |
| `/api/auth/me` | GET | Return the current user, including personal workspace ID, or HTTP 401. |
| `/api/auth/logout` | POST | Revoke the current session and clear the cookie. Requires same-origin `Origin` header. |

Login scopes are limited to `openid email profile`. Google Calendar scopes are not requested. Invitation acceptance uses `/invite/accept?token=...`; after Google sign-in the app returns to that path. The verified Google email must match the invitation address.

## Google Cloud Console setup

Create a Web application OAuth client for each environment. Add the exact authorised redirect URI:

```text
https://YOUR-WORKER-HOST/auth/google/callback
```

For local Wrangler development, add the exact local callback URI shown by the local dev URL, usually:

```text
http://localhost:8787/auth/google/callback
```

Google OAuth may require a configured consent screen and test-user list while the app remains in testing mode.

## Worker configuration

Set non-secret values as Worker vars:

- `GOOGLE_CLIENT_ID`
- `APP_BASE_URL` (exact HTTPS origin in production)

Set secrets using Wrangler:

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

Generate a strong session secret locally, for example with `openssl rand -base64 48`. Never commit it or paste it into source files. Use separate credentials for local, staging and production.

For local development, copy `.dev.vars.example` to `.dev.vars`, replace the placeholders with your Google OAuth test credentials and a generated session secret, and never commit `.dev.vars`. The session cookie is Secure; use an HTTPS local tunnel if the browser does not retain Secure cookies on your local setup.

## D1 prerequisites

Apply `migrations/0001_initial.sql` and `migrations/0002_sessions.sql` to a dedicated KitaNotes D1 database before testing sign-in. Replace the placeholder database ID in `wrangler.toml` with the actual KitaNotes database ID. Never reuse Investlah's D1 database.
\n\n## Optional Google Calendar authorization\n\nGoogle sign-in remains limited to `openid email profile`. Calendar import starts a separate OAuth consent flow and requests only `https://www.googleapis.com/auth/calendar.events.readonly`. Register `https://kitanotes.binalah.com/auth/google/calendar/callback` as an authorized redirect URI in the Google OAuth web client. The callback uses PKCE and a short-lived one-time state record.\n