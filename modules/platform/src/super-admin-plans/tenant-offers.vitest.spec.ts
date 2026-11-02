import { describe, it, expect } from 'vitest';
import { TenantOffersService, OffersForbiddenError, OffersNotFoundError, OffersConflictError, OffersValidationError } from './tenant-offers.service';
import type { TenantOffersRepo, AddOnCatalog, TrialCatalog, PromoCatalog } from './tenant-offers.repository';

const ADMIN = { userId: 'u1', permissions: ['super_admin.subscriptions.manage'] };

function fakeRepo(over: Partial<TenantOffersRepo> = {}): TenantOffersRepo {
  const promoCounts: Record<string, number> = {};
  return {
    async getAddOnByCode(code): Promise<AddOnCatalog | null> { return code === 'ai_receptionist' ? { id: 'a1', code, name: 'AI Receptionist', unitPriceCents: 4900 } : null; },
    async getTrialByCode(code): Promise<TrialCatalog | null> { return code === 't14' ? { id: 'd1', code, name: 'Pro Trial', durationDays: 14 } : null; },
    async getPromoByCode(code): Promise<PromoCatalog | null> { return code === 'spring' ? { id: 'p1', code, name: 'Spring', status: 'active', perTenantLimit: 1, maxRedemptions: null } : code === 'old' ? { id: 'p2', code, name: 'Old', status: 'archived', perTenantLimit: 1, maxRedemptions: null } : null; },
    async upsertAddOn() { /* ok */ },
    async cancelAddOn() { return 1; },
    async startTrial() { return 'tt1'; },
    async countTenantPromoRedemptions(tenantId, promotionId) { return promoCounts[`${tenantId}:${promotionId}`] ?? 0; },
    async countTotalPromoRedemptions() { return 0; },
    async applyPromo({ tenantId, promotionId }) { promoCounts[`${tenantId}:${promotionId}`] = (promoCounts[`${tenantId}:${promotionId}`] ?? 0) + 1; return 'r1'; },
    async writeAudit() { /* ok */ },
    ...over,
  };
}

describe('TenantOffersService', () => {
  it('requires the manage permission', async () => {
    const svc = new TenantOffersService(fakeRepo());
    await expect(svc.assignAddOn({ permissions: [] }, 'T', 'ai_receptionist')).rejects.toBeInstanceOf(OffersForbiddenError);
  });

  it('404s an unknown add-on and computes price = unit * qty (override wins)', async () => {
    const svc = new TenantOffersService(fakeRepo());
    await expect(svc.assignAddOn(ADMIN, 'T', 'nope')).rejects.toBeInstanceOf(OffersNotFoundError);
    expect((await svc.assignAddOn(ADMIN, 'T', 'ai_receptionist', 2)).priceCents).toBe(9800);
    expect((await svc.assignAddOn(ADMIN, 'T', 'ai_receptionist', 2, 5000)).priceCents).toBe(5000);
  });

  it('enforces the per-tenant promotion limit', async () => {
    const svc = new TenantOffersService(fakeRepo());
    await svc.applyPromotion(ADMIN, 'T', 'spring');                 // first ok
    await expect(svc.applyPromotion(ADMIN, 'T', 'spring')).rejects.toBeInstanceOf(OffersConflictError); // second blocked
  });

  it('rejects an inactive promotion and starts a trial with its duration', async () => {
    const svc = new TenantOffersService(fakeRepo());
    await expect(svc.applyPromotion(ADMIN, 'T', 'old')).rejects.toBeInstanceOf(OffersValidationError);
    expect((await svc.startTrial(ADMIN, 'T', 't14')).durationDays).toBe(14);
  });
});
