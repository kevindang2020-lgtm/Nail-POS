/**
 * status-core.spec.ts — pure System Status logic: human labels and the overall rollup. The overall is a real
 * DB-probe gate (a failed probe is always degraded) combined with the worst published component status; with no
 * components published it reports operational. No fabricated component health.
 */
import { statusLabel, deriveOverall } from './status.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== labels ==');
  check('operational label', statusLabel('operational') === 'All Systems Operational');
  check('maintenance label', statusLabel('maintenance') === 'Under Maintenance');
  check('major outage label', statusLabel('major_outage') === 'Major Outage');
  check('unknown → status unknown', statusLabel('whatever') === 'Status Unknown');

  console.log('\n== overall rollup ==');
  check('failed probe → degraded regardless of rows', deriveOverall([{ status: 'operational' }], false).healthy === false);
  check('no components + healthy → operational', deriveOverall([], true).status === 'operational');
  check('worst-of: degraded beats operational', deriveOverall([{ status: 'operational' }, { status: 'degraded' }], true).status === 'degraded');
  check('worst-of: major_outage wins', deriveOverall([{ status: 'degraded' }, { status: 'major_outage' }], true).status === 'major_outage');
  check('maintenance ranks above operational', deriveOverall([{ status: 'operational' }, { status: 'maintenance' }], true).status === 'maintenance');
  check('unknown component status treated as operational rank', deriveOverall([{ status: 'bogus' }], true).status === 'operational');
  check('healthy flag false when degraded', deriveOverall([{ status: 'degraded' }], true).healthy === false);

  console.log('\nstatus-core: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}
main();
