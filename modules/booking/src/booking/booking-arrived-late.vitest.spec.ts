// booking-arrived-late.vitest.spec.ts — Functional Decision 38: ARRIVED is a real status (the customer is in the salon,
// not yet checked in) and LATE is computed from the salon's clock on every read — never stored, never cancels anything.
// Also: the board's "today" is the salon's day, not UTC's (it used to flip to tomorrow at 8 pm in New Jersey).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CHAIR_HOLDING_STATUSES, CHECK_IN_ELIGIBLE_STATUSES, AWAITING_ARRIVAL_STATUSES, APPOINTMENT_DISPLAY_STATUSES } from '@aipowersalon/api-contracts';
import { InMemoryBookingRepository } from './booking.repository';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { pbLateness, pbWithLateness, pbCanMarkArrived, pbCanCheckIn, pbDetectTechnicianConflict } from './booking.dto';
import { BookingService } from './booking.service';

const PERMS = ['pos.booking.view', 'pos.booking.create', 'pos.booking.edit', 'pos.booking.check_in', 'pos.queue.create'];
const ctx = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_fd', role: 'FRONT_DESK', permissions: PERMS } as any;
const TODAY = '2026-06-06';   // the in-memory repository's fixed day

describe('the shared status lists (Decision 38)', () => {
  it('include arrived where it matters, and LATE only as a display status', () => {
    expect(CHAIR_HOLDING_STATUSES).toContain('arrived');            // an arrived customer holds the chair
    expect(CHECK_IN_ELIGIBLE_STATUSES).toContain('arrived');
    expect(AWAITING_ARRIVAL_STATUSES).not.toContain('arrived');
    expect(APPOINTMENT_DISPLAY_STATUSES).toContain('late');
    expect(CHAIR_HOLDING_STATUSES).not.toContain('late');
  });
  it('an arrived appointment blocks a double booking of the same chair', () => {
    const existing = [{ appointmentId: 'a1', technicianId: 't1', startTime: '10:00', endTime: '11:00', status: 'arrived' as const }];
    expect(pbDetectTechnicianConflict(existing, 't1', '10:30', '11:15', 0).status).toBe('conflict');
  });
});

describe('pbLateness — LATE from the salon clock', () => {
  const at = (now: number, status: any = 'confirmed', date = TODAY) => pbLateness(date, '10:00', status, TODAY, now, 15);
  it('is not late before or exactly at the start time', () => {
    expect(at(9 * 60 + 59)).toEqual({ lateMinutes: null, lateness: null });
    expect(at(10 * 60)).toEqual({ lateMinutes: null, lateness: null });
  });
  it('is late within grace up to the grace minutes, then beyond grace', () => {
    expect(at(10 * 60 + 1)).toEqual({ lateMinutes: 1, lateness: 'late_within_grace' });
    expect(at(10 * 60 + 15)).toEqual({ lateMinutes: 15, lateness: 'late_within_grace' });
    expect(at(10 * 60 + 16)).toEqual({ lateMinutes: 16, lateness: 'late_beyond_grace' });
  });
  it('only a customer who has not arrived can be late', () => {
    for (const s of ['arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show']) expect(at(11 * 60, s).lateness).toBeNull();
    expect(at(11 * 60, 'booked').lateness).toBe('late_beyond_grace');
  });
  it('a past day still awaiting arrival is beyond grace; a future day never late', () => {
    expect(at(0, 'booked', '2026-06-05')).toEqual({ lateMinutes: null, lateness: 'late_beyond_grace' });
    expect(at(23 * 60, 'booked', '2026-06-07')).toEqual({ lateMinutes: null, lateness: null });
  });
  it('the row keeps its stored status; displayStatus says late', () => {
    const r = pbWithLateness({ date: TODAY, startTime: '10:00', status: 'confirmed' as const }, TODAY, 10 * 60 + 20, 15);
    expect(r).toMatchObject({ status: 'confirmed', displayStatus: 'late', lateMinutes: 20, lateness: 'late_beyond_grace' });
    expect(pbWithLateness({ date: TODAY, startTime: '10:00', status: 'arrived' as const }, TODAY, 10 * 60 + 20, 15).displayStatus).toBe('arrived');
  });
  it('allowed moves: arrived only from booked/confirmed; check-in also from arrived', () => {
    expect(pbCanMarkArrived('booked')).toBe(true); expect(pbCanMarkArrived('confirmed')).toBe(true);
    expect(pbCanMarkArrived('arrived')).toBe(false); expect(pbCanMarkArrived('checked_in')).toBe(false); expect(pbCanMarkArrived('cancelled')).toBe(false);
    expect(pbCanCheckIn('arrived')).toBe(true); expect(pbCanCheckIn('in_service')).toBe(false);
  });
});

describe('BookingService — Mark Arrived and the computed Late status', () => {
  const setup = () => { const repo = new InMemoryBookingRepository(); return { repo, svc: new BookingService(repo) }; };

  it('marks a booked customer arrived (stamped, audited); then check-in works; a second Arrived is refused', async () => {
    const { svc } = setup();
    const r = await svc.markArrived(ctx, 'bk_5101');            // seeded 'booked' at 10:00
    expect(r.status).toBe('arrived');
    expect(r.arrivedAt).toBeTruthy();
    await expect(svc.markArrived(ctx, 'bk_5101')).rejects.toThrow(/already marked arrived/);
    expect((await svc.checkIn(ctx, 'bk_5101')).status).toBe('checked_in');
  });

  it('cannot mark arrived once in service, cancelled or without the check-in permission', async () => {
    const { svc } = setup();
    await expect(svc.markArrived(ctx, 'bk_5102')).rejects.toThrow(/booked or confirmed/);      // in_service
    await expect(svc.markArrived({ ...ctx, permissions: ['pos.booking.view'] }, 'bk_5103')).rejects.toThrow();
  });

  it('a late customer shows as LATE on the board, can be filtered, counted, and still marked arrived', async () => {
    const { repo, svc } = setup();
    repo.nowMinuteOverride = 10 * 60 + 25;                      // 10:25 — bk_5101 (booked 10:00) is 25 min late
    const st = await svc.getState(ctx, { date: TODAY } as any);
    const row = st.bookings.items.find((a) => a.appointmentId === 'bk_5101')!;
    expect(row).toMatchObject({ status: 'booked', displayStatus: 'late', lateMinutes: 25, lateness: 'late_beyond_grace' });
    expect(st.bookings.items.find((a) => a.appointmentId === 'bk_5103')!.displayStatus).toBe('confirmed');   // 11:00, not yet
    expect(st.kpis.lateBookings).toBe(1);
    expect(st.filters.statuses).toEqual(expect.arrayContaining(['arrived', 'late']));
    const late = await svc.getState(ctx, { date: TODAY, status: 'late' } as any);
    expect(late.bookings.items.map((a) => a.appointmentId)).toEqual(['bk_5101']);
    const arrived = await svc.markArrived(ctx, 'bk_5101');
    expect(arrived.displayStatus).toBe('arrived');               // no longer late once here
    expect((await svc.getState(ctx, { date: TODAY } as any)).kpis).toMatchObject({ lateBookings: 0, arrivedBookings: 1 });
  });

  it('moving an arrived booking to the queue checks it in', async () => {
    const { repo, svc } = setup();
    await svc.markArrived(ctx, 'bk_5105');
    await svc.moveToQueue(ctx, 'bk_5105');
    expect((await repo.booking(ctx, 'bk_5105'))!.status).toBe('checked_in');
  });
});

describe("the board's day is the salon's day, not UTC's", () => {
  afterEach(() => vi.useRealTimers());
  it('at 8:30 pm EDT (00:30 UTC next day) today is still the salon\'s date and the minute is 20:30', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T00:30:00.000Z'));
    const repo = new KyselyBookingRepository({} as any);
    expect(repo.today()).toBe('2026-10-01');
    expect(repo.nowMinuteOfDay()).toBe(20 * 60 + 30);
  });
});
