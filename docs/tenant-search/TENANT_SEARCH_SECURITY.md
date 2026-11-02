# Tenant POS Search — Security Model

**The backend is the source of truth. Frontend filtering is not security.**

1. **Tenant from session only.** The controller builds the search context from `req.ctx`
   (`TenantAuthGuard`); it never reads `tenantId`/`branchId` from the query string. The service computes
   `scope = { tenantId: tc.tenantId, branchId: ... }`. A client cannot inject another tenant/location.
2. **Every query is tenant-scoped.** `PosSearchKyselyRepository.scope()` applies
   `tenant_id = scope.tenantId` to *every* query unconditionally, and `branch_id = scope.branchId` for the
   default current-location scope. Parameterized bindings only — no string-concatenated SQL.
3. **Location scope.** Default = current branch. `locationScope=all` (branchId dropped) is honored **only
   for OWNER/MANAGER**; receptionists/technicians stay pinned to their branch (cannot escalate).
4. **Role + permission gates.** `RolePermissionGuard('global_search.use')` + `hasPosSearchAccess` (role)
   + `permittedGroups` (per-group permission). A receptionist never receives owner-only groups.
5. **Safe DTOs.** Results carry only display/navigation fields. Never card numbers, CVV, tokens, gateway
   secrets, payroll, or internal notes. Transactions/receipts expose number + amount only.
6. **Fail safe.** Forbidden role → 403. Any per-group query error → empty list (never leaks existence).
7. **Separate from Super Admin.** This endpoint is tenant-only; the platform-wide Super Admin search is a
   different endpoint/permission. A receptionist cannot reach platform-wide data.
8. **No external/web search.** Pure internal POS data — never Google/Places/web. (Google Maps lives only
   in the salon-location settings module and is not connected to this bar.)

## Cross-tenant test results (pos-search-isolation.spec.ts — 8/8)
- All queries scoped to session tenant A; smuggled `tenantId:'B'` ignored.
- OWNER all-locations drops branch filter; RECEPTION cannot escalate.
- CUSTOMER role forbidden (no query runs); permission-limited role queries only permitted groups.
- Sub-2-char query never touches the repo.
