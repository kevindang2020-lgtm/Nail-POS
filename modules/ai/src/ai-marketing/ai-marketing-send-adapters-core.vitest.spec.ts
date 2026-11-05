// ai-marketing-send-adapters-core.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { toLimitDecision, isWithinQuietWindow, hhmmToMinutes, dueForSend } from './ai-marketing-send-adapters-core';

describe('toLimitDecision', () => {
  it('blocks only on a hard block', () => {
    expect(toLimitDecision({ action: 'block' }).action).toBe('block');
    expect(toLimitDecision({ action: 'allow' }).action).toBe('allow');
    expect(toLimitDecision({ action: 'warn' }).action).toBe('allow');
    expect(toLimitDecision({ action: 'require_approval' }).action).toBe('allow');
  });
});

describe('isWithinQuietWindow', () => {
  it('handles same-day windows', () => {
    expect(isWithinQuietWindow(9 * 60, 8 * 60, 17 * 60)).toBe(true);
    expect(isWithinQuietWindow(7 * 60, 8 * 60, 17 * 60)).toBe(false);
    expect(isWithinQuietWindow(17 * 60, 8 * 60, 17 * 60)).toBe(false); // end exclusive
  });
  it('handles overnight windows (21:00→08:00)', () => {
    expect(isWithinQuietWindow(23 * 60, 21 * 60, 8 * 60)).toBe(true);
    expect(isWithinQuietWindow(3 * 60, 21 * 60, 8 * 60)).toBe(true);
    expect(isWithinQuietWindow(12 * 60, 21 * 60, 8 * 60)).toBe(false);
  });
  it('treats a missing/zero window as never active', () => {
    expect(isWithinQuietWindow(600, null, 480)).toBe(false);
    expect(isWithinQuietWindow(600, 480, 480)).toBe(false);
  });
});

describe('hhmmToMinutes', () => {
  it('parses valid times and rejects junk', () => {
    expect(hhmmToMinutes('21:00')).toBe(1260);
    expect(hhmmToMinutes('08:30:00')).toBe(510);
    expect(hhmmToMinutes('99:99')).toBeNull();
    expect(hhmmToMinutes('')).toBeNull();
    expect(hhmmToMinutes(null)).toBeNull();
  });
});

describe('dueForSend', () => {
  const now = '2026-07-07T12:00:00Z';
  it('is due only for a scheduled campaign whose time has arrived', () => {
    expect(dueForSend('scheduled', '2026-07-07T11:00:00Z', now)).toBe(true);
    expect(dueForSend('scheduled', '2026-07-07T13:00:00Z', now)).toBe(false);
    expect(dueForSend('draft', '2026-07-07T11:00:00Z', now)).toBe(false);
    expect(dueForSend('scheduled', null, now)).toBe(false);
  });
});
