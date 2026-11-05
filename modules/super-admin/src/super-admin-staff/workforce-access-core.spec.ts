import { validateAccessSupport, isAccessAction, accessAuditType, accessActionLabel, ACCESS_ACTIONS, MIN_REASON_LEN } from './workforce-access-core';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

// action guard
ok(isAccessAction('revoke_sessions'), 'revoke_sessions is valid');
ok(isAccessAction('force_password_reset'), 'force_password_reset is valid');
ok(isAccessAction('reset_mfa'), 'reset_mfa is valid');
ok(!isAccessAction('unlock_account'), 'unlock_account is NOT offered (no lock column)');
ok(!isAccessAction('suspend'), 'status changes are not access-support actions');
ok(!isAccessAction(''), 'empty is invalid');
ok(!isAccessAction(undefined), 'undefined is invalid');

// validation: bad action
{ const v = validateAccessSupport({ action: 'nope', reason: 'a valid reason here' }); ok(!v.ok, 'invalid action rejected'); if (!v.ok) ok(/action must be one of/.test(v.error), 'action error message'); }
// validation: missing/short reason
{ const v = validateAccessSupport({ action: 'reset_mfa' }); ok(!v.ok, 'missing reason rejected'); }
{ const v = validateAccessSupport({ action: 'reset_mfa', reason: 'short' }); ok(!v.ok, `reason under ${MIN_REASON_LEN} rejected`); }
{ const v = validateAccessSupport({ action: 'reset_mfa', reason: '          ' }); ok(!v.ok, 'whitespace-only reason rejected'); }
// validation: happy path trims reason
{ const v = validateAccessSupport({ action: 'revoke_sessions', reason: '  locked out after phone loss  ' }); ok(v.ok, 'valid input accepted'); if (v.ok) { eq(v.action, 'revoke_sessions', 'action passthrough'); eq(v.reason, 'locked out after phone loss', 'reason trimmed'); } }

// audit type mapping is stable + distinct
const types = ACCESS_ACTIONS.map(accessAuditType);
eq(types, ['workforce_session_revoke', 'workforce_password_reset', 'workforce_mfa_reset'], 'audit types mapped');
eq(new Set(types).size, 3, 'audit types distinct');
ACCESS_ACTIONS.forEach((a) => ok(accessActionLabel(a).length > 0, `label for ${a}`));

console.log(`workforce-access-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
