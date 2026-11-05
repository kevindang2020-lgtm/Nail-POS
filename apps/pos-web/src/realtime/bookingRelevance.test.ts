import { describe, it, expect } from 'vitest';
import { bookingChangeScope, bookingChangesScope, bookingEventScope, widerScope, type BoardView } from './bookingRelevance';

// page 1 of a 200-technician board on Oct 25: technicians #1–#12 visible, two appointments drawn
const VISIBLE = Array.from({ length: 12 }, (_, i) => `tech-${i + 1}`);
const view: BoardView = { date: '2026-10-25', visibleTechnicianIds: VISIBLE, visibleAppointmentIds: ['appt-on-1', 'appt-on-5'] };
const env = (data: Record<string, unknown>) => ({ eventId: 'e1', eventType: 'appointment_created', updatedAt: '2026-10-24T10:00:00Z', data });

describe('bookingChangeScope — §22 off-screen changes never reload the grid', () => {
  it('technician #150 on the board date → partial (list / counts only)', () => {
    expect(bookingChangeScope(env({ appointmentId: 'x', technicianId: 'tech-150', date: '2026-10-25' }), view)).toBe('partial');
  });
  it('a visible technician → full', () => {
    expect(bookingChangeScope(env({ appointmentId: 'x', technicianId: 'tech-5', date: '2026-10-25' }), view)).toBe('full');
  });
  it('another date → skip, whoever the technician is', () => {
    expect(bookingChangeScope(env({ appointmentId: 'x', technicianId: 'tech-5', date: '2026-10-26' }), view)).toBe('skip');
  });
  it('an appointment the grid is drawing now → full even when it moved to an off-screen technician', () => {
    expect(bookingChangeScope(env({ appointmentId: 'appt-on-1', technicianId: 'tech-150', date: '2026-10-25' }), view)).toBe('full');
  });
  it('first available (technicianId null) → full', () => {
    expect(bookingChangeScope(env({ appointmentId: 'x', technicianId: null, date: '2026-10-25' }), view)).toBe('full');
  });
  it('an event that does not say which technician → full (never guess)', () => {
    expect(bookingChangeScope(env({ appointmentId: 'x' }), view)).toBe('full');
    expect(bookingChangeScope(undefined, view)).toBe('full');
  });
  it('a move between two off-screen technicians → partial; one of them visible → full', () => {
    expect(bookingChangeScope(env({ appointmentId: 'x', technicianIds: ['tech-150', 'tech-151'] }), view)).toBe('partial');
    expect(bookingChangeScope(env({ appointmentId: 'x', technicianIds: ['tech-150', 'tech-3'] }), view)).toBe('full');
    expect(bookingChangeScope(env({ appointmentId: 'x', technicianIds: ['tech-150', null] }), view)).toBe('full');
  });
  it('a schedule change for an off-screen technician (no date) → partial', () => {
    expect(bookingChangeScope(env({ technicianId: 'tech-150', version: 3 }), view)).toBe('partial');
  });
  it('reads a change-feed row (no envelope) the same way', () => {
    expect(bookingChangeScope({ appointmentId: 'x', technicianId: 'tech-150', date: '2026-10-25' }, view)).toBe('partial');
    expect(bookingChangeScope({ appointmentId: 'x', date: '2026-10-25' }, view)).toBe('full');   // unassigned row: the unassigned column
  });
  it('the board has no date yet (first load) → the date rule does not apply', () => {
    expect(bookingChangeScope(env({ appointmentId: 'x', technicianId: 'tech-150', date: '2026-10-26' }), { date: null, visibleTechnicianIds: VISIBLE })).toBe('partial');
  });
});

describe('bookingChangesScope / widerScope — a burst refreshes as much as its widest change', () => {
  it('nothing changed → skip; off-screen only → partial; one visible → full', () => {
    expect(bookingChangesScope([], view)).toBe('skip');
    expect(bookingChangesScope([{ appointmentId: 'a', technicianId: 'tech-150', date: '2026-10-25' }, { appointmentId: 'b', technicianId: 'tech-99', date: '2026-10-26' }], view)).toBe('partial');
    expect(bookingChangesScope([{ appointmentId: 'a', technicianId: 'tech-150', date: '2026-10-25' }, { appointmentId: 'b', technicianId: 'tech-2', date: '2026-10-25' }], view)).toBe('full');
  });
  it('widerScope orders skip < partial < full', () => {
    expect(widerScope(null, 'skip')).toBe('skip');
    expect(widerScope('partial', 'skip')).toBe('partial');
    expect(widerScope('partial', 'full')).toBe('full');
    expect(widerScope('full', 'partial')).toBe('full');
  });
});

describe('bookingEventScope — queue changes', () => {
  it('a walk-in queue change (no appointment) → partial (waitlist + counts only)', () => {
    expect(bookingEventScope('queue_updated', env({ queueItemId: 'q1' }), view)).toBe('partial');
  });
  it('a queue change for an appointment → by that appointment (drawn → full)', () => {
    expect(bookingEventScope('queue_updated', env({ appointmentId: 'appt-on-5' }), view)).toBe('full');
    expect(bookingEventScope('queue_updated', env({ appointmentId: 'x' }), view)).toBe('full');   // names no technician
  });
  it('other events → bookingChangeScope', () => {
    expect(bookingEventScope('appointment_created', env({ appointmentId: 'x', technicianId: 'tech-150', date: '2026-10-25' }), view)).toBe('partial');
  });
});
