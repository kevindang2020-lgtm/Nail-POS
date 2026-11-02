# Super Admin Overview — Build Report

## What was built vs. kept
**Audit-first, no duplication.** The shell/sidebar/header/badges/status-card already matched the design and were kept
(sidebar reordered to the design's exact order; the 4 extra real modules — Hardware Payments, HW Payment Reports, Owner
Salons, NailShowcase — kept below rather than deleted). The existing `/dashboard` Overview was **expanded in place** into
the full design — no second Overview page.

### Backend — new module `apps/api/src/super-admin-overview/`
`overview.dto.ts`, `overview-core.ts` (pure assembly: KPI build, status slices+percent, MoM trends, quick-action perms,
honest blockers), `overview.repository.ts` (`OverviewDataPort` + `InMemoryOverviewRepository`/`EMPTY_FACTS`),
`overview.kysely.repository.ts` (Postgres aggregations, each query `.catch`-guarded), `overview.service.ts`,
`overview.controller.ts` (`@Controller('super-admin/overview')`, `@UseGuards(SuperAdminGuard)`, `GET /state` +
`/monthly-sales-volume`), `overview.module.ts` (Kysely-or-in-memory factory). Registered in `app.module.ts`.

### Frontend — `apps/admin-web/`
`src/api/superAdminOverviewApi.ts` (client + `useSuperAdminOverviewState()` hook); `src/screens/DashboardScreen.tsx`
rebuilt (218 lines) to the full design — 7 KPI cards w/ trends, SVG sales line chart with Day/Week/Month/Year switch +
hover tooltips, two SVG donuts (tenants-by-status, hardware packages) with clickable legends, Recent Alerts, the
free-hardware banner linked to Hardware Packages by type, Top Performing Tenants, Recent Tenant Applications table,
6 platform KPI cards, permission-gated Quick Actions (disabled + reason), Recent Activity feed, and a
documented-blockers panel. Loading / error+retry / empty states throughout. CSS appended to `src/styles.css`
(cream/gold tokens; grid2/grid3, donut legend, alert/top rows, qbtn, hwbanner, dtable). Sidebar reordered in
`AdminLayout.tsx`.

## Design parity
Cream `--page #F7EFE3`, gold `--g7 #A96F22`/`--grad`, Playfair Display + Hanken Grotesque, rounded cards, thin gold
borders, persistent left sidebar (no phone bottom nav), iPad Pro 13" / desktop command-center layout. Every section in
the image is present and wired.

## Honesty notes (no fabricated production data)
The design's big numbers (2,418 etc.) are demo-only; the live screen renders whatever Postgres returns and shows empty
states for zeros. AI Interactions = 0 (no `ai_usage_events`), Open Support Tickets = active support sessions, non-volume
KPI trends show `—` (no snapshot history). All listed in the in-app blockers panel and the wiring audit.

## Verification
API: `tsc` clean; full suite **71 files / 460 tests PASS**, 21 harness suites, RESULT: PASS (overview adds 7).
admin-web: `tsc` clean; **64 vitest PASS** (adds 4 Overview tests); `vite build` clean.
