import { describe, it, expect } from 'vitest';
import { buildAssignmentSourceMix } from './tech-queue.dto';

describe('tech-queue assignment source mix', () => {
  it('buckets canonical sources and reconciles to total', () => {
    const r = buildAssignmentSourceMix([
      { source: 'appointment' }, { source: 'appointment' }, { source: 'walk_in' }, { source: 'ai' }, { source: 'manual' },
    ]);
    expect(r.total).toBe(5);
    expect(r.slices.find((s) => s.source === 'Appointments')).toMatchObject({ count: 2, percent: 40 });
    expect(r.slices.find((s) => s.source === 'AI Assignment')).toMatchObject({ count: 1, percent: 20 });
    // order: Appointments, Walk-ins, AI Assignment, Manual Front Desk
    expect(r.slices.map((s) => s.source)).toEqual(['Appointments', 'Walk-ins', 'AI Assignment', 'Manual Front Desk']);
    // Vietnamese POS §21: each slice also carries its canonical code (the POS words it in the user's language)
    expect(r.slices.map((s) => s.code)).toEqual(['appointment', 'walk_in', 'ai', 'manual']);
  });
  it('treats online/google as appointments and defaults unknown to manual', () => {
    const r = buildAssignmentSourceMix([{ source: 'online' }, { source: 'google' }, { source: undefined as any }]);
    expect(r.slices.find((s) => s.source === 'Appointments')?.count).toBe(2);
    expect(r.slices.find((s) => s.source === 'Manual Front Desk')?.count).toBe(1);
  });
});

import { deriveFinishingSoon } from './tech-queue.dto';
describe('deriveFinishingSoon (canonical near-completion)', () => {
  const now = 1_700_000_000_000; const min = (m: number) => now - m * 60000;
  it('is false with no start or no expected duration', () => {
    expect(deriveFinishingSoon(null, 60, now)).toBe(false);
    expect(deriveFinishingSoon(min(50), 0, now)).toBe(false);
  });
  it('is false early in the service', () => {
    expect(deriveFinishingSoon(min(10), 60, now)).toBe(false); // 50 min remaining
  });
  it('is true within the final threshold window', () => {
    expect(deriveFinishingSoon(min(52), 60, now)).toBe(true);  // 8 min remaining
    expect(deriveFinishingSoon(min(60), 60, now)).toBe(true);  // 0 min remaining
  });
  it('respects a custom threshold', () => {
    expect(deriveFinishingSoon(min(45), 60, now, 5)).toBe(false); // 15 left > 5
    expect(deriveFinishingSoon(min(56), 60, now, 5)).toBe(true);  // 4 left <= 5
  });
  it('stops flagging once well overdue', () => {
    expect(deriveFinishingSoon(min(95), 60, now, 10)).toBe(false); // 35 over
  });
});

import { computeUtilizationTrend, hourOverlapMinutes } from './tech-queue.dto';
describe('utilization trend (hourly, query-time)', () => {
  const H = (h: number) => ({ hour: h, startMs: Date.UTC(2026, 4, 6, h), endMs: Date.UTC(2026, 4, 6, h + 1) });
  it('hourOverlapMinutes clips to the window', () => {
    expect(hourOverlapMinutes(Date.UTC(2026,4,6,9,30), Date.UTC(2026,4,6,10,30), Date.UTC(2026,4,6,9), Date.UTC(2026,4,6,10))).toBe(30);
    expect(hourOverlapMinutes(Date.UTC(2026,4,6,11), Date.UTC(2026,4,6,12), Date.UTC(2026,4,6,9), Date.UTC(2026,4,6,10))).toBe(0);
  });
  it('one tech serving the full hour against one full shift = 100%', () => {
    const sessions = [{ startMs: Date.UTC(2026,4,6,9), endMs: Date.UTC(2026,4,6,10) }];
    const shifts = [{ startMs: Date.UTC(2026,4,6,8), endMs: Date.UTC(2026,4,6,17) }];
    const t = computeUtilizationTrend(sessions, shifts, [H(9)]);
    expect(t[0]).toMatchObject({ hour: 9, utilizationPercent: 100, servicesInProgress: 1 });
  });
  it('half-busy hour = 50%; no shift coverage = 0%', () => {
    const sessions = [{ startMs: Date.UTC(2026,4,6,9), endMs: Date.UTC(2026,4,6,9,30) }];
    const shifts = [{ startMs: Date.UTC(2026,4,6,9), endMs: Date.UTC(2026,4,6,10) }];
    expect(computeUtilizationTrend(sessions, shifts, [H(9)])[0].utilizationPercent).toBe(50);
    expect(computeUtilizationTrend(sessions, [], [H(9)])[0].utilizationPercent).toBe(0);
  });
  it('two techs each serving half the hour against two shifts = 50%', () => {
    const sessions = [{ startMs: Date.UTC(2026,4,6,9), endMs: Date.UTC(2026,4,6,9,30) }, { startMs: Date.UTC(2026,4,6,9,30), endMs: Date.UTC(2026,4,6,10) }];
    const shifts = [{ startMs: Date.UTC(2026,4,6,8), endMs: Date.UTC(2026,4,6,17) }, { startMs: Date.UTC(2026,4,6,8), endMs: Date.UTC(2026,4,6,17) }];
    expect(computeUtilizationTrend(sessions, shifts, [H(9)])[0].utilizationPercent).toBe(50);
  });
});
