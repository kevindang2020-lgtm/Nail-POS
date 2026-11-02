// network-policy.vitest.spec.ts — Security Deep Scan §136 / §29: the Super Admin network policy rules, its cache and
// the rule-change invalidation through IpBlockService.
import { describe, it, expect } from 'vitest';
import { decidePlatformAccess, ipMatches, parseAllowlistEnv, networkPolicyMode, allowlistWouldLockOut } from './network-policy-core';
import { PlatformNetworkPolicy } from './network-policy';
import { IpBlockService, IpBlockError } from './ip-block.service';
import { InMemoryIpBlockRepository } from './ip-block.repository';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const actor = (ip: string | null) => ({ userId: 'sa1', role: 'SUPER_ADMIN', name: 'SA', ip });

describe('ipMatches — IPv4 + IPv6, exact + CIDR', () => {
  it('matches exact and CIDR in both families, never across families or on junk', () => {
    expect(ipMatches('203.0.113.7', '203.0.113.7')).toBe(true);
    expect(ipMatches('203.0.113.7', '203.0.113.0/24')).toBe(true);
    expect(ipMatches('203.0.114.7', '203.0.113.0/24')).toBe(false);
    expect(ipMatches('2001:db8::5', '2001:db8::/32')).toBe(true);
    expect(ipMatches('2001:db9::5', '2001:db8::/32')).toBe(false);
    expect(ipMatches('::ffff:203.0.113.7', '203.0.113.0/24')).toBe(true);
    expect(ipMatches('203.0.113.7', '2001:db8::/32')).toBe(false);
    expect(ipMatches('not-an-ip', '0.0.0.0/0')).toBe(false);
    expect(ipMatches('203.0.113.7', '203.0.113.0/40')).toBe(false);
  });
});

describe('decidePlatformAccess', () => {
  const none = { blocks: [], allowlist: [] };
  it('no rules → everyone passes', () => expect(decidePlatformAccess('198.51.100.1', none, NOW)).toEqual({ allowed: true, reason: 'no_policy' }));
  it('a blocked address (exact or inside a blocked CIDR) is refused; others pass', () => {
    const r = { blocks: [{ target: '198.51.100.0/24', expiresAt: null }], allowlist: [] };
    expect(decidePlatformAccess('198.51.100.9', r, NOW)).toMatchObject({ allowed: false, reason: 'blocked', rule: '198.51.100.0/24' });
    expect(decidePlatformAccess('192.0.2.1', r, NOW)).toMatchObject({ allowed: true });
  });
  it('an EXPIRED block no longer refuses', () => {
    expect(decidePlatformAccess('198.51.100.9', { blocks: [{ target: '198.51.100.9', expiresAt: '2026-10-26T11:00:00Z' }], allowlist: [] }, NOW).allowed).toBe(true);
  });
  it('a non-empty allowlist refuses everything outside it; inside passes even when also blocked', () => {
    const r = { blocks: [{ target: '203.0.113.5', expiresAt: null }], allowlist: ['203.0.113.0/28'] };
    expect(decidePlatformAccess('203.0.113.5', r, NOW)).toEqual({ allowed: true, reason: 'allowlisted' });
    expect(decidePlatformAccess('192.0.2.1', r, NOW)).toEqual({ allowed: false, reason: 'not_allowlisted' });
    expect(decidePlatformAccess(null, r, NOW)).toEqual({ allowed: false, reason: 'not_allowlisted' });   // unknown address cannot prove membership
  });
  it('FAIL-SAFE: an empty allowlist is "no allowlist", never "allow nobody"; loopback always passes', () => {
    expect(decidePlatformAccess('192.0.2.1', { blocks: [], allowlist: ['', ''] }, NOW).allowed).toBe(true);
    expect(decidePlatformAccess('127.0.0.1', { blocks: [{ target: '127.0.0.1', expiresAt: null }], allowlist: ['203.0.113.0/24'] }, NOW)).toEqual({ allowed: true, reason: 'loopback' });
    expect(decidePlatformAccess('::1', { blocks: [], allowlist: ['203.0.113.0/24'] }, NOW).allowed).toBe(true);
  });
});

describe('environment', () => {
  it('SUPER_ADMIN_IP_ALLOWLIST parses IPs/CIDRs, separates invalid entries', () => {
    expect(parseAllowlistEnv(' 203.0.113.0/24, 2001:db8::/32 198.51.100.7 ,bogus,10.0.0.0/99')).toEqual({ entries: ['203.0.113.0/24', '2001:db8::/32', '198.51.100.7'], invalid: ['bogus', '10.0.0.0/99'] });
    expect(parseAllowlistEnv(undefined)).toEqual({ entries: [], invalid: [] });
  });
  it('SUPER_ADMIN_NETWORK_POLICY defaults to enforce; off / report are the only other values', () => {
    expect(networkPolicyMode({})).toBe('enforce');
    expect(networkPolicyMode({ SUPER_ADMIN_NETWORK_POLICY: 'OFF' })).toBe('off');
    expect(networkPolicyMode({ SUPER_ADMIN_NETWORK_POLICY: 'report' })).toBe('report');
    expect(networkPolicyMode({ SUPER_ADMIN_NETWORK_POLICY: 'disabled-typo' })).toBe('enforce');
  });
});

describe('PlatformNetworkPolicy — DB ∪ env, short-TTL cache, invalidation, fail-open on the DB', () => {
  it('unions the env allowlist with the DB allowlist', async () => {
    const repo = new InMemoryIpBlockRepository();
    await repo.addAllowlist('198.51.100.0/24', 'cidr', 'office', actor(null));
    const p = new PlatformNetworkPolicy(repo, { SUPER_ADMIN_IP_ALLOWLIST: '203.0.113.9' }, () => NOW);
    expect((await p.effectiveRules()).allowlist.sort()).toEqual(['198.51.100.0/24', '203.0.113.9']);
    expect((await p.decide('203.0.113.9')).allowed).toBe(true);
    expect((await p.decide('198.51.100.20')).allowed).toBe(true);
    expect(await p.decide('192.0.2.1')).toEqual({ allowed: false, reason: 'not_allowlisted' });
  });
  it('caches for the TTL; a rule change through IpBlockService is seen at once (invalidate)', async () => {
    const repo = new InMemoryIpBlockRepository(); let reads = 0; let t = NOW;
    const counting = { networkRules: () => { reads++; return repo.networkRules(); } };
    const p = new PlatformNetworkPolicy(counting, {}, () => t);
    const svc = new IpBlockService(repo, { onChange: () => p.invalidate() });
    expect((await p.decide('198.51.100.9')).allowed).toBe(true);
    await p.decide('198.51.100.9'); expect(reads).toBe(1);                      // cached
    await svc.createBlock({ target: '198.51.100.9', threatType: 'brute_force' }, actor('203.0.113.1'));
    expect(await p.decide('198.51.100.9')).toMatchObject({ allowed: false, reason: 'blocked' });   // invalidated: no TTL wait
    const id = repo.rows[0].id;
    await svc.unblock(id, actor('203.0.113.1'));
    expect((await p.decide('198.51.100.9')).allowed).toBe(true);
    t += 16_000; await p.decide('1.2.3.4'); expect(reads).toBe(4);              // TTL expiry reloads too
  });
  it('a DB error keeps the last good rules (and a cold-start error fails open)', async () => {
    let fail = false; const rules = { blocks: [{ target: '198.51.100.9', expiresAt: null }], allowlist: [] };
    let t = NOW;
    const p = new PlatformNetworkPolicy({ networkRules: async () => { if (fail) throw new Error('db down'); return rules; } }, {}, () => t);
    expect((await p.decide('198.51.100.9')).allowed).toBe(false);
    fail = true; t += 60_000;
    expect((await p.decide('198.51.100.9')).allowed).toBe(false);                // last good rules
    const cold = new PlatformNetworkPolicy({ networkRules: async () => { throw new Error('db down'); } }, {}, () => NOW);
    expect((await cold.decide('198.51.100.9')).allowed).toBe(true);
  });
});

describe('IpBlockService lockout guard (the allowlist is now enforced)', () => {
  it('refuses an allowlist entry that would leave the acting admin outside it; allows one that includes them', async () => {
    const repo = new InMemoryIpBlockRepository(); const svc = new IpBlockService(repo, { lockoutGuard: true });
    await expect(svc.addAllowlist('198.51.100.0/24', 'office', actor('203.0.113.50'))).rejects.toBeInstanceOf(IpBlockError);
    expect(repo.rows).toHaveLength(0);
    await svc.addAllowlist('203.0.113.0/24', 'my office', actor('203.0.113.50'));
    await svc.addAllowlist('198.51.100.0/24', 'second office', actor('203.0.113.50'));   // still inside the first entry
    expect(repo.rows).toHaveLength(2);
  });
  it('allowlistWouldLockOut ignores unknown / loopback actors', () => {
    expect(allowlistWouldLockOut(null, [], '198.51.100.0/24')).toBe(false);
    expect(allowlistWouldLockOut('127.0.0.1', [], '198.51.100.0/24')).toBe(false);
    expect(allowlistWouldLockOut('2001:db8::1', [], '2001:db8::/32')).toBe(false);
  });
});
