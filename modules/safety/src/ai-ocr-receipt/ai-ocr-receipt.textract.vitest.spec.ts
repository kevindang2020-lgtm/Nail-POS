// ai-ocr-receipt.textract.vitest.spec.ts — the OCR provider, its pure normalizer, and the extraction runner.
//
// Extraction is the step that proposes the NUMBERS a human will approve into the books. The failure that
// matters is not "OCR was wrong" — a reviewer catches that. It is **OCR quietly making something up**: a
// fabricated total, a guessed vendor, or a confidence score that suppresses the review that would have caught
// it. So every failure path below is asserted to produce `unavailable` → manual entry, never a partial guess.
import { describe, it, expect } from 'vitest';
import {
  TextractOcrProvider, normalizeAnalyzeExpense, toFinancials, toDedupSubject, sha256Hex, makeOcrProviders,
} from './ai-ocr-receipt.textract';
import { AiOcrReceiptService, mimeForKey } from './ai-ocr-receipt.service';
import type { OcrProvider } from './ai-ocr-receipt-pipeline';

const INPUT = { tenantId: 't1', documentId: 'd1', storageKey: 'tenants/t1/documents/d1/original.pdf', mime: 'application/pdf', pageCount: 1 };

// A realistic AnalyzeExpense payload (Textract reports confidence 0..100).
const RESPONSE = {
  ExpenseDocuments: [{
    SummaryFields: [
      { Type: { Text: 'VENDOR_NAME' }, ValueDetection: { Text: 'Beauty Supply Co', Confidence: 98.2 }, PageNumber: 1 },
      { Type: { Text: 'TOTAL' }, ValueDetection: { Text: '$142.75', Confidence: 99.1 }, PageNumber: 1 },
      { Type: { Text: 'SUBTOTAL' }, ValueDetection: { Text: '$132.18', Confidence: 97.0 } },
      { Type: { Text: 'TAX' }, ValueDetection: { Text: '$10.57', Confidence: 96.5 } },
      { Type: { Text: 'INVOICE_RECEIPT_ID' }, ValueDetection: { Text: 'INV-40881', Confidence: 95.0 } },
      { Type: { Text: 'INVOICE_RECEIPT_DATE' }, ValueDetection: { Text: '2026-03-14', Confidence: 94.0 } },
      { Type: { Text: 'SOMETHING_WE_DO_NOT_KNOW' }, ValueDetection: { Text: 'xyz', Confidence: 99 } },
    ],
    LineItemGroups: [{
      LineItems: [{
        LineItemExpenseFields: [
          { Type: { Text: 'ITEM' }, ValueDetection: { Text: 'Gel polish — rose', Confidence: 92 } },
          { Type: { Text: 'QUANTITY' }, ValueDetection: { Text: '3', Confidence: 90 } },
          { Type: { Text: 'UNIT_PRICE' }, ValueDetection: { Text: '$12.00', Confidence: 91 } },
          { Type: { Text: 'PRICE' }, ValueDetection: { Text: '$36.00', Confidence: 93 } },
        ],
      }],
    }],
  }],
};

describe('normalizeAnalyzeExpense', () => {
  it('maps typed summary fields and line items, scaling confidence to 0..1', () => {
    const r = normalizeAnalyzeExpense(RESPONSE, 'aws-textract');
    expect(r.unavailable).toBe(false);
    expect(r.providerKey).toBe('aws-textract');

    const by = (k: string) => r.fields.find((f) => f.key === k);
    expect(by('vendor')!.text).toBe('Beauty Supply Co');
    expect(by('total')!.cents).toBe(14275);       // money is integer cents, never a float
    expect(by('subtotal')!.cents).toBe(13218);
    expect(by('tax')!.cents).toBe(1057);
    expect(by('document_number')!.text).toBe('INV-40881');
    expect(by('total')!.confidence).toBeCloseTo(0.991, 3);

    expect(r.lineItems).toHaveLength(1);
    expect(r.lineItems[0].quantity).toBe(3);
    expect(r.lineItems[0].unitPriceCents).toBe(1200);
    expect(r.lineItems[0].lineTotalCents).toBe(3600);
  });

  it('IGNORES field types it does not recognise rather than guessing at them', () => {
    const r = normalizeAnalyzeExpense(RESPONSE, 'aws-textract');
    expect(r.fields.map((f) => f.key)).not.toContain('something_we_do_not_know');
    expect(r.fields.every((f) => f.key !== '')).toBe(true);
  });

  it('reports unavailable — never an empty receipt — when nothing usable came back', () => {
    // An unreadable document is NOT a receipt with no vendor and no total. Conflating the two would push a
    // blank document into review as though OCR had succeeded.
    expect(normalizeAnalyzeExpense({ ExpenseDocuments: [] }, 'aws-textract').unavailable).toBe(true);
    expect(normalizeAnalyzeExpense({}, 'aws-textract').unavailable).toBe(true);
    expect(normalizeAnalyzeExpense({ ExpenseDocuments: [{ SummaryFields: [], LineItemGroups: [] }] }, 'aws-textract').unavailable).toBe(true);
  });

  it('never synthesizes a confidence', () => {
    const r = normalizeAnalyzeExpense({
      ExpenseDocuments: [{ SummaryFields: [{ Type: { Text: 'TOTAL' }, ValueDetection: { Text: '$5.00' } }] }],
    }, 'aws-textract');
    expect(r.fields[0].confidence).toBe(0);      // no confidence reported → 0, not an invented 1.0
  });
});

describe('toFinancials', () => {
  it('reads only what the provider returned', () => {
    const fin = toFinancials(normalizeAnalyzeExpense(RESPONSE, 'aws-textract'));
    expect(fin.vendor).toBe('Beauty Supply Co');
    expect(fin.totalCents).toBe(14275);
    expect(fin.taxCents).toBe(1057);
    expect(fin.documentDate).toBe('2026-03-14');
    expect(fin.isCreditOrRefund).toBe(false);
  });

  it('leaves absent fields NULL rather than inferring them', () => {
    // Subtotal is a very tempting thing to compute as total - tax. We do not: a computed value that a reviewer
    // reads as "extracted" is a fabrication, and this module's whole job is to not do that.
    const r = normalizeAnalyzeExpense({
      ExpenseDocuments: [{ SummaryFields: [{ Type: { Text: 'TOTAL' }, ValueDetection: { Text: '$50.00', Confidence: 99 } }] }],
    }, 'aws-textract');
    const fin = toFinancials(r);
    expect(fin.totalCents).toBe(5000);
    expect(fin.subtotalCents).toBeNull();
    expect(fin.taxCents).toBeNull();
    expect(fin.vendor).toBeNull();
    expect(fin.documentDate).toBeNull();
  });

  it('flags an ambiguous date instead of silently picking a month', () => {
    const r = normalizeAnalyzeExpense({
      ExpenseDocuments: [{ SummaryFields: [{ Type: { Text: 'INVOICE_RECEIPT_DATE' }, ValueDetection: { Text: '03/04/2026', Confidence: 90 } }] }],
    }, 'aws-textract');
    expect(toFinancials(r).dateAmbiguous).toBe(true);   // 3 April or 4 March — a human decides
  });

  it('recognises a credit/refund from a negative total', () => {
    const r = normalizeAnalyzeExpense({
      ExpenseDocuments: [{ SummaryFields: [{ Type: { Text: 'TOTAL' }, ValueDetection: { Text: '-$20.00', Confidence: 99 } }] }],
    }, 'aws-textract');
    expect(toFinancials(r).isCreditOrRefund).toBe(true);
  });
});

describe('toDedupSubject', () => {
  it('takes fileHash from the stored BYTES, never from the extraction', () => {
    const r = normalizeAnalyzeExpense(RESPONSE, 'aws-textract');
    const d = toDedupSubject(r, toFinancials(r), 'abc123');
    expect(d.fileHash).toBe('abc123');
    expect(d.documentNumber).toBe('INV-40881');
    expect(d.totalCents).toBe(14275);
    expect(d.perceptualHash).toBeNull();   // no image-hash lib is bound; null is honest
  });
});

describe('sha256Hex', () => {
  it('is stable and content-addressed (identical bytes → identical hash)', () => {
    const a = sha256Hex(new Uint8Array([1, 2, 3]));
    expect(a).toBe(sha256Hex(new Uint8Array([1, 2, 3])));
    expect(a).not.toBe(sha256Hex(new Uint8Array([1, 2, 4])));
    expect(a).toHaveLength(64);
  });
});

describe('TextractOcrProvider', () => {
  const sdkOk = {
    TextractClient: class { async send() { return RESPONSE; } },
    AnalyzeExpenseCommand: class { constructor(public input: any) {} },
  };

  it('extracts through the SDK when configured', async () => {
    const p = new TextractOcrProvider({ bucket: 'b' }, sdkOk);
    const r = await p.extract(INPUT);
    expect(r.unavailable).toBe(false);
    expect(r.providerKey).toBe('aws-textract');
  });

  it('reads the object straight from the SAME bucket the blob store wrote to', async () => {
    let sent: any;
    const sdk = {
      TextractClient: class { async send(c: any) { sent = c.input; return RESPONSE; } },
      AnalyzeExpenseCommand: class { constructor(public input: any) {} },
    };
    await new TextractOcrProvider({ bucket: 'evidence-prod', keyPrefix: 'p' }, sdk).extract(INPUT);
    expect(sent.Document.S3Object).toEqual({ Bucket: 'evidence-prod', Name: 'p/tenants/t1/documents/d1/original.pdf' });
  });

  it('declines media types Textract cannot read, rather than failing oddly', () => {
    const p = new TextractOcrProvider({ bucket: 'b' }, sdkOk);
    expect(p.supports('application/pdf')).toBe(true);
    expect(p.supports('image/png')).toBe(true);
    expect(p.supports('image/heic')).toBe(false);     // HEIC/WEBP are genuinely unsupported — say so
    expect(p.supports('image/webp')).toBe(false);
  });

  it('is unavailable — NOT a guess — on every failure path', async () => {
    const boom = { TextractClient: class { async send() { throw new Error('ThrottlingException'); } }, AnalyzeExpenseCommand: class {} };
    expect((await new TextractOcrProvider({ bucket: 'b' }, boom).extract(INPUT)).unavailable).toBe(true);            // throttled
    expect((await new TextractOcrProvider({ bucket: '' }, sdkOk).extract(INPUT)).unavailable).toBe(true);            // no bucket
    expect((await new TextractOcrProvider({ bucket: 'b' }, sdkOk).extract({ ...INPUT, mime: 'image/heic' })).unavailable).toBe(true);   // unsupported
    expect((await new TextractOcrProvider({ bucket: 'b' }, sdkOk).extract({ ...INPUT, storageKey: '' })).unavailable).toBe(true);       // no object
  });

  it('is not connected without a bucket', () => {
    expect(new TextractOcrProvider({ bucket: '' }, sdkOk).connected).toBe(false);
    expect(new TextractOcrProvider({ bucket: 'b' }, sdkOk).connected).toBe(true);
  });
});

describe('makeOcrProviders', () => {
  it('returns NO provider without a bucket — extraction then honestly reports unavailable', () => {
    expect(makeOcrProviders({} as any)).toEqual([]);
  });
  it('honours the kill-switch (Textract is billed per page)', () => {
    expect(makeOcrProviders({ EVIDENCE_S3_BUCKET: 'b', OCR_TEXTRACT_ENABLED: '0' } as any)).toEqual([]);
  });
  it('binds Textract when a bucket is configured', () => {
    const ps = makeOcrProviders({ EVIDENCE_S3_BUCKET: 'b', AWS_REGION: 'us-east-1' } as any);
    expect(ps.map((p) => p.key)).toEqual(['aws-textract']);
  });
});

describe('mimeForKey', () => {
  it('derives the media type from the stored key', () => {
    expect(mimeForKey('tenants/t/documents/d/original.pdf')).toBe('application/pdf');
    expect(mimeForKey('tenants/t/documents/d/original.JPG')).toBe('image/jpeg');
    expect(mimeForKey(null)).toBe('application/octet-stream');
  });
});

// ── the runner ──────────────────────────────────────────────────────────────────────────────────────────
function svc(providers: OcrProvider[], docOverrides: Record<string, unknown> = {}) {
  const doc: any = {
    id: 'd1', tenantId: 't1', branchId: 'b1', pipelineState: 'extracting', documentType: 'unknown',
    vendor: null, totalCents: null, category: null, fileHash: 'HASH-FROM-BYTES', perceptualHash: null,
    documentNumber: null, documentDate: null, postingVersion: 1,
    storageKey: 'tenants/t1/documents/d1/original.pdf', ...docOverrides,
  };
  const audits: any[] = [];
  const docs: any = {
    async get() { return { ...doc }; },
    async patch(_c: any, _i: string, p: any) { Object.assign(doc, p); },
    async dedupCandidates() { return []; },
  };
  const settings: any = { async load() { return []; } };
  const files: any = {};
  const scanner: any = {};
  const posting: any = {};
  const audit: any = { async record(_c: any, action: string, _i: string, meta: any) { audits.push({ action, meta }); } };
  const s = new AiOcrReceiptService(docs, settings, files, scanner, posting, audit, providers);
  return { s, doc, audits };
}

const CTX = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'MANAGER', permissions: [] as string[] } as any;
const fakeProvider = (result: any): OcrProvider => ({
  key: 'fake', connected: true, costRank: 1, supports: () => true, async extract() { return result; },
});

describe('AiOcrReceiptService.runExtraction', () => {
  it('extracts, validates, dedups, and parks the document at REVIEW — never past it', async () => {
    const good = normalizeAnalyzeExpense(RESPONSE, 'fake');
    const { s, doc } = svc([fakeProvider(good)]);
    const r = await s.runExtraction(CTX, 'd1');
    expect(r.unavailable).toBe(false);
    expect(r.pipelineState).toBe('review_required');   // NOT approved, NOT posted
    expect(doc.vendor).toBe('Beauty Supply Co');
    expect(doc.totalCents).toBe(14275);
  });

  it('routes to MANUAL ENTRY when no provider is bound — it does not invent a vendor or a total', async () => {
    // This is the default deployment (no bucket, no Textract). The honest outcome is a person keying it in.
    const { s, doc } = svc([]);
    const r = await s.runExtraction(CTX, 'd1');
    expect(r).toEqual({ pipelineState: 'manual_entry_required', providerKey: null, unavailable: true });
    expect(doc.vendor).toBeNull();
    expect(doc.totalCents).toBeNull();
  });

  it('routes to MANUAL ENTRY when every provider fails', async () => {
    const dead: OcrProvider = { key: 'x', connected: true, costRank: 1, supports: () => true, async extract() { throw new Error('down'); } };
    const { s } = svc([dead]);
    expect((await s.runExtraction(CTX, 'd1')).pipelineState).toBe('manual_entry_required');
  });

  it('routes to MANUAL ENTRY when there is no stored object to read', async () => {
    const { s } = svc([fakeProvider(normalizeAnalyzeExpense(RESPONSE, 'fake'))], { storageKey: null });
    expect((await s.runExtraction(CTX, 'd1')).pipelineState).toBe('manual_entry_required');
  });

  it('refuses to run on a document that is not in `extracting`', async () => {
    for (const state of ['quarantined', 'approved', 'posted', 'review_required', 'in_review']) {
      const { s } = svc([], { pipelineState: state });
      await expect(s.runExtraction(CTX, 'd1')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    }
  });

  it('dedups on the STORED file hash, not on anything OCR produced', async () => {
    let seen: any;
    const good = normalizeAnalyzeExpense(RESPONSE, 'fake');
    const { s } = svc([fakeProvider(good)]);
    (s as any).docs.dedupCandidates = async (_c: any, subj: any) => { seen = subj; return []; };
    await s.runExtraction(CTX, 'd1');
    expect(seen.fileHash).toBe('HASH-FROM-BYTES');
  });

  it('audits the unavailable path too — a silent manual-entry fallback would look like a bug', async () => {
    const { s, audits } = svc([]);
    await s.runExtraction(CTX, 'd1');
    expect(audits.some((a) => a.action === 'document.extraction_unavailable')).toBe(true);
  });
});
