# Passkey Authentication Security Hardening

## Scope

This change hardens the Passkey-first signup and recovery flow without removing Google sign-in or changing existing session cookies.

## Changes

- Verified Google sign-in can claim an existing Passkey-only account only when its email matches and the stored email is explicitly unverified. The existing user ID, notes, workspace membership, and Passkey credentials remain attached to that account.
- Google identities already linked to another account are not merged by email.
- Existing verified accounts are not eligible for this claim path.
- Recovery-code normalization now removes actual whitespace as well as hyphens before validating the 128-bit code.
- Integration coverage verifies that a verified Google identity claims the unverified Passkey account rather than creating a duplicate, and that recovery codes tolerate embedded whitespace.

## Security properties retained

- Passkey registration and authentication continue to verify challenge, expected origin, RP ID, and user verification.
- Recovery codes remain cryptographically random, stored as SHA-256 hashes, and consumed with a conditional delete.
- Session cookies remain HttpOnly, Secure, SameSite=Lax, and use the __Host- prefix.
- Google account linking remains bound to the authenticated user and the initiating session hash.

## Remaining operational checks

- Run the full CI and CodeQL workflows for this change.
- Confirm production D1 migration 0020 has been applied before enabling the new signup flow.
- Perform live browser tests for Passkey signup, Google claim of an unverified Passkey email, normal Google login, recovery-code use, and recovery-code replay.
- Rate limiting is IP-fingerprint based; consider an additional global/account-target bucket if abuse telemetry warrants it.

This is code-level hardening, not a substitute for a production penetration test.
