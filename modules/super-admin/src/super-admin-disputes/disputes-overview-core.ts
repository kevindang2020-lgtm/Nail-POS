// disputes-overview-core.ts — pure aggregation for the Chargebacks & Disputes overview. No I/O. Money is integer cents.
// Consumes rows the repo has already scoped/authorized and produces the 8 KPIs, funds summary, trend, reason-code and
// processor-decision distributions, recent activity, high-risk merchants, and approaching deadlines.

export type DisputeRow = {
  id: string; tenantId: string; tenantName: string; branchName: string | null;
  amountCents: number; status: string; evidenceStatus: string; processorDecision: string;
  reasonCode: string | null; reasonCategory: string | null;
  fundsWithdrawnCents: number; fundsRecoveredCents: number; riskLevel: string;
  openedAt: string; dueBy: string | null; decidedAt: string | null;
};
export type ActivityRow = { at: string; disputeRef: string; action: string; tenantName: string; status: string };
export type RiskRow = { tenantId: string; tenantName: string; openDisputes: number; amountAtRiskCents: number; riskLevel: string };
export type TrendPoint = { date: string; open: number; submitted: number; won: number; lost: number };

export type OverviewInput = {
  disputes: DisputeRow[];
  activity: ActivityRow[];
  risk: RiskRow[];
  trend: TrendPoint[];
  wonCountPeriod: number; lostCountPeriod: number; underReviewCountPeriod: number;
  prevOpen?: number;
};

const OPEN_STATUSES = new Set(['open', 'needs_evidence', 'evidence_collecting', 'submitted', 'under_review', 'escalated', 'reopened']);
const isOpen = (s: string) => OPEN_STATUSES.has(s);
const daysUntil = (iso: string | null, now: number): number | null => iso == null ? null : Math.ceil((new Date(iso).getTime() - now) / 86400000);

export function buildDisputesOverview(input: OverviewInput, now: number = Date.now()) {
  const d = input.disputes;
  const openDisputes = d.filter((x) => isOpen(x.status));
  const amountAtRisk = openDisputes.reduce((s, x) => s + x.amountCents, 0);
  const deadlinesThisWeek = d.filter((x) => { const dd = daysUntil(x.dueBy, now); return dd != null && dd >= 0 && dd <= 7 && isOpen(x.status); }).length;
  const evidenceSubmitted = d.filter((x) => ['submitted', 'accepted'].includes(x.evidenceStatus)).length;
  const won = d.filter((x) => x.status === 'won').length;
  const lost = d.filter((x) => x.status === 'lost').length;
  const fundsWithdrawn = d.reduce((s, x) => s + x.fundsWithdrawnCents, 0);
  const fundsRecovered = d.reduce((s, x) => s + x.fundsRecoveredCents, 0);
  const netLost = fundsWithdrawn - fundsRecovered;
  const recoveryRate = fundsWithdrawn > 0 ? (fundsRecovered / fundsWithdrawn) * 100 : 0;

  const kpis = {
    totalOpenDisputes: openDisputes.length,
    amountAtRiskCents: amountAtRisk,
    responseDeadlinesThisWeek: deadlinesThisWeek,
    evidenceSubmitted,
    wonDisputes: won,
    lostDisputes: lost,
    fundsWithdrawnCents: fundsWithdrawn,
    fundsRecoveredCents: fundsRecovered,
  };

  const fundsSummary = { fundsWithdrawnCents: fundsWithdrawn, fundsRecoveredCents: fundsRecovered, netLostCents: netLost, recoveryRatePct: Math.round(recoveryRate * 100) / 100 };

  // Reason-code distribution (by raw code, with description-friendly label from category).
  const reasonMap = new Map<string, number>();
  for (const x of d) { const key = x.reasonCode ?? 'Other'; reasonMap.set(key, (reasonMap.get(key) ?? 0) + 1); }
  const reasonDistribution = [...reasonMap.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);

  // Processor decision breakdown (period counts computed by repo, but recompute totals here from decided rows for reconciliation).
  const processorDecisionBreakdown = { won: input.wonCountPeriod, underReview: input.underReviewCountPeriod, lost: input.lostCountPeriod, total: input.wonCountPeriod + input.underReviewCountPeriod + input.lostCountPeriod };

  const approachingDeadlines = d
    .map((x) => ({ ...x, daysLeft: daysUntil(x.dueBy, now) }))
    .filter((x) => x.daysLeft != null && x.daysLeft >= 0 && x.daysLeft <= 7 && isOpen(x.status))
    .sort((a, b) => (a.daysLeft! - b.daysLeft!))
    .slice(0, 8)
    .map((x) => ({ disputeRef: x.id, dueBy: x.dueBy, daysLeft: x.daysLeft!, tenantName: x.tenantName, amountCents: x.amountCents }));

  return {
    kpis, fundsSummary, reasonDistribution, processorDecisionBreakdown,
    trend: input.trend,
    recentActivity: input.activity.slice(0, 6),
    highRiskMerchants: input.risk.slice(0, 6),
    approachingDeadlines,
    counts: { total: d.length },
  };
}

export function normalizeReasonCategory(rawCode: string | null): string {
  const c = (rawCode ?? '').trim();
  const map: Record<string, string> = {
    '10.4': 'fraud_card_absent', '10.5': 'fraud_card_present', '11.3': 'cardholder_disagreement',
    '12.1': 'cancellation', '12.2': 'credit_not_processed', '13.1': 'not_received', '13.2': 'not_as_described',
  };
  return map[c] ?? 'other';
}
