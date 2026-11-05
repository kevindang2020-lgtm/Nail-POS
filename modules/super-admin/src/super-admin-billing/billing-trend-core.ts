// billing-trend-core.ts — pure period-over-period KPI trend + business polarity. A rise is NOT always "good" (§10):
// more past-due/failed/cancellations is unfavorable; rising credits/discounts are neutral (review indicators), not green.

export type Polarity = 'up_good' | 'up_bad' | 'neutral';

export const KPI_POLARITY: Record<string, Polarity> = {
  activeSubscriptions: 'up_good', trialAccounts: 'up_good', pastDueAccounts: 'up_bad', failedPayments: 'up_bad',
  invoices: 'up_good', creditsIssuedCents: 'neutral', discountsAppliedCents: 'neutral', addOnsActive: 'up_good',
  subscriptionChanges: 'neutral', cancellationRequests: 'up_bad', upcomingRenewals: 'neutral', mrrCents: 'up_good',
};

export interface Trend { deltaPct: number | null; favorable: boolean | null }

export function computeTrend(key: string, current: number, prior: number | null | undefined): Trend {
  if (prior == null || prior === 0) return { deltaPct: null, favorable: null };
  const deltaPct = Math.round(((current - prior) / prior) * 1000) / 10;
  const polarity = KPI_POLARITY[key] ?? 'neutral';
  let favorable: boolean | null = null;
  if (deltaPct !== 0) {
    if (polarity === 'up_good') favorable = current > prior;
    else if (polarity === 'up_bad') favorable = current < prior;
    else favorable = null;
  }
  return { deltaPct, favorable };
}

export function formatDelta(deltaPct: number | null): string {
  if (deltaPct == null) return '—';
  return `${deltaPct > 0 ? '+' : ''}${deltaPct}%`;
}
