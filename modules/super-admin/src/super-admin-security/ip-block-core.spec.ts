import { normalizeThreatType, validateBlockTarget, ipv4InCidr, isReservedOrLoopback, isProtectedSource, canBlockTransition, isBlockExpired } from './ip-block-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);
// threat vocab
eq(normalizeThreatType('Brute Force'), 'brute_force', 'threat normalized'); eq(normalizeThreatType('nonsense'), 'manual_block', 'unknown → manual_block');
// target validation
{ const r = validateBlockTarget('203.0.113.45'); ok(r.ok && r.kind === 'exact' && r.version === 4, 'ipv4 exact'); }
{ const r = validateBlockTarget('10.0.0.0/8'); ok(r.ok && r.kind === 'cidr' && r.version === 4, 'ipv4 cidr'); }
{ const r = validateBlockTarget('2001:db8::1'); ok(r.ok && r.version === 6, 'ipv6 exact'); }
ok(!validateBlockTarget('999.1.1.1').ok, 'invalid octet rejected');
ok(!validateBlockTarget('10.0.0.0/40').ok, 'bad prefix rejected');
ok(!validateBlockTarget('not-an-ip').ok, 'garbage rejected');
ok(!validateBlockTarget('').ok, 'empty rejected');
// cidr containment
ok(ipv4InCidr('10.5.6.7', '10.0.0.0/8'), 'in /8'); ok(!ipv4InCidr('11.0.0.1', '10.0.0.0/8'), 'out of /8');
ok(ipv4InCidr('192.168.1.50', '192.168.1.0/24'), 'in /24'); ok(!ipv4InCidr('192.168.2.1', '192.168.1.0/24'), 'out of /24');
ok(ipv4InCidr('8.8.8.8', '0.0.0.0/0'), '/0 matches all');
// reserved/loopback
ok(isReservedOrLoopback('127.0.0.1') && isReservedOrLoopback('::1') && isReservedOrLoopback('169.254.1.1'), 'loopback/linklocal protected');
ok(!isReservedOrLoopback('203.0.113.45'), 'public not reserved');
// protected-source gate
{ const r = isProtectedSource('127.0.0.1'); ok(r.protected && /loopback/.test(r.reason!), 'loopback blocked from blocking'); }
{ const r = isProtectedSource('203.0.113.9', { allowlist: ['203.0.113.9'] }); ok(r.protected && /allowlist/.test(r.reason!), 'allowlisted protected'); }
{ const r = isProtectedSource('10.20.30.40', { protectedCidrs: ['10.20.0.0/16'] }); ok(r.protected && /protected range/.test(r.reason!), 'office range protected'); }
{ const r = isProtectedSource('203.0.113.45'); ok(!r.protected, 'ordinary public not protected'); }
// transitions + expiry
ok(canBlockTransition('blocked', 'under_review') && canBlockTransition('under_review', 'allowed') && !canBlockTransition('expired', 'under_review'), 'block transitions');
ok(isBlockExpired('2020-01-01T00:00:00Z', Date.now()) && !isBlockExpired(null, Date.now()), 'expiry logic');
console.log(`ip-block-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
