# Commission Report slice + Reports/area audit (2026-07-06)

## Context: audit-first found most of the requested list ALREADY exists
The requested build order named reports (sales, services, technicians, payments) that are ALREADY real,
backed screens. Rather than rebuild, I audited real-vs-placeholder across all five areas and built the
genuine gaps.

### Real vs placeholder (nav items → FeaturePage) BEFORE this session's additions
- Reports: 7 real (appointments, customers, payments, sales, services, tax, technicians) · placeholders:
  ai, commission, inventory, marketing, multi-location, payroll.
- Payments: 4 real · placeholders: expenses, gift-cards, invoices, refunds-voids, split-payments, terminals.
- Team: 4 real · placeholders: commission, permissions, time-clock, tips.
- Services: 2 real · placeholders: add-ons, discounts, packages.
- Management: 13 real · placeholder: features (1).

## Built this session
### Commission Report — real full-stack slice (NEW)
- Backend module apps/api/src/commission-report/: pure `buildCommissionReport` (per-technician rollup from
  the commission SNAPSHOTS on each ticket_service_line — the rate agreed at service time — plus ticket
  tips attributed to the primary technician) + `presetRange` (server-controlled today/week/month/quarter/
  year). Repo (port + in-memory) + Kysely adapter (tenant/branch scoped over tickets ⨝ ticket_service_lines
  ⨝ technicians). Reuses payroll's `computeCommissionCents`. Endpoint GET /pos/commission-report/state
  (pos.reports.view). Registered in AppModule.
- Frontend: api/posCommissionReportApi.ts + screens/POSCommissionReportScreen.tsx (KPIs + per-technician
  payout table with rate bars + period tabs). Wired /tenant/reports/commission.

### Reuse redirects (no duplication — light up placeholders that already have a real destination)
- /tenant/reports/payroll → existing payroll screen (/tenant/team/payroll).
- /tenant/team/commission → the new commission report (/tenant/reports/commission).
- /tenant/payments/gift-cards → existing gift-cards screen (/tenant/customers/gift-cards).

## Verification (honest)
- API: tsc 0 · build clean · DI_GRAPH_OK · **3047/3047** (+8 commission-report tests).
- Live E2E on real Postgres (seeded 2 techs, 2 tickets, 3 lines):
  - anon → 401.
  - Ana: 40% × $150.00 services = $60.00 commission + $12.00 tips = **$72.00 payout**, rate 40%.
  - Ben: flat $15.00 × 1 service = $15.00 commission + $8.00 tips = **$23.00 payout**, rate 18.8%.
  - KPIs: 2 techs, $230.00 service revenue, $75.00 commission, $20.00 tips, $95.00 payout, avg rate 32.6%.
  - Second tenant sees 0 rows — **isolation confirmed**.
- pos-web: tsc 0 · build clean · lint clean · **377/377** (+3 commission screen tests). Wiring invariant 7/7.

## Sidebar tally
86 → **88** on real destinations (commission real screen; payroll/team-commission/payments-gift-cards
resolve to real screens).

## Recommended next genuine builds (not yet done — deliberately not rushed)
1. **Refunds & Voids** (Payments) — money visibility; checkout already has refund/void logic + payments
   data. Highest-value real build.
2. **Team Tips** — the reports `/tips` endpoint already exists; a team-scoped tips view.
3. **Services → Packages** — the memberships/packages feature exists and can be surfaced.
4. **Services → Discounts** — can reuse the salon-promotions engine built earlier.
Remaining placeholders (permissions, time-clock, expenses, invoices, inventory, multi-location, ai,
marketing) are larger net-new builds needing their own data models.
