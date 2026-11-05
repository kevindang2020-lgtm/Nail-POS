// ai-ocr-receipt-preview-key — BUILD_PLAN Phase 14 live IDOR run (scripts/live-phase14-idor.mjs): GET
// /pos/ai-ocr-receipt/documents/:id/preview-url WITHOUT ?key= crashed (TypeError on undefined.startsWith → 500) even for
// the salon's own document. A missing key is outside the tenant's namespace like any other key: 403, never a crash.
import { describe, it, expect } from 'vitest';
import { AiOcrReceiptService } from './ai-ocr-receipt.service';
import { OcrError } from './ai-ocr-receipt-errors';

describe('previewUrl with no storage key', () => {
  it('is refused as FORBIDDEN (403), not a TypeError', async () => {
    const docs: any = { get: async () => ({ id: 'doc-1' }) };
    const files: any = { signedPreview: async () => 'https://signed' };
    const svc = new (AiOcrReceiptService as any)(docs, {}, files, {}, {}, {});
    const ctx: any = { tenantId: 'tenant-a', branchId: 'b', userId: 'u', permissions: [] };
    for (const key of [undefined, '', 42]) {
      const err = await svc.previewUrl(ctx, 'doc-1', key).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OcrError);
      expect((err as OcrError).code).toBe('FORBIDDEN');
    }
    await expect(svc.previewUrl(ctx, 'doc-1', 'tenants/tenant-a/ocr/x.png')).resolves.toBe('https://signed');
  });
});
