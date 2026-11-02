# Coupons & Promotions Management Center — implementation handoff (guide of 30 Oct 2026)

Local commit on `merge-github-main` (not pushed; no deploy; migration 736 applied only to the local test template).
Statuses: COMPLETED_AND_VERIFIED · IMPLEMENTED_NOT_VERIFIED · BLOCKED_EXTERNAL · FAILED · NOT_IMPLEMENTED.

## 1. Repository, routes, files (before → after)
| Route | Before | After |
|---|---|---|
| `/tenant/marketing/coupons` | rendered `POSPromotionsScreen` (title "Promotions") | `POSCouponsScreen` — "Coupons & Promotions" |
| `/tenant/marketing/promotions` | `POSPromotionsScreen` | unchanged |
| `/tenant/marketing/deals` | `POSDealsScreen` | unchanged |

Changed / added:
- **API (deals module):**
  - `engine/coupon-verdict.ts` (new);
  - `engine/deals-checkout.service.ts`: `check()`, read-only;
  - `deals/deals.service.ts`: `resume` rechecks the cap and budget, and `duplicateDeal` is new;
  - `deals/deals.controller.ts`: `POST pos/deals/:id/duplicate`;
  - `salon-promotions/coupon-center.ts` (new): `pos/coupons/*`;
  - `salon-promotions/discounts-screen.ts`: KPIs gain total, archived, gross and reversed; the list gains the "active during range" date basis and `serviceId`;
  - `deals/deals.module.ts` and `request-schemas.ts`.
- **Migration:** `736_coupon_assistant_drafts.sql`. It is additive and insert-only.
- **Generated:** the openapi manifest, attack surface, `kysely.types.ts` and the ownership registry.
- **POS:**
  - `POSCouponsScreen.tsx` (new), with its unit test;
  - `api/posCouponsApi.ts`;
  - `i18n/ns/coupons.{en,vi}.ts`;
  - `POSDiscountsScreen.tsx`: shared pieces exported with optional extras, plus the owner Export permission fix;
  - `deals/DealWizard.tsx`: `initialKind` and `heading`;
  - `App.tsx` and `styles.css`.
- **Tests:**
  - `coupon-center.pgtest.vitest.spec.ts` (18);
  - `coupon-verdict.vitest.spec.ts` (19);
  - `coupon-limits.postgres-race.vitest.spec.ts` (3);
  - the `discounts-screen.pgtest` expectation now includes the new `archived` count.
- **Harness:** `tooling/catalog-one-screen/cp-extra.mjs` and `interact-cp.mjs`; `live-server.mjs` and `interact.mjs` are wired to them. Screenshots are in `results/cp-e2e/`.

## 2. Root cause: Coupons showed "Promotions", and whether vishal is duplicated
- **The title:** `App.tsx` mapped `/tenant/marketing/coupons` to the Promotions screen. Now Coupons has its own screen, and Promotions keeps its route.
- **The data model:** there is ONE coupon engine (BUILD_PLAN Phase 5).
  - A coupon is a `deals` row with `kind = 'coupon'`.
  - Its codes are stored hashed in `deal_coupon_codes`, which keeps only the last four characters.
  - Every use is recorded in the `deal_redemptions` ledger.
- **What reads that model:** the Promotions screen (`pos/salon-promotions`, a compatibility adapter), Services → Discounts and Marketing → Coupons (`pos/discounts`), and Deals (`pos/deals`) all read the same rows.
- **"vishal" is a single record.** Promotions and the Coupons library return the same ID: pgtest "one canonical record" and E2E step 2. Multiple views show it, but there is one ledger, so there are no competing balances.
- **No second redemption path:** `POST pos/salon-promotions/redeem` is a read-only quote. It writes nothing, and no screen calls it.

## 3. UI
| Item | Status | Evidence |
|---|---|---|
| Six cards from the server: Total (incl. archived), Active, Paused, Redemptions (completed only), Expiring Soon, Discount value (net, with gross and reversed) | COMPLETED_AND_VERIFIED | E2E 1 (cards equal `/pos/discounts/kpis`); pgtest §06 |
| Server search: exact code (hashed lookup, shown masked), name, ID, service, customer; redemption search by name, phone, ticket # or ID | COMPLETED_AND_VERIFIED | E2E 4, pgtest "beyond page 1" |
| From/To month calendar, presets, date basis created / updated / starts / ends / active-during-range (salon days, end date inclusive) | COMPLETED_AND_VERIFIED | E2E 5, pgtest date basis |
| Numbered pages with 10 / 20 / 50 rows, newest first, back to page 1 when filters change | COMPLETED_AND_VERIFIED | E2E 4, pgtest |
| Details overlay: Overview, Eligibility, Limits, Items, Redemptions, Codes, Financial, Related Campaigns, History; Close keeps filters | COMPLETED_AND_VERIFIED | E2E 6 |
| Create / edit with the existing deal wizard (server simulator); saving makes a draft | COMPLETED_AND_VERIFIED | E2E 9 |
| Lifecycle: submit, approve, activate, pause, resume, cancel, archive; duplicate | COMPLETED_AND_VERIFIED | E2E 7–8, pgtest §10 |
| EN / VI | COMPLETED_AND_VERIFIED | E2E 13 |
| 1920×945 · 1366×768 · 1280×720 · 1024×768 in Chromium, no sideways page scroll | COMPLETED_AND_VERIFIED (browser) | E2E 14; `results/cp-e2e/cp-*.png` |
| Physical ASUS 27″ at 100 % / Windows scaling | **NOT TESTED** — BLOCKED_EXTERNAL (hardware) | — |

## 4. API, search, lifecycle, eligibility codes, ledger links
- **Checker:** `POST pos/coupons/:dealId/check` takes either `{ticketId | ticketNumber}` or a hypothetical `{serviceIds, spendCents, customerId}`, plus `codeEntered`.
  - It uses the same `eligibilityFor` and `priceTicket` as Checkout's `candidate`, under the salon's stacking policy and beside the offers already on the ticket.
  - It writes nothing: no hold, no counter, no lookup-failure row. The pgtest compares a snapshot before and after.
  - Result codes: ELIGIBLE, NOT_YET_ACTIVE, EXPIRED, PAUSED, WRONG_BRANCH, INELIGIBLE_SERVICE, MIN_SPEND, LIMIT_REACHED, ALREADY_USED, REQUIRES_APPROVAL, CONFIG_MISSING, NOT_COMBINABLE, NEEDS_CUSTOMER, NEEDS_CODE, CUSTOMER_INELIGIBLE, NOT_AVAILABLE.
  - Any reason it doesn't recognise maps to NOT_AVAILABLE, so it never reports a false ELIGIBLE.
- **Lifecycle:** draft → submit → approve → publish (or schedule) → pause ↔ resume → cancel → archive (the existing DEAL machine).
  - Resume now refuses a coupon whose limit or budget is used up (`DEAL_SOLD_OUT` / `DEAL_BUDGET_USED`).
  - Duplicate creates a fresh draft. It never copies codes, counters, budget reservations or ledger history.
- **Ledger:** checkout reserves a coupon on the ticket as `applied`. When the ticket is paid it becomes `redeemed` once (idempotent), and only then does `redemption_count` move. A void or refund moves it to `reversed` or `partially_reversed`, keeping the history.
- **Related campaigns:** the link is `deal_coupon_batches.campaign_id`, the only stored connection between a coupon and a campaign.

## 5. Tests (executed 31 Oct 2026 ~01:50 UTC; PostgreSQL 16 + the repo stand-in runner, Chromium)
| Suite | Result |
|---|---|
| `coupon-center.pgtest` | **18/18** |
| `coupon-verdict.vitest` | **19/19** |
| `coupon-limits.postgres-race` | **3/3**, using four real Postgres sessions and `PG_RACE_URL` (details below) |
| Coupon E2E (`interact.mjs cp-e2e cp`) | **14/14** |
| Regression: `discounts-screen.pgtest` | 6/6 |
| Regression: `salon-promotions` | 8/8 |
| Regression: `promotions-redemption.pgtest` | 8/8 |
| Regression: `pricing` | 23/23 |
| Regression: `eligibility` | 14/14 |
| Regression: `coupons` | 6/6 |
| Regression: `deals.core` | 33/33 |
| Regression: `deals-checkout-core` | 5/5 |
| Regression: Discounts E2E (`extra`) | 7/7 |
| Gates: 14 npm `check:*`, actor-stamp, db-ownership, types drift, unique review, sql-prepare | all pass |

The pgtest covers the guide's checkout and lifecycle cases on the real schema:
- $100 → $20, $10 → $2 and $33.35 → $6.67;
- a coupon on an unpaid ticket is pending and not counted;
- applying twice gives one application;
- a repeated payment callback adds nothing;
- a full refund reverses it, a repeated refund does nothing, and the history is kept;
- the checker's verdicts;
- resume refusing a used-up limit, and duplicate;
- cards, search beyond page 1, newest first and the date basis;
- related campaigns, health and the assistant;
- cross-tenant denial.

The race suite (3/3) proves three things with real concurrency:
- a coupon capped at 2, applied at 10 registers at once, ends up on exactly 2 tickets;
- a single-use code goes to exactly 1 ticket;
- 8 simultaneous payment callbacks produce 1 redemption.

Mutation check: with both the advisory lock and `FOR UPDATE` removed from `ledger.apply`, the cap test fails. With them restored, it passes.

**IMPLEMENTED_NOT_VERIFIED (needs CI):**
- POS / API type-checks, because this environment has no React types and no Kysely query builder.
- `POSCouponsScreen.test.tsx`.
- The existing query-builder suites (`deals-engine.pgtest`, `deals-money-bugs.pgtest`, `deals-capacity.postgres-race`, `coupon-redeemed-producer.postgres-race`). They fail here only with "query builder is not available".

## 6. Rounding, stacking and money policy (kept, not invented)
- **Rounding:** discounts round **down** to the cent (`ruleDiscount`: `floor(base × pct / 100)`), so a coupon never gives more than its rate. $33.35 at 20 % is exactly $6.67.
- **Stacking:** the salon's existing policy, `best_single` by default. The checker reports NOT_COMBINABLE when a better non-stackable offer is already on the ticket.
- **Combinations with other benefits:** membership, loyalty and gift-card tender keep the order the one pricing engine already applies (bundle → membership → deal → coupon → manual → loyalty). This build did not change it.
- **Tax, tip, commission and surcharge:** unchanged.

## 7. AI assistant (draft only)
- `POST pos/coupons/assistant/suggest` is `rules-v1`, computed from this salon's last 90 days of paid tickets. **It makes no AI-provider call**, and the screen says the suggestion comes from the salon's own data. Goals:
  - slow weekdays;
  - a service to promote;
  - a second visit;
  - reconnecting inactive customers, which reuses Retention's At Risk days and excludes never-visited customers.
- `POST pos/coupons/assistant/draft` recomputes the suggestion on the server, so the client cannot claim what was "suggested". It saves the coupon as a **draft** and writes one `coupon_assistant_drafts` row with the basis, the suggested terms, the final terms and the edited fields.
- Activating the draft is the normal, permission-checked Publish step. Nothing is sent, and the E2E confirms that no campaign or notification is created.

## 8. Health (§19)
`GET pos/coupons/health` runs five verified checks:
1. counters match the ledger;
2. paid tickets marked their coupons;
3. no coupon is held on an abandoned ticket for more than 24 hours;
4. completed redemptions are on paid tickets;
5. the expiry job is not lagging.

Each result is Ready or Attention, or Unknown when its query fails; there is never a fake green. Problems are flagged, not rewritten.

## 9. Overlap with guides 3 (Deals & Offers) and 4 (Promotions)
- **Shared structure:** all three guides read the same `deals` table and the `deal_redemptions` ledger.
- **What later guides should reuse:**
  - the coupon center's checker (it works for any deal kind; only the route scopes it to coupons);
  - `DiscountDetailsDialog` extras;
  - `duplicateDeal`;
  - the resume limit recheck, which applies to every deal kind.
- **Not done here:** the Promotions screen (`POSPromotionsScreen`, 130 lines, on the frozen-adapter API) is left for guide 4. The Deals screen is left for guide 3.

## 10. Open owner decisions and blockers
- **Front Desk access:** under the existing role policy Front Desk has **no `marketing.view`**, so the Coupons screen shows a permission notice; codes are still applied at Checkout. The guide says reception "may search and redeem within authorization". Should Front Desk get read-only Coupons access? That is a role-policy change: owner decision.
- **Rounding:** confirm that rounding down per coupon is the documented policy. It is the existing engine behaviour.
- **Assistant:** confirm the starting values: 15 % (10 % for a second visit), 30 salon days, and one use per customer.
- **Latent bug fixed:** the client-side `useCan('pos.marketing.manage')` is literal, while real sessions carry the catalog key `marketing.manage`. That hid owner-only buttons, including the Discounts Export. I fixed it on the two coupon screens; the app-wide hook is unchanged. The other screens that use `pos.*` aliases in `useCan` should be reviewed.
- **BLOCKED_EXTERNAL:** physical ASUS testing, CI and staging runs (the push waits for K-12 steps 1–5), and the production migration (owner approval).
