import { describe, it, expect } from 'vitest';
import { summarizeAlerts, canPause, validateLimits, type FlagLike } from './campaign-compliance-core';

describe('campaign-compliance engine', () => {
  it('summarizes open flags into alert categories and ignores resolved ones', () => {
    const flags: FlagLike[] = [
      { flagType: 'high_opt_out', status: 'open' }, { flagType: 'high_opt_out', status: 'reviewing' },
      { flagType: 'spam_complaints', status: 'open' },
      { flagType: 'awaiting_review', status: 'open' }, { flagType: 'awaiting_review', status: 'open' }, { flagType: 'awaiting_review', status: 'open' },
      { flagType: 'high_opt_out', status: 'cleared' }, // resolved → excluded
    ];
    const s = summarizeAlerts(flags);
    expect(s.totalFlagged).toBe(6);
    expect(s.allCompliant).toBe(false);
    expect(s.categories.find((c) => c.key === 'high_opt_out')!.count).toBe(2);
    expect(s.categories.find((c) => c.key === 'awaiting_review')!.count).toBe(3);
  });

  it('reports all-compliant when there are no open flags', () => {
    const s = summarizeAlerts([{ flagType: 'abusive', status: 'cleared' }]);
    expect(s.totalFlagged).toBe(0);
    expect(s.allCompliant).toBe(true);
    expect(s.categories).toHaveLength(0);
  });

  it('allows pausing only live/upcoming campaigns', () => {
    expect(canPause('in_progress')).toBe(true);
    expect(canPause('scheduled')).toBe(true);
    expect(canPause('completed')).toBe(false);
    expect(canPause('cancelled')).toBe(false);
  });

  it('validates limits (non-negative, hours 0-23)', () => {
    expect(validateLimits({ maxSendsPerDay: 1000, quietHoursStart: 21, quietHoursEnd: 8 }).errors).toHaveLength(0);
    expect(validateLimits({ maxSendsPerDay: -1 }).errors.some((e) => e.includes('Max sends'))).toBe(true);
    expect(validateLimits({ quietHoursStart: 25 }).errors.some((e) => e.includes('Quiet hours start'))).toBe(true);
  });
});
