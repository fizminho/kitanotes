# KitaNotes PWA and Web Push

## Progressive Web App

- The app publishes `/manifest.webmanifest` and app icons.
- `/sw.js` is registered at the root scope.
- The service worker caches the app shell and same-origin hashed assets.
- Navigation is network-first and falls back to the cached app shell when offline.
- API and authentication requests are deliberately never cached. Notes, calendar data and edits therefore still require a network connection; offline editing and background sync are not implemented.
- The UI uses the native install prompt where supported and shows Add to Home Screen instructions for iOS and browsers that do not expose that prompt.

## Web Push setup (optional, free)

Web Push uses the standard browser push service and the Web Crypto-compatible `@block65/webcrypto-web-push` package. There is no paid notification provider.

1. Generate an application-server key pair locally:

   ```sh
   node scripts/generate-vapid-keys.mjs
   ```

2. Configure the output in the Cloudflare Worker:
   - `VAPID_PUBLIC_KEY`: public key, configured as a Worker variable.
   - `VAPID_PRIVATE_KEY`: private JWK `d` value, configured as a Worker Secret.
   - `VAPID_SUBJECT`: a contact URI such as `mailto:you@example.com`, configured as a Worker variable. Replace the example with an email address you control.
3. Deploy the Worker and apply all pending D1 migrations, including `0008_push_subscriptions.sql`, `0009_notification_preferences.sql`, `0015_notification_activity_preferences.sql`, `0030_detailed_notification_default.sql` and `0031_push_preview_and_debounce.sql`. The configured Workers Builds deploy command should be `npm run cf:deploy`, which applies remote migrations before publishing the Worker.
4. Sign in on a supported browser, open Notifications and choose Enable push. Permission is requested only after the user taps the button.
5. Use Test to send a generic notification to the current device.

Never commit the private key or paste it into a chat or frontend environment variable. Rotating the VAPID key invalidates existing browser subscriptions; users must subscribe again.

## Privacy and delivery behavior

- Subscriptions are stored per authenticated user and endpoint. Each user can register up to 10 devices.
- The Worker accepts only HTTPS endpoints from known browser push-service domains to prevent arbitrary outbound fetches.
- Push payloads use the recipient's preview mode: detailed previews may contain actor names, note/event/reminder titles, workspace names and resource IDs; generic previews preserve the original generic catalogue. Note body text, event descriptions and invitation tokens are never included. All payloads use validated same-origin paths.
- New shared notes and due reminders create durable in-app notifications first. Web Push is best-effort; the inbox remains the source of truth.
- Expired subscriptions (HTTP 404/410) are removed automatically.
- If VAPID is not configured, the app keeps working and the push controls report that push is not configured.
- Push delivery requires a secure origin and browser permission. On iOS/iPadOS, Web Push is available to web apps added to the Home Screen on supported OS versions.

## Scope boundaries

This release caches only the application shell and static assets. It does not cache private API responses, permit offline note editing, or promise delivery while a device is offline or push permission is denied.



## Notification content catalogue

See [Push Notification Content Catalogue](./PUSH_NOTIFICATION_CATALOG.md) for the exact device-visible title/body for each push kind, function-by-function trigger coverage, recipient rules, in-app versus push differences, delivery preferences, privacy guarantees and current gaps.

## Per-user notification preferences

Migrations `0009_notification_preferences.sql`, `0015_notification_activity_preferences.sql` and `0031_push_preview_and_debounce.sql` add user-scoped delivery settings and edit-debounce storage exposed through:

- `GET /api/notifications/preferences`
- `PUT /api/notifications/preferences`

Users can independently enable/disable push delivery for reminders, new shared notes, shared-note updates/deletions, calendar event changes and workspace membership/access changes. They can also choose detailed or generic lock-screen previews. Every account that existed at migration time is seeded with `generic`, including accounts without a previous preference row. Accounts created later, without a preference row, default to `detailed`. The durable in-app inbox is not affected by these switches. Activity caused by the current user is excluded from shared-workspace push delivery.

Quiet hours use the user's IANA timezone (default `Asia/Kuala_Lumpur`) and a local start/end time. Overnight windows such as 22:00–07:00 are supported. During quiet hours, activity push attempts are suppressed; they are not queued for later delivery. The corresponding in-app notification remains available in the inbox where that activity type creates one. Test pushes bypass quiet hours and category switches but still respect the global push-enabled switch.

Invalid time ranges, mismatched start/end values and unsupported timezone identifiers are rejected by the API. Preference updates require an authenticated session and same-origin request.
\n## iPhone-friendly Cloudflare setup\n\n1. Open `https://kitanotes.binalah.com/vapid-generator.html` in Safari and tap **Generate a new key pair**. Keep this page open until all three values have been copied.\n2. In Cloudflare Dashboard, open **Workers & Pages → kitanotes → Settings → Variables and Secrets**. Add `VAPID_PUBLIC_KEY` as a plain-text variable. Add `VAPID_PRIVATE_KEY` as a Secret. Add `VAPID_SUBJECT` as a plain-text variable, using an email address you control in `mailto:you@example.com` format.\n3. Save the settings and trigger a new production deployment so the Worker receives the new bindings. Do not paste the private key into GitHub, a source file, chat, or a screenshot.\n4. Confirm `GET https://kitanotes.binalah.com/api/push/public-key` returns `enabled: true` and a non-empty `publicKey`. This endpoint exposes only the public key.\n5. Confirm the production D1 migration history includes `0015_notification_activity_preferences.sql`. With Workers Builds, check that the deploy command is `npm run cf:deploy`; it runs `wrangler d1 migrations apply kitanotes-db --remote` before `wrangler deploy`.\n6. On iPhone, add KitaNotes to the Home Screen, open it from that icon, sign in, enable push and tap **Test**.\n\nThe browser generator is a convenience tool, not an admin endpoint. It uses Web Crypto in the browser and has no network call or storage code. Generating a replacement pair invalidates all existing subscriptions, so do not rotate keys unless you are prepared to ask every device to subscribe again.\n