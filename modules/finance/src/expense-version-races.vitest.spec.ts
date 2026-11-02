// Receipt / Expense re-audit (Oct 28 2026): attachDocument and matchPayment ignored a lost version race — the history said
// "attached" while receipt_document_id was never set, and a payment-match verdict silently overwrote a concurrent edit (and
// wrote no audit row). Both now answer EXPENSE_VERSION_CONFLICT and roll the transaction back; matchPayment is audited.
import { describe, it, expect } from 'vitest';
import { ExpenseService } from './expense.service';

const CTX = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: ['owner.expenses.view', 'owner.expenses.manage'] } as any;
function make(versionWins: boolean) {
  const writes: string[] = [];
  const audits: string[] = [];
  const db: any = { transaction: () => ({ execute: async (fn: (t: any) => Promise<unknown>) => { const staged: string[] = []; const r = await fn({ staged }); writes.push(...staged); return r; } }) };
  const svc = new ExpenseService(db, { async resolve() { return { branchId: null, allowed: null, restricted: null }; } } as any);
  const e = { id: 'e1', branchId: 'b1', version: 3, status: 'pending_review', receiptDocumentId: null, amountCents: 1000, incurredOn: '2026-10-20', cardLast4: null, referenceNumber: null, vendor: 'Sally', vendorName: null };
  (svc as any).repo = {
    async get() { return { ...e }; },
    async receiptEvidence() { return { id: 'd1' }; },
    async attachDocument(t: any) { t.staged.push('attach'); },
    async updateAtVersion(t: any) { t.staged.push('update'); return versionWins; },
    async history(t: any, _tenant: string, h: { action: string }) { t.staged.push('history:' + h.action); },
  };
  svc.audit = { async record(_c: unknown, a: { action: string }) { audits.push(a.action); } } as any;
  return { svc, writes, audits };
}

describe('a lost version race is a conflict, never a silent write', () => {
  it('attachDocument as the receipt: conflict → nothing committed (no "attached" history without the link)', async () => {
    const { svc, writes, audits } = make(false);
    await expect(svc.attachDocument(CTX, 'e1', 'd1', 'receipt')).rejects.toMatchObject({ code: 'EXPENSE_VERSION_CONFLICT' });
    expect(writes).toEqual([]); expect(audits).toEqual([]);
  });
  it('attachDocument wins the race → attach, link, history, audit', async () => {
    const { svc, writes, audits } = make(true);
    await svc.attachDocument(CTX, 'e1', 'd1', 'receipt');
    expect(writes).toEqual(['attach', 'update', 'history:document_attached']);
    expect(audits).toEqual(['expense_document_attached']);
  });
  it('matchPayment: conflict → nothing committed; a win is audited', async () => {
    const lost = make(false);
    await expect(lost.svc.matchPayment(CTX, 'e1')).rejects.toMatchObject({ code: 'EXPENSE_VERSION_CONFLICT' });
    expect(lost.writes).toEqual([]);
    const won = make(true);
    expect((await won.svc.matchPayment(CTX, 'e1')).verdict).toBe('unmatched');
    expect(won.audits).toEqual(['expense_payment_match_checked']);
  });
});
