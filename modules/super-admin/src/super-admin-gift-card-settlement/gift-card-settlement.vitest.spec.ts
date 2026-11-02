import { describe, it, expect } from 'vitest';
import { InMemoryGiftCardSettlementRepo, type ClearingEntryRow } from './gift-card-settlement.repository';
import { GiftCardSettlementService } from './gift-card-settlement.service';

const entry = (id: string, issuer: string, redeemer: string, amount: number, fee = 0): ClearingEntryRow => ({ id, programId: 'P', giftCardId: 'gc_' + id, issuingTenantId: issuer, redeemingTenantId: redeemer, amountCents: amount, platformFeeCents: fee, status: 'pending', settlementBatchId: null, createdAt: '2026-07-01T00:00:00Z' });
const setup = (entries: ClearingEntryRow[]) => { const repo = new InMemoryGiftCardSettlementRepo(); repo.seed(entries); return { repo, svc: new GiftCardSettlementService(repo) }; };

describe('GiftCardSettlementService', () => {
  it('summarizes pending obligations and per-salon positions', async () => {
    const { svc } = setup([entry('e1', 'A', 'B', 4000, 100), entry('e2', 'A', 'B', 2000, 50)]);
    const st = await svc.getState();
    expect(st.pending.count).toBe(2);
    expect(st.pending.totalCents).toBe(6000);
    expect(st.pending.feeCents).toBe(150);
    expect(st.pending.netCents).toBe(5850);
    const A = st.positions.find((p) => p.tenantId === 'A')!;
    const B = st.positions.find((p) => p.tenantId === 'B')!;
    expect(A.payableCents).toBe(6000); expect(A.netCents).toBe(-6000);
    expect(B.receivableCents).toBe(6000); expect(B.netCents).toBe(6000);
  });

  it('groups pending entries into a batch with fee-aware totals and empties the pending queue', async () => {
    const { svc } = setup([entry('e1', 'A', 'B', 4000, 100), entry('e2', 'A', 'B', 2000, 50)]);
    const batch = await svc.createBatch({});
    expect(batch.status).toBe('open');
    expect(batch.totalCents).toBe(6000);
    expect(batch.feeCents).toBe(150);
    expect(batch.netCents).toBe(5850);
    expect(batch.entryCount).toBe(2);
    const st = await svc.getState();
    expect(st.pending.count).toBe(0);
    expect(st.batches.length).toBe(1);
  });

  it('refuses to create a batch when there is nothing pending', async () => {
    await expect(setup([]).svc.createBatch({})).rejects.toThrow(/no pending/i);
  });

  it('drives a batch through the reviewed lifecycle, cascading entry status', async () => {
    const { svc } = setup([entry('e1', 'A', 'B', 5000)]);
    const b = await svc.createBatch({});
    await svc.setBatchStatus(b.id, { status: 'pending_review' }, 'admin1');
    const approved = await svc.setBatchStatus(b.id, { status: 'approved' }, 'admin1');
    expect(approved.status).toBe('approved');
    expect(approved.approvedByUserId).toBe('admin1');
    expect((await svc.getBatch(b.id)).entries[0].status).toBe('approved');
    const settled = await svc.setBatchStatus(b.id, { status: 'settled' }, 'admin1');
    expect(settled.status).toBe('settled');
    expect((await svc.getBatch(b.id)).entries[0].status).toBe('settled');
  });

  it('rejects an invalid lifecycle transition (no auto-settle) and a missing batch', async () => {
    const { svc } = setup([entry('e1', 'A', 'B', 5000)]);
    const b = await svc.createBatch({});
    await expect(svc.setBatchStatus(b.id, { status: 'settled' }, 'admin1')).rejects.toThrow(/cannot move/i);
    await expect(svc.setBatchStatus('nope', { status: 'approved' }, 'admin1')).rejects.toThrow(/not found/i);
  });

  it('positions exclude settled obligations', async () => {
    const { svc } = setup([entry('e1', 'A', 'B', 5000)]);
    const b = await svc.createBatch({});
    await svc.setBatchStatus(b.id, { status: 'pending_review' }, 'a');
    await svc.setBatchStatus(b.id, { status: 'approved' }, 'a');
    await svc.setBatchStatus(b.id, { status: 'settled' }, 'a');
    expect((await svc.getState()).positions.length).toBe(0);
  });
});
