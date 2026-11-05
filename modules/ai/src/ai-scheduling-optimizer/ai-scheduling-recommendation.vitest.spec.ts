// ai-scheduling-recommendation.vitest.spec.ts — benefits come ONLY from computed simulation deltas (no fabrication); a
// change with no benefit becomes preserve_schedule; recommendations record versions + expiry, always require review, need
// customer approval for confirmed-appointment changes, and are only applicable when checked, un-expired, and approved.
import { describe, it, expect } from 'vitest';
import { simulateChange, buildRecommendation, isApplicable, type ScheduleMetrics, type BuildRecommendationInput } from './ai-scheduling-recommendation';

const m = (o: Partial<ScheduleMetrics> = {}): ScheduleMetrics => ({ idleMin: 120, waitMin: 30, utilizationPct: 60, gapCount: 3, latenessRiskPct: 20, ...o });
const versions = { forecastVersion: 'f1', ruleVersion: 'r1', engineVersion: 'e1', configVersion: 'c1' };
const inp = (o: Partial<BuildRecommendationInput> = {}): BuildRecommendationInput => ({ type: 'fill_gap', tenantId: 'T1', branchId: 'b1', currentState: {}, proposedState: {}, hardConstraintsChecked: true, simulation: simulateChange(m(), m({ idleMin: 60, gapCount: 1 })), versions, nowMs: 1000, ...o });

describe('simulation', () => {
  it('computes real deltas', () => {
    const sim = simulateChange(m({ idleMin: 120, waitMin: 40 }), m({ idleMin: 60, waitMin: 20 }));
    expect(sim.deltas.idleSavedMin).toBe(60);
    expect(sim.deltas.waitSavedMin).toBe(20);
    expect(sim.improved).toBe(true);
    expect(simulateChange(m(), m()).improved).toBe(false);
  });
});

describe('recommendation model', () => {
  it('claims only computed benefits and preserves when none', () => {
    const rec = buildRecommendation(inp());
    expect(rec.expectedBenefit.some((b) => b.includes('idle'))).toBe(true);
    expect(rec.softObjectivesImproved).toContain('gapsRemoved');
    const none = buildRecommendation(inp({ simulation: simulateChange(m(), m()) }));
    expect(none.type).toBe('preserve_schedule');
    expect(none.expectedBenefit).toHaveLength(0);
    expect(buildRecommendation(inp({ simulation: simulateChange(m({ idleMin: 60 }), m({ idleMin: 60, waitMin: 60 })) })).possibleDownside.some((d) => d.includes('waitSavedMin'))).toBe(true);
  });
  it('records versions/expiry, requires review, lowers confidence honestly', () => {
    const rec = buildRecommendation(inp());
    expect(rec.versions.engineVersion).toBe('e1');
    expect(rec.expiresAtMs).toBeGreaterThan(1000);
    expect(rec.requiresHumanReview).toBe(true);
    expect(buildRecommendation(inp({ forecastAvailable: false })).confidence).toBeLessThanOrEqual(0.5);
    expect(buildRecommendation(inp({ dataQuality: 'insufficient' })).confidence).toBeLessThanOrEqual(0.3);
  });
  it('gates applicability on checks, expiry, and customer approval', () => {
    const confirmed = buildRecommendation(inp({ type: 'move_appointment', touchesConfirmedAppointment: true }));
    expect(confirmed.requiresCustomerApproval).toBe(true);
    expect(isApplicable(confirmed, confirmed.expiresAtMs - 1, true).ok).toBe(true);
    expect(isApplicable(buildRecommendation(inp({ hardConstraintsChecked: false })), 1001, true).ok).toBe(false);
    expect(isApplicable(buildRecommendation(inp()), buildRecommendation(inp()).expiresAtMs + 1, true).reason).toBe('expired');
    expect(isApplicable(confirmed, confirmed.expiresAtMs - 1, false).reason).toBe('customer_approval_required');
  });
});
