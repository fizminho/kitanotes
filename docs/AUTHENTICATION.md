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

Apply all migrations in order, including `migrations/0019_passkeys.sql` and `migrations/0020_passkey_signup_recovery.sql`, to a dedicated KitaNotes D1 database before testing sign-in. Replace the placeholder database ID in `wrangler.toml` with the actual KitaNotes database ID. Never reuse Investlah's D1 database.


## Calendar interoperability

KitaNotes uses the iCalendar (`.ics`) format for calendar import and export. It does not request Google Calendar API permissions; users export events from Apple Calendar, Google Calendar or Outlook and import the `.ics` file into a KitaNotes workspace.

## Passkey signup, sign-in and account recovery

KitaNotes uses SimpleWebAuthn for WebAuthn registration and assertion verification. A passkey can be the primary credential for a new account or an additional credential for an existing account.

1. A new user chooses **Create account** and enters a display name and email address. The email is initially unverified.
2. The browser creates a discoverable Passkey with user verification. Only after successful attestation does the Worker create the user, personal workspace, membership, credential and session.
3. Ten one-time recovery codes are displayed once. Each code contains 128 bits of random entropy; only SHA-256 hashes are stored. The user must save them securely.
4. Existing Google users continue to sign in with Google first, then choose **Add passkey** to link a passkey to that same account.
5. A passkey-only user can choose **Link Google** while signed in. The OAuth state is bound to the current session and account; the verified Google identity is linked only to that account. Email matching alone never links accounts.
6. If all passkeys are lost, the user can enter one unused recovery code. The code is atomically consumed and a normal KitaNotes session is issued. After recovery, the user should add a new passkey and regenerate the recovery codes.

The registration ceremony requires a discoverable credential (`residentKey: required`) and user verification. Authentication also requires user verification. Challenges expire after five minutes, are single-use, and are bound to the registration user where applicable. Authentication responses must include the matching user handle. Credential counters are checked and updated.

The RP ID is the hostname from `APP_BASE_URL`; the expected origin is its exact origin. Production must remain HTTPS. The browser and Worker use the MIT-licensed `@simplewebauthn/browser` and `@simplewebauthn/server` packages.

Google login remains available. A passkey-only account email is not considered verified until the user completes the explicit **Link Google** flow. This is required for email-verified workspace invitation acceptance. A recovery code is a one-time emergency sign-in method, not an email reset. Users should keep multiple passkeys registered where possible and store recovery codes in a password manager. Never link accounts merely because a user typed an email address or phone number.
