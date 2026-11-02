# Deals & Offers — build and verification report (guide of 30 Oct 2026)

Route `/tenant/marketing/deals` (Marketing & Growth → Deals & Offers), Front Desk POS, EN + VI. Built **in place** on the one deals
engine (BUILD_PLAN Phase 5) and on the pieces Coupons & Promotions (guide 2, `169dcd41`) left shared. No second discount
engine, no new money path. Nothing pushed, deployed, sent or charged; migration 737 is applied only to the local test template.

Status words (guide §19): COMPLETED_AND_VERIFIED · IMPLEMENTED_NOT_VERIFIED · BLOCKED_EXTERNAL · FAILED · NOT_IMPLEMENTED.

## 1. Repository audit (guide §2) — what existed, what was missing

| Area | Before this build | File(s) |
|---|---|---|
| Screen | List + approval queue + wizard + settings + dashboard; client list of ≤200, no search / pages / date basis / KPIs | `apps/pos-web/src/screens/POSDealsScreen.tsx` |
| Lifecycle + state machine | Complete (draft → pending → approved → scheduled/active → paused/expired/archived), DB-guarded (`canMoveToSql(DEAL, …)`) | `modules/deals/src/deals/deals.core.ts`, `engine/deal-lifecycles.ts` |
| Technician cap | Enforced on **create** only (`validateTechDealAgainstSettings`) | `deals.service.ts` |
| Self-approval | **Not prevented** on the direct path; the approvals engine's `deal_publish` policy has `requireDifferentApprover: false` by default | `deals.service.ts`, `workforce/.../approvals.core.ts` |
| Request Changes | In the state machine and the `deal_approvals` CHECK, **no route** | `deals.core.ts`, migration 387 |
| Re-check at approval / publish / resume | **Missing** (a lowered cap or "technician deals off" did not stop a pending/paused tech deal) | `deals.service.ts` |
| Edit after approval | Only "used deal" limits; an approved technician deal could be **widened** (e.g. 8% → 9%) without review | `deals.service.ts` |
| Checkout math / redemption ledger | Complete: integer cents, `floor` rounding, never negative, reserve under advisory lock, `onPaid` once, refund = compensating reversal | `engine/pricing.ts`, `engine/deals-checkout.service.ts`, `engine/deals-ledger.kysely.ts` |
| Read model (search / pages / KPIs / history / details) | Coupon-only (`d.kind = 'coupon'`) | `salon-promotions/discounts-screen.ts` |
| Checker / health / assistant | Coupon-only | `salon-promotions/coupon-center.ts` |

## 2. Original records (guide §1–§2, §12) — reconciliation

The screenshot's records cannot be read from production here. Each was reproduced on the real schema with the real services:
- **Spring time** — 5% salon deal on a $10.00 service: stored `original_price_cents 1000 → final_price_cents 950`; Checkout applies **50¢**; paid twice → **one** `redeemed` row, counted once. *COMPLETED_AND_VERIFIED* (pgtest; E2E steps 1–3).
- **vishal** — 20% owner-made offer: **not** blocked by the 10% technician cap; 20% on the eligible $100.00 line only (2000¢), not on an ineligible line. *COMPLETED_AND_VERIFIED.* (Guide 2 holds it as a coupon with code ••••NG20; it is the same one `deals` row either way.)
- **Technician deals: On — manager approval required, 10% max** — 8% proposal → Pending Approval (checker: "Needs approval", not redeemable); **15% → refused `TECH_DEAL_OVER_POLICY`, nothing saved, never silently capped**. *COMPLETED_AND_VERIFIED.*

## 3. Changes

**Backend (no new tables).**
- `deals.service.ts`:
  - `assertNotOwnDecision`: a technician proposal is never decided by its technician or by its filer → `DEAL_SELF_APPROVAL`. This applies on the engine path and the direct path, for approve, reject and request-changes.
  - `assertTechPolicy`: re-checks today's rules on approve / publish / resume → `TECH_DEAL_OVER_POLICY` / `TECH_DEALS_OFF`.
  - `requestChanges`: goes through the approvals engine when it holds the request, with a marker note, and routes to draft (not rejected).
  - The cap is validated on every technician edit.
  - `widenedTerms`: a non-draft technician deal cannot be made more generous or wider → `DEAL_REREVIEW_REQUIRED`. Narrowing is allowed.
  - Create refusals are now coded.
- `deals.controller.ts`: `POST pos/deals/:id/request-changes`.
- `deals-center.ts` (new) — `pos/deals-offers/{kpis, library, approvals, redemptions, health, :id, :id/check, assistant/suggest, assistant/draft}`:
  - The approval inbox is oldest first by default, with each request's policy comparison and financial exposure.
  - Details add the immutable approval history, the policy comparison and performance net of reversals.
- `discounts-screen.ts`:
  - New `scope` (`'coupon'` default, unchanged, or `'all'`).
  - Library filters: owner / kind / technician / branch / Pending.
  - Date bases Approved (decision log) and Redeemed (completed ledger rows).
  - Technician-name search.
  - Redemption search by email / customer ID / deal ID / technician.
  - Rows carry owner, technician and the stored price pair.
- `coupon-center.ts`:
  - New `scope`.
  - Health adds `approval_backlog` and `tech_policy` for Deals.
  - The assistant drafts a salon **deal** (no code) from Deals.
- Contract and repositories:
  - `DealView.createdByUserId` / `approvedByUserId` (Kysely + in-memory repositories).
  - Five new error codes in `packages/api-contracts/src/errors.ts` (EN + VI in the POS errors namespace; owner/tech catalogues regenerated).
- **Migration `737_deals_offers_indexes.sql`** (additive indexes only): `deals (tenant, created_at desc, id desc)`; `deal_redemptions (tenant, event time desc, id)` and `(tenant, customer)`; `deal_approvals (tenant, created_at desc)`. Rollback: `DROP INDEX`.

**POS.**
- `POSDealsScreen.tsx`, rebuilt in place. It keeps New Deal (wizard), every row with quick **Pause / Resume**, Edit, versions, a coupon's codes, the dashboard (Performance tab) and Settings. It adds:
  - six KPI cards from the server;
  - the technician-policy strip;
  - one search box with status / kind / owner / technician / service / type filters;
  - Today / Week / Month / Year / Custom month calendar with an explicit date basis;
  - numbered pages at 10 / 20 / 50, newest created first;
  - an Approvals tab with the full **Review** overlay: Overview, Eligibility, Comparison to policy, Approval history, Notes; Approve / Request Changes / Reject / Close. Own proposals show why and offer no buttons;
  - Redemption History, System health and the Deals Assistant (draft only);
  - Details tabs for Approvals & policy and Performance.
- `POSCouponsScreen.tsx`: CheckDialog, AssistantDialog, DuplicateDialog, SizePicker and healthTone are exported with an injectable API and labels. Coupons behaviour is unchanged (E2E 14/14).
- `POSDiscountsScreen.tsx`: `DetailExtras.load` / `loadRedemptions`. Discounts is unchanged (E2E 7/7).
- `posDealsOffersApi.ts`, `posDealsApi.requestChanges`, `ns/dealsoffers.{en,vi}.ts` (126 keys each), styles `.do-*`.

## 4. Tests — executed evidence (31 Oct 2026, ~03:00 UTC, local workspace)

| ID | Command / environment | Result | Status |
|---|---|---|---|
| T1 | `run.sh … modules/deals/src/deals/deals-center.pgtest.vitest.spec.ts` (stand-in on PostgreSQL 16, every migration) | **20/20** | COMPLETED_AND_VERIFIED |
| T2 | `PG_RACE_URL=…/deals_race run.sh … deals-approvals.postgres-race.vitest.spec.ts` (real PostgreSQL, 4 sessions) | **3/3** — 8 registers on a limit-3 deal → exactly 3; one ticket's paid callback ×6 → one redeemed row; two managers approve at once → one decision | COMPLETED_AND_VERIFIED |
| T3 | Regression, same runner | deals.core 33/33 · deals.pgtest 44/44 · approvals-engine 7/7 · kill-switch 3/3 · checkout-core 5/5 · coupon-center 18/18 · discounts-screen 6/6 · coupon-verdict 19/19 · eligibility 14/14 · pricing 23/23 · coupons 6/6 · promotions-redemption 8/8 · deal-lifecycles-r2 3/3 | COMPLETED_AND_VERIFIED |
| T4 | `request-schemas.vitest.spec.ts` | 0/23 — **also 0/23 at HEAD with these changes stashed** (the stand-in has no decorator metadata) | IMPLEMENTED_NOT_VERIFIED (CI) |
| E1 | `node tooling/checkout-one-screen/build.mjs && node tooling/catalog-one-screen/interact.mjs do-e2e do` (Chromium; 1920×945, 1366×768, 1280×720, 1024×768) | **15/15**, no page errors — screenshots `tooling/catalog-one-screen/results/do-e2e/` | COMPLETED_AND_VERIFIED (browser viewports) |
| E2 | Same harness, `cp` and `extra` sections (regression of the shared dialogs) | Coupons **14/14**, Discounts **7/7** | COMPLETED_AND_VERIFIED |
| G1 | `npm run -s check:{tenant,state-transitions,as-any,silent-catch,unreached,error-text,error-codes,openapi,attack-surface,critical-step-up,raw-sql-inputs,response-exposure,realtime-contract,migration-safety}` | all rc 0 | COMPLETED_AND_VERIFIED |
| G2 | sql-prepare-check · gen-actor-columns --check · introspect-schema --check · db-ownership --check · audit-unique-tenant-review | all OK (847 tables) | COMPLETED_AND_VERIFIED |
| U1 | `POSDealsScreen.test.tsx` (13 cases) + `POSDealsScreen.vi.test.tsx`, rewritten for the new screen | not runnable here (no React test packages) | IMPLEMENTED_NOT_VERIFIED (CI) |
| C1 | POS / API `tsc` type-check | not runnable here | IMPLEMENTED_NOT_VERIFIED (CI) |
| P1 | Physical ASUS 27″ at 100% zoom, Windows 125% scaling | not available | BLOCKED_EXTERNAL |

The guide's §18 matrix, mapped:
- **Baseline:** E1 step 1.
- **27-inch UI:** E1 last step, browser viewports only.
- **Find:** T1 and E1 step 4.
- **Calendar:** T1 and E1 step 5.
- **Pages:** T1 and E1 step 4.
- **Permissions:** T1 §9 and E1 steps 6–8, 13.
- **Checkout math:** T1 §2/§12.
- **Financial safety:** T1, T2, and guide 2's coupon-limits race.
- **Integrations:**
  - Checkout, coupons and promotions are covered by T1, T3 and E2.
  - Booking preview, commissions and loyalty: unchanged code paths, not re-tested here.
- **Security:** T1 tenant isolation, and E1 Front Desk 403s.

## 5. Decisions and conflicts
- **Self-approval** is enforced in the deals service, not by turning on the engine's optional separation-of-duties setting. That setting belongs to the salon, while this rule is the guide's.
- **Request Changes through the engine** is recorded there as a refusal with the note "Changes requested: …", so the salon's one Approvals screen closes the request. The deal itself goes back to **draft**, not rejected.
- **Widening an approved technician deal** is refused, not silently re-queued. The DEAL state machine has no active → pending transition, and adding one would change live deals' lifecycle. The fix is: pause or end it and submit a new proposal.
- **Assistant drafts** reuse `coupon_assistant_drafts`. The table name is historical; it now holds deal drafts too, keyed by `deal_id`.
- **Commission / funding of technician deals:** no posting rule exists in the code for who funds a technician deal. Per guide §12 this is surfaced, not invented. *Open owner decision.*

## 6. Release readiness
- **Code:** ready behind the existing deals engine kill switch and the salon's `deals_enabled` / technician-deal settings. There is no new flag.
- **Production:** needs owner approval for migration 737 (indexes only) and a staging run.
- **Rollback:** revert the code and drop the four indexes. No data was rewritten.
