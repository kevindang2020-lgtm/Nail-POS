# Loyalty & Rewards — real full-stack feature slice (2026-07-06)

Audit-first: loyalty already had per-customer views, a rewards catalog, redemptions, and settings —
but NO program-wide management overview. Built that (mirrors the gift-cards slice).

## Backend — new read module apps/api/src/loyalty/
- loyalty.dto.ts — LoyaltyState + `buildLoyaltyOverview()` (pure, testable): member count, points
  outstanding (program liability), earned/redeemed totals, active rewards, redemption count/points, and
  tier distribution grouped + sorted by points. Points are integer counts.
- loyalty.repository.ts / loyalty.kysely.repository.ts — reuses existing tables:
  customer_loyalty_profiles (tenant+branch scoped), loyalty_rewards + loyalty_redemptions (tenant-only —
  scoped correctly per table). No new migration.
- loyalty.service.ts / loyalty.controller.ts — GET /pos/loyalty/state, guarded by TenantAuthGuard +
  RolePermissionGuard @RequirePermission('pos.customers.view').
- loyalty.module.ts — Kysely when Postgres present, else in-memory. Registered in AppModule.

## Frontend
- api/posLoyaltyApi.ts + screens/POSLoyaltyScreen.tsx — program KPIs, members-by-tier chart, rewards
  catalog, recent redemptions. Wired /tenant/customers/loyalty; registered in EXISTING_ROUTES.

## Verification (honest, on real Postgres)
- API: tsc 0 · build clean · DI_GRAPH_OK · **3022/3022** (+4 new loyalty tests).
- Live E2E on seeded PG: anon **401** / authed **200**; KPIs correct (2 members → 620 outstanding,
  920 earned, 1 active reward, 200 redeemed); tiers grouped/sorted; **tenant isolation confirmed**
  (second tenant sees 0 members).
- pos-web: tsc 0 · build clean · lint clean · **366/366** (+3 new screen tests).

## Sidebar tally
55 → **83** items on real screens.

## Note
Registering the module initially no-op'd because a substring check matched the unrelated
SuperAdminLoyaltyModule; caught it (grep showed only the super-admin module), then registered
LoyaltyModule explicitly. DI_GRAPH_OK + the live endpoint confirm it's wired.
