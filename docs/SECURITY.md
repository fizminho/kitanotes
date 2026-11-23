# KitaNotes security baseline

This file is the concise, project-specific view of the controls currently implemented. For the reusable checklist, threat model, test matrix, PR history and follow-up plan, see [Security hardening playbook](SECURITY_HARDENING_PLAYBOOK.md).

## Implemented controls

- Google OIDC uses state, nonce and PKCE (S256); ID tokens are signature-verified and claims are checked.
- Stable Google subject identifies users. Sessions use random opaque tokens; only SHA-256 hashes are stored in D1.
- Session cookies use HttpOnly, Secure, SameSite=Lax and the __Host- prefix. Logout revokes the current server-side session and clears the cookie.
- OAuth and session secrets, Gemini API key and VAPID private key are Worker secrets. Public client/key material is kept separate.
- Workspace membership and role checks are enforced server-side for notes, events, reminders, invitations, notifications and other protected resources.
- Invitation tokens are random, stored hashed, expire, and named-email invitations require matching verified email. Open-link invitation behavior is intentionally reusable.
- State-changing browser endpoints use same-origin checks. Request readers enforce byte limits.
- D1-backed rate limits protect OAuth, invitations, OCR, push subscription operations, push test and public holiday refresh paths.
- AI requests are bounded by input size and per-user daily quota; model IDs are filtered through a free-model allowlist. Provider secrets remain server-side.
- OCR accepts bounded JPEG/PNG/WebP bytes, validates file signatures, does not fetch user-supplied URLs, and has separate burst and daily quotas.
- Push subscriptions are user-scoped, endpoint-host validated and device-capped. Push payloads contain generic messages only, not note/event/reminder/workspace content.
- API JSON responses use Cache-Control: no-store. Security headers include CSP and related browser protections. Vite production source maps are disabled.
- CI runs dependency audit, build, tests, migration validation and a Worker dry-run. CodeQL runs on PRs, main pushes, weekly schedule and manual dispatch.

## Security PR history

- #25 dependency updates and dependency audit in CI
- #26 public holiday API rate limits and feed bounds
- #27 push API body bounds and rate limits
- #28 CodeQL workflow
- #29 workspace authorization regression tests
- #30 reminder, notification and invitation authorization hardening
- #31 API response data minimization
- #32 role/workspace ID tampering regression tests
- #33 cross-resource and ownership-transfer regression tests
- #34 concurrent workspace ownership-transfer protection
- #35 generic push payloads to prevent private-content leakage

## Open follow-up items

- Session inventory, revoke-all-devices, refresh/rotation and broader security-event revocation.
- Complete real Google OAuth end-to-end and production smoke testing for logout, expiry and account switching.
- Dedicated log-redaction review for tokens, cookies, private content and provider payloads.
- Pin GitHub Actions to reviewed immutable commit SHAs.
- Verify Cloudflare account-level roles, secret access, deployment restrictions, routes, D1 configuration and other dashboard-only settings.
- Confirm protected-branch rules and required reviews/checks in GitHub settings.

## Important verification boundary

Repository review, passing tests, CodeQL and Worker dry-run are evidence of code-level controls, not proof of production deployment or account-level configuration. Do not mark a production release as security-verified until the deployed commit, migrations, dashboard settings and production smoke tests have been checked.

See [AI privacy policy](AI_PRIVACY.md), [authentication](AUTHENTICATION.md) and [PWA push](PWA_PUSH.md) for feature-specific details.
