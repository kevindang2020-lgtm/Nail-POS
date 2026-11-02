# Super Admin → Tenant Applications — audit & fix (audit-first hardening pass)

Page: `apps/admin-web/src/screens/ApplicationsScreen.tsx` (route `/tenant-applications`, sidebar item #3, "28" badge).
Approach: scanned the screen, its API client, and the backend controller/service/repo — no rebuild; verified wiring and
fixed the real defect found. Previously had **no test**; now covered.

## Wiring verified (all correct — no duplicate paths)
- Client `superAdminApi.applications / applicationStatus / applicationNote / applicationConverted`
  → backend `SuperAdminPlatformController` `@Get('applications')`, `@Post('applications/:id/status')`,
  `@Post('applications/:id/notes')`, `@Post('applications/:id/converted')` (all `SuperAdminGuard`-only).
- Body shapes match exactly: `{ status }`, `{ text }`, `{ tenantId }` — the controller reads the same keys.
- Repo returns `{ rows, total }` with `selectAll()` (raw snake_case columns); the screen reads `a.salon_name`,
  `a.owner_name`, `a.monthly_card_volume_cents`, etc. — field names line up, so no blank-cell bug.

## Bug found & fixed
**Applications past the 25th were unreachable.** The repo paginates with `Math.min(100, pageSize)` and the controller
defaults `pageSize` to **25**. The screen sent no `pageSize` and renders a single scrollable queue with **no pagination
UI**, so with 28 applications only 25 showed and ~3 were silently hidden — while the header still displayed "28 total".
Fix: the screen now requests `pageSize: 100` (the repo's max) so the queue shows everything up to the cap, plus an honest
"Showing first N of {total}" hint when the cap is reached (directs the user to search/status filters to narrow).

## Tests added (4, all pass)
`ApplicationsScreen.test.tsx` — renders the queue + asserts the `pageSize: 100` request and the cap hint; opens a row and
drives **Approve Package** through the real status route; adds a note via the real notes route; filters by a status tab
(asserts the backend is called with `{ status, pageSize: 100 }`).

## Honest remainder
- For >100 applications the queue is capped at 100 (repo's hard limit); a full pager would be a follow-up. At the current
  scale (badge shows 28) this is not a live limitation, and search/status filters already narrow the set.
- The Convert-to-Tenant flow is intentionally manual (create the tenant via the existing Create Tenant flow, then paste the
  new tenant id) to avoid a duplicate tenant-creation path — unchanged by design.

## Verification
admin-web `tsc` clean, **109 tests pass** (20 files), `vite build` clean. No backend change (fix is client-side); backend
remains 599 / RESULT: PASS.
