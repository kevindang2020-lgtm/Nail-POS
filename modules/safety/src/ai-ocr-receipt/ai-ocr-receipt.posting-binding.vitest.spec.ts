// ai-ocr-receipt.posting-binding.vitest.spec.ts — verifies the OCR posting ports bound to the real
// InventoryService contract: PostingCtx→InvCtx mapping, the { ok, expense:{id} } → { id } shape, and that a
// throwing backend yields a FAILED posting (never a fabricated success) through PostingService.
import { describe, it, expect } from 'vitest';
import { InventoryExpensePost, InventoryReceiveAdapter, type InventoryPostingBackend } from './ai-ocr-receipt.kysely';
import { PostingService, type ApprovedDocument, type PostingCtx } from './ai-ocr-receipt-posting';
import { InMemoryPostingIdempotency } from './ai-ocr-receipt.kysely';

const pctx: PostingCtx = { tenantId: 't1', branchId: null, userId: 'u1', role: 'owner', permissions: [] };
const approved: ApprovedDocument = { documentId: 'd1', isApproved: true, postingVersion: 1, vendor: 'Acme', totalCents: 4599, incurredOn: '2026-07-01', category: 'supplies', description: null, purchaseOrderId: null };

describe('OCR posting bound to InventoryService', () => {
  it('maps PostingCtx→InvCtx (null branch → "") and {ok,expense:{id}} → {id}', async () => {
    let seenCtx: any = null;
    const backend: InventoryPostingBackend = {
      async saveReceiptExpense(ctx, _body) { seenCtx = ctx; return { ok: true, expense: { id: 'exp-9' } }; },
      async receivePurchaseOrder() { return { id: 'po-1' }; },
    };
    const res = await new InventoryExpensePost(backend).saveReceiptExpense(pctx, { amountCents: 4599, vendor: 'Acme' });
    expect(res).toEqual({ id: 'exp-9' });
    expect(seenCtx.branchId).toBe('');       // null branch mapped to '' for tenant-level receipts
    expect(seenCtx.tenantId).toBe('t1');
  });

  it('full postExpense through PostingService returns posted with the expense id', async () => {
    const backend: InventoryPostingBackend = {
      async saveReceiptExpense() { return { ok: true, expense: { id: 'exp-42' } }; },
      async receivePurchaseOrder() { return {}; },
    };
    const posting = new PostingService(new InventoryExpensePost(backend), new InventoryReceiveAdapter(backend), new InMemoryPostingIdempotency());
    const rec = await posting.postExpense(pctx, approved);
    expect(rec.status).toBe('posted');
    expect(rec.externalRef).toBe('exp-42');
  });

  it('a throwing backend yields FAILED (never fabricates a posted expense)', async () => {
    const backend: InventoryPostingBackend = {
      async saveReceiptExpense() { throw new Error('EXPENSE_POSTING_DB_DOWN'); },
      async receivePurchaseOrder() { throw new Error('nope'); },
    };
    const posting = new PostingService(new InventoryExpensePost(backend), new InventoryReceiveAdapter(backend), new InMemoryPostingIdempotency());
    const rec = await posting.postExpense(pctx, approved);
    expect(rec.status).toBe('failed');
    expect(rec.externalRef).toBeNull();
  });

  it('is idempotent — the same approved document posts once', async () => {
    let calls = 0;
    const backend: InventoryPostingBackend = {
      async saveReceiptExpense() { calls++; return { ok: true, expense: { id: 'exp-1' } }; },
      async receivePurchaseOrder() { return {}; },
    };
    const idem = new InMemoryPostingIdempotency();
    const posting = new PostingService(new InventoryExpensePost(backend), new InventoryReceiveAdapter(backend), idem);
    await posting.postExpense(pctx, approved);
    await posting.postExpense(pctx, approved);
    expect(calls).toBe(1);
  });
});
