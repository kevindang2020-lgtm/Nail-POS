// ai-ocr-receipt-upload-bytes.vitest.spec — deep-scan (Oct 22 2026): the POS / Owner App upload a receipt's bytes as a JSON
// number array; nothing converted them and every upload answered 500 (TypeError in the upload policy's hash).
import { describe, it, expect } from 'vitest';
import { bytesFromBody } from './ai-ocr-receipt-upload';
import { AiOcrReceiptController } from './ai-ocr-receipt.controller';

describe('receipt upload bytes', () => {
  it('bytesFromBody: a number array and an index-keyed object (a JSON Uint8Array) become a Uint8Array; junk is refused', () => {
    expect(bytesFromBody([137, 80, 78, 71])).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(bytesFromBody({ 1: 80, 0: 137 })).toEqual(new Uint8Array([137, 80]));
    expect(bytesFromBody(undefined)).toEqual(new Uint8Array());
    for (const bad of [[256], [-1], [1.5], ['a'], { a: 1 }, 'iVBOR']) expect(bytesFromBody(bad)).toBeNull();
  });
  it('the controller hands the SERVICE a Uint8Array (what the POS sends: Array.from(buffer)), and answers 400 for junk', async () => {
    let got: any = null;
    const c = new AiOcrReceiptController({ upload: async (_c: any, input: any) => { got = input; return { documentId: 'd1', pipelineState: 'uploaded' }; } } as any);
    const r = { ctx: { tenantId: 't', branchId: 'b', userId: 'u', role: 'OWNER', permissions: [] } };
    await c.upload(r, { filename: 'r.png', mimeType: 'image/png', sizeBytes: 3, bytes: [1, 2, 3], headerBytes: [1, 2, 3] });
    expect(got.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(got.bytes)).toEqual([1, 2, 3]);
    await expect(c.upload(r, { filename: 'r.png', bytes: [999] })).rejects.toMatchObject({ status: 400 });
  });
});
