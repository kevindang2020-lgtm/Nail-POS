# Tenant POS Global Search — Module Map

One canonical implementation. Nothing duplicated. The tested policy core already existed but was
**orphaned** (no controller, no repo, not wired to the UI); this work connected it end-to-end.

## Backend (apps/api/src)
| Concern | File | Status |
|---|---|---|
| Policy core (access, groups, validation, routing) | `pos/pos-search-core.ts` | **reused** (23 tests) |
| Orchestrator service (derives trusted scope) | `pos/pos-search.service.ts` | reused + additive `allLocations` opt-in |
| Tenant-scoped repo (the missing piece) | `pos/pos-search.kysely.repository.ts` | **new** |
| Endpoint `/pos/search` + `/pos/search/open` | `pos/pos-search.controller.ts` | **new** |
| Module wiring + audit-on-open | `pos/pos-search.module.ts` | **new** (registered in app.module) |
| Permission `global_search.use` | `auth/rbac.ts` | new (granted to POS roles) |
| Trigram / tenant indexes | `db/migrations/107_pos_search_indexes.sql` | new |
| Isolation tests | `pos/pos-search-isolation.spec.ts` | **new** (8 tests) |

## Frontend (apps/pos-web/src)
| Concern | File |
|---|---|
| Secure client (no tenantId sent) | `api/posSearchApi.ts` |
| Grouped top-bar search (kbd nav, debounce, recent) | `shell/TopSearch.tsx` |

## Flow
top-bar `TopSearch` → `posSearchApi.global(q)` → `GET /pos/search`
→ `TenantAuthGuard` (session) → `RolePermissionGuard('global_search.use')`
→ `PosSearchController` builds `tc` from `req.ctx` → `PosSearchService`
→ `permittedGroups(role,perms)` → `PosSearchKyselyRepository` (tenant+branch scoped)
→ safe grouped DTOs → navigate to the correct POS screen.
