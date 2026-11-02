// Oct 28 2026 (mandate audit F1, Receipt / Expense §36 / §37 / §200 / §80): a reviewer's corrected — or, on a manual-entry
// receipt, typed — subtotal / tax / fees / discount must reach the DOCUMENT ROW, because postFromReceipt (finance
// expense.repository receiptEvidence) reads the money parts from there. Before, only vendor / total / number / date did:
// a corrected tax was saved on the field and the expense was posted, approved, with the old (or no) tax.
import { describe, it, expect } from 'vitest';
import { AiOcrReceiptService } from './ai-ocr-receipt.service';

const CTX = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: [] as string[] } as any;

function svcWith(pipelineState = 'review_required') {
  const doc: any = {
    id: 'd1', tenantId: 't1', branchId: 'b1', pipelineState, documentType: 'receipt', vendor: 'Sally Beauty', totalCents: 6147, category: null,
    fileHash: null, perceptualHash: null, documentNumber: null, documentDate: '2026-10-20', postingVersion: 1,
    subtotalCents: 5600, taxCents: 547, feesCents: null, discountCents: null,
  };
  const patches: any[] = [];
  const corrections: any[] = [];
  const docs: any = {
    async get() { return { ...doc }; },
    async patch(_c: any, _id: string, p: any) { patches.push(p); Object.assign(doc, p); },
    async saveFieldCorrection(_c: any, _id: string, f: any) { corrections.push(f); },
  };
  const audit: any = { async record() { /* */ } };
  const svc = new AiOcrReceiptService(docs, {} as any, {} as any, {} as any, {} as any, audit);
  return { svc, doc, patches, corrections };
}

describe('F1: corrected money parts land on the document row the posting reads', () => {
  it('tax, subtotal, fees and discount each patch their own column', async () => {
    const { svc, doc } = svcWith();
    await svc.correctField(CTX, 'd1', 'tax', { value: '$5.61', valueCents: 561 });
    await svc.correctField(CTX, 'd1', 'subtotal', { value: '$56.86', valueCents: 5686 });
    await svc.correctField(CTX, 'd1', 'fees', { value: '$0.00', valueCents: 0 });
    await svc.correctField(CTX, 'd1', 'discount', { value: '$1.00', valueCents: 100 });
    expect({ s: doc.subtotalCents, t: doc.taxCents, f: doc.feesCents, d: doc.discountCents }).toEqual({ s: 5686, t: 561, f: 0, d: 100 });
    expect(doc.totalCents).toBe(6147);   // the total is not touched by a part's correction
  });
  it('a manual-entry receipt (no provider reading at all) gets the typed tax onto the row', async () => {
    const { svc, doc } = svcWith('manual_entry_required');
    doc.taxCents = null;
    await svc.correctField(CTX, 'd1', 'tax', { value: '$3.20', valueCents: 320 });
    expect(doc.taxCents).toBe(320);
  });
  it('a negative part is refused by name and nothing is written', async () => {
    const { svc, patches, corrections } = svcWith();
    await expect(svc.correctField(CTX, 'd1', 'tax', { valueCents: -5 })).rejects.toMatchObject({ code: 'INVALID_UPLOAD' });
    expect(patches).toEqual([]); expect(corrections).toEqual([]);
  });
  it('a text-only correction of a money part (no cents) leaves the row as it was', async () => {
    const { svc, doc, patches } = svcWith();
    await svc.correctField(CTX, 'd1', 'tax', { value: 'see attached' });
    expect(doc.taxCents).toBe(547);
    expect(patches.some((p) => 'taxCents' in p)).toBe(false);
  });
});
