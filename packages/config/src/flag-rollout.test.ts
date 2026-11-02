import { describe, it, expect } from 'vitest';
import { rolloutBucket, rolloutDecision, normaliseRollout } from './flag-rollout';

const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('flag rollout (Constitution 4 §76)', () => {
  it('bucket is deterministic, 0..99, and depends on flag + tenant', () => {
    const b = rolloutBucket('deals.engine', T(1));
    expect(b).toBe(rolloutBucket('deals.engine', T(1)));
    expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThan(100);
    const buckets = new Set(Array.from({ length: 200 }, (_, i) => rolloutBucket('deals.engine', T(i))));
    expect(buckets.size).toBeGreaterThan(50);   // spread, not one bucket
    const differ = Array.from({ length: 50 }, (_, i) => rolloutBucket('a.flag', T(i)) !== rolloutBucket('b.flag', T(i))).filter(Boolean).length;
    expect(differ).toBeGreaterThan(25);         // a different flag reshuffles who is in
  });

  it('percentage rollout is roughly proportional and monotonic (raising it only adds tenants)', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => T(i));
    const on = (pct: number) => new Set(ids.filter((t) => rolloutDecision({ rolloutPercent: pct, allowTenantIds: [], denyTenantIds: [], killed: false }, 'x.flag', t).on));
    const at10 = on(10), at50 = on(50);
    expect(at10.size).toBeGreaterThan(50); expect(at10.size).toBeLessThan(150);
    expect(at50.size).toBeGreaterThan(420); expect(at50.size).toBeLessThan(580);
    for (const t of at10) expect(at50.has(t)).toBe(true);
    expect(on(0).size).toBe(0); expect(on(100).size).toBe(1000);
  });

  it('order: kill beats deny beats allow beats percentage; no policy = on', () => {
    const base = { rolloutPercent: 0, allowTenantIds: [T(1)], denyTenantIds: [T(2)], killed: false };
    expect(rolloutDecision(base, 'f.x', T(1))).toMatchObject({ on: true, reason: 'ALLOWED' });
    expect(rolloutDecision(base, 'f.x', T(2))).toMatchObject({ on: false, reason: 'DENIED' });
    expect(rolloutDecision({ ...base, allowTenantIds: [T(2)] }, 'f.x', T(2))).toMatchObject({ on: false, reason: 'DENIED' });
    expect(rolloutDecision(base, 'f.x', T(3))).toMatchObject({ on: false, reason: 'NOT_IN_ROLLOUT' });
    expect(rolloutDecision({ ...base, killed: true }, 'f.x', T(1))).toMatchObject({ on: false, reason: 'KILLED' });
    expect(rolloutDecision(null, 'f.x', T(3))).toMatchObject({ on: true, reason: 'NO_POLICY' });
  });

  it('no tenant (platform context): on only at 100 % and not killed', () => {
    expect(rolloutDecision({ rolloutPercent: 100, allowTenantIds: [], denyTenantIds: [], killed: false }, 'f.x', null).on).toBe(true);
    expect(rolloutDecision({ rolloutPercent: 99, allowTenantIds: [], denyTenantIds: [], killed: false }, 'f.x', null).on).toBe(false);
  });

  it('normaliseRollout validates input', () => {
    expect(normaliseRollout({ rolloutPercent: 30, allowTenantIds: [T(1), T(1)], denyTenantIds: [], killed: false })).toEqual({ rolloutPercent: 30, allowTenantIds: [T(1)], denyTenantIds: [], killed: false });
    expect(() => normaliseRollout({ rolloutPercent: 101 })).toThrow(/0 and 100/);
    expect(() => normaliseRollout({ rolloutPercent: 10, allowTenantIds: ['nope'] })).toThrow(/tenant id/);
    expect(() => normaliseRollout({ rolloutPercent: 10, allowTenantIds: [T(1)], denyTenantIds: [T(1)] })).toThrow(/both/);
  });
});
