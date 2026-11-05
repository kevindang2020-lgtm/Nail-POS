// ai-money-protection-baselines.ts — Layer 2 (spec §16–§20): per-entity baselines + peer-relative risk scoring.
// This is DETERMINISTIC STATISTICS, not AI: rolling counts, means, and z-scores. It is advisory only and is
// wrapped in strong FAIRNESS GATES so low-volume staff are never singled out:
//   • an entity needs a minimum sample size before its rate is compared,
//   • the peer group needs a minimum number of members,
//   • the outlier must exceed both a z-score threshold AND an absolute floor,
//   • output severity is capped LOW ("possible anomaly — requires review"); never accusatory.
import type { AlertCandidate } from './ai-money-protection.dto';
import { NONACCUSATORY } from './ai-money-protection.dto';
import type { NormalizedPayment, NormalizedRefund } from './ai-money-protection-rules';
import { isCaptured } from './ai-money-protection-rules';

export interface BaselineOptions {
  minSampleSize: number;   // min captured transactions attributed to a user before comparison
  minPeers: number;        // min qualifying peers before any comparison is made
  zThreshold: number;      // how many std-devs above peer mean to flag
  minRatePct: number;      // absolute floor — ignore tiny rates even if statistically "high"
  minRatioOverMean: number;// must be at least this multiple of the peer mean
}
export const DEFAULT_BASELINE_OPTS: BaselineOptions = {
  minSampleSize: 20, minPeers: 3, zThreshold: 2.5, minRatePct: 5, minRatioOverMean: 1.5,
};

const REVERSAL = new Set(['refunded', 'refund', 'voided', 'void', 'reversed']);

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function stddev(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

interface UserStat { userId: string; branchId: string | null; captured: number; reversals: number; ratePct: number; }

// Compute per-user reversal rate = reversals / captured (both attributed to that user), tenant-local.
export function computeUserReversalStats(payments: NormalizedPayment[], refunds: NormalizedRefund[]): UserStat[] {
  const captured = new Map<string, { n: number; branchId: string | null }>();
  for (const p of payments) {
    if (!p.createdByUserId || !isCaptured(p.status)) continue;
    const e = captured.get(p.createdByUserId) ?? { n: 0, branchId: p.branchId }; e.n += 1; captured.set(p.createdByUserId, e);
  }
  const reversals = new Map<string, number>();
  for (const r of refunds) {
    const u = r.byUserId; if (!u) continue;
    if (!REVERSAL.has((r.status || '').toLowerCase())) continue;
    reversals.set(u, (reversals.get(u) ?? 0) + 1);
  }
  const out: UserStat[] = [];
  for (const [userId, c] of captured) {
    const rev = reversals.get(userId) ?? 0;
    out.push({ userId, branchId: c.branchId, captured: c.n, reversals: rev, ratePct: c.n ? (rev / c.n) * 100 : 0 });
  }
  return out;
}

// Flag users whose reversal rate is a peer-relative outlier — fairness-gated, advisory (LOW).
export function scoreReversalRateOutliers(
  payments: NormalizedPayment[],
  refunds: NormalizedRefund[],
  opts: BaselineOptions = DEFAULT_BASELINE_OPTS,
): AlertCandidate[] {
  const stats = computeUserReversalStats(payments, refunds).filter((s) => s.captured >= opts.minSampleSize);
  if (stats.length < opts.minPeers) return []; // not enough peers to compare fairly → say nothing
  const out: AlertCandidate[] = [];
  for (const s of stats) {
    // LEAVE-ONE-OUT: compare this user against the OTHER peers, so the candidate never inflates its own baseline.
    const others = stats.filter((o) => o.userId !== s.userId).map((o) => o.ratePct);
    const m = mean(others);
    const sd = stddev(others, m);
    // absolute + ratio floors apply regardless of variance (avoid flagging tiny/near-mean rates)
    if (s.ratePct < opts.minRatePct) continue;
    if (!(s.ratePct > m)) continue;
    if (m > 0 && s.ratePct < m * opts.minRatioOverMean) continue;
    let z: number;
    if (sd > 0) {
      z = (s.ratePct - m) / sd;
      if (z < opts.zThreshold) continue;
    } else {
      // peers identical (zero variance): can't compute z. Require a strong multiple over the peer level,
      // scaled by the configured z-threshold so a stricter threshold still suppresses borderline cases.
      const requiredRatio = Math.max(opts.minRatioOverMean, 1 + opts.zThreshold * 0.5);
      const baseline = m > 0 ? m : opts.minRatePct;
      if (s.ratePct < baseline * requiredRatio) continue;
      z = opts.zThreshold; // report at threshold for evidence
    }
    out.push({
      ruleId: 'MP_REVERSAL_RATE_OUTLIER',
      alertType: 'reversal_rate_outlier',
      severity: 'LOW',                 // advisory; a human decides if it warrants investigation
      confidence: z >= opts.zThreshold + 1.5 ? 'medium' : 'low',
      riskScore: Math.min(60, Math.round(30 + z * 6)),
      amountCents: 0,                  // a rate, not an amount — no "loss" implied
      entityFingerprint: `reversal_rate:user:${s.userId}`,
      evaluationWindow: '',
      branchId: s.branchId,
      evidence: {
        summary: `${NONACCUSATORY.possibleAnomaly} This staff member's reversal rate is higher than peers over a comparable sample.`,
        triggeredRules: ['MP_REVERSAL_RATE_OUTLIER'],
        currentValues: { reversalRatePct: round1(s.ratePct), reversals: s.reversals, capturedTransactions: s.captured },
        baselineValues: { peerMeanRatePct: round1(m), peerCount: stats.length },
        differences: { zScore: round1(z) },
        recommendedReview: [
          'Review a sample of this staff member\'s reversals for legitimate reasons before drawing conclusions.',
          'Consider role/station differences (e.g. returns desk, VIP handling) that raise reversal rates legitimately.',
        ],
        alternativeExplanations: [
          'This person legitimately handles more returns or exchanges.',
          'A few large legitimate refunds skew a small window.',
          'Station or shift differences not captured here.',
        ],
        dataFreshness: 'window',
      },
      related: { userIds: [s.userId] },
    });
  }
  return out;
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
