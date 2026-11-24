# Passkey Step-up Authentication

## Protected actions

A fresh WebAuthn user-verification ceremony is required before:
- Adding another Passkey to an account that already has a Passkey.
- Regenerating recovery codes.
- Removing a Passkey.

The step-up challenge is bound to the authenticated user and current session hash. It expires after five minutes. The resulting random grant is stored only as a SHA-256 hash, bound to the same user/session, expires after two minutes, and is consumed once.

For step-up assertions, the credential ID is looked up under the current user before verification. WebAuthn may omit userHandle when an allow-list of credentials is supplied, so a missing handle is accepted in this case. If a handle is supplied, it must match the current user's encoded ID.

## First Passkey enrollment

An account with no registered Passkeys can enroll its first Passkey using its existing authenticated session. This exception is necessary because there is no existing authenticator available for a step-up ceremony. Subsequent Passkey changes require step-up.

## Operational checks

- Apply migration 0021_passkey_step_up.sql before deploying the Worker code.
- Verify first Passkey enrollment for Google-authenticated users.
- Verify adding a second Passkey prompts for the existing Passkey.
- Verify recovery-code regeneration prompts for the existing Passkey.
- Verify a step-up token cannot be reused, used by another session, or used after expiry.
- Verify removing a Passkey requires step-up.
- Test authenticators that omit userHandle when allowCredentials is populated.
- Run live browser tests on iOS/macOS/Android authenticators.

This implementation has not been applied to production D1 and has not undergone a live external penetration test.
