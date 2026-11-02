// membership-trend-core.ts — pure period-over-period KPI trend logic. Crucially, it encodes business polarity so a rise
// is NOT always "good" (spec §12): more cancellations/failures/past-due/suspicious is unfavorable even though the number
// went up. Deltas are computed against a prior snapshot; with no baseline the trend is null (rendered neutral, never faked).

export type Polarity = 'up_good' | 'up_bad' | 'neutral';

export const KPI_POLARITY: Record<string, Polarity> = {
  totalPrograms: 'up_good', activeMembers: 'up_good', pausedMembers: 'up_bad', cancelledMembers: 'up_bad',
  pastDueMembers: 'up_bad', trialMembers: 'up_good', mrrCents: 'up_good', failedPayments: 'up_bad',
  benefitsIssued: 'up_good', benefitsRedeemed: 'up_good', unusedCredits: 'neutral', expiringCredits: 'up_bad',
  tenantParticipation: 'up_good', branchParticipation: 'up_good', suspiciousCount: 'up_bad',
};

export interface Trend { deltaPct: number | null; favorable: boolean | null }

// current/prior are numeric KPI values. No prior (null) or zero baseline → deltaPct null (neutral). favorable reflects
// polarity, not raw direction: for an 'up_bad' KPI an increase is unfavorable.
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

// Format a delta for display, e.g. +12.6% / -8.4%. null → em dash.
export function formatDelta(deltaPct: number | null): string {
  if (deltaPct == null) return '—';
  const sign = deltaPct > 0 ? '+' : '';
  return `${sign}${deltaPct}%`;
}
