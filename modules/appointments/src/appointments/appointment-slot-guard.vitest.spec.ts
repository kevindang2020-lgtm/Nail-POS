// appointment-slot-guard.vitest.spec — merge Oct 12 2026. The parts of the guard a single-session database cannot exercise:
//   • the EXCLUDE refusal (SQLSTATE 23P01) only fires when a transaction-pooling proxy defeats the advisory lock, so the
//     mapping 23P01 → AppointmentSlotConflict is pinned here with a transaction stand-in whose write throws it;
//   • the pure conflict detector (half-open ranges, the salon buffer, chair-holding statuses only, the row's own id ignored).
import { describe, it, expect } from 'vitest';
import { writeAppointmentSlot, detectSlotConflict, isOverlapViolation, overbookColumns, techDayLockKey, AppointmentSlotConflict } from './appointment-slot-guard';

const dbWhoseWriteThrows = (err: unknown): any => ({ transaction: () => ({ execute: async (fn: (trx: any) => Promise<unknown>) => fn({ /* no technician → no lock / re-read */ }) }) , _err: err });

describe('23P01 is the database refusing a double booking, never a 500', () => {
  it('maps the exclusion violation to AppointmentSlotConflict (code APPOINTMENT_CONFLICT)', async () => {
    const e: any = new Error('conflicting key value violates exclusion constraint "pos_tech_appointments_no_overlap"'); e.code = '23P01';
    await expect(writeAppointmentSlot(dbWhoseWriteThrows(e), { tenantId: 't', technicianId: null, date: '2999-01-01', startTime: '10:00', endTime: '11:00', write: async () => { throw e; } }))
      .rejects.toBeInstanceOf(AppointmentSlotConflict);
    expect(isOverlapViolation(e)).toBe(true);
    expect(isOverlapViolation(new Error('pos_tech_appointments_no_overlap'))).toBe(true);
    expect(isOverlapViolation({ code: '23505' })).toBe(false);
  });
  it('any other failure of the write is re-thrown untouched', async () => {
    const e: any = new Error('connection terminated'); e.code = '57P01';
    await expect(writeAppointmentSlot(dbWhoseWriteThrows(e), { tenantId: 't', technicianId: null, date: '2999-01-01', startTime: '10:00', endTime: '11:00', write: async () => { throw e; } }))
      .rejects.toThrow('connection terminated');
  });
});

describe('detectSlotConflict (the in-transaction re-check)', () => {
  const rows = [
    { id: 'a', technician_id: 'mia', start_time: '10:00', end_time: '11:00', status: 'booked' },
    { id: 'b', technician_id: 'mia', start_time: '13:00', end_time: '14:00', status: 'cancelled' },
    { id: 'c', technician_id: 'leo', start_time: '10:00', end_time: '11:00', status: 'in_service' },
  ];
  it('half-open: back-to-back is not a conflict; any overlap is', () => {
    expect(detectSlotConflict(rows, 'mia', '11:00', '12:00', 0).status).toBe('none');
    expect(detectSlotConflict(rows, 'mia', '10:30', '11:30', 0)).toEqual({ status: 'conflict', conflictingAppointmentId: 'a' });
  });
  it('the salon buffer widens the window; a cancelled row never blocks; the row being moved is ignored; other technicians do not count', () => {
    expect(detectSlotConflict(rows, 'mia', '11:00', '12:00', 15).status).toBe('conflict');
    expect(detectSlotConflict(rows, 'mia', '13:00', '14:00', 0).status).toBe('none');
    expect(detectSlotConflict(rows, 'mia', '10:00', '11:00', 0, 'a').status).toBe('none');
    expect(detectSlotConflict(rows, 'zoe', '10:00', '11:00', 0).status).toBe('none');
  });
  it('helpers: the lock key matches the booking / customer-booking repositories; overbook columns are written or cleared', () => {
    expect(techDayLockKey('t', 'mia', '2999-01-01')).toBe('t|mia|2999-01-01');
    expect(overbookColumns({ overlaps: true, conflictingAppointmentId: 'a' }, 'manager_override', 'u1')).toEqual({ overbook_ok: true, overbook_reason: 'manager_override', overbook_by_user_id: 'u1' });
    expect(overbookColumns({ overlaps: false }, 'manager_override', 'u1')).toEqual({ overbook_ok: false, overbook_reason: null, overbook_by_user_id: null });
  });
});
