// booking-holds-locked.pgtest — Round 3 H2 (Oct 12 2026): the four gaps Round 2 H left in booking holds.
//   1. the hold check runs INSIDE the booking's locked transaction: a hold that appears after the service's pre-check
//      (the window a concurrent receptionist hits) still refuses the booking; and placing a hold re-checks the
//      appointments under the same lock, so a hold can never land on a slot a booking already took;
//   2. reschedule (staff engine) respects holds: another session's live hold blocks a move into it; the move made by the
//      hold's own session is allowed and the hold stops being live;
//   4. a conversion that loses to a concurrent conversion is logged + audited; the appointment stands.
// (Gap 3 — the customer / voice availability — is customer-booking-availability-holds.pgtest.)
// Real schema (PGlite, all migrations). Fixed appointment dates; hold expiry is relative to the database's own now().
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingService, ConflictError } from './booking.service';
import { SlotHoldService, type BookingHoldGate } from '../customer-booking/booking-slot-hold';
import { HoldSlotTakenError, HoldNotConvertibleError } from '../customer-booking/booking-hold.kysely';

const T = 'a6730000-0000-4000-8000-000000000001';
const B = 'a6730000-0000-4000-8000-000000000002';
const CAT = 'a6730000-0000-4000-8000-0000000000c1';
const SVC = 'a6730000-0000-4000-8000-000000000051';
const AVA = 'a6730000-0000-4000-8000-0000000000a1';
const BEA = 'a6730000-0000-4000-8000-0000000000b1';
const DAY = '2030-11-05';                                  // a Tuesday, fixed
const ctx = { tenantId: T, branchId: B, userId: 'u-front-desk', role: 'MANAGER', permissions: ['pos.booking.view', 'pos.booking.create', 'pos.booking.reschedule'] };
let pg: any; let db: any; let holds: SlotHoldService; let svc: BookingService;
const one = async (q: string) => (await pg.query(q)).rows[0];
const DAY2 = '2030-11-06';
const at = (hhmm: string, day = DAY) => `('${day} ${hhmm}'::timestamp AT TIME ZONE 'America/New_York')`;
async function hold(tech: string | null, from: string, to: string, session = randomUUID(), day = DAY): Promise<{ id: string; session: string }> {
  const r = await one(`INSERT INTO booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel)
    VALUES ('${T}', '${B}', ${tech ? `'${tech}'` : 'NULL'}, ${at(from, day)}, ${at(to, day)}, now() + interval '10 minutes', 'held', '${session}', 'reception_copilot') RETURNING id`);
  return { id: r.id, session };
}
const engine = (gate: BookingHoldGate) => new BookingService(new KyselyBookingRepository(db), undefined, undefined, undefined, undefined, gate);
const book = (s: BookingService, startTime: string, extra: Record<string, unknown> = {}) => s.create(ctx as any, { customerName: 'Guest ' + startTime, serviceIds: [SVC], date: DAY, startTime, ...extra } as any);
// Each case below uses its own technician-hours on DAY (or DAY2), so the 5-minute buffer never couples two cases.
const liveCount = async (startTime: string) => Number((await one(`SELECT count(*)::int AS n FROM booking_holds WHERE tenant_id = '${T}' AND start_time = ${at(startTime)} AND released_at IS NULL AND converted_appointment_id IS NULL`)).n);

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Lock Salon', 'Lock Salon', 'lock-salon', 'LOCKSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 60, 4500, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES
      ('${BEA}', '${T}', '${B}', 'Bea', 'B', 'Bea B', 'active', true), ('${AVA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active', true);
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${AVA}', '${SVC}'), ('${T}', '${B}', '${BEA}', '${SVC}');
  `);
  db = kyselyFor(pg) as never;
  holds = new SlotHoldService(db);
  svc = engine(holds);
}, 120000);
afterEach(() => vi.restoreAllMocks());

describe('gap 1 — the hold check is inside the booking\'s locked transaction', () => {
  it('a hold placed after the service\'s pre-check (before the locked insert) still refuses the explicit booking', async () => {
    // The pre-check sees no hold; the hold "arrives" right after it — what a concurrent receptionist does in that window.
    let first = true;
    const racy: BookingHoldGate = {
      liveHolds: async (...a) => { if (first) { first = false; await hold(AVA, '10:00', '11:00'); return []; } return holds.liveHolds(...a); },
      convert: (...a) => holds.convert(...a),
    };
    await expect(book(engine(racy), '10:00', { technicianId: AVA })).rejects.toBeInstanceOf(ConflictError);
    expect(Number((await one(`SELECT count(*)::int AS n FROM pos_tech_appointments WHERE tenant_id = '${T}' AND appt_date = '${DAY}' AND start_time = '10:00'`)).n)).toBe(0);
  });

  it('first available: a hold that arrives after the pick moves the booking to the next free technician', async () => {
    let first = true;
    const racy: BookingHoldGate = {
      liveHolds: async (...a) => { if (first) { first = false; await hold(AVA, '12:00', '13:00'); return []; } return holds.liveHolds(...a); },
      convert: (...a) => holds.convert(...a),
    };
    const r = await book(engine(racy), '12:00');                          // Ava (first by name) is picked, then held
    expect((await one(`SELECT technician_id FROM pos_tech_appointments WHERE id = '${r.appointmentId}'`)).technician_id).toBe(BEA);
  });

  it('placing a hold on a slot a booking already took is refused (checked under the same lock)', async () => {
    await book(svc, '14:00', { technicianId: AVA });
    await expect(holds.place({ tenantId: T, branchId: B, date: DAY, startTime: '14:30', serviceIds: [SVC], technicianId: AVA, bookingSessionId: randomUUID(), channel: 'ai_receptionist' }))
      .rejects.toBeInstanceOf(HoldSlotTakenError);
    expect(await liveCount('14:30')).toBe(0);
    // Bea is free at 14:30 — her hold is fine.
    await holds.place({ tenantId: T, branchId: B, date: DAY, startTime: '14:30', serviceIds: [SVC], technicianId: BEA, bookingSessionId: randomUUID(), channel: 'ai_receptionist' });
    expect(await liveCount('14:30')).toBe(1);
  });
});

describe('gap 2 — reschedule respects holds', () => {
  it('another session\'s live hold blocks a move into it; the hold\'s own session may move into it and the hold is used up', async () => {
    const appt = await book(svc, '09:00', { technicianId: BEA });
    const h = await hold(BEA, '16:00', '17:00');
    await expect(svc.reschedule(ctx as any, appt.appointmentId, { startTime: '16:00', notifyCustomer: false } as any)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.reschedule(ctx as any, appt.appointmentId, { startTime: '16:30', notifyCustomer: false } as any)).rejects.toBeInstanceOf(ConflictError);   // overlaps
    expect((await one(`SELECT start_time FROM pos_tech_appointments WHERE id = '${appt.appointmentId}'`)).start_time).toMatch(/^09:00/);
    const moved = await svc.reschedule(ctx as any, appt.appointmentId, { startTime: '16:00', notifyCustomer: false, holdSessionId: h.session } as any);
    expect(moved.startTime).toBe('16:00');
    expect(await liveCount('16:00')).toBe(0);
  });

  it('a "first available" hold (no technician) blocks a move of any technician into that time', async () => {
    const appt = await book(svc, '09:00', { technicianId: AVA });
    await hold(null, '18:00', '19:00');
    await expect(svc.reschedule(ctx as any, appt.appointmentId, { startTime: '18:00', notifyCustomer: false } as any)).rejects.toBeInstanceOf(ConflictError);
  });

  it('the hold check on a reschedule is inside the locked transaction too', async () => {
    const appt = await book(svc, '10:00', { technicianId: BEA, date: DAY2 });     // DAY2: Bea's DAY is busy around 17:00
    let first = true;
    const racy: BookingHoldGate = {
      liveHolds: async (...a) => { if (first) { first = false; await hold(BEA, '17:00', '18:00', randomUUID(), DAY2); return []; } return holds.liveHolds(...a); },
      convert: (...a) => holds.convert(...a),
    };
    await expect(engine(racy).reschedule(ctx as any, appt.appointmentId, { startTime: '17:00', notifyCustomer: false } as any)).rejects.toBeInstanceOf(ConflictError);
    expect((await one(`SELECT start_time FROM pos_tech_appointments WHERE id = '${appt.appointmentId}'`)).start_time).toMatch(/^10:00/);
  });
});

describe('gap 4 — a lost conversion is visible', () => {
  it('logs a warning and audits pos_booking_hold_conversion_lost; the appointment stands', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const h = await hold(AVA, '15:00', '16:00', randomUUID(), DAY2);
    const losing: BookingHoldGate = {
      liveHolds: (...a) => holds.liveHolds(...a),
      convert: async () => { throw new HoldNotConvertibleError('This booking has already been confirmed.', 'already_converted'); },
    };
    const s = engine(losing);
    const r = await book(s, '15:00', { holdSessionId: h.session, date: DAY2 });
    expect(r.appointmentId).toBeTruthy();
    expect((await one(`SELECT status FROM pos_tech_appointments WHERE id = '${r.appointmentId}'`)).status).toBe('booked');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(h.id));
    const entry = s.auditLog().find((a) => a.actionType === 'pos_booking_hold_conversion_lost');
    expect(entry).toMatchObject({ entityId: r.appointmentId, metadata: expect.objectContaining({ holdId: h.id, reason: 'already_converted' }) });
  });
});
