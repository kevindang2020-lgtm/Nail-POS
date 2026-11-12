import { describe, it, expect } from 'vitest';
import { explainSlot } from './slotExplain';

const day = {
  hours: { open: '09:00', close: '19:00' },
  technicians: [
    { id: 't1', workingToday: true, windows: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      blocked: [{ blockId: 'b1', startTime: '12:00', endTime: '13:00', reason: 'lunch' }, { blockId: 'time-off:9', startTime: '16:00', endTime: '17:00', reason: 'vacation' }] },
    { id: 't2', workingToday: false, windows: [], blocked: [] },
  ],
  appointments: [
    { id: 'a1', technicianId: 't1', start: '10:00', end: '10:45', status: 'confirmed' },
    { id: 'a2', technicianId: 't1', start: '14:00', end: '14:45', status: 'cancelled' },   // cancelled frees the chair
  ],
  holds: [{ id: 'h1', technicianId: 't1', start: '15:00', end: '15:30', pendingVerification: true }],
};

describe('AI Calendar #05 conflict explanation (pure, read-only)', () => {
  it('an open time is bookable with no reasons', () => {
    expect(explainSlot(day, 't1', '09:00', 45)).toEqual({ bookable: true, start: '09:00', end: '09:45', reasons: [] });
    expect(explainSlot(day, 't1', '14:00', 45)?.bookable).toBe(true);                 // only a cancelled appointment there
  });
  it('names the appointment, the hold (waiting for a code), the blocked time and approved time off', () => {
    expect(explainSlot(day, 't1', '10:30', 30)?.reasons).toEqual([{ code: 'APPOINTMENT', start: '10:00', end: '10:45', status: 'confirmed', ref: 'a1' }]);
    expect(explainSlot(day, 't1', '15:15', 30)?.reasons).toEqual([{ code: 'HOLD', start: '15:00', end: '15:30', ref: 'h1', pendingCode: true }]);
    expect(explainSlot(day, 't1', '11:30', 60)?.reasons).toEqual([{ code: 'BLOCKED', start: '12:00', end: '13:00', reason: 'lunch' }]);   // not also "outside shift"
    expect(explainSlot(day, 't1', '16:15', 30)?.reasons.map((r) => r.code)).toEqual(['TIME_OFF']);
  });
  it('salon hours, outside the shift and a day off', () => {
    expect(explainSlot(day, 't1', '18:45', 45)?.reasons.map((r) => r.code)).toEqual(['OUTSIDE_HOURS', 'OUTSIDE_SHIFT']);
    expect(explainSlot(day, 't1', '17:15', 30)?.reasons).toEqual([{ code: 'OUTSIDE_SHIFT', reason: '09:00–12:00, 13:00–17:00' }]);
    expect(explainSlot(day, 't2', '10:00', 30)?.reasons).toEqual([{ code: 'OFF_TODAY' }]);
  });
  it('an unknown technician or an unreadable time explains nothing (no guess)', () => {
    expect(explainSlot(day, 'nope', '10:00', 30)).toBeNull();
    expect(explainSlot(day, 't1', '', 30)).toBeNull();
    expect(explainSlot(day, 't1', '10:00', 0)).toBeNull();
  });
});
