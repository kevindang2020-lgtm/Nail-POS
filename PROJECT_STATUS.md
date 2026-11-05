# PROJECT_STATUS.md

**Verified State (October 14, 2026 — Production Takeover Mandate Final Verification):**
- **Typecheck & Builds:** 15 packages, 27 modules, API, worker, and all 8 frontend apps build clean (0 errors).
- **Backend API Routes:** **2,990 routes** across 266 controllers (verified by `check:openapi` manifest).
- **Database Schema:** **603 migrations** applied cleanly on fresh PostgreSQL 16 (726 tables inventoried).
- **Frontend Wiring:** **2,525/2,525** client calls hit live backend routes (**0 orphaned, 0 404s** via `check:crosswire`).
- **Navigation & Screens:** **501 routes / screens** across 9 applications (**0 dead links** via `check:nav`).
- **Integrity Gates:** **47 CI gates + 13 security/architecture audits** pass 100% green (`tooling/ci/run-gates.mjs`).
- **P0 Money & Security:** Gift card atomic ledger, card refund idempotency, and keystore sanitization enforced.
- **Canonical Status Reports:**
  - `ARCHITECTURE_STATUS.md` (§238) — Complete 32-domain inventory and status.
  - `SECURITY_REVIEW.md` (§243) — Tenant isolation, auth, permissions, secrets, payments, webhooks.
  - `INTEGRATION_STATUS.md` (§244) — 10 integration providers classified with exact status.
  - `DATABASE_STATUS.md` (§245) — Tables, keys, indexes, ownership class, and migration registry.
  - `REALTIME_INVENTORY.md` (§247) — 112 realtime events, audience, permissions, recovery.
  - `FRONTEND_ROUTE_STATUS.md` (§248) — Full route/screen/API mapping across all 9 apps.
  - `docs/HOSTING_ACTIONS_FOR_KEVIN.md` (§262) — External dependencies and hosting actions checklist.

---

## Fully working

- **Multi-tenant core** — tenants (salons), branches (locations), users, roles, RBAC, tenant isolation.
- **Authentication** — 4 portals (`tenant` / `owner` / `customer` / `super-admin`), role-filtered **in SQL**.
  Sessions are signed, carry a `sid`, and are **genuinely revocable**.
- **Native apps (iOS/Android)** — Capacitor shells for `customer-web`, `owner-web`, `tech-web`,
  `manager-pay-web`. Keychain-held bearer token, CORS, Face ID, token lifecycle.
- **Multi-salon Owner Platform** — one owner account, many salons; **server-verified** salon switching;
  role per salon; All-Salons portfolio dashboard with real aggregated KPIs.
- **POS** — login, queue, check-in, checkout, payments (Fiserv/CardPointe/Bolt/Clover).
- **Customer app** — phone→OTP activation, login, guest mode, Face ID.
- **Salon Safety Community** — posts, evidence with access control, moderation, appeals.
- **Super Admin** — tenants, branches, users, plans, payments, devices, audit logs.
- **Twelve guard tests** that fail the build on whole classes of bug (see NEW_CLAUDE_INSTRUCTIONS).

## Partially complete

| Area | State |
|---|---|
| **Owner App — individual salon dashboard** | **Complete.** `OwnerHomeScreen` (shown when a specific salon is selected; All-Salons shows `PortfolioOverviewScreen`) renders all five reference widgets: Today's Overview (hero revenue + trend + KPIs), Live Operations (Check-ins/Waiting/Active/Ready tiles tapping to the full Live Ops screen), **Top Technicians** and **Recent Appointments** (compact home sections reusing `/owner/staff/performance` and `/owner/bookings/drill-down`, tapping through to the full screens), and Revenue Trend (7-day chart). Supporting sections degrade to null on load/error/empty — never a fabricated value. Verified: owner-web tsc 0, 223 tests (incl. new coverage), build passes. |
| **Super Admin — Owner Portfolio screens** | **Built and wired** (was previously API-only). `SuperAdminOwnersScreen` at `/owner-salons` (sidebar "Owner Salons"): owners list + owner detail with the cross-tenant Salons-in-Portfolio table (Store Code, status, MTD revenue — honest `—`, never a fabricated $0), assign/remove/update-access branch management, per-salon switch-PIN editor, create-salon, and an activity timeline. All ten `/super-admin/owners/*` endpoints consumed. Verified: admin-web tsc 0, 7 screen tests, `check:nav` resolves. |
| **Revenue charts** | **Built.** `PortfolioOverviewScreen` (All-Salons view) renders the Revenue Overview time-series (hourly SVG line from `GET /owner/portfolio/revenue-series`, honest "no revenue yet" empty state — never a flat zero line) and the **Top Performing Salons** list (from `/owner/portfolio/summary` → `topSalons`, tapping a row does the server-verified salon switch). Verified: owner-portfolio backend 59 tests, PortfolioOverviewScreen 15 tests. |
| **Period-over-period comparison** | **Modelled.** `summarize()` computes `revenueTodayPct` / `tipsTodayPct` / `appointmentsPct` / `checkedInPct` / `newClientsPct` via `pctChange(current, previous)` — which returns **`null` when the prior period is 0** (rendered as no delta), so a "↑18.6%" is only shown when it is real, never fabricated. Rendered on the portfolio KPIs. |

## Not started

- Owner App salon-switch cache-invalidation: **done, centrally.** Rather than key ~90 fetches to `epoch`
  individually, `OwnerBranchContext` now reloads when the salon `epoch` bumps — refreshing the branch list and
  resetting the selection to the newly active salon, which flips `effectiveBranchId` so every branch-scoped screen
  re-fetches automatically (and the branch selector no longer shows the old salon's branches). Bridged via a
  non-throwing `useOwnerSalonEpoch()` so isolated provider tests are unaffected. Regression-guarded by
  `OwnerBranchEpochReload.test.tsx`; owner-web tsc 0, 224 tests, build pass.
- MFA step-up when switching into a salon with payment permissions.

---

## 🔴 The highest-value fix available

**`apps/api/src/database/kysely.types.ts` is incomplete.**

> **Superseded Oct 10 2026 (BUILD_PLAN Phase 15 doc sweep):** closed. The types now live in
> `packages/database/src/kysely.types.ts` and list 726 tables; BUILD_PLAN Phase 10 classified every table in an ownership
> registry (`apps/api/db/ownership/registry.generated.json`) held by the `check:db-ownership` gate, and the tenant gates
> (`check:tenant`, `check:tenant-builder`) run on every push. The legacy `appointments` table named below no longer exists
> (`041_drop_legacy_appointments.sql`). Kept as written for history.

- Its `DB` interface lists **232** tables. The migrations define **424** tenant-owned tables.
- **212 tenant-owned tables are missing** — including **`appointments`**, which is also missing its `tenant_id`.

This was the root cause of a real problem: the tenant-isolation guard derived its table list from these types, so
**212 tables were invisible to it**, and **three live cross-tenant leaks hid there** (since fixed).

The guard now derives from the **migrations** instead, so it is no longer blind. But regenerating these types
would **restore compile-time tenant-scoping help across the entire backend** — a far bigger win than the guard
alone.

---

## Known limitations (non-blocking)

- **Face ID ships DISABLED** (`FACE_ID_ENABLED`). The verifier provably **rejects** forged ceremonies; the
  *success* path needs one real device test on staging. See `FACE_ID_ENABLEMENT_RUNBOOK.md`.
- **Evidence stays locked** until `EVIDENCE_S3_BUCKET` is set and GuardDuty malware scanning is enabled
  (`terraform apply` creates both). This is deliberate: nothing can report a file "clean" unless a scanner said so.
- **The salon photography** is derived from the project's own design reference, not a licensed photograph. Drop a
  licensed one at `apps/pos-web/public/brand/salon-interior.jpg` and it is used automatically.
- **`go-check-in-kiosk` / `go-check-in-admin`** have no TypeScript config and are not covered by the typecheck.

## Business rules that are easy to get wrong

1. **Money is integer cents.** A portfolio sums many salons; float drift is real.
2. **A salon is a tenant**, not a branch. Salons have their own Store Code, subscription and merchant account.
   Merging two salons into one tenant merges their **merchant accounts**.
3. **Roles are per salon.** Owner at Salon A ≠ owner at Salon B.
4. **The client never chooses the tenant.** It may request a salon switch; the server verifies membership and
   re-issues the session for the salon *it* approved.
5. **Fail closed.** A missing tenant returns nothing, never everything.

## Recommended order for continuing

1. **Regenerate `kysely.types.ts`** (above). Everything else is easier afterwards.
2. ~~Build the **Super Admin Owner-Portfolio screens**~~ — **already built and wired** (`SuperAdminOwnersScreen` at `/owner-salons`); verified green. Next real gap is the individual salon dashboard below.
3. ~~Build the **individual salon dashboard** in the Owner App.~~ — **complete** (`OwnerHomeScreen`, all five widgets; Top Technicians + Recent Appointments added, reusing existing endpoints). Verified green.
4. ~~Wire the remaining Owner App screens to the salon-switch `epoch`.~~ — **done centrally** (`OwnerBranchContext` reloads on the salon epoch → `effectiveBranchId` flips → all branch-scoped screens re-fetch). Verified green.
5. ~~Revenue time-series + Top Performing Salons.~~ — **already built** (`PortfolioOverviewScreen`: revenue-series chart + Top Performing Salons + period-over-period deltas). Verified green.

---

## Added 2026-07-16 — Technician Skills / Helper / Tip Allocation (complete)
Manager skill/eligibility config + qualified lookup (server-enforced); full Request-Help workflow (primary requests → helper accepts/declines → service line + its earnings reassigned), backend + realtime + audit + both frontends; per-line earnings (never combine-and-divide); 50/50 two-tech tip + configurable 3+ policy; checkout Review Technician Split; refund attribution reversal (approval-pending, closed-period aware). Migration `400`. Details in `COMPLETION_REPORT.md`.

**Remaining follow-ons (design-dependent, not blocking):** partial-refund per-line reversal (refund API is amount-based); rich per-service skill attributes (level/assist-only/certification).

**Migrations now total 400** — apply `398`/`399`/`400` in your environment (contiguous; the runner tracks applied files by name, so re-running is safe).

## Session update — Jul 19–20, 2026 (revenue model + compliance + full-surface audit)

**New capabilities (all tested, all green):**
- **Layered net-first residual engine** (`apps/api/src/common/revenue-split.ts` → `computeLayeredResidualSplit` + `layeredFromFlat`; migration **415** adds `residual_statements.applicable_costs_cents`). The Fiserv Schedule A model: applicable costs come off the top → Net Revenue pool → 65/35 contractual split → the tenant incentive is an **AI PowerSalon-managed payable carved from the platform's 65%** (economic 40/35/25 = 100). Both layers reconcile to the cent; tenant share capped at the contractual share; negative pools (clawbacks) clamp. Wired into `calculatePartnerPayout`, `calculateTenantIncentive`, and statement reconciliation; layered breakdown persisted in `calc_snapshot` and surfaced in the Super Admin screen. Percentages remain per-agreement config — never hardcoded.
- **Four-bucket ledger** (migration **416**: `payments.surcharge_cents`). Customer card surcharge / Fiserv residuals / tenant incentives / hardware financing each live in their own tables-columns — related only in reporting, never mixed.
- **Surcharge compliance**, enforced at one chokepoint (`splitCardSurchargeCents`): rate hard-capped at **3%** at calculation time; settings write-cap tightened 4→3 so config, display, and charge always agree; **debit/prepaid exclusion hook** (auto-enforces once the processor reports card funding); card-portion-only in splits; disclosure on the customer display pre-payment; refund coupling inherent.
- Compensation follow-ons: bonus **period-review** (read-only, inline approve); **mobile refund/void** route on the Tap-to-Pay app delegating to the canonical checkout engine.
- Runnable demo harness `apps/api/demo-revenue-layered.ts` (real repository on real Postgres, Kevin's exact numbers) + interactive `revenue-split-demo.html` powered by the bundled production engine.

**Bugs found + fixed this session:** admin-web gift-card settlement "View entries" (dead API method → wired); Super Admin sidebar "Transfers"/"Payroll Sync" deep-links (panel param never read → wired, tested); POS Checkout **3 dead toggles** ("Rebook next visit" / "Save card on file" / "Send thank-you message" — live-looking switches wired to nothing → honestly disabled with notes; card-on-file explicitly requires processor tokenization, card numbers never stored); dead `ePhone` state removed from POSCustomersScreen; `useSystemStatus` kept showing green when the health endpoint itself was unreachable → now degrades to "Status unavailable" (tested).

**Protected designs — do not "fix":** customer **phone changes are a verified SMS flow, not a field** (POSCustomersScreen ~line 150; backend `repo.update` deliberately does not write phone on the generic PATCH). Processors are **Fiserv/CardPointe/Bolt/Clover only** — legacy stripe/square normalize to `'other'` and are never surfaced.

**Standing blocker (owner-side):** CommerceHub sandbox credentials — unlocks real Tap-to-Pay captures, automatic debit/prepaid surcharge exclusion, and card-on-file tokens. Also owner-side: attorney/Fiserv confirmation of the tenant-share contractual reading (software defaults to the AI PowerSalon-managed-payable model; stays configurable).

## Session update — Jul 20, 2026 (POS touch migration: iMac → Dell EC24250 Touch)
- **Hardware pivot:** the front-desk POS terminal is now a **Dell 24 All-in-One EC24250 Touch** (Windows 11, 1920×1080 touchscreen); the iMac is retired as primary target. pos-web remains a web app; target browsers are now Windows Edge/Chrome. See `MOBILE_CONVERSION_HANDOFF.md` §0.
- **Touch pass (audited-first, per Kevin's 23-page spec):** global `touch-action: manipulation` + tap-highlight/user-select hygiene + `:active` feedback parity + stuck-hover neutralization via `@media (hover:none)` (styles.css TOUCH section); Tech Queue board gained a **tap-to-assign** path (tap guest → tap technician; same `assignByDrop` as drag; drag unchanged); **input types** fixed for the Windows on-screen keyboard — 6 phone fields `type="tel" inputMode="tel"` (never `number`), 2 email `type="email"`, 12 search `type="search" enterKeyHint="search"` incl. global TopSearch.
- **Verified from spec, already built:** Booking drag was already pointer-events with touch press-and-hold; the iMac/macOS/Safari assumption sweep came back clean (`metaKey||ctrlKey`, no platform sniffing).
- **Verified:** pos-web tsc 0 · all 3 shards **696 tests green** (212+285+199) · production build OK. API untouched by this pass — its Jul-20 full battery (5,725 vitest + 124 harness suites, all gates, 416/416 migrations) stands.
- **Needs on-device verification (cannot be done from the sandbox):** 1920×1080 visual fit with taskbar/browser chrome, OSK coverage of controls, finger-scroll feel, Chrome/Edge touch↔mouse switching, second-display behavior — run the spec's §26 checklist on the Dell.

## Session update — Jul 25, 2026 (kysely.types.ts drift closed + drift gate)
The "🔴 highest-value fix" section above is now **stale**: the `DB` interface already covered all **604** live tables before this session, and this pass closed the true remaining gap — **162 column declarations missing across 23 tables** — by generating them from the migrated schema (PGlite introspection) using the file's own conventions (`Ts`/`TsNull`, `Generated<>`, `unknown` for jsonb, date as `ColumnType<string,...>`). Additive only; compile-green.
Added `check:types-drift` (package.json → `scripts/introspect-schema.mjs`): applies 416 migrations to PGlite and fails on any interface↔schema drift. Full battery re-verified green post-change (tsc 0, 8+1 gates, 416/416, 5,725+4 vitest, 124 harnesses).

## Session update — Jul 25, 2026 (push: APNs + FCM HTTP v1, honest production defaults, assignment trigger)
Push §6.2 re-audited: infra mostly existed; the send path could not work (legacy FCM API retired by Google, no APNs leg) and unconfigured production fabricated "delivered" logs via the mock. Rebuilt providers (APNs HTTP/2 ES256 + FCM v1 OAuth2, composite platform routing, not-configured honesty, dead-token auto-revoke) and wired the missing New-Assignment push on queue assign + tech-queue reassign. Env documented in `.env.example`. Verified post-change: tsc 0 · 9 gates PASS · API vitest 4 shards **1481+1407+1422+1436 = 5,746 passed + 4 skipped, 0 failed** (pre-change 5,725; +21 = exactly the new push/trigger tests) · queue/tech-queue core harnesses PASS. Follow-ons: ~~3 remaining apps' registration wiring~~ (**done same day** — customer/owner/manager-pay now mirror tech-web's register + revoke-on-sign-out lifecycle, +4 tests each, suites 265/262/50 green), ~~payroll/check-in~~ triggers (**done same day** — payroll-paid payout push per technician, no amounts on the lock screen; callNext check-in-ready push to the customer's account; battery 5,752+4, 0 failed), booking-reminder trigger (optional), on-device delivery (needs Kevin's APNs key + Firebase SA).


## Verified state — Jul 26, 2026 (intake + website + ASUS-migration sessions)
- API battery: **5,894 passed + 4 skipped, 0 failed** (8 shards: 791+741+721+707+721+778+783+652) · migrations **422/422** · all
  **9 gates** green (di/sql/crosswire/dead-client/unreached/perms/public/nav/types-drift) · api tsc 0.
- Frontends (last full run this session): pos-web **696** (3 shards, post ASUS de-brand) · admin-web **759** ·
  customer-web 265 · owner-web 262 · manager-pay-web 50 (Jul-25 push-arc runs; untouched since) · tech-web /
  customer-display untouched since their prior green runs.
- Landed since the Jul-25 handoff zip: Free-POS-Package application intake (migration 417; hardened public intake with
  EIN-at-rest encryption, idempotency, duplicate/fraud flags; 16-status lifecycle + 12 `super_admin.applications.*`
  perms; Super Admin screen rewrite; approval→onboarding conversion; templated confirmations; real metrics);
  marketing website merged at `marketing/website/` (canonical, form wired to the real endpoint); ASUS V470 migration
  (layout de-brand + REAL-browser viewport acceptance 60/60 at 6 resolutions); **two production bugs fixed** —
  session cookie 6,986→408 bytes (logins now survive reloads in real browsers) and WebAuthnModule's missing
  AuthModule import (API refused to boot with a DB configured).


## Jul 27, 2026 — status refresh

### Completed this session
- **Login identity**: sign-in accepts email OR phone; staff can be *set up* with either (invite + token/SMS invitation).
- **Retail products are sellable** end to end: catalog-priced ticket line → commission → checkout totals/tax → FIFO stock decrement → `retail_sale` ledger movement. Migration 423.
- **Platform-wide frontend cleanup**: zero `window.prompt`/`confirm`/`alert` (replaced by in-app `useInlineAsk` / `useInlineConfirm`), zero float money parsing (single exact `parseDollarsToCents`). Both now enforced by new gates `check:dialogs` and `check:money` — gate count 10 → 12. A 13th gate `check:html` followed on Jul 28, 2026: the two shipped single-file HTML apps had **no automated coverage of any kind** — it checks their JavaScript parses, references only elements that exist, keeps the API base configurable, and carries no credentials.
- **Per-picture audit of all 19 POS screens** against the owner's mockups. 31 defects fixed, all one class: controls that only printed a message. Three were wired to endpoints that already existed.
- **Marketing & Growth landing** built (the only sidebar group with no home).
- **react-router v7 future flags** opted in across all five frontends after a trial-and-revert proved them inert here.

### Known limitations (unchanged, owner-side)
- Tap-to-Pay completion needs Fiserv CommerceHub sandbox credentials (the adapter is a deliberate throwing skeleton).
- Push delivery on-device needs APNs `.p8` + Firebase service account.
- Hosting/API_BASE, SENDGRID_*, TWILIO_*, APP_DATA_ENCRYPTION_KEY are deployment inputs.
- iOS builds need a Mac; the physical ASUS device checklist needs the device.

### Open decisions (product/policy, deliberately not made in code)
- ~~**Guarantee proration**: which mode is the salon default, and the fallback when a technician has no scheduled hours (a zero denominator must not silently prorate the guarantee to nothing). Forward-only recommended.~~ — **Implemented Jul 28, 2026 as recommended** (see CHANGELOG): zero/unknown denominator pays the FULL guarantee with an explicit `prorationNote`; real attendance facts flow from `technician_shifts` into payroll auto-build; eligibility levers withhold, proration only scales. Residual product decision: modeling *scheduled hours* (the schema stores dates + actual punches only), which would let the hours modes prorate instead of falling back.
- **Caller-number storage**: `voice_call_outcomes` deliberately stores no caller number, so missed-call recovery cannot be built without a retention/consent decision. The displays that could never populate now say so.
- ~~**Eligible-expense list** for residuals — accounting/legal.~~ — **Jul 28, 2026: a conservative default list now ships** (itemized `costLines`, per-category reasons, per-agreement overrides; see CHANGELOG). Still yours/your accountant's to confirm against the signed Schedule A — the code encodes a defensible starting point, not the agreement.
- ~~Whether to build the other three composite dashboards, flesh out Communications/Help Center, or promote Memberships to a top-level nav item.~~ — **Jul 28, 2026: Communications + Help Center fleshed out, Memberships promoted** (see CHANGELOG). The other three composite dashboards remain deliberately unbuilt: a composite that re-derives its children's KPIs computes the same number twice and the two copies drift. Still open only if you want them anyway.

### Recommended order for continuing
1. CommerceHub credentials → finish Tap-to-Pay and the debit/prepaid exclusion (one unblock, two features).
2. ~~Guarantee-proration rule → wire forward-only with tests.~~ — **done Jul 28, 2026** (fail-safe + real facts; battery 5,953 + 4 skipped, 0 failed).
3. Deployment inputs → hosting, envs, GitHub push (activates security CI), marketing-site upload.

### Jul 29, 2026 — Mobile ecosystem arc complete (all four passes)
All 51 prototype screens compared against the four shipped Capacitor apps (TapPay 6, Customer 13, Owner 12,
Tech 20) — matrix at MOBILE_ECOSYSTEM_MATRIX.md. Three real gaps found and fixed ecosystem-wide, every one as a
thin delegate to a canonical engine: TapPay Add-Retail-Product + Add-Discount (serving/checkout engines; prices
from the tenant catalog only), Customer in-app tip at skip-line payment (migration 425; tip stored on the intent,
tamper-proof; validated by the tenant's existing maxTipPercent policy), Tech dedicated Service History screen
(paid lines only, honest unrated ratings). Everything else already existed. Battery 6,049 + 4 skipped, 0 failed ·
426/426 migrations · 13/13 gates · all frontends green.
