// AI Insights service. Composes the overview (12 KPIs, breakdowns, trend, tenant risk), the findings directory, and
// the recommendations-only lifecycle actions (review / assign / dismiss). CRITICAL: no method here performs a
// destructive/operational action — review/assign/dismiss only change the insight's own review state + audit trail.

import { buildInsightsOverview, buildVolumeTrend, buildTenantRisk } from './ai-insights-core';
import type { InsightRepo, InsightRow, InsightFilters } from './ai-insights.repository';

const CATEGORY_PANEL = [
  { category: 'BOOKING_DECLINE', label: 'Tenants with Declining Bookings' },
  { category: 'CANCELLATION_RISK', label: 'Branches with High Cancellation Rates' },
  { category: 'WAIT_TIME', label: 'Long Customer Wait Times' },
  { category: 'TECHNICIAN_UTILIZATION', label: 'Low Technician Utilization' },
  { category: 'UNUSUAL_TRANSACTION', label: 'Unusual Transaction Activity' },
  { category: 'HIGH_PERFORMING_SERVICE', label: 'High-Performing Services' },
  { category: 'CUSTOMER_CHURN_RISK', label: 'Customer Churn Risks' },
  { category: 'MARKETING_OPPORTUNITY', label: 'Marketing Opportunities' },
  { category: 'STAFFING_SHORTAGE', label: 'Staffing Shortages' },
  { category: 'PRODUCT_DEMAND', label: 'Product-Demand Trends' },
  { category: 'AI_RECEPTIONIST_ISSUE', label: 'AI Receptionist Issues' },
];

const toRow = (r: InsightRow) => ({
  id: r.id, reference: r.insightReference, title: r.title, tenant: r.tenantName || r.tenantId || '—', branch: r.branchName || r.branchId || '—',
  category: r.category, severity: r.severity, confidence: r.confidence, confidenceMethod: r.confidenceMethod,
  recommendation: r.recommendation, status: r.status, updatedAt: r.lastEvaluatedAt, freshness: r.freshness,
});

export class AiInsightsService {
  constructor(private readonly repo: InsightRepo) {}

  async getOverview(scope: { tenantId?: string; branchId?: string } = {}) {
    const all = await this.repo.listAll(scope);
    const overview = buildInsightsOverview(all);
    const activeByCat = (cat: string) => all.filter((i) => i.category === cat && ['new', 'open', 'in_review', 'follow_up_assigned', 'monitoring', 'action_recommended', 'escalated'].includes(i.status)).length;

    // High-priority findings: the six reference cards, counts from active insights (distinct branches where relevant).
    const branchesFor = (cat: string) => new Set(all.filter((i) => i.category === cat && i.branchId).map((i) => i.branchId)).size;
    const highPriority = [
      { key: 'BOOKING_DECLINE', label: 'Declining Bookings', branches: branchesFor('BOOKING_DECLINE') },
      { key: 'CANCELLATION_RISK', label: 'High Cancellation Rates', branches: branchesFor('CANCELLATION_RISK') },
      { key: 'WAIT_TIME', label: 'Long Wait Times', branches: branchesFor('WAIT_TIME') },
      { key: 'TECHNICIAN_UTILIZATION', label: 'Low Tech Utilization', branches: branchesFor('TECHNICIAN_UTILIZATION') },
      { key: 'UNUSUAL_TRANSACTION', label: 'Unusual Transactions', branches: branchesFor('UNUSUAL_TRANSACTION'), flaggedCents: all.filter((i) => i.category === 'UNUSUAL_TRANSACTION').reduce((a, i) => a + (i.flaggedAmountCents || 0), 0) },
      { key: 'AI_RECEPTIONIST_ISSUE', label: 'AI Receptionist Issues', branches: branchesFor('AI_RECEPTIONIST_ISSUE') },
    ];

    return {
      ...overview,
      volumeTrend: buildVolumeTrend(all, 7),
      tenantRisk: buildTenantRisk(all),
      highPriority,
      categoryPanel: CATEGORY_PANEL.map((c) => ({ ...c, count: activeByCat(c.category) })),
      // Bookings Risk & Churn Signals needs booking-level operational data not modelled here → honest NotConnected.
      bookingsRiskChurn: { available: false },
    };
  }

  async getDirectory(filters: InsightFilters) {
    const { items, total } = await this.repo.listDirectory(filters);
    const page = Math.max(1, filters.page ?? 1), pageSize = Math.max(1, Math.min(100, filters.pageSize ?? 10));
    return { rows: items.map(toRow), total, pagination: { page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async get(id: string): Promise<{ ok: boolean; insight?: InsightRow; errors?: string[] }> {
    const r = await this.repo.get(id);
    return r ? { ok: true, insight: r } : { ok: false, errors: ['Insight not found.'] };
  }

  // ---- Recommendations-only lifecycle. None of these executes an operational/destructive action. ----
  async markReviewed(ids: string[], reviewedByUserId: string | null): Promise<{ ok: boolean; reviewed: number }> {
    let n = 0;
    for (const id of ids) { const r = await this.repo.updateStatus(id, { status: 'in_review', reviewedByUserId }); if (r) n++; }
    return { ok: true, reviewed: n };
  }
  async assignFollowUp(ids: string[], assignedToUserId: string | null): Promise<{ ok: boolean; assigned: number }> {
    let n = 0;
    for (const id of ids) { const r = await this.repo.updateStatus(id, { status: 'follow_up_assigned', assignedToUserId }); if (r) n++; }
    return { ok: true, assigned: n };
  }
  async dismiss(id: string, reason: string, userId: string | null): Promise<{ ok: boolean; errors?: string[] }> {
    if (!reason || !reason.trim()) return { ok: false, errors: ['A dismissal reason is required.'] };
    const r = await this.repo.updateStatus(id, { status: 'dismissed', reviewedByUserId: userId, dismissedReason: reason.trim() });
    return r ? { ok: true } : { ok: false, errors: ['Insight not found.'] };
  }

  /** 424: record feedback. HUMAN-REVIEW-ONLY — nothing here ever auto-retrains a model; the row is read by people
   *  in the model-quality process. Verdict is validated here so the repo never sees junk. */
  async submitFeedback(insightId: string, verdictRaw: string, comment: string | null | undefined, userId: string | null): Promise<{ ok: boolean; feedback?: unknown; errors?: string[] }> {
    const verdict = String(verdictRaw || '').trim() as 'helpful' | 'not_helpful' | 'incorrect';
    if (!['helpful', 'not_helpful', 'incorrect'].includes(verdict)) return { ok: false, errors: ['verdict must be helpful, not_helpful, or incorrect'] };
    const row = await this.repo.submitFeedback({ insightId, verdict, comment: comment ?? null, submittedByUserId: userId });
    if (!row) return { ok: false, errors: ['Insight not found'] };
    return { ok: true, feedback: row };
  }

  async recentFeedback(limit = 20): Promise<{ ok: boolean; feedback: unknown[] }> {
    return { ok: true, feedback: await this.repo.recentFeedback(limit) };
  }
}
