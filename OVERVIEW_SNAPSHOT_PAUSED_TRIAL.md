# Overview snapshot — Paused & Trial MoM trends

Closed the last carried-forward trend item: the Tenants/Salons "Paused Tenants" and "Trial Tenants" KPI cards had no
snapshot baseline and always rendered "vs last month". They now get real month-over-month trends from the overview
snapshot, exactly like Total Tenants / Active Salons / Pending Apps / Monthly Card Volume.

## Files changed
- `apps/api/db/migrations/089_overview_snapshot_paused_trial.sql` (new — adds `paused_tenants`, `trial_tenants`)
- `apps/api/src/super-admin-overview/overview.dto.ts` (facts + trends + baselines)
- `apps/api/src/super-admin-overview/overview.repository.ts` (EMPTY_FACTS)
- `apps/api/src/super-admin-overview/overview-core.ts` (trend computation)
- `apps/api/src/super-admin-overview/overview.kysely.repository.ts` (facts, baseline read, snapshot write)
- `apps/api/src/super-admin-overview/overview.service.vitest.spec.ts` (+1 test)

## What changed
- **Migration 089**: `ALTER TABLE overview_monthly_snapshots ADD COLUMN paused_tenants/trial_tenants` (default 0,
  `IF NOT EXISTS`). Sequenced after 088.
- **Facts**: `getFacts` now computes `pausedTenants` (tenants.status = suspended, from the status-count rows already
  fetched — no extra query) and `trialTenants` (`count(distinct tenant_id) from tenant_subscriptions where status =
  'trialing'`).
- **Baselines**: the prior-snapshot read now also pulls `paused_tenants` / `trial_tenants` into
  `trendBaselines.pausedTenantsPrior` / `trialTenantsPrior` (null when the column/row is absent — never a faked arrow).
- **Snapshot capture**: `captureMonthlySnapshot` writes paused/trial into the insert + upsert.
- **Trends**: overview-core adds `trends.pausedTenants` / `trends.trialTenants` via the same `pctDelta(current, prior)`.
- **Frontend**: no change needed — the Tenants KPI cards already read `tr.pausedTenants` (inverted: a drop is good) and
  `tr.trialTenants`; the `trends` type is an open record, so the real values flow straight through once present.

## Behavior
Real MoM percentages appear after two monthly snapshots exist (this month's capture + last month's baseline). Until then
the cards still show the honest "vs last month" — the data is real, never fabricated. `POST /super-admin/overview/snapshot`
captures the current month idempotently; schedule it monthly (cron/worker) to accumulate baselines. This is the same
mechanism the other four trend cards already use.

## How to test
- `cd apps/api && npx vitest run src/super-admin-overview` — covers paused/trial trends: null with no baseline, and
  `(120-100)/100 = 20%` / `(86-80)/80 = 7.5%` with a baseline.
- End-to-end: run the snapshot endpoint two months running (or seed a prior `overview_monthly_snapshots` row with
  `paused_tenants`/`trial_tenants`); the Paused/Trial cards then show ▲/▼ x% with the correct colour (down = good for
  Paused).

## Verification
API: `tsc` clean; **488 tests** (+1); `RESULT: PASS`. admin-web: `tsc` clean; **93 tests**; `vite build` clean.
