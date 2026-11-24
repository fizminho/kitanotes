# Google sign-in and passkeys

## Routes implemented

| Route | Method | Purpose |
|---|---|---|
| `/auth/google` | GET | Start Google OIDC login using state, nonce and PKCE. Accepts an optional same-origin `returnTo` path for invitation acceptance. |
| `/auth/google/callback` | GET | Exchange the authorization code, validate the ID token, create/update the user, create a personal workspace and issue a session cookie. |
| `/api/auth/status` | GET | Return whether D1 and Google OAuth configuration are present, without exposing secrets. |
| `/api/auth/me` | GET | Return the current user, including personal workspace ID, or HTTP 401. |
| `/api/auth/logout` | POST | Revoke the current session and clear the cookie. Requires same-origin `Origin` header. |
| `/api/auth/passkeys/register/options` | POST | Create short-lived registration options for the currently authenticated account. |
| `/api/auth/passkeys/register/verify` | POST | Verify and link a new discoverable passkey to the current account. |
| `/api/auth/passkeys/authenticate/options` | POST | Create short-lived, username-less authentication options. |
| `/api/auth/passkeys/authenticate/verify` | POST | Verify a passkey and issue a normal KitaNotes session for its linked user. |
| `/api/auth/passkeys` | GET | List passkeys belonging to the current user. |
| `/api/auth/passkeys/:credentialId` | DELETE | Revoke one passkey belonging to the current user. |

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


## Calendar interoperability

KitaNotes uses the iCalendar (`.ics`) format for calendar import and export. It does not request Google Calendar API permissions; users export events from Apple Calendar, Google Calendar or Outlook and import the `.ics` file into a KitaNotes workspace.

## Passkey sign-in and existing-account linking

KitaNotes uses SimpleWebAuthn for WebAuthn registration and assertion verification. Passkeys are additional credentials for an existing KitaNotes user, not separate user accounts.

1. An existing user signs in with Google.
2. While that authenticated session is active, the user chooses **Add passkey**.
3. The Worker creates a short-lived challenge and verifies the browser's WebAuthn registration response against the configured application origin and RP ID.
4. The credential is stored against the existing `users.id`. No email-based account matching or automatic account merge is performed.
5. On a later device, **Use passkey** starts discoverable-credential authentication. A successful assertion resolves the credential to its existing `user_id` and issues the same opaque, hashed D1 session used by Google login.

The registration ceremony requires a discoverable credential (`residentKey: required`) and user verification. Authentication also requires user verification. Challenges expire after five minutes, are single-use, and are bound to the registration user where applicable. Authentication responses must include the matching user handle. Credential counters are checked and updated.

The RP ID is the hostname from `APP_BASE_URL`; the expected origin is its exact origin. Production must remain HTTPS. The browser and Worker use the MIT-licensed `@simplewebauthn/browser` and `@simplewebauthn/server` packages.

Existing Google login remains enabled as the recovery and account-linking path. A passkey can only be added after the user has authenticated to the account they intend to link. Never link a passkey merely because a user typed an email address or phone number.
