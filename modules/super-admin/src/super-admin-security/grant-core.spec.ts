import { normalizePrivilege, validateGrantRequest, isExpired, isCurrentlyElevated, reviewDue, canGrantTransition, enforceSeparation, buildGrantRef } from './grant-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const NOW = Date.parse('2026-05-06T00:00:00Z');
const inDays = (d: number) => new Date(NOW + d * 86400000).toISOString();
// privilege vocab
ok(normalizePrivilege('Security Admin') === 'security_admin', 'privilege normalized');
ok(normalizePrivilege('bogus') === '', 'unknown privilege empty');
// request validation
ok(validateGrantRequest({ userId: 'u1', privilege: 'security_admin', scope: 'platform', reason: 'incident', expiresAt: inDays(7) }, NOW).ok, 'valid platform grant');
ok(!validateGrantRequest({ userId: '', privilege: 'owner', scope: 'platform', reason: 'x', expiresAt: inDays(1) }, NOW).ok, 'userId required');
ok(!validateGrantRequest({ userId: 'u1', privilege: 'owner', scope: 'tenant', reason: 'x', expiresAt: inDays(1) }, NOW).ok, 'tenant needs target');
ok(!validateGrantRequest({ userId: 'u1', privilege: 'owner', scope: 'platform', reason: '', expiresAt: inDays(1) }, NOW).ok, 'reason required');
ok(!validateGrantRequest({ userId: 'u1', privilege: 'owner', scope: 'platform', reason: 'x', expiresAt: null }, NOW).ok, 'expiry required (time-boxed)');
ok(!validateGrantRequest({ userId: 'u1', privilege: 'owner', scope: 'platform', reason: 'x', expiresAt: inDays(-1) }, NOW).ok, 'expiry must be future');
ok(!validateGrantRequest({ userId: 'u1', privilege: 'owner', scope: 'platform', reason: 'x', expiresAt: inDays(120) }, NOW).ok, 'expiry within max window');
ok(validateGrantRequest({ userId: 'u1', privilege: 'owner', scope: 'tenant', target: 't1', reason: 'x', expiresAt: inDays(30) }, NOW).ok, 'valid tenant grant');
// expiry + elevation
ok(isExpired(inDays(-1), NOW) && !isExpired(inDays(1), NOW), 'expiry check');
ok(isCurrentlyElevated('active', inDays(1), NOW), 'active + in window elevated');
ok(!isCurrentlyElevated('active', inDays(-1), NOW), 'active but expired NOT elevated');
ok(!isCurrentlyElevated('pending', inDays(1), NOW), 'pending not elevated');
ok(reviewDue(inDays(2), NOW) && !reviewDue(inDays(10), NOW), 'review-due window');
// transitions
ok(canGrantTransition('pending', 'active') && canGrantTransition('active', 'revoked') && canGrantTransition('active', 'expired'), 'valid transitions');
ok(!canGrantTransition('pending', 'expired') && !canGrantTransition('revoked', 'active'), 'invalid transitions');
// separation of duties
ok(!enforceSeparation('u1', 'u1').ok, 'no self-approval');
ok(enforceSeparation('u1', 'admin').ok, 'different approver ok');
// ref
ok(/^PAG-\d{4}-\d{3}$/.test(buildGrantRef(NOW, 7)), 'grant ref');
console.log(`grant-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
