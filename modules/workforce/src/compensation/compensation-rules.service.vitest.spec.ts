import { describe, it, expect } from 'vitest';
import { InMemoryCompensationRulesRepo } from './compensation-rules.repository';
import { CompensationRulesService } from './compensation-rules.service';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1' };
const svc = () => new CompensationRulesService(new InMemoryCompensationRulesRepo());
const v = (over: Record<string, any> = {}) => ({ commissionType: 'percent' as const, commissionValue: 60, effectiveStart: '2026-01-01T00:00:00Z', ...over });

describe('CompensationRulesService', () => {
  it('creates a policy with version 1 in draft', async () => {
    const p = await svc().createPolicy(ctx, { scope: {}, label: 'Salon default', version: v() });
    expect(p.versions).toHaveLength(1);
    expect(p.versions[0]).toMatchObject({ version: 1, commissionType: 'percent', commissionValue: 60, status: 'draft', approved: false });
  });

  it('rejects invalid payloads', async () => {
    const s = svc();
    await expect(s.createPolicy(ctx, { version: v({ commissionValue: 120 }) })).rejects.toThrow(/0 and 100/);
    await expect(s.createPolicy(ctx, { version: v({ commissionValue: -5 }) })).rejects.toThrow(/non-negative/);
    await expect(s.createPolicy(ctx, { version: v({ commissionType: 'bogus' }) as any })).rejects.toThrow(/percent.*fixed/);
    await expect(s.createPolicy(ctx, { version: v({ effectiveEnd: '2025-01-01T00:00:00Z' }) })).rejects.toThrow(/on or after/);
  });

  it('runs create → add version → approve → activate, superseding the prior active version (§25)', async () => {
    const s = svc();
    const p = await s.createPolicy(ctx, { version: v({ commissionValue: 60 }) });
    const v1 = p.versions[0];
    await s.activate(ctx, v1.id); // v1 active
    const v2 = await s.addVersion(ctx, p.id, v({ commissionValue: 65, effectiveStart: '2026-07-01T00:00:00Z' }));
    expect(v2.status).toBe('draft');
    await s.approve(ctx, v2.id); // v2 scheduled
    expect((await s.get(ctx, p.id)).versions.find((x) => x.id === v2.id)!.status).toBe('scheduled');
    const activated = await s.activate(ctx, v2.id); // v2 active, v1 replaced
    expect(activated.status).toBe('active');
    const after = await s.get(ctx, p.id);
    const oldV1 = after.versions.find((x) => x.id === v1.id)!;
    expect(oldV1.status).toBe('replaced');
    expect(oldV1.effectiveEnd).toBe(v2.effectiveStart); // window closed at the new version's start
  });

  it('404s on unknown policy / version', async () => {
    const s = svc();
    await expect(s.get(ctx, 'nope')).rejects.toThrow(/not found/i);
    await expect(s.activate(ctx, 'nope')).rejects.toThrow(/not found/i);
  });

  it('isolates tenants', async () => {
    const s = svc();
    const p = await s.createPolicy(ctx, { version: v() });
    expect(await s.list({ tenantId: 't2' })).toHaveLength(0);
    await expect(s.get({ tenantId: 't2' }, p.id)).rejects.toThrow(/not found/i);
  });

  // RE-PINNED (merge Oct 12 2026): the seeded default is the TENANT's default_commission_percent (platform fallback 50
  // when no DB / never set) — the hardcoded 60 WAS the bug. An explicit technicianPercent still wins.
  it('seeds and activates a salon-default at the tenant default rate on opt-in, idempotently (§3)', async () => {
    const s = svc();
    const p = await s.seedDefaultTemplate(ctx);
    expect(p.scope).toMatchObject({ branchId: null, technicianId: null, serviceId: null, serviceCategory: null, ticketId: null });
    expect(p.versions[0]).toMatchObject({ commissionType: 'percent', commissionValue: 50, status: 'active' });
    expect(p.label).toBe('Standard 50/50 split');
    const again = await s.seedDefaultTemplate(ctx); // no duplicate, no re-activate
    expect(again.id).toBe(p.id);
    expect((await s.list(ctx)).filter((x) => !x.scope.branchId && !x.scope.technicianId && !x.scope.serviceId).length).toBe(1);
  });
});
