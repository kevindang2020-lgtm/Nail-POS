import { describe, it, expect } from 'vitest';
import { InMemoryTierPlansRepo } from './compensation-tier-plans.repository';
import { TierPlansService } from './compensation-tier-plans.service';

const ctx = { tenantId: 't1', userId: 'u1' };
const svc = () => new TierPlansService(new InMemoryTierPlansRepo());
const bands = [{ uptoCents: 400000, ratePercent: 50 }, { uptoCents: 600000, ratePercent: 55 }, { uptoCents: null, ratePercent: 60 }];

describe('TierPlansService', () => {
  it('creates a plan and lists it', async () => {
    const s = svc();
    const p = await s.create(ctx, { technicianId: 'tech1', mode: 'entire', bands });
    expect(p).toMatchObject({ technicianId: 'tech1', mode: 'entire' });
    expect(p.bands).toHaveLength(3);
    expect(await s.list(ctx)).toHaveLength(1);
  });

  it('rejects invalid input', async () => {
    const s = svc();
    await expect(s.create(ctx, { mode: 'entire', bands })).rejects.toThrow(/technicianId/);
    await expect(s.create(ctx, { technicianId: 't', mode: 'bogus', bands })).rejects.toThrow(/entire.*marginal/);
    await expect(s.create(ctx, { technicianId: 't', mode: 'entire', bands: [{ uptoCents: 400000, ratePercent: 120 }] })).rejects.toThrow(/0 and 100/);
    await expect(s.create(ctx, { technicianId: 't', mode: 'entire', bands: [] })).rejects.toThrow(/at least one/);
  });

  it('archives a plan (removed from the active list) and 404s on unknown', async () => {
    const s = svc();
    const p = await s.create(ctx, { technicianId: 'tech1', mode: 'entire', bands });
    await s.archive(ctx, p.id);
    expect(await s.list(ctx)).toHaveLength(0);
    await expect(s.archive(ctx, 'nope')).rejects.toThrow(/not found/i);
  });

  it('previews both methods so the owner can compare entire vs marginal', () => {
    const r = svc().preview({ productionCents: 500000, bands });
    expect(r.entire.commissionCents).toBe(275000);
    expect(r.marginal.commissionCents).toBe(255000);
  });

  it('isolates tenants', async () => {
    const s = svc();
    await s.create(ctx, { technicianId: 'tech1', mode: 'entire', bands });
    expect(await s.list({ tenantId: 't2' })).toHaveLength(0);
  });
});
