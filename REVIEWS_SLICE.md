# Reviews / Reputation — real full-stack slice (2026-07-06)

Audit-first: the `reviews` table already exists AND is in kysely.types (ReviewsTable), but had NO
API/module. Built the module + a reputation-management screen. No migration needed.

## Backend — new module apps/api/src/reviews/
- reviews.dto.ts — pure `buildReviewsSummary()`: average rating (1 dp), 5..1 star distribution (rounded),
  public/hidden/with-comment counts, and 5-star share (>= 4.5).
- repo (port + in-memory) + kysely adapter (tenant/branch scoped; LEFT JOINs technicians for the display
  name; review_tags jsonb normalized to string[]).
- service: getState + setVisibility (hide requires a reason; unhide clears it).
- controller: GET /pos/reviews/state (pos.marketing.view); POST /pos/reviews/:id/visibility
  (pos.marketing.manage).
- ReviewsModule registered in AppModule.

## Frontend
- api/posReviewsApi.ts + screens/POSReviewsScreen.tsx — average-rating KPIs, star-distribution bars,
  and a review feed with manager hide/unhide (reason prompt). Wired /tenant/marketing/reviews;
  registered in EXISTING_ROUTES.

## Verification (honest, on real Postgres)
- API: tsc 0 · build clean · DI_GRAPH_OK · **3035/3035** (+5 new).
- Live E2E on seeded PG: anon 401; kpis correct (4 reviews → avg 3.4, distribution [5:2,3:1,1:1],
  public 3, hidden 1, 5-star share 50%); hide-without-reason → 400; hide-with-reason works; hiddenCount
  1 → 2 after hiding; **tenant isolation confirmed** (second tenant sees 0).
- pos-web: tsc 0 · build clean · lint clean · **374/374** (+4 new screen tests).

## Sidebar tally
55 → **86** items on real screens.
