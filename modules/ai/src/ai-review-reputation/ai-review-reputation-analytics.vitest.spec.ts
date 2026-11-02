// ai-review-reputation-analytics.vitest.spec.ts — reputation metrics, period-over-period trend, and branch comparison
// with branch-scoped visibility. Inputs are single-tenant, so no cross-tenant benchmarking is possible.
import { describe, it, expect } from 'vitest';
import { computeReputationMetrics, computeTrend, compareBranches, type ReviewForMetrics } from './ai-review-reputation-analytics';

const R = (o: Partial<ReviewForMetrics>): ReviewForMetrics => ({ branchId: 'b1', rating: 5, sentiment: 'positive', escalationRequired: false, categories: [], responseStatus: 'published', resolutionStatus: 'open', createdAt: '2026-07-01T10:00:00Z', ...o });
const reviews: ReviewForMetrics[] = [
  R({ rating: 5, sentiment: 'positive', serviceName: 'Gel Manicure', technicianName: 'Ana', responseStatus: 'published', respondedAt: '2026-07-01T11:00:00Z' }),
  R({ rating: 1, sentiment: 'negative', escalationRequired: true, categories: ['injury_health'], serviceName: 'Acrylics', technicianName: 'Bea', resolutionStatus: 'resolved', responseStatus: 'awaiting_approval' }),
  R({ rating: 3, sentiment: 'neutral', categories: ['long_wait'], responseStatus: 'review_received' }),
  R({ rating: 4, sentiment: 'positive', serviceName: 'Gel Manicure', technicianName: 'Ana', responseStatus: 'published', respondedAt: '2026-07-01T10:30:00Z' }),
];
const responses = [{ drafted: true, published: true, publishFailed: false, wasEdited: false, wasAccepted: true }, { drafted: true, published: true, publishFailed: false, wasEdited: true, wasAccepted: false }, { drafted: true, published: false, publishFailed: true, wasEdited: false, wasAccepted: false }];
const requests = [{ sent: true, converted: true }, { sent: true, converted: false }, { sent: true, converted: false }, { sent: false, converted: false }];

describe('reputation metrics', () => {
  const m = computeReputationMetrics(reviews, responses, requests);
  it('computes ratings, sentiment split, and response metrics', () => {
    expect(m.avgRating).toBe(3.3);
    expect([m.positivePct, m.neutralPct, m.negativePct]).toEqual([50, 25, 25]);
    expect(m.responseRate).toBe(50);
    expect(m.avgResponseMinutes).toBe(45);
    expect(m.publicationSuccessRate).toBe(66.7);
    expect(m.resolutionRate).toBe(100);
    expect(m.seriousComplaintCount).toBe(1);
  });
  it('surfaces categories, praised/criticized services + technicians, and AI/request rates', () => {
    expect(m.topComplaintCategories.map((c) => c.category)).toEqual(expect.arrayContaining(['injury_health', 'long_wait']));
    expect(m.praisedServices).toContain('Gel Manicure');
    expect(m.criticizedServices).toContain('Acrylics');
    expect(m.praisedTechnicians).toContain('Ana');
    expect(m.techniciansNeedingCoaching).toContain('Bea');
    expect(m.aiDraftAcceptanceRate).toBe(33.3);
    expect(m.aiDraftEditRate).toBe(33.3);
    expect(m.reviewRequestConversionRate).toBe(33.3);
  });
});

describe('trend + branch comparison', () => {
  const m = computeReputationMetrics(reviews, responses, requests);
  it('detects improvements period-over-period', () => {
    const t = computeTrend(m, { ...m, avgRating: 3.0, negativePct: 40, responseRate: 30, seriousComplaintCount: 3 });
    expect(t.improved).toEqual(expect.arrayContaining(['average_rating', 'negative_share', 'serious_complaints']));
  });
  it('scopes branch comparison to authorized branches', () => {
    const branches = [{ branchId: 'b1', branchName: 'Main', metrics: { ...m, avgRating: 4.5, negativePct: 10 } }, { branchId: 'b2', branchName: 'Uptown', metrics: { ...m, avgRating: 3.0, negativePct: 35 } }, { branchId: 'b3', branchName: 'Downtown', metrics: { ...m, avgRating: 4.0, negativePct: 15 } }];
    const all = compareBranches(branches as any, 'all');
    expect(all.branches.length).toBe(3);
    expect(all.bestByRating).toBe('b1');
    expect(all.needsAttention).toBe('b2');
    const scoped = compareBranches(branches as any, ['b3']);
    expect(scoped.branches.length).toBe(1);
    expect(scoped.branches[0].branchId).toBe('b3');
  });
});
