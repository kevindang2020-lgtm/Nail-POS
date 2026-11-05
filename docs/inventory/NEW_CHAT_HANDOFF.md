# Inventory — Module Map

Canonical, single implementation. Existing inventory was only a trivial `inventory_items(name,quantity,
low_threshold)` table with no API — left untouched; the new system is additive.

## Backend (apps/api/src/inventory)
| Concern | File |
|---|---|
| Migration (8 tables) | `db/migrations/108_inventory_management.sql` |
| Pure stock core (counts, status, reorder, lifecycle guards, movement integrity) | `inventory-core.ts` (29 tests) |
| Tenant service (products, stock, bottles, tech reports, summary, alerts) | `inventory.service.ts` |
| Manager API `/tenant/inventory/*` | `inventory.controller.ts` |
| Technician API `/technician/inventory/*` | `technician-inventory.controller.ts` |
| Module (registered in app.module) | `inventory.module.ts` |
| Permissions | `auth/rbac.ts` (`inventory.*`, technician limited) |

## Frontend (apps/pos-web/src)
| Concern | File |
|---|---|
| API client | `api/inventoryApi.ts` |
| Inventory Overview (cards, products, bottles, reports) | `screens/TenantInventoryScreen.tsx` |
| Route `/tenant/inventory` | `App.tsx` |

## Built now (validated)
Categories, brands, vendors; products CRUD + archive; per-location stock; **individual bottle lifecycle**
(unopened→opened→low→empty/damaged) with movement + recompute; **technician reports + manager approval**;
summary KPIs; low-stock alerts; immutable movement ledger; audit on every mutation.

## Documented next phase (columns/permissions ready)
Purchase orders + receiving, stock transfers, physical counts, checkout/services consumption integration,
AI Inventory Assistant, full reports, barcode label generation, super-admin platform view.

---
## Handoff status
- Backend spine complete + validated (core 29/29, API tsc 0).
- pos-web Inventory Overview complete (tsc 0, build OK).
- Next phase (tables/permissions ready): purchase orders + receiving, transfers, physical counts,
  checkout/services consumption, AI Inventory Assistant, full reports, barcode labels, super-admin view.
- No new env vars required (Postgres only; barcode/storage optional and not yet wired).
