// ai-ocr-receipt-posting.vitest.spec.ts — posting refuses non-approved documents, is idempotent on
// tenant+document+destination+posting_version (no double-post), is failure-safe (no partial record), and writes through
// the existing expense + PO-receiving services.
import { describe, it, expect } from 'vitest';
import { PostingService, NotApprovedError, buildIdempotencyKey, type IdempotencyStore, type ExpensePostPort, type InventoryReceivePort, type ApprovedDocument, type PostingCtx, type PostingRecord } from './ai-ocr-receipt-posting';

const ctx: PostingCtx = { tenantId: 'T1', branchId: 'b1', userId: 'u', role: 'OWNER', permissions: [] };
const memStore = () => { const m = new Map<string, PostingRecord>(); const s: IdempotencyStore = { async find(t, k) { return m.get(t + '|' + k) ?? null; }, async record(t, r) { m.set(t + '|' + r.idempotencyKey, r); } }; return s; };
const doc = (o: Partial<ApprovedDocument> = {}): ApprovedDocument => ({ documentId: 'D1', isApproved: true, postingVersion: 1, vendor: 'Acme', totalCents: 5000, incurredOn: '2025-03-04', category: 'supplies', description: 'receipt', ...o });

describe('expense posting', () => {
  it('refuses non-approved, posts approved, and is idempotent', async () => {
    let calls = 0;
    const exp: ExpensePostPort = { async saveReceiptExpense() { calls++; return { id: 'E1' }; } };
    const inv: InventoryReceivePort = { async receivePurchaseOrder() { return { id: 'R1' }; } };
    const svc = new PostingService(exp, inv, memStore());
    await expect(svc.postExpense(ctx, doc({ isApproved: false }))).rejects.toBeInstanceOf(NotApprovedError);
    expect(calls).toBe(0);
    expect(await svc.postExpense(ctx, doc())).toMatchObject({ status: 'posted', externalRef: 'E1' });
    await svc.postExpense(ctx, doc()); // repeat
    expect(calls).toBe(1); // not called again
    await svc.postExpense(ctx, doc({ postingVersion: 2 }));
    expect(calls).toBe(2); // new version re-posts
    expect(buildIdempotencyKey({ tenantId: 'T1', documentId: 'D1', destination: 'expense', postingVersion: 1 })).toBe('T1:D1:expense:1');
  });
  it('is failure-safe (records failure, no partial record)', async () => {
    const failing: ExpensePostPort = { async saveReceiptExpense() { throw new Error('DB_DOWN'); } };
    const inv: InventoryReceivePort = { async receivePurchaseOrder() { return { id: 'R1' }; } };
    const rf = await new PostingService(failing, inv, memStore()).postExpense(ctx, doc());
    expect(rf).toMatchObject({ status: 'failed', errorCode: 'DB_DOWN', externalRef: null });
  });
});

describe('inventory receipt posting', () => {
  it('posts confirmed lines via existing PO receiving, idempotently', async () => {
    let recv = 0;
    const exp: ExpensePostPort = { async saveReceiptExpense() { return { id: 'E1' }; } };
    const inv: InventoryReceivePort = { async receivePurchaseOrder(_c, poId) { recv++; return { id: 'RCPT-' + poId }; } };
    const svc = new PostingService(exp, inv, memStore());
    const d = doc({ purchaseOrderId: 'PO9', confirmedReceiptLines: [{ productId: 'p1', quantity: 5, unitCostCents: 200 }] });
    expect(await svc.postInventoryReceipt(ctx, d)).toMatchObject({ status: 'posted', externalRef: 'RCPT-PO9' });
    await svc.postInventoryReceipt(ctx, d);
    expect(recv).toBe(1); // idempotent
    expect((await svc.postInventoryReceipt(ctx, doc({ purchaseOrderId: null }))).errorCode).toBe('NO_PURCHASE_ORDER');
    await expect(svc.postInventoryReceipt(ctx, doc({ isApproved: false, purchaseOrderId: 'PO9' }))).rejects.toBeInstanceOf(NotApprovedError);
  });
});
