# SUPER_ADMIN_WEBSITE_LEADS_TEST_REPORT.md

## Backend — `apps/api/src/super-admin-website-leads/website-leads.vitest.spec.ts` (12 tests, all pass)
Core: KPI rollup (total excludes spam/archived; conversion = converted/total), lead score from signals + bands,
filter by source/status/score/search (incl. inclusive date range), pagination, analytics by source/status + top sources.
Service (InMemory repo): state returns kpis+paginated leads+analytics+permissions; create auto-scores + logs `created`
activity; invalid status rejected; convert creates an application, flips status, and is idempotent (second convert →
bad_request); recalculate-score updates score; empty note rejected; export emits a CSV header + filtered row.

Full backend suite after integration: **584 passed (87 files, 22 harness suites) — RESULT: PASS**.

## Frontend — `apps/admin-web/src/screens/WebsiteLeadsScreen.test.tsx` (3 tests, all pass)
Renders KPIs (Total 2,847 / Conversion 7.06%), a lead row (salon, contact, score badge, assigned rep), Leads-by-Source +
Recent Lead Activity, all from the mocked state hook; shows "No website leads yet." empty state; opens the Add Lead modal.

Full admin-web suite: **101 passed (18 files)**; `vite build` clean.

## Coverage vs spec §24 checklist
Page loads ✓ · KPI cards from backend ✓ · search/source/status/score filters ✓ (core-level) · clear filters ✓ ·
pagination ✓ · row opens drawer ✓ · Add Lead creates ✓ · add note ✓ · mark contacted/qualified ✓ · convert ✓ ·
export filtered ✓ · by-source/by-status/top-sources ✓ · recent activity ✓ · super-admin guard enforced ✓ ·
no mock production data ✓ (InMemory returns empty; mock numbers exist only in the FE test fixture).
Date-range *preset dropdown* and tenant-user-denied integration test: see REMAINING_BLOCKERS.
