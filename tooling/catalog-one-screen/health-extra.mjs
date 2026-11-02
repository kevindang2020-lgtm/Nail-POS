// health-extra.mjs — the Setup Health part of the catalog harness (Four-Module Completion Guide §13, Oct 30 2026):
// /tenant/setup-health on the REAL SetupHealthController + repository + checks + SQL. It reads what the other harness
// sections seeded (comms-extra's fake-Twilio checks, aiusage-extra's subscriptions, team data runs) — nothing extra is
// faked, so rows the harness has no evidence for (CI, staging, touchscreen, carrier approval) honestly stay Unknown /
// Waiting on provider. No release evidence is seeded. healthSeed runs the REAL nightly job once for Pilot (after every other
// section seeded) so the screen opens on a stored run, as a salon would see it the morning after; the empty salon has none.
import { SetupHealthController } from '../../modules/super-admin/src/setup-health/setup-health.controller.ts';
import { SetupHealthRepository } from '../../modules/super-admin/src/setup-health/setup-health.repository.ts';
import { PILOT } from './seed.mjs';
export async function healthSeed(db) {
  const r = await new SetupHealthRepository(db).runNightlyJob({ tenantId: PILOT, runDate: new Date().toISOString().slice(0, 10) });
  return { healthNightly: r ? 'ran' : 'skipped' };
}
export function healthRoutes(db, routesOf) {
  return routesOf('modules/super-admin/src/setup-health/setup-health.controller.ts', '/tenant/setup-health', new SetupHealthController(new SetupHealthRepository(db)));
}
export const healthSql = (T) => ({
  hsruns: [`select trigger_kind, status, summary_json->>'overall' as overall from health_check_runs where tenant_id = $1 order by started_at`, [T]],
  hsalerts: [`select check_key, status, severity, occurrences, acknowledged_at is not null as acked from health_check_alerts where tenant_id = $1 order by check_key`, [T]],
});
