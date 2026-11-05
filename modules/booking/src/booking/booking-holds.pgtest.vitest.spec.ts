// booking-holds.pgtest — Round 2 H (Oct 12 2026): a live booking hold (the AI receptionist's, the Reception Copilot's,
// a customer verifying their phone) is respected by the STAFF booking engine, and the booking made from it converts it.
//   • a hold on Ava at 10:00 from another session: an explicit booking for Ava at 10:00 is refused (409), "first
//     available" skips Ava and lands on Bea, and Ava's 10:00 is not offered by availability();
//   • a "first available" hold (no technician) blocks every technician at that time;
//   • the booking that presents the hold's own session is allowed, lands on the held technician, and converts the hold;
//   • a lapsed / released hold blocks nothing;
//   • SlotHoldService places an exact-slot hold (the salon's hold_seconds), refuses an overlapping one, and releases only
//     for the session that placed it.
// Real schema (PGlite, all migrations). Fixed appointment dates; hold expiry is relative to the database's own now().
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingService, ConflictError } from './booking.service';
import { SlotHoldService } from '../customer-booking/booking-slot-hold';
import { HoldSlotTakenError } from '../customer-booking/booking-hold.kysely';

const T = 'a6710000-0000-4000-8000-000000000001';
const B = 'a6710000-0000-4000-8000-000000000002';
const CAT = 'a6710000-0000-4000-8000-0000000000c1';
const SVC = 'a6710000-0000-4000-8000-000000000051';
const AVA = 'a6710000-0000-4000-8000-0000000000a1';
const BEA = 'a6710000-0000-4000-8000-0000000000b1';
const DAY = '2030-11-04';                                  // a Monday, fixed
const ctx = { tenantId: T, branchId: B, userId: 'u-front-desk', role: 'MANAGER', permissions: ['pos.booking.view', 'pos.booking.create'] };
let pg: any; let svc: BookingService; let holds: SlotHoldService;
const one = async (q: string) => (await pg.query(q)).rows[0];
const techOf = async (id: string) => (await one(`SELECT technician_id FROM pos_tech_appointments WHERE id = '${id}'`)).technician_id;
const at = (hhmm: string) => `('${DAY} ${hhmm}'::timestamp AT TIME ZONE 'America/New_York')`;
async function hold(tech: string | null, from: string, to: string, session = randomUUID(), live = true): Promise<{ id: string; session: string }> {
  const r = await one(`INSERT INTO booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel)
    VALUES ('${T}', '${B}', ${tech ? `'${tech}'` : 'NULL'}, ${at(from)}, ${at(to)}, now() + interval '${live ? '10 minutes' : '-1 minutes'}', 'held', '${session}', 'reception_copilot') RETURNING id`);
  return { id: r.id, session };
}
const book = (startTime: string, extra: Record<string, unknown> = {}) => svc.create(ctx as any, { customerName: 'Guest ' + startTime, serviceIds: [SVC], date: DAY, startTime, ...extra } as any);

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Hold Salon', 'Hold Salon', 'hold-salon', 'HOLDSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 60, 4500, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES
      ('${BEA}', '${T}', '${B}', 'Bea', 'B', 'Bea B', 'active', true), ('${AVA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active', true);
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${AVA}', '${SVC}'), ('${T}', '${B}', '${BEA}', '${SVC}');
  `);
  const db = kyselyFor(pg) as never;
  holds = new SlotHoldService(db);
  svc = new BookingService(new KyselyBookingRepository(db), undefined, undefined, undefined, undefined, holds);
}, 120000);

describe('the staff booking engine respects live holds', () => {
  it('another session holds Ava at 10:00 → explicit Ava refused (409), first available lands on Bea, 10:00 not offered for Ava', async () => {
    await hold(AVA, '10:00', '11:00');
    await expect(book('10:00', { technicianId: AVA })).rejects.toBeInstanceOf(ConflictError);
    const avail = await svc.availability(ctx as any, { date: DAY, serviceIds: [SVC] });
    expect(avail.find((t) => t.technicianId === AVA)!.slots).not.toContain('10:00');
    expect(avail.find((t) => t.technicianId === AVA)!.slots).not.toContain('09:30');   // 09:30–10:30 overlaps the hold
    expect(avail.find((t) => t.technicianId === BEA)!.slots).toContain('10:00');
    const r = await book('10:00');
    expect(await techOf(r.appointmentId)).toBe(BEA);
  });

  it('a "first available" hold (no technician) blocks every technician at that time', async () => {
    await hold(null, '13:00', '14:00');
    await expect(book('13:00', { technicianId: BEA })).rejects.toBeInstanceOf(ConflictError);
    await expect(book('13:00')).rejects.toBeInstanceOf(ConflictError);
  });

  it('the booking made from the hold (its own session) lands on the held technician and converts the hold', async () => {
    const h = await hold(BEA, '15:00', '16:00');
    const r = await book('15:00', { holdSessionId: h.session });             // no technician: the held one is used
    expect(await techOf(r.appointmentId)).toBe(BEA);
    const row = await one(`SELECT status, converted_appointment_id, released_at FROM booking_holds WHERE id = '${h.id}'`);
    expect(row).toMatchObject({ status: 'converted', converted_appointment_id: r.appointmentId, released_at: null });
  });

  it('a lapsed hold blocks nothing', async () => {
    await hold(AVA, '17:00', '18:00', randomUUID(), false);
    const r = await book('17:00', { technicianId: AVA });
    expect(await techOf(r.appointmentId)).toBe(AVA);
  });
});

describe('SlotHoldService — exact-slot holds for the receptionist and the copilot', () => {
  it('places the exact slot for the services\' length with the salon\'s hold time; an overlapping one from another session is refused', async () => {
    await pg.exec(`INSERT INTO booking_verification_settings (tenant_id, hold_seconds) VALUES ('${T}', 300)`);
    const s1 = randomUUID();
    const before = Date.now();
    const h = await holds.place({ tenantId: T, branchId: B, date: DAY, startTime: '11:00', serviceIds: [SVC], technicianId: AVA, bookingSessionId: s1, channel: 'reception_copilot' });
    const row = await one(`SELECT technician_id, channel, booking_session_id, extract(epoch from end_time - start_time)::int AS secs FROM booking_holds WHERE id = '${h.holdId}'`);
    expect(row).toMatchObject({ technician_id: AVA, channel: 'reception_copilot', booking_session_id: s1, secs: 3600 });
    const seconds = Math.round((h.expiresAt - before) / 1000);
    expect(seconds).toBeGreaterThanOrEqual(295); expect(seconds).toBeLessThanOrEqual(305);
    await expect(holds.place({ tenantId: T, branchId: B, date: DAY, startTime: '11:30', serviceIds: [SVC], technicianId: AVA, bookingSessionId: randomUUID(), channel: 'ai_receptionist' })).rejects.toBeInstanceOf(HoldSlotTakenError);
  });

  it('releases only for the session that placed it; releaseSession frees the call\'s hold', async () => {
    const s1 = randomUUID();
    const h = await holds.place({ tenantId: T, branchId: B, date: DAY, startTime: '12:00', serviceIds: [SVC], technicianId: BEA, bookingSessionId: s1, channel: 'reception_copilot' });
    expect(await holds.release(T, h.holdId, randomUUID())).toBe(false);
    expect((await one(`SELECT released_at FROM booking_holds WHERE id = '${h.holdId}'`)).released_at).toBeNull();
    expect(await holds.release('a6710000-0000-4000-8000-0000000000ff', h.holdId, s1)).toBe(false);      // another salon
    expect(await holds.release(T, h.holdId, s1)).toBe(true);
    expect((await one(`SELECT status, release_reason FROM booking_holds WHERE id = '${h.holdId}'`))).toMatchObject({ status: 'released', release_reason: 'customer_canceled' });
    const s2 = randomUUID();
    const h2 = await holds.place({ tenantId: T, branchId: B, date: DAY, startTime: '12:00', serviceIds: [SVC], technicianId: BEA, bookingSessionId: s2, channel: 'ai_receptionist' });
    expect(await holds.releaseSession(T, s2)).toBe(1);
    expect((await one(`SELECT status FROM booking_holds WHERE id = '${h2.holdId}'`)).status).toBe('released');
  });
});
