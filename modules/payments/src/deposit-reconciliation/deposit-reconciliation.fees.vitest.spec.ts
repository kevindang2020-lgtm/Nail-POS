import { describe, it, expect } from 'vitest';
import { applicableSchedule, expectedFee, reconcileFee, buildFeeReconState, validateFeeSchedule, DEFAULT_FEE_OPTIONS, type FeeSchedule } from './deposit-reconciliation.fees';
import type { Settlement } from './deposit-reconciliation.dto';
import { InMemoryReconRepository } from './deposit-reconciliation.repository';
import { InMemoryFeeScheduleRepository } from './deposit-reconciliation.fees.repository';
import { FeeReconciliationService } from './deposit-reconciliation.fees.service';
import { ReconForbiddenError, ReconValidationError } from './deposit-reconciliation.service';

const sched = (o: Partial<FeeSchedule> = {}): FeeSchedule => ({ id: 'f1', processorType: 'fiserv', label: 'Standard', version: 1, effectiveFrom: '2026-01-01', percentageBps: 290, perTransactionCents: 0, batchCents: 0, monthlyCents: 0, notes: null, ...o });
const settle = (o: Partial<Settlement> = {}): Settlement => ({ id: 's1', branchId: 'b1', processorType: 'fiserv', settlementRef: 'B1', grossCents: 100000, feeCents: 2900, netCents: 97100, currency: 'USD', status: 'settled', settledAt: '2026-07-01T00:00:00.000Z', ...o });

describe('fees — applicable schedule version (pure)', () => {
  it('picks the greatest effective_from <= settlement date', () => {
    const a = sched({ id: 'v1', version: 1, effectiveFrom: '2026-01-01', percentageBps: 300 });
    const b = sched({ id: 'v2', version: 2, effectiveFrom: '2026-06-01', percentageBps: 250 });
    expect(applicableSchedule([a, b], settle({ settledAt: '2026-07-01T00:00:00.000Z' }))?.version).toBe(2);
    expect(applicableSchedule([a, b], settle({ settledAt: '2026-03-01T00:00:00.000Z' }))?.version).toBe(1);
  });
  it('ignores schedules for a different processor', () => {
    expect(applicableSchedule([sched({ processorType: 'clover' })], settle({ processorType: 'fiserv' }))).toBeNull();
  });
});

describe('fees — expected fee + honest unverified (pure)', () => {
  it('percentage-only fee is verifiable', () => {
    const ef = expectedFee(sched({ percentageBps: 290 }), settle({ grossCents: 100000 }), null);
    expect(ef.verifiable).toBe(true); expect(ef.expectedCents).toBe(2900);
  });
  it('per-transaction fee with no txn count is UNVERIFIED, not a difference', () => {
    const ef = expectedFee(sched({ percentageBps: 290, perTransactionCents: 10 }), settle(), null);
    expect(ef.verifiable).toBe(false); expect(ef.expectedCents).toBeNull();
    expect(ef.unverifiedReason).toMatch(/transaction count/i);
  });
});

describe('fees — reconcile status (pure)', () => {
  it('matched within tolerance', () => { expect(reconcileFee(sched(), settle({ feeCents: 2900 }), DEFAULT_FEE_OPTIONS).status).toBe('matched'); });
  it('fee_difference outside tolerance', () => { const r = reconcileFee(sched(), settle({ feeCents: 3500 }), DEFAULT_FEE_OPTIONS); expect(r.status).toBe('fee_difference'); expect(r.differenceCents).toBe(600); });
  it('unverified when per-transaction fee cannot be computed', () => { expect(reconcileFee(sched({ perTransactionCents: 10 }), settle(), DEFAULT_FEE_OPTIONS).status).toBe('unverified'); });
  it('no_schedule when none applies', () => { expect(reconcileFee(null, settle(), DEFAULT_FEE_OPTIONS).status).toBe('no_schedule'); });
});

describe('fees — state KPIs (pure)', () => {
  it('rolls up verified/unverified/matched/difference honestly', () => {
    const st = buildFeeReconState(
      [settle({ id: 's1', feeCents: 2900 }), settle({ id: 's2', feeCents: 3500 }), settle({ id: 's3', processorType: 'clover' })],
      [sched({ percentageBps: 290 })], DEFAULT_FEE_OPTIONS);
    expect(st.kpis.matched).toBe(1);
    expect(st.kpis.feeDifferences).toBe(1);
    expect(st.kpis.noSchedule).toBe(1);      // clover settlement, no clover schedule
    expect(st.kpis.feeDifferenceCents).toBe(600);
  });
});

describe('fees — service (auth, validation, version bump, isolation)', () => {
  const ctx = (t = 't1') => ({ tenantId: t, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['reconciliation.manage'] } as any);
  it('rejects unauthenticated', async () => {
    const svc = new FeeReconciliationService(new InMemoryReconRepository(), new InMemoryFeeScheduleRepository());
    await expect(svc.listFeeSchedules({ ...ctx(), userId: '' })).rejects.toBeInstanceOf(ReconForbiddenError);
  });
  it('validates + bumps version per (tenant, processor)', async () => {
    const svc = new FeeReconciliationService(new InMemoryReconRepository(), new InMemoryFeeScheduleRepository());
    await expect(svc.createFeeSchedule(ctx(), { processorType: '', label: 'x', effectiveFrom: '2026-01-01' } as any)).rejects.toBeInstanceOf(ReconValidationError);
    const v1 = await svc.createFeeSchedule(ctx(), { processorType: 'fiserv', label: 'Std', effectiveFrom: '2026-01-01', percentageBps: 290 });
    const v2 = await svc.createFeeSchedule(ctx(), { processorType: 'fiserv', label: 'New', effectiveFrom: '2026-06-01', percentageBps: 250 });
    expect(v1.version).toBe(1); expect(v2.version).toBe(2);
  });
  it('isolation: tenant B cannot see tenant A schedules', async () => {
    const feeRepo = new InMemoryFeeScheduleRepository();
    const svc = new FeeReconciliationService(new InMemoryReconRepository(), feeRepo);
    await svc.createFeeSchedule(ctx('t1'), { processorType: 'fiserv', label: 'A', effectiveFrom: '2026-01-01', percentageBps: 290 });
    expect((await svc.listFeeSchedules(ctx('t2'))).length).toBe(0);
  });
});
