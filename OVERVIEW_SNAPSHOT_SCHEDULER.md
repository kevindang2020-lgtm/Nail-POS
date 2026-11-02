# Overview snapshot scheduler — automated monthly capture

The Overview KPI snapshot (which feeds every month-over-month trend: Total Tenants, Active Salons, Paused, Trial,
Pending Apps, Card Volume) previously only ran when someone manually hit `POST /super-admin/overview/snapshot`. This adds
an in-process scheduler that captures it automatically, once per calendar month — so trends accumulate baselines on their
own. **Off by default**; nothing changes until you set one env var.

## Files changed
- `apps/api/src/super-admin-overview/overview-snapshot.scheduler.ts` (new)
- `apps/api/src/super-admin-overview/overview.module.ts` (register the scheduler provider)
- `apps/api/src/super-admin-overview/overview-snapshot.scheduler.vitest.spec.ts` (new — 4 tests)

## How it works
Mirrors the existing `HardwarePaymentScheduler` exactly — no new dependency (no `@nestjs/schedule`), CJS-safe:
- `@Injectable` implementing `OnModuleInit`/`OnModuleDestroy`. On boot, **if enabled**, it captures the current month
  immediately, then arms a `setInterval` that checks every 6 hours and captures once per calendar month (deduped on the
  `'YYYY-MM'` key). The timer is `.unref()`'d so it never holds the process open.
- The snapshot upsert is idempotent per month, so a re-run just refreshes the current month's row — safe to run repeatedly.
- Pure helpers are unit-tested in isolation: `overviewSnapshotCronEnabled(env)`, `currentSnapshotMonth(now)` (UTC
  'YYYY-MM'), and `snapshotTick(svc, log)` which captures and **swallows + logs** errors so a bad tick never crashes boot.

## Enabling it
Set the env var on the API process:

    OVERVIEW_SNAPSHOT_CRON_ENABLED=true

That's it — the scheduler arms on the next boot and captures the current month right away, then monthly thereafter.
Leave it unset (the default) anywhere you don't want automatic writes — dev, test, and CI stay completely inert.

## Off by default — why
Identical safety posture to the hardware reconciliation scheduler: dev/test/CI must never auto-write production-style
data. With the flag unset, `onModuleInit` returns before arming any timer, so the module is a no-op beyond DI wiring.

## Manual capture still works
`POST /super-admin/overview/snapshot` (SuperAdminGuard) remains available for an immediate on-demand capture, whether or
not the scheduler is enabled. If you already run system cron / a cloud scheduler, you can point it at that endpoint
instead of enabling the in-process timer — either path uses the same idempotent capture.

## Baseline timing
Each captured month becomes the prior-month baseline for the next month's trend. Trends therefore go live once two
consecutive monthly snapshots exist; until then the cards honestly show "vs last month" rather than a fabricated arrow.

## Verification
API: `tsc` clean; **492 tests** (+4); `RESULT: PASS`. admin-web (unchanged this turn): `tsc` clean; **93 tests**;
`vite build` clean.
