# Marketing & Growth — Complete Build Guide handoff (31 Oct 2026)

Route `/tenant/marketing` (POS). Rebuilt in place: `apps/pos-web/src/screens/POSMarketingLandingScreen.tsx`. New read-only
backend `GET /pos/marketing-growth/*` (`modules/reports/src/marketing-growth/`). Local commit only — nothing pushed, deployed
or sent. **No migration** (every number comes from existing tables). Status words per guide §19: COMPLETED_AND_VERIFIED,
IMPLEMENTED_NOT_VERIFIED, BLOCKED_EXTERNAL, NOT_IMPLEMENTED.

## 1. Changed files and routes
| Area | Files |
|---|---|
| Backend (new) | `modules/reports/src/marketing-growth/marketing-growth.{repository,controller,module}.ts`, pgtest; registered in `modules/reports/src/index.ts` + `apps/api/src/app.module.ts` |
| Backend (fixes) | `modules/communications/src/campaigns/campaigns.dto.ts` (ROI null when no cost), `modules/reports/src/marketing-report/marketing-report.dto.ts` (ROI / rating null) + specs |
| Exports for reuse | `modules/customers/src/index.ts` (RetentionRepository, PERIOD_PRESETS, isUuid, types), `modules/communications/src/index.ts` (CampaignCenter) |
| POS | `POSMarketingLandingScreen.tsx` (+ test), `api/posMarketingGrowthApi.ts`, `POSCampaignCenterScreen.tsx` (`?assistant=<goal>` opens its assistant), `ns/mktgrowth.{en,vi}.ts`, `ns/index.ts`, `ns/errors.{en,vi}.ts`, `styles.css` |
| Contracts / generated | `packages/api-contracts/src/errors.ts` (`MKT_GROWTH_INVALID_FILTER`), owner/tech error catalogs, openapi manifest, attack-surface docs |
| Harness | `mg-extra.mjs`, `interact-mg.mjs`, wired in `live-server.mjs` / `interact.mjs`; isolation fixes in `interact-seg.mjs`, `seg-extra.mjs`, `interact-cc.mjs`, `interact-do.mjs`, `interact-promo.mjs`; screenshots `results/mg-e2e/` |

Routes (all tenant-scoped from the session; branch visibility = `RetentionRepository.branchScope`):
`GET reconciliation` (pos.marketing.view) · `GET search` (view; customer / gift-card hits audited) · `GET activity` (view) ·
`GET journey/:customerId` (view + customers.view; audited fail-closed) · `GET economics` (pos.marketing.manage).

## 2. Codebase audit (what each photographed number really was)
| Screen value | Source before | Finding |
|---|---|---|
| Campaign revenue $0.00 | `campaigns.revenue_cents` (hand-typed) via the old Marketing Report | typed figures nothing proves; now Campaign Center's code-attributed revenue |
| Campaign ROI 0x | `campaigns.dto` `avgRoi = 0` when cost = 0; formula was revenue ÷ cost (ROAS) | **defect fixed**: unknown → null → "N/A"; Campaign Center ROI = (revenue − provider cost) ÷ cost |
| Active promotions / redemptions | SalonPromotions service | now `/pos/discounts/kpis` (the ledger Promotions uses) |
| Avg rating 5★ / 4 reviews | reviews (all rows, spam included, max 1,000) | "0 ★" with no reviews **fixed** → N/A; spam inclusion + 1,000 cap reported by GATE 0 |
| Loyalty 2 members / 1,298 points | `customer_loyalty_profiles` of the session branch + no-branch rows, ≤ 5,000 rows, negatives as 0 | invariant Σ balance = Σ `loyalty_ledger.delta` (migration 540) checked; scope caveats reported |
| Referrals 2 codes / 0 / $0.00 | `customer_referrals`, `referral_redemptions` | self-referrals counted in the published value (defect); duplicate referred customers are blocked by `ux_referral_redemptions_referred` |
| Gift cards 0 / $0.00 | `gift_cards.balance_cents` (active, partially_redeemed, frozen) | checked against the last `gift_card_transactions.balance_after_cents` per card |

## 3. KPI reconciliation (GATE 0) — `GET /pos/marketing-growth/reconciliation`
Per section: formula, scope caveats, values, defects (code, severity, amount, unit, source, owner, remediation status).
Loyalty also returns the roll-forward `opening + earned + redeemed + reversed + adjusted + merged = closing` (expiry 0 by
construction: the ledger has no expiry type) and keeps AI PowerSalon Rewards (global network) separate.
**Harness result:** loyalty Σ balances 1,462 vs Σ ledger 1,298 → defect `loyalty_balance_vs_ledger` (two older harness
profiles with no ledger rows). This is exactly the class of gap GATE 0 must surface; the 1,298 seeded points reconcile.

## 4. Database migrations and rollback
None. Rollback = revert the commit (no schema to undo).

## 5. API / event changes
New read-only routes above; one new error code `MKT_GROWTH_INVALID_FILTER`. `campaignRoi` / `avgRoi` / `averageRating` may now
be `null` (old Marketing Report clients showed `null` as an empty value; the POS screens render N/A). No events.

## 6. Search / date / pagination evidence
Grouped search (customers, campaigns, offers, loyalty, referrals, gift cards, reviews), masked contact details, gift cards
only by an exact last 4 / exact reference (no balance), text never in the URL. Activity: salon-local dates (23:30 New York
counts on that day), From ≤ To enforced, presets Today / Week / Month / Year / Custom / All, 10/20/50 rows, newest first with
`id desc` tie-break, filters reset to page 1, state in the URL.

## 7. Loyalty / referral / gift-card reconciliation
See §3. Economics (`GET economics`) adds program costs: promotion discount given, referral rewards (self-referrals
excluded), loyalty reward value (unvalued redemptions counted separately).

## 8. Three upgrades
| Upgrade | Status | Notes |
|---|---|---|
| Smart Marketing Campaign Assistant | COMPLETED_AND_VERIFIED (as a reuse) | the dashboard opens Campaign Center's assistant on the chosen goal (`?assistant=`); proposals and drafts only; approval-gated launch and send-time consent checks are Campaign Center's (guide 5). Never-visited customers are excluded from win-back. |
| Marketing Cost & Profit Dashboard | COMPLETED_AND_VERIFIED | per-campaign rows from Campaign Center; unknown cost → N/A (never $0); gross-revenue ROI and ROAS named separately; no margin / profit (service costs are not recorded); Σ rows = totals checked |
| Customer Marketing Journey | COMPLETED_AND_VERIFIED | timeline with source table per event, consent state, shared-phone notice (never merged), Open Booking (same handoff as Segments), audited view, Close + Escape |

## 9. Tenant / permission audit
Every query filters `tenant_id` from the session; another salon's customer is invisible (search, journey 404); branch-confined
users get 403 `BRANCH_NOT_AUTHORIZED` for other branches; economics refused to Front Desk (403); journey and sensitive
searches write audit rows fail-closed.

## 10. CI / test output (31 Oct 2026, ~04:40 UTC)
| Suite | Result |
|---|---|
| `marketing-growth.pgtest` (stand-in runner, real Postgres 16) | 20/20 |
| `campaigns.vitest` (ROI null) · `marketing-report.vitest` (ROI / rating null) | 10/10 · 4/4 |
| Regression: segments 13/13 · campaign-center 14/14 · discounts-screen 6/6 · promotions-center 13/13 · coupon-center 18/18 · deals-center 20/20 · retention 10/10, 12/12, 14/14 | all pass |
| Marketing & Growth E2E (`interact.mjs mg-e2e mg`) | 11/11 |
| Combined marketing E2E (`seg,cp,do,promo,cc,mg` in one run) | 80/80 (Segments harness isolation fixed: was 10/11) |
| Gates: 51 `npm run check:*` + 6 via the stand-in (sql, types-drift, sql-identifiers, db-ownership, unique-tenant-review, actor-stamp) | all pass |
| `lint`, `boot`, `api-contract`, `strict-bodies-types` | IMPLEMENTED_NOT_VERIFIED — cannot run here (modules not installed; registry unreachable) |
| POS / API type-check, `POSMarketingLandingScreen.test.tsx` | IMPLEMENTED_NOT_VERIFIED — needs CI |

## 11. Screenshots
`tooling/catalog-one-screen/results/mg-e2e/` — preserved screen, data checks, journey, activity, economics, assistant,
Vietnamese, and 1920×945 / 1536×864 / 1440×900 / 1366×768 / 1024×768 layouts.

## 12. ASUS physical testing
NOT PERFORMED — browser viewports only (Chromium). BLOCKED_EXTERNAL.

## 13. Outstanding blockers / risks
- In this harness the Loyalty / Referrals / Gift Cards / Marketing Report state routes are not served (their repositories
  need the Kysely query builder). The dashboard correctly shows "could not be loaded" for them, but their tiles are verified
  only through the unit test (CI) and the reconciliation endpoint (which reads the same tables directly).
- Published loyalty card scope (session branch + no-branch profiles, ≤ 5,000, negatives as 0) and the review card (spam
  included, ≤ 1,000) are reported as defects / caveats, not changed — those cards belong to the Loyalty and Reviews modules.
- Associated (non-code) campaign revenue is not measured; only code-attributed revenue is shown.
- Social Content / Request Review flows are unchanged (their own modules); quick actions route to them.

## 14. Production deployment and rollback
No migration. Deploy = ship the API + POS build (owner approval required). Rollback = revert the commit.

## Open owner decisions
1. Should the Loyalty card read tenant-wide (all branches) instead of the session branch + no-branch profiles?
2. Should spam reviews be excluded from the published average rating?
3. Who may see Marketing Cost & Profit — owners/managers (`marketing.manage`, current) or a narrower permission?
