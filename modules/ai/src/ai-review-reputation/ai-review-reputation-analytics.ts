// ai-review-reputation-analytics.ts — PURE analytics over a single tenant's own reviews/responses/requests. No
// cross-tenant data ever enters (inputs are already tenant-scoped by the caller), so no benchmarking against other
// tenants is possible here. Branch comparison is filtered to the branches the caller is authorized to see.

export interface ReviewForMetrics {
  branchId: string | null; rating: number | null; sentiment: string | null; escalationRequired: boolean;
  categories: string[]; technicianName?: string | null; serviceName?: string | null;
  responseStatus: string; resolutionStatus: string; createdAt: string; respondedAt?: string | null;
}
export interface ResponseForMetrics { drafted: boolean; published: boolean; publishFailed: boolean; wasEdited: boolean; wasAccepted: boolean; }
export interface RequestForMetrics { sent: boolean; converted: boolean; }

export interface ReputationMetrics {
  reviewCount: number; avgRating: number;
  positivePct: number; neutralPct: number; negativePct: number;
  responseRate: number; avgResponseMinutes: number | null; publicationSuccessRate: number; resolutionRate: number;
  seriousComplaintCount: number;
  topComplaintCategories: { category: string; count: number }[];
  praisedServices: string[]; criticizedServices: string[];
  praisedTechnicians: string[]; techniciansNeedingCoaching: string[];
  aiDraftAcceptanceRate: number; aiDraftEditRate: number;
  reviewRequestConversionRate: number;
}

const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const round1 = (n: number): number => Math.round(n * 10) / 10;

export function computeReputationMetrics(reviews: ReviewForMetrics[], responses: ResponseForMetrics[], requests: RequestForMetrics[]): ReputationMetrics {
  const n = reviews.length;
  let sum = 0, rated = 0, pos = 0, neu = 0, neg = 0, serious = 0, responded = 0, respMinTotal = 0, respMinCount = 0, resolvedNeeded = 0, resolved = 0;
  const cat = new Map<string, number>();
  const svcPos = new Map<string, number>(), svcNeg = new Map<string, number>(), techPos = new Map<string, number>(), techNeg = new Map<string, number>();
  for (const r of reviews) {
    if (r.rating != null) { sum += r.rating; rated++; }
    if (r.sentiment === 'positive') pos++; else if (r.sentiment === 'negative') neg++; else if (r.sentiment === 'neutral' || r.sentiment === 'mixed') neu++;
    if (r.escalationRequired) serious++;
    for (const c of r.categories || []) cat.set(c, (cat.get(c) || 0) + 1);
    if (r.responseStatus === 'published') { responded++; if (r.respondedAt) { const m = (new Date(r.respondedAt).getTime() - new Date(r.createdAt).getTime()) / 60000; if (m >= 0) { respMinTotal += m; respMinCount++; } } }
    if (r.escalationRequired) { resolvedNeeded++; if (r.resolutionStatus === 'resolved') resolved++; }
    const svc = r.serviceName?.trim(); const tech = r.technicianName?.trim();
    if (svc) { if (r.sentiment === 'positive') svcPos.set(svc, (svcPos.get(svc) || 0) + 1); else if (r.sentiment === 'negative') svcNeg.set(svc, (svcNeg.get(svc) || 0) + 1); }
    if (tech) { if (r.sentiment === 'positive') techPos.set(tech, (techPos.get(tech) || 0) + 1); else if (r.sentiment === 'negative') techNeg.set(tech, (techNeg.get(tech) || 0) + 1); }
  }
  const drafted = responses.filter((r) => r.drafted).length;
  const published = responses.filter((r) => r.published).length;
  const failed = responses.filter((r) => r.publishFailed).length;
  const edited = responses.filter((r) => r.wasEdited).length;
  const accepted = responses.filter((r) => r.wasAccepted).length;
  const sent = requests.filter((r) => r.sent).length;
  const converted = requests.filter((r) => r.converted).length;
  const topN = (m: Map<string, number>, take = 5) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, take);

  return {
    reviewCount: n, avgRating: rated ? round1(sum / rated) : 0,
    positivePct: pct(pos, n), neutralPct: pct(neu, n), negativePct: pct(neg, n),
    responseRate: pct(responded, n), avgResponseMinutes: respMinCount ? Math.round(respMinTotal / respMinCount) : null,
    publicationSuccessRate: pct(published, published + failed), resolutionRate: pct(resolved, resolvedNeeded),
    seriousComplaintCount: serious,
    topComplaintCategories: topN(cat).map(([category, count]) => ({ category, count })),
    praisedServices: topN(svcPos, 5).map(([s]) => s), criticizedServices: topN(svcNeg, 5).map(([s]) => s),
    praisedTechnicians: topN(techPos, 5).map(([t]) => t), techniciansNeedingCoaching: topN(techNeg, 5).map(([t]) => t),
    aiDraftAcceptanceRate: pct(accepted, drafted), aiDraftEditRate: pct(edited, drafted),
    reviewRequestConversionRate: pct(converted, sent),
  };
}

// --- period-over-period trend ---
export interface TrendResult { ratingDelta: number; negativePctDelta: number; responseRateDelta: number; improved: string[]; declined: string[]; }
export function computeTrend(current: ReputationMetrics, previous: ReputationMetrics): TrendResult {
  const ratingDelta = round1(current.avgRating - previous.avgRating);
  const negativePctDelta = round1(current.negativePct - previous.negativePct);
  const responseRateDelta = round1(current.responseRate - previous.responseRate);
  const improved: string[] = [], declined: string[] = [];
  if (ratingDelta > 0) improved.push('average_rating'); else if (ratingDelta < 0) declined.push('average_rating');
  if (negativePctDelta < 0) improved.push('negative_share'); else if (negativePctDelta > 0) declined.push('negative_share');
  if (responseRateDelta > 0) improved.push('response_rate'); else if (responseRateDelta < 0) declined.push('response_rate');
  if (current.seriousComplaintCount > previous.seriousComplaintCount) declined.push('serious_complaints');
  else if (current.seriousComplaintCount < previous.seriousComplaintCount) improved.push('serious_complaints');
  return { ratingDelta, negativePctDelta, responseRateDelta, improved, declined };
}

// --- branch comparison (branch-scoped visibility; no cross-tenant) ---
export interface BranchMetrics { branchId: string; branchName: string; metrics: ReputationMetrics; }
export interface BranchComparison { branches: BranchMetrics[]; bestByRating: string | null; needsAttention: string | null; }
/** Filter to the branches the caller may see. `'all'` = tenant owner; otherwise only authorized branch ids. */
export function compareBranches(all: BranchMetrics[], visible: 'all' | string[]): BranchComparison {
  const filtered = visible === 'all' ? all.slice() : all.filter((b) => visible.includes(b.branchId));
  if (!filtered.length) return { branches: [], bestByRating: null, needsAttention: null };
  const ranked = filtered.slice().sort((a, b) => b.metrics.avgRating - a.metrics.avgRating);
  const worst = filtered.slice().sort((a, b) => (b.metrics.negativePct - a.metrics.negativePct) || (a.metrics.avgRating - b.metrics.avgRating))[0];
  return { branches: ranked, bestByRating: ranked[0].branchId, needsAttention: worst.branchId };
}
