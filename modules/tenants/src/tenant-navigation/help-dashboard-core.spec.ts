/**
 * help-dashboard-core.spec.ts — Help Center KPI aggregate honesty. DB-free: with no database, every support
 * feed must report { value: null, connected: false } (NotConnected, never invented), and system health must
 * be real-shaped. Real per-feed values are wired in later phases against live §36 tables.
 */
import { TenantNavigationService } from './tenant-navigation.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

async function main(): Promise<void> {
  const svc = new TenantNavigationService(null);
  const d = await svc.helpDashboard({ tenantId: 't1', branchId: 'b1', role: 'owner', permissions: [] });
  const k = d.kpis;
  const all = [k.openTickets, k.avgResponseMin, k.helpArticles, k.videoTutorials, k.aiResolutionPct, k.systemUptimePct, k.activeGuides, k.productUpdates];

  console.log('\n== all eight KPI feeds honestly NotConnected (no source tables yet) ==');
  check('eight KPIs present', all.length === 8);
  check('every KPI value is null', all.every((x) => x.value === null));
  check('every KPI marked not connected', all.every((x) => x.connected === false));

  console.log('\n== system health is real-shaped (reused from systemStatus) ==');
  check('healthy is boolean', typeof d.systemStatus.healthy === 'boolean');
  check('label is a non-empty string', typeof d.systemStatus.label === 'string' && d.systemStatus.label.length > 0);
  check('version is a non-empty string', typeof d.systemStatus.version === 'string' && d.systemStatus.version.length > 0);

  console.log('\nhelp-dashboard-core: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}
main();
