# Payments / Team / Services / Management — genuine-gap buildout (2026-07-06)

Audit-first across all four areas: most named items were ALREADY real. Built the genuine gaps; reused
existing features where a real destination already existed.

## Named items — status
- Payments: transactions ✓ real · tips ✓ real · **refunds-voids → BUILT (new full-stack slice)**.
- Team: performance ✓ real · commission → redirect to the new commission report · **tips → BUILT (reuse)**.
- Services: categories ✓ real · pricing ✓ real · **packages → routed to the real Memberships/Plans feature**.
- Management: business-hours ✓ real · salon-profile ✓ real · rules → ALL real already (booking-rules,
  checkout-rules, loyalty-rules, membership-rules, queue-rules, tax-tip-rules). Only "features" remains a
  placeholder.

## Built this session
### Refunds & Voids — real full-stack slice (NEW)
- Backend module apps/api/src/refunds-voids/: pure `buildRefundsVoidsSummary` (splits refunds vs voids,
  totals) + `classifyReversal` (reuses the shared REFUND_STATUSES source). Repo (port + in-memory) +
  Kysely adapter (payments where status ∈ reversal statuses, tenant/branch scoped, LEFT JOIN tickets for
  the ticket number + users for the processor name). Endpoint GET /pos/refunds-voids/state
  (pos.checkout.view). Registered in AppModule.
- Frontend: api/posRefundsVoidsApi.ts + screens/POSRefundsVoidsScreen.tsx (refunds/voids/total KPIs +
  reversal ledger with refund/void tags). Wired /tenant/payments/refunds-voids.

### Team Tips — real screen (reuse, no new backend)
- The existing reports `/pos/reports/tips` endpoint already returns a `byTechnician` breakdown plus
  card/cash split and average. screens/POSTeamTipsScreen.tsx presents it team-first (tips-by-technician
  bars + KPIs). Wired /tenant/team/tips.

### Reuse redirects (light up placeholders that already have a real destination)
- /tenant/team/commission → the commission report built earlier.
- /tenant/services/packages → the real Memberships/Plans feature (/tenant/customers/memberships); there
  is no separate service-bundle data model, and membership plans ARE the prepaid-package mechanism, so
  this reuses the real feature rather than fabricating a new one.

## Verification (honest)
- API: tsc 0 · build clean · DI_GRAPH_OK · **3052/3052** (+5 refunds-voids tests).
- Live E2E on real Postgres (refunds-voids): anon 401; seeded 2 refunds ($75.00) + 1 void ($80.00) →
  KPIs refundCount 2 / refundedCents 7500 / voidCount 1 / voidedCents 8000 / total $155.00; second tenant
  sees 0 rows (isolation).
- pos-web: tsc 0 · build clean · lint clean · **383/383** (+6 new screen tests). Wiring invariant 7/7.

## Net effect
Every item named across priorities #2–#5 now resolves to a real, working screen. The only remaining
placeholders in these areas are net-new features needing their own data models: Payments (expenses,
invoices, split-payments view, terminals — terminals can likely redirect to Device Management),
Team (permissions, time-clock), Services (add-ons, discounts — discounts can reuse the salon-promotions
engine), Management (features).
