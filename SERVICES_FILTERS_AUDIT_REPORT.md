# POS Services Screen — Filter Audit Report (2026-07-03)

**Screen:** `apps/pos-web/src/screens/POSServicesScreen.tsx` (592 lines) — the service catalog dashboard. This is a
follow-up pass focused on filter completeness (an earlier audit covered the screen's core wiring; see
SERVICES_AUDIT_REPORT.md).

## 1. Method
Lint-first sweep, then a control-by-control trace against real backend endpoints, verifying each control does something
the API actually honors (honest verification — never wire a control the backend ignores).

## 2. Lint sweep
`eslint POSServicesScreen.tsx` → **0 warnings**. No orphaned-declaration signal; defects here are semantic.

## 3. What was already correct (verified, not assumed)
This screen is genuinely well-built. Confirmed wired to real endpoints:
- **Create / Edit / Save / Archive / Reactivate** -> `posServicesApi` -> `POST /pos/services`, `PATCH /pos/services/:id`,
  `POST .../archive`, `POST .../reactivate`.
- **Add category** -> `POST /pos/services/categories`.
- **CSV import** -> `POST /pos/services/import/preview` then `.../commit` (real two-phase import with a live preview).
- **Search + category + status filters** refetch server-side against `/pos/services/state`.
- **All navigation targets verified as real routes:** `/services`, `/reports` (registered in `App.tsx` lines 78/100
  and the canonical nav targets in `tenant-nav.tsx`), `/tenant/inventory`, `/tenant/services/packages`,
  `/tenant/services/pricing`. None are dead stubs — checked each against the route table.
- Retail/inventory, bundles, and AI-insights modules all load from real APIs with shape guards (honest empty on
  mismatch, never fabricated).

## 4. The finding — orphaned data-quality filters (backend-implemented, no UI)
Same orphaned-facet pattern as the Technicians screen, but with higher operational value. The `/pos/services/state`
response ships a `filterFacets` object and the `ServiceFilters` DTO accepts a large filter set, but the frontend only
sent `search` + `categoryId` + `status`. I traced every candidate filter through `filtersFrom()` (controller) into
`filtered()` (repository) to separate *implemented* from *accepted-but-ignored*:

| Filter | Controller parses | filtered() implements | Decision |
|---|---|---|---|
| search, categoryId, status | yes | yes | already wired |
| **missingMapping** | yes | yes (activeMapping.length===0) | **surfaced (new)** |
| **missingPrice** | yes | yes (basePriceCents===0) | **surfaced (new)** |
| **missingDuration** | yes | yes (durationMinutes===0) | **surfaced (new)** |
| onlineBookingEnabled, aiBookingEnabled | yes | yes | left (edit drawer already exposes per-service) |
| priceMin/Max, durationMin/Max | yes | yes | left (range UI is a larger addition; noted) |
| taxable | yes | NO (ignored) | not surfaced |
| bookingEnabled | yes | NO (ignored) | not surfaced |
| checkoutEnabled | yes | NO (ignored) | not surfaced |
| technicianSkillGroup | yes | NO (ignored) | not surfaced |

## 5. The fix
Surfaced the three **catalog-hygiene** filters — the highest-value implemented-but-hidden ones, because at a large
catalog these are exactly what an owner needs to find and fix booking-blockers:
- **Missing technician mapping** — services no active technician can perform (can't be booked).
- **Missing price** — unpriced services (can't be checked out).
- **Missing duration** — services with no duration (break the booking grid).

Rendered as a single mutually-exclusive dropdown ("All services / Missing technician mapping / Missing price /
Missing duration"), wired through a new `queryArgs()` builder as `missingMapping=1` / `missingPrice=1` /
`missingDuration=1`. Verified end-to-end: the repo's `bool()` treats `'1'` as true, and `buildUrl` only sends the
selected key. The KPIs on this same screen already count these gaps (`servicesWithoutTechMapping`,
`servicesMissingPrice`, `servicesMissingDuration`) — now the numbers are actionable: click to see exactly which
services need fixing.

## 6. Verification (fresh runs)
- **Typecheck:** pos-web `tsc` **0 errors**.
- **Lint:** `POSServicesScreen.tsx` **0 warnings**.
- **Tests:** `POSServicesScreen.test.tsx` **6/6** (was 5; +1 asserting the data-quality filter refetches
  `/pos/services/state` with `missingMapping=1`).
- **Full pos-web suite:** **301/301 across 64 files** (the benign `scrollIntoView` jsdom notice from
  POSBookingScreen.test.tsx still makes the runner exit 1 — not a failure).
- **Build:** pos-web build **clean** (~5s).
- **Backend:** no backend change — controller + repository already parse and honor all three filters.

## 7. Files changed
- `apps/pos-web/src/screens/POSServicesScreen.tsx` — added `dataQuality` state, a `queryArgs()` builder, and the
  catalog-hygiene filter dropdown.
- `apps/pos-web/src/screens/POSServicesScreen.test.tsx` — +1 test.

## 8. Deliberately NOT changed (and why)
- `taxable`, `bookingEnabled`, `checkoutEnabled`, `technicianSkillGroup`: accepted by the DTO but **not implemented**
  in `filtered()`. Not surfaced — surfacing them would imply filtering that never happens. Same backend DTO/impl gap
  flagged on the Technicians screen; worth closing in the repository if these are wanted as real filters.
- `priceMin/Max`, `durationMin/Max`: implemented, but a numeric range UI is a larger addition than this audit's scope;
  noted as a candidate enhancement.
- `onlineBookingEnabled` / `aiBookingEnabled`: implemented, but the per-service edit drawer already exposes these as
  the primary interaction; a list filter is lower value and was left out to avoid filter-row clutter.

## 9. Net outcome
One real, high-value defect closed honestly: three backend-implemented catalog-hygiene filters that were computed but
never usable are now wired end-to-end and tested, turning the screen's existing "missing X" KPI counts into actionable
drill-downs. Accepted-but-unimplemented filters were correctly left unsurfaced with the DTO/impl gap documented.
