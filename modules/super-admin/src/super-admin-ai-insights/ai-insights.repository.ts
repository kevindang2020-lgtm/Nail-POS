// Repository for AI insights. The in-memory impl seeds a small, realistic, recommendations-only set so the page
// renders without a database (these are development fixtures — production reads real generated insights).

import type { InsightLike } from './ai-insights-core';

export interface InsightRow extends InsightLike {
  summary: string | null; modelProvider: string | null; modelName: string | null;
}

export interface InsightFilters { tenantId?: string; branchId?: string; severity?: string; category?: string; status?: string; search?: string; page?: number; pageSize?: number }

export interface InsightRepo {
  listAll(filters: { tenantId?: string; branchId?: string }): Promise<InsightRow[]>;
  listDirectory(filters: InsightFilters): Promise<{ items: InsightRow[]; total: number }>;
  get(id: string): Promise<InsightRow | null>;
  updateStatus(id: string, patch: { status?: string; reviewedByUserId?: string | null; assignedToUserId?: string | null; dismissedReason?: string | null }): Promise<InsightRow | null>;
  /** 424: record human feedback on an insight (snapshot of what the reviewer saw). Null when the insight doesn't exist. */
  submitFeedback(input: { insightId: string; verdict: 'helpful' | 'not_helpful' | 'incorrect'; comment?: string | null; submittedByUserId?: string | null }): Promise<InsightFeedbackRow | null>;
  recentFeedback(limit?: number): Promise<InsightFeedbackRow[]>;
}

export interface InsightFeedbackRow { id: string; insightId: string; insightReference: string | null; insightTitle: string | null; verdict: string; comment: string | null; modelVersion: string | null; promptVersion: string | null; createdAt: string; }

const T = '2026-05-06T';
const seedRows: InsightRow[] = [
  row('1', 'AI-BKG-0001', 'Glamour Studio', 't1', 'Downtown', 'b1', 'BOOKING_DECLINE', 'Declining bookings at Glamour Studio Downtown', 'Launch re-engagement campaign for inactive customers.', 'high', 84, 'new', `${T}10:15:00Z`, null, null),
  row('2', 'AI-CAN-0002', 'Luxe Salon & Spa', 't2', 'Main Branch', 'b2', 'CANCELLATION_RISK', 'High cancellation rate at Luxe Salon & Spa', 'Offer pre-payment incentives to reduce cancellations.', 'high', 91, 'in_review', `${T}09:42:00Z`, null, null),
  row('3', 'AI-WAIT-0003', 'The Hair Lounge', 't3', 'Uptown', 'b3', 'WAIT_TIME', 'Long wait times at The Hair Lounge', 'Increase staffing during peak hours.', 'medium', 78, 'follow_up_assigned', `${T}09:10:00Z`, null, null),
  row('4', 'AI-UTIL-0004', 'Elite Cuts', 't4', 'Central', 'b4', 'TECHNICIAN_UTILIZATION', 'Low technician utilization at Elite Cuts', 'Redistribute workload and optimize shifts.', 'medium', 75, 'in_review', `${T}08:45:00Z`, null, null),
  row('5', 'AI-TXN-0005', 'Radiant Beauty', 't5', 'Westside', 'b5', 'UNUSUAL_TRANSACTION', 'Unusual transaction activity at Radiant Beauty', 'Review flagged transactions and verify with branch.', 'high', 88, 'new', `${T}08:30:00Z`, null, 8700000),
  row('6', 'AI-RCP-0006', 'Blossom Beauty', 't6', 'Downtown', 'b6', 'AI_RECEPTIONIST_ISSUE', 'AI receptionist call drop issue at Blossom Beauty', 'Investigate call-drop patterns and network quality.', 'high', 82, 'follow_up_assigned', `${T}08:30:00Z`, null, null),
  row('7', 'AI-CHN-0007', 'Glamour Studio', 't1', 'Downtown', 'b1', 'CUSTOMER_CHURN_RISK', 'Churn risk rising at Glamour Studio', 'Review retention offers for lapsing customers.', 'critical', 79, 'new', `${T}07:50:00Z`, 42, null),
  row('8', 'AI-STF-0008', 'Luxe Salon & Spa', 't2', 'Main Branch', 'b2', 'STAFFING_SHORTAGE', 'Weekend staffing shortage at Luxe', 'Consider additional weekend coverage.', 'medium', 71, 'monitoring', `${T}07:20:00Z`, null, null),
  row('9', 'AI-MKT-0009', 'The Hair Lounge', 't3', 'Uptown', 'b3', 'MARKETING_OPPORTUNITY', 'Marketing opportunity for new services', 'Promote new service to returning customers.', 'low', 68, 'open', `${T}06:40:00Z`, null, null),
];

function row(id: string, ref: string, tenantName: string, tenantId: string, branchName: string, branchId: string, category: string, title: string, recommendation: string, severity: string, confidence: number | null, status: string, generatedAt: string, churn: number | null, flaggedCents: number | null): InsightRow {
  return {
    id, insightReference: ref, tenantId, tenantName, branchId, branchName, category, title, summary: title + '.',
    recommendation, severity, confidence, confidenceMethod: confidence === null ? null : 'calibrated_probability', status,
    generatedAt, lastEvaluatedAt: generatedAt, freshness: 'current', churnRiskScore: churn, flaggedAmountCents: flaggedCents,
    modelProvider: 'internal', modelName: 'insight-detector', modelVersion: 'v1.4', promptVersion: 'p2',
  };
}

export class InMemoryInsightRepo implements InsightRepo {
  private feedback: InsightFeedbackRow[] = [];
  async submitFeedback(input: { insightId: string; verdict: 'helpful' | 'not_helpful' | 'incorrect'; comment?: string | null; submittedByUserId?: string | null }): Promise<InsightFeedbackRow | null> {
    const ins = await this.get(input.insightId);
    if (!ins) return null;
    const row: InsightFeedbackRow = { id: `fb-${this.feedback.length + 1}`, insightId: ins.id, insightReference: ins.insightReference ?? null, insightTitle: ins.title ?? null, verdict: input.verdict, comment: (input.comment ?? '').trim() || null, modelVersion: null, promptVersion: null, createdAt: new Date().toISOString() };
    this.feedback.unshift(row);
    return row;
  }
  async recentFeedback(limit = 20): Promise<InsightFeedbackRow[]> { return this.feedback.slice(0, Math.min(100, Math.max(1, limit))); }

  private rows: InsightRow[];
  constructor(seed?: InsightRow[]) { this.rows = seed ? [...seed] : seedRows.map((r) => ({ ...r })); }

  private scoped(f: { tenantId?: string; branchId?: string }) {
    return this.rows.filter((r) => (!f.tenantId || r.tenantId === f.tenantId) && (!f.branchId || r.branchId === f.branchId));
  }
  async listAll(f: { tenantId?: string; branchId?: string }): Promise<InsightRow[]> { return this.scoped(f); }
  async listDirectory(f: InsightFilters): Promise<{ items: InsightRow[]; total: number }> {
    let r = this.scoped(f);
    if (f.severity) r = r.filter((x) => x.severity === f.severity);
    if (f.category) r = r.filter((x) => x.category === f.category);
    if (f.status) r = r.filter((x) => x.status === f.status);
    if (f.search) { const q = f.search.toLowerCase(); r = r.filter((x) => x.title.toLowerCase().includes(q) || x.insightReference.toLowerCase().includes(q)); }
    r = r.sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
    const total = r.length;
    const page = Math.max(1, f.page ?? 1), pageSize = Math.max(1, Math.min(100, f.pageSize ?? 10));
    return { items: r.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize), total };
  }
  async get(id: string): Promise<InsightRow | null> { return this.rows.find((r) => r.id === id) ?? null; }
  async updateStatus(id: string, patch: { status?: string; reviewedByUserId?: string | null; assignedToUserId?: string | null }): Promise<InsightRow | null> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    if (patch.status) r.status = patch.status;
    r.lastEvaluatedAt = new Date().toISOString();
    return r;
  }
}
