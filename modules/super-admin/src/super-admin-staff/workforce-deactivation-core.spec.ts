import { canDeactivate, validateDeactivation, summarizeDeactivation, DEACTIVATABLE_STATUSES, DEACTIVATION_AUDIT_TYPE, MIN_DEACT_REASON_LEN } from './workforce-deactivation-core';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };

ok(canDeactivate('inactive'), 'inactive is deactivatable');
ok(canDeactivate('suspended'), 'suspended is deactivatable');
ok(!canDeactivate('active'), 'active is NOT deactivatable (tenant action)');
ok(!canDeactivate('invited'), 'invited is NOT deactivatable');
ok(!canDeactivate(undefined), 'undefined is not deactivatable');
ok(DEACTIVATABLE_STATUSES.length === 2, 'two deactivatable statuses');

// active worker rejected regardless of reason
{ const v = validateDeactivation('active', { reason: 'a perfectly valid reason' }); ok(!v.ok, 'active rejected'); if (!v.ok) ok(v.code === 'invalid', 'active → invalid code'); }
// deactivatable but missing/short reason
{ const v = validateDeactivation('inactive', {}); ok(!v.ok, 'missing reason rejected'); }
{ const v = validateDeactivation('suspended', { reason: 'short' }); ok(!v.ok, `reason under ${MIN_DEACT_REASON_LEN} rejected`); }
// happy path trims
{ const v = validateDeactivation('inactive', { reason: '  terminated 2 weeks ago, clean up access  ' }); ok(v.ok, 'valid accepted'); if (v.ok) ok(v.reason === 'terminated 2 weeks ago, clean up access', 'reason trimmed'); }

ok(DEACTIVATION_AUDIT_TYPE === 'workforce_access_deactivated', 'audit type stable');
ok(summarizeDeactivation({ sessionsRevoked: 3, devicesRevoked: 2 }) === 'Revoked 3 session(s) and 2 device registration(s).', 'summary text');

console.log(`workforce-deactivation-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
