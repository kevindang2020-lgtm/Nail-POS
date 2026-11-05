// Super-Admin AI subscription manager — rollup math, assign/update normalization, and service operations (assign,
// grant-trial, update limit, cancel) over the in-memory repo.
import { describe, it, expect } from 'vitest';
import { catalogWithRollup, normalizeAssign, normalizeUpdate, type SubRow } from './ai-admin-core';
import { AiAdminService } from './ai-admin.service';
import { InMemoryAiAdminRepo } from './ai-admin.repository';

const sub = (over: Partial<SubRow>): SubRow => ({ tenantId: 't1', packageCode: 'ai_booking_assistant', status: 'active', billingPeriod: 'monthly', priceCents: 4900, usageLimit: 1000, overageEnabled: false, trialEndsAt: null, currentPeriodStartsAt: null, ...over });

describe('ai-admin-core', () => {
  it('rolls subscriptions per package with status breakdown + MRR (active only, yearly→/12)', () => {
    const rows: SubRow[] = [
      sub({ tenantId: 'a', status: 'active', priceCents: 4900 }),
      sub({ tenantId: 'b', status: 'active', billingPeriod: 'yearly', priceCents: 52800 }), // 4400/mo
      sub({ tenantId: 'c', status: 'trialing' }),
      sub({ tenantId: 'd', packageCode: 'ai_analytics_forecasting', status: 'cancelled' }),
    ];
    const cat = catalogWithRollup(rows);
    expect(cat).toHaveLength(15);
    const booking = cat.find((p) => p.code === 'ai_booking_assistant')!;
    expect(booking.subscribers).toBe(3); expect(booking.activeSubscribers).toBe(2);
    expect(booking.byStatus).toEqual({ active: 2, trialing: 1 });
    expect(booking.mrrCents).toBe(4900 + 4400); // trialing excluded
    expect(cat.find((p) => p.code === 'ai_analytics_forecasting')!.mrrCents).toBe(0);
  });
  it('normalizeAssign fills catalog defaults and computes trial dates', () => {
    const bad = normalizeAssign({ packageCode: 'nope' });
    expect(bad.ok).toBe(false);
    const trial = normalizeAssign({ packageCode: 'ai_business_assistant', trial: true });
    expect(trial.ok && trial.value.status).toBe('trialing');
    expect(trial.ok && trial.value.trialEndsAt).toBeInstanceOf(Date);
    expect(trial.ok && trial.value.usageLimit).toBe(1000); // catalog default
    const paid = normalizeAssign({ packageCode: 'ai_business_assistant', usageLimit: 250, overageEnabled: true });
    expect(paid.ok && paid.value.status).toBe('active');
    expect(paid.ok && paid.value.usageLimit).toBe(250);
  });
  it('normalizeUpdate rejects bad fields and empty patches', () => {
    expect(normalizeUpdate({}).ok).toBe(false);
    expect(normalizeUpdate({ status: 'bogus' }).ok).toBe(false);
    const ok = normalizeUpdate({ usageLimit: 5000, overageEnabled: true });
    expect(ok.ok && ok.value).toEqual({ usageLimit: 5000, overageEnabled: true });
  });
});

describe('AiAdminService', () => {
  const mk = () => { const repo = new InMemoryAiAdminRepo(); return { repo, svc: new AiAdminService(repo, null) }; };
  it('assign creates a subscription and shows in the catalog rollup', async () => {
    const { repo, svc } = mk();
    const r = await svc.assign({ userId: 'admin1' }, 't9', { packageCode: 'ai_marketing_assistant', usageLimit: 300 });
    expect(r.ok).toBe(true); expect(repo.rows[0]).toMatchObject({ tenantId: 't9', packageCode: 'ai_marketing_assistant', status: 'active', usageLimit: 300 });
    const cat = await svc.catalog();
    expect(cat.packages.find((p) => p.code === 'ai_marketing_assistant')!.subscribers).toBe(1);
    expect(cat.totals.activeSubscribers).toBe(1);
  });
  it('grant trial sets trialing + trial end', async () => {
    const { repo, svc } = mk();
    await svc.assign({}, 't9', { packageCode: 'ai_ocr_receipt_scanner', trial: true });
    expect(repo.rows[0].status).toBe('trialing'); expect(repo.rows[0].trialEndsAt).toBeTruthy();
  });
  it('update changes the limit; cancel sets cancelled; missing → not_found', async () => {
    const { repo, svc } = mk();
    await svc.assign({}, 't9', { packageCode: 'ai_inventory_assistant' });
    await svc.update({}, 't9', 'ai_inventory_assistant', { usageLimit: 99, overageEnabled: true });
    expect(repo.rows[0]).toMatchObject({ usageLimit: 99, overageEnabled: true });
    await svc.cancel({}, 't9', 'ai_inventory_assistant');
    expect(repo.rows[0].status).toBe('cancelled');
    await expect(svc.cancel({}, 't9', 'ai_fraud_money_protection')).rejects.toMatchObject({ code: 'not_found' });
  });
});
