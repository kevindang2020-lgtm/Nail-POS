import { describe, it, expect } from 'vitest';
import { InMemoryReconRepository } from './deposit-reconciliation.repository';
import { InMemoryFeeScheduleRepository } from './deposit-reconciliation.fees.repository';
import { InMemoryExceptionsRepository } from './deposit-reconciliation.exceptions.repository';
import { InMemorySweepRepository } from './deposit-reconciliation.sweep.repository';
import { ReconSweepService } from './deposit-reconciliation.sweep.service';

const ctx = (t = 't1') => ({ tenantId: t, userId: 'sys', role: 'SYSTEM', permissions: [] } as any);
// S1: settled long ago, no deposit -> missing_deposit; fee matches (no fee exception).
// S2: recent, matched deposit -> not missing; fee differs -> fee_difference.
const settlements = [
  { tenantId: 't1', id: 'S1', branchId: 'b1', processorType: 'fiserv', settlementRef: 'S1', grossCents: 100000, feeCents: 2900, netCents: 97100, currency: 'USD', status: 'settled', settledAt: '2026-06-01T00:00:00.000Z' },
  { tenantId: 't1', id: 'S2', branchId: 'b1', processorType: 'fiserv', settlementRef: 'S2', grossCents: 50000, feeCents: 2000, netCents: 48000, currency: 'USD', status: 'settled', settledAt: '2026-07-07T00:00:00.000Z' },
] as any;
const deposits = [
  { tenantId: 't1', id: 'D2', bankAccountId: 'acc1', amountCents: 48000, depositDate: '2026-07-07', reference: 'S2', externalBankTxnId: 'X2', source: 'manual', status: 'posted', matchedSettlementId: null, reconciliationStatus: 'unmatched' },
] as any;
const schedules = [{ tenantId: 't1', processorType: 'fiserv', label: '2.9%', version: 1, effectiveFrom: '2026-01-01', percentageBps: 290, perTransactionCents: 0, batchCents: 0, monthlyCents: 0 }] as any;

const build = (exc = new InMemoryExceptionsRepository()) => new ReconSweepService(
  new InMemorySweepRepository(['t1']), new InMemoryReconRepository({ settlements, deposits }), new InMemoryFeeScheduleRepository(schedules), exc,
);

describe('recon sweep — auto-detects and is idempotent', () => {
  it('creates a missing-deposit and a fee-difference exception, then nothing on re-run', async () => {
    const exc = new InMemoryExceptionsRepository();
    const svc = build(exc);
    const first = await svc.sweepTenant(ctx());
    expect(first).toBe(2);
    const items = await exc.list(ctx());
    const refs = items.map((i) => i.sourceRef).sort();
    expect(refs).toContain('missing_deposit:S1');
    expect(refs).toContain('fee_difference:S2');
    // idempotent: a second sweep creates nothing (unresolved exceptions already exist)
    expect(await svc.sweepTenant(ctx())).toBe(0);
    expect((await exc.list(ctx())).length).toBe(2);
  });

  it('re-flags a case only after the prior one is resolved', async () => {
    const exc = new InMemoryExceptionsRepository();
    const svc = build(exc);
    await svc.sweepTenant(ctx());
    const missing = (await exc.list(ctx())).find((i) => i.sourceRef === 'missing_deposit:S1')!;
    await exc.update(ctx(), missing.id, { status: 'resolved', resolutionNote: 'bank confirmed', resolvedByUserId: 'u1', resolvedAt: new Date().toISOString() } as any);
    // once resolved, a later sweep may open a fresh case for the same source_ref (still unmatched)
    const created = await svc.sweepTenant(ctx());
    expect(created).toBe(1);
  });

  it('sweepAll iterates active tenants', async () => {
    const r = await build().sweepAll();
    expect(r.tenantsSwept).toBe(1); expect(r.exceptionsCreated).toBe(2);
  });

  it('never resolves or mutates money — only creates open cases', async () => {
    const exc = new InMemoryExceptionsRepository();
    await build(exc).sweepTenant(ctx());
    expect((await exc.list(ctx())).every((i) => i.status === 'open')).toBe(true);
  });
});
