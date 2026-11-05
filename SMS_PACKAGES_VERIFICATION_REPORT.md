# SMS_PACKAGES_VERIFICATION_REPORT.md
### Twilio SMS Verification Packages & Tenant Billing — final verification per spec §71
Date: July 29, 2026 · Repo state: commit `be8258c` (report committed on top) · Spec: Kevin's 71-section document, received July 29, 2026.

Everything below was verified by real runs in this repository — migrations applied on real Postgres (PGlite/PG16),
services exercised through pgtests against the full 429-migration schema, screens driven by testing-library suites,
and the whole API battery re-run at every phase boundary. Nothing in this report is claimed from intention.

---

## 1. WHAT WAS IMPLEMENTED (seven phases, seven commits)

| Phase | Commit | Delivered |
| --- | --- | --- |
| P1 schema + SA CRUD | `6acd98c` | Migration **427** (5 tables), 3 seeded packages (unpriced, honest descriptions), SmsPackagesService/-Controller at `/super-admin/sms-packages`, 9 granular §54 permission keys |
| P2 entitlement gate | `096a83b` | SmsEntitlementService (§14 single gate: precheck / recordSubmission / recordFailure / balance), wired around the booking-verification Twilio Verify send |
| P2b purpose accuracy | `d335c12` | §17 purposes threaded through the shared choke point; phone-change traffic ledgers as CUSTOMER_PHONE_CHANGE; §16 platform paths proven outside the gate |
| P3 assignment + credits | `fd3e7d2` | Migration **428** (pending change pair), assignPackage (immediate re-snapshot / next-cycle pending + lazy promotion, §28 downgrade default), §29 manual credit |
| P4 Super Admin screens | `af4774c` | One sidebar area "SMS Verification Packages": §4 table + full §5 inline editor, §44 tenant usage table with filters, per-row Assign/Credit + §7 plan history |
| P5 tenant self-service | `877975f` | `/tenant/sms-plan` endpoints + selfServiceChange (TENANT-role audit), §10 usage widget + §9 Review→Confirm upgrade embedded in the POS Account screen |
| P6 reconciliation + alerts | `9a55d39` | Migration **429** (findings, §59 structural dedupe), §58 nightly filed-never-fixed reconciliation + house-pattern scheduler, §31 threshold banners, §32 findings on the SA screen |
| P7 billing + analytics | `be8258c` | §47 charges feed shaped as `billing_invoice_lines` for the EXISTING invoice engine, §22-§24 margin with cost-null honesty, §45 analytics, §43 base+total on the tenant panel |

## 2. EXISTING CODE REUSED (audit-first, §69 — no duplicate engines were built)

- **TwilioVerifyProvider / VerificationProvider** (`customer-booking/booking-verification-provider.ts`) — the one
  send choke point; the entitlement gate wraps it, so booking AND phone-change flows were covered by a single wire.
- **booking-verification-webhook.controller** — Twilio status callbacks already exist with their own spec; reused,
  not rebuilt (see §7 Remaining for the one un-wired hop).
- **booking-verification policy** — §33-§35 abuse protection (resend cooldown, attempt limits, OTP expiry,
  enumeration-safe responses) pre-existed and is pinned by the existing suite (e.g. the `rate_limited` assertion in
  `booking-verification.service.vitest.spec.ts`).
- **super-admin-billing invoice engine** (`billing_invoices` + `billing_invoice_lines`, migration 195) — §47 rides
  it via a feed whose rows carry the engine's exact line shape. No shadow invoices exist anywhere.
- **audit_logs pattern**, **CustomerSyncScheduler house pattern** (env-gated ticker, injectable clock),
  **rbac granular keys**, **parseDollarsToCents**, **tenant-controller ctx pattern** (server-derived tenant,
  inline permission checks), **messaging-readiness** concept for §38's package-vs-Twilio dual status.
- The three pre-existing SMS-limit structures (migs 101/173/279) were reconciled by design: packages are a
  separate purchasable product; the entitlement gate consumes package allowance for VERIFICATION categories only.

## 3. DATABASE (migrations 427-429, all applied 429/429 on real Postgres)

- `sms_verification_packages` — every §5 field Super-Admin-editable; CHECKs on money ≥ 0 and thresholds 1-100.
- `tenant_sms_subscriptions` — one per tenant (UNIQUE) + the 428 pending pair for next-cycle changes.
- `tenant_sms_package_changes` — §8 history; `reason` NOT NULL.
- `tenant_sms_billing_cycles` — **§26 terms snapshot ON the row** (code, name, price, included, overage terms,
  hard limit) + live counters + UNIQUE(tenant, cycle_start). Historical periods can never be recalculated by
  editing a package.
- `sms_usage_records` — the immutable ledger (§19-§20): purpose enum (§17), category (§16), masked recipient
  (§21), price in integer cents separate from `provider_cost_micros` (§6/§22), and the **§12 cornerstone as a
  partial UNIQUE (provider, provider_message_id) WHERE sid IS NOT NULL** — a Twilio SID cannot bill twice; the
  database refuses, not application politeness.
- `sms_reconciliation_findings` — §59 dedupe structural: partial UNIQUE (tenant, type, cycle) WHERE status='open'.

## 4. TEST PROOFS (§60-§68 — every number below is a real run's output)

**Dedicated new suites (26 API tests in `src/sms-packages/` + 3 purpose pins + 8 POS panel + 9 SA screen):**

- §60 package selection — no-package tenant allowed unbilled (`no_package_unbilled` ledger row, package_id NULL). ✅
- §61 soft limit → overage — allowance 2 fills, 3rd send flagged `willBeOverage`, ledger row priced **3¢ from the
  cycle snapshot**, balance shows used 2 / overage 1 / estimated 3¢. ✅
- §62 hard limit — refused **before** the send with `hard_limit_reached`; zero new billable rows after refusal. ✅
- §63 duplicate SID — same SID reported twice: `duplicate:true`, one ledger row, counters unmoved; raw duplicate
  INSERT at the database → error 23505. ✅
- §64 failures — FAILED status, billable false, failed_count incremented; never billed. ✅
- §65 package change — first assign; upgrade-immediate **re-snapshots the open cycle with `used_included`
  surviving**; downgrade default queues the pending pair with the old snapshot untouched; lazy promotion fires at
  the boundary and clears the pair; self-service change refused for non-self-service packages and audited as
  role TENANT. ✅
- §66 tenant isolation — three tenants (no-package / soft / hard) driven through the same service in one schema
  with zero cross-contamination of counters, cycles, or ledgers; tenant identity server-derived at the tenant
  controller; `check:tenant` gate green with the three SA cross-tenant services explicitly reviewed + baselined. ✅
- §67 rate limiting — pre-existing booking-verification cooldown pinned by its existing suite (`rate_limited`);
  the entitlement gate adds the allowance layer on top without touching those protections. ✅
- §68 billing calculations — charges feed: base 4,900¢ + 1 × 3¢ overage = **4,903¢ exactly**, with invoice-line
  shapes (`sms_package_base` qty 1 / `sms_overage` qty 1 unit 3¢); provider cost 158,000 micros → 16¢ (rounded),
  margin real only then; with zero recorded micros → `costAvailable:false`, nothing invented. ✅
- §58 reconciliation — a deliberately corrupted counter is FILED with both numbers (ledger 2 vs counter 7) **and
  remains corrupted after the run** (never auto-fixed); healthy cycles file nothing; §59 second run updates the
  same open row (count stays 1); resolve closes it and a still-broken next run files a fresh one; the scheduler
  tick skips before 03:30, runs once, skips the rest of the day. ✅
- §31 banners — the spec's exact texts pinned one tier at a time, including "SMS verification limit reached."
  (hard) vs "Overage charges now apply." (soft). §43 pinned: "Base $49.00/mo + $0.09 overage · Estimated total
  $49.09". §5 editor pinned to send integer cents (2999, never 29.99). ✅

**Platform regression at every phase boundary (8-shard battery, summed from logs):**
6,055 → 6,060 → 6,063 → 6,069 → 6,069 → 6,070 → 6,075 → **6,079 + 4 skipped, 0 failed** (at `be8258c`).
All 13 gates green at every commit; pos-web 726/726; admin-web builds + suites green; DI graph OK throughout.

## 5. KEY DESIGN DECISIONS (documented in code where they live)

1. **No hardcoded pricing anywhere** (§1) — packages seeded at $0, self-service OFF, description honestly reading
   "not yet set by Super Admin". Kevin's pricing decision (tenants pay own Twilio vs platform resells) stays open
   and is a data-entry act, not a deploy.
2. **Rollout-safe default** — a tenant with NO package keeps verifying, unbilled and honestly ledgered. Deploy day
   breaks zero live salons; enforcement begins at assignment.
3. **Billing is subordinate to delivery** — a throwing recordSubmission never blocks a customer's code (pinned).
4. **Snapshot everywhere money is computed** (§26) — overage pricing, the charges feed, and the tenant's estimate
   all read the cycle row, never today's package definition.
5. **±1 race at a hard limit tolerated** — counters advance atomically without a lock on the hot send path; the
   ledger stays exact and nightly reconciliation surfaces any drift for a human.
6. **Platform traffic never tenant-billed** (§16) — proven structurally: zero entitlement imports in `src/auth`
   or `src/customer-activation`; the SA OTP and global identity activation are outside the gate by construction.

## 6. NOT VERIFIED (cannot be, in this environment — each needs an owner-side key)

- **Live Twilio sends** — every send in tests uses the provider seam; no real SMS left this sandbox.
- **Provider cost capture** (§22) — `provider_cost_micros` is recorded when a source supplies it; no live pricing
  API was available, so real margin numbers await credentials. The null-honesty path is what's proven.
- **Provider-side reconciliation** (§58's external pass) — the `ProviderUsageSource` seam exists; without creds
  the nightly summary reports `providerComparison: 'unavailable'` instead of pretending.
- **Twilio signature verification on callbacks** (§36) — the existing webhook controller predates this arc and
  was reused as-is; its behavior is covered by its own spec, not re-audited here.

### 6a. ACCOUNTING CORRECTION (Jul 29, self-review)
Two spec sections were neither built nor listed anywhere in this report's first edition — a completeness bug in
the §71 accounting itself, caught on re-read and closed the same day:
- **§41 default package for new tenants — DONE.** One more `platform_settings` row (migration 431, safe default
  null = none). Super Admin sets a package code with a required, audited reason; `createTenant()` — the single
  choke point both direct SA creation AND application approval flow through — fire-and-forgets
  `applyDefaultForNewTenant()`, which assigns with the audited reason "Default package for new tenants (§41)"
  and swallows every failure: a new salon must never fail to exist because of an SMS setting. Pinned end-to-end
  on the real schema (assignment lands with the §41 audit action; cleared default → clean no-op; invalid code
  refused at the setter).
- **§46 per-tenant usage drill-down — DONE.** `GET /super-admin/sms-tenant-plan/:tenantId/usage` returns
  tenant-scoped ledger rows — §21 masked recipients only, never raw — rendered as a Recent Usage table inside
  the tenant's Manage expander. Pinned: rows are tenant-scoped and recipients are masked-or-absent.

## 7. REMAINING (small, explicit, none blocking)

1. **Kevin's pricing decision** — then type the numbers into the SA editor. No code change.
2. **Twilio credentials** — unlocks live sends, cost capture, and the external reconciliation pass.
3. ~~Verify-callback → ledger status wiring~~ — **DONE (commit below, Jul 29):** the existing signature-verified
   webhook now advances the ledger to DELIVERED / UNDELIVERED / FAILED alongside the session update, forward-only
   and tenant-scoped, with `billable` deliberately untouched (acceptance already decided the money; a late
   delivery callback must never rewrite it). Pinned by a lifecycle test: a delivered row refuses a late
   'undelivered' retry and the cycle counters never move.
4. **§42 free-trial credit configuration** — deliberately not built; §29 manual credits cover the need today, and
   an automatic-trial rule is a product decision to make once pricing exists.
5. ~~§40 Emergency Disable master switch~~ — **DONE (Jul 29):** four master controls seeded into the EXISTING
   `platform_settings` table (migration 430, no new store) and enforced in the single entitlement precheck —
   Emergency Disable and Platform-off refuse every tenant-funded send; Billing-off pauses billing ONLY (sends
   continue, unbilled, because a billing problem must never become a customer-facing outage); Enrollment-off
   blocks new assignments while existing tenants are untouched. Reason required, before/after audited, and a
   Master Controls section sits at the top of the Super Admin screen.
6. **Custom credit expiry dates** (§29's optional variant) — cycle-end expiry is structural today; a custom date
   becomes a credits table when needed, not a column hack.

## 8. FILES (new or materially changed by this arc)

`db/migrations/427_sms_verification_packages.sql` · `428_sms_subscription_pending_change.sql` ·
`429_sms_reconciliation_findings.sql` · `src/sms-packages/` (packages service+controller, entitlement, tenant-plan
service+controller, tenant self-service controller, reconciliation service+scheduler, billing service, 5 pgtest
suites) · `src/customer-booking/booking-verification.service.ts` (entitlement wiring + purpose) ·
`customer-booking.module.ts` · `customer-phone.module.ts` (purpose) · `src/auth/rbac.ts` (9 keys) ·
`src/database/kysely.types.ts` (6 tables) · `scripts/tenant-isolation-check.mjs` (3 reviewed baselines) ·
admin-web: `superAdminSmsApi.ts`, `SmsVerificationPackagesScreen.tsx` (+test), sidebar + route ·
pos-web: `posSmsPlanApi.ts`, `SmsVerificationPanel.tsx` (+test), `POSAccountScreen.tsx` (embed).

---
*Verification pillars (standing rule): tenant isolation ✅ (server-derived ctx + gate + multi-tenant pgtests) ·
branch isolation N/A (SMS allowance is tenant-level by spec; branch_id recorded on ledger rows for §46 drill-down)
· RBAC ✅ (9 granular keys, every route gated, tenant vs SA vs TENANT-role audit separation) · persistence ✅
(429/429 migrations, all state in Postgres, snapshots + ledger) · audit ✅ (every mutation writes audit_logs with
before/after or reason; actor role recorded).*
