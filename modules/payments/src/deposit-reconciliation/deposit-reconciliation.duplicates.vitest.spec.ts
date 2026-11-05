import { describe, it, expect } from 'vitest';
import { detectSettlementDuplicates, detectDepositDuplicates, buildDuplicatesState } from './deposit-reconciliation.duplicates';
import type { Settlement, BankDeposit } from './deposit-reconciliation.dto';
import { InMemoryReconRepository } from './deposit-reconciliation.repository';
import { DuplicateDetectionService } from './deposit-reconciliation.duplicates.service';
import { ReconForbiddenError } from './deposit-reconciliation.service';

const s = (o: Partial<Settlement> = {}): Settlement => ({ id: 's1', branchId: 'b1', processorType: 'fiserv', settlementRef: 'B1', grossCents: 10000, feeCents: 300, netCents: 9700, currency: 'USD', status: 'settled', settledAt: '2026-07-01T00:00:00.000Z', ...o });
const d = (o: Partial<BankDeposit> = {}): BankDeposit => ({ id: 'd1', branchId: 'b1', bankAccountId: 'acc1', amountCents: 9700, currency: 'USD', depositDate: '2026-07-02', postedAt: null, description: null, reference: null, externalBankTxnId: null, source: 'manual', status: 'posted', matchedSettlementId: null, reconciliationStatus: 'unmatched', ...o });

describe('duplicates — settlements (pure)', () => {
  it('exact duplicate by processor settlement reference', () => {
    const g = detectSettlementDuplicates([s({ id: 's1', settlementRef: 'B1' }), s({ id: 's2', settlementRef: 'B1' })]);
    expect(g.length).toBe(1); expect(g[0].severity).toBe('exact_duplicate'); expect(g[0].signal).toBe('external_id'); expect(g[0].members.length).toBe(2);
  });
  it('possible duplicate by amount+date when no ref match', () => {
    const g = detectSettlementDuplicates([s({ id: 's1', settlementRef: null }), s({ id: 's2', settlementRef: null })]);
    expect(g[0].severity).toBe('possible_duplicate');
  });
  it('no false positive on unique settlements', () => {
    expect(detectSettlementDuplicates([s({ id: 's1', settlementRef: 'B1' }), s({ id: 's2', settlementRef: 'B2', netCents: 5000, settledAt: '2026-07-05T00:00:00.000Z' })]).length).toBe(0);
  });
});

describe('duplicates — deposits (pure)', () => {
  it('exact duplicate by external bank txn id', () => {
    const g = detectDepositDuplicates([d({ id: 'd1', externalBankTxnId: 'X1' }), d({ id: 'd2', externalBankTxnId: 'X1' })]);
    expect(g[0].severity).toBe('exact_duplicate'); expect(g[0].signal).toBe('external_id');
  });
  it('likely duplicate by amount+date+reference', () => {
    const g = detectDepositDuplicates([d({ id: 'd1', reference: 'ACH-9' }), d({ id: 'd2', reference: 'ACH-9' })]);
    expect(g[0].severity).toBe('likely_duplicate'); expect(g[0].signal).toBe('amount_date_reference');
  });
  it('possible duplicate by amount+date only', () => {
    const g = detectDepositDuplicates([d({ id: 'd1' }), d({ id: 'd2' })]);
    expect(g[0].severity).toBe('possible_duplicate');
  });
});

describe('duplicates — state + service', () => {
  it('KPIs count extra copies (members - 1)', () => {
    const st = buildDuplicatesState([s({ id: 's1', settlementRef: 'B1' }), s({ id: 's2', settlementRef: 'B1' })], [d({ id: 'd1', externalBankTxnId: 'X1' }), d({ id: 'd2', externalBankTxnId: 'X1' }), d({ id: 'd3', externalBankTxnId: 'X1' })]);
    expect(st.kpis.exact).toBe(2); expect(st.kpis.duplicateRecordCount).toBe(1 + 2); // s: 1 extra, d: 2 extra
  });
  it('rejects unauthenticated', async () => {
    const svc = new DuplicateDetectionService(new InMemoryReconRepository());
    await expect(svc.getState({ tenantId: 't1', userId: '', role: 'OWNER', permissions: [] } as any)).rejects.toBeInstanceOf(ReconForbiddenError);
  });
  it('isolation: only the ctx tenant data is examined', async () => {
    const repo = new InMemoryReconRepository({ settlements: [{ tenantId: 't1', ...s({ id: 's1', settlementRef: 'B1' }) } as any, { tenantId: 't1', ...s({ id: 's2', settlementRef: 'B1' }) } as any, { tenantId: 't2', ...s({ id: 's3', settlementRef: 'B1' }) } as any] });
    const svc = new DuplicateDetectionService(repo);
    const stA = await svc.getState({ tenantId: 't1', userId: 'u', role: 'OWNER', permissions: [] } as any);
    expect(stA.kpis.exact).toBe(1); // t1 has the dupe pair; t2's row is not visible
    const stB = await svc.getState({ tenantId: 't2', userId: 'u', role: 'OWNER', permissions: [] } as any);
    expect(stB.groups.length).toBe(0); // t2 has a single row only
  });
});
