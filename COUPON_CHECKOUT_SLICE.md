# Coupon redemption at checkout — real integration (2026-07-06)

Makes the salon-promotions engine end-to-end usable: a coupon code can now be applied to a ticket at
checkout, with the discount computed and enforced server-side.

## Design constraint that shaped the approach
`CheckoutService` is hand-instantiated in **50** test files (`new CheckoutService(...)`). Changing its
constructor would break all of them. So the integration is fully additive and does NOT touch the
constructor or any existing tested method.

## Backend (additive)
- checkout.service.ts — NEW `applyPromotion(ctx, id, code, redeem)`. Computes the ticket subtotal from
  its lines, delegates code lookup + window/limit/min-purchase validation + server-side discount
  computation + redemption increment to an injected `redeem` callback, then persists the discount via the
  EXISTING `setDiscount` mechanism (so totals never drift). New `PromoRedeemer` type. No constructor change.
- checkout.controller.ts — NEW `POST /pos/checkout/tickets/:ticketId/apply-promotion`
  (pos.checkout.apply_discount). Wires `redeem` to `SalonPromotionsService.redeem`, deriving the promo
  context from the checkout context (tenant/branch server-derived).
- checkout.module.ts — imports SalonPromotionsModule so the service is injectable into the controller.
- The discount amount is persisted; the applied code is echoed in the response. There is no per-ticket
  promo-code column, so no persistence is fabricated (honest verification).

## Frontend
- api/posCheckoutApi.ts — `applyPromotion(tid, code)`.
- screens/POSCheckoutScreen.tsx — a Coupon-code input + "Apply Coupon" button beside the manual discount.
  On success the reloaded ticket detail shows the applied promotion via the screen's EXISTING promo
  display (code + amount + clear).

## Verification (honest, on real Postgres)
- API: tsc 0 · build clean · DI_GRAPH_OK · **3039/3039** (+4 applyPromotion tests; ZERO checkout
  regressions across the 3000+ suite).
- Live E2E (real ticket, subtotal $65.00):
  - anon → 401.
  - apply `fresh20` (20%) → 201, promotion {code: FRESH20, amountCents: 1300}, subtotal 6500 → 5200.
  - unknown code → 400 "No promotion found"; below-min promo → 400 "Minimum purchase not met"; blank → 400.
  - FRESH20 redemptionCount incremented to 1.
  - other-tenant applying on this ticket → 400 (not their ticket) — **isolation confirmed**.
- pos-web: tsc 0 · build clean · lint clean · **374/374** (checkout screen tests 11/11 unbroken).

## Note on the frontend test
The checkout screen test harness uses a global fetch mock with no ticket-selection helper; a focused
coupon-interaction test would need heavy scaffolding. The coupon path's logic is covered by the 4 service
tests + full E2E; the UI is wired, compiles, and reuses the already-tested promo display.
