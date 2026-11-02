# Push / Notification Delivery Layer

Adds **push delivery** on top of the existing in-app notification tables. Before this, the app stored in-app
notifications (`customer_notifications`, `technician_notifications`) but had **no device-token registry and no way to
actually push** to a phone. This layer fills that gap with a pluggable provider so a real service (FCM/APNs) drops in
with one env var.

## Pieces

- **Migration `075_device_push_tokens.sql`**
  - `device_push_tokens` — one row per physical device token (`tenant_id` nullable, `user_id`, `platform`
    ios/android/web, `token` UNIQUE, `app`, `last_seen_at`, `revoked_at`). Re-registering a token re-points it at the
    current user and clears any revocation (upsert on the unique `token`).
  - Extends `notification_delivery_logs.channel` to allow `'push'` (was `sms`/`email`), so push attempts are logged in
    the same place as SMS/email — with the token **masked** (`***<last6>`), a status, a provider id, and any error.

- **`src/push/`**
  - `push.types.ts` — `PushProvider`, `PushMessage`, `PushSendResult`, `DispatchSummary`.
  - `push-providers.ts` — `MockPushProvider` (default; no network, returns a synthetic id so delivery is logged as
    sent), `FcmPushProvider` (Firebase legacy HTTP, server key — implemented, **inert until configured**), and
    `selectPushProvider()` which returns FCM when `FCM_SERVER_KEY` is set, else the mock.
  - `push.repository.ts` / `push.kysely.repository.ts` — registry + delivery logging (in-memory + Postgres adapters).
  - `push.service.ts` — `register`, `unregister`, and **`dispatchToUser(tenantId, userId, message)`** which fans the
    message out to all of a user's active devices, logs each attempt, and **never throws** (safe to fire-and-forget).
  - `push.controller.ts` — `POST /push/register` `{ platform, token, app? }` and `POST /push/unregister` `{ token }`,
    authenticated via the global middleware (a user may only register tokens for themselves).

## Plugging in real FCM

1. Set `FCM_SERVER_KEY=<your server key>` in the API environment. `selectPushProvider()` then returns the FCM adapter
   automatically — no code change. (For the FCM HTTP **v1** API, swap `FcmPushProvider` to use a service account + OAuth
   token instead of the legacy server key; the `PushProvider` interface stays the same.)
2. The mobile apps call `POST /push/register` with the device's FCM/APNs token on login / token refresh, and
   `POST /push/unregister` on logout.

## Sending a push from a notification site

Inject `PushService` (exported by `PushModule`) and call it alongside the existing in-app write — best-effort:

```ts
// after creating the in-app notification (e.g. repo.notifyUser({...})):
await this.push.dispatchToUser(tenantId, userId, { title, body, reference: 'leaderboard' });
```

`dispatchToUser` returns `{ tokens, sent, failed, provider }` and logs every attempt to `notification_delivery_logs`.
Because it never throws, the surrounding action (booking, rank recompute, etc.) is never put at risk.

**Live integration:** push is wired into **every NailShowcase notification**, each using `PushService` as an optional
constructor dependency (so the services still run anywhere they're constructed without push):
- **Rank milestones** — entering/dropping out of the Top 10 / Top 20 (`NailShowcaseRankingService`).
- **Post engagement** — your post was liked, a new comment, your post was hidden by a manager, your post was approved
  (all routed through the central `NailShowcaseService.notify()` helper).
- **Follow** — "X started following you" (`NailShowcaseSocialService.follow`).

It's also wired into **customer self-booking** (`CustomerBookingService`): a successful booking pushes "Appointment
booked" and a successful reschedule pushes "Appointment rescheduled" to the customer's devices, dispatched after the
atomic commit (the in-app notification is written inside that transaction; the push is best-effort on top).

Each writes the in-app notification first, then dispatches a push to the recipient's registered devices, best-effort.

## Verified

- **11/11** unit tests (`src/push/push.vitest.spec.ts`): provider selection, register/revoke/dedup, fan-out + logging,
  failing-provider records `failed`, throwing-provider survives, no-op for a user with no devices.
- **5/5** NailShowcase wiring tests (`src/nail-showcase/nail-showcase-ranking-push.vitest.spec.ts`): a Top-10 crossing
  and a new follow each fire both the in-app notification and a logged push; no device → no delivery + no error; push is
  optional. **3/3** booking wiring tests (`src/customer-booking/customer-booking-reschedule.vitest.spec.ts`): a booking
  and a reschedule each push to the customer; no device → no delivery + no error.
- **6/6** live against Postgres (Kysely adapter): two tokens registered, re-register dedups, `dispatchToUser` →
  `sent=2`, two `channel=push` rows logged with masked target + provider id + status, unregister revokes.
- **HTTP**: `POST /push/register` → 201, bad platform → 400, unauthenticated → 401, row stored, `unregister` → 201.


## Browser push for the desktop apps (developer merge, Oct 12 2026)

The developer's Oct 6 tree added web push to admin-web / owner-web / pos-web as three copies of a `useWebPush.ts` hook +
a `firebase-messaging-sw.js` (Firebase config and VAPID key hard-coded; the token POSTed to an **unauthenticated**
`/public/push/register` with a client-chosen tenant / user / role; the prompt on every page load; `alert()` for
foreground messages; the SW pulling the SDK from gstatic, which the apps' `script-src 'self'` policy blocks). It also
shipped `apps/api/firebase-admin.json` — a real service-account private key — and a `PushNotificationsModule` that
`require()`d it from the working directory. None of that was merged.

What exists instead:

- **`packages/web-push`** — `createWebPushClient` (the browser twin of the mobile-sdk push client: permission never at
  page load, registration through the authenticated `POST /push/register { platform: 'web', token, app }`, token rotation
  hands the old one back, sign-out unregisters) + `sw.js` (plain Web Push: shows a background push, posts a foreground
  one to the page) + `WebPushToast` (the in-app surface). The Firebase JS SDK is loaded on demand only when configured.
- **`tooling/vite/web-push-sw.mjs`** serves the one worker at `/aps-push-sw.js` (dev + build) for every app that opts in.
- **Wired:** pos-web (`app: 'pos'` — receives only uncategorized pushes) and owner-web in the browser (`app: 'owner'`;
  the native build keeps the Capacitor client). admin-web is NOT wired: no push category targets the platform console.
- **Config (build time):** `VITE_FIREBASE_WEB_CONFIG` (the console's web-app config as JSON — public identifiers) and
  `VITE_FIREBASE_VAPID_KEY`. Unset → inert. The generated `_headers` CSP allows the two Google token endpoints only for
  the apps that import the client (`apps/api/scripts/generate-app-headers.mjs`).
- **Server:** nothing new — `FcmV1PushProvider` already delivers to `platform: 'web'` tokens. **Kevin:** the private key
  the developer committed as `firebase-admin.json` is the value of `FCM_SERVICE_ACCOUNT_JSON` (or `_B64`) — set it in the
  API environment, never in the repo, and **rotate it** (the key was in a shared zip).
