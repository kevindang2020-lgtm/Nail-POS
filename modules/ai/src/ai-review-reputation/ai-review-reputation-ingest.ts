// ai-review-reputation-ingest.ts — adapter-based ingestion. Each source adapter maps its own API/webhook payload into a
// common RawReview; the pure normalizer finalises + sanitises it into a NormalizedReview keyed for dedupe on
// (tenant, source, external_review_id). The ingestion service upserts idempotently and runs the deterministic analysis on
// every new/changed review (so sentiment/severity/escalation are always set, independent of any LLM). Tenant/branch are
// always carried from the trusted context — never from the raw payload. No platform is ever scraped; adapters use
// approved APIs/webhooks/imports only.
import { analyzeReview, type ReviewAnalysis } from './ai-review-reputation-core';

export type ReviewSource = 'google' | 'facebook' | 'yelp' | 'internal' | 'survey' | 'sms' | 'email' | 'app' | 'support' | 'manual';
export const REVIEW_SOURCES: readonly ReviewSource[] = ['google', 'facebook', 'yelp', 'internal', 'survey', 'sms', 'email', 'app', 'support', 'manual'];

export interface IngestContext { tenantId: string; branchId?: string | null; }

// The common shape every adapter produces (already source-mapped).
export interface RawReview {
  externalId: string | null;        // null for internal/manual (no external dedupe)
  rating: number | null;
  text: string | null;
  reviewerName?: string | null;
  reviewerUrl?: string | null;
  reviewDate?: string | null;
  isPublic?: boolean;
  customerId?: string | null;
  appointmentId?: string | null;
}

export interface NormalizedReview {
  tenantId: string; branchId: string | null; source: ReviewSource;
  externalReviewId: string | null; rating: number | null; comment: string | null;
  reviewerName: string | null; reviewerUrl: string | null; reviewDate: string | null;
  isPublic: boolean; customerId: string | null; appointmentId: string | null;
  contentHash: string;               // to detect changes on re-sync
}

const clamp05 = (r: number | null): number | null => (r == null ? null : Math.min(5, Math.max(0, Math.round(Number(r) * 10) / 10)));
// eslint-disable-next-line no-control-regex -- deliberate: strip control chars from ingested review text
const clean = (s: unknown, max = 4000): string | null => { const t = String(s ?? '').replace(/\u0000/g, '').trim(); return t ? t.slice(0, max) : null; };
function hash(s: string): string { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
/** Stable content hash for change-detection on re-sync (rating|comment|isPublic). Exported so repos can recompute it. */
export function computeContentHash(rating: number | null, comment: string | null, isPublic: boolean): string { return hash(`${rating}|${comment}|${isPublic}`); }

/** Normalize a source-mapped RawReview into a store-ready record. Tenant/branch come from ctx, never the payload. */
export function normalizeRawReview(raw: RawReview, source: ReviewSource, ctx: IngestContext): NormalizedReview {
  const rating = clamp05(raw.rating);
  const comment = clean(raw.text);
  return {
    tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, source,
    externalReviewId: raw.externalId ? String(raw.externalId).slice(0, 200) : null,
    rating, comment,
    reviewerName: clean(raw.reviewerName, 200), reviewerUrl: clean(raw.reviewerUrl, 500),
    reviewDate: raw.reviewDate ? String(raw.reviewDate) : null,
    isPublic: raw.isPublic !== false,
    customerId: raw.customerId ?? null, appointmentId: raw.appointmentId ?? null,
    contentHash: computeContentHash(rating, comment, raw.isPublic !== false),
  };
}

export function dedupeKey(n: NormalizedReview): string | null {
  return n.externalReviewId ? `${n.tenantId}|${n.source}|${n.externalReviewId}` : null;
}

// --- example source adapters (approved APIs/webhooks only; shown for google/facebook/manual) ---
export interface ReviewSourceAdapter { source: ReviewSource; fetch(ctx: IngestContext, since?: string | null): Promise<RawReview[]>; }

export function mapGoogleReview(r: any): RawReview {
  const stars: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return { externalId: r?.reviewId ?? r?.name ?? null, rating: typeof r?.starRating === 'string' ? stars[r.starRating] ?? null : r?.starRating ?? null,
    text: r?.comment ?? null, reviewerName: r?.reviewer?.displayName ?? null, reviewerUrl: r?.reviewer?.profilePhotoUrl ?? null,
    reviewDate: r?.createTime ?? null, isPublic: true };
}
export function mapFacebookReview(r: any): RawReview {
  return { externalId: r?.id ?? null, rating: r?.rating ?? (r?.recommendation_type === 'positive' ? 5 : r?.recommendation_type === 'negative' ? 1 : null),
    text: r?.review_text ?? r?.message ?? null, reviewerName: r?.reviewer?.name ?? null, reviewDate: r?.created_time ?? null, isPublic: true };
}
export function mapManualReview(r: any): RawReview {
  return { externalId: null, rating: r?.rating ?? null, text: r?.text ?? null, reviewerName: r?.reviewerName ?? null,
    reviewDate: r?.reviewDate ?? new Date().toISOString(), isPublic: r?.isPublic !== false, customerId: r?.customerId ?? null, appointmentId: r?.appointmentId ?? null };
}

// --- ingestion service ---
export interface StoredReviewRef { id: string; contentHash: string; }
export interface ReviewStorePort {
  findByDedupeKey(ctx: IngestContext, source: ReviewSource, externalReviewId: string): Promise<StoredReviewRef | null>;
  insert(ctx: IngestContext, n: NormalizedReview, analysis: ReviewAnalysis): Promise<{ id: string }>;
  update(ctx: IngestContext, id: string, n: NormalizedReview, analysis: ReviewAnalysis): Promise<void>;
}
export interface EscalationSink { raise(ctx: IngestContext, reviewId: string, analysis: ReviewAnalysis): Promise<void>; }

export interface SyncResult { fetched: number; created: number; updated: number; skipped: number; escalated: number; spam: number; }

export class ReviewIngestionService {
  constructor(private readonly store: ReviewStorePort, private readonly escalations?: EscalationSink) {}

  async sync(ctx: IngestContext, adapter: ReviewSourceAdapter, since?: string | null): Promise<SyncResult> {
    if (!ctx?.tenantId) throw new Error('TENANT_REQUIRED');
    const raws = await adapter.fetch(ctx, since ?? null);
    const res: SyncResult = { fetched: raws.length, created: 0, updated: 0, skipped: 0, escalated: 0, spam: 0 };
    for (const raw of raws) {
      const n = normalizeRawReview(raw, adapter.source, ctx);
      const analysis = analyzeReview({ text: n.comment, rating: n.rating }); // deterministic — always runs
      if (analysis.isSpam) res.spam++;
      const key = dedupeKey(n);
      if (key) {
        const existing = await this.store.findByDedupeKey(ctx, n.source, n.externalReviewId!);
        if (existing) {
          if (existing.contentHash === n.contentHash) { res.skipped++; continue; }   // unchanged → idempotent no-op
          await this.store.update(ctx, existing.id, n, analysis); res.updated++;
          if (analysis.escalationRequired) { await this.escalations?.raise(ctx, existing.id, analysis); res.escalated++; }
          continue;
        }
      }
      const ins = await this.store.insert(ctx, n, analysis); res.created++;
      if (analysis.escalationRequired) { await this.escalations?.raise(ctx, ins.id, analysis); res.escalated++; }
    }
    return res;
  }
}
