# Phone Number Management — build record (guide 9 of 15)

Guide: *AI PowerSalon Phone Number Management — Claude Complete Build Guide* (Oct 30 2026). Route kept: `/tenant/customers/phone-management`
(Customers → Phone Number Management). Built 31 Oct 2026 on HEAD `cfff24fd`. Local commit only — nothing pushed, deployed, sent or charged.

**Scope note.** This guide is about changing a **customer's** phone number safely (pending → verified → active). It is not
about buying or porting Twilio numbers. No phone number was bought, released or ported; no Twilio setting or webhook was touched.

## What already existed (audit, guide §14 phase 1) — and was kept

| Piece | Where | State before this build |
|---|---|---|
| Change state machine (Requested → pending → code sent → verified → activated → synchronised; failed / expired / cancelled; manager review; duplicate conflict) | `modules/booking/src/customer-phone/customer-phone-core.ts` | complete, pure, unit-tested |
| Atomic activation (version check, old row `replaced`, new row active, customer row moves, outbox event), manual exception (`staff_override`, never "verified"), approve, resolve duplicate, retry sync, cancel | `customer-phone-update.service.ts`, `customer-phone.kysely.ts`, `customer-phone.controller.ts` (`pos/customers/:customerId/phone/*`) | complete |
| Six-digit challenge (hashed, 10 min, 5 tries, 60 s resend cooldown, tenant's own Twilio Verify or own sender, never the platform's) | `customer-booking/booking-verification.service.ts` via the `PhoneVerificationPort` | complete |
| Durable sync retry (`customer.phone.sync` job, 8 tries, dead-letter) + expiry job | `customer-phone-sync.scheduler.ts` | complete |
| DB backstops: one open change, one pending, one active number per customer; idempotency key | migration 373 | complete |
| The seven screenshot controls (+ manager approval, re-authentication), branch overrides | `customer-phone-settings.*`, table `tenant_customer_phone_settings` | complete; **the screen showed only these** |
| Customer App self-service | `customer-phone-app.controller.ts` (`customer/profile/phone`) | complete, untouched |

So the gap was the guide's management surface: KPIs, health, Pending & Recovery, history with search / calendar / pages, the change
overlay and the sync monitor — plus the old-number notice not being linked to its change.

## What this build added

| Item | Files |
|---|---|
| Read model — KPIs (each with its source), verification & sync health (sender readiness without secrets; "connected" never = "verified"), Pending & Recovery (live deadlines first → expired → sync work), history (newest first, created_at DESC + id DESC), sync monitor (the job's real state), overlay detail (trusted vs proposed, tries left, resend timer, code expiry, notice status, recent changes, server-computed allowed actions), customer finder | `modules/booking/src/customer-phone/phone-center.ts`, `phone-center.controller.ts` (`GET pos/customer-phone-center/{summary,health,requests,requests/:id,pending,sync,customers}` — read only), wired in `customer-phone.module.ts` |
| Old-number notice linked to its request | `customer-phone-notify.ts` (+`sessionId`), `customer-phone-update.service.ts` (passes it), `packages/notifications/src/tenant-messenger.ts` + `notifications.kysely.repository.ts` (source type `phone_change`) |
| Migration **742** (additive): `ck_notifications_source_type` gains `phone_change`; indexes `idx_cpus_tenant_created`, `idx_cpus_tenant_open_expiry`. Rollback: drop the two indexes, restore the previous constraint list | `apps/api/db/migrations/742_phone_management_center.sql` — applied twice (idempotent) to the local `aps` template only |
| POS screen rebuilt in place: header actions (Update Phone · Check Verification Health · Refresh), six KPIs, Phone Settings (every original control, unchanged behaviour) beside Verification & Synchronization Health, tabs Pending & Recovery / Phone Change History / Sync Monitor, server search, status / source / method / shared / sync filters, PeriodBar (Today · Week · Month · Year · Custom month calendar) with date basis Requested / Verified / Applied / Failed / Audit, numbered pages with 10/20/50, the change overlay with Close, the Update Phone dialog with a review step | `apps/pos-web/src/screens/PhoneManagementCenter.tsx` (new), `POSCustomerPhoneSettingsScreen.tsx` (now `PhoneSettingsPanel`), `api/posPhoneCenterApi.ts`, `i18n/ns/phonemgmt.{en,vi}.ts`, `App.tsx`, `styles.css` |
| Export | `RESEND_COOLDOWN_SECONDS` from `@aipowersalon/customers` |

Decisions:
- **No new writes, no second engine.** Every change still goes through the existing `pos/customers/:customerId/phone/*` routes.
- **Masked numbers; re-entry required.** The list and overlay show masked numbers. Sending or checking a code needs the new number typed again, and the server already refuses a mismatch (`PHONE_UPDATE_MISMATCH`). No full number and no code ever appears in a list or response.
- **Permissions use the guard's own rule** (`hasPermission`), not literal names. A literal match hid owner actions in the Deals build.
- **Pending & Recovery order:** requests that can still be saved come first, soonest deadline first. Already-expired requests come next, then failed syncs. History stays newest first.
- **URL state** holds the tab, filters, period, page and size. The search text is never put in the URL.
- **Customer-message language — RESOLVED (owner rule applied Oct 31 2026, guide 10 commit):** the earlier note here was a misreading. `customerMessageLanguage()` (`packages/api-contracts/src/language.ts`, pinned by `customer-language.test.ts`) **always answers `'en'`** — the owner's Oct 28 2026 ruling that every customer message is English — so the old-number notice was already English for every customer at runtime; its Vietnamese branch was unreachable. That dead branch and the unused language lookup were removed from `customer-phone-notify.ts`; `old-number-notice-language.vitest.spec.ts` (English for a customer marked Vietnamese) passes 1/1. Customer-facing SMS/email in the phone-change and booking-verification flows are English only; the POS staff UI stays EN+VI.

## Tests (31 Oct 2026, cloud workspace, PostgreSQL 16 + unit stand-in, Chromium)

| Suite | Result | Notes |
|---|---|---|
| `phone-center.pgtest` | **13/13** | Covers:<br>• trusted number unchanged while pending, failed or expired<br>• right code → one active number<br>• newest-first history<br>• search beyond page 1 by name, digits, request id and staff name<br>• soonest-deadline queue<br>• salon-timezone custom range and refusing a reversed range<br>• sync monitor: Retry Scheduled → Failed from the job<br>• manual exception never shown as SMS verified<br>• shared family number counted and never merged<br>• notice: not recorded → submitted → delivered<br>• readiness: not configured → unchecked, with no secret in the answer<br>• tenant isolation (404, search can't reach the other salon) |
| `phone-center.postgres-race` | **4/4** | Real PostgreSQL with 4 sessions, 8 concurrent attempts each:<br>• one open request<br>• one pending number<br>• one active number<br>• one idempotent request |
| Regression | all pass | `customer-phone-core` 32/32, `-policy` 15/15, `-settings` 14/14, `-update.service` 25/25, `-no-sms` 6/6, `old-number-notice-language` 1/1, `customer-identity-phone` 16/16, `-http` 2/2, `customer-phone.pgtest` 9/9, `customer-notifications.pgtest` 18/18 |
| Browser E2E `interact.mjs pm-e2e pm` | **10/10** | Screenshots in `tooling/catalog-one-screen/results/pm-e2e/`. Covers:<br>• the 7 controls equal the saved values; one setting persists after reload<br>• the KPIs equal the database<br>• Pending & Recovery order; history pages 1 2 3 and 10/20/50<br>• server search, not written to the URL<br>• calendar and date basis<br>• overlay: keep-active banner, masked numbers, no code<br>• Update Phone → pending (old number still active) → wrong code keeps it → 123456 activates once → old-number notice "Submitted"<br>• expired request, manual exception, sync monitor<br>• Front Desk: policy read-only, no Approve<br>• Vietnamese labels with identical KPIs<br>• 1920×945, 1536×864, 1440×900, 1366×768 and 1024×768 with no sideways scroll; Close reachable |
| Combined marketing + notifications + phone E2E (seg, cp, do, promo, cc, mg, mt, cn, pm) | **113/113** | one known page error "not in the harness" (Marketing & Growth tiles the harness cannot serve) |
| Gates | **57/61 pass, 0 fail** | 51 via `npm run check:*`, plus 6 through the stand-in: sql-prepare, types-drift (857 tables), sql-identifiers, db-ownership (857), unique-tenant-review (111), actor-stamp (364).<br>The first run flagged `tenant`, `silent-catch` and `as-any` on the new file; all were fixed in code, none baselined.<br>4 can't run here: lint, boot, api-contract, strict-bodies-types. |

## Handoff status (guide §16 labels)

| Item | Status |
|---|---|
| Seven settings preserved, persisted, access-controlled | COMPLETED_AND_VERIFIED (E2E, settings suite) |
| No unverified pending number replaces the trusted one | COMPLETED_AND_VERIFIED (pgtest + E2E + DB race backstops); service-level races `customer-phone.postgres-race` IMPLEMENTED_NOT_VERIFIED here (query builder → CI) |
| Six-digit code checked server-side; never in logs / responses / UI | COMPLETED_AND_VERIFIED for the center (pgtest asserts no code in the detail; E2E asserts none on screen); provider path unchanged |
| Pending & Recovery, history, sync monitor, overlay, search, calendar, pages | COMPLETED_AND_VERIFIED (pgtest + E2E) |
| Manual exception never "SMS verified" | COMPLETED_AND_VERIFIED |
| Old-number notice: submitted vs delivered from the ledger | COMPLETED_AND_VERIFIED (harness fake messenger; real delivery receipts BLOCKED_EXTERNAL) |
| Service flow start → send → verify → activate through the real store | IMPLEMENTED_NOT_VERIFIED here: `customer-phone-flow.pgtest` 4/35 and `customer-phone.postgres-race` 0/3 fail only with "query builder is not available" (same on unchanged HEAD); the E2E drives the same service through a raw-SQL outbox writer and passes |
| POS / API type-check, `PhoneManagementCenter.test.tsx`, `POSCustomerPhoneSettingsScreen.test.tsx` | IMPLEMENTED_NOT_VERIFIED (CI) |
| `customer-phone-bypass.vitest.spec.ts` | FAILS here on unchanged HEAD too (the spec reads a wrong relative path `/home/modules/...`) — environment, not a regression |
| Real Twilio Verify delivery, salon region permissions, staging screenshots, physical ASUS 27″ at 100% zoom | BLOCKED_EXTERNAL / not tested (browser viewports only) |
| Migration 742 on staging / production | BLOCKED_EXTERNAL (owner approval) |
| Platform identity sync | Existing `GlobalIdentityPort.applyVerifiedPhone` + `customer.phone.sync` job; the monitor reads them. A real identity-service outage drill on staging is BLOCKED_EXTERNAL |

## Hand-offs to the next guides
- **Booking Phone Verification (guide 10):** this build doesn't change how a booking code is issued or checked. An activated change already revokes the old number's booking trust (`booking_verified_phones.revoked_at`).
- **Text Messaging Setup (guide 11):** the sender readiness shown here reads `tenant_messaging_credentials`, which that guide owns (Verify service, sender, A2P). The readiness states are the place to plug in its checks.
- **Appointment Reminders / Follow-ups / Email:** they read the customer's current number. A change activates atomically, so no pending number is ever messaged (`canReceiveSms` allows active statuses only).

## Open owner decisions
1. ~~Old-number notice language~~ — resolved: English only, per the standing owner rule (see Decisions above).
2. Under the existing role policy Front Desk can start, send and verify changes but not change the policy. Keep that?
3. Should the overlay show the full proposed number to owners/managers? Today it's masked for everyone, and staff re-type the number to send or check a code.
