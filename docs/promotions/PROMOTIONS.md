# Marketing → Promotions — Promotions Management Complete Build Guide (30 Oct 2026)

Route `/tenant/marketing/promotions` (unchanged). Guide 4 of 15; it builds on guide 2 (`COUPONS_PROMOTIONS.md`) and guide 3 (`DEALS_OFFERS.md`).
Local commit only: nothing was pushed, deployed, sent or charged. Migration 738 is applied to the local test template only.

## Root causes found
- **One record, no second engine.** A salon promotion IS a coupon: a `deals` row (kind `coupon`), its hashed code in `deal_coupon_codes`, and the `deal_redemptions` ledger. The old screen was a thin client over the legacy `pos/salon-promotions` adapter:
  - KPIs were computed in the browser from the first 500 rows.
  - There was no search, calendar or pagination.
- **Scheduled shown as Active.** The legacy adapter mapped `scheduled → active`, so a promotion published to start later showed as Active.
- **Activate skipped every recheck.** The legacy Activate (paused → active) was a raw `UPDATE`: no end-date check, no used-up-cap check, no audit row. Fixed: it now re-checks dates and the cap (same rules as `DealsService.resume`), and the change goes through `KyselyDealsRepository.transitionStatus`, the one conditional write that also writes the lifecycle audit row.
- **Save & activate (new in this build).** A salon promotion's lifecycle is draft → submit → approve → publish. Publish alone is refused from Draft (found by the E2E), so Save & activate runs the three server-checked steps and reports the real outcome.

## What was built (reuse map)
| Need (guide §) | Where |
|---|---|
| Screen §01–§04, §07 | `apps/pos-web/src/screens/POSPromotionsScreen.tsx` rebuilt in place; see breakdown below |
| Library / KPIs / Redemption History / details / exports §05, §12, §14 | existing `pos/discounts/*` (`discounts-screen.ts`) + **new** branch filter (library and history) + **new** booking-ID search in history (via `pos_queue_items.appointment_id → ticket`) |
| Create / edit / preview / lifecycle §08–§09 | existing `pos/deals/*` (`DealsService`, audited); `DealWizard` gains an optional **Save & activate** |
| Duplicate / assistant draft / campaign links / health | existing `pos/coupons/*` (`coupon-center.ts`) |
| §11 Check Promotion (logged) | **new** `POST pos/promotions/:dealId/check` → `CouponCenter.check` → `DealsCheckoutService.check` (Checkout's own engine), then one insert into `promotion_eligibility_checks` |
| §05 scope "Eligibility Checks" | **new** `GET pos/promotions/eligibility-checks` (customer name / phone / email / ID, promotion, ticket #; verdict; salon-day range; pages) |
| §14 trends / top / branch / service | **new** `GET pos/promotions/trends` (daily / weekly / monthly, completed redemptions only; service sales labelled *associated*) |
| §13 assistant with approval | **new** `POST pos/promotions/assistant/suggest` = coupon assistant (rules-v1, no AI provider) + 7 safety flags + a message preview (not saved, not sent). Saving = existing draft route |
| §12 Audit tab | **new** `GET pos/promotions/:dealId/activity` (audit_logs: actor, time, before → after, version; assistant origin) |
| Data | migration `738_promotion_eligibility_checks.sql` (insert-only log; additive; rollback = drop the table, nothing else depends on it) |

Screen breakdown (`POSPromotionsScreen.tsx`):
- **Kept from the screenshot:** the title and the 5 cards (with Discount value redeemed added), New Promotion, and the Code / Name / Discount / Redemptions / Status columns with row Pause / Resume / Archive. Archive asks first.
- **Header:** Check Promotion and View Redemption History.
- **Search and filters:** scope tabs Promotions | Redemption History | Eligibility Checks | Insights | Check System. Filters are status, type, branch and service, plus Clear Filters.
- **Calendar:** month calendar with date basis Created / Starts / Ends / Updated / Active during range (Redemption completed in history).
- **Paging:** numbered pages with 10 / 20 / 50 rows, newest first. The URL keeps scope, query, filters, period, page and size.
- **Details overlay:** adds Activity, Campaign links, Open Customer, and Open Ticket (`/checkout?ticket=`, where the receipt is).
- **Language:** EN + VI via `ns/promotions.{en,vi}.ts`.

## Decisions
- **Pause racing Checkout (§09).** The rule is deterministic and unchanged. Checkout's reservation reads the status under the deal row lock (`SELECT … FOR UPDATE`), and Pause updates the same row, so the two serialize. An application reserved before the pause committed stays on its ticket and is honoured at payment, counted once. A later one is refused "not available".
  - Proven on real Postgres with four sessions over three rounds.
  - A forced interleaving (judged while active → paused → reserve) is refused.
  - With the reservation's status guard removed, that test FAILS (mutation check), so it guards the rule.
- **Use counts.** The engine counts a use only at payment. An unpaid or abandoned ticket holds a ledger row (`applied`) but no use, and releasing gives it back.
- **Checks are logged.** This answers "only customers with actual eligibility evaluations". A check never reserves, counts, sends or charges.
- **Policy gaps kept as is (§15).**
  - Stacking: the salon's existing policy (`deal_settings`).
  - Rounding: down to the cent (guide 2).
  - Tax, commission, partial payment and refund recovery: unchanged Checkout behaviour. No new economic rule was invented.
- **Assistant safety flags.**
  - Checked ones: discount size, exposure bound, overlapping live/scheduled promotions, marketing-consent counts, texting-number readiness.
  - **Not checked**, shown as such: staffing (no capacity forecast exists) and service cost (no cost per service is stored).
- **Campaign links (existing).** Only campaigns linked through generated code batches count; a message that merely mentions the offer is not a link.

## Overlap with other guides
- **Shared components:** Coupons (`POSCouponsScreen`) and Discounts keep their behaviour. They only gained optional props: `Actions.confirmArchive`, `CheckDialog.doneNote`, `RedemptionsTable.onTicket`, `DiscountDetailsDialog.onTicket`, `DealWizard.onActivate`, and the assistant dialog renders safety / preview when an API returns them.
- **Campaign Center (guide 5)** owns sending. Promotions only shows a message preview.

## Handoff (guide §21)
| Item | Status | Evidence |
|---|---|---|
| **Code & data** | COMPLETED_AND_VERIFIED (locally) | Commit (this one). Migration 738, applied twice to the `aps` template (idempotent). API contracts: 5 new `pos/promotions/*` routes, `branchId` on `pos/discounts` + `/redemptions`. Flags: none new (deals kill switch / plan limits unchanged). Rollback: revert the commit, drop the table. |
| **Bug audit** | COMPLETED_AND_VERIFIED | Root causes above; each is covered by `promotions-center.pgtest` (legacy scheduled / ended / cap / audit) and the E2E (Save & activate). |
| **Features** | COMPLETED_AND_VERIFIED in Chromium; IMPLEMENTED_NOT_VERIFIED for the type-check | Search, date picker, paging, Create / Edit / Save & activate, state controls, overlays, checker, assistant approval: E2E 15/15. |
| **Financial proof** | COMPLETED_AND_VERIFIED | $100 ticket → $20.00 off → $80.00; applied → paid → one redemption, replayed callback adds nothing; refund reverses with history kept; trend totals = ledger (pgtest 13/13; E2E step 4; race 5/5 + mutation). |
| **Tests** | see below | Commands, exit codes and counts below. |
| **27-inch physical check** | BLOCKED_EXTERNAL | Only Chromium viewports ran: 1920×945, 1536×864, 1366×768, 1280×720, 1024×768. The physical ASUS at 100% zoom with Windows scaling needs the device. |
| **Deployment** | BLOCKED_EXTERNAL (owner approval) | Migration 738 to staging / production; no feature flag needed (additive, read / log only). |
| **Docs** | COMPLETED_AND_VERIFIED | This file and CONTINUE_HERE.md. |

Test results (31 Oct 2026, ~02:45 UTC):
- Stand-in runner, `bash tooling/full-system-test/unit-standin/run.sh $PWD <spec>`:
  - `promotions-center.pgtest` 13/13
  - `promotion-pause.postgres-race` 5/5, on real PostgreSQL 16 with 4 sessions (`PG_RACE_URL`)
- Regression:
  - coupon-center 18/18, discounts-screen 6/6, salon-promotions 8/8, deals-center 20/20
  - deals.pgtest 44/44, deals.core 33/33, approvals engine 7/7, kill switch 3/3, checkout core 5/5
  - verdict 19/19, eligibility 14/14, pricing 23/23, coupons 6/6, lifecycles 3/3, promotions-redemption 8/8
  - races: coupon-limits 3/3, deals-approvals 3/3
- Browser:
  - Promotions E2E `node tooling/catalog-one-screen/interact.mjs promo-e2e promo`: 15/15, screenshots in `tooling/catalog-one-screen/results/promo-e2e/`
  - Coupons 14/14, Deals & Offers 15/15, Discounts 7/7. Run `cp` and `do` separately: in one combined run, the Coupons steps' "vishal (copy)" draft confuses two Deals steps. That is a fixture interaction between the two suites, not a product defect.
- Gates: 29 `check:*` gates pass (incl. tenant, state-transitions, as-any, audit-writers for these files, money, dialogs, no-print, openapi, attack-surface, response-exposure), plus types drift, db-ownership, actor-stamp, unique-review and sql-prepare.
- **IMPLEMENTED_NOT_VERIFIED (needs CI):**
  - POS / API type-checks.
  - The rewritten `POSPromotionsScreen.test.tsx`; the old `.403` test was folded into it.
- **Failures in files outside this build** (seen in this session, not caused by it):
  - `check:dead-client`: `posCustomersApi.bySegment`, `posDealsApi.listKind`
  - `check:list-queries`: segments controller
  - `check:sql:select`: `retention-snapshots.ts`
  - `check:async-exports`: loyalty findings CSV
  - `check:audit-writers`: loyalty files
  - `check:sql` / `sql-identifiers` / `api-contract` / `strict-bodies-types`: environment (modules not installed)
- **Harness limit:** `/pos/services` answers 500 in the harness (its repository needs the query builder), so the service-filter options are empty there. The server-side filter itself is unchanged from guide 2.

## Full gate run (31 Oct)
The 29-gate list above was a subset. The full 61-gate run, its 5 fixes (from earlier guides) and the 4 gates that cannot run here are in `docs/GATES_2026-10-31.md`.

## Open owner decisions
1. **Front Desk access.** Front Desk has no Marketing access in the role policy, so Promotions shows a permission message (Checkout still applies codes). Should it get read-only access?
2. **Activation rights.** Save & activate lets an owner / manager submit, approve and publish their own promotion in one step. This is the salon-promotion lifecycle as it exists today (self-approval is blocked only for technician deals). Do you want two-person approval for salon promotions?
3. **Assistant wording.** The message preview is plain-English boilerplate. Decide whether Campaign Center templates (guide 5 / Message Templates) should replace it.
