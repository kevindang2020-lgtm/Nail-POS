// ai-ocr-receipt-pipeline.vitest.spec.ts — M3 (Oct 23 2026): the receipt pipeline's internal gaps, closed.
//   • the upload's INLINE scan (ClamAV via the upload policy) counts: a ClamAV-only salon used to quarantine forever;
//   • the verdict lands on the file row (it said 'unscanned' forever);
//   • a failed posting can be retried (the state machine had failed → approved; nothing walked it);
//   • the background sweep re-asks quarantined receipts — and never releases an unscanned one.
import { describe, it, expect, afterEach } from 'vitest';
import { installMalwareScanner } from '@aipowersalon/media';
import { AiOcrReceiptService, combineScanVerdicts } from './ai-ocr-receipt.service';

const CTX = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'MANAGER', permissions: [] as string[] } as any;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Producer (x) >>\nendobj\n');
const input = (bytes: Buffer) => ({ filename: 'receipt.pdf', declaredMime: 'application/pdf', sizeBytes: bytes.length, headerBytes: bytes.subarray(0, 16), bytes });
afterEach(() => installMalwareScanner(undefined));

function build(tag: 'clean' | 'infected' | 'unscanned' = 'unscanned', start: Record<string, unknown> = {}) {
  const doc: any = { id: 'd1', tenantId: 't1', branchId: 'b1', pipelineState: 'uploaded', postingVersion: 1, storageKey: 'tenants/t1/documents/d1/original.pdf', ...start };
  const recorded: string[] = []; const audits: string[] = []; const posted: any[] = [];
  const docs: any = { async create() { return doc; }, async patch(_c: any, _i: string, p: any) { Object.assign(doc, p); }, async get() { return { ...doc }; } };
  const settings: any = { async load() { return [{ scope: 'tenant', settings: { enabled: true, autoRunOcr: false } }]; } };
  const files: any = { async store() { return { storageKey: doc.storageKey }; }, async recordScan(_c: any, _d: string, s: string) { recorded.push(s); } };
  const scanner: any = { async scan() { return { status: tag }; } };
  const posting: any = { async postExpense() { posted.push('expense'); return { status: 'posted', externalRef: 'exp-1' }; } };
  const audit: any = { async record(_c: any, a: string) { audits.push(a); } };
  const svc = new AiOcrReceiptService(docs, settings, files, scanner, posting, audit, [], { async log() {} } as any);
  return { svc, doc, recorded, audits, posted, docs };
}

describe('combineScanVerdicts — the stricter of two honest verdicts', () => {
  it('infected anywhere wins; clean from either real scanner releases; otherwise unscanned (never a guessed clean)', () => {
    expect(combineScanVerdicts('clean', 'infected')).toBe('infected');
    expect(combineScanVerdicts('infected', 'clean')).toBe('infected');
    expect(combineScanVerdicts('clean', 'unscanned')).toBe('clean');
    expect(combineScanVerdicts('unscanned', 'clean')).toBe('clean');
    expect(combineScanVerdicts('unscanned', 'unscanned')).toBe('unscanned');
    expect(combineScanVerdicts(undefined, 'unscanned')).toBe('unscanned');
    expect(combineScanVerdicts('unscanned', 'error')).toBe('error');
    expect(combineScanVerdicts('clean', 'error')).toBe('clean');
  });
});

describe('upload: the inline scan counts', () => {
  it('ClamAV said CLEAN, the bucket tag is not there yet → released to extraction (not quarantined); the verdict is recorded', async () => {
    installMalwareScanner({ async scan() { return { status: 'clean' }; } });
    const { svc, doc, recorded } = build('unscanned');
    const r = await svc.upload(CTX, input(PDF));
    // released past the scan: extraction ran (no OCR provider in this test → honestly Manual Entry, never invented data)
    expect(['extracting', 'manual_entry_required']).toContain(r.pipelineState);
    expect(doc.pipelineState).not.toBe('quarantined');
    expect(recorded).toEqual(['clean']);
  });
  it('control: no scanner anywhere → quarantined (scan required by default), nothing recorded as clean', async () => {
    installMalwareScanner(null);
    const { svc, recorded } = build('unscanned');
    expect((await svc.upload(CTX, input(PDF))).pipelineState).toBe('quarantined');
    expect(recorded).toEqual([]);
  });
  it('ClamAV clean but the bucket tag says INFECTED → rejected', async () => {
    installMalwareScanner({ async scan() { return { status: 'clean' }; } });
    const { svc } = build('infected');
    expect((await svc.upload(CTX, input(PDF))).pipelineState).toBe('rejected');
  });
});

describe('retry a failed posting', () => {
  it('failed → approved → posted (the posting port is idempotent per document + version)', async () => {
    const { svc, doc, posted, audits } = build('clean', { pipelineState: 'failed', vendor: 'V', totalCents: 4490 });
    const r = await svc.retryPost(CTX, 'd1', 'expense');
    expect(r).toMatchObject({ status: 'posted' });
    expect(doc.pipelineState).toBe('posted');
    expect(posted).toEqual(['expense']);
    expect(audits).toContain('document.posting_retried');
  });
  it('refused for anything but a failed posting (no way to post an unapproved receipt through it)', async () => {
    for (const st of ['in_review', 'review_required', 'quarantined', 'posted']) {
      const { svc, posted } = build('clean', { pipelineState: st });
      await expect(svc.retryPost(CTX, 'd1', 'expense')).rejects.toMatchObject({ code: 'INVALID_STATE' });
      expect(posted).toEqual([]);
    }
  });
});

describe('the background sweep', () => {
  it('re-asks a quarantined receipt: clean → released; unscanned → left quarantined (never released)', async () => {
    for (const [tag, released, state] of [['clean', 1, 'extracting'], ['unscanned', 0, 'quarantined']] as const) {
      const { svc, doc, docs } = build(tag, { pipelineState: 'quarantined' });
      docs.stalled = async () => [{ id: 'd1', tenantId: 't1', branchId: 'b1', pipelineState: 'quarantined' }];
      const r = await svc.sweepPipeline();
      expect(r).toMatchObject({ rescanned: 1, released, errors: 0 });
      expect(doc.pipelineState).toBe(state);
    }
  });
  it('a store without the population query does nothing', async () => {
    expect(await build().svc.sweepPipeline()).toEqual({ rescanned: 0, released: 0, extracted: 0, retried: 0, errors: 0 });
  });
});
