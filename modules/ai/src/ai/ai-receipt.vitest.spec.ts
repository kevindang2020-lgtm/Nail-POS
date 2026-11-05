// ai-receipt.vitest.spec.ts — the OCR receipt parser (pure) + the scanReceipt orchestration (gate → vision → parse →
// usage log) using the Mock vision provider. No network.
import { describe, it, expect } from 'vitest';
import { parseReceiptJson } from './ai-receipt';
import { AiAssistantService, InMemoryAiAccessRepo } from './ai-assistant.service';
import { AiGatewayService, MockAiProvider, InMemoryAiUsageLogger } from './ai-gateway';
import type { AiAccessSnapshot } from './ai-access-gate';

describe('parseReceiptJson', () => {
  it('parses clean JSON into integer cents', () => {
    const r = parseReceiptJson('{"vendor":"ABC","date":"2026-06-01","items":[{"name":"Polish","quantity":2,"unitPriceCents":1200,"totalCents":2400}],"subtotalCents":2400,"taxCents":160,"totalCents":2560,"currency":"USD"}');
    expect(r?.vendor).toBe('ABC');
    expect(r?.items[0]).toEqual({ name: 'Polish', quantity: 2, unitPriceCents: 1200, totalCents: 2400 });
    expect(r?.totalCents).toBe(2560);
  });
  it('strips ```json code fences', () => {
    const r = parseReceiptJson('```json\n{"vendor":"X","items":[],"totalCents":500}\n```');
    expect(r?.vendor).toBe('X');
    expect(r?.totalCents).toBe(500);
  });
  it('recovers a JSON object embedded in prose', () => {
    const r = parseReceiptJson('Here is the receipt: {"vendor":"Y","items":[],"totalCents":999} — done.');
    expect(r?.vendor).toBe('Y');
  });
  it('coerces string money and clamps negatives', () => {
    const r = parseReceiptJson('{"vendor":"Z","items":[{"name":"A","quantity":1,"unitPrice":"$12.00","total":"-5"}],"total":"$12.00"}');
    expect(r?.items[0].unitPriceCents).toBe(1200);
    expect(r?.items[0].totalCents).toBe(0); // negative clamped
    expect(r?.totalCents).toBe(1200);
  });
  it('back-fills total from subtotal + tax when total missing', () => {
    const r = parseReceiptJson('{"items":[],"subtotalCents":1000,"taxCents":70}');
    expect(r?.totalCents).toBe(1070);
  });
  it('returns null for unparseable input', () => {
    expect(parseReceiptJson('not a receipt')).toBeNull();
    expect(parseReceiptJson('')).toBeNull();
    expect(parseReceiptJson('[1,2,3]')).toBeNull();
  });
});

const allowed: AiAccessSnapshot = { tenantStatus: 'active', packageEnabled: true, subscription: { status: 'active' }, usage: { used: 0, limit: 100, overageEnabled: false }, hasPermission: true };

function svc(seed?: AiAccessSnapshot) {
  const repo = new InMemoryAiAccessRepo();
  if (seed) repo.seed('t1', 'ai_ocr_receipt_scanner', seed);
  const logger = new InMemoryAiUsageLogger();
  return { service: new AiAssistantService(repo, new AiGatewayService(new MockAiProvider()), logger), logger };
}

describe('scanReceipt orchestration', () => {
  it('returns a parsed receipt + logs a scans usage row when access is allowed', async () => {
    const { service, logger } = svc(allowed);
    const res = await service.scanReceipt({ tenantId: 't1', userId: 'u1', imageBase64: 'AAAA', mimeType: 'image/jpeg' });
    expect(res.ok).toBe(true);
    expect(res.receipt?.vendor).toBeTruthy();
    expect(res.receipt?.totalCents).toBeGreaterThan(0);
    expect(logger.entries.at(-1)).toMatchObject({ packageCode: 'ai_ocr_receipt_scanner', usageUnit: 'scans', status: 'success', usageAmount: 1 });
  });

  it('denies (no provider call, no charge) when not subscribed', async () => {
    const { service, logger } = svc(); // default snapshot: hasPermission false / no sub
    const res = await service.scanReceipt({ tenantId: 't1', userId: 'u1', imageBase64: 'AAAA', mimeType: 'image/jpeg' });
    expect(res.ok).toBe(false);
    expect(res.receipt).toBeUndefined();
    expect(logger.entries.at(-1)?.status.startsWith('blocked')).toBe(true);
    expect(logger.entries.at(-1)?.costMicroUsd).toBe(0);
  });
});
