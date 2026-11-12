// ai-money-protection-baselines.vitest.spec.ts — Layer 2 fairness-gated reversal-rate outlier scoring.
import { describe, it, expect } from 'vitest';
import { scoreReversalRateOutliers, computeUserReversalStats, DEFAULT_BASELINE_OPTS } from './ai-money-protection-baselines';
import type { NormalizedPayment, NormalizedRefund } from './ai-money-protection-rules';

const T = Date.parse('2026-07-07T10:00:00Z');
// helper: N captured payments + M reversals attributed to a user
function activity(spec: { user: string; captured: number; reversals: number }[]): { payments: NormalizedPayment[]; refunds: NormalizedRefund[] } {
  const payments: NormalizedPayment[] = [];
  const refunds: NormalizedRefund[] = [];
  for (const s of spec) {
    for (let i = 0; i < s.captured; i++) payments.push({ id: `p_${s.user}_${i}`, branchId: 'b1', ticketId: `t_${s.user}_${i}`, amountCents: 5000, method: 'card', status: 'approved', idempotencyKey: null, processorTxnId: null, createdByUserId: s.user, createdAtMs: T });
    for (let i = 0; i < s.reversals; i++) refunds.push({ id: `r_${s.user}_${i}`, branchId: 'b1', ticketId: `t_${s.user}_${i}`, amountCents: 5000, status: 'refunded', byUserId: s.user, createdAtMs: T });
  }
  return { payments, refunds };
}

describe('computeUserReversalStats', () => {
  it('computes per-user reversal rate', () => {
    const { payments, refunds } = activity([{ user: 'u1', captured: 40, reversals: 4 }]);
    const s = computeUserReversalStats(payments, refunds);
    expect(s[0].ratePct).toBe(10);
  });
});

describe('scoreReversalRateOutliers — detection', () => {
  it('flags a clear peer-relative outlier (advisory LOW, non-accusatory, with peer context)', () => {
    // 4 peers ~2%, one user ~30%
    const { payments, refunds } = activity([
      { user: 'u1', captured: 50, reversals: 1 },
      { user: 'u2', captured: 50, reversals: 1 },
      { user: 'u3', captured: 50, reversals: 1 },
      { user: 'u4', captured: 50, reversals: 1 },
      { user: 'bad', captured: 50, reversals: 15 },
    ]);
    const out = scoreReversalRateOutliers(payments, refunds);
    expect(out).toHaveLength(1);
    expect(out[0].related.userIds).toEqual(['bad']);
    expect(out[0].severity).toBe('LOW'); // advisory, never accusatory
    expect(out[0].evidence.summary.toLowerCase()).not.toMatch(/fraud|theft|stole|guilty/);
    expect(out[0].evidence.baselineValues).toHaveProperty('peerMeanRatePct'); // peer context present
    expect((out[0].evidence.alternativeExplanations || []).length).toBeGreaterThan(0);
  });
});

describe('scoreReversalRateOutliers — FAIRNESS GATES', () => {
  it('does NOT flag when the user has too small a sample size', () => {
    const { payments, refunds } = activity([
      { user: 'u1', captured: 50, reversals: 1 }, { user: 'u2', captured: 50, reversals: 1 }, { user: 'u3', captured: 50, reversals: 1 },
      { user: 'lowvol', captured: 5, reversals: 5 }, // 100% rate but only 5 txns → below minSampleSize
    ]);
    const out = scoreReversalRateOutliers(payments, refunds);
    expect(out.find((a) => a.related.userIds?.[0] === 'lowvol')).toBeUndefined();
  });

  it('does NOT flag when there are too few qualifying peers', () => {
    const { payments, refunds } = activity([
      { user: 'u1', captured: 50, reversals: 1 },
      { user: 'bad', captured: 50, reversals: 25 },
    ]); // only 2 qualifying users < minPeers(3)
    expect(scoreReversalRateOutliers(payments, refunds)).toHaveLength(0);
  });

  it('does NOT flag when the outlier rate is below the absolute floor', () => {
    // peers at 0%, one user at 4% (above z but below minRatePct=5)
    const { payments, refunds } = activity([
      { user: 'u1', captured: 100, reversals: 0 }, { user: 'u2', captured: 100, reversals: 0 },
      { user: 'u3', captured: 100, reversals: 0 }, { user: 'u4', captured: 100, reversals: 4 },
    ]);
    const out = scoreReversalRateOutliers(payments, refunds);
    expect(out).toHaveLength(0);
  });

  it('respects custom thresholds', () => {
    const { payments, refunds } = activity([
      { user: 'u1', captured: 50, reversals: 2 }, { user: 'u2', captured: 50, reversals: 2 },
      { user: 'u3', captured: 50, reversals: 2 }, { user: 'bad', captured: 50, reversals: 10 },
    ]);
    // very strict z-threshold suppresses the flag
    expect(scoreReversalRateOutliers(payments, refunds, { ...DEFAULT_BASELINE_OPTS, zThreshold: 10 })).toHaveLength(0);
  });
});

describe('scoreReversalRateOutliers — fairness context in the evidence (Money Protection Rules extras #13)', () => {
  it('states the minimum sample, the peers actually compared (leave-one-out) and their sample range', () => {
    const { payments, refunds } = activity([
      { user: 'u1', captured: 30, reversals: 1 },
      { user: 'u2', captured: 50, reversals: 1 },
      { user: 'u3', captured: 70, reversals: 1 },
      { user: 'lowvol', captured: 5, reversals: 5 },
      { user: 'bad', captured: 50, reversals: 15 },
    ]);
    const out = scoreReversalRateOutliers(payments, refunds);
    expect(out).toHaveLength(1);
    expect(out[0].evidence.baselineValues).toMatchObject({ minSampleSize: 20, minPeers: 3, comparedPeers: 3, peerCount: 4, peerCapturedMin: 30, peerCapturedMax: 70 });
    expect(out[0].evidence.currentValues).toMatchObject({ capturedTransactions: 50, reversals: 15 });
  });
});
