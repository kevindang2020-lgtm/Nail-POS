/**
 * branch-health-core.spec.ts — verifies the pure branch-health/alerts/onboarding helpers (DB-free, deterministic).
 * Run by scripts/run-core-specs.sh (esbuild + node), alongside the other *-core.spec.ts harnesses.
 */
import {
  branchHealthScore, healthBucket, bucketHealthDistribution, statusSubScore,
  hoursAvailabilityClass, operationalAlerts, HEALTH_WEIGHTS,
} from './branch-health-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== weights are documented and sum to 100 ==');
  {
    const sum = Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0);
    check('weights sum to 100', sum === 100);
  }

  console.log('\n== pre-operational branches have null health (not 0) ==');
  for (const s of ['pending', 'draft', 'Opening Requested', 'under review', 'ready_to_launch']) {
    check(`${s} → null`, branchHealthScore({ status: s, paymentConfigured: true, deviceOnlineRatio: 1, daysSinceLastActivity: 1, todaysAppointments: 10, revenueMtdCents: 100000, openSupportTickets: 0 }) === null);
  }

  console.log('\n== a healthy active branch scores high ==');
  {
    const score = branchHealthScore({ status: 'active', paymentConfigured: true, deviceOnlineRatio: 1, daysSinceLastActivity: 1, todaysAppointments: 25, revenueMtdCents: 500000, openSupportTickets: 0 });
    check('perfect signals → 100', score === 100);
  }

  console.log('\n== a suspended branch with no signal scores low ==');
  {
    const score = branchHealthScore({ status: 'suspended', paymentConfigured: false, deviceOnlineRatio: 0, daysSinceLastActivity: 120, todaysAppointments: 0, revenueMtdCents: 0, openSupportTickets: 12 });
    check('all-bad signals → low (<30)', score !== null && score < 30);
  }

  console.log('\n== missing signals are excluded, not penalized ==');
  {
    // Only status known, and it's active → should be 100 (status sub = 1, renormalized over the single factor).
    const onlyStatus = branchHealthScore({ status: 'active', paymentConfigured: null, deviceOnlineRatio: null, daysSinceLastActivity: null, todaysAppointments: null, revenueMtdCents: null, openSupportTickets: null });
    check('only active status → 100 (renormalized)', onlyStatus === 100);
    const noSignals = branchHealthScore({ status: null, paymentConfigured: null, deviceOnlineRatio: null, daysSinceLastActivity: null, todaysAppointments: null, revenueMtdCents: null, openSupportTickets: null });
    check('no signals at all → null', noSignals === null);
  }

  console.log('\n== status sub-scores ==');
  check('active = 1', statusSubScore('active') === 1);
  check('suspended = 0', statusSubScore('suspended') === 0);
  check('paused between', statusSubScore('paused') > 0 && statusSubScore('paused') < 1);

  console.log('\n== banding ==');
  check('95 → excellent', healthBucket(95) === 'excellent');
  check('70 → good', healthBucket(70) === 'good');
  check('50 → average', healthBucket(50) === 'average');
  check('30 → poor', healthBucket(30) === 'poor');
  check('29 → critical', healthBucket(29) === 'critical');

  console.log('\n== distribution reconciles (scored + unscored = total) ==');
  {
    const d = bucketHealthDistribution([92, 88, 85, null, 32, 76, null]);
    check('total = 7', d.total === 7);
    check('unscored = 2', d.unscored === 2);
    check('scored = 5', d.scored === 5);
    check('scored = sum of bands', d.excellent + d.good + d.average + d.poor + d.critical === d.scored);
    check('excellent = 1 (92)', d.excellent === 1);
    check('critical = 1 (32→poor not critical)', d.poor === 1 && d.critical === 0);
  }

  console.log('\n== hours availability classes ==');
  check('7 days → full', hoursAvailabilityClass(7) === 'full');
  check('5 days → partial', hoursAvailabilityClass(5) === 'partial');
  check('2 days → limited', hoursAvailabilityClass(2) === 'limited');

  console.log('\n== operational alerts omit zero-count rows ==');
  {
    const alerts = operationalAlerts({ lowHealthBranches: 12, offlineDeviceBranches: 0, pendingOpenings: 5, zeroAppointmentActiveBranches: 0, revenueDropBranches: 2 });
    check('only non-zero alerts surface (3)', alerts.length === 3);
    check('low_health is critical', alerts.find((a) => a.key === 'low_health')?.severity === 'critical');
    check('every alert has a destination', alerts.every((a) => a.to.startsWith('/')));
  }

  console.log(`\nbranch-health-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
