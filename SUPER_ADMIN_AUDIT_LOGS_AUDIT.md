# Super Admin → Audit Logs — audit & coverage

Page: `apps/admin-web/src/screens/AuditLogsScreen.tsx` (route `/audit-logs`). Platform-wide audit trail over the same
`audit_logs` table every module writes. Previously had no test; now covered.

## Result: verified clean — no new bug
- Wiring: client `auditLogs(q)` ↔ `@Get('audit-logs')` (reads `action`/`entityType`/`tenantId`/`from`/`to`/`page`/`pageSize`).
  The repo `selectAll()`s raw snake_case columns, which line up with the screen's reads (`a.action_type`, `a.entity_type`,
  `a.created_at`, `a.metadata_json`, …) — no field-name mismatch.
- Pagination is correct: `pageSize: 50`, `pages = ceil(total/50)`, Prev/Next bounded by `page<=1` / `page>=pages`,
  `useEffect(load,[page])` refetches on page change.
- The documented **bug #13** (stale-closure: Apply/Clear re-sending old filters/page via setState+setTimeout) was already
  fixed by passing explicit overrides — `load(f, 1)` on Apply, `load({}, 1)` on Clear. Empty filters are stripped before the
  request, so blank fields aren't sent.

## Tests added (4, all pass)
`AuditLogsScreen.test.tsx`: entries render with a correct multi-page footer (120 entries → "Page 1 of 3", Prev disabled);
Next requests `page: 2`; Apply sends only the active filter and resets to page 1 (`{action, page:1, pageSize:50}`); and a
**regression lock for bug #13** — after applying a filter, Clear's next request carries ONLY paging (`{page:1, pageSize:50}`),
never the stale `action`.

## Verification
admin-web `tsc` clean, **142 tests pass** (28 files), `vite build` clean. No backend change; backend remains 603 / PASS.

## Series status — coverage milestone
Every active Super Admin **dashboard** page now has a dedicated screen test. The only screens without one are
`LoginScreen` (authentication — a different category; worth testing if you want auth coverage), `ProjectStatusScreen`
(internal status page), and the dead/unrouted `LeadsScreen` (already exercised by `ApplicationsLeads.test.tsx`).

Real bugs found & fixed across the audit series: Applications (pagination cap), Users & Roles (pagination cap +
misleading label), Usage Limits (null→0 backend coercion), Billing (status dropdown mis-render), Payment Gateways
(defensive null guard). Hardware Payments, Hardware Payment Reports, System Health, and Audit Logs were verified clean
and locked with regression tests. admin-web went from ~96 to 142 passing tests over the series; backend holds at 603 / PASS.
