/**
 * branch-hours-core.spec.ts — verifies pure weekly-hours validation.
 * Pure + DB-free; run by scripts/run-core-specs.sh (esbuild + node).
 */
import { validateWeeklyHours, DAY_LABELS } from './branch-hours-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== labels ==');
  check('Sunday is index 0', DAY_LABELS[0] === 'Sunday');

  console.log('\n== empty ==');
  check('rejects empty days', validateWeeklyHours({ days: [] }).ok === false);

  console.log('\n== valid open day ==');
  {
    const r = validateWeeklyHours({ days: [{ dayOfWeek: 1, isClosed: false, opensAt: '09:00', closesAt: '17:30' }] });
    check('accepts', r.ok === true);
    if (r.ok) check('preserves times', r.days[0].opensAt === '09:00' && r.days[0].closesAt === '17:30');
  }

  console.log('\n== closed day clears times ==');
  {
    const r = validateWeeklyHours({ days: [{ dayOfWeek: 0, isClosed: true, opensAt: '09:00', closesAt: '17:00' }] });
    check('accepts closed', r.ok === true);
    if (r.ok) check('closed → null times', r.days[0].opensAt === null && r.days[0].closesAt === null);
  }

  console.log('\n== invalid times ==');
  check('bad format rejected', validateWeeklyHours({ days: [{ dayOfWeek: 2, opensAt: '9am', closesAt: '5pm' }] }).ok === false);
  check('open >= close rejected', validateWeeklyHours({ days: [{ dayOfWeek: 2, opensAt: '18:00', closesAt: '09:00' }] }).ok === false);
  check('equal open/close rejected', validateWeeklyHours({ days: [{ dayOfWeek: 2, opensAt: '09:00', closesAt: '09:00' }] }).ok === false);
  check('hour 24 rejected', validateWeeklyHours({ days: [{ dayOfWeek: 2, opensAt: '24:00', closesAt: '25:00' }] }).ok === false);

  console.log('\n== day index + dupes ==');
  check('day 7 rejected', validateWeeklyHours({ days: [{ dayOfWeek: 7, isClosed: true }] }).ok === false);
  check('duplicate day rejected', validateWeeklyHours({ days: [{ dayOfWeek: 1, isClosed: true }, { dayOfWeek: 1, isClosed: true }] }).ok === false);

  console.log('\n== multi-day sorts ascending ==');
  {
    const r = validateWeeklyHours({ days: [{ dayOfWeek: 5, isClosed: true }, { dayOfWeek: 1, opensAt: '08:00', closesAt: '12:00' }] });
    check('accepts multi', r.ok === true);
    if (r.ok) check('sorted by dayOfWeek', r.days[0].dayOfWeek === 1 && r.days[1].dayOfWeek === 5);
  }

  console.log(`\nbranch-hours-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
