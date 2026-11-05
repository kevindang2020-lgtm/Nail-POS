/**
 * workforce-core.spec.ts — verifies the pure Workforce Oversight helpers (role categorization, status/role buckets,
 * health-alert assembly + honesty rule, badge class maps, reconciliation). Pure + DB-free; run via esbuild + node.
 */
import {
  isWorkerRole, roleCategory, bucketRoleDistribution, bucketStatus, assembleHealthAlerts,
  availabilityClass, accessStatusClass, payrollSyncClass, profileStatusClass, workerStatusClass, reconciles, pct,
  categorizeAuditAction, summarizeAudit,
  deriveProfileStatus, deriveAccessStatus, deriveFlags,
} from './workforce-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== worker role gate ==');
  check('TECHNICIAN is a worker', isWorkerRole('TECHNICIAN'));
  check('MANAGER is a worker', isWorkerRole('manager'));
  check('CUSTOMER is NOT a worker', !isWorkerRole('CUSTOMER'));
  check('SUPER_ADMIN is NOT a worker', !isWorkerRole('SUPER_ADMIN'));

  console.log('\n== role categories ==');
  check('TECHNICIAN → technician', roleCategory('TECHNICIAN') === 'technician');
  check('RECEPTION → receptionist', roleCategory('RECEPTION') === 'receptionist');
  check('FRONT_DESK → receptionist', roleCategory('FRONT_DESK') === 'receptionist');
  check('MANAGER → manager', roleCategory('MANAGER') === 'manager');
  check('OWNER → manager', roleCategory('OWNER') === 'manager');

  console.log('\n== role distribution buckets + reconcile ==');
  {
    const d = bucketRoleDistribution([
      { role: 'TECHNICIAN', count: 2463 }, { role: 'RECEPTION', count: 1000 }, { role: 'FRONT_DESK', count: 205 },
      { role: 'MANAGER', count: 500 }, { role: 'OWNER', count: 118 }, { role: 'CUSTOMER', count: 9999 },
    ]);
    check('technicians counted', d.technicians === 2463);
    check('receptionists combined', d.receptionists === 1205);
    check('managers combined', d.managers === 618);
    check('customers excluded from total', d.total === 2463 + 1205 + 618);
    check('reconciles to total', reconciles([d.technicians, d.receptionists, d.managers, d.other], d.total));
  }

  console.log('\n== status buckets ==');
  {
    const s = bucketStatus([{ status: 'active', count: 3824 }, { status: 'inactive', count: 462 }, { status: 'suspended', count: 10 }, { status: 'invited', count: 4 }]);
    check('active', s.active === 3824);
    check('inactive', s.inactive === 462);
    check('total sums all', s.total === 3824 + 462 + 10 + 4);
  }

  console.log('\n== health alerts: order + honesty ==');
  {
    const alerts = assembleHealthAlerts({ duplicates: 68, missingTax: 112, payrollFailures: null, suspiciousLogin: 23, inactiveUsers: 462, transferRequests: null, connectivityIssues: null });
    check('seven alerts', alerts.length === 7);
    check('first is duplicates', alerts[0].key === 'duplicates' && alerts[0].count === 68);
    check('fifth is inactive users', alerts[4].key === 'inactiveUsers' && alerts[4].count === 462);
    check('null payroll → unavailable', alerts[2].available === false && alerts[2].count === null);
    check('null connectivity → unavailable', alerts[6].available === false);
    check('present count → available', alerts[0].available === true);
  }

  console.log('\n== badge class maps ==');
  check('available → ok', availabilityClass('Available') === 'ok');
  check('busy → warn', availabilityClass('Busy') === 'warn');
  check('access issue → danger', accessStatusClass('Access Issue') === 'danger');
  check('OK access → ok', accessStatusClass('OK') === 'ok');
  check('payroll error → danger', payrollSyncClass('Payroll Error') === 'danger');
  check('synced → ok', payrollSyncClass('Synced') === 'ok');
  check('not configured → muted', payrollSyncClass('Not Configured') === 'muted');
  check('duplicate review → danger', profileStatusClass('Duplicate Review') === 'danger');
  check('missing info → warn', profileStatusClass('Missing Info') === 'warn');
  check('terminated → danger', workerStatusClass('Terminated') === 'danger');
  check('inactive → muted', workerStatusClass('Inactive') === 'muted');

  console.log('\n== reconcile + pct ==');
  check('reconcile false on mismatch', reconciles([1, 2, 3], 7) === false);
  check('pct guards zero', pct(5, 0) === 0);
  check('pct one decimal', pct(2118, 4286) === 49.4);

  console.log('\n== audit categorization ==');
  check('role action → Role Changes', categorizeAuditAction('super_admin_user_role_changed') === 'Role Changes');
  check('login fail → Login Failures', categorizeAuditAction('login_failed') === 'Login Failures');
  check('payroll → Payroll Sync Errors', categorizeAuditAction('payroll_sync_error') === 'Payroll Sync Errors');
  check('session/access → Access Changes', categorizeAuditAction('user_session_revoked') === 'Access Changes');
  check('profile default → Profile Updates', categorizeAuditAction('user_profile_updated') === 'Profile Updates');
  {
    const sum = summarizeAudit([{ actionType: 'role_changed', count: 46 }, { actionType: 'login_failed', count: 19 }, { actionType: 'profile_updated', count: 100 }, { actionType: 'profile_updated', count: 28 }]);
    check('five categories in order', sum.length === 5 && sum[0].category === 'Profile Updates');
    check('profile counts summed', sum[0].count === 128);
    check('role count', sum[1].count === 46);
    check('login failures', sum[3].count === 19);
    check('zero category present', sum[4].count === 0);
  }

  console.log('\n== worker-row derivations ==');
  {
    const complete = { status: 'active', hasEmail: true, hasPhone: true, hasName: true, mustChangePassword: false, isDuplicate: false };
    check('complete active → Verified', deriveProfileStatus(complete) === 'Verified');
    check('complete active → OK access', deriveAccessStatus(complete) === 'OK');
    check('complete active → no flags', deriveFlags(complete).length === 0);
    check('duplicate → Duplicate Review', deriveProfileStatus({ ...complete, isDuplicate: true }) === 'Duplicate Review');
    check('missing phone → Missing Information', deriveProfileStatus({ ...complete, hasPhone: false }) === 'Missing Information');
    check('suspended → Suspended access', deriveAccessStatus({ ...complete, status: 'suspended' }) === 'Suspended');
    check('inactive → No Active Account', deriveAccessStatus({ ...complete, status: 'inactive' }) === 'No Active Account');
    check('must change pw → reset required', deriveAccessStatus({ ...complete, mustChangePassword: true }) === 'Password Reset Required');
    check('flags include Access + Inactive', JSON.stringify(deriveFlags({ ...complete, status: 'inactive', mustChangePassword: true })) === JSON.stringify(['Access', 'Inactive']));
  }

  console.log(`\nworkforce-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
