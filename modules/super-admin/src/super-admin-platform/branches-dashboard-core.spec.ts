/**
 * branches-dashboard-core.spec.ts — branch status grouping for the Branches dashboard. Pure + DB-free: verifies the
 * documented bucketing (Active → active; Maintenance → maintenance/temporarily_closed; Inactive → paused/suspended/
 * inactive/closed/other), total accounting, case-insensitivity, and that the raw per-status breakdown is preserved.
 * The full aggregate (staff/appt/revenue joins) is repo SQL exercised against live Postgres.
 */
import { branchStatusGrouping } from './super-admin-platform.repository';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== documented three-bucket grouping ==');
  {
    const g = branchStatusGrouping([
      { status: 'active', count: 21 },
      { status: 'maintenance', count: 1 },
      { status: 'temporarily_closed', count: 1 },
      { status: 'suspended', count: 1 },
      { status: 'closed', count: 1 },
    ]);
    check('active bucket', g.active === 21);
    check('maintenance bucket folds temporarily_closed', g.maintenance === 2);
    check('inactive bucket folds suspended + closed', g.inactive === 2);
    check('total sums all', g.total === 25);
    check('raw breakdown preserved (5 statuses)', g.raw.length === 5);
  }
  console.log('\n== case-insensitive + unknown statuses fall to inactive ==');
  {
    const g = branchStatusGrouping([{ status: 'ACTIVE', count: 3 }, { status: 'Paused', count: 2 }, { status: 'draft', count: 4 }]);
    check('uppercase ACTIVE counts as active', g.active === 3);
    check('Paused + draft fall to inactive', g.inactive === 6);
    check('no maintenance here', g.maintenance === 0);
  }
  console.log('\n== empty input ==');
  {
    const g = branchStatusGrouping([]);
    check('all zero on empty', g.active === 0 && g.maintenance === 0 && g.inactive === 0 && g.total === 0 && g.raw.length === 0);
  }
  console.log('\n== null status tolerated ==');
  {
    const g = branchStatusGrouping([{ status: null as any, count: 2 }]);
    check('null status counted as inactive, not crash', g.inactive === 2 && g.total === 2);
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main();
