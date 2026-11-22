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
   - `VAPID_SUBJECT`: a contact URI such as `mailto:you@example.com`, configured as a Worker variable.
3. Deploy the Worker and apply migration `0008_push_subscriptions.sql`.
4. Sign in on a supported browser, open Notifications and choose Enable push. Permission is requested only after the user taps the button.
5. Use Test to send a generic notification to the current device.

Never commit the private key or paste it into a chat or frontend environment variable. Rotating the VAPID key invalidates existing browser subscriptions; users must subscribe again.

## Privacy and delivery behavior

- Subscriptions are stored per authenticated user and endpoint. Each user can register up to 10 devices.
- The Worker accepts only HTTPS endpoints from known browser push-service domains to prevent arbitrary outbound fetches.
- Push payloads contain generic text and a same-origin path, never note content, event descriptions, invitation tokens or other private data.
- New shared notes and due reminders create durable in-app notifications first. Web Push is best-effort; the inbox remains the source of truth.
- Expired subscriptions (HTTP 404/410) are removed automatically.
- If VAPID is not configured, the app keeps working and the push controls report that push is not configured.
- Push delivery requires a secure origin and browser permission. On iOS/iPadOS, Web Push is available to web apps added to the Home Screen on supported OS versions.

## Scope boundaries

This release caches only the application shell and static assets. It does not cache private API responses, permit offline note editing, or promise delivery while a device is offline or push permission is denied.
