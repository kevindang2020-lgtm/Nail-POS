# AIPowerSalon — Developer Handoff

Nov 5, 2026 · Kevin Dang

Live, editable version (status dropdowns, comments): https://claude.ai/artifact/LKXUW3PBgWvRDpYdWJ2g2d

The handoff package is the full repo; the last code commit is `6292cea`. It holds 16 commits on top of the code Kevin uploaded (base `fb3738c`): 457 files changed, about 7,200 lines added and 12,300 removed (mostly duplicate code moved into shared packages).

## Package contents

| File | What it is | Use it when |
| --- | --- | --- |
| `Power-Salon-main.zip` | The whole repo with git history. No `node_modules`, `dist` or build output. | Starting fresh: unzip, `npm ci`, build. |
| `power-salon-fixes.patch` | The seven commits as `git format-patch` output. | The team already has the repo at `fb3738c`: `git am power-salon-fixes.patch`. |
| `docs/handoff/DEVELOPER_HANDOFF_2026-11-05.md` | This handoff, kept beside the code. | Reading offline or in the IDE. |

Commits, oldest first:

| Commit | Summary |
| --- | --- |
| `02cbb1f` | Fiserv master build P0s: hosted-iFrame saved cards, no fake Tap to Pay, provider-assessed surcharge, production/host/branch gates, Bolt contract |
| `ca54b6c` | POS Card → Clover Compact; assign unassigned terminals; UAT run kit |
| `85a3161` | Module build unblocked; cross-server terminal cancel; unassigned-terminal deploy check |
| `d73c57d` | Surcharge enrollment gate and disclosure; UAT payments are test-only; UAT runner on Fiserv's validation form |
| `2bbfa2c` | Clean build passes end to end |
| `9fb6b66` | Cross-salon data leaks fixed; CI gate regressions, lint, error boundaries, Tap to Pay device-proof verifier |
| `54f02e7` | Failing app test suites fixed, plus the real bugs they exposed; native hardening; more gate fixes |

(The commit that adds this file sits on top of `54f02e7`.)

New migrations: 701 (payment gates), 702 (assign unassigned terminals), 703 (terminal lease cancel), 704 (`payments.is_test`). All are additive. Run `npm run db:migrate` before starting the API.

## Current status

All test suites pass and all eight frontends build. 2 of about 47 CI gates still fail (26 failed on the uploaded code); both depend on code that is not in this package (see "What the team must finish").

| Area | On the uploaded code | Now (Nov 5, 2026) |
| --- | --- | --- |
| pos-web tests | Timed out after 25 min (two files hung) | 340 files, 1,594 tests pass |
| admin-web tests | 7 failed | 1,032 pass (duplicate `http-core` test removed; it lives in ui) |
| customer-web tests | 27 failed | 254 pass (Face ID/WebAuthn copies and their tests moved to mobile-sdk) |
| owner-web tests | 5 failed | 275 pass |
| tech-web tests | 4 failed | 117 pass |
| customer-display tests | 2 failed | 201 pass |
| manager-pay-web tests | Passed | 60 pass |
| Packages and modules | Failures in ui, mobile-sdk, checkout, communications, queue | All pass |
| Clean build (`build:packages`, `build:modules` 26/26, `build:api`, 8 frontends) | Failed at `packages/auth` | Passes from empty `dist` folders |
| CI gates (`node tooling/ci/run-gates.mjs`) | 26 failed | 2 failed |
| Real-Postgres race lane (never run before) | Not run | 86 files, 295 tests pass |
| API suite | 24 failed | 3,008 pass |

The 2 gates still failing: `check:crosswire`, `check:unreached` (items 5–8). The evening sweep (`SWEEP_REPORT_2026-11-05.md`) fixed 14 more bugs, including `check:realtime-contract`.

## What was added and fixed

The biggest pieces are the Fiserv payment rules from the Master Build PDF, the POS-to-Clover Compact card flow, a UAT test kit, and closing cross-salon data leaks.

### Payments (Fiserv master build)

- **Saved cards:** Customer App has no card number or CVV fields anymore. Cards are entered in Fiserv's CardSecure hosted iFrame (origin- and source-checked `postMessage`), with separate stored-credential consent. The provider profile is verified (`PUT /profile`) before a card is stored. Every saved-card query is scoped to the tenant.
- **Tap to Pay:** the bridge never invents an approval; the server's `sbx_tap_` bypass is removed; a payment counts only when the approved amount matches exactly. New server verifier for device signatures: `modules/checkout/src/mobile-checkout/device-proof.ts` (P-256, 5-minute window, nonce store). It is tested but **not wired to routes yet**.
- **Surcharge:** off by default. No local percentage is ever added. A fee is charged only when the salon's switch is on **and** Fiserv has enrolled the merchant, at Fiserv's per-MID rate (100–300 bps), using the `fee_amount` the gateway returns. Debit, prepaid and unknown funding are never surcharged. Super Admin records enrollment at `POST /super-admin/merchant-accounts/:tenantId/surcharge-enrollment` (audited). The New Jersey disclosure (N.J.S.A. 56:8-156.2) shows on the POS card panel and the Customer App before the card is presented.
- **Safety gates:** provider host allowlist; UAT/production pairing checked when settings are saved and when they are used; `PAYMENTS_LIVE_MODE`; production rows need platform Fiserv validation, merchant boarding, verified credentials and production enablement; the terminal's merchant must match the branch; unassigned terminals are never used.
- **Bolt (Clover Compact):** `force:false`, implied-decimal amounts, `/api/v3/authCard` (v4 opt-in), cancel, disconnect, `listTerminals`, response amount check.
- **POS Card button** now charges the Clover Compact at that location (`POST pos/checkout/tickets/:id/pay/terminal`). It shows approved, declined, unknown, unavailable and in-progress states. An unknown result blocks a second charge until Verify Payment. Cancel-on-terminal works from any API server (migration 703).
- **Unassigned terminals:** listed in Devices with "Assign to this location" (audited). Pairing now requires a location. Migration 702 assigns them automatically for single-location salons. `npm run check:unassigned-terminals` (in `apps/api`) reports any left.
- **UAT payments are test-only:** migration 704 adds `payments.is_test`. Super Admin totals, analytics and daily summaries leave them out.
- **Webhooks** can no longer settle an unknown payment. Membership renewals need merchant-initiated (MIT) consent.

### UAT kit

- `npm run uat:cardpointe` (in `apps/api`) runs the scenarios from Fiserv's validation form. It refuses any non-UAT host. Evidence comes out as JSON and CSV with real retrefs and masked MID/HSN.
- `docs/integrations/fiserv-uat/REQUESTS-ryan-and-apple.md`: the questions for Fiserv (Ryan), the Apple Tap to Pay steps, and the run order.
- `docs/integrations/fiserv.md` and `docs/integrations/clover-compact.md`: integration notes.

### Security fixes (data across salons)

- The customer wallet (balance, transactions, customer lookup) now filters by tenant. A test proves another salon's data cannot be read; it fails on the old code.
- POS referral code lookup and customer-registration referral lookup are scoped to the salon.
- The customer app's guest mode could call the private `GET /customer/deals`. Only the public deal routes are allowed now.

### Bugs fixed

| App | Bug | Fix |
| --- | --- | --- |
| POS | Serving and Queue screens could request the same guest's detail endlessly and freeze | Detail is requested once per guest |
| POS | Shared-UI text (avatar tooltip) never translated to Vietnamese | Translations registered in `main.tsx` and the test setup |
| Owner | Cash summary crashed on a 403 | Shows only the access message |
| Customer | Face ID mismatch was treated as "cancelled" | Error codes follow the plugin's `BiometricAuthError` list |
| Customer | Find Salons offered Book Now on Google-only salons | Book Now only for partner salons; Google status and attribution shown |
| Customer | Register could not submit a typed salon code when no salon list loaded | Fixed |
| Customer | Settings toggles rebuilt on every change | Toggle moved out of the screen |
| Tech | Date-range button labelled "Refresh"; profile showed loaded photos, not the total | Correct label; server total |
| API | Announcements used event names that did not exist (no POS refresh) | Events added and projected |
| Build | `communications` module never finished building (20+ min) | Missing tables added to the DB type; builds in about 10 s |
| Admin | Memberships overview screen (plan and member detail) existed but no page linked to it | Now at Membership Programs › Members & Plans (`/membership-programs/members-and-plans`) |

### Mobile apps on the shared SDK (former items 9–11)

- **Transport:** customer, tech, owner and manager-pay `api/client.ts` are built on `createTransport` from `@aipowersalon/mobile-sdk` (`/api/v1`, bearer on native, timeouts, GET-only retry, localized errors). Raw upload `fetch` calls now use `api.upload`. Dev proxies forward `/api/v1`.
- **Realtime:** tech, owner and customer stream hooks use `@aipowersalon/realtime-client` (reconcile + fallback polling, bound to the session). manager-pay checkout queue gets live updates (`useCheckoutStream`). Sign-out closes the stream.
- **Deep links and push taps:** `@capacitor/app` added to the 4 apps; each app has `lib/mobile-shell.ts` (`createMobileShell`), and push taps route through it. The push hook is shared (`@aipowersalon/mobile-sdk/web-push`).
- **Face ID security fix:** apps no longer keep the user's password for Face ID. Face ID uses a server-issued biometric credential (enroll / login / revoke). App copies of Face ID, WebAuthn and secure-store code were deleted in favour of the SDK.
- **Shared types:** 161 frontend types that re-declared `api-contracts` now import them; 15 byte-identical copies (brand, `InlineConfirm`, `InlineAsk`, money input, `useEscapeKey`, `http-core`, branding client) now come from `@aipowersalon/ui`. Architecture test: 0 duplicates.
- **manager-pay wire bugs found by the shared types:** Account screen read readiness fields that do not exist (now `readiness.checks`); Ticket and Success screens read `customer.name`/`phoneLast4`, which the API never sends (now `fullName`, `initials`, `phoneMasked`). Before this, the phone always showed "No phone on file".

### Other

- **Native apps (customer, tech, owner, manager-pay):** release builds have no cleartext traffic and no backup; local networking is allowed only in debug builds; Android uses the `https` scheme; appIds corrected (`com.powersalon.technician`, `com.powersalon.owner`). Versions: customer 1.10.0, tech 1.7.0, owner 1.7.0, manager-pay 1.0.0; each Android versionCode raised by 1.
- **Error reporting:** six apps start error reporting and wrap the app in an error boundary.
- **Lint and gates:** 88 unused imports removed; lint baseline lowered; error codes, OpenAPI manifest, DB ownership, actor columns, state vocabularies, realtime catalog, list queries and dialogs regenerated or fixed.
- **Tests updated** where screens had been redesigned (booking flow, Find Salons, login, notifications, devices and others). Each updated test has a comment explaining the change.

## What the team must finish

Sixteen items remain. The P0 items stand between the code and real card payments. The P1 items are code that was built in a later session but is not in this package; ask Kevin for that newer package before rebuilding any of it.

| # | Priority | Item | Details | Owner |
| --- | --- | --- | --- | --- |
| 1 | P0 — blocks live payments | Fiserv answers | Send §1 of `REQUESTS-ryan-and-apple.md` to Ryan: Compact boarding and HSN, amount format, surcharge enrollment and rate, tip adjust, stored-credential fields, webhook signing, Tap to Pay PSP, production steps. | Kevin |
| 2 | P0 — blocks live payments | UAT run and certification | After item 1: run `npm run uat:cardpointe` on UAT only, hand Fiserv the JSON/CSV evidence, complete certification. | Dev team |
| 3 | P0 — blocks live payments | Tap to Pay on iPhone | Apple entitlement (§2 of the requests doc), native plugin in manager-pay iOS, then wire `device-proof.ts` into the mobile-checkout routes. | Kevin + dev team |
| 4 | P0 — blocks live payments | Production enablement | Production MID and keys through Fiserv's secure channel only; rotate UAT keys; enable in Super Admin. Production stays off until 2 and 3 pass. | Kevin |
| 5 | DONE (verified Nov 7: `check:crosswire` 0 orphaned calls; `/owner/finance` routes in modules/finance) | Finance / expenses server code | 22 Owner app calls to `/owner/finance` have no server route; nothing sent the `expense_updated` event (fixed Nov 5 for the existing `/owner/expenses` routes). Built in the later session (migrations 670–673). | Dev team |
| 6 | DONE (verified Nov 7: `/pos/payroll/paychecks` in modules/workforce payroll controller; `check:crosswire` 0) | Payroll paychecks | 31 POS calls to `/pos/payroll/paychecks` have no route (`PayrollPaycheckService`, migration 673). | Dev team |
| 7 | DONE (verified Nov 7: `check:crosswire` 0 orphaned POS calls; `PUT /pos/me/language` in apps/api/src/account/language.controller.ts) | Other POS calls with no route | Booking drafts (6), mobile-checkout devices (4), checkout (3), AI OCR receipt (3), serving (2), customers (2), customer verify (2), `PUT /pos/me/language` (the language switch does not save), tech earnings detail. Full list: `check:crosswire` (80 calls). | Dev team |
| 8 | DONE (verified Nov 7: `check:unreached` gate passes; remaining unreached routes are super-admin/customer/native and listed with --verbose) | Routes no screen uses | `check:unreached`: 40 newly dead POS/Tech/Owner routes, e.g. tech time-off, turn queue, profile photo showcase. Build the screen or put the route on the debt ledger. | Dev team |
| 9 | DONE | Apps onto the shared transport | `check:mobile-transport`: 23 raw calls (customer 8, owner 6, tech 6, manager-pay 3) must use `createTransport`. `check:v1-clients`: dev proxies must forward `/api/v1`. `check:realtime-infra-duplicates`: replace tech-web `useTechStream.ts` with the shared realtime client. | Dev team |
| 10 | DONE | Shared types and copies | Architecture tests: about 170 frontend types re-declare `api-contracts` types; 15 byte-identical copies (brand, WebAuthn, `InlineConfirm`, money input) belong in shared packages. Baseline is 0. | Dev team |
| 11 | DONE | Deep links | Mobile native config: declare `@capacitor/app` in the 4 Capacitor apps and wire deep links. | Dev team |
| 12 | P2 — review / cleanup | Vietnamese drafts | The two error messages in `errors.vi.ts` and the surcharge disclosure were **approved by Kevin on Nov 6**. One new draft is waiting: the POS "Turn on notifications" banner (`catalog.vi.ts`, keys `pos.pushPrompt.*`, marked DRAFT). | Kevin |
| 13 | P2 — review / cleanup | Native API default | Apps fall back to `https://app.aipowersalon.com:3000` when `VITE_API_BASE` is unset. Confirm the port, or set `VITE_API_BASE` in every native release build. | Kevin + dev team |
| 14 | P2 — review / cleanup | Android upgrade test | Android moved from the `http` to the `https` scheme. The WebView origin changes, so existing installs lose local storage and sign in again once. Test an upgrade on a real device before release. | Dev team |
| 15 | P2 — review / cleanup | Find Salons gaps | The redesign dropped the "Call" button and the cross-salon note; partner badge reads "Partner". Decide whether to restore them. | Kevin |
| 16 | DONE (verified Nov 7: `npm run lint` 0 errors, 0 warnings; baseline 0) | Small cleanup | Lint warnings still under baseline (78 unused vars, 59 hook deps); a stray comment in `apps/pos-web/src/api/posCheckoutApi.ts`. | Dev team |
| 17 | P2 — review / cleanup | Face ID re-enroll on upgrade | Face ID no longer stores passwords, so users who set it up before this build sign in with their password once and turn Face ID on again. After that, Face ID stays on through normal sign-outs (customer, tech, owner; Kevin's decision Nov 5, changes Constitution 6 §37 — see the sweep report addendum). Mention it in release notes; test on a real iPhone, including "sign out other devices" ending Face ID on the other phone. | Dev team |

## Rules the team must keep

No real card is charged until Fiserv certifies the integration, and production payments stay switched off until then.

- **No live transactions** before Fiserv certification. Run the UAT runner against UAT hosts only; it refuses anything else.
- **No secrets in evidence.** Never put a card number, CVV, password, merchant key, Bolt auth key or portal login in email, Postman, tickets, logs or screenshots. Use a private Postman environment. Rotate the UAT keys after they have been shared.
- **No flat surcharge.** Never add a fixed 3% or any local percentage. Only the fee Fiserv returns, only for enrolled merchants, never on debit or prepaid.
- **Production stays disabled** (`PAYMENTS_LIVE_MODE` off, no production enablement in Super Admin) until items 2–4 above are done.
- **Tenant scoping on every query.** Any statement on a tenant table filters by `tenant_id`. `check:tenant` and `check:tenant-builder` enforce it; add a baseline entry only after review, with a comment in the code.
- **Ratchets only go down.** Lint, response-exposure, error-code and debt-ledger baselines may shrink, never grow.
- **Vietnamese text** is reviewed by Kevin before release. Mark new Vietnamese strings as drafts.
- **Don't rebuild the lost code.** For items 5–11, get the newer package from Kevin first and merge it.

## How to build, test and check

Run these from the repo root unless the step says `apps/api`. A clean build from empty `dist` folders takes about 10 minutes; the full pos-web suite takes about 25.

```bash
npm ci
npm run db:migrate        # applies 701–704 (db:setup = migrate + seed + demo seed)

# build (in this order)
npm run build:packages
npm run build:modules     # 26 modules, ~3.5 min
npm run build:api
npm run build:frontends   # 8 apps
npm run typecheck

# tests
npm test
cd apps/pos-web && npx vitest run   # repeat per app

# CI gates (expect 2 failures until items 5–8 land)
node tooling/ci/run-gates.mjs
npm run architecture:test
cd apps/api && npm run -s check:crosswire   # any single gate

# payments
cd apps/api && npm run check:unassigned-terminals
cd apps/api && npm run uat:cardpointe        # UAT hosts only
```

If `pkill` is needed to stop a stuck test run, match the process id, not a pattern that also matches your own shell.
