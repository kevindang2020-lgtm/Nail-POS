import { describe, it, expect } from 'vitest';
import { buildInsightsOverview, buildVolumeTrend, buildTenantRisk, isActive, type InsightLike } from './ai-insights-core';

const NOW = Date.parse('2026-05-06T18:00:00Z');
const mk = (o: Partial<InsightLike> & { id: string; category: string }): InsightLike => ({
  insightReference: 'AI-' + o.id, tenantId: 't1', tenantName: 'Glamour Studio', branchId: 'b1', branchName: 'Downtown',
  title: 'Finding', recommendation: 'Do X', severity: 'medium', confidence: 80, confidenceMethod: 'calibrated_probability',
  status: 'new', generatedAt: '2026-05-06T10:00:00Z', lastEvaluatedAt: '2026-05-06T10:00:00Z', freshness: 'current',
  churnRiskScore: null, flaggedAmountCents: null, modelVersion: 'v1', promptVersion: 'p1', ...o,
});

const insights: InsightLike[] = [
  mk({ id: '1', category: 'BOOKING_DECLINE', severity: 'high', status: 'new' }),
  mk({ id: '2', category: 'CANCELLATION_RISK', severity: 'high', status: 'in_review', tenantId: 't2', tenantName: 'Luxe', branchId: 'b2' }),
  mk({ id: '3', category: 'CUSTOMER_CHURN_RISK', severity: 'critical', status: 'follow_up_assigned', churnRiskScore: 42 }),
  mk({ id: '4', category: 'AI_RECEPTIONIST_ISSUE', severity: 'high', status: 'new', confidence: null }),
  mk({ id: '5', category: 'STAFFING_SHORTAGE', severity: 'medium', status: 'monitoring' }),
  mk({ id: '6', category: 'MARKETING_OPPORTUNITY', severity: 'low', status: 'dismissed' }), // inactive → excluded from active KPIs
];

describe('ai-insights engine', () => {
  it('computes the 12 KPIs in order with honest nulls', () => {
    const ov = buildInsightsOverview(insights, { now: NOW });
    expect(ov.kpis.map((k) => k.key)).toEqual([
      'open', 'critical', 'reviewed_today', 'follow_up', 'tenants_flagged', 'branches_flagged',
      'model_confidence', 'receptionist_issues', 'churn_risks', 'staffing', 'marketing', 'unusual_txn',
    ]);
    const byKey = Object.fromEntries(ov.kpis.map((k) => [k.key, k]));
    expect(byKey.open.value).toBe('5');            // 5 active (dismissed excluded)
    expect(byKey.critical.value).toBe('1');
    expect(byKey.follow_up.value).toBe('1');
    expect(byKey.tenants_flagged.value).toBe('2'); // t1 + t2
    expect(byKey.churn_risks.value).toBe('1');
    expect(byKey.churn_risks.unfavorableIfUp).toBe(true);
    expect(byKey.model_confidence.available).toBe(true);
  });

  it('reports model confidence Not Available when no insight has a confidence', () => {
    const none = [mk({ id: 'x', category: 'WAIT_TIME', confidence: null })];
    expect(buildInsightsOverview(none, { now: NOW }).kpis.find((k) => k.key === 'model_confidence')!.available).toBe(false);
  });

  it('breaks down category + severity over active insights only', () => {
    const ov = buildInsightsOverview(insights, { now: NOW });
    expect(ov.total).toBe(5);
    expect(ov.byCategory.reduce((a, c) => a + c.count, 0)).toBe(5);
    expect(ov.bySeverity.find((s) => s.severity === 'critical')!.count).toBe(1);
  });

  it('builds a volume trend grouped by day, sorted ascending', () => {
    const t = buildVolumeTrend([mk({ id: 'a', category: 'WAIT_TIME', generatedAt: '2026-05-05T10:00:00Z' }), mk({ id: 'b', category: 'WAIT_TIME', generatedAt: '2026-05-06T10:00:00Z' }), mk({ id: 'c', category: 'WAIT_TIME', generatedAt: '2026-05-06T12:00:00Z' })]);
    expect(t.available).toBe(true);
    expect(t.points).toEqual([{ date: '2026-05-05', count: 1 }, { date: '2026-05-06', count: 2 }]);
    expect(buildVolumeTrend([]).available).toBe(false);
  });

  it('builds tenant risk as an operational indicator', () => {
    const risk = buildTenantRisk(insights);
    const glamour = risk.find((r) => r.tenant === 'Glamour Studio')!;
    expect(glamour.status).toBe('At Risk');       // has a critical churn insight
    expect(glamour.openInsights).toBeGreaterThanOrEqual(1);
  });

  it('isActive excludes terminal states', () => {
    expect(isActive('new')).toBe(true);
    expect(isActive('dismissed')).toBe(false);
    expect(isActive('resolved')).toBe(false);
  });
});
