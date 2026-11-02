// ai-ocr-receipt-rescan.vitest.spec.ts — releasing (or not releasing) a quarantined document.
//
// Why this path exists at all: `malwareScanRequired` DEFAULTS TO TRUE, and every S3-side scanner tags the
// object out of band — so the scan taken at upload time is normally `unscanned`, and the receipt quarantines.
// Before `rescan()` there was no way to ask again, so with a real scanner wired every uploaded receipt would
// have sat in quarantine permanently. The feature would have bricked itself the moment it was switched on.
//
// The safety property under test is the inverse of the feature: `rescan()` must apply ONLY what the scanner
// actually said. No input, no state, and no number of retries may talk it into releasing an unscanned file.
import { describe, it, expect } from 'vitest';
import { AiOcrReceiptService } from './ai-ocr-receipt.service';
import type { ScanStatus } from './ai-ocr-receipt-upload';

const CTX = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'MANAGER', permissions: [] as string[] } as any;

function svcWith(scan: ScanStatus, docOverrides: Record<string, unknown> = {}) {
  const doc: any = {
    id: 'd1', tenantId: 't1', branchId: 'b1', pipelineState: 'quarantined', documentType: 'receipt',
    vendor: null, totalCents: null, category: null, fileHash: null, perceptualHash: null,
    documentNumber: null, documentDate: null, postingVersion: 1,
    storageKey: 'tenants/t1/documents/d1/original.pdf',
    ...docOverrides,
  };
  const audits: any[] = [];
  const scanned: string[] = [];
  const docs: any = {
    async get() { return { ...doc }; },
    async patch(_c: any, _id: string, p: any) { Object.assign(doc, p); },
    async create() { return doc; },
    async list() { return { items: [doc], total: 1 }; },
  };
  const settings: any = { async get() { return null; }, async upsert() { /* */ } };
  const files: any = { async store() { return { storageKey: doc.storageKey }; }, async signedPreview() { return { url: 'notconnected:x', expiresAt: '' }; } };
  const scanner: any = { async scan(_t: string, k: string) { scanned.push(k); return { status: scan }; } };
  const posting: any = {};
  const audit: any = { async record(_c: any, action: string, id: string, meta: any) { audits.push({ action, id, meta }); } };
  const svc = new AiOcrReceiptService(docs, settings, files, scanner, posting, audit);
  return { svc, doc, audits, scanned };
}

describe('AiOcrReceiptService.rescan', () => {
  it('releases a quarantined document to extraction when the scanner says CLEAN', async () => {
    const { svc, doc } = svcWith('clean');
    const r = await svc.rescan(CTX, 'd1');
    expect(r).toEqual({ pipelineState: 'extracting', scan: 'clean', released: true });
    expect(doc.pipelineState).toBe('extracting');   // the state machine's quarantined --scan_clean--> extracting
  });

  it('rejects the document when the scanner says INFECTED', async () => {
    const { svc, doc } = svcWith('infected');
    const r = await svc.rescan(CTX, 'd1');
    expect(r.released).toBe(false);
    expect(r.pipelineState).toBe('rejected');
    expect(doc.pipelineState).toBe('rejected');
  });

  it('leaves the document quarantined — and NEVER releases it — for every non-verdict', async () => {
    // No tag yet, a failed scan, an access-denied, a network blip. This is the normal case immediately after
    // an upload, and it is the one that must not release.
    for (const s of ['unscanned', 'error'] as ScanStatus[]) {
      const { svc, doc } = svcWith(s);
      const r = await svc.rescan(CTX, 'd1');
      expect(r.released, `scan=${s}`).toBe(false);
      expect(r.pipelineState).toBe('quarantined');
      expect(doc.pipelineState).toBe('quarantined');   // unchanged
    }
  });

  it('re-running it many times still cannot release an unscanned file', async () => {
    const { svc, doc } = svcWith('unscanned');
    for (let i = 0; i < 5; i++) await svc.rescan(CTX, 'd1');
    expect(doc.pipelineState).toBe('quarantined');
  });

  it('scans the SAME key the file was stored under', async () => {
    const { svc, scanned } = svcWith('clean');
    await svc.rescan(CTX, 'd1');
    expect(scanned).toEqual(['tenants/t1/documents/d1/original.pdf']);
  });

  it('does not release when there is no stored object to scan', async () => {
    const { svc } = svcWith('clean', { storageKey: null });
    const r = await svc.rescan(CTX, 'd1');
    expect(r).toEqual({ pipelineState: 'quarantined', scan: 'unscanned', released: false });
  });

  it('refuses to run on a document that is not quarantined', async () => {
    // rescan must not be a back door into the review pipeline from an arbitrary state.
    for (const state of ['approved', 'posted', 'review_required', 'in_review', 'rejected']) {
      const { svc } = svcWith('clean', { pipelineState: state });
      await expect(svc.rescan(CTX, 'd1')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    }
  });

  it('audits every outcome, released or not', async () => {
    const { svc, audits } = svcWith('unscanned');
    await svc.rescan(CTX, 'd1');
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('document.rescanned');
    expect(audits[0].meta.released).toBe(false);
  });
});
