# MODULE_INVENTORY.md — every domain module, app and package: what it owns and its status (FullSystemTest.pdf §1, Appendix D)

Date 2026-10-28 · code `07e599ea` (`merge-github-main`) · generated from the repository (`git ls-files`, each `src/` tree, the
route manifest) plus this run's unit sweep (`TEST_RESULTS.md` §4). Older, prose inventories: `CODEBASE_INVENTORY.md`,
`COMPLETE_CODEBASE_INVENTORY.md`, `APPLICATION_MAP.md`, `MODULE_WIRING_MATRIX.md` — this file is the current census.

**Scale:** 27 domain modules, 10 apps (8 SPA / service + 2 plain-HTML pages), 21 packages; 3,123 API routes in
`apps/api/openapi/manifest.txt` (realm: staff 1,541 · super 1,143 · shared 277 · customer 162; 169 with step-up, 34 with
declared idempotency); 646 migrations → 773 tables.

**API routes by domain** (manifest `domain=`): ai 395 · workforce 308 · finance 256 · operations 227 · booking 207 · checkout 185 ·
analytics 171 · support 169 · tenants 163 · identity 163 · payments 143 · communications 136 · marketing 99 · customers 98 ·
inventory 74 · security 69 · deals 67 · catalog 58 · memberships 53 · platform 35 · audit 27 · loyalty 20.

**Ownership:** every module is internal developer code in this repository; external dependencies per module are in
`EXTERNAL_SETUP_CHECKLIST.md`. **Status columns** count `.ts` spec files (`.tsx` UI specs need React and were not run):
PASS = every test in the file passed under the stand-in harness; "FAIL→env" = failed only for a reason the harness cannot provide
(triaged, `TEST_RESULTS.md` §4); "skipped opt-in" = race specs that need `PG_RACE_URL` + `pg`; "not run" = the sweep was stopped
after the money / integrity modules and the packages (1,013 of 2,180 `.ts` spec files ran).

| Path | What it owns (its top-level sub-domains) | source files | test files | controllers | `.ts` specs run here | PASS | FAIL→env | skipped opt-in | not run |
|---|---|---|---|---|---|---|---|---|---|
| `modules/ai` | ai, ai-analytics-forecasting, ai-center, ai-customer-profile, ai-entitlement, ai-governance, ai-inventory, ai-marketing, ai-money-protection, … | 348 | 224 | 26 | 82 / 224 | 64 | 14 | 4 | 142 |
| `modules/analytics` | ai-business, dashboard, overview, owner, privacy | 61 | 51 | 6 | 0 / 51 | 0 | 0 | 0 | 51 |
| `modules/appointments` | appointments, tech-appointments | 16 | 8 | 1 | 8 / 8 | 5 | 3 | 0 | 0 |
| `modules/audit` | audit-partition.service, audit-partitions-core, audit-sink, audit.controller, audit.dto, audit.kysely.repository, audit.list-queries, audit.module | 12 | 6 | 1 | 0 / 6 | 0 | 0 | 0 | 6 |
| `modules/booking` | booking, customer-activation, customer-booking, customer-phone, deposits | 77 | 83 | 13 | 83 / 83 | 48 | 22 | 13 | 0 |
| `modules/catalog` | service-add-ons, services | 15 | 11 | 2 | 0 / 11 | 0 | 0 | 0 | 11 |
| `modules/checkout` | ai-checkout-upsell, cash-drawer, checkout, checkout-lock, mobile-checkout, skip-line-checkout, ticket-history | 101 | 158 | 11 | 158 / 158 | 110 | 34 | 14 | 0 |
| `modules/communications` | campaigns, communications, end-of-day-followups, messaging-inbound, messaging-readiness, notifications, platform-announcements, push, reminders, … | 127 | 72 | 16 | 72 / 72 | 45 | 27 | 0 | 0 |
| `modules/customers` | customer-activation-rules, customer-identity, customer-salons, customers, legal-hold, loyalty, pos-referrals, reviews, wallet | 50 | 47 | 6 | 47 / 47 | 28 | 15 | 4 | 0 |
| `modules/deals` | bundles, deals, engine, promotions, salon-promotions | 50 | 23 | 8 | 0 / 23 | 0 | 0 | 0 | 23 |
| `modules/finance` | bill-reminder.scheduler, category-engine, expense-categories, expense-digests, expense-duplicates, expense-errors, expense-export, expense-lifecycles | 20 | 6 | 1 | 0 / 6 | 0 | 0 | 0 | 6 |
| `modules/gift-cards` | gift-card-stock, gift-cards | 22 | 13 | 2 | 13 / 13 | 9 | 2 | 2 | 0 |
| `modules/identity` | auth, customer-registration, customer-security, invitations, staff-roles | 83 | 83 | 15 | 83 / 83 | 58 | 19 | 6 | 0 |
| `modules/inventory` | inventory-core, inventory-lifecycles, inventory.controller, inventory.list-queries, inventory.module, inventory.service, request-schemas, … | 11 | 7 | 2 | 0 / 7 | 0 | 0 | 0 | 7 |
| `modules/loyalty` | loyalty.controller, loyalty.dto, loyalty.kysely.repository, loyalty.module, loyalty.repository, loyalty.service, request-schemas | 9 | 3 | 1 | 0 / 3 | 0 | 0 | 0 | 3 |
| `modules/marketing` | display-advertising | 13 | 5 | 1 | 0 / 5 | 0 | 0 | 0 | 5 |
| `modules/memberships` | membership-billing-core, membership-billing.controller, membership-billing.kysely.repository, membership-billing.module, … | 39 | 22 | 5 | 22 / 22 | 18 | 4 | 0 | 0 |
| `modules/payments` | customer-payments, deposit-reconciliation, hardware-payment, invoices, payments, refunds-voids, split-payments | 96 | 40 | 13 | 40 / 40 | 33 | 6 | 1 | 0 |
| `modules/platform` | platform-approvals, super-admin-automation, super-admin-plans | 55 | 14 | 9 | 0 / 14 | 0 | 0 | 0 | 14 |
| `modules/queue` | check-in, go-check-in, live-technician-schedule, queue, service-done, serving, tech, tech-queue, technician-help | 86 | 122 | 12 | 122 / 122 | 81 | 33 | 8 | 0 |
| `modules/reports` | booking-checkin-events, booking-conversion, kpi-snapshots, marketing-report, menu-insights, reports | 25 | 7 | 3 | 0 / 7 | 0 | 0 | 0 | 7 |
| `modules/safety` | ai-ocr-receipt, tenant-safety-community | 65 | 57 | 4 | 0 / 57 | 0 | 0 | 0 | 57 |
| `modules/security-center` | security-events | 3 | 1 | 0 | 0 / 1 | 0 | 0 | 0 | 1 |
| `modules/super-admin` | onboarding, super-admin-ai, super-admin-ai-checkout-upsell, super-admin-ai-customer-profile, super-admin-ai-insights, super-admin-ai-ocr-receipt, … | 617 | 317 | 81 | 0 / 317 | 0 | 0 | 0 | 317 |
| `modules/support` | help | 19 | 13 | 2 | 0 / 13 | 0 | 0 | 0 | 13 |
| `modules/tenants` | branding, devices, owner-portfolio, pos-social, settings, tenant-entitlements, tenant-locations, tenant-navigation | 47 | 23 | 9 | 23 / 23 | 15 | 8 | 0 | 0 |
| `modules/workforce` | access-governance, approvals, availability, commission-report, compensation, eligibility, nail-showcase, payroll, pos-team, team-permissions, … | 207 | 135 | 30 | 135 / 135 | 66 | 62 | 7 | 0 |
| `apps/admin-web` | Super Admin console (English only) | 257 | 179 | 0 | 0 / 10 | 0 | 0 | 0 | 10 |
| `apps/api` | NestJS API + workers + SSE realtime; composes every module | 538 | 420 | 33 | 0 / 420 | 0 | 0 | 0 | 420 |
| `apps/booking-public` | Online booking page (plain HTML) | 0 | 0 | 0 | 0 / 0 | 0 | 0 | 0 | 0 |
| `apps/customer-display` | Customer-facing display: totals, ads, 3 s privacy clear | 33 | 21 | 0 | 0 / 9 | 0 | 0 | 0 | 9 |
| `apps/customer-web` | Customer App (English only) | 104 | 66 | 0 | 0 / 7 | 0 | 0 | 0 | 7 |
| `apps/go-check-in-kiosk` | Go Check-In kiosk (plain HTML) | 1 | 3 | 0 | 0 / 0 | 0 | 0 | 0 | 0 |
| `apps/manager-pay-web` | Tap to Pay / Manager Pay app (English only) | 38 | 20 | 0 | 0 / 6 | 0 | 0 | 0 | 6 |
| `apps/owner-web` | Owner App (English only) | 87 | 67 | 0 | 0 / 8 | 0 | 0 | 0 | 8 |
| `apps/pos-web` | Front Desk POS (EN + VI) — 27-inch touchscreen | 493 | 349 | 0 | 0 / 35 | 0 | 0 | 0 | 35 |
| `apps/tech-web` | Technician App (English only) | 67 | 40 | 0 | 0 / 10 | 0 | 0 | 0 | 10 |
| `packages/api-client` | api-version, async-operation, auth-refresh, http-core | 6 | 4 | 0 | 4 / 4 | 4 | 0 | 0 | 0 |
| `packages/api-contracts` | customer, platform, tenant, text | 122 | 18 | 0 | 18 / 18 | 18 | 0 | 0 | 0 |
| `packages/auth` | ephemeral-grants, password, password-policy, security, service-principals | 7 | 3 | 0 | 3 / 3 | 3 | 0 | 0 | 0 |
| `packages/cache` | redis, tenant-cache | 4 | 1 | 0 | 1 / 1 | 1 | 0 | 0 | 0 |
| `packages/config` | events-flags, flag-rollout, instance-id, platform-urls, post-restore-hold, process-role, trust-proxy | 9 | 4 | 0 | 4 / 4 | 4 | 0 | 0 | 0 |
| `packages/database` | nest | 22 | 11 | 0 | 11 / 11 | 5 | 6 | 0 | 0 |
| `packages/date-time` | Calendar and time-zone primitives: business date, zoned parts, wall-clock to epoch, YMD arithmetic (Constitution 13 §87) | 2 | 2 | 0 | 2 / 2 | 2 | 0 | 0 | 0 |
| `packages/events` | nest | 6 | 2 | 0 | 2 / 2 | 2 | 0 | 0 | 0 |
| `packages/media` | clamav-scanner, image-info, media-storage, private-store, upload-policy | 7 | 7 | 0 | 7 / 7 | 6 | 1 | 0 | 0 |
| `packages/mobile-sdk` | capture, config, i18n, links, network, push, query, security, telemetry | 45 | 23 | 0 | 18 / 18 | 9 | 9 | 0 | 0 |
| `packages/money` | Integer-cents money type, exact parsing, the distinct display rules, … | 2 | 3 | 0 | 3 / 3 | 3 | 0 | 0 | 0 |
| `packages/notifications` | email.service, sender-selection, sms.service, tenant-messenger, twilio-inbound-core, twilio-verify-service | 8 | 4 | 0 | 4 / 4 | 4 | 0 | 0 | 0 |
| `packages/observability` | nest, tracing | 34 | 22 | 0 | 22 / 22 | 18 | 4 | 0 | 0 |
| `packages/permissions` | guards | 29 | 13 | 0 | 13 / 13 | 12 | 1 | 0 | 0 |
| `packages/realtime-client` | client, core, react, sync-policy | 6 | 2 | 0 | 2 / 2 | 0 | 2 | 0 | 0 |
| `packages/realtime-contracts` | port, realtime-core, settings-changed | 5 | 1 | 0 | 1 / 1 | 1 | 0 | 0 | 0 |
| `packages/security` | nest | 15 | 5 | 0 | 5 / 5 | 5 | 0 | 0 | 0 |
| `packages/tenant-context` | context | 3 | 1 | 0 | 1 / 1 | 1 | 0 | 0 | 0 |
| `packages/testing` | a11y, pdf-text, provider-secrets, upload-fixtures, validated-routes | 9 | 0 | 0 | 0 / 0 | 0 | 0 | 0 | 0 |
| `packages/ui` | brand | 16 | 7 | 0 | 3 / 3 | 2 | 1 | 0 | 0 |
| `packages/web-push` | web-push | 4 | 1 | 0 | 1 / 1 | 1 | 0 | 0 | 0 |

**Language boundary per app** (POSLanguage.pdf, enforced by `check:english-only-apps` / `check:admin-english-only`, both PASS today):
only the Front Desk POS is English + Vietnamese; every other app and customer surface — Customer, Technician, Owner, Tap to Pay,
Super Admin, online booking, Customer Display, kiosk, receipts / SMS / e-mail, the AI phone receptionist — is English only.
