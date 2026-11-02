# Sidebar wiring — Services → Pricing & Team → Performance (2026-07-06)

Two more screens, reusing the state endpoints already wired (no new client methods, no backend changes).

| Route | Screen | Endpoint | Gate |
|---|---|---|---|
| /tenant/services/pricing | POSServicePricingScreen | GET /pos/services/state (services.items) | pos.services.view |
| /tenant/team/performance | POSTeamPerformanceScreen | GET /pos/team/state (performance, topPerformers) | settings.view |

- Service Pricing: service menu table (name, category, duration, price) + KPIs (count, avg, low, high).
- Team Performance: overall score, performance distribution chart, top-performers table.
- Both: loading / 403 / error / empty states.

## Verification
- tsc 0 · build clean · lint clean.
- 4 new tests (render + 403, split files). Full pos-web **356/356**.
- Endpoints already E2E-verified live through the real guards (401 anon / 200 authed) in the prior
  batch; these screens read fields within those confirmed responses.

## Sidebar tally
55 → **69** items on real screens.
- Reports 7/13 · Payments 3 (transactions, tips, settlements) · Team 2 (profiles, performance) ·
  Services 2 (categories, pricing).
