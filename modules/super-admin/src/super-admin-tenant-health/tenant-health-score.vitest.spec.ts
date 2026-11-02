import { describe, it, expect } from 'vitest';
import {
  scoreTenantHealth,
  bandForScore,
  HEALTH_WEIGHTS,
  HEALTH_BANDS,
  type TenantHealthSignals,
} from './tenant-health-score';

// A fully-configured, actively-trading, paid-current tenant (reference: Elite Beauty Group / Glamour Studio).
const HEALTHY: TenantHealthSignals = {
  status: 'active', billingStatus: 'current', daysSinceLastLogin: 0, daysSinceLastActivity: 0,
  activeDeviceCount: 48, appointmentsLast30: 120, paymentVolumeCentsLast30: 4_875_200,
  openTickets: { high: 0, medium: 0, low: 0 }, merchantSetup: 'complete', onboardingCompletion: 1,
  integrationHealth: 'healthy',
};

// A suspended, overdue, no-device, idle tenant (reference: Urban Style Hub, health 28).
const FAILING: TenantHealthSignals = {
  status: 'suspended', billingStatus: 'overdue', daysSinceLastLogin: 12, daysSinceLastActivity: 2,
  activeDeviceCount: 0, appointmentsLast30: 0, paymentVolumeCentsLast30: 0,
  openTickets: { high: 2, medium: 1, low: 0 }, merchantSetup: 'failed', onboardingCompletion: 1,
  integrationHealth: 'failing',
};

// A brand-new Pending tenant with no operational signal (reference: Bella Vista Salon → "Not yet calculated").
const UNRATED: TenantHealthSignals = {
  status: 'pending', billingStatus: 'none', daysSinceLastLogin: null, daysSinceLastActivity: null,
  activeDeviceCount: 0, appointmentsLast30: 0, paymentVolumeCentsLast30: 0,
  openTickets: null, merchantSetup: 'pending', onboardingCompletion: 0, integrationHealth: 'none',
};

describe('tenant health-score engine (§13)', () => {
  it('weights sum to exactly 100', () => {
    const sum = Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('healthy tenant scores in the Excellent/Good band with low churn', () => {
    const r = scoreTenantHealth(HEALTHY);
    expect(r.score).not.toBeNull();
    expect(r.score!).toBeGreaterThanOrEqual(88);
    expect(['excellent', 'good']).toContain(r.band);
    expect(r.churnRisk).toBe('low');
  });

  it('suspended/overdue/idle tenant scores Critical/Poor with high churn risk', () => {
    const r = scoreTenantHealth(FAILING);
    expect(r.score!).toBeLessThan(45);
    expect(['critical', 'poor']).toContain(r.band);
    expect(r.churnRisk).toBe('high');
  });

  it('a tenant with no operational signal is unrated (null), not a fabricated number', () => {
    const r = scoreTenantHealth(UNRATED);
    expect(r.score).toBeNull();
    expect(r.band).toBe('unrated');
    expect(r.churnRisk).toBe('unknown');
    expect(r.factors).toHaveLength(0);
  });

  it('is deterministic — same input yields the same score', () => {
    expect(scoreTenantHealth(HEALTHY).score).toBe(scoreTenantHealth(HEALTHY).score);
    expect(scoreTenantHealth(FAILING).score).toBe(scoreTenantHealth(FAILING).score);
  });

  it('score is bounded to 0..100', () => {
    for (const s of [HEALTHY, FAILING]) {
      const v = scoreTenantHealth(s).score!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('bandForScore matches the reference bucket thresholds', () => {
    expect(bandForScore(95)).toBe('excellent');
    expect(bandForScore(90)).toBe('excellent');
    expect(bandForScore(89)).toBe('good');
    expect(bandForScore(70)).toBe('good');
    expect(bandForScore(69)).toBe('average');
    expect(bandForScore(50)).toBe('average');
    expect(bandForScore(49)).toBe('poor');
    expect(bandForScore(30)).toBe('poor');
    expect(bandForScore(29)).toBe('critical');
    expect(bandForScore(0)).toBe('critical');
  });

  it('bands are contiguous and cover 0..100 with no gaps', () => {
    const sorted = [...HEALTH_BANDS].sort((a, b) => a.min - b.min);
    expect(sorted[0].min).toBe(0);
    expect(sorted[sorted.length - 1].max).toBe(100);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min).toBe(sorted[i - 1].max + 1);
    }
  });

  it('exposes per-factor breakdown for the detail panel (earned ≤ possible)', () => {
    const r = scoreTenantHealth(HEALTHY);
    expect(r.factors.length).toBe(Object.keys(HEALTH_WEIGHTS).length);
    for (const f of r.factors) {
      expect(f.earned).toBeLessThanOrEqual(f.possible);
      expect(f.earned).toBeGreaterThanOrEqual(0);
    }
    const possibleSum = r.factors.reduce((a, f) => a + f.possible, 0);
    expect(possibleSum).toBe(100);
  });

  it('overdue billing + fading usage flags high churn even above the score floor', () => {
    const borderline: TenantHealthSignals = {
      ...HEALTHY, billingStatus: 'overdue', daysSinceLastActivity: 9, activeDeviceCount: 0,
    };
    const r = scoreTenantHealth(borderline);
    expect(r.churnRisk).toBe('high');
  });
});
