import { describe, it, expect } from 'vitest';
import { bucketOf, stepIndex, apptWhen, money2 } from './appt';

describe('appt mappers', () => {
  it('buckets statuses into upcoming / past / cancelled', () => {
    expect(bucketOf('confirmed')).toBe('upcoming');
    expect(bucketOf('serving')).toBe('upcoming');
    expect(bucketOf('completed')).toBe('past');
    expect(bucketOf('paid')).toBe('past');
    expect(bucketOf('cancelled')).toBe('cancelled');
    expect(bucketOf('no_show')).toBe('cancelled');
  });
  it('maps backend status to the live-progress step', () => {
    expect(stepIndex('confirmed')).toBe(-1);   // not checked in → no live hero
    expect(stepIndex('checked_in')).toBe(0);
    expect(stepIndex('serving')).toBe(1);
    expect(stepIndex('nearly_finished')).toBe(2);
    expect(stepIndex('completed')).toBe(3);
  });
  it('formats money and times', () => {
    expect(money2(4500)).toBe('$45.00');
    expect(apptWhen('')).toBe('');
    const now = new Date();
    const formatted = apptWhen(now.toISOString());
    expect(formatted).toContain('Today');
  });
});
