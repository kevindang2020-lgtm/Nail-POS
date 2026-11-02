// Tenant-owner AI surface — catalog with per-package access state, self-serve trial (trial-only), cancel, and the
// tenant/permission scoping guards.
import { describe, it, expect } from 'vitest';
import { TenantAiService } from './tenant-ai.service';
import { InMemoryTenantAiRepo } from './tenant-ai.repository';
import type { SubRow } from '../super-admin-ai/ai-admin-core';

const OWNER: any = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: ['ai.use', 'ai.manage', 'subscription.manage'] };
const sub = (over: Partial<SubRow>): SubRow => ({ tenantId: 't1', packageCode: 'ai_booking_assistant', status: 'active', billingPeriod: 'monthly', priceCents: 4900, usageLimit: 1000, overageEnabled: false, trialEndsAt: null, currentPeriodStartsAt: null, ...over });

describe('TenantAiService', () => {
  const mk = (rows: SubRow[] = [], usage: { packageCode: string; used: number; calls: number }[] = []) => {
    const repo = new InMemoryTenantAiRepo(); repo.rows = rows; repo.usage = usage;
    return { repo, svc: new TenantAiService(repo) };
  };

  it('catalog returns all 15 with per-package access state', async () => {
    const { svc } = mk([sub({ packageCode: 'ai_booking_assistant', status: 'active', usageLimit: 100 })], [{ packageCode: 'ai_booking_assistant', used: 40, calls: 40 }]);
    const { packages } = await svc.catalog(OWNER);
    expect(packages).toHaveLength(15);
    const booking = packages.find((p) => p.code === 'ai_booking_assistant')!;
    expect(booking.accessible).toBe(true); expect(booking.used).toBe(40); expect(booking.remainingUsage).toBe(60);
    const other = packages.find((p) => p.code === 'ai_marketing_assistant')!;
    expect(other.accessible).toBe(false); expect(other.lockReason).toBe('not_subscribed'); expect(other.trialAvailable).toBe(true);
  });

  it('reflects an expired trial as locked', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const { svc } = mk([sub({ packageCode: 'ai_business_assistant', status: 'trialing', trialEndsAt: past })]);
    const p = (await svc.catalog(OWNER)).packages.find((x) => x.code === 'ai_business_assistant')!;
    expect(p.accessible).toBe(false); expect(p.lockReason).toBe('trial_expired');
  });

  it('start trial creates a trialing subscription', async () => {
    const { repo, svc } = mk();
    const r = await svc.startTrial(OWNER, 'ai_business_assistant');
    expect(r.status).toBe('trialing'); expect(r.trialEndsAt).toBeInstanceOf(Date);
    expect(repo.rows[0]).toMatchObject({ tenantId: 't1', packageCode: 'ai_business_assistant', status: 'trialing' });
  });

  it('rejects double-subscribe and unknown package', async () => {
    const { svc } = mk([sub({ packageCode: 'ai_business_assistant', status: 'active' })]);
    await expect(svc.startTrial(OWNER, 'ai_business_assistant')).rejects.toMatchObject({ code: 'bad_request' });
    await expect(svc.startTrial(OWNER, 'nope')).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('cancel sets cancelled; missing → not_found', async () => {
    const { repo, svc } = mk([sub({ packageCode: 'ai_inventory_assistant', status: 'active' })]);
    await svc.cancel(OWNER, 'ai_inventory_assistant');
    expect(repo.rows[0].status).toBe('cancelled');
    await expect(svc.cancel(OWNER, 'ai_fraud_money_protection')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('enforces tenant + manage permission', async () => {
    const { svc } = mk();
    await expect(svc.catalog({ permissions: ['ai.use'] } as any)).rejects.toMatchObject({ code: 'forbidden' }); // no tenantId
    await expect(svc.startTrial({ tenantId: 't1', permissions: ['ai.use'] } as any, 'ai_business_assistant')).rejects.toMatchObject({ code: 'forbidden' }); // can't manage
  });
});
