# SERVICES_AUDIT_REPORT.md — POS Services screen (2026-07-03)

_Audited POSServicesScreen (573 lines). It was lint-clean (no orphaned-declaration signal), so this was a deeper
wiring audit: does every capability the backend exposes have a real control on the screen? It found one genuine gap —
the service archive/reactivate lifecycle had a backend + a client method but no button to trigger it._

## 1. Modules and boxes found in the screen
KPI strip · Service Menu (search + category + status filters, inline Add New Service, per-row Edit) · Retail Product
Catalog · Bundles / Packages / Membership Add-ons · AI Pricing & Menu Insights · Inventory Alerts · Service/Product
Detail · Top Services & Product Mix · Service Mix by Revenue · Quick Actions · CSV import (preview/commit).

## 2. Problem discovered
- **Service archive/reactivate was unreachable from the UI.** `posServicesApi.archive` existed in the client and the
  backend exposed `POST /pos/services/:id/archive` **and** `POST /pos/services/:id/reactivate` (permission
  `pos.services.archive`), but **no control invoked them**. The edit row only offered Save, and the edit status
  dropdown only listed `active` / `inactive` — so a service could be toggled inactive via a plain status update, but
  the proper archive lifecycle (which preserves history and enforces dependency checks) could never be triggered, and
  an archived service could never be reactivated. `reactivate` wasn't even present in the client API.

## 3. Frontend files fixed
- `apps/pos-web/src/api/posServicesApi.ts` — added the missing `reactivate(id)` method (the backend route already
  existed).
- `apps/pos-web/src/screens/POSServicesScreen.tsx`:
  - Added `archiveService` (with a confirm, since archiving pulls a service from booking/checkout) and
    `reactivateService` handlers, wired to the real lifecycle endpoints.
  - Added an **Archive** button (active services) / **Reactivate** button (archived services) to the edit row next to
    Save, with per-row busy states.
- `apps/pos-web/src/screens/POSServicesScreen.test.tsx` — +2 tests.

## 4. Backend files fixed
**None.** Both endpoints already existed and are covered by the backend services suite. The archive path also busts
the tenant's category cache via the Phase 2 read-through cache added earlier (services writes bust categories).

## 5. Routes and APIs repaired
No routes added. The screen now *reaches* `archive` / `reactivate`, which were previously dead from the UI.

## 6. Database changes
None. Archive/reactivate mutate the existing tenant+branch-scoped service records through the guarded endpoints.

## 7. How each control is wired
Edit (per row) → expands inline editor. **Archive** → `confirm()` → `posServicesApi.archive(id)` →
`POST /pos/services/:id/archive` → refetch. **Reactivate** (shown when `!isActive`) → `posServicesApi.reactivate(id)`
→ `POST /pos/services/:id/reactivate` → refetch. Create/Save/status-filter/category-filter/search/CSV-import remain
wired to their real endpoints (verified, unchanged).

## 8. Test, typecheck, lint, and build results (fresh, this tree)
- **Typecheck:** pos-web `tsc` **0 errors**.
- **Tests:** Services screen **5/5** (3 prior + 2 new: Edit→Archive posts to `/pos/services/s1/archive`; an archived
  row offers Reactivate and posts to `/reactivate`). Full pos-web **298/298 across 64 files**; the lone exit-1 is the
  pre-existing jsdom `scrollIntoView` notice from POSBookingScreen.test.tsx — unrelated. Backend services suite
  **17/17** confirms the endpoints.
- **Lint:** changed files **0 warnings, 0 errors**.
- **Build:** pos-web production build **clean**.

## 9. Honest remaining issues
- Hard-delete (`canHardDelete`/`hardDelete` on the backend) is intentionally **not** surfaced — archive is the correct
  default for a service with history; a destructive hard-delete would need its own guarded confirmation flow and
  wasn't in scope for this audit.
- `setTechnicians` (technician-mapping) is exposed by the client API and reachable via the detail/mapping flow, not
  the edit row; left as-is.
- The bundles/products/inventory panels read from their respective real sources (inventory nav, bundles state);
  unchanged this pass.
- Verified against the in-memory adapter + backend suite; not exercised against live Postgres this session.
