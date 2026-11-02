# Sidebar wiring — Team → Profiles & Services → Categories (2026-07-06)

Scouted the Team/Services sections; both had clean existing backends. Two more real screens wired.

| Route | Screen | Endpoint | Gate |
|---|---|---|---|
| /tenant/team/profiles | POSTeamProfilesScreen | GET /pos/team/state | settings.view |
| /tenant/services/categories | POSServiceCategoriesScreen | GET /pos/services/state | pos.services.view |

- Team Profiles: KPIs (total members, active today, on shift, avg performance, services, commission)
  + member roster table (name, role, department, status, services, revenue).
- Service Categories: category KPIs + services-per-category chart + share-of-catalog table
  (reads state.categoriesSummary.categories).
- Both: loading / 403 / error / empty states, Champagne-Gold + Mac-fit. Added state/categories
  methods to posServicesApi; posTeamApi.getState already existed.

## Verification
- tsc 0 · build clean · lint clean.
- 4 new tests (render + 403, split into two files to avoid the vitest cross-test rejection quirk).
  Full pos-web **352/352**.
- Live E2E through real guards: both endpoints anon **401** / authed **200** with the shapes the
  screens read (team → {kpis, rows, …}; services → {kpis, categoriesSummary, …}).

## Sidebar tally
55 → **67** items on real screens.
- Reports 7/13 · Payments (transactions, tips, settlements) · Team (profiles) · Services (categories).
