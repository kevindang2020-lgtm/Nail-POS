import { describe, it, expect } from 'vitest';
import { deadlineState, daysRemaining, hoursRemaining, inBucket, reminderDue, type DeadlineInput } from './deadline-core';

const now = new Date('2026-05-06T12:00:00Z').getTime();
const H = 3600000, D = 86400000;
const inp = (o: Partial<DeadlineInput>): DeadlineInput => ({ dueBy: new Date(now + 3 * D).toISOString(), status: 'open', submitted: false, ...o });

describe('deadlineState', () => {
  it('classifies future windows by hours/days remaining', () => {
    expect(deadlineState(inp({ dueBy: new Date(now + 10 * D).toISOString() }), now)).toBe('more_than_7_days');
    expect(deadlineState(inp({ dueBy: new Date(now + 5 * D).toISOString() }), now)).toBe('approaching');
    expect(deadlineState(inp({ dueBy: new Date(now + 36 * H).toISOString() }), now)).toBe('due_soon');
    expect(deadlineState(inp({ dueBy: new Date(now + 6 * H).toISOString() }), now)).toBe('due_today');
    expect(deadlineState(inp({ dueBy: new Date(now - 2 * H).toISOString() }), now)).toBe('overdue');
  });
  it('returns submitted/closed based on status regardless of the clock', () => {
    expect(deadlineState(inp({ status: 'submitted' }), now)).toBe('submitted');
    expect(deadlineState(inp({ submitted: true, status: 'open' }), now)).toBe('submitted');
    expect(deadlineState(inp({ status: 'won' }), now)).toBe('closed');
    expect(deadlineState(inp({ status: 'lost' }), now)).toBe('closed');
  });
  it('returns unknown when there is no deadline', () => {
    expect(deadlineState(inp({ dueBy: null }), now)).toBe('unknown');
  });
});

describe('daysRemaining / hoursRemaining', () => {
  it('computes remaining time (negative when overdue, null when absent)', () => {
    expect(daysRemaining(new Date(now + 2 * D).toISOString(), now)).toBe(2);
    expect(daysRemaining(new Date(now - 1 * D).toISOString(), now)).toBeLessThan(0);
    expect(daysRemaining(null, now)).toBeNull();
    expect(hoursRemaining(new Date(now + 5 * H).toISOString(), now)).toBe(5);
  });
});

describe('inBucket', () => {
  it('matches inclusive hour/day windows for open, unsubmitted disputes', () => {
    expect(inBucket(inp({ dueBy: new Date(now + 12 * H).toISOString() }), 'due_today', now)).toBe(true);
    expect(inBucket(inp({ dueBy: new Date(now + 40 * H).toISOString() }), 'due_48h', now)).toBe(true);
    expect(inBucket(inp({ dueBy: new Date(now + 40 * H).toISOString() }), 'due_today', now)).toBe(false);
    expect(inBucket(inp({ dueBy: new Date(now - 5 * H).toISOString() }), 'overdue', now)).toBe(true);
  });
  it('excludes submitted and closed disputes from live deadline buckets', () => {
    expect(inBucket(inp({ status: 'submitted' }), 'due_7d', now)).toBe(false);
    expect(inBucket(inp({ status: 'won' }), 'due_7d', now)).toBe(false);
  });
});

describe('reminderDue', () => {
  it('is due inside the approaching window when not already sent', () => {
    expect(reminderDue(inp({ dueBy: new Date(now + 5 * D).toISOString() }), new Set(), now)).toBe('approaching');
    expect(reminderDue(inp({ dueBy: new Date(now - 1 * H).toISOString() }), new Set(), now)).toBe('overdue');
  });
  it('is not re-sent for a state already reminded (idempotent policy)', () => {
    expect(reminderDue(inp({ dueBy: new Date(now + 5 * D).toISOString() }), new Set(['approaching']), now)).toBeNull();
  });
  it('is not due for far-off, submitted, or closed disputes', () => {
    expect(reminderDue(inp({ dueBy: new Date(now + 10 * D).toISOString() }), new Set(), now)).toBeNull();
    expect(reminderDue(inp({ status: 'submitted' }), new Set(), now)).toBeNull();
    expect(reminderDue(inp({ status: 'won' }), new Set(), now)).toBeNull();
  });
});
