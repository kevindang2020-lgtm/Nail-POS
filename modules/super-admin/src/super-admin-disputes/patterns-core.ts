// patterns-core.ts — pure aggregation for "Analyze Dispute Patterns". No I/O. Privacy-minimized: aggregates only, never
// per-customer profiling, and never draws accusatory conclusions — it surfaces counts, amounts, and rates for review.
// Money is integer cents; rates are percentages rounded to two decimals with safe zero denominators.

export type PatternRow = {
  tenantName: string; branchName: string | null; reasonCode: string | null; reasonCategory: string | null;
  processor: string | null; status: string; processorDecision: string;
  amountCents: number; fundsWithdrawnCents: number; fundsRecoveredCents: number; riskLevel: string;
};

const OPEN = new Set(['open', 'needs_evidence', 'evidence_collecting', 'submitted', 'under_review', 'escalated', 'reopened']);
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 10000) / 100 : 0);

function bump<T extends Record<string, number>>(map: Map<string, T>, key: string, init: () => T, patch: (t: T) => void) {
  const cur = map.get(key) ?? init();
  patch(cur); map.set(key, cur);
}

export function buildPatterns(rows: PatternRow[]) {
  const won = rows.filter((r) => r.status === 'won').length;
  const lost = rows.filter((r) => r.status === 'lost').length;
  const decided = won + lost;
  const withdrawn = rows.reduce((s, r) => s + r.fundsWithdrawnCents, 0);
  const recovered = rows.reduce((s, r) => s + r.fundsRecoveredCents, 0);
  const amountAtRisk = rows.filter((r) => OPEN.has(r.status)).reduce((s, r) => s + r.amountCents, 0);

  const byReasonMap = new Map<string, { code: string; count: number; amountCents: number }>();
  for (const r of rows) bump(byReasonMap, r.reasonCode ?? 'Other', () => ({ code: r.reasonCode ?? 'Other', count: 0, amountCents: 0 }), (t: any) => { t.count++; t.amountCents += r.amountCents; });

  const byTenantMap = new Map<string, { tenant: string; count: number; open: number; amountAtRiskCents: number; won: number; lost: number }>();
  for (const r of rows) bump(byTenantMap, r.tenantName, () => ({ tenant: r.tenantName, count: 0, open: 0, amountAtRiskCents: 0, won: 0, lost: 0 }), (t: any) => {
    t.count++; if (OPEN.has(r.status)) { t.open++; t.amountAtRiskCents += r.amountCents; } if (r.status === 'won') t.won++; if (r.status === 'lost') t.lost++;
  });

  const byProcessorMap = new Map<string, { processor: string; count: number }>();
  for (const r of rows) bump(byProcessorMap, r.processor ?? 'unknown', () => ({ processor: r.processor ?? 'unknown', count: 0 }), (t: any) => { t.count++; });

  let cardPresent = 0, cardAbsent = 0, otherPresence = 0;
  for (const r of rows) {
    if (r.reasonCategory === 'fraud_card_present') cardPresent++;
    else if (r.reasonCategory === 'fraud_card_absent') cardAbsent++;
    else otherPresence++;
  }

  const sortByCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;
  return {
    totals: {
      count: rows.length, amountAtRiskCents: amountAtRisk, decided, won, lost,
      winRatePct: pct(won, decided), lossRatePct: pct(lost, decided), recoveryRatePct: pct(recovered, withdrawn),
      fundsWithdrawnCents: withdrawn, fundsRecoveredCents: recovered,
    },
    byReason: [...byReasonMap.values()].sort(sortByCount),
    byTenant: [...byTenantMap.values()].sort((a, b) => b.amountAtRiskCents - a.amountAtRiskCents),
    byProcessor: [...byProcessorMap.values()].sort(sortByCount),
    byCardPresence: { cardPresent, cardAbsent, other: otherPresence },
  };
}

// Suggests a risk level from aggregate signals for a single tenant. Advisory only — a human must confirm a flag.
export function suggestRiskLevel(open: number, lost: number, amountAtRiskCents: number): 'low' | 'medium' | 'high' | 'critical' {
  if (amountAtRiskCents >= 300000 || lost >= 4) return 'critical';
  if (amountAtRiskCents >= 150000 || open >= 4 || lost >= 2) return 'high';
  if (open >= 2 || amountAtRiskCents >= 50000) return 'medium';
  return 'low';
}
