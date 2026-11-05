// ai-checkout-upsell.records.ts — the recommendation RECORD model (§44) and its state validity rules (§45). A record is
// created when a card is generated and moves through a bounded status machine. A record can only be acted on while it is
// still valid: not expired, and its context fingerprint still matches the CURRENT cart (so a stale recommendation can
// never apply an old price or an unavailable product). AI scores/explanations here are advisory metadata, never an
// authoritative financial record — the cart/pricing engine remains the source of truth.
import type { RecommendationCard, RecommendationType } from './ai-checkout-upsell-core';

export type RecommendationStatus =
  | 'GENERATED' | 'DISPLAYED' | 'ACCEPTED' | 'DISMISSED' | 'EXPIRED' | 'INELIGIBLE' | 'OUT_OF_STOCK' | 'APPLIED' | 'FAILED';

export interface RecommendationRecord {
  recommendationId: string;
  tenantId: string; branchId: string; checkoutId: string; customerId: string | null;
  type: RecommendationType; targetId: string;
  title: string; priceCents: number | null;
  status: RecommendationStatus;
  createdAt: string; expiresAt: string;
  contextFingerprint: string;   // the cart shape this recommendation was valid for (§45)
  version: number;              // recommendation-version (feedback + audit are version-aware, §53)
  acceptedByUserId?: string | null;
  resultRef?: string | null;    // resulting cart-line id or booking id once APPLIED
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 min — a recommendation is short-lived; mutations also invalidate the cache

export function newRecord(params: {
  recommendationId: string; tenantId: string; branchId: string; checkoutId: string; customerId: string | null;
  card: RecommendationCard; contextFingerprint: string; version?: number; nowIso: string; ttlMs?: number;
}): RecommendationRecord {
  const created = Date.parse(params.nowIso);
  return {
    recommendationId: params.recommendationId,
    tenantId: params.tenantId, branchId: params.branchId, checkoutId: params.checkoutId, customerId: params.customerId,
    type: params.card.type, targetId: params.card.targetId, title: params.card.title, priceCents: params.card.priceCents,
    status: 'GENERATED',
    createdAt: params.nowIso, expiresAt: new Date(created + (params.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    contextFingerprint: params.contextFingerprint, version: params.version ?? 1, acceptedByUserId: null, resultRef: null,
  };
}

/** A record is VALID (may be displayed or acted on) only while unexpired, context-matched, and in an open status. */
export function isValid(rec: RecommendationRecord, currentContextFingerprint: string, nowIso: string): boolean {
  if (rec.status !== 'GENERATED' && rec.status !== 'DISPLAYED') return false;   // terminal/consumed
  if (Date.parse(nowIso) >= Date.parse(rec.expiresAt)) return false;           // expired (§45)
  if (rec.contextFingerprint !== currentContextFingerprint) return false;      // cart changed → stale
  return true;
}

/** Guard the accept/apply transition: a stale, expired, or already-consumed record cannot be applied (§45). Returns the
 *  reason a mutation should refuse, or null if it may proceed. */
export function acceptBlockedReason(rec: RecommendationRecord, currentContextFingerprint: string, nowIso: string): string | null {
  if (rec.status === 'APPLIED' || rec.status === 'ACCEPTED') return 'DUPLICATE_CART_ACTION';
  if (rec.status === 'DISMISSED') return 'RECOMMENDATION_NO_LONGER_ELIGIBLE';
  if (Date.parse(nowIso) >= Date.parse(rec.expiresAt)) return 'RECOMMENDATION_EXPIRED';
  if (rec.contextFingerprint !== currentContextFingerprint) return 'RECOMMENDATION_NO_LONGER_ELIGIBLE';
  return null;
}

/** Pure status transition with legality guards — no illegal jumps (e.g. APPLIED→DISPLAYED). */
const LEGAL: Record<RecommendationStatus, RecommendationStatus[]> = {
  GENERATED: ['DISPLAYED', 'ACCEPTED', 'DISMISSED', 'EXPIRED', 'INELIGIBLE', 'OUT_OF_STOCK'],
  DISPLAYED: ['ACCEPTED', 'DISMISSED', 'EXPIRED', 'INELIGIBLE', 'OUT_OF_STOCK'],
  ACCEPTED: ['APPLIED', 'FAILED'],
  APPLIED: [], FAILED: [], DISMISSED: [], EXPIRED: [], INELIGIBLE: [], OUT_OF_STOCK: [],
};
export function transition(rec: RecommendationRecord, to: RecommendationStatus): RecommendationRecord {
  if (rec.status === to) return rec;
  if (!LEGAL[rec.status].includes(to)) throw new Error('INVALID_RECOMMENDATION_TRANSITION');
  return { ...rec, status: to };
}
