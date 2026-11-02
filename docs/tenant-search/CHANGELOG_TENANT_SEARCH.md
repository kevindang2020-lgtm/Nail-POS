# Changelog — Tenant POS Global Search

## Added
- `pos/pos-search.kysely.repository.ts` — tenant+branch-scoped repo implementing the SearchRepo port
  (customers, appointments, queue, tickets, receipts, technicians, services).
- `pos/pos-search.controller.ts` — `GET /pos/search`, `POST /pos/search/open` (session-derived scope).
- `pos/pos-search.module.ts` — wires the previously orphaned `PosSearchService` + audit-on-open. Registered.
- `auth/rbac.ts` — `global_search.use` permission (POS roles).
- `db/migrations/107_pos_search_indexes.sql` — pg_trgm + tenant/branch indexes.
- `pos/pos-search-isolation.spec.ts` — 8 isolation/escalation/injection-safety tests.
- pos-web: `api/posSearchApi.ts`; rewired `shell/TopSearch.tsx` to grouped global search.

## Changed
- `pos/pos-search.service.ts` — additive `allLocations` opt-in (OWNER/MANAGER only) + `scope` in response.
  Existing behavior unchanged for everyone else.

## Not duplicated
- Reused `pos-search-core.ts` (policy) + `PosSearchService` (orchestrator) + `scoped()` pattern. No
  GlobalSearchV2 / SearchFinal. Super Admin search untouched and kept separate.
