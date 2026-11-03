import { describe, it, expect } from 'vitest';
import { deviceToday } from './deviceToday';
describe('deviceToday', () => {
  it('is the local calendar day, not the UTC day', () => {
    const d = new Date(2026, 10, 3, 21, 30);   // 9:30 PM local on Nov 3
    expect(deviceToday(d)).toBe('2026-11-03');
  });
});
