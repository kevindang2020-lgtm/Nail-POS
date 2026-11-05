# Gift Cards — real full-stack feature slice (2026-07-06)

Not a placeholder wiring — a genuine backend + frontend slice. Audit-first revealed gift cards already
had transactional ops (issue/redeem/reload/void) in the checkout module and the gift_cards +
gift_card_transactions tables (migration 033), but NO tenant-wide management view. Built that.

## Backend — new read module apps/api/src/gift-cards/
- gift-cards.dto.ts — GiftCardRow, GiftCardsSummary, GiftCardsState + `buildGiftCardsSummary()` (pure,
  testable): counts by status, sums outstanding liability from ACTIVE balances only, issued total,
  redeemed value (initial − current, clamped ≥ 0). Money is integer cents throughout.
- gift-cards.repository.ts — port + in-memory adapter.
- gift-cards.kysely.repository.ts — Kysely adapter; tenant/branch scoping server-derived from ctx
  (the shared scoped() pattern), reusing the existing gift_cards table. No new migration.
- gift-cards.service.ts, gift-cards.controller.ts — GET /pos/gift-cards/state, guarded by
  TenantAuthGuard + RolePermissionGuard @RequirePermission('pos.checkout.view') (a read capability).
- gift-cards.module.ts — Kysely-backed when Postgres present, else in-memory (same DI pattern as reports).
  Registered in AppModule.

## Frontend
- api/posGiftCardsApi.ts + screens/POSGiftCardsScreen.tsx — outstanding-liability KPIs + a status-filtered
  card portfolio table. Wired /tenant/customers/gift-cards; registered in EXISTING_ROUTES.

## Verification (honest, on real Postgres)
- API: tsc 0 · build clean · DI_GRAPH_OK · **3018/3018** (3013 + 5 new gift-cards tests).
- Live E2E through real guards on seeded PG: anon **401** / authed **200**; KPIs computed correctly
  (2 cards → outstanding 11000, issued 15000, redeemed 4000); **tenant isolation confirmed** (a second
  tenant sees 0 cards).
- pos-web: tsc 0 · build clean · lint clean · **363/363** (3 new screen tests).

## Sidebar tally
55 → **82** items on real screens.
