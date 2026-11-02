// copilot-holds.pgtest — Round 2 H (Oct 12 2026): the Reception Copilot's "Hold this time" on the real schema (PGlite,
// all migrations): ReceptionCopilotContextService.holdSlot / releaseHold → SlotHoldService, and the copilot's booking
// action → the real staff BookingService (which reads holds). Desk A holds Ava at 10:00: desk B cannot hold it, is not
// offered it, cannot book it and cannot release A's hold (the token is sealed for A); A books it — the hold converts.
// Holding another time moves the desk session's ONE hold; releasing gives the time back. Fixed appointment dates only.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { BookingService, KyselyBookingRepository, SlotHoldService } from '@aipowersalon/booking';
import { ReceptionCopilotContextService } from './reception-copilot-context.service';
import { ReceptionCopilotActionService } from './reception-copilot-action.service';

const T = 'a6750000-0000-4000-8000-000000000001';
const B = 'a6750000-0000-4000-8000-000000000002';
const CAT = 'a6750000-0000-4000-8000-0000000000c1';
const SVC = 'a6750000-0000-4000-8000-000000000051';
const AVA = 'a6750000-0000-4000-8000-0000000000a1';
const DAY = '2030-11-04';
const perms = ['pos.booking.view', 'pos.booking.create', 'reception_copilot.create_appointment', 'reception_copilot.view_recommendations'];
const deskA = { tenantId: T, branchId: B, userId: 'a6750000-0000-4000-8000-0000000000e1', role: 'FRONT_DESK', permissions: perms };
const deskB = { ...deskA, userId: 'a6750000-0000-4000-8000-0000000000e2' };
let pg: any; let copilot: ReceptionCopilotContextService; let actions: ReceptionCopilotActionService; let booking: BookingService;
const one = async (q: string) => (await pg.query(q)).rows[0];
const hold = (ctx: any, startTime: string, holdToken?: string) => copilot.holdSlot(ctx, { date: DAY, startTime, serviceIds: [SVC], technicianId: AVA, holdToken });
const bookAt = (ctx: any, startTime: string, name: string, holdToken?: string) => actions.execute(ctx, { type: 'create_appointment', customerName: name, serviceIds: [SVC], date: DAY, startTime, technicianId: AVA, confirm: true, holdToken });

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'CH Salon', 'CH Salon', 'ch-salon', 'CHSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 60, 4500, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES ('${AVA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active', true);
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${AVA}', '${SVC}');
    INSERT INTO booking_verification_settings (tenant_id, hold_seconds) VALUES ('${T}', 240);
  `);
  const db = kyselyFor(pg) as never;
  const holds = new SlotHoldService(db);
  booking = new BookingService(new KyselyBookingRepository(db), undefined, undefined, undefined, undefined, holds);
  copilot = new ReceptionCopilotContextService({} as any, {} as any, booking, undefined, null, holds);
  actions = new ReceptionCopilotActionService(booking, { record: async () => ({ id: 'ev' }) } as any, undefined, { send: async () => ({ sent: false }) } as any);
}, 120000);

describe('Reception Copilot — "Hold this time"', () => {
  it('desk A holds Ava at 10:00 for the salon\'s hold time; desk B cannot hold it, is not offered it, cannot book it, cannot release it', async () => {
    const before = Date.now();
    const a = await hold(deskA, '10:00');
    expect(a).toMatchObject({ held: true, date: DAY, startTime: '10:00', technicianId: AVA });
    expect(a.holdToken).toMatch(/^bs~/);
    const secs = Math.round((Date.parse(a.expiresAt!) - before) / 1000);
    expect(secs).toBeGreaterThanOrEqual(235); expect(secs).toBeLessThanOrEqual(245);
    expect(await one(`SELECT channel, status FROM booking_holds WHERE id = '${a.holdId}'`)).toEqual({ channel: 'reception_copilot', status: 'held' });

    expect(await hold(deskB, '10:00')).toEqual({ held: false, reason: 'taken' });
    const offered = await copilot.recommendAvailability(deskB as any, { date: DAY, serviceIds: [SVC] });
    expect(offered.recommendations.map((r) => r.time)).not.toContain('10:00');
    const bBook = await bookAt(deskB, '10:00', 'Walk-up B');
    expect(bBook).toMatchObject({ ok: false, errorCode: 'APPOINTMENT_CONFLICT' });
    expect(await copilot.releaseHold(deskB as any, { holdToken: a.holdToken! })).toEqual({ released: false });
    expect((await one(`SELECT status FROM booking_holds WHERE id = '${a.holdId}'`)).status).toBe('held');
  });

  it('desk A books from the hold → the appointment exists on Ava and the hold is converted into it', async () => {
    const a = await hold(deskA, '13:00');
    const r = await bookAt(deskA, '13:00', 'Caller A', a.holdToken);
    expect(r.ok).toBe(true);
    const appt = await one(`SELECT id, technician_id FROM pos_tech_appointments WHERE tenant_id = '${T}' AND customer_name = 'Caller A'`);
    expect(appt.technician_id).toBe(AVA);
    expect(await one(`SELECT status, converted_appointment_id FROM booking_holds WHERE id = '${a.holdId}'`)).toEqual({ status: 'converted', converted_appointment_id: appt.id });
  });

  it('holding another time moves the desk session\'s ONE hold; releasing it gives the time back to everyone', async () => {
    const first = await hold(deskA, '15:00');
    const moved = await hold(deskA, '16:00', first.holdToken);
    expect(moved.held).toBe(true);
    expect((await one(`SELECT status FROM booking_holds WHERE id = '${first.holdId}'`)).status).toBe('released');
    expect(await copilot.releaseHold(deskA as any, { holdToken: moved.holdToken! })).toEqual({ released: true });
    expect((await hold(deskB, '16:00')).held).toBe(true);
  });

  // Round 3 H2 (gap 2): the copilot's reschedule respects holds — another desk's hold blocks a move into it; the desk that
  // holds the time presents its token and moves into it (the hold is used up).
  it('reschedule: desk B\'s hold blocks desk A\'s move; desk A moves into its own held time with its token', async () => {
    const DAY2 = '2030-11-05';
    const mover = { ...deskA, permissions: [...perms, 'pos.booking.reschedule', 'reception_copilot.reschedule_appointment'] };
    const made = await actions.execute(mover as any, { type: 'create_appointment', customerName: 'Mover A', serviceIds: [SVC], date: DAY2, startTime: '09:00', technicianId: AVA, confirm: true });
    expect(made.ok).toBe(true);
    const id = (made as any).result.appointmentId;
    const b = await copilot.holdSlot(deskB as any, { date: DAY2, startTime: '11:00', serviceIds: [SVC], technicianId: AVA });
    expect(b.held).toBe(true);
    const blocked = await actions.execute(mover as any, { type: 'reschedule_appointment', appointmentId: id, date: DAY2, startTime: '11:00', confirm: true });
    expect(blocked).toMatchObject({ ok: false, errorCode: 'APPOINTMENT_CONFLICT' });
    const a = await copilot.holdSlot(mover as any, { date: DAY2, startTime: '14:00', serviceIds: [SVC], technicianId: AVA });
    expect(a.held).toBe(true);
    const moved = await actions.execute(mover as any, { type: 'reschedule_appointment', appointmentId: id, date: DAY2, startTime: '14:00', confirm: true, holdToken: a.holdToken } as any);
    expect(moved.ok).toBe(true);
    expect((await one(`SELECT start_time FROM pos_tech_appointments WHERE id = '${id}'`)).start_time).toMatch(/^14:00/);
    expect((await one(`SELECT released_at IS NOT NULL AS used FROM booking_holds WHERE id = '${a.holdId}'`)).used).toBe(true);
  });
});
