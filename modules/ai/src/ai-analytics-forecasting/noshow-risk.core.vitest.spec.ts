// noshow-risk.core.vitest.spec.ts — transparent risk scoring.
import { describe, it, expect } from 'vitest';
import { scoreNoShowRisk, type RiskFeatures } from './noshow-risk.core';

const f = (o: Partial<RiskFeatures>): RiskFeatures => ({
  totalPriorAppointments: 10, priorNoShows: 0, priorLateCancellations: 0,
  bookingLeadTimeDays: 3, confirmationRequired: true, confirmed: true,
  depositOnFile: true, reminderRecentlyDelivered: true, groupSize: 1, ...o,
});

describe('scoreNoShowRisk', () => {
  it('reliable confirmed customer with deposit → low risk', () => {
    const r = scoreNoShowRisk(f({}));
    expect(r.level).toBe('low');
    expect(r.reasons.some((x) => x.code === 'reliable_history')).toBe(true);
  });

  it('prior no-shows drive risk up with a reason code', () => {
    const r = scoreNoShowRisk(f({ priorNoShows: 4, totalPriorAppointments: 8, confirmed: false, depositOnFile: false }));
    expect(['high', 'very_high']).toContain(r.level);
    expect(r.reasons.some((x) => x.code === 'prior_no_shows' && x.direction === 'raises')).toBe(true);
  });

  it('unconfirmed + no deposit + long lead raises risk', () => {
    const r = scoreNoShowRisk(f({ confirmed: false, depositOnFile: false, bookingLeadTimeDays: 30, priorNoShows: 0, totalPriorAppointments: 5 }));
    expect(r.reasons.map((x) => x.code)).toEqual(expect.arrayContaining(['not_confirmed', 'no_deposit', 'long_lead_time']));
    expect(r.score).toBeGreaterThan(0.2);
  });

  it('a brand-new customer with no signals is insufficient_data, not high risk', () => {
    const r = scoreNoShowRisk(f({ totalPriorAppointments: 0, priorNoShows: 0, confirmationRequired: false, confirmed: false, depositOnFile: null, bookingLeadTimeDays: 2, reminderRecentlyDelivered: null }));
    expect(r.level).toBe('insufficient_data');
    expect(r.confidence).toBe('insufficient_data');
  });

  it('never recommends a punitive action — only permitted ones', () => {
    for (const over of [{}, { priorNoShows: 5, totalPriorAppointments: 5, confirmed: false, depositOnFile: false, bookingLeadTimeDays: 40 }]) {
      const r = scoreNoShowRisk(f(over as any));
      const joined = r.permittedActions.join(' ').toLowerCase();
      expect(joined).not.toMatch(/cancel|block|penal|charge|raise deposit|ban/);
    }
  });

  it('score stays within [0,1] and confidence scales with history', () => {
    expect(scoreNoShowRisk(f({ priorNoShows: 99, totalPriorAppointments: 99 })).score).toBeLessThanOrEqual(1);
    expect(scoreNoShowRisk(f({ totalPriorAppointments: 10 })).confidence).toBe('high');
    expect(scoreNoShowRisk(f({ totalPriorAppointments: 4 })).confidence).toBe('moderate');
  });
});
