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
| 10 | All 4 mobile apps | A 401 (session revoked) or a sign-out did not remove the Face ID device credential. | `clearFaceId()` now runs on 401 and on sign-out in customer, tech, owner and manager-pay. |
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
| Push permission prompt | The shared push hook asks for notification permission on sign-in, not on a user tap. Browsers may block or penalise this. Suggest moving it behind a button. | Dev team |
| Face ID after sign-out | By design (SDK `clearFaceId`), signing out removes the Face ID credential, so users sign in with their password and turn Face ID on again. Confirm this is the behaviour you want. | Kevin |
| Fiserv / Apple / production | Unchanged: handoff items 1–4. | Kevin + dev team |

## How to reproduce

```bash
node tooling/ci/run-gates.mjs                       # expect 2 failures: crosswire, unreached
node tooling/ci/run-tests.mjs api|modules|packages|apps
# race lane: needs a migrated Postgres and trust auth for localhost (the test creates a password-less role)
DATABASE_URL=postgres://…/aps_race npm run db:migrate
PG_RACE_URL=postgres://…/aps_race node tooling/ci/run-race-tests.mjs
```
