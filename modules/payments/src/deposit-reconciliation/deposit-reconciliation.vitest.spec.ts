import { describe, it, expect } from 'vitest';
import { buildReconState, matchSettlement, expectedDepositCents, validateBankAccount, validateDeposit, DEFAULT_RECON_OPTIONS, type Settlement, type BankDeposit, type ReconOptions } from './deposit-reconciliation.dto';
import { InMemoryReconRepository } from './deposit-reconciliation.repository';
import { DepositReconciliationService, ReconForbiddenError, ReconValidationError } from './deposit-reconciliation.service';

const opts = (o: Partial<ReconOptions> = {}): ReconOptions => ({ ...DEFAULT_RECON_OPTIONS, nowIso: '2026-07-20T00:00:00.000Z', ...o });
const settle = (o: Partial<Settlement> = {}): Settlement => ({ id: 's1', branchId: 'b1', processorType: 'fiserv', settlementRef: 'BATCH-1', grossCents: 10000, feeCents: 300, netCents: 9700, currency: 'USD', status: 'settled', settledAt: '2026-07-01T00:00:00.000Z', ...o });
const dep = (o: Partial<BankDeposit> = {}): BankDeposit => ({ id: 'd1', branchId: 'b1', bankAccountId: 'bank1', amountCents: 9700, currency: 'USD', depositDate: '2026-07-02', postedAt: null, description: null, reference: null, externalBankTxnId: null, source: 'manual', status: 'posted', matchedSettlementId: null, reconciliationStatus: 'unmatched', ...o });

describe('recon — expected deposit (pure)', () => {
  it('expected = net (gross - fees)', () => { expect(expectedDepositCents(settle())).toBe(9700); });
});

describe('recon — matching (pure, deterministic)', () => {
  it('exact reference match beats amount', () => {
    const m = matchSettlement(settle(), [dep({ id: 'd1', amountCents: 9999, reference: 'BATCH-1' })], opts());
    expect(m?.matchType).toBe('reference');
  });
  it('exact amount within date window = matched', () => {
    const m = matchSettlement(settle(), [dep({ amountCents: 9700, depositDate: '2026-07-03' })], opts());
    expect(m?.status).toBe('matched'); expect(m?.matchType).toBe('amount_exact');
  });
  it('amount within tolerance = matched_with_tolerance', () => {
    const m = matchSettlement(settle(), [dep({ amountCents: 9660, depositDate: '2026-07-02' })], opts({ toleranceCents: 100 }));
    expect(m?.status).toBe('matched_with_tolerance');
  });
  it('outside tolerance = no match', () => {
    expect(matchSettlement(settle(), [dep({ amountCents: 9000 })], opts())).toBeNull();
  });
  it('outside date window = no amount match', () => {
    expect(matchSettlement(settle(), [dep({ amountCents: 9700, depositDate: '2026-07-30' })], opts({ dateWindowDays: 5 }))).toBeNull();
  });
});

describe('recon — state + missing-deposit detection (pure)', () => {
  it('classifies matched, unmatched deposit, and missing deposit past funding window', () => {
    const settlements = [settle({ id: 's1', settledAt: '2026-07-01T00:00:00.000Z' }), settle({ id: 's2', settlementRef: 'BATCH-2', settledAt: '2026-07-19T00:00:00.000Z', netCents: 5000 })];
    const deposits = [dep({ id: 'd1', amountCents: 9700, reference: 'BATCH-1' }), dep({ id: 'd2', amountCents: 4242, depositDate: '2026-07-10' })];
    const st = buildReconState(settlements, deposits, opts()); // now=2026-07-20
    // s1 matched by reference; s2 (settled yesterday) has no deposit but is within funding window -> unmatched, not missing
    const s1 = st.rows.find((r) => r.settlementId === 's1')!; expect(s1.status).toBe('matched');
    const s2 = st.rows.find((r) => r.settlementId === 's2')!; expect(s2.status).toBe('unmatched_settlement');
    expect(st.kpis.unmatchedDeposits).toBe(1); // d2 unclaimed
  });
  it('flags a settlement past the funding window with no deposit as missing_deposit', () => {
    const st = buildReconState([settle({ settledAt: '2026-07-01T00:00:00.000Z' })], [], opts()); // 19 days old > 3
    expect(st.rows[0].status).toBe('missing_deposit'); expect(st.kpis.missingDeposits).toBe(1);
  });
  it('each deposit is claimed by at most one settlement', () => {
    const st = buildReconState([settle({ id: 's1' }), settle({ id: 's2', settlementRef: null })], [dep({ amountCents: 9700 })], opts());
    const matched = st.rows.filter((r) => r.depositId != null); expect(matched.length).toBe(1);
  });
});

describe('recon — service (auth, validation, isolation, human link)', () => {
  const ctx = (t = 't1') => ({ tenantId: t, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['reconciliation.manage'] } as any);
  it('rejects unauthenticated', async () => {
    const svc = new DepositReconciliationService(new InMemoryReconRepository());
    await expect(svc.getState({ ...ctx(), userId: '' })).rejects.toBeInstanceOf(ReconForbiddenError);
  });
  it('validates bank account + only stores last4', async () => {
    const svc = new DepositReconciliationService(new InMemoryReconRepository());
    await expect(svc.createBankAccount(ctx(), { nickname: '' } as any)).rejects.toBeInstanceOf(ReconValidationError);
    const a = await svc.createBankAccount(ctx(), { nickname: 'Ops', accountLast4: '1234567890' } as any);
    expect(a.accountLast4).toBe('7890'); // truncated to last4
  });
  it('deposit requires a tenant-owned bank account', async () => {
    const svc = new DepositReconciliationService(new InMemoryReconRepository());
    await expect(svc.createDeposit(ctx(), { bankAccountId: 'nope', amountCents: 100 } as any)).rejects.toBeInstanceOf(ReconValidationError);
  });
  it('links a deposit to a settlement (human action) with derived status', async () => {
    const repo = new InMemoryReconRepository({ settlements: [{ tenantId: 't1', ...settle() } as any] });
    const svc = new DepositReconciliationService(repo);
    const acct = await svc.createBankAccount(ctx(), { nickname: 'Ops' } as any);
    const d = await svc.createDeposit(ctx(), { bankAccountId: acct.id, amountCents: 9700 } as any);
    const linked = await svc.linkDeposit(ctx(), d.id, 's1');
    expect(linked.matchedSettlementId).toBe('s1'); expect(linked.reconciliationStatus).toBe('matched');
  });
  it('isolation: tenant B cannot see tenant A settlements/deposits', async () => {
    const repo = new InMemoryReconRepository({ settlements: [{ tenantId: 't1', ...settle() } as any] });
    const svc = new DepositReconciliationService(repo);
    const acctA = await svc.createBankAccount(ctx('t1'), { nickname: 'A' } as any);
    await svc.createDeposit(ctx('t1'), { bankAccountId: acctA.id, amountCents: 9700 } as any);
    const stateB = await svc.getState(ctx('t2'));
    expect(stateB.rows.length).toBe(0); expect(stateB.accounts.length).toBe(0); expect(stateB.unmatchedDeposits.length).toBe(0);
  });
});
