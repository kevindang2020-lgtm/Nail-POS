import { validateRevokeScope, protectedSessionId, summarizeRevoke } from './session-revoke-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
// scope validation
ok(validateRevokeScope('session', 's1', null).ok, 'single session needs no reason');
ok(!validateRevokeScope('session', '', null).ok, 'session needs target');
ok(!validateRevokeScope('user', 'u1', null).ok, 'user scope needs reason');
ok(validateRevokeScope('user', 'u1', 'compromise').ok, 'user scope ok with reason');
ok(!validateRevokeScope('platform', 'x', 'r').ok, 'platform not in this unit scope set');
ok(!validateRevokeScope('tenant', '', 'r').ok, 'tenant needs target');
ok(validateRevokeScope('tenant', 't1', 'breach').ok, 'tenant ok with target+reason');
// protected session
ok(protectedSessionId('cur') === 'cur', 'protects current session');
ok(protectedSessionId('') === null, 'no protection when none');
// impact summary
{ const s = summarizeRevoke({ sessionsToRevoke: 3, alreadyRevoked: 1, refreshTokensToRevoke: 5, protectedSession: true });
  ok(s.total === 3 && /3 active sessions/.test(s.message) && /5 refresh tokens/.test(s.message) && /current session is preserved/.test(s.message) && /1 already revoked/.test(s.message), 'full impact message'); }
{ const s = summarizeRevoke({ sessionsToRevoke: 1, alreadyRevoked: 0, refreshTokensToRevoke: 1, protectedSession: false });
  ok(/1 active session,/.test(s.message) && /1 refresh token/.test(s.message), 'singular grammar'); }
console.log(`session-revoke-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
