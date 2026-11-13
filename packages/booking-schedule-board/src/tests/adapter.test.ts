import { beforeEach, describe, expect, it } from 'vitest';
import { MockBookingDataAdapter } from '../adapters/MockBookingDataAdapter';
import { ProductionBookingDataAdapter, type HttpClient } from '../adapters/ProductionBookingDataAdapter';
import { BookingDomainError } from '../domain/bookingErrors';
import { minuteOfDay, toISO } from '../domain/time';
import { buildFixture, FIXTURE_BRANCH, FIXTURE_DATE, FIXTURE_TENANT, FIXTURE_TZ, withForeignTenant } from '../fixtures/fixtures';
import { LocalScheduleEventHub, type ScheduleEventEnvelope } from '../realtime/events';

const scope = { tenantId: FIXTURE_TENANT, branchId: FIXTURE_BRANCH };
const at = (m: number) => toISO(FIXTURE_DATE, m, FIXTURE_TZ);
const min = (iso: string) => minuteOfDay(iso, FIXTURE_DATE, FIXTURE_TZ);
const NOW = () => new Date(at(9 * 60)); // fixed clock at 9:00 AM on the fixture day
let key = 0;
const idem = () => `idem-${++key}`;

let adapter: MockBookingDataAdapter;
beforeEach(() => {
  adapter = new MockBookingDataAdapter(withForeignTenant(buildFixture()), { now: NOW });
});

async function expectError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(BookingDomainError.is(e)).toBe(true);
    expect((e as BookingDomainError).code).toBe(code);
    return e as BookingDomainError;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

describe('MockBookingDataAdapter — authoritative backend behaviour', () => {
  it('loads one range for the whole branch (no per-technician requests) with computed availability', async () => {
    const r = await adapter.getScheduleRange({ ...scope, fromDate: FIXTURE_DATE, toDate: FIXTURE_DATE });
    expect(adapter.stats.scheduleRangeCalls).toBe(1);
    expect(r.technicians).toHaveLength(24);
    expect(Object.keys(r.availability)).toHaveLength(24);
    // tech-002: lunch + multiple gaps fixture → 10:45–11:30 (45), 12:30–14:00 (90), 15:00–16:00 (60), 16:45–20:00
    expect(r.availability['tech-002'].map((g) => [min(g.startAt), g.durationMinutes])).toEqual([[645, 45], [750, 90], [900, 60], [1005, 195]]);
    // time-off technician has no availability and no appointments
    expect(r.availability['tech-008']).toEqual([]);
    expect(r.technicians.find((t) => t.id === 'tech-008')?.workingState).toBe('time_off');
  });

  it('#2 rejects 60 min into a 45-min opening; #1 books 45 min into it', async () => {
    // tech-002 is open 10:45–11:30 (45 min)
    const err = await expectError(
      adapter.createAppointment({ ...scope, idempotencyKey: idem(), technicianId: 'tech-002', customerName: 'Test', serviceIds: ['svc-acrylic'], startAt: at(645), requestedTechnician: false }),
      'APPOINTMENT_CONFLICT',
    );
    expect(err.message).toBe('That time was just booked. The schedule has been updated.');
    expect(err.details?.failures).toEqual(['OVERLAP']);
    const ok = await adapter.createAppointment({ ...scope, idempotencyKey: idem(), technicianId: 'tech-002', customerName: 'Test', serviceIds: ['svc-gel-mani'], startAt: at(645), requestedTechnician: false });
    expect(min(ok.startAt)).toBe(645);
    expect(min(ok.endAt)).toBe(690);
    expect(ok.status).toBe('scheduled');
    // A 60-min service into the 15:00–16:00 gap ends exactly at 16:00 → allowed (end == next start)
    const flush = await adapter.createAppointment({ ...scope, idempotencyKey: idem(), technicianId: 'tech-002', customerName: 'Test', serviceIds: ['svc-dip'], startAt: at(900), requestedTechnician: false });
    expect(min(flush.endAt)).toBe(960);
  });

  it('#3 two stations booking the same slot: exactly one commits, the other gets APPOINTMENT_CONFLICT', async () => {
    const a = new MockBookingDataAdapter(buildFixture(), { now: NOW, latencyMs: 5 });
    const mk = (station: string) => a.createAppointment({ ...scope, idempotencyKey: `${station}-${idem()}`, technicianId: 'tech-002', customerName: station, serviceIds: ['svc-gel-mani'], startAt: at(645), requestedTechnician: false });
    const results = await Promise.allSettled([mk('Station A'), mk('Station B')]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0].reason as BookingDomainError).code).toBe('APPOINTMENT_CONFLICT');
    expect(a.snapshot().appointments.filter((x) => x.technicianId === 'tech-002' && min(x.startAt) === 645)).toHaveLength(1);
  });

  it('idempotent re-submission returns the same appointment instead of double booking', async () => {
    const k = idem();
    const input = { ...scope, idempotencyKey: k, technicianId: 'tech-002', customerName: 'Twice', serviceIds: ['svc-gel-mani'], startAt: at(645), requestedTechnician: false };
    const first = await adapter.createAppointment(input);
    const second = await adapter.createAppointment(input);
    expect(second.id).toBe(first.id);
    expect(adapter.snapshot().appointments.filter((x) => x.customerName === 'Twice')).toHaveLength(1);
  });

  it('#5 refuses a service that would run into a protected appointment', async () => {
    // tech-005: protected acrylic at 15:00; 13:30–15:00 is open
    const err = await expectError(
      adapter.createAppointment({ ...scope, idempotencyKey: idem(), technicianId: 'tech-005', customerName: 'X', serviceIds: ['svc-acrylic'], startAt: at(14 * 60 + 15), requestedTechnician: false }),
      'APPOINTMENT_PROTECTION',
    );
    expect(err.details?.failures).toEqual(['PROTECTED']);
    const ok = await adapter.createAppointment({ ...scope, idempotencyKey: idem(), technicianId: 'tech-005', customerName: 'X', serviceIds: ['svc-acrylic'], startAt: at(14 * 60), requestedTechnician: false });
    expect(min(ok.endAt)).toBe(15 * 60);
  });

  it('#6 refuses a technician who is not qualified for the service, and never offers them', async () => {
    // tech-003 does Gel Manicure but not Acrylic Full Set
    await expectError(
      adapter.createAppointment({ ...scope, idempotencyKey: idem(), technicianId: 'tech-003', customerName: 'X', serviceIds: ['svc-acrylic'], startAt: at(13 * 60), requestedTechnician: false }),
      'TECHNICIAN_SERVICE_INELIGIBLE',
    );
    const openings = await adapter.findOpenings({ ...scope, date: FIXTURE_DATE, serviceIds: ['svc-acrylic'] });
    expect(openings.some((o) => o.technicianId === 'tech-003')).toBe(false);
    const matches = await adapter.getBestMatches({ ...scope, date: FIXTURE_DATE, serviceIds: ['svc-acrylic'], preferredStart: '13:00' });
    expect(matches.some((m) => m.technicianId === 'tech-003')).toBe(false);
    expect(matches.some((m) => m.technicianId === 'tech-008')).toBe(false); // time off
    expect(matches.length).toBeGreaterThan(0);
    // Gel is fine for tech-003
    const gelOpenings = await adapter.findOpenings({ ...scope, date: FIXTURE_DATE, serviceIds: ['svc-gel-mani'], technicianId: 'tech-003' });
    expect(gelOpenings.length).toBeGreaterThan(0);
  });

  it('#7 creating blocked time immediately removes the opening and publishes an event', async () => {
    const before = await adapter.getAvailability({ ...scope, date: FIXTURE_DATE, technicianIds: ['tech-002'] });
    expect(before.gaps['tech-002'].some((g) => min(g.startAt) === 750)).toBe(true);
    const events: ScheduleEventEnvelope[] = [];
    adapter.subscribeSchedule({ ...scope, date: FIXTURE_DATE }, (e) => events.push(e));
    const seg = await adapter.createBlockedTime({ ...scope, idempotencyKey: idem(), technicianId: 'tech-002', date: FIXTURE_DATE, startAt: at(750), endAt: at(810), reason: 'Supply run' });
    expect(seg.type).toBe('blocked');
    expect(seg.createdByUserId).toBe('user-mock');
    await Promise.resolve();
    expect(events.map((e) => e.event.type)).toEqual(['blocked_time.created']);
    const after = await adapter.getAvailability({ ...scope, date: FIXTURE_DATE, technicianIds: ['tech-002'] });
    expect(after.gaps['tech-002'].map((g) => [min(g.startAt), g.durationMinutes])).toContainEqual([810, 30]);
    expect(after.gaps['tech-002'].some((g) => min(g.startAt) === 750)).toBe(false);
    await expectError(
      adapter.createAppointment({ ...scope, idempotencyKey: idem(), technicianId: 'tech-002', customerName: 'X', serviceIds: ['svc-manicure'], startAt: at(765), requestedTechnician: false }),
      'BLOCKED_TIME_CONFLICT',
    );
    // Blocking over an existing appointment is refused rather than silently overlapping
    await expectError(
      adapter.createBlockedTime({ ...scope, idempotencyKey: idem(), technicianId: 'tech-002', date: FIXTURE_DATE, startAt: at(14 * 60), endAt: at(14 * 60 + 30), reason: 'x' }),
      'APPOINTMENT_CONFLICT',
    );
    expect(adapter.audit.some((a) => a.action === 'blocked_time.created' && a.entityId === seg.id)).toBe(true);
  });

  it('#10 moving an appointment validates the destination and recomputes both technicians', async () => {
    const range = await adapter.getScheduleRange({ ...scope, fromDate: FIXTURE_DATE, toDate: FIXTURE_DATE });
    const src = range.appointments.find((a) => a.technicianId === 'tech-002' && min(a.startAt) === 16 * 60)!; // pedicure 16:00–16:45
    // Destination tech-005 is free 13:30–15:00 (protected at 15:00) → 13:30 fits (45), 14:30 does not (runs into protected)
    await expectError(adapter.moveAppointment({ ...scope, appointmentId: src.id, expectedVersion: src.version, technicianId: 'tech-005', startAt: at(14 * 60 + 30), idempotencyKey: idem() }), 'APPOINTMENT_PROTECTION');
    // Stale version → SCHEDULE_CHANGED
    await expectError(adapter.moveAppointment({ ...scope, appointmentId: src.id, expectedVersion: src.version + 5, technicianId: 'tech-005', startAt: at(13 * 60 + 30), idempotencyKey: idem() }), 'SCHEDULE_CHANGED');
    // Ineligible destination (tech-003 cannot do pedicure? it can't — its list is gel/manicure/nail art)
    await expectError(adapter.moveAppointment({ ...scope, appointmentId: src.id, expectedVersion: src.version, technicianId: 'tech-003', startAt: at(13 * 60 + 30), idempotencyKey: idem() }), 'TECHNICIAN_SERVICE_INELIGIBLE');
    const events: ScheduleEventEnvelope[] = [];
    adapter.subscribeSchedule({ ...scope, date: FIXTURE_DATE }, (e) => events.push(e));
    const moved = await adapter.moveAppointment({ ...scope, appointmentId: src.id, expectedVersion: src.version, technicianId: 'tech-005', startAt: at(13 * 60 + 30), idempotencyKey: idem() });
    expect(moved.technicianId).toBe('tech-005');
    expect(moved.version).toBe(src.version + 1);
    await Promise.resolve();
    expect(events[0].event.type).toBe('appointment.reassigned');
    const after = await adapter.getAvailability({ ...scope, date: FIXTURE_DATE });
    expect(after.gaps['tech-002'].some((g) => min(g.startAt) === 900 && g.durationMinutes >= 105)).toBe(true); // 15:00–16:45 now open
    expect(after.gaps['tech-005'].some((g) => min(g.startAt) === 810)).toBe(false); // 13:30 taken
    expect(adapter.audit.find((a) => a.action === 'appointment.reassigned')?.previous).toMatchObject({ technicianId: 'tech-002' });
  });

  it('vertical move keeps the technician and publishes appointment.moved', async () => {
    const range = await adapter.getScheduleRange({ ...scope, fromDate: FIXTURE_DATE, toDate: FIXTURE_DATE });
    const src = range.appointments.find((a) => a.technicianId === 'tech-002' && min(a.startAt) === 16 * 60)!;
    const events: ScheduleEventEnvelope[] = [];
    adapter.subscribeSchedule({ ...scope, date: FIXTURE_DATE }, (e) => events.push(e));
    const moved = await adapter.moveAppointment({ ...scope, appointmentId: src.id, expectedVersion: src.version, technicianId: 'tech-002', startAt: at(15 * 60), idempotencyKey: idem() });
    expect(min(moved.startAt)).toBe(900);
    await Promise.resolve();
    expect(events[0].event).toMatchObject({ type: 'appointment.moved', previousTechnicianId: 'tech-002' });
  });

  it('walk-in with Any technician uses Fair Turn over the ELIGIBLE set only and consumes only that turn', async () => {
    const data = buildFixture();
    data.fairTurn[`${FIXTURE_TENANT}::${FIXTURE_BRANCH}`] = ['tech-008', 'tech-003', 'tech-005', 'tech-002'];
    const a = new MockBookingDataAdapter(data, { now: () => new Date(at(13 * 60 + 35)) }); // walk-in starts 13:45
    // tech-008 is on time off; tech-003 cannot do acrylic; tech-005 is free 13:30–15:00 → gets it.
    const w = await a.createWalkIn({ ...scope, idempotencyKey: idem(), customerName: 'Walk', serviceIds: ['svc-acrylic'], technicianId: 'any', requestedTechnician: false });
    expect(w.technicianId).toBe('tech-005');
    expect(w.source).toBe('walk_in');
    expect(w.status).toBe('arrived');
    expect(w.queueTicketId).toBeTruthy();
    expect(min(w.startAt)).toBe(13 * 60 + 45);
    // Ineligible technicians keep their place; only tech-005's turn is consumed
    expect(a.snapshot().fairTurn[`${FIXTURE_TENANT}::${FIXTURE_BRANCH}`]).toEqual(['tech-008', 'tech-003', 'tech-002', 'tech-005']);
    // Nobody eligible at all → honest TECHNICIAN_UNAVAILABLE, no turn consumed
    const late = new MockBookingDataAdapter(data, { now: () => new Date(at(19 * 60 + 50)) });
    await expectError(late.createWalkIn({ ...scope, idempotencyKey: idem(), customerName: 'Late', serviceIds: ['svc-spa-pedi'], technicianId: 'any', requestedTechnician: false }), 'TECHNICIAN_UNAVAILABLE');
    expect(late.snapshot().fairTurn[`${FIXTURE_TENANT}::${FIXTURE_BRANCH}`]).toEqual(['tech-008', 'tech-003', 'tech-005', 'tech-002']);
  });

  it('never leaks another tenant through any read or write (spec §33)', async () => {
    const mine = await adapter.getScheduleRange({ ...scope, fromDate: FIXTURE_DATE, toDate: FIXTURE_DATE });
    expect(mine.technicians.every((t) => t.tenantId === FIXTURE_TENANT)).toBe(true);
    expect(mine.appointments.every((a) => a.tenantId === FIXTURE_TENANT)).toBe(true);
    await expectError(adapter.getScheduleRange({ tenantId: FIXTURE_TENANT, branchId: 'branch-other', fromDate: FIXTURE_DATE, toDate: FIXTURE_DATE }), 'PERMISSION_DENIED');
    await expectError(adapter.getServices({ tenantId: 'tenant-nope', branchId: FIXTURE_BRANCH }), 'PERMISSION_DENIED');
    // A foreign appointment id with my scope → NOT_FOUND, never modified
    const foreign = adapter.snapshot().appointments.find((a) => a.tenantId === 'tenant-other')!;
    await expectError(adapter.cancelAppointment({ ...scope, appointmentId: foreign.id, expectedVersion: foreign.version }), 'NOT_FOUND');
    expect(adapter.snapshot().appointments.find((a) => a.id === foreign.id)?.status).toBe(foreign.status);
    // Foreign technician id with my scope → unavailable
    await expectError(adapter.createAppointment({ ...scope, idempotencyKey: idem(), technicianId: 'other-tech-001', customerName: 'X', serviceIds: ['svc-gel-mani'], startAt: at(13 * 60), requestedTechnician: false }), 'TECHNICIAN_UNAVAILABLE');
    // Realtime subscriptions are scoped: a foreign-branch event never reaches my handler
    const got: ScheduleEventEnvelope[] = [];
    adapter.subscribeSchedule({ ...scope, date: FIXTURE_DATE }, (e) => got.push(e));
    adapter.forceResync({ tenantId: 'tenant-other', branchId: 'branch-other' }, FIXTURE_DATE);
    await Promise.resolve();
    expect(got).toHaveLength(0);
  });

  it('status transitions publish the customer-journey events (spec §29)', async () => {
    const range = await adapter.getScheduleRange({ ...scope, fromDate: FIXTURE_DATE, toDate: FIXTURE_DATE });
    const a = range.appointments.find((x) => x.status === 'confirmed')!;
    const events: string[] = [];
    adapter.subscribeSchedule({ ...scope, date: FIXTURE_DATE }, (e) => events.push(e.event.type));
    await adapter.transition(scope, a.id, 'arrived');
    await adapter.transition(scope, a.id, 'in_service');
    await adapter.transition(scope, a.id, 'completed');
    await Promise.resolve();
    expect(events).toEqual(['appointment.checked_in', 'service.started', 'service.completed']);
  });

  it('technician day returns the full day context with a summary', async () => {
    const day = await adapter.getTechnicianDay({ ...scope, technicianId: 'tech-002', date: FIXTURE_DATE });
    expect(day.summary).toMatchObject({ workingMinutes: 600, bookedMinutes: 180, openMinutes: 390, appointmentCount: 4 });
    expect(day.availability).toHaveLength(4);
  });
});

describe('ProductionBookingDataAdapter — contract wiring', () => {
  it('calls the EXISTING /pos/booking routes, sends idempotency keys + expectedVersion and maps host errors', async () => {
    const calls: { method: string; path: string; body?: unknown; headers?: Record<string, string> }[] = [];
    const http: HttpClient = {
      async request(method, path, body, headers) {
        calls.push({ method, path, body, headers });
        if (path.includes('/reschedule')) throw { status: 409, code: 'SCHEDULE_CHANGED_ELSEWHERE', message: 'taken' };
        if (path.includes('/cancel')) throw { status: 403 };
        if (path.startsWith('/pos/booking/technicians')) return { date: FIXTURE_DATE, technicians: [{ technicianId: 't1', name: 'T One', rosterNumber: 1, avatarUrl: null, available: true, workingToday: true }], total: 1, totalAll: 1, workingCount: 1, page: 1, pageSize: 12, totalPages: 1 } as never;
        if (path.startsWith('/pos/booking/day-grid')) return { date: FIXTURE_DATE, openTime: '09:00', closeTime: '19:00', columns: [], appointments: [] } as never;
        return { appointmentId: 'a9', customerName: 'c', technicianId: 't', startTime: '10:00', endTime: '10:45', status: 'booked', services: [] } as never;
      },
    };
    const bus = new LocalScheduleEventHub();
    const p = new ProductionBookingDataAdapter({ http, realtime: bus, timezone: () => FIXTURE_TZ, loadServices: async () => [] });
    expect(p.pagesOnServer).toBe(true);
    await p.getScheduleRange({ ...scope, fromDate: FIXTURE_DATE, toDate: FIXTURE_DATE, statuses: ['confirmed'], page: 2, pageSize: 12, workingOnly: true });
    expect(calls[0]).toMatchObject({ method: 'GET', path: `/pos/booking/technicians?date=${FIXTURE_DATE}&page=2&pageSize=12&working=true` });
    expect(calls[1].path).toBe(`/pos/booking/day-grid?date=${FIXTURE_DATE}&technicianIds=t1&status=confirmed`);
    await p.createAppointment({ ...scope, idempotencyKey: 'k1', technicianId: 'any', customerName: 'c', serviceIds: ['s'], startAt: at(600), requestedTechnician: false });
    expect(calls[2]).toMatchObject({ method: 'POST', path: '/pos/booking/appointments', headers: { 'Idempotency-Key': 'k1' } });
    expect(calls[2].body).toMatchObject({ technicianId: undefined, date: FIXTURE_DATE, startTime: '10:00', serviceIds: ['s'], source: 'manual' });
    const e = await expectError(p.moveAppointment({ ...scope, appointmentId: 'a1', expectedVersion: 3, technicianId: 't', startAt: at(615), idempotencyKey: 'k2' }), 'APPOINTMENT_CONFLICT');
    expect(calls[3]).toMatchObject({ path: '/pos/booking/appointments/a1/reschedule', body: { startTime: '10:15', date: FIXTURE_DATE, technicianId: 't', expectedVersion: 3 }, headers: { 'Idempotency-Key': 'k2' } });
    expect(e.details).toMatchObject({ hostCode: 'SCHEDULE_CHANGED_ELSEWHERE', status: 409 });
    await expectError(p.cancelAppointment({ ...scope, appointmentId: 'a1', expectedVersion: 1 }), 'PERMISSION_DENIED');
    const seen: ScheduleEventEnvelope[] = [];
    p.subscribeSchedule({ ...scope, date: FIXTURE_DATE }, (ev) => seen.push(ev));
    bus.publish({ ...scope, date: FIXTURE_DATE, serverVersion: 9, at: 'now', event: { type: 'schedule.resync' } });
    expect(seen).toHaveLength(1);
  });
});
