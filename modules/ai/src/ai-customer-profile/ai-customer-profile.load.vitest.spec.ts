// ai-customer-profile.load.vitest.spec.ts — application-level load/isolation (§62). Fires many interleaved tenants at
// the real service concurrently and asserts ZERO cross-tenant bleed + permission enforcement under load. True
// infrastructure load testing (p95 under real PG/Redis/network) still belongs in a k6/perf run in the live env;
// this proves the application logic holds no shared per-request state that could leak across tenants.
import { describe, it, expect } from 'vitest';
import { AiCustomerProfileService } from './ai-customer-profile.service';

const N = 200;
const visits = (n: number) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse('2025-01-01') + i * 20 * 86400000).toISOString(), serviceName: 'Gel', technicianName: 'Amy', totalCents: 5000, tipCents: 800 }));
const jitter = () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 4)));

// tenant K is seeded with exactly K completed visits and K%3 duplicate groups, so any bleed is detectable.
const customers: any = {
  detail: async (c: any) => { await jitter(); return { displayName: 'T' + c.tenantId, status: 'active' }; },
  visits: async (c: any) => { await jitter(); return visits(Number(c.tenantId)); },
  appointments: async () => { await jitter(); return []; },
  getMembership: async () => ({ status: 'active' }),
  duplicates: async (c: any) => { await jitter(); return Array.from({ length: Number(c.tenantId) % 3 }, (_, i) => ({ duplicateGroupId: 'g' + i, reason: 'x', members: [] })); },
};
const svc = new AiCustomerProfileService(customers);
const ctx = (k: number): any => ({ tenantId: String(k), branchId: '', userId: 'u' + k, role: 'OWNER', permissions: ['customers.view'] });

describe('ai-customer-profile concurrency isolation (§62)', () => {
  it('serves every tenant exactly its own data under full concurrency', async () => {
    const results = await Promise.all(Array.from({ length: N }, (_, idx) => idx + 1).map(async (k) => {
      const [ov, dup]: any = await Promise.all([svc.overview(ctx(k), 'c1'), svc.duplicates(ctx(k))]);
      return { k, visits: ov.completedVisits, name: ov.displayName, dups: dup.groups.length };
    }));
    expect(results.every(r => r.visits === r.k)).toBe(true);       // no visit-count bleed
    expect(results.every(r => r.name === 'T' + r.k)).toBe(true);   // no name bleed
    expect(results.every(r => r.dups === r.k % 3)).toBe(true);     // no duplicate-count bleed
  });

  it('enforces permissions under concurrent load', async () => {
    const denials = await Promise.all(Array.from({ length: 50 }, (_, i) =>
      svc.churnRisk({ tenantId: String(i + 1), branchId: '', userId: 'u', role: 'TECHNICIAN', permissions: ['customers.view'] } as any, 'c1')
        .then(() => false).catch(() => true)));
    expect(denials.every(Boolean)).toBe(true);
  });
});
