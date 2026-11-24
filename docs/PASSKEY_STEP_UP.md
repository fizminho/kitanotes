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
- Recovery-code regeneration requires D1 batch support; it fails closed with a temporary-unavailable response if batch is unavailable or fails, preserving the previous recovery codes.
- Step-up verification currently consumes the challenge and updates the credential counter before inserting the grant in separate writes. A later write failure can require the user to repeat step-up; it does not issue a grant, but this flow is not an atomic multi-write transaction.
- Test authenticators that omit userHandle when allowCredentials is populated.
- Run live browser tests on iOS/macOS/Android authenticators.

This implementation has not been applied to production D1 and has not undergone a live external penetration test.


## Passkey signup transaction

Initial Passkey signup requires D1 `batch()`. The signup challenge is consumed in the same atomic batch as creation of the user, personal workspace, workspace membership, Passkey credential, recovery-code hashes, and initial session. If D1 batch is unavailable or any statement fails, the batch is rolled back and the endpoint returns `503 PASSKEY_SIGNUP_TEMPORARILY_UNAVAILABLE`; it does not fall back to sequential writes or issue a session cookie. A challenge is only considered consumed when the first batch statement reports exactly one changed row. The client can restart signup to obtain a fresh challenge after a transient failure.
