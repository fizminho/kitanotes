# Security hardening playbook

Reusable security review and implementation guide distilled from the KitaNotes security audit (November 2026).

Use this as a checklist and threat-model template for other repositories. Adapt controls and limits to each product. It is not a certification or a claim that every control applies everywhere.

## 1. Security principles

1. The server is the security boundary. Never trust hidden UI controls, client-side role flags, workspace IDs, owner IDs, quotas or resource relationships supplied by a browser.
2. Authenticate, then authorize every resource. Check access to the specific object through the correct tenant/workspace and role.
3. Minimize data at every boundary. Return only fields the screen needs. Keep private content out of push payloads, URLs, logs, analytics, error messages and caches.
4. Bound untrusted work. Limit request bytes, file bytes, array lengths, text length, execution time, concurrency, retries and per-user/IP frequency.
5. Keep secrets server-side. Browser bundles are public by design. Minification and obfuscation do not protect secrets or data.
6. Fail closed for security decisions. If authorization, rate-limit storage, signature validation or required configuration cannot be checked, reject the protected action.
7. Test negative paths. Add regression tests for cross-user, cross-tenant, wrong-role, stale-token, malformed-input and replay attempts.
8. Make changes reviewable. Use small PRs, automated checks, clear threat descriptions and an evidence record.

## 2. Threat-model checklist

For every feature or endpoint, record:
- Asset: personal data, tenant records, files, credentials, money or notifications to protect.
- Actor: anonymous visitor, authenticated user, member, viewer/editor/owner, removed member, compromised account, bot or external provider.
- Boundary: browser/API, API/database, Worker/AI provider, Worker/push service, OAuth callback, CI/deployment.
- Abuse case: IDOR/BOLA, role escalation, CSRF, replay, brute force, resource exhaustion, SSRF, data leakage, stale authorization or race condition.
- Control: server-side validation, scoped query, role check, token binding, quota, payload limit, idempotency or output minimization.
- Evidence: test name, CI run, review result or manual verification. Mark unverified items explicitly.

## 3. Authentication, sessions and OAuth

- Use a well-supported OIDC/OAuth flow. Validate state, nonce, PKCE S256, issuer, audience, signature, expiry and verified identity claims.
- Use the provider's immutable subject as the identity key, not email alone. Normalize email only for matching/invitation workflows.
- Generate high-entropy opaque session tokens. Store only a cryptographic hash server-side.
- Set cookies HttpOnly, Secure, appropriate SameSite, Path=/, no Domain, and use the __Host- prefix where possible.
- Make logout revoke the server-side session and clear the cookie. Require same-origin/CSRF protection for state-changing logout.
- Define absolute and idle expiry, rotation, account switching, revoke-all-devices, account deletion and revocation after security events.
- Make OAuth state short-lived and single-use. Validate exact redirect URI and safe return paths. Never accept arbitrary redirect destinations.
- Rate-limit login initiation and callback attempts. Avoid storing raw IP addresses when a keyed fingerprint is sufficient.
- Never log authorization codes, access/refresh tokens, cookies, state, nonce, PKCE verifier or secrets.
- Test expired, reused, mismatched, revoked, wrong-audience and invalid-signature cases, plus two-account switching.

## 4. Authorization, tenant isolation and object access

- Derive the current user from the authenticated server-side session.
- For every read, update and delete, scope the database query by authenticated user or verified membership. Prefer a query that includes both resource ID and authorization scope.
- Enforce roles in the API, not only in React. Test viewer cannot mutate, editor cannot perform owner-only actions, and non-members cannot access tenant resources.
- Ignore or reject client-supplied owner/user/role fields. Assign them from authenticated context.
- Validate linked resources belong to the same tenant/workspace before create and update.
- Treat invitation tokens as bearer credentials: generate random values, store hashes, expire and revoke them, and make named-user invitations one-time with verified-email matching. Decide explicitly whether open invitations are reusable.
- Protect ownership transfer and other multi-row authorization changes against races using transactions or atomic conditional updates.
- Add tests for guessed IDs, cross-workspace IDs, removed members, stale invitations, concurrent ownership changes and role tampering.

## 5. API input, abuse and resource limits

- Validate HTTP method, content type, schema, enum values, identifiers and expected state.
- Enforce body limits while reading/streaming, not only by trusting Content-Length. Reject oversized or malformed bodies before expensive processing.
- Bound nested arrays, strings, pagination, file count, decoded file size, execution time and provider retries.
- Use atomic upserts or another concurrency-safe store for rate limits. Avoid read-then-write counters that can be raced.
- Apply layered quotas: per-user, per-IP/fingerprint, per-endpoint and global protection where appropriate. Use separate limits for expensive AI/OCR and push test endpoints.
- Return 429 with a retry hint for quota exhaustion. Do not leak internal implementation details.
- Decide fail-open vs fail-closed deliberately. For sensitive or expensive operations, unavailable rate-limit storage should normally block the operation.
- Make side-effecting operations idempotent where retries are possible.
- Validate backend-fetch URLs separately. Never fetch arbitrary user URLs unless SSRF controls are intentionally designed.

## 6. AI, OCR and uploaded files

- Keep provider API keys in server-side secrets, never frontend variables or browser bundles.
- Send only the specific text/image selected for the action. Do not silently include unrelated notes, workspace records, contacts or files.
- Disclose external processing at the point of action. Explain provider/free-tier data terms and discourage uploading passwords, financial details, identity documents or confidential material.
- Use a hard model allowlist when cost or data policy requires it. Do not permit client-supplied model IDs or paid-tier fallback.
- Bound prompt bytes, image bytes, extracted text, output length, request count, retries and provider timeout.
- For image uploads, allow only required formats, check declared MIME and file signature, reject SVG/unsupported formats, and do not accept a URL in place of bytes unless SSRF is mitigated.
- Strip EXIF metadata client-side where possible, but validate server-side. Do not persist images or extracted text unless required.
- Treat OCR text and AI output as untrusted. They must not override system instructions, call tools, authorize actions or write data without user review.
- Keep AI output as a draft. Require explicit confirmation before creating notes, events, reminders or other side effects.
- Test wrong workspace IDs, over-quota requests, malformed image signatures, unsupported formats, huge bodies, provider errors and prompt injection embedded in images.

## 7. Push notifications and external delivery

- Treat a push subscription endpoint as an outbound network destination. Require HTTPS, validate hostname against known push-service domains, reject credentials/ports where inappropriate and cap endpoint/body lengths.
- Bind subscriptions to the authenticated user. Prevent endpoint takeover by another account and cap devices per user.
- Require same-origin checks and authenticated ownership for subscribe/unsubscribe/test operations. Rate-limit registration, deletion and test sends.
- Keep VAPID/private signing keys in Worker secrets. Only the public key may be exposed to the browser.
- Push payloads should be generic: notification category and safe same-origin landing path only. Never send note text, event details, invitation tokens, private workspace names or resource IDs.
- Use opaque tags, not private resource identifiers. Assume push text may appear on lock screens and pass through vendor push services.
- Keep the authenticated in-app inbox as source of truth; push is best-effort. Remove expired 404/410 subscriptions.
- Test payload contents directly, asserting sensitive test strings never appear in serialized payloads.

## 8. Browser, frontend and HTTP response security

- Assume all JavaScript, HTML, API URLs, public configuration and downloaded assets are inspectable. Do not try to hide source as a security control.
- Keep secrets and private records out of frontend bundles, HTML, source maps, local storage and service-worker caches.
- Disable production source maps unless using a controlled private upload process.
- Set restrictive CSP and appropriate HSTS (HTTPS only), frame denial, nosniff, Referrer-Policy and Permissions-Policy.
- Set private/authenticated API responses to Cache-Control: no-store. Do not cache API/auth responses in service workers or CDNs.
- Render untrusted text as text. Avoid unsafe HTML injection; if rich HTML is required, use a maintained sanitizer with a strict policy.
- Use same-origin/CSRF checks for state-changing browser requests. SameSite cookies are defense-in-depth, not a replacement for server-side checks.
- Do not block right-click, keyboard shortcuts, developer tools or context menus. These controls are bypassable and harm usability.

## 9. Database and Cloudflare configuration

- Bind the database to the Worker; do not expose database credentials or a direct public database endpoint to the browser.
- Give each environment its own database and secrets. Keep production credentials separate from local/staging.
- Put API keys, OAuth client secrets, session signing keys and VAPID private keys in Worker Secrets. Keep only non-sensitive identifiers/public keys in vars.
- Review deployment configuration for resource IDs, bindings, routes, cron schedules and accidental secrets. Resource IDs/public client IDs are not passwords, but should be documented deliberately.
- Restrict who can edit Worker secrets, deploy Workers, change routes and access D1. Require MFA and least privilege in Cloudflare/GitHub account settings.
- Review D1 backups/retention, migrations, access paths and whether any API route can return raw database rows.
- Verify production configuration in Cloudflare dashboard. Repository review cannot prove account roles, secret values, route exposure, WAF settings or deployment permissions.
- Never paste secret values into issues, PRs, chat, logs or screenshots. Rotate a secret if exposure is suspected.

## 10. CI, dependencies and secure change workflow

Recommended minimum PR checks:
1. Dependency vulnerability audit (fail on high/critical; triage advisories rather than blindly upgrading).
2. TypeScript/lint/build.
3. Unit and integration tests, including authorization-negative cases.
4. Database migration validation against a compatible local engine.
5. Infrastructure/Worker bundle dry-run that does not deploy.
6. CodeQL or equivalent static analysis on PRs and on a schedule.
7. Optional secret scanning and dependency update automation.

Workflow hardening:
- Set minimum GITHUB_TOKEN permissions per workflow/job (usually contents: read; grant write only where needed).
- Pin third-party GitHub Actions to reviewed immutable commit SHAs, not mutable tags.
- Protect main, require PR review and successful required checks, and restrict who can deploy.
- Do not run untrusted pull-request code with privileged secrets or write-capable tokens.
- Separate CI validation from production deployment. A dry-run or CI pass is not proof of production deployment.
- For each finding: reproduce it, identify boundary/impact, add a failing regression test, make the smallest server-side fix, rerun tests/CodeQL, review diff, merge, then verify main checks and production release separately.

## 11. Reusable test matrix

| Area | Negative test |
|---|---|
| Authentication | Expired/revoked session, bad OAuth state/nonce, replayed callback |
| Authorization | Cross-user and cross-tenant resource ID returns no data |
| Roles | Viewer cannot write; non-owner cannot perform owner action |
| Client tampering | Client cannot assign owner, role, tenant or another user's resource |
| Relationships | Linked object from another tenant is rejected |
| Invitations | Expired/revoked/reused token and wrong verified email rejected |
| Concurrency | Simultaneous ownership/claim/settlement operations cannot both win |
| CSRF | State-changing request without correct Origin is rejected |
| Rate limits | Per-user/IP limit, atomic counter and reset/expiry tested |
| Body limits | Oversized body rejected even with missing/false Content-Length |
| File upload | MIME spoofing, invalid signature, unsupported type and oversized file rejected |
| AI | No unrelated tenant data sent; provider key absent from bundle; quota enforced |
| Push | Subscription ownership enforced; generic payload contains no private content |
| Caching | Authenticated API response has no-store and is not service-worker cached |
| Secrets | Secret scan and built frontend bundle contain no private keys/tokens |

## 12. How to reuse this in another repository

1. Read architecture, routes, schema, auth/session code, CI workflows and deployment configuration before proposing fixes.
2. List sensitive resources and tenant/ownership relationships.
3. Build an endpoint inventory: method, authentication, authorization scope, CSRF, input limit, rate limit, response fields, side effects and tests.
4. Prioritize unauthenticated exposure, cross-tenant IDOR, role escalation, secret exposure, SSRF, arbitrary file access, replay/race, then abuse/availability.
5. Confirm each suspected issue in code and tests. Do not label theoretical concerns as confirmed vulnerabilities.
6. Add regression tests before or with each fix. Keep changes small and independently reviewable.
7. Run full CI plus security analysis. Static analysis alone does not prove production safety.
8. Record finding, affected route, impact, fix, regression test, PR/commit, CI evidence, deployment verification and remaining limitation.
9. Re-run the checklist after major feature, auth, schema, provider or deployment changes.

## 13. KitaNotes audit record (November 2026)

### Security PRs merged

| PR | Change |
|---|---|
| #25 | Updated vulnerable dependencies including Vite; added npm audit high-severity gate in CI. |
| #26 | Rate-limited public holiday API, hashed IP fingerprints, limited global refresh and capped feed size. |
| #27 | Bounded push API JSON bodies; rate-limited subscription create/delete and test push. |
| #28 | Added PR-triggered and scheduled CodeQL analysis using JavaScript/TypeScript security-extended queries. |
| #29 | Added workspace authorization regression tests for outsider, removed-member and viewer access. |
| #30 | Hardened reminder, notification, preference and invitation access; added body bounds and cross-resource checks. |
| #31 | Minimized personal data in note/event/activity API responses; removed unnecessary email fields and added tests. |
| #32 | Added tests for client-supplied role/workspace ID tampering, including AI Organizer cross-workspace note IDs. |
| #33 | Added cross-workspace linked-note and ownership-transfer authorization regression tests. |
| #34 | Prevented concurrent workspace ownership transfers from creating inconsistent ownership. |
| #35 | Replaced private-content push payloads with generic messages, safe / destination and opaque notification tags. |

### Additional protections reviewed in the repository

- OIDC state, nonce, PKCE and ID-token signature/claim validation.
- Hashed opaque sessions, secure __Host- cookie attributes and server-side logout.
- Workspace-scoped API access and role enforcement.
- Same-origin checks for state-changing endpoints.
- D1-backed rate limits and bounded request readers.
- AI input limits, daily per-user quota and free-model allowlist; provider key remains server-side.
- OCR 2 MiB body limit, JPEG/PNG/WebP signature validation, 3/minute burst limit and 5/day quota; no user URL fetching.
- Push subscription endpoint allowlist, authenticated ownership, per-user device cap, VAPID secret separation and generic payloads.
- API no-store, security headers and disabled Vite production source maps.
- CI dependency audit, build, tests, migration validation, Worker dry-run and CodeQL.

### Verification and limits

- PR #25–#35 are merged. PR #35 Build and validate and CodeQL passed on its final commit.
- Main-branch CI and CodeQL passed after preceding security changes as checked during the audit.
- CI migration validation and Worker dry-run are not production deployment verification.
- The audit reviewed repository code and automated tests. It did not inspect Cloudflare account permissions, actual secret values, production D1 network/account settings, WAF configuration or GitHub branch-protection settings.
- Session design has a fixed seven-day expiry. Refresh/rotation and log out all devices are not implemented.
- A complete real-provider OAuth end-to-end test and recorded production smoke test for expiry/account switching remain follow-up work.
- GitHub Actions are referenced by major tags in current workflows; pin reviewed immutable SHAs as separate supply-chain hardening.
- A dedicated log-redaction review remains open. Ensure tokens, cookies, AI prompts, OCR text and private note content are never logged.
- A clean CodeQL result is not proof that the application is vulnerability-free.

## 14. Next recommended work

1. Add session inventory and revoke-one/revoke-all functionality; define revocation for account/security events.
2. Review logging and error reporting for PII/token leakage.
3. Pin GitHub Actions to immutable SHAs and configure protected branches/required reviewers.
4. Verify Cloudflare production account permissions, Worker routes, D1 access, secrets and deployment restrictions in dashboard.
5. Run production smoke tests for login, account switching, logout, expiry, workspace isolation, AI/OCR limits and push delivery.
