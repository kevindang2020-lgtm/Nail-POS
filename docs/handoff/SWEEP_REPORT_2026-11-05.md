# AIPowerSalon — Full Sweep Report

Nov 5, 2026 · Kevin Dang · commit `6292cea`

Every test suite, every CI gate, a real Postgres 16 database, a live API boot and the real-Postgres race lane were run against the whole repo. 14 real bugs were found and fixed. Two CI gates still fail, and both need server code from the missing "AI-PowerSalon POS 12" package.

## What was run

| Check | Result |
| --- | --- |
| API test suite (374 files) | 3,008 pass, 0 fail (was 24 failing) |
| 26 module suites | All pass (about 10,200 tests) |
| 20 package suites | All pass (1,204 tests) |
| 8 app suites | All pass (pos-web 1,594 · admin 1,032 · owner 275 · customer 254 · display 201 · tech 117 · manager-pay 60) |
| Real-Postgres race lane (86 files, never run before) | 295 pass (3 files failed at first) |
| All 612 migrations on real Postgres 16, run twice | Clean; the second run applies 0 |
| Seed and demo seed on real Postgres | Clean |
| Live API boot on Postgres | `/health` ok, `/health/ready` ready, schema version 704 with 0 pending and 0 drift |
| Every parameter-free GET route called as the owner (1,046 routes) | 0 server errors |
| Dependency injection graph | All providers resolve, no cycles |
| Schema vs DB types (`check:types-drift`) | 754 tables match |
| CI gates (`run-gates.mjs`) | 2 fail (was 3): `check:crosswire`, `check:unreached` |
| 49 extra API check scripts not in the gate runner | All pass except crosswire and unreached |
| Lint | 0 errors; unused-vars baseline lowered from 78 to 77 |

## Bugs found and fixed

| # | Where | Bug (what a user would see) | Fix |
| --- | --- | --- | --- |
| 1 | Customer app | Booking verification code could never be sent or checked: the app sent a `phone` field the server forbids, so every request got a 400. | The app sends only `bookingSessionId` (+ `captchaToken`) / `code`. The server takes the phone from the customer's record. |
| 2 | Customer app | When the fraud check asked for a captcha, the customer saw "Please complete the verification challenge" with nothing to complete. | New `lib/captcha.ts` shows the provider widget (Turnstile, hCaptcha or reCAPTCHA) and retries once with the token. It fails closed with a "call the salon" message if no captcha is configured. |
| 3 | Customer app | Edit Profile › "Verify my number" always failed with a 404 (the route had been moved on the server). | Now calls `/customer/profile/phone/verify-current/{request,confirm}`. |
| 4 | POS | The language switch never saved (`PUT /pos/me/language` did not exist), so the choice did not follow the user to another register. | Route added; it uses the same language service the Owner app uses and writes only the signed-in user's own row. |
| 5 | Owner + Customer apps | Every paid ticket sent the owner "Payment received" twice and the customer "Payment completed" twice. | The duplicate direct send was removed. The outbox consumer sends each one once, from the same transaction that marks the ticket paid. |
| 6 | All web apps | Browser push could not work: the CSP-safe service worker was never built into any app, and the old `firebase-messaging-sw.js` copies load Firebase from gstatic, which the apps' own security policy blocks. Tech and customer did not ship a worker at all. | The worker plugin is wired into pos, owner, tech and customer; it now builds as `/aps-push-sw.js`. The 3 stale copies were removed. The shared mobile-sdk push hook uses the new worker and handles its foreground and tap messages. |
| 7 | All static apps | The security headers files (`_headers`: CSP, HSTS, frame-deny and others) were missing from all 7 static apps. | Generated. FCM endpoints are allowed where push is used; captcha hosts are allowed for the customer app. |
| 8 | pos, owner, tech, customer, manager-pay | The app version was never stamped into the build, so error reports said "unknown". Turning on the Tap to Pay minimum-version check would have refused every phone. | The version plugin was added to every app (version taken from `package.json`). |
| 9 | Owner app | Expenses and Finance screens never refreshed live: nothing produced the `expense_updated` event. | New `expense.changed` domain event, written in the same transaction as the expense write and projected to `expense_updated` (ids only, no amounts). `check:realtime-contract` now passes. |
| 10 | All 4 mobile apps | Face ID and sign-out followed no consistent rule; remotely ending a session ("sign out other devices", Super Admin, a stolen refresh token) never ended Face ID on that phone. | **Decided by Kevin (changes Constitution 6 §37):** a normal sign-out and an expired session KEEP Face ID in customer, tech and owner; the sign-out confirmation offers "Also turn off Face ID on this phone". Migration 705 ends Face ID whenever a session is revoked for any other reason. Manager Pay (shared front-desk phones) keeps the strict rule: sign-out and 401 end Face ID. |
| 11 | Customer, tech, owner | The Settings screens decided "Face ID is on" from a storage flag that nothing ever sets. | They now read `isFaceIdEnrolled()` from the SDK. |
| 12 | Gift cards | Reload and void failed with a database error when there was no signed-in user (an empty user id was cast to uuid). Found by the race lane. | `created_by_user_id` / `issued_by_user_id` fall back to null. |
| 13 | Integrity monitoring | The tenant-consistency triggers on the platform-notice tables (migration 674) had no matching integrity check. | Two invariants added to `integrity-checks.ts`. |
| 14 | Deployment config | The deep-link variables (`APPLE_TEAM_ID`, `ANDROID_CERT_SHA256_*`, `APP_LINK_WEB_*`) were in no env template, so universal links would silently answer 404 in production. 20 other variables the code reads were also missing from `.env.example`. | Added to `.env.production.template`, `.env.production.example` and `.env.example`. Verified live: with them set, both `.well-known` files are served. |

## Tests and snapshots that were stale (updated, with the reason in the file)

- **Role matrix snapshot:** it had not been regenerated after the developer merge. I reviewed every change before accepting it. Managers can now record expenses for their own branch (mandate §77/§82, documented in `rbac.ts`). Customers and platform staff can now register for push (before, the customer app's push registration was refused). The new terminal routes carry the existing checkout permission.
- **OpenAPI manifest, event catalog, app versions:** regenerated or now read from `package.json`.
- **Tech profile cache test:** the test expected the profile to be publicly cacheable. It must not be: the profile is per-viewer (booked customers see `booked_only` links), so a shared cache would hand those links to the next viewer. `no-store` is correct and the test now pins it.
- **Validation error test:** the errors now carry a machine-readable `rule` field.
- **Two native-auth / transport guards:** they now look where the code lives after the SDK move. The property they check is unchanged.
- **Race-lane fake terminal:** it approved $50.00 when the service asked for $53.88 (tax included), and the service correctly answered "unknown". The fake now approves what it is asked for. A new test pins the partial-approval case: it must be "unknown", never "approved".

## Still open

| Item | Why it is not fixed here | Owner |
| --- | --- | --- |
| `check:crosswire` | 77 calls with no server route: POS finance/expenses (`/owner/finance/*`), payroll paychecks, booking drafts, mobile-checkout devices, AI OCR receipt, wallet top-ups, `/tech/earnings/detail`. This is the server code in the missing POS 12 package. Down from 80 (3 fixed above). | Dev team |
| `check:unreached` | Server routes no screen calls (tech time-off, turn queue and others). Each needs a screen or a debt-ledger entry. | Dev team |
| Fiserv / Apple / production | Unchanged: handoff items 1–4. | Kevin + dev team |

## How to reproduce

```bash
node tooling/ci/run-gates.mjs                       # expect 2 failures: crosswire, unreached
node tooling/ci/run-tests.mjs api|modules|packages|apps
# race lane: needs a migrated Postgres and trust auth for localhost (the test creates a password-less role)
DATABASE_URL=postgres://…/aps_race npm run db:migrate
PG_RACE_URL=postgres://…/aps_race node tooling/ci/run-race-tests.mjs
```

## Addendum — Face ID after sign-out (Nov 5, 11 pm)

Kevin decided Face ID stays on after a normal sign-out (as in banking apps). Commit `d74a353`.

| Situation | Customer / Tech / Owner | Manager Pay |
| --- | --- | --- |
| Normal sign-out | Face ID kept | Face ID ended |
| Sign-out with "Also turn off Face ID on this phone" ticked | Face ID ended (server revoke) | — |
| Session expired (401) | Face ID kept | Face ID ended |
| Session revoked elsewhere: sign out other devices, Super Admin, stolen refresh token, PIN lockout, access change | Face ID ended (migration 705 trigger) | Face ID ended |
| Password change, device revoked or blocked, account suspended, salon turns Face ID off, credential expired | Face ID ended (unchanged) | Face ID ended |
| A different person signs in on the phone | Previous person's Face ID cleared (unchanged) | Same |

How it works: `POST /auth/logout` revokes its own session inside a transaction that sets `aps.keep_face_id = 'on'`. Migration 705's trigger on `sessions` revokes the biometric credential for that user and device whenever a session becomes revoked without that flag. One trigger covers the 14+ code paths that revoke sessions. The flag is transaction-local, so it cannot leak to other requests on the same connection.

Proof: `biometric-auth.pgtest` (4 new tests, including a revoke on another phone leaving this phone alone), the same check run by hand on real Postgres 16, and `native-auth-coverage.vitest.spec.ts` now pins the new rule (mutation-tested: an unconditional `clearFaceId()` fails it).

## Addendum — notification permission from a tap (Nov 6)

Signing in no longer asks for notification permission in any app; the old prompt came too late to count as the person's click, so browsers blocked or hid it. A device that already allowed notifications registers silently as before. Otherwise a "Turn on notifications" banner (`EnableNotificationsBanner`, `@aipowersalon/ui`) shows one line on why, with **Turn on** (the system prompt, from the tap) and **Not now** (hidden on that device for 30 days). If the person refuses, it explains how to allow notifications in settings.

| App | Where the banner shows | Push client |
| --- | --- | --- |
| POS | inside the alert slot above every screen | `@aipowersalon/web-push` (`enable()`, `usePushPrompt`) |
| Super Admin | above every screen | `@aipowersalon/web-push` — **moved off the developer's own copy**, which prompted at sign-in, logged the token to the console and needed a gstatic worker the CSP blocks |
| Customer, Tech, Owner | top of the app | `@aipowersalon/mobile-sdk/web-push` (`enablePush`, `usePushPrompt`) |
| Manager Pay | under the header | its own native push (`enablePush`) |

Also: the two leftover copies (`admin-web` and `pos-web` `hooks/useWebPush.ts`) were deleted. Admin's headers now allow the push endpoints, and admin builds the shared push worker. POS and Super Admin browser push stay off until the build sets `VITE_FIREBASE_WEB_CONFIG` + `VITE_FIREBASE_VAPID_KEY`; this is now noted in the production env files.

Tests: the mobile SDK proves sign-in never prompts (undecided: no prompt and no registration; already allowed: silent registration; banner tap: prompt, then registration). Banner tests, `enable()` tests, and every app suite pass (POS 1,594, admin 1,032, customer 254, owner 275, tech 117, manager-pay 60). One POS layout test caught the banner breaking the 3-row grid; it now sits inside the alert slot.

## Addendum — Vietnamese (Nov 6)

Kevin approved the three Vietnamese drafts: `errors.PROVIDER_HOST_NOT_ALLOWED`, `errors.LOCATION_REQUIRED` and `payment.surcharge.disclosure`. The POS "Turn on notifications" banner is now translated (`pos.pushPrompt.*` in `catalog.en.ts` / `catalog.vi.ts`) and follows the language switch. Its Vietnamese text is marked DRAFT for Kevin's review. The other apps have no Vietnamese mode yet, so their banner stays in English.

## Addendum — the POS signed people out after ~15 minutes (Nov 6) — FIXED

**Cause:** the access token lives 15 minutes (`AUTH_ACCESS_TTL`) and is meant to be renewed silently through `POST /auth/refresh`. The renewal code (`installAuthRefresh`, `packages/api-client/src/auth-refresh.ts`) was built in October but **no app installed it**, not even in the uploaded code. So 15 minutes after a sign-in, the next request got 401 and the app returned to the login screen, however busy the person was. Picking a branch issued a 12-hour token instead, which is why some sign-ins lasted longer. The phone apps also threw away the refresh token at sign-in, so they could not have renewed either.

**Fix:** all six apps (POS, Super Admin, Owner, Tech, Customer, Manager Pay) install the renewal in `main.tsx` before anything fetches; the phone builds renew with the Keychain token pair. The phone sign-ins now keep the refresh token.

**Proof (live API, access token set to 60 s):** before, a request at 70 s → 401 (signed out). After, 200 at 70 s and at 140 s, and a real sign-out still ends the session (401 afterwards). The guard test `apps/api/src/common/auth-refresh-installed.vitest.spec.ts` pins the wiring. All app suites, gates and builds pass.

**What still signs people out, on purpose:**

| Rule | Default | Who can change it |
| --- | --- | --- |
| POS idle **lock** (PIN screen, not a sign-out) | 60 min without activity | Owner: 5–120 min for the salon; each device may choose shorter |
| Locked longer than 8 hours | Full sign-in | Fixed (Decision 35) |
| 5 wrong PINs on the lock screen | Full sign-in | Fixed |
| Session lifetime | 12 h from sign-in; 30 days with "Remember me" | `AUTH_SESSION_TTL` / `AUTH_SESSION_TTL_REMEMBER` |
| Super Admin session | 8 h, "Remember me" ignored | `AUTH_SESSION_TTL_SUPER_ADMIN` (max 12 h) |
| Security events | Immediately | Sign out other devices, Super Admin ending a session, password change, access changed or suspended, stolen refresh token |

## Addendum — fewer sign-outs on busy days (Nov 6)

Two more ways a busy salon got signed out, both fixed:

| Cause | What happened | Fix |
| --- | --- | --- |
| Two POS tabs (or a reply lost on Wi-Fi) renewing at the same moment | The second renewal presented an already-used key; the server treated it as stolen and ended the whole session, with no grace period | A key reused within 30 s of its rotation (`REFRESH_REUSE_GRACE_SECONDS`, 0 = strict, max 120) gets an extra valid key for the same session and nothing is retired; after 30 s reuse is still treated as theft and ends the session (and Face ID, migration 705). Covers both the "already replaced" path and the exact-same-instant race. |
| A Wi-Fi blip or server restart during renewal | Any failed renewal signed the person out | No answer or a 5xx is retried twice (after 1 s and 3 s). Only a clear "no" from the server ends the session. |

Proof: unit tests (two tabs, a lost reply, outside the window, grace off, settings); real Postgres 16 (two tabs at the very same instant both stay signed in and both keys renew later; with grace off the strict 10-way replay test still burns the family); the client retry tests. Race lane 295/295, identity 552, API auth 1,409, gates unchanged.
