// Pure, DB-free engine for the AI Insights oversight page. Computes the 12 KPIs, category + severity breakdowns,
// high-priority findings, tenant risk overview, volume trend, and the findings directory from insight records.
// RECOMMENDATIONS ONLY — nothing here executes an action. Honest rendering: confidence carries its method and can be
// null ("Not Available"); metrics with no backing data are surfaced as available:false rather than fabricated.

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export const CATEGORIES = [
  'BOOKING_DECLINE', 'CANCELLATION_RISK', 'WAIT_TIME', 'TECHNICIAN_UTILIZATION', 'UNUSUAL_TRANSACTION',
  'HIGH_PERFORMING_SERVICE', 'CUSTOMER_CHURN_RISK', 'MARKETING_OPPORTUNITY', 'STAFFING_SHORTAGE', 'PRODUCT_DEMAND', 'AI_RECEPTIONIST_ISSUE',
] as const;
export type Category = typeof CATEGORIES[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  BOOKING_DECLINE: 'Booking Decline', CANCELLATION_RISK: 'Cancellation Risk', WAIT_TIME: 'Wait Time',
  TECHNICIAN_UTILIZATION: 'Utilization', UNUSUAL_TRANSACTION: 'Transactions', HIGH_PERFORMING_SERVICE: 'Services',
  CUSTOMER_CHURN_RISK: 'Churn', MARKETING_OPPORTUNITY: 'Marketing', STAFFING_SHORTAGE: 'Staffing',
  PRODUCT_DEMAND: 'Product Demand', AI_RECEPTIONIST_ISSUE: 'Receptionist',
};

export interface InsightLike {
  id: string; insightReference: string; tenantId: string | null; tenantName: string | null; branchId: string | null; branchName: string | null;
  category: string; title: string; recommendation: string | null; severity: string; confidence: number | null; confidenceMethod: string | null;
  status: string; generatedAt: string; lastEvaluatedAt: string; freshness: string; churnRiskScore: number | null; flaggedAmountCents: number | null;
  modelVersion: string | null; promptVersion: string | null;
}

const ACTIVE = new Set(['new', 'open', 'in_review', 'follow_up_assigned', 'monitoring', 'action_recommended', 'escalated']);
export const isActive = (s: string): boolean => ACTIVE.has(s);
const isToday = (iso: string, now: number): boolean => {
  const d = new Date(iso), n = new Date(now);
  return d.getUTCFullYear() === n.getUTCFullYear() && d.getUTCMonth() === n.getUTCMonth() && d.getUTCDate() === n.getUTCDate();
};

export interface Kpi { key: string; label: string; value: string | null; available: boolean; unfavorableIfUp?: boolean }

export function buildInsightsOverview(insights: InsightLike[], opts: { now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const active = insights.filter((i) => isActive(i.status));
  const distinct = (vals: (string | null)[]) => new Set(vals.filter((v): v is string => !!v)).size;
  const confVals = insights.map((i) => i.confidence).filter((c): c is number => typeof c === 'number');
  const avgConf = confVals.length ? Math.round(confVals.reduce((a, c) => a + c, 0) / confVals.length) : null;
  const catCount = (c: Category) => active.filter((i) => i.category === c).length;

  const kpi = (key: string, label: string, value: string | null, extra: Partial<Kpi> = {}): Kpi => ({ key, label, value, available: value !== null, ...extra });
  const kpis: Kpi[] = [
    kpi('open', 'Open Insights', active.length.toLocaleString()),
    kpi('critical', 'Critical Insights', active.filter((i) => i.severity === 'critical').length.toLocaleString(), { unfavorableIfUp: true }),
    kpi('reviewed_today', 'Reviewed Today', insights.filter((i) => i.status !== 'new' && isToday(i.lastEvaluatedAt, now) && ['in_review', 'follow_up_assigned', 'monitoring', 'resolved', 'dismissed', 'escalated'].includes(i.status)).length.toLocaleString()),
    kpi('follow_up', 'Follow-Up Assigned', active.filter((i) => i.status === 'follow_up_assigned').length.toLocaleString()),
    kpi('tenants_flagged', 'Tenants Flagged', distinct(active.map((i) => i.tenantId)).toLocaleString()),
    kpi('branches_flagged', 'Branches Flagged', distinct(active.map((i) => i.branchId)).toLocaleString()),
    kpi('model_confidence', 'Model Confidence', avgConf === null ? null : `${avgConf}%`),
    kpi('receptionist_issues', 'AI Receptionist Issues', catCount('AI_RECEPTIONIST_ISSUE').toLocaleString()),
    kpi('churn_risks', 'Customer Churn Risks', catCount('CUSTOMER_CHURN_RISK').toLocaleString(), { unfavorableIfUp: true }),
    kpi('staffing', 'Staffing Shortages', catCount('STAFFING_SHORTAGE').toLocaleString()),
    kpi('marketing', 'Marketing Opportunities', catCount('MARKETING_OPPORTUNITY').toLocaleString()),
    kpi('unusual_txn', 'Unusual Txn Alerts', catCount('UNUSUAL_TRANSACTION').toLocaleString(), { unfavorableIfUp: true }),
  ];

  // Category + severity breakdowns over active insights (reconcile to active.length).
  const byCategory = CATEGORIES.map((c) => ({ category: c, label: CATEGORY_LABEL[c], count: catCount(c) })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
  const sevOrder: Severity[] = ['critical', 'high', 'medium', 'low', 'informational'];
  const bySeverity = sevOrder.map((s) => ({ severity: s, count: active.filter((i) => i.severity === s).length })).filter((x) => x.count > 0);

  return { total: active.length, kpis, byCategory, bySeverity };
}

// Volume trend from generation dates (last N days), grouped by UTC day. Honest: available:false if no records.
export function buildVolumeTrend(insights: InsightLike[], days = 7): { available: boolean; points: { date: string; count: number }[] } {
  if (!insights.length) return { available: false, points: [] };
  const byDay = new Map<string, number>();
  for (const i of insights) { const d = i.generatedAt.slice(0, 10); byDay.set(d, (byDay.get(d) || 0) + 1); }
  const points = [...byDay.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-days);
  return { available: true, points };
}

// Tenant risk overview: aggregate flagged branches, open insights, and max churn score per tenant. This is an
// OPERATIONAL indicator, not a legal/financial/compliance conclusion.
export function buildTenantRisk(insights: InsightLike[]): { tenant: string; tenantId: string | null; flaggedBranches: number; openInsights: number; churnRisk: number | null; status: 'At Risk' | 'Monitoring' | 'Stable' }[] {
  const active = insights.filter((i) => isActive(i.status));
  const groups = new Map<string, InsightLike[]>();
  for (const i of active) { const key = i.tenantName || i.tenantId || '—'; (groups.get(key) ?? groups.set(key, []).get(key)!).push(i); }
  return [...groups.entries()].map(([tenant, rows]) => {
    const flaggedBranches = new Set(rows.map((r) => r.branchId).filter(Boolean)).size;
    const openInsights = rows.length;
    const churnScores = rows.map((r) => r.churnRiskScore).filter((c): c is number => typeof c === 'number');
    const churnRisk = churnScores.length ? Math.max(...churnScores) : null;
    const critical = rows.some((r) => r.severity === 'critical');
    const status: 'At Risk' | 'Monitoring' | 'Stable' = critical || (churnRisk ?? 0) >= 30 ? 'At Risk' : openInsights >= 3 ? 'Monitoring' : 'Stable';
    return { tenant, tenantId: rows[0].tenantId, flaggedBranches, openInsights, churnRisk, status };
  }).sort((a, b) => b.openInsights - a.openInsights);
}
