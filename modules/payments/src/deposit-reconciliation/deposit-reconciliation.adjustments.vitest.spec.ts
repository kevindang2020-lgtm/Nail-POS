import { describe, it, expect } from 'vitest';
import { buildAdjustmentsState, refundResolved, chargebackResolved, adjustmentResolved, type ReconAdjustment } from './deposit-reconciliation.adjustments';
import { InMemoryAdjustmentsRepository } from './deposit-reconciliation.adjustments.repository';
import { AdjustmentsReconciliationService } from './deposit-reconciliation.adjustments.service';
import { ReconForbiddenError } from './deposit-reconciliation.service';

const adj = (o: Partial<ReconAdjustment> = {}): ReconAdjustment => ({ id: 'a1', kind: 'refund', amountCents: -500, grossAmountCents: 500, currency: 'USD', status: 'refunded', reason: null, processorType: 'fiserv', branchId: 'b1', resolved: true, createdAt: '2026-07-01T00:00:00.000Z', ...o });

describe('adjustments — resolution vocab (pure)', () => {
  it('maps each source system status', () => {
    expect(refundResolved('refunded')).toBe(true);
    expect(chargebackResolved('open')).toBe(false);
    expect(chargebackResolved('won')).toBe(true);
    expect(adjustmentResolved('pending')).toBe(false);
    expect(adjustmentResolved('applied')).toBe(true);
  });
});

describe('adjustments — state KPIs (pure)', () => {
  it('separates refunds/chargebacks/adjustments and computes signed deposit impact', () => {
    const st = buildAdjustmentsState([
      adj({ id: 'r1', kind: 'refund', amountCents: -500, grossAmountCents: 500 }),
      adj({ id: 'c1', kind: 'chargeback', amountCents: -2500, grossAmountCents: 2500, status: 'open', resolved: false }),
      adj({ id: 'j1', kind: 'adjustment', amountCents: 1000, grossAmountCents: 1000, status: 'applied', resolved: true }),
    ]);
    expect(st.kpis.refundCents).toBe(500);
    expect(st.kpis.chargebackCents).toBe(2500);
    expect(st.kpis.adjustmentNetCents).toBe(1000);
    expect(st.kpis.unresolvedCount).toBe(1);            // open chargeback
    expect(st.kpis.depositImpactCents).toBe(-500 - 2500 + 1000); // -2000
  });
});

describe('adjustments — service (auth + isolation)', () => {
  const ctx = (t = 't1') => ({ tenantId: t, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['reconciliation.view'] } as any);
  it('rejects unauthenticated', async () => {
    const svc = new AdjustmentsReconciliationService(new InMemoryAdjustmentsRepository());
    await expect(svc.getState({ ...ctx(), userId: '' })).rejects.toBeInstanceOf(ReconForbiddenError);
  });
  it('isolation: tenant B sees none of tenant A adjustments', async () => {
    const repo = new InMemoryAdjustmentsRepository([{ tenantId: 't1', ...adj() } as any]);
    const svc = new AdjustmentsReconciliationService(repo);
    expect((await svc.getState(ctx('t1'))).items.length).toBe(1);
    expect((await svc.getState(ctx('t2'))).items.length).toBe(0);
  });
});
