# MODULE_WIRING_MATRIX.md — end-to-end wiring status (generated from the merged code)

- **112 admin-web routes**, every one rendering an existing screen component (verified by tsc 0 on the import graph).
- **636 distinct admin client API paths** across `apps/admin-web/src/api/`; **635 resolve to a registered backend handler** by prefix+path match after parameter normalization. The single non-match is a scanner artifact (a nested template-literal query helper) whose route `GET /super-admin/membership-programs/members` was verified by hand in `membership-programs.controller.ts:47`.
- Backend authorization: every `/super-admin/*` controller is behind `SuperAdminGuard` (see ROUTE_INVENTORY.md guard column); tenant surfaces derive tenant identity from the session middleware — the tenant-isolation and auth-boundary suites lock this.

