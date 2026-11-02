// slo-core.vitest.spec — Constitution 11 §80–83, §106.
import { describe, it, expect } from 'vitest';
import { SLOS, budget, burnRate, burnAlert, report, BURN } from './slo-core';
import { WORKFLOW_ROUTES } from './sli';

const w = (total: number, bad: number) => ({ total, bad });

describe('§80–81 the definitions', () => {
  it('§80: EVERY target is labelled proposed — none may be presented as measured until validated in review', () => {
    for (const s of SLOS) expect(s.status, s.id).toBe('proposed');
  });
  it('§81: each names its SLI scope, target, window, what counts, what is excluded, and an owner', () => {
    for (const s of SLOS) {
      expect(s.target, s.id).toBeGreaterThan(0); expect(s.target, s.id).toBeLessThan(1);
      expect(s.windowDays, s.id).toBe(30);
      expect(s.owner && s.counts && s.excludes, s.id).toBeTruthy();
      expect(s.routes === '*' || s.routes.length > 0, `${s.id} has no routes`).toBe(true);
    }
  });
  it('every route an SLO measures is a real SLI workflow route — a typo would measure nothing, forever', () => {
    for (const s of SLOS) if (s.routes !== '*') for (const r of s.routes) expect(WORKFLOW_ROUTES[r], `${s.id}: ${r}`).toBeTruthy();
  });
  it('§83: the phone-verification SLO counts Twilio outages — they are not excluded to keep it green', () => {
    expect(SLOS.find((s) => s.id === 'phone_verification')!.counts).toMatch(/INCLUDING Twilio outages/);
  });
  it('latency SLOs use a threshold that is an exact histogram bucket boundary (no interpolation)', () => {
    const BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    for (const s of SLOS.filter((x) => x.kind === 'latency')) expect(BOUNDS, s.id).toContain(s.thresholdMs);
  });
});

describe('§82 error budget', () => {
  it('99.5% over 10,000 requests allows 50 failures; 10 used leaves 80%', () => {
    const b = budget(w(10_000, 10), 0.995);
    expect(b.allowed).toBeCloseTo(50); expect(b.remaining).toBeCloseTo(0.8);
  });
  it('overspending goes negative — it is not clamped at 0, the overshoot matters', () => {
    expect(budget(w(10_000, 100), 0.995).remaining).toBeCloseTo(-1);
  });
  it('no traffic: no budget and no SLI — unknown, never "100% remaining" (§332)', () => {
    expect(budget(w(0, 0), 0.995)).toEqual({ allowed: null, remaining: null });
    expect(report(SLOS[0], { window: w(0, 0), h1: w(0, 0), m5: w(0, 0), h6: w(0, 0), m30: w(0, 0) }).sli).toBeNull();
  });
});

describe('§106 multi-window burn-rate alerts', () => {
  const T = 0.995;   // allowed error rate 0.5%
  it('burn rate 1 means exactly on target', () => expect(burnRate(w(1000, 5), T)).toBeCloseTo(1));
  it('PAGE when the last hour burns ≥ 14.4× AND the last 5 minutes still do — it is happening now', () => {
    expect(burnAlert({ h1: w(1000, 80), m5: w(100, 8), h6: w(6000, 80), m30: w(500, 8) }, T)).toBe('page');
  });
  it('a spike that has STOPPED does not page: hot hour, cold last 5 minutes', () => {
    expect(burnAlert({ h1: w(1000, 80), m5: w(100, 0), h6: w(6000, 80), m30: w(500, 0) }, T)).toBeNull();
  });
  it('TICKET for a slower burn: ≥ 6× over six hours and 30 minutes, below the page rate', () => {
    expect(burnAlert({ h1: w(1000, 40), m5: w(100, 4), h6: w(6000, 200), m30: w(500, 17) }, T)).toBe('ticket');
  });
  it(`needs ${BURN.minRequests} requests in the long window — one failure in three is not a budget emergency`, () => {
    expect(burnAlert({ h1: w(3, 1), m5: w(3, 1), h6: w(3, 1), m30: w(3, 1) }, T)).toBeNull();
  });
  it('a healthy service raises nothing', () => {
    expect(burnAlert({ h1: w(1000, 1), m5: w(100, 0), h6: w(6000, 5), m30: w(500, 0) }, T)).toBeNull();
  });
});
