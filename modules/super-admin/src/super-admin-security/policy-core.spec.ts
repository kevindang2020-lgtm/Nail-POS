import { validatePolicy, evaluateCompliance, nextPolicyVersion, policyStatusLabel } from './policy-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
// password validation
ok(validatePolicy('password', { minLength: 12, maxLength: 64, historyCount: 5, lockoutThreshold: 5 }).ok, 'valid password policy');
ok(!validatePolicy('password', { minLength: 4 }).ok, 'short min rejected');
ok(!validatePolicy('password', { minLength: 20, maxLength: 10 }).ok, 'max<min rejected');
// session validation
ok(validatePolicy('session', { idleMinutes: 15, absoluteHours: 8, refreshDays: 7, privilegedIdleMinutes: 10, concurrentLimit: 3 }).ok, 'valid session policy');
ok(!validatePolicy('session', { idleMinutes: 0, absoluteHours: 8, refreshDays: 7, privilegedIdleMinutes: 10 }).ok, 'zero idle rejected');
// mfa validation
ok(validatePolicy('mfa', { requiredRoles: ['SUPER_ADMIN'], methods: ['authenticator'], graceDays: 7 }).ok, 'valid mfa policy');
ok(!validatePolicy('mfa', { requiredRoles: [], methods: [] }).ok, 'empty mfa rejected');
ok(!validatePolicy('bogus', {}).ok, 'unknown kind rejected');
// compliance — password
{ const r = evaluateCompliance('password', { minLength: 12, compromisedCheck: true, commonRejection: true, lockoutThreshold: 5 }); ok(r.compliant, 'strong password compliant'); }
{ const r = evaluateCompliance('password', { minLength: 8, compromisedCheck: false, lockoutThreshold: 20 }); ok(!r.compliant && r.failing.length >= 3, 'weak password non-compliant with reasons'); }
// compliance — session
{ const r = evaluateCompliance('session', { idleMinutes: 15, absoluteHours: 8, privilegedIdleMinutes: 10, reauthForSensitive: true }); ok(r.compliant, 'tight session compliant'); }
{ const r = evaluateCompliance('session', { idleMinutes: 120, absoluteHours: 72, privilegedIdleMinutes: 60, reauthForSensitive: false }); ok(!r.compliant, 'loose session non-compliant'); }
// compliance — mfa
{ const r = evaluateCompliance('mfa', { requiredRoles: ['SUPER_ADMIN', 'OWNER'], methods: ['authenticator', 'passkey'] }); ok(r.compliant, 'mfa privileged compliant'); }
{ const r = evaluateCompliance('mfa', { requiredRoles: ['STAFF'], methods: ['sms'] }); ok(!r.compliant && r.failing.some((f) => /SUPER_ADMIN/.test(f)), 'mfa missing privileged non-compliant'); }
// versioning + label
ok(nextPolicyVersion([]) === 1 && nextPolicyVersion([1, 2, 5]) === 6, 'versioning');
ok(policyStatusLabel(true) === 'Compliant' && policyStatusLabel(false) === 'Review', 'status label');
console.log(`policy-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
