// ai-ocr-receipt-upload-policy.vitest.spec.ts — BUILD_PLAN Phase 12 (#34): POST /pos/ai-ocr-receipt/upload runs the ONE
// upload policy on top of the OCR checks: a disallowed client file name is refused, the original is stored EXACTLY (it is
// evidence), and the bytes are charged to the salon's storage quota (released when the store write fails).
import { describe, it, expect } from 'vitest';
import { AiOcrReceiptService } from './ai-ocr-receipt.service';

const CTX = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'MANAGER', permissions: [] as string[] } as any;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Producer (SECRET-SCANNER-SERIAL) >>\nendobj\n');

function build(opts: { storeFails?: boolean } = {}) {
  const stored: Uint8Array[] = []; const charged: number[] = []; const released: number[] = [];
  const docs: any = { async create() { return { id: 'd1' }; }, async patch() {}, async get() { return { id: 'd1', pipelineState: 'uploaded' }; } };
  const settings: any = { async load() { return [{ scope: 'tenant', settings: { enabled: true, autoRunOcr: false } }]; } };
  const files: any = { async store(_c: any, _d: string, _e: string, b: Uint8Array) { if (opts.storeFails) throw new Error('bucket down'); stored.push(b); return { storageKey: 'k' }; } };
  const scanner: any = { async scan() { return { status: 'clean' }; } };
  const audit: any = { async record() {} };
  const s = new AiOcrReceiptService(docs, settings, files, scanner, {} as any, audit, [], { async log() {} } as any);
  s.storageQuota = { reserveStorage: async (_t: string, n: number) => { charged.push(n); }, releaseStorage: async (_t: string, n: number) => { released.push(n); } };
  return { s, stored, charged, released };
}
const input = (bytes: Buffer, filename = 'receipt.pdf') => ({ filename, declaredMime: 'application/pdf', sizeBytes: bytes.length, headerBytes: bytes.subarray(0, 16), bytes });

describe('POST /pos/ai-ocr-receipt/upload', () => {
  it('stores the original exactly and charges its size to the salon', async () => {
    const { s, stored, charged } = build();
    await s.upload(CTX, input(PDF));
    expect(Buffer.from(stored[0]).equals(PDF)).toBe(true);
    expect(charged).toEqual([PDF.length]);
  });
  it('a client file name outside the policy (receipt.html) is refused before anything is stored or charged', async () => {
    const { s, stored, charged } = build();
    await expect(s.upload(CTX, input(PDF, 'receipt.html'))).rejects.toThrow(/upload rejected/);
    expect(stored).toHaveLength(0);
    expect(charged).toHaveLength(0);
  });
  it('a failed store write gives the reserved bytes back', async () => {
    const { s, released } = build({ storeFails: true });
    await expect(s.upload(CTX, input(PDF))).rejects.toThrow('bucket down');
    expect(released).toEqual([PDF.length]);
  });
});
