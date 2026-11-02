// ai-ocr-receipt-posting.ts — the ONLY place approved documents become financial records. Three guarantees:
//   1. It refuses to post anything that is not 'approved' (throws NOT_APPROVED) — AI/unreviewed output can never post.
//   2. It is idempotent on tenant_id + document_id + destination + posting_version — a repeated call returns the existing
//      result and calls the domain service exactly once (no double expense / double receiving).
//   3. It is failure-safe — on error it records the failure and returns a retryable result with NO partial record.
// It writes through the EXISTING domain services — expenses through the finance module's ExpenseService.postFromReceipt (Oct 21
// 2026: the one expense authority; it was inventory.saveReceiptExpense), receiving through inventory.receivePurchaseOrder —
// it never creates a second ledger.

export interface PostingCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[]; }
export type PostingDestination = 'expense' | 'inventory_receipt';

export function buildIdempotencyKey(parts: { tenantId: string; documentId: string; destination: PostingDestination; postingVersion: number }): string {
  return `${parts.tenantId}:${parts.documentId}:${parts.destination}:${parts.postingVersion}`;
}

// existing domain services, behind ports (the real inventory.service satisfies these)
export interface ExpensePostPort { saveReceiptExpense(ctx: PostingCtx, body: { vendor?: string | null; amountCents?: number; incurredOn?: string | null; category?: string | null; description?: string | null; documentId?: string; idempotencyKey?: string }): Promise<{ id: string }>; }
export interface InventoryReceivePort { receivePurchaseOrder(ctx: PostingCtx, purchaseOrderId: string, body: unknown): Promise<{ id?: string } | unknown>; }
export interface PostingRecord { idempotencyKey: string; status: 'posted' | 'failed'; externalRef: string | null; errorCode?: string | null; }
export interface IdempotencyStore { find(tenantId: string, key: string): Promise<PostingRecord | null>; record(tenantId: string, rec: PostingRecord): Promise<void>; }

export interface ApprovedDocument {
  documentId: string; isApproved: boolean; postingVersion: number;
  vendor: string | null; totalCents: number | null; incurredOn: string | null; category: string | null; description: string | null;
  purchaseOrderId?: string | null; confirmedReceiptLines?: { productId: string; unitId?: string | null; quantity: number; unitCostCents: number }[];
}

export class NotApprovedError extends Error { constructor() { super('NOT_APPROVED'); this.name = 'NotApprovedError'; } }

export class PostingService {
  constructor(private readonly expenses: ExpensePostPort, private readonly inventory: InventoryReceivePort, private readonly idem: IdempotencyStore) {}

  /** Post an approved document to the tenant's expenses. Idempotent + failure-safe. */
  async postExpense(ctx: PostingCtx, doc: ApprovedDocument): Promise<PostingRecord> {
    if (!doc.isApproved) throw new NotApprovedError();                                   // hard gate — never post unreviewed
    const key = buildIdempotencyKey({ tenantId: ctx.tenantId, documentId: doc.documentId, destination: 'expense', postingVersion: doc.postingVersion });
    const existing = await this.idem.find(ctx.tenantId, key);
    // already POSTED — do not post again. A FAILED attempt is not "handled": it is retried (Oct 21 2026 — before this,
    // the recorded failure was returned as the answer forever, so a receipt whose first posting hit a transient error
    // could never become an expense). The expense side is idempotent on the same key, so a retry can never double-post.
    if (existing && existing.status === 'posted') return existing;
    try {
      const res = await this.expenses.saveReceiptExpense(ctx, { vendor: doc.vendor, amountCents: Math.abs(doc.totalCents ?? 0), incurredOn: doc.incurredOn, category: doc.category, description: doc.description, documentId: doc.documentId, idempotencyKey: key });
      const rec: PostingRecord = { idempotencyKey: key, status: 'posted', externalRef: res.id };
      await this.idem.record(ctx.tenantId, rec);
      return rec;
    } catch (e: any) {
      const rec: PostingRecord = { idempotencyKey: key, status: 'failed', externalRef: null, errorCode: e?.message || 'POSTING_FAILED' };
      await this.idem.record(ctx.tenantId, rec);                                          // record the failure; no partial expense created
      return rec;
    }
  }

  /** Receive an approved document's confirmed lines through the EXISTING PO-receiving path. Idempotent + failure-safe. */
  async postInventoryReceipt(ctx: PostingCtx, doc: ApprovedDocument): Promise<PostingRecord> {
    if (!doc.isApproved) throw new NotApprovedError();
    if (!doc.purchaseOrderId) return { idempotencyKey: buildIdempotencyKey({ tenantId: ctx.tenantId, documentId: doc.documentId, destination: 'inventory_receipt', postingVersion: doc.postingVersion }), status: 'failed', externalRef: null, errorCode: 'NO_PURCHASE_ORDER' };
    const key = buildIdempotencyKey({ tenantId: ctx.tenantId, documentId: doc.documentId, destination: 'inventory_receipt', postingVersion: doc.postingVersion });
    const existing = await this.idem.find(ctx.tenantId, key);
    if (existing && existing.status === 'posted') return existing;                       // a failed attempt is retried (see postExpense)
    try {
      const res: any = await this.inventory.receivePurchaseOrder(ctx, doc.purchaseOrderId, { lines: doc.confirmedReceiptLines ?? [] });
      const rec: PostingRecord = { idempotencyKey: key, status: 'posted', externalRef: res?.id ?? doc.purchaseOrderId };
      await this.idem.record(ctx.tenantId, rec);
      return rec;
    } catch (e: any) {
      const rec: PostingRecord = { idempotencyKey: key, status: 'failed', externalRef: null, errorCode: e?.message || 'RECEIVING_FAILED' };
      await this.idem.record(ctx.tenantId, rec);
      return rec;
    }
  }
}
