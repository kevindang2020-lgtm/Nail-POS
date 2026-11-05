// ai-review-reputation-ingest.vitest.spec.ts — adapter-based ingestion: per-source normalization, tenant-from-context
// (never the payload), idempotent dedupe on (tenant, source, external id), and deterministic analysis + escalation on
// every new/changed review.
import { describe, it, expect } from 'vitest';
import { ReviewIngestionService, normalizeRawReview, mapGoogleReview, mapFacebookReview, mapManualReview, type ReviewSourceAdapter, type ReviewStorePort, type EscalationSink, type NormalizedReview } from './ai-review-reputation-ingest';

const ctx = { tenantId: 'A', branchId: 'b1' };

describe('normalization', () => {
  it('maps each source into the common shape and takes tenant from context', () => {
    const g = normalizeRawReview(mapGoogleReview({ reviewId: 'g1', starRating: 'FIVE', comment: 'Great!' }), 'google', ctx);
    expect(g.rating).toBe(5); expect(g.externalReviewId).toBe('g1'); expect(g.tenantId).toBe('A');
    expect(normalizeRawReview(mapFacebookReview({ id: 'f1', recommendation_type: 'negative', review_text: 'bad' }), 'facebook', ctx).rating).toBe(1);
    expect(normalizeRawReview(mapManualReview({ rating: 4, text: 'ok' }), 'manual', ctx).externalReviewId).toBeNull();
    const spoof = normalizeRawReview({ externalId: 'x', rating: 5, text: 'hi' } as any, 'google', { tenantId: 'A', branchId: 'b1' });
    expect(spoof.tenantId).toBe('A'); expect(spoof.branchId).toBe('b1');
  });
});

describe('idempotent ingestion + escalation', () => {
  function makeStore() {
    const rows: Record<string, { id: string; contentHash: string; n: NormalizedReview }> = {}; let seq = 0;
    const port: ReviewStorePort = {
      async findByDedupeKey(_c, src, ext) { const k = `A|${src}|${ext}`; return rows[k] ? { id: rows[k].id, contentHash: rows[k].contentHash } : null; },
      async insert(_c, n) { const id = 'r' + (++seq); if (n.externalReviewId) rows[`A|${n.source}|${n.externalReviewId}`] = { id, contentHash: n.contentHash, n }; return { id }; },
      async update(_c, id, n) { if (n.externalReviewId) rows[`A|${n.source}|${n.externalReviewId}`] = { id, contentHash: n.contentHash, n }; },
    };
    return { port, rows };
  }
  const adapter = (reviews: any[]): ReviewSourceAdapter => ({ source: 'google', async fetch() { return reviews.map(mapGoogleReview); } });

  it('creates, escalates serious complaints, skips unchanged, updates changed, counts spam', async () => {
    const { port, rows } = makeStore();
    let escalated = 0; const sink: EscalationSink = { async raise() { escalated++; } };
    const svc = new ReviewIngestionService(port, sink);
    const batch = [{ reviewId: 'g1', starRating: 'FIVE', comment: 'Amazing!' }, { reviewId: 'g2', starRating: 'ONE', comment: 'I got a chemical burn from the acrylic' }];

    const r1 = await svc.sync(ctx, adapter(batch));
    expect(r1.created).toBe(2); expect(r1.escalated).toBe(1); expect(escalated).toBe(1);

    const r2 = await svc.sync(ctx, adapter(batch));
    expect(r2.created).toBe(0); expect(r2.skipped).toBe(2);
    expect(Object.keys(rows).length).toBe(2);

    const r3 = await svc.sync(ctx, adapter([{ reviewId: 'g1', starRating: 'THREE', comment: 'Amazing!' }]));
    expect(r3.updated).toBe(1); expect(r3.created).toBe(0);

    const r4 = await svc.sync(ctx, adapter([{ reviewId: 'g3', starRating: 'FIVE', comment: 'casino promo click here http://spam.example buy now' }]));
    expect(r4.spam).toBe(1);

    await expect(svc.sync({ tenantId: '' } as any, adapter([]))).rejects.toThrow('TENANT_REQUIRED');
  });
});
