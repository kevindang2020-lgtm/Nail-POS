# Salon Promotions / Coupons — real full-stack slice, built correctly (2026-07-06)

Rebuilt the feature I'd botched, this time with a disciplined process: thorough audit first
(grepped ALL @Controller routes, ls'd the dir, checked kysely.types + AppModule), create_file only
(fails on existing paths → no overwrite possible), and a DISTINCT namespace throughout so there is
zero collision with the pre-existing platform `promotions` module.

## Distinct namespace (no collision)
- Directory: apps/api/src/salon-promotions/ · Route: @Controller('pos/salon-promotions')
- Module: SalonPromotionsModule · Service: SalonPromotionsService · Table: salon_promotions (migration 319)
- Types: SalonPromotion*, kysely SalonPromotionsTable.

## Backend
- Migration 319_salon_promotions.sql — code, name, discount_type (percent|fixed), discount_percent /
  discount_cents (integer cents), min_purchase_cents, status (draft|active|paused|expired|archived),
  window, max_redemptions, redemption_count. Unique (tenant_id, lower(code)).
- salon-promotions.dto.ts — pure, tested: computeSalonDiscountCents (clamped to subtotal),
  salonPromotionRedeemable (active/window/limit/min-purchase), validateCreateSalonPromotion,
  buildSalonPromotionsSummary.
- repo (port + in-memory) + kysely adapter (tenant/branch scoped from ctx; atomic redemption increment).
- service: getState, create (dup-code guard), setStatus, redeem (server-computed discount).
- controller: GET /state (marketing.view); POST /, POST /:id/status, POST /redeem (marketing.manage).
- SalonPromotionsModule registered in AppModule (alongside, not replacing, PromotionsModule).

## Frontend
- api/posSalonPromotionsApi.ts + screens/POSPromotionsScreen.tsx — KPIs, portfolio table, create form,
  and pause/activate/archive actions. Wired /tenant/marketing/promotions; registered in EXISTING_ROUTES.

## Verification (honest, on real Postgres)
- API: tsc 0 · build clean · DI_GRAPH_OK · **3030/3030** (+8 new); platform promotions engine still 6/6.
- Live E2E full lifecycle on seeded PG: anon 401; create → 201; state lists it; redeem computed
  3120 = 20% of 15600 server-side and incremented the count; below-minimum rejected; duplicate code →
  400; **tenant isolation confirmed** (second tenant sees 0).
- pos-web: tsc 0 · build clean · lint clean · **370/370** (+4 new screen tests).

## Sidebar tally
55 → **85** items on real screens; three genuine backend slices this session (gift-cards, loyalty,
salon-promotions).
