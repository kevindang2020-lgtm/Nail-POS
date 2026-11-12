import { describe, it, expect } from 'vitest';
import { presenceBadge, scheduleHealth, type BoardCol } from './liveScheduleChecks';

const shift = { startTime: '09:00', endTime: '17:00' };
describe('presenceBadge — planned shift vs physical clock', () => {
  it('scheduled + clocked in is on shift; on break is its own label', () => {
    expect(presenceBadge({ technicianId: 'a', fullName: 'A', shift, shiftScheduled: true, clock: 'clocked_in' }, true, 600)?.code).toBe('on_shift_in');
    expect(presenceBadge({ technicianId: 'a', fullName: 'A', shift, shiftScheduled: true, clock: 'on_break' }, true, 600)?.code).toBe('on_shift_break');
  });
  it('scheduled but not clocked in: expected (bad) once the shift started, "later" before, over after', () => {
    const c: BoardCol = { technicianId: 'a', fullName: 'A', shift, shiftScheduled: true, clock: 'clocked_out' };
    expect(presenceBadge(c, true, 600)).toEqual({ code: 'expected_not_in', tone: 'bad' });
    expect(presenceBadge(c, true, 480)?.code).toBe('scheduled_later');
    expect(presenceBadge(c, true, 17 * 60)?.code).toBe('shift_over_out');
  });
  it('a punch drawn as a shift is not a scheduled shift', () => {
    expect(presenceBadge({ technicianId: 'a', fullName: 'A', shift, shiftScheduled: false, clock: 'clocked_in' }, true, 600)?.code).toBe('in_no_shift');
    expect(presenceBadge({ technicianId: 'a', fullName: 'A', shift: null, clock: 'clocked_out' }, true, 600)?.code).toBe('off');
  });
  it('no clock record is unknown, never clocked out; a past/future day shows no presence', () => {
    expect(presenceBadge({ technicianId: 'a', fullName: 'A', shift, shiftScheduled: true, clock: null }, true, 600)?.code).toBe('clock_unknown');
    expect(presenceBadge({ technicianId: 'a', fullName: 'A', shift, shiftScheduled: true }, true, 600)?.code).toBe('clock_unknown');
    expect(presenceBadge({ technicianId: 'a', fullName: 'A', shift, shiftScheduled: true, clock: 'clocked_in' }, false, 600)).toBeNull();
  });
});

describe('scheduleHealth — read-only checks over the board', () => {
  const cols: BoardCol[] = [
    { technicianId: 'a', fullName: 'Linh', shift, shiftScheduled: true, blocks: [{ blockId: 'b1', startTime: '15:30', endTime: '16:00' }],
      appointments: [{ appointmentId: '1', startTime: '10:00', endTime: '11:00', status: 'confirmed' }, { appointmentId: '2', startTime: '10:30', endTime: '11:30', status: 'confirmed' },
        { appointmentId: '3', startTime: '16:30', endTime: '17:30', status: 'confirmed' }, { appointmentId: '4', startTime: '15:00', endTime: '16:00', status: 'confirmed' },
        { appointmentId: '5', startTime: '12:00', endTime: '13:00', status: 'cancelled' }] },
    { technicianId: 'b', fullName: 'Mai', shift: { startTime: '09:00', endTime: '19:00' }, shiftScheduled: false, appointments: [{ appointmentId: '6', customerName: 'Hoa', startTime: '13:00', endTime: '14:00', status: 'assigned' }] },
  ];
  const by = (r: ReturnType<typeof scheduleHealth>) => Object.fromEntries(r.map((c) => [c.code, c]));
  it('finds a double booking, an appointment past the shift end, one with no scheduled shift and blocked time over an appointment', () => {
    const r = by(scheduleHealth({ cols, ageMinutes: 1, live: true, kpis: { appointments: 5 }, wholeRoster: true }));
    expect(r.conflicts.findings).toEqual([{ technician: 'Linh', detail: '10:00–11:00 × 10:30–11:30' }]);
    expect(r.outside_shift.findings).toEqual([{ technician: 'Linh', detail: '16:30–17:30 / 09:00–17:00' }]);
    expect(r.no_shift.findings).toEqual([{ technician: 'Mai', detail: '13:00–14:00 · Hoa' }]);
    expect(r.blocked_over_appt.findings).toEqual([{ technician: 'Linh', detail: '15:30–16:00 × 15:00–16:00' }]);
    expect(r.stale.state).toBe('pass');
    expect(r.kpi_wiring).toMatchObject({ state: 'pass' });   // 5 live appointments (the cancelled one is not counted)
  });
  it('KPI row that disagrees with the whole board is flagged; a paged/filtered board is not compared', () => {
    expect(by(scheduleHealth({ cols, ageMinutes: 1, live: true, kpis: { appointments: 7 }, wholeRoster: true })).kpi_wiring).toMatchObject({ state: 'warn', findings: [{ detail: '7 / 5' }] });
    expect(by(scheduleHealth({ cols, ageMinutes: 1, live: true, kpis: { appointments: 7 }, wholeRoster: false })).kpi_wiring).toMatchObject({ state: 'not_checked', reason: 'paged' });
  });
  it('stale read on today warns; a past day is not checked for freshness; a clean board passes everything', () => {
    expect(by(scheduleHealth({ cols: [], ageMinutes: 12, live: true, kpis: null, wholeRoster: true })).stale.state).toBe('warn');
    expect(by(scheduleHealth({ cols: [], ageMinutes: 12, live: false, kpis: null, wholeRoster: true })).stale).toMatchObject({ state: 'not_checked', reason: 'not_live' });
    const clean = scheduleHealth({ cols: [{ technicianId: 'a', fullName: 'A', shift, shiftScheduled: true, appointments: [{ appointmentId: '1', startTime: '10:00', endTime: '11:00', status: 'confirmed' }] }], ageMinutes: 0, live: true, kpis: { appointments: 1 }, wholeRoster: true });
    expect(clean.every((c) => c.state === 'pass')).toBe(true);
  });
});
