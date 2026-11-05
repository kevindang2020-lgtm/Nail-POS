# Owner & Manager Payment App — Tap to Pay on iPhone, Backup Checkout

Kevin's mandate of Oct 13 2026 (224 sections). This document is the §224 A–Z report. The per-section ledger is
`scratchpad/w3/ledger-TTP.md`: COMPLETE 109, BUILT NOW 94, DECIDED 11, BLOCKED_EXTERNAL 9, NOT DONE 1.

The product follows one path: **Checkout Queue → Ticket Details → Tip/Split → Tap to Pay → Payment Success → Receipt & POS Sync → History/Reports.**
The app is a secure, tenant-isolated, real-time **secondary** payment terminal on the salon's ONE checkout. It is not a
second payment system.

---

## A. Existing payment code found

| Kind | What exists (reused) |
|---|---|
| App | `apps/manager-pay-web` (Capacitor 8, iOS project `ios/`, native bridge `ios-native/TapToPayPlugin.swift`, `MANAGER_TAP_TO_PAY.md`, `NATIVE_TAP_TO_PAY_INTEGRATION.md`) |
| Module | `modules/checkout/src/mobile-checkout` (service, controller, queue, ticket, proceed, tip/split, remaining balance, report, readiness, payment-attempt machine + repository, tap-to-pay session port, Fiserv CommerceHub TTP adapter, TTP config / onboarding / certification, mobile-pay-device registry) |
| Canonical checkout | `modules/checkout/src/checkout` (CheckoutService: pay / refund / void / receipts / `runPostPaymentWork`), `checkout-lock` (claims) |
| Terminal capture | `apps/api/src/customer-display/terminal-capture.service.ts` (`recordApproval`, the pattern the mobile recorder copies) |
| Payments | `modules/payments` PaymentGatewayResolver (tenant + branch merchant routing), CommerceHubClient, provider telemetry (PAYI) |
| Tables | `payments`, `payment_attempts` (549), `checkout_locks`, `mobile_pay_devices` (385), `ttp_onboarding`, `mobile_app_versions` (558), `payment_settlements`, `outbox_events`, `audit_logs` |
| Workers | payment-attempt sweep (POS terminal attempts — it EXCLUDED tap_to_pay), outbox publisher + consumers |
| Webhook | none for Tap to Pay (CommerceHub TTP webhook is BLOCKED_EXTERNAL — see X) |
| API | `/mobile-checkout/*` (tenant), `/super-admin/tap-to-pay/*` (SuperAdminGuard) |
| POS screens | POSCheckoutScreen (no awareness of phone claims before this wave) |
| Mobile screens | Login, Checkout Queue, Ticket, Tap to Pay, Success, History, Reports, Account |

## B. Problems found (and fixed)

- **P0 duplicate-charge risk.** No checkout-version check existed before mint or capture. The attempt amount was frozen when the attempt was created, so a POS change to the total could still be charged at the old amount. **Fixed:** `computeCheckoutVersion` and `CHECKOUT_VERSION_CONFLICT` now run at proceed, createAttempt and mint (see race §155). Twenty taps on the button emitted the intent event twenty times. **Fixed:** the claim is now taken first with a compare-and-swap, so there is one event and one provider call.
- **P0 tenant isolation.** No new hole was found. Wrong tenant and wrong branch are proven DENIED on real Postgres (race §161/§162).
- **P0 card data / security.** No PAN, CVV or track data is stored. Database CHECKs now refuse a `card_last4` that is not exactly 4 digits. The scan test reads the payments, attempts, audit and outbox tables.
- **P1 broken payment wiring.** `applyCaptureResult` only moved the attempt status. It never wrote a payments row, never marked the ticket paid, and never ran payroll, loyalty or gift-card work. On Postgres the SQL state machine always refused the move from `ready` to `confirmed`, so the capture never worked at all. **Fixed:** `MobileCaptureRecorder` now records money through the one canonical repository, and `runPostPaymentWork` runs once.
- **P1 device security.** Before this wave a device was bound only to the tenant: there was no user binding, no disabled or compromised state, and nothing revoked a phone when its user's employment ended. **Fixed** in migration 660, `mobile-pay-device.ts` and the revocation consumer.
- **P1 unknown-state recovery.** The sweep excluded Tap to Pay attempts, so nothing ever resolved an unknown result. **Fixed:** `mobile-attempt-recovery.ts` adds a scheduler that runs every 2 minutes and calls `port.lookupTransaction`. It never retries blindly.
- **P2 missing functionality.** The following were missing and are now built: POS claim display, takeover, relaunch recovery, Customer Handoff Mode, step-up, kill switches, production refusal of the mock provider, history filters, payout wording, device-health screens, the POS Mobile Payments card, Send to phone, asynchronous receipts, en + vi strings and the metrics.
- **P3 cleanup.** The History and Reports tests still targeted the old attempt-only screens and were rewritten. The inline confirm dialog was only rendered inside the payments card, so the cash part of a split could never be confirmed on a ticket that had no payments yet. **Fixed** in `TicketScreen.tsx`.

## C. Mobile app architecture

- **Authentication.** The app uses the shared `/auth/login` in the tenant realm. The tenant comes from the salon code, and the server derives role and permissions. On native the token lives in the Keychain; on the web it is an httpOnly cookie. Face ID is opt-in through mobile-sdk. AppLock adds a privacy cover and locks after 3 idle minutes.
- **Device trust.** On sign-in the phone registers and lands in `pending`. Only the owner (`pos.devices.manage`) or a Super Admin can set it `active`. The other states are `disabled` (can be re-approved), `revoked`, and `compromised` (the phone must re-register). Each device is bound to `bound_user_id` together with tenant, branch and device; any other user is refused with `DEVICE_NOT_AUTHORIZED`. Every money operation runs `assertDeviceTrusted`.
- **Branch.** The branch comes from the session. Queue, claims, history and devices are scoped to `ctx.branchId`. A branch-bound phone is refused at any other branch.
- **Branch switching (§119–§121).** More → Branch lists the locations from `GET /auth/branches`, which the server already narrows to the branches this person may enter (grants, home branch or template scope). A manager authorised for one location sees only that one, with nothing to switch. Switching uses the platform's ONE switch, `POST /auth/select-branch { branchId, deviceId }`, and there is no second session system. It is confirmed inline and re-signs the session; on native, `saveNativeSession` stores the new token. The app then announces `aps:branch-switched`, so the app-level principal, the data layer scope and the device registration all follow the new branch. The phone's `mobile_pay_devices.branch_id` moves with its bound user, and its status is unchanged.
- **"Finish or cancel first" (§120), enforced on the server.** Identity defines `BRANCH_SWITCH_GUARD` (`modules/identity/src/auth/branch-switch-guard.ts`). `AuthController.selectBranch` resolves it through `ModuleRef` (`strict:false`), so identity never imports checkout. `MobileCheckoutModule` provides it through `MobileCheckoutService.branchSwitchBlock`. A move to another branch (not the first pick after sign-in, and not re-picking the same branch) gets `409 PAYMENT_IN_PROGRESS` in two cases. The first is an unreleased, unexpired **mobile claim** in the current branch held by this user or this phone. Matching on the user means a client cannot bypass the check by omitting `deviceId`. The second is a **Tap to Pay attempt** on this phone that is `created` (not past its §132 expiry), in flight, or unresolved (`BRANCH_SWITCH_BLOCKING_STATES`). If the guard cannot answer, the switch fails closed with `503 BRANCH_SWITCH_CHECK_UNAVAILABLE`. The app also refuses locally when this install remembers an in-flight intent. The cross-branch refusals already in place still apply: the device gate (`assertDeviceTrusted`, device branch = session branch) and branch-scoped queue/claims/tickets.
- **Audit (§141).** A real move records `auth / branch_switched` with `fromBranchId`, `toBranchId` and `deviceId`.
- **Checkout queue.** It is the canonical `CheckoutService.getState`, live over SSE through the mobile-sdk query layer and stream invalidation.
- **Customer handoff.** See K.
- **Payment.** proceed (server total + version + step-up) → createAttempt (one intent per tender) → readiness → mint session → native reader → capture-result → server finalize → canonical money.

## D. Apple integration

- **Entitlement:** `com.apple.developer.proximity-reader.payment.acceptance`. This is **BLOCKED_EXTERNAL**: Kevin's Apple Developer account must request it, and Apple must approve it for the bundle id.
- **ProximityReader / PSP SDK:** the native reader runs inside the Fiserv Tap to Pay iOS SDK, which uses ProximityReader. That SDK is **BLOCKED_EXTERNAL**: Fiserv supplies it after merchant enrollment. Nothing is fabricated. The JS bridge (`MPW/native/tapToPay.ts`) only reports "available" when the native `TapToPay` plugin is registered on a device build.
- **Native module:** `ios-native/TapToPayPlugin.swift` returns the raw outcome only and contains no business logic (§208).
- **Capability checks:** `isTapToPayAvailable()` on the device and `GET /mobile-checkout/capability` on the server. The server checks readiness, the device, the app version, onboarding and the kill switches, and answers Ready, Setup Required, Unavailable on This Device, or Switched Off.

## E. Fiserv / Clover / CardPointe integration

- **Tap to Pay:** Fiserv **CommerceHub**. The code is `fiserv-commercehub-ttp.adapter.ts`, built on `CommerceHubClient` in `modules/payments`: the Security Credentials API mints the PaymentSession, the Charges API finalizes and verifies the charge, and an inquiry endpoint looks up a transaction for recovery. The client was implemented from Fiserv's published docs. It still carries VERIFY markers, because the field names must be confirmed against a real sandbox.
- **What is unavailable (BLOCKED_EXTERNAL):** the CommerceHub TTP credentials (`COMMERCEHUB_TTP_API_KEY`, `COMMERCEHUB_TTP_API_SECRET`, `COMMERCEHUB_TTP_MERCHANT_ID`, `COMMERCEHUB_TTP_TERMINAL_PROFILE_ID`, `COMMERCEHUB_BASE_URL`), the iOS SDK, merchant TTP enrollment for each salon, and certification.
- **Until those exist:** the adapter throws `TapToPayNotConfiguredError` / `TapToPayNotImplementedError` and the app shows "Setup Required". Production refuses to start with a mock or sandbox switch on (`tapToPayProductionProblems`).
- **Clover Compact and CardPointe terminal:** these stay the primary card-present path through PAYI's adapters. The phone is the backup.

## F. Merchant routing

`PaymentGatewayResolver.resolve(tenant, branch)` runs at createAttempt. The merchant account id is frozen on the intent. Tenant and branch are never read from the client: the API client refuses to send them, and `TenantAuthGuard` derives them.

## G. Checkout sync (POS → backend → mobile)

1. The POS edits the ticket in the canonical checkout.
2. The server emits realtime `checkout`-module events.
3. The phone's `useCheckoutStream` invalidates the queue and ticket queries.
4. A refetch replaces the data in place.

In the other direction, a phone claim, payment or release emits `checkout_payment_claimed`, `payment_approved` / `ticket_paid`, or `checkout_payment_claim_released`. The POS `useRealtime('checkout')` then refetches, and the new **Mobile Payments card** shows "Payment in progress on Kevin's iPhone · Kevin". Both sides keep the 15-second safety sync. Correctness never depends on that sync: the server refuses stale versions and claims held elsewhere.

## H. Payment claim (duplicate-payment protection)

- `checkout_locks` holds one active claim per ticket, from the POS, a phone or a display, with an expiry and a refresh heartbeat.
- A second claimant gets `CHECKOUT_ALREADY_CLAIMED`, with the holder's label.
- The POS pay paths refuse while a phone holds the ticket (race §153).
- Takeover needs `checkout.manage_overrides` and a reason, and it is audited.
- The intent row is idempotent on its key. Twenty concurrent taps produce one row, one provider call and one payment.

Worked example for the reports (§110). Tap to Pay card sales of $1,000 are **gross card sales**. The processor deposit (for example $970.10 after fees) appears as **Net Processor Payout** only once `payment_settlements` reports it. Until then the app says "gross sales are not a payout".

## I. Payment intent

Lifecycle (`payment-attempt-state.ts`): created → ready → (authorization_pending / authorized / confirmation_pending) → confirmed | declined | canceled | failed | timed_out | unknown | reconciliation_required.

- Every hop is a conditional `updateStatusIf`; a concurrent mover gets a conflict, never an overwrite.
- Idempotency key: one per tender intent. A repeated SDK callback replays the stored result.
- Fields (migration 660): provider, payment_surface, device_id, merchant_account_id, currency, checkout_version, processor_ref, card_brand, card_last4, payment_id, last_error_code, expires_at.
- An unused created or ready intent expires to canceled.

## J. Tap-to-Pay flow (exact sequence)

1. **Queue:** the manager opens a ticket. `POST tickets/:id/lock` claims it.
2. **Ticket:** tip and split are chosen. `POST proceed-to-payment` (with expectedVersion) returns `canProceed` + idempotencyKey, or a block: `STEP_UP_REQUIRED` (password prompt → `POST /auth/step-up` → proceed again), `CHECKOUT_VERSION_CONFLICT` (reload), or not ready.
3. **Intent:** `POST tickets/:id/payment-attempts` creates or returns the intent, and the app remembers it locally for relaunch.
4. **Readiness:** `POST payment-attempts/:key/readiness` checks the device, the kill switches and onboarding, then sets the attempt `ready`.
5. **Session:** `POST payment-attempts/:key/device-session` mints a CommerceHub session, re-checking version, balance and device.
6. **Tap:** the native reader runs (`captureTapToPay`).
7. **Result:** `POST payment-attempts/:key/capture-result`. The server finalizes with the provider. If verified, money is recorded on the canonical checkout and the outcome is `confirmed`. On no answer or a recording failure the outcome is `unknown` and the app goes to the Verifying screen.
8. **Success:** shows brand + last 4 + payment reference. The receipt is queued, and the POS and customer display update.

## K. Customer Handoff Mode (privacy)

- `HandoffScreen` shows only the salon name, the total, the tip choice and "Proceed to Payment".
- While the customer holds the phone (handoff, tap, verifying, success-in-handoff), `nav.locked` blocks tabs, back, history and other tickets, and the browser history is trapped.
- Leaving needs "Return to Staff": Face ID / passcode through `verifyDeviceOwner`.
- The tip choice stays private to the customer, and the success screen hides "Save to customer profile".
- AppLock's privacy cover hides the app in the app switcher.

## L. Split payment

Each tender is its own intent or payment:

- The cash part uses `POST tickets/:id/cash-tender` (idempotency key, canonical checkout).
- Each card part is its own Tap to Pay intent for the remaining balance.
- `summariseBalance` reports paid / in-flight / remaining. A declined card leaves earlier tenders in place (race §157/§158).

## M. Unknown payment recovery

- Unknown results come from a provider timeout, no finalize answer, or a recording failure after capture.
- The app shows "Verifying Payment — do not charge the customer again". It polls `verify` and never re-runs the reader.
- The server worker `MobileAttemptRecoveryScheduler` runs every 2 minutes as a single owner. It first expires stale intents, then calls `lookupTransaction` for each unresolved attempt:
  - approved → the money is recorded once, idempotent on the key;
  - declined → the attempt is declined;
  - not found past the release window → released;
  - no inquiry possible → wait, then `reconciliation_required` plus an alert.
- **Incident runbook:**
  1. Flip `payments.tap_to_pay` in the Kill-Switch Centre (System Status).
  2. Watch `aipowersalon_payment_events_total{event="unknown"}`.
  3. Resolve remaining `reconciliation_required` attempts with the processor reference (`reconcile`).
  4. Never mark a payment declined without the processor's answer.

## N. Receipt / Twilio

`POST tickets/:id/receipt` writes a `receipt.requested` outbox event. `receipt-delivery.consumer.ts` (TRANSIENT retry) calls the canonical CheckoutService receipt methods, which use the tenant's own communications domain: the tenant's Twilio subaccount for SMS, and email (PAYI internals). The app shows "queued" and flips to "sent" on the `receipt_sent` realtime event. A messaging outage never touches the payment.

## O. Refund / void

- Refund and void use the canonical engines: reason required, atomic cumulative cap, approvals rule above the salon limit, and processor-side refund or void through PAYI's adapters.
- Permissions: `pos.checkout.refund` and `pos.checkout.void`.
- `@Idempotent` plus one intent key per action.
- A ticket-level refund splits proportionally across the original tenders (Functional Decision 20).
- Void is offered only where the engine says the provider transaction is eligible.

## P. History / reports

- **History:** `GET /mobile-checkout/payments` reads the canonical `payments` rows: every surface, refunded amounts, status, brand / last 4, device label. Filters are range, status, method, device, employee, branch and surface.
- **Reports:** `GET /mobile-checkout/reports/sales` gives gross card, cash, other, refunds, tips, count, average ticket and by-surface figures. There is one row per sale; surface is a dimension, so nothing is double counted. Processor fees and net payout appear only when `payment_settlements` has data.
- The attempt funnel (`/reports`) is product analytics only.

## Q. Settlement / reconciliation

A Tap to Pay sale is an ordinary `payments` row (`payment_surface = 'tap_to_pay_iphone'`, `processor_transaction_id` = the CommerceHub reference) on the tenant's merchant account. It flows through the same settlement import and reconciliation (PAYI) as terminal card sales. No separate ledger exists.

## R. Security

- **Card data:** brand + last 4 only. The database refuses anything else in `card_last4`. The scan test covers payments, payment_attempts, audit_logs and outbox_events (race §166). The push only carries the ticket number.
- **Secrets:** CommerceHub credentials come from env or the Super Admin encrypted gateway settings only. The Super Admin screen shows "Present / Missing". No API returns a credential.
- **Devices:** trust states, user binding, remote revoke / disable / compromised (with an audited reason), revoke on employment end (`AUTHORIZATION_CHANGED` consumer), and minimum app version with force upgrade.
- **Tenant isolation:** server-derived context; another tenant's ticket returns "not found" (race §161).
- **Branch isolation:** ctx-branch scoping plus the device branch check (race §162, guards).

## S. Database

Migration **660_mobile_pay_intent_surface_and_device_trust.sql** is expand-only and idempotent:

- **payments:** adds `payment_surface`, `device_id`, `card_brand`, `card_last4`. CHECKs `chk_payments_payment_surface` and `chk_payments_card_last4`. Index `idx_payments_surface_device` (build CONCURRENTLY in production).
- **payment_attempts:** adds `provider`, `payment_surface`, `device_id`, `merchant_account_id`, `currency`, `checkout_version`, `processor_ref`, `card_brand`, `card_last4`, `payment_id`, `last_error_code`, `expires_at`. CHECK `chk_payment_attempts_card_last4`. Partial index `idx_payment_attempts_mobile_unresolved`.
- **mobile_pay_devices:** adds `bound_user_id`, `revoked_at`, `revoked_by`, `revoke_reason`, `last_payment_at`, `last_error_at`, `last_error_code`. The status CHECK widens to pending / active / revoked / compromised / disabled. Backfill: `bound_user_id = registered_by`. Index `idx_mobile_pay_devices_user`.

## T. APIs (added or changed in this wave)

**Tenant routes, `/mobile-checkout`:**
- `GET capability`
- `POST device/heartbeat`
- `POST devices/:id/disable`
- `POST devices/:id/compromised`
- `POST devices/:id/reassign` (step-up)
- `GET claims`
- `GET devices/status`
- `POST tickets/:id/send-to-device`
- `POST tickets/:id/lock/takeover`
- `POST tickets/:id/cash-tender`
- `GET payment-attempts/:key`
- `POST payment-attempts/:key/verify`
- `GET payments` (history)
- `GET reports/sales`

**Removed:** `GET /mobile-checkout/payment-attempts` (the attempt-only History list, which no screen calls any more; History now reads `GET payments`).

**Changed:** proceed-to-payment and payment-attempts now take `expectedVersion`; `GET /super-admin/tap-to-pay/tenants/:id/onboarding` also returns `pspEnrollmentStatus`, and its POST accepts that name; capture-result now records money; devices views carry health fields.

**Super Admin:** `/super-admin/tap-to-pay/*` is unchanged and now has the admin-web screen as its caller.

**New callers:** POS (`devices/status`, `claims`, `send-to-device`), owner-web (`devices`, approve / disable / revoke / compromised), Pay app (`/auth/step-up`).

**§120 follow-up (no new route):** `POST /auth/select-branch` now accepts an optional `deviceId`, consults `BRANCH_SWITCH_GUARD` before it moves a session to another branch (`409 PAYMENT_IN_PROGRESS` / `503 BRANCH_SWITCH_CHECK_UNAVAILABLE`) and audits `branch_switched`. The Pay app is a new caller of `GET /auth/branches` and `POST /auth/select-branch`.

## U. Events / realtime

- **Domain events (outbox):** CHECKOUT_PAYMENT_CLAIMED, PAYMENT_INTENT_CREATED, PAYMENT_UNKNOWN, PAYMENT_RECOVERED, RECEIPT_REQUESTED, MOBILE_PAYMENT_DEVICE_REGISTERED, MOBILE_PAYMENT_DEVICE_REVOKED.
- **Consumed events:** AUTHORIZATION_CHANGED (device revocation) and RECEIPT_REQUESTED (receipt delivery).
- **Realtime:** checkout_payment_claimed, checkout_payment_claim_released, payment_verifying, payment_recovered, mobile_pay_device_updated, checkout_sent_to_mobile, plus the existing payment_approved, ticket_paid, reports_updated and receipt_sent.

## V. Files changed (this wave)

**Backend:**
- `modules/checkout/src/mobile-checkout/{mobile-checkout.service.ts, mobile-checkout.controller.ts, mobile-checkout.module.ts, mobile-pay-device.ts, mobile-pay-device.kysely.ts, mobile-payment-attempt.repository.ts, payment-attempt-state.ts, mobile-remaining-balance.ts, tap-to-pay-session.ts, fiserv-commercehub-ttp.adapter.ts}`
- `modules/checkout/src/request-schemas.ts`
- `packages/api-contracts/src/{errors.ts, tenant/mobile-checkout.ts}`
- `packages/realtime-contracts/src/realtime-core.ts`
- `packages/events` (DOMAIN_EVENTS)
- `apps/api/src/events/consumers/consumers.module.ts`
- `apps/api/src/common/production-config.ts`
- `modules/super-admin/src/super-admin-kill-switches/kill-switches.ts`
- `packages/database` kysely types

**Pay app:** `apps/manager-pay-web/src/{App.tsx, shell/nav.tsx, shell/PayLayout.tsx, api/mobileCheckoutApi.ts, api/authApi.ts, i18n/catalog.ts, styles.css, screens/*.tsx + tests}`

**Contracts and baselines:** `packages/api-contracts/src/platform/index.ts`, `apps/api/openapi/route-types.baseline.txt` (retired GET payment-attempts), `modules/checkout/src/mobile-checkout/{mobile-checkout.list-queries.ts, ttp-onboarding.controller.ts}`

**POS:** `apps/pos-web/src/screens/POSCheckoutScreen.tsx`

**Owner:** `apps/owner-web/src/{App.tsx, shell/nav.tsx, screens/MoreScreen.tsx}`

**Super Admin:** `apps/admin-web/src/{App.tsx, shell/AdminLayout.tsx, shell/navPermissions.ts}`

## W. Files added

**Migration:** `apps/api/db/migrations/660_mobile_pay_intent_surface_and_device_trust.sql`

**Checkout module (`modules/checkout/src/mobile-checkout/`):**
- `mobile-capture-recorder.ts`
- `mobile-attempt-recovery.ts`
- `mobile-attempt-recovery.scheduler.ts`
- `ttp-kill-switch.ts`
- Tests: `mobile-money-wiring.vitest.spec.ts`, `mobile-guards.vitest.spec.ts`, `mobile-attempt-recovery.vitest.spec.ts`, `mobile-checkout.postgres-race.vitest.spec.ts`

**API consumers (`apps/api/src/events/consumers/`):**
- `receipt-delivery.consumer.ts`
- `mobile-pay-device-revocation.consumer.ts`
- Test: `mobile-pay-device-revocation.pgtest.vitest.spec.ts`

**Pay app (`apps/manager-pay-web/src/`):**
- `util/activeAttempt.ts`
- `lib/principal.tsx`
- `screens/HandoffScreen.tsx`
- `screens/ReturnToStaff.tsx`
- Test: `shell/nav.test.tsx`

**POS (`apps/pos-web/src/`):**
- `api/posMobilePaymentsApi.ts`
- `components/MobilePaymentsCard.tsx`
- Test: `components/MobilePaymentsCard.test.tsx`

**Owner (`apps/owner-web/src/`):**
- `api/ownerPaymentDevicesApi.ts`
- `screens/PaymentDevicesScreen.tsx`
- Test: `screens/PaymentDevicesScreen.test.tsx`

**Super Admin (`apps/admin-web/src/`):**
- `api/tapToPayAdminApi.ts`
- `screens/TapToPayAdminScreen.tsx`
- Test: `screens/TapToPayAdminScreen.test.tsx`

**Contract:** `packages/api-contracts/src/platform/tap-to-pay.ts`

**Doc:** `docs/payments/OWNER_MANAGER_PAY_APP.md`

## X. Provider dependencies (BLOCKED_EXTERNAL — Kevin / Apple / Fiserv)

1. **Apple:** the Tap to Pay on iPhone entitlement (`com.apple.developer.proximity-reader.payment.acceptance`) for the Pay app bundle id; the Apple Developer Program membership in the business name; an App Store review build that follows Apple's TTP marketing guidelines; and App Attest (optional hardening).
2. **PSP SDK:** the Fiserv Tap to Pay iOS SDK (ProximityReader-based), added in Xcode on a physical iPhone XS or later (`NATIVE_TAP_TO_PAY_INTEGRATION.md` §5).
3. **Fiserv credentials:** the CommerceHub TTP API key / secret, merchant id, terminal profile id and base URL, set in env or the Super Admin gateway settings; plus the webhook secret if webhooks are enabled.
4. **Merchant activation:** CommerceHub Tap to Pay enrollment for each salon MID. The Super Admin records it on the **Tap to Pay** screen (Apple = Approved, CommerceHub = Active).
5. **Certification:** a Fiserv sandbox certification run (harness `ttp-certification.vitest.spec.ts`), then a production test transaction ($1 sale + void).

## Y. Test results (Oct 13 2026, wave 3 final run)

| Suite | Result |
|---|---|
| modules/checkout `src/mobile-checkout` | PASS — 21 files / 163 tests (+8 race skipped without PG_RACE_URL) |
| Real-Postgres race lane (`PG_RACE_URL`, mobile-checkout.postgres-race) | PASS — 8 / 8 |
| modules/checkout full suite | PASS — 109 files / 717 tests (43 skipped) |
| apps/api `src/events/consumers` (incl. revocation pgtest 3, receipt consumer) | PASS — 8 files / 63 tests |
| apps/manager-pay-web | PASS — 15 files / 82 tests |
| apps/owner-web | PASS — 65 files / 335 tests |
| apps/admin-web | 174 / 175 files PASS — the 9 failures are all in `PaymentGatewayPanel.test.tsx` (PAYI's branch-merchant panel, not TTP); TapToPayAdminScreen 4 / 4 PASS |
| apps/pos-web (MobilePaymentsCard + POSCheckoutScreen) | PASS — 30 / 30 |
| tsc | api 0 errors · manager-pay-web · pos-web · owner-web · admin-web 0 errors |
| vite build | manager-pay-web · pos-web · owner-web · admin-web — all PASS |
| run-gates | TTP-relevant gates all PASS: tenant, tenant-builder, types-drift, unreached, dead-client, lint, response-exposure, realtime-contract, architecture. Still failing, NOT TTP-fixable here: the generators the lead runs (event-producers catalog, realtime catalog, openapi manifest, db-ownership registry, actor-columns), FLOW's two stale payroll lines in the route-types baseline, and `db credentials` (DEVELOPER_HANDOFF_2026-10-13.md) |

Mutation checks (`scratchpad/w3/mut-TTP.md`): 4 / 4 KILLED — handoff navigation lock, the inline cash-tender confirm, the revocation consumer's "only inactive users" guard, and the POS claim matching only the open ticket.

## Z. What is not done

- Everything in X waits on Apple and Fiserv.
- The generators the lead must run at integration: REALTIME_EVENT_CATALOG, docs/EVENT_CATALOG, the openapi manifest, the API inventory, the role matrix, the db-ownership registry (payment_attempts is now PAYMENT_RESTRICTED because of the 660 card metadata columns) and `gen-actor-columns` (660 adds `revoked_by`).
- `audit-response-exposure --update`: the attempts repository dropped from 5 to 1 whole-row reads. This is a SHRINK; left for the lead because PAYI has a pending REVIEW in the same baseline.
