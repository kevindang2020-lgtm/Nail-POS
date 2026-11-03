// receipt-review-routes — Receipt Document Recognition guide (Nov 2 2026): the old document list stays retired (the queues read
// /pos/receipt-center/documents); the receipt center is NOT behind the AI package gate (scanned receipts stay visible).
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { AiOcrReceiptController } from './ai-ocr-receipt.controller';
import { ReceiptCenterController } from './receipt-center.controller';

describe('Receipt review routes', () => {
  it('GET /pos/ai-ocr-receipt/documents stays retired; the workflow writes stay', () => {
    expect((AiOcrReceiptController.prototype as any).list).toBeUndefined();
    for (const h of ['upload', 'detail', 'approve', 'reject', 'post', 'retryPost', 'correct']) expect(typeof (AiOcrReceiptController.prototype as any)[h]).toBe('function');
  });
  it('the receipt center carries no AI package gate', () => {
    expect(Reflect.getMetadata('ai_package_code', ReceiptCenterController)).toBeUndefined();   // AI_PACKAGE_KEY
    expect(typeof (ReceiptCenterController.prototype as any).documents).toBe('function');
  });
});
