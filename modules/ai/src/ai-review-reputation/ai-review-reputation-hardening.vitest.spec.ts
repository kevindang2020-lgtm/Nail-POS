// ai-review-reputation-hardening.vitest.spec.ts — cross-cutting invariants: tenant isolation, the usage-limit fallback
// (deterministic safety survives when the LLM is unavailable and ingestion never breaks), and the end-to-end
// auto-response safety chain (serious reviews never auto-publish; a tenant cannot widen the low-risk envelope).
import { describe, it, expect } from 'vitest';
import { analyzeReview } from './ai-review-reputation-core';
import { normalizeRawReview, ReviewIngestionService, mapGoogleReview, type ReviewStorePort, type EscalationSink } from './ai-review-reputation-ingest';
import { resolveSettings, rowsToLayers, PLATFORM_DEFAULTS } from './ai-review-reputation-settings';
import { autoResponseDecision } from './ai-review-reputation-drafting';

describe('tenant isolation', () => {
  it('takes tenant/branch from context and keeps dedupe keys tenant-scoped', () => {
    const a = normalizeRawReview({ externalId: 'x', rating: 5, text: 'hi' } as any, 'google', { tenantId: 'A', branchId: 'bA' });
    const b = normalizeRawReview({ externalId: 'x', rating: 5, text: 'hi' } as any, 'google', { tenantId: 'B', branchId: 'bB' });
    expect(a.tenantId).toBe('A'); expect(b.tenantId).toBe('B');
    expect(`${a.tenantId}|${a.source}|${a.externalReviewId}`).not.toBe(`${b.tenantId}|${b.source}|${b.externalReviewId}`);
    const layers = rowsToLayers([{ level: 'tenant', branch_id: null, enabled: true, config: { salonName: 'A-Salon' } }] as any, { branchId: 'bA' });
    expect(resolveSettings({ platform: PLATFORM_DEFAULTS, ...layers }).config.salonName).toBe('A-Salon');
  });
});

describe('usage-limit fallback', () => {
  it('preserves serious-complaint detection and never breaks ingestion when the LLM is unavailable', async () => {
    const burn = analyzeReview({ text: 'chemical burn on my hand', rating: 5 });
    expect(burn.severity).toBe('critical'); expect(burn.escalationRequired).toBe(true); expect(burn.source).toBe('deterministic');
    let stored = 0, escalated = 0;
    const store: ReviewStorePort = { async findByDedupeKey() { return null; }, async insert() { stored++; return { id: 'r' + stored }; }, async update() {} };
    const svc = new ReviewIngestionService(store, { async raise() { escalated++; } } as EscalationSink);
    const res = await svc.sync({ tenantId: 'A', branchId: 'bA' }, { source: 'google', async fetch() { return [mapGoogleReview({ reviewId: 'g1', starRating: 'FIVE', comment: 'chemical burn on my hand' })]; } });
    expect(res.created).toBe(1); expect(stored).toBe(1); expect(res.escalated).toBe(1); expect(escalated).toBe(1);
  });
});

describe('auto-response safety chain', () => {
  const enabled = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { config: { autoResponse: { enabled: true, minRating: 5, confidenceThreshold: 0.8, requireNoComplaintText: true } } } }).config;
  it('denies serious/negative and allows only clean 5-star, and cannot be widened', () => {
    expect(autoResponseDecision(analyzeReview({ text: 'chemical burn', rating: 5 }), 5, enabled).allow).toBe(false);
    expect(autoResponseDecision(analyzeReview({ text: 'perfect, highly recommend', rating: 5 }), 5, enabled).allow).toBe(true);
    const widened = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { config: { autoResponse: { enabled: true, minRating: 1, confidenceThreshold: 0.1, requireNoComplaintText: false } } } }).config;
    expect(widened.autoResponse.minRating).toBe(5);
    expect(widened.autoResponse.confidenceThreshold).toBeGreaterThanOrEqual(0.8);
    expect(autoResponseDecision(analyzeReview({ text: 'awful, worst', rating: 1 }), 1, widened).allow).toBe(false);
  });
});
