import { describe, it, expect } from 'vitest';
import { InMemoryServicesRepository, type ServicesContext } from './services.repository';
import { ServicesService, ValidationError } from './services.service';

// the compensation engine (lineCommissionCents) computes a tech payout as a percent of the line or a flat cents amount. A percent rate
// above 100 would estimate a payout larger than the sale, and any negative value is nonsensical — so create/update and
// setCommission must reject them, the same way price (>=0) and duration (>0) are already guarded.
const PERMS = ['pos.services.view', 'pos.services.create', 'pos.services.edit', 'pos.services.pricing.edit', 'pos.services.commission.edit'];
const ctx: ServicesContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS };
const svc = () => new ServicesService(new InMemoryServicesRepository());
const req = (over: any = {}) => ({ name: 'Test Service', categoryId: 'cat_mani', priceCents: 5000, durationMinutes: 30, ...over } as any);

describe('Service commission validation', () => {
  it('accepts a valid percent commission (<= 100)', async () => {
    const row = await svc().create(ctx, req({ commissionType: 'percent', commissionValue: 40 }));
    expect(row.serviceId).toBeTruthy();
  });

  it('accepts a 100% commission (booth-rent / chair model)', async () => {
    const row = await svc().create(ctx, req({ commissionType: 'percent', commissionValue: 100 }));
    expect(row.serviceId).toBeTruthy();
  });

  it('rejects a percent commission above 100', async () => {
    await expect(svc().create(ctx, req({ commissionType: 'percent', commissionValue: 150 }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a negative commission value', async () => {
    await expect(svc().create(ctx, req({ commissionType: 'percent', commissionValue: -5 }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an unknown commission type', async () => {
    await expect(svc().create(ctx, req({ commissionType: 'bogus', commissionValue: 10 }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows a flat commission of any non-negative cents', async () => {
    const row = await svc().create(ctx, req({ commissionType: 'flat', commissionValue: 9000 }));
    expect(row.serviceId).toBeTruthy();
  });

  it('setCommission rejects an out-of-range percent and bad per-technician override', async () => {
    const s = svc();
    const created = await s.create(ctx, req({ commissionType: 'percent', commissionValue: 40 }));
    await expect(s.setCommission(ctx, created.serviceId, { type: 'percent', value: 200 } as any)).rejects.toBeInstanceOf(ValidationError);
    await expect(s.setCommission(ctx, created.serviceId, { type: 'percent', value: 40, byTechnician: [{ technicianId: 't1', type: 'percent', value: -1 }] } as any)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('D4 Service Pricing (Nov 3 2026): the plain edit cannot change price or duration', () => {
  it('a changed price / duration is refused with CHANGE_REASON_REQUIRED; the same values (re-sent by an edit form) pass', async () => {
    const { ServicesService } = await import('./services.service');
    const { InMemoryServicesRepository } = await import('./services.repository');
    const repo = new InMemoryServicesRepository(); const svc = new ServicesService(repo as any);
    const ctx: any = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.services.edit', 'pos.services.view', 'pos.services.pricing.edit', 'pos.services.create'] };
    const cat = await svc.createCategory(ctx, 'Nails');
    const s = await svc.create(ctx, { name: 'Gel', categoryId: cat.categoryId, durationMinutes: 45, priceCents: 4500 } as any);
    await expect(svc.update(ctx, s.serviceId, { priceCents: 5000 } as any)).rejects.toMatchObject({ apiCode: 'CHANGE_REASON_REQUIRED' });
    await expect(svc.update(ctx, s.serviceId, { durationMinutes: 50 } as any)).rejects.toMatchObject({ apiCode: 'CHANGE_REASON_REQUIRED' });
    expect((await svc.update(ctx, s.serviceId, { name: 'Gel X', priceCents: 4500, durationMinutes: 45 } as any)).name).toBe('Gel X');
  });
});
