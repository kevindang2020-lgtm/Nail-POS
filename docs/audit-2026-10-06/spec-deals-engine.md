# `deals_engine` — spec vs code (Oct 6 2026, tree 7301539f)

Verdict: **PARTIAL, roughly 15–20%.** What exists is the earlier "Deals Marketplace" (salon/technician percent-or-fixed
deals, approval, technician policy, nearby feed, book-with-deal holds, checkout redemption) plus separate coupon modules. The
spec's engine (rules, eligibility, stacking policies, coupons, budgets, versions, integrations, audit) is mostly absent, and
there are **five parallel discount stores** and live money bugs (oversell, receptionists cannot apply deals, order-dependent
stacking, cross-tenant branch write, client-supplied prices).

Path legend: DS = `modules/deals/src/deals/`, DM = `modules/deals/src/`, CO = `modules/checkout/src/checkout/`,
MIG = `apps/api/db/migrations/`, POS = `apps/pos-web/src/`, CW = `apps/customer-web/src/`, TW = `apps/tech-web/src/`,
AW = `apps/admin-web/src/`, PERM = `packages/permissions/src/`.

## What the spec asks for
One `deals_engine` domain as the backend source of truth for all promotional pricing (POS, booking in all channels, customer /
owner / tech apps, AI receptionist, loyalty, membership, gift cards, wallet, marketing, reports, Super Admin; 10k+ tenants).
~45 deal types; nested AND/OR rule builder; eligibility engine with reasons; formal stacking (groups, four tenant policies,
best-deal, fixed calculation order); tax/tip/deposit/manual-discount/price-floor/budget/limit rules; atomic redemption
reservations and recalculation before capture; versioned deals with 10 statuses, threshold approvals, conflict detection,
wizard, simulator; per-line snapshots, deal-aware full/partial refunds, itemized receipts. ~28 tables, 17 services, ~27 APIs,
18 events, jobs, tenant-scoped cache, audit, analytics/reports/exports, abuse detection, AI deal builder. UI: POS checkout
deals section, 12 management pages + dashboard, customer Deals section, Super Admin oversight with kill switch, per-tenant
flags, plan limits. Tests incl. isolation, concurrency, load; 71-item completion checklist.

## Status by area
| Area | Requirement | Status | Evidence |
|---|---|---|---|
| Schema | deals, deal_services, deal_approvals, deal_redemption_holds, deal_redemptions, deal_saves, deal_analytics_events, deal_settings | DONE (subset) | MIG 387, 388, 389 |
| Schema | deal_versions, rules, rule_groups, actions, targets, branches, products, segments, schedules, channels, stacking_rules, coupons/codes/batches, redemption_items, budgets, campaign links, usage events, abuse alerts, daily analytics, branch settings | MISSING | coupon codes are plaintext one-per-row in salon_promotions (319) / tenant_promotions (257) |
| Schema | eligibility columns (days_of_week, valid minutes, lead, new/member only, min spend, deposit, max per customer, substitution) | PARTIAL | columns in 387 inserted/mapped, never enforced |
| Schema | pricing snapshot | PARTIAL | `tickets.discount_snapshot` (477) category/amount/description only; no deal id/version/per-line |
| Services | lifecycle | PARTIAL | DS `deals.service.ts:50-131` create/list/submit/approve/reject/pause/resume/publish; no update/clone/archive/cancel/expire; machine `deals.core.ts:36-48` |
| Services | eligibility / rules / explanation / preview | MISSING | reserve checks only `status==='active'` (142) |
| Services | pricing | PARTIAL | DS `deals-checkout-core.ts:9-21` percent/fixed on the whole ticket subtotal (CO `checkout.service.ts:374`); deal_services ignored |
| Services | stacking | PARTIAL | fixed order bundle→membership→deal→coupon→manual→loyalty (CO `checkout-discount-engine.ts:31-97`); deal side a single boolean |
| Services | coupons | PARTIAL ×2 | DM `salon-promotions/salon-promotions.service.ts:42-50` (used by POS); DM `promotions/promotions.service.ts` (limits + reversal, nothing calls it) |
| Services | reservations | PARTIAL (bug) | advisory-locked idempotent holds, DS `deals.kysely.repository.ts:201-222` |
| Services | budget, threshold approvals, campaigns, abuse, AI, analytics aggregation, jobs, cache | MISSING | holds expired lazily inside reserve (205); 30-s kill-switch memo only |
| Routes | `/pos/deals` list/get/create/submit/approve/reject/pause/resume/publish/settings/analytics | DONE (subset) | DS `deals.controller.ts:23-65` |
| Routes | update, clone, preview, archive, eligible, apply/remove, validate coupon, generate codes, redemption status, stacking settings | MISSING | — |
| Routes | `/tech/deals`; `/customer/deals` nearby/saved/:id/save | DONE | DS `deals.tech.controller.ts:23-37`, `deals.customer.controller.ts:15-41` |
| Routes | `/super-admin/deals` overview/list/suspend | PARTIAL | DS `deals.super-admin.controller.ts:8-18`; no admin-web client |
| Routes | checkout apply-deal / apply-promotion / apply-discount; booking with deal | PARTIAL | CO `checkout.controller.ts:51-67`; `customer-booking.service.ts:209-240` |
| Permissions | administration | PARTIAL | `pos.marketing.view/manage` → marketing.* (PERM `security-core.ts:64-90`); no deals.* keys; same key creates/approves/publishes (self-approval) |
| Permissions | apply at checkout | PARTIAL (bug) | apply_discount → `checkout.manage_overrides` (OWNER/MANAGER only, rbac 157-158,175) → receptionists 403 |
| Permissions | technicians cannot set pricing by default | DONE | policy default 'off' (`deals.core.ts:87-114`) |
| UI | POS management | PARTIAL | POS `screens/POSDealsScreen.tsx` minimal form (61-75), approval queue, lifecycle, 2 of 7 technician limits; no wizard/simulator/conflicts/dashboard |
| UI | POS coupons | PARTIAL | `POSPromotionsScreen` on salon_promotions routed twice (App.tsx:373,391); `POSDiscountsScreen` read-only copy |
| UI | POS checkout | PARTIAL | coupon field, manual discount, silent auto-apply of booked deals (`POSCheckoutScreen.tsx:117-119,155-161`); no eligible list/why-not/remove/best-deal |
| UI | Owner app | MISSING | — |
| UI | Tech app | PARTIAL | TW `screens/MyDealsScreen.tsx` percent only |
| UI | Customer app | PARTIAL | CW `screens/DealsScreen.tsx:12-81` nearby/save/book; no detail/saved/coupons/filters/terms; no discounted estimate in `BookScreen.tsx:67,313` |
| UI | Super Admin | PARTIAL | kill switch (AW `KillSwitchesPanel.tsx:9`), tech freeze (`GlobalTechniciansScreen.tsx:354-356`), registry row (471:22); no oversight screen |
| Realtime | checkout total refresh; technician notified on approve/reject | DONE | CO 395-398; DS kysely 324-328 |
| Events | domain events | PARTIAL | only `deal.redeemed`, `coupon.redeemed` (`event-contract.ts:75-76`), no consumers; 16 others missing |
| Security | tenant-scoped reads; global kill switch | DONE | DS kysely 124-140; `cross-tenant-suite.pgtest.vitest.spec.ts:57-59`; service 28-33 |
| Security | tenant-safe writes | PARTIAL (bug) | `branch_id`/`serviceIds` from the body never checked (108, 118-120) |
| Security | per-tenant enable/plan limits; coupon hashing/enumeration/rate limits; audit | MISSING | deals write no audit; checkout "audit" is an in-memory array (CO 75,140-142) |
| Tests | core/checkout-core/nearby/redemption/kill-switch specs, deals.pgtest, promotions specs, checkout apply specs, customer-booking-deal, deal-producer pgtest, UI tests | PARTIAL | none for BOGO, bundles, eligibility, stacking interplay, best deal, tax, deposit, refunds, budget, consumed-hold oversell, per-customer limits, abuse, cache, retry, audit, load; none for POSDealsScreen / MyDealsScreen |

## Five parallel discount stores
- `customer_deals` (045): nothing writes it, yet it feeds the customer Deals list (`customer.kysely.repository.ts:371`) and the customer-app AI receptionist.
- `salon_promotions` (319): the coupon path POS checkout uses; three POS nav entries.
- `tenant_promotions` + redemptions (257/258): richest model (limits, stacking policy, approval, reversal, coupon.redeemed); no tenant UI or checkout caller; Super Admin "Promotions & Offers" approves/disables on it.
- `deals` (387): the marketplace. `bundles` (133): catalog only.
- Discount math written four times (`computeSalonDiscountCents`, `computeDiscountCents`, `computeDealDiscountCents`, `computeFinalPriceCents`) plus client preview math in `POSDealsScreen.tsx:54-59`.

## Bugs
1. **Oversell.** Capacity counts only `status='held'` holds (kysely 213); consumed holds stop counting and `redemption_count` only rises at checkout (256) → a deal capped at N books without limit.
2. **Receptionists cannot apply deals** (403; POS swallows it, `POSCheckoutScreen.tsx:119`).
3. **Stacking order-dependent:** applyPromotion/applyDiscount re-mark a deal stackable (CO 335,358); exclusive deal does not block later stackables (engine 53-60); applyDeal hard-codes `stackable:false` (384); apply-deal response reports the total of all discounts (390).
4. **Redemption recorded too early and inflated** (at ticket selection, never reversed on void/refund; analytics event before the idempotency check, DS 213).
5. **Eligibility not enforced** (member/new-only, per-customer, min spend, day/time, deposit, technician lock, service scope).
6. **Date window ignored** (reserve 142; nearby ignores `starts_at` 171-173; nothing expires a deal).
7. **Cross-tenant write** via body `branch_id` (108, 168).
8. **Client-supplied `originalPriceCents`** drives the advertised price and the technician minimum (73,78).
9. **AI checkout upsell** passes an object where a redeemer function is expected (`ai-checkout-upsell.adapters.ts:108`) → TypeError (CO 355).
10. Coupon count race (no cap guard, increments on every apply, never decrements; `salon-promotions.kysely.repository.ts:60`).
11. Booking deal errors become 500s (`customer-booking.controller.ts:35-61`). 12. Cancel/no-show never releases the deal.
13. Checkout audit lost (in-memory). 14. Misleading "DISCOUNT Applied ×" chip (sums all, × clears only manual; `checkout.kysely.repository.ts:331`, POS 555-565).
15. Views never counted. 16. Nearby loads the newest 500 active deals platform-wide then filters in memory (174).
17. Super Admin suspend does not stop booked deals; no reason/audit (377-380). 18. `on_auto` puts technician deals in `approved`, not published (`deals.core.ts:65`).
19. Dead settings columns (allow_stack_loyalty/membership, editable_after_redemption). 20. `/customer/deals/*` not excluded from auth → guests 401 (`app.module.ts:205-213`). 21. Bad input (12.5%, 0%) → 500.

## Build order
1. Live money bugs: 1–5, 9–12.
2. Consolidate onto one `deals` domain: salon_promotions, tenant_promotions, customer_deals behind a compatibility adapter;
   coupons/codes model (hashed, single-use, bulk, rate-limited).
3. Eligibility + rule engine (enforce the flags, catalog prices, line-level allocation, explanation, preview).
4. Stacking policies, best-deal, price floors, budgets with atomic reservations.
5. Per-line snapshots, deal-aware refund/partial-refund reversal, itemized receipts.
6. Persisted audit, remaining events, jobs (activation, expiry, aggregation), per-tenant gating + plan limits.
7. UI (wizard/simulator, owner app, customer sections, POS eligible/why-not/remove, Super Admin oversight).
8. Integrations (loyalty, membership, gift bonus, wallet credit, marketing, AI receptionist, scheduling, forecasting, queue, QR, abuse, reports/exports).
9. Full test matrix + load.
