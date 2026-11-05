# Super Admin — systemic list-pagination cap audit (audit-first hardening)

## The bug class
The platform list repo paginates with `const ps = Math.min(100, q.pageSize || <default>)` and the controller supplies a
small default page size (applications/leads/hardware = 25, users/audit = 50). Any screen that calls one of these endpoints
**without** sending a `pageSize` and **without** a pager renders only the first page while displaying the full `total` — so
rows past the default were silently unreachable.

## Blast radius (every screen hitting a paginated `/super-admin/platform/*` list)
| Screen | Endpoint | Status |
|---|---|---|
| `ApplicationsScreen` | applications (default 25) | **was affected → FIXED** (only 25 of 28 showed) |
| `UsersRolesScreen` | users (default 50) | **was affected → FIXED** (only 50 of N showed; worse with many tenants' customers) |
| `AuditLogsScreen` | auditLogs (default 50) | not affected — already has full pagination (page state, prev/next, `ceil(total/50)`) |
| `WebsiteLeadsScreen` | leads | not affected — built with its own pagination |
| `HardwarePackagesScreen` | hardware | not affected — built with its own pagination |
| `LeadsScreen` | leads | **dead/legacy** — not imported or routed in `App.tsx`; replaced by `WebsiteLeadsScreen`. No fix. |
| `HardwareScreen` | hardware | **dead/legacy** — not imported or routed; replaced by `HardwarePackagesScreen`. No fix. |

Net: exactly **two live screens** were affected; both fixed. The two unfixed call-sites are dead code (only old test
files import them); the live replacements paginate correctly.

## Fix applied (both screens)
- Request the repo's maximum page size (`pageSize: 100`) so the single-scroll queue/directory shows everything up to the
  hard cap, instead of the controller's small default.
- Add an honest "Showing first N of {total}" hint when the cap is reached, pointing the user at search / role / status
  filters to narrow the set (the filters already hit the backend, so narrowing returns the precise subset).
- `UsersRolesScreen` also had a misleading subtitle ("{total} shown" while only 50 rendered) — corrected to "{total} total".

## Wiring also verified during the audit (no rebuilds, no duplication)
- **Applications**: client `applications/applicationStatus/applicationNote/applicationConverted` ↔ controller routes with
  matching `{status}`/`{text}`/`{tenantId}` bodies; repo returns raw snake_case columns that line up with the screen's reads.
- **Users**: client `users/roles/createSuperAdmin/disableUser/enableUser/resetUserPassword` ↔ controller routes
  (`users/:id/disable|enable|reset-password` all exist); the `users()` repo joins tenants and maps to the camelCase the
  screen reads (`fullName`, `mfaEnabled`, `tenantName`, `lastLoginAt`) — no blank-cell bug. The one-time temp password is
  surfaced once (only the scrypt hash is stored).

## Tests added (9 total, all pass)
- `ApplicationsScreen.test.tsx` (4): page-size request + cap hint, Approve Package via the real status route, Add Note,
  status-tab filtering.
- `UsersRolesScreen.test.tsx` (5): page-size request + cap hint, role-tab filtering, Disable user, Create Super Admin
  (temp password surfaced), Reset Password (temp password surfaced).

## Honest remainder
- For directories that can exceed 100 (notably all-customers in `UsersRolesScreen`), the queue is capped at 100 (the repo's
  hard limit); a full server-side pager is the real long-term answer and remains a follow-up. Role tabs + search already
  make the current scale workable.

## Verification
admin-web `tsc` clean, **114 tests pass** (21 files), `vite build` clean. No backend change (fixes are client-side);
backend remains 599 / RESULT: PASS.
