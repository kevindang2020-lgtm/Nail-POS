// voice-holds.pgtest — Round 2 H (Oct 12 2026): the AI receptionist's hold, end to end through the tool route on the real
// schema (PGlite, all migrations): VoiceBookingController → SlotHoldService / VoiceBookingWriteService → the real staff
// BookingService (which reads holds). A call holds Ava at 10:00; ANOTHER call asking for "anyone" at 10:00 is told the
// time is unavailable (Ava is the only technician); the holding call books it — on Ava, hold converted. A call that
// ends with a time still held gives it back at once (release_reason call_ended). Fixed appointment dates only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { BookingService, KyselyBookingRepository, SlotHoldService } from '@aipowersalon/booking';
import { VoiceBookingController } from './voice-booking.controller';
import { VoiceBookingWriteService } from './voice-booking-write.service';
import { RetellVoiceAdapter } from './retell-voice.adapter';
import { voiceCallSession } from './voice-booking.service';
import { VoiceManageService } from './voice-manage.service';

const T = 'a6740000-0000-4000-8000-000000000001';
const B = 'a6740000-0000-4000-8000-000000000002';
const CAT = 'a6740000-0000-4000-8000-0000000000c1';
const SVC = 'a6740000-0000-4000-8000-000000000051';
const AVA = 'a6740000-0000-4000-8000-0000000000a1';
const DAY = '2030-11-04';
const V = { tenantId: T, branchId: B };
let pg: any; let c: VoiceBookingController; let manage: VoiceManageService;
const one = async (q: string) => (await pg.query(q)).rows[0];
const req = (body: any) => ({ voiceCtx: V, rawBody: Buffer.from(JSON.stringify(body)), body, headers: {} });
const tool = (callId: string, name: string, args: any) => c.tool(req({ name, args, invocation_id: 'i', call: { call_id: callId, direction: 'inbound' } })) as Promise<any>;
const book = (callId: string, startTime: string, name: string) => tool(callId, 'create_appointment', { service_id: SVC, date: DAY, start_time: startTime, customer_name: name, customer_phone: '+18565550190', confirmed: true });

beforeAll(async () => {
  process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'VH Salon', 'VH Salon', 'vh-salon', 'VHSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 60, 4500, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES ('${AVA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active', true);
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${AVA}', '${SVC}');
  `);
  const db = kyselyFor(pg) as never;
  const holds = new SlotHoldService(db);
  const booking = new BookingService(new KyselyBookingRepository(db), undefined, undefined, undefined, undefined, holds);
  manage = new VoiceManageService(booking, {} as any);
  c = new VoiceBookingController({} as any, new VoiceBookingWriteService(booking), {} as any, { record: async () => ({ id: 'oc' }) } as any, new RetellVoiceAdapter(), undefined, holds);
}, 120000);
afterAll(() => { delete process.env.VOICE_WRITE_TOOLS_ENABLED; });

describe('AI receptionist — a held time is the caller\'s until they book or hang up', () => {
  it('call A holds Ava at 10:00 → call B ("anyone") is told it is unavailable → call A books it, hold converted', async () => {
    const held = await tool('call_A', 'hold_slot', { service_id: SVC, date: DAY, start_time: '10:00', technician_id: AVA });
    expect(held).toMatchObject({ success: true, data: { held: true } });
    const other = await book('call_B', '10:00', 'Caller B');
    expect(other.success).toBe(false);
    expect(await one(`SELECT count(*)::int AS n FROM pos_tech_appointments WHERE tenant_id = '${T}'`)).toEqual({ n: 0 });
    const mine = await book('call_A', '10:00', 'Caller A');
    expect(mine.success).toBe(true);
    const appt = await one(`SELECT id, technician_id, source FROM pos_tech_appointments WHERE tenant_id = '${T}' AND customer_name = 'Caller A'`);
    expect(appt).toMatchObject({ technician_id: AVA, source: 'ai' });
    const h = await one(`SELECT status, converted_appointment_id, channel, booking_session_id FROM booking_holds WHERE id = '${held.data.holdId}'`);
    expect(h).toMatchObject({ status: 'converted', converted_appointment_id: appt.id, channel: 'ai_receptionist', booking_session_id: voiceCallSession(V, 'call_A') });
  });

  it('a call that ends with a time held gives it back at once; another caller can then book it', async () => {
    const held = await tool('call_C', 'hold_slot', { service_id: SVC, date: DAY, start_time: '12:00', technician_id: AVA });
    expect(held.success).toBe(true);
    expect((await book('call_D', '12:00', 'Caller D')).success).toBe(false);
    await c.recordOutcome('call_C', {}, req({}));
    expect(await one(`SELECT status, release_reason FROM booking_holds WHERE id = '${held.data.holdId}'`)).toEqual({ status: 'released', release_reason: 'call_ended' });
    expect((await book('call_D', '12:00', 'Caller D')).success).toBe(true);
  });

  it('release_hold (the caller changed their mind) frees the time; holding another time moves the call\'s ONE hold', async () => {
    const first = await tool('call_E', 'hold_slot', { service_id: SVC, date: DAY, start_time: '14:00', technician_id: AVA });
    const moved = await tool('call_E', 'hold_slot', { service_id: SVC, date: DAY, start_time: '15:00', technician_id: AVA });
    expect(await one(`SELECT status, release_reason FROM booking_holds WHERE id = '${first.data.holdId}'`)).toEqual({ status: 'released', release_reason: 'superseded' });
    expect((await tool('call_E', 'release_hold', {})).data).toEqual({ released: 1 });
    expect((await one(`SELECT status FROM booking_holds WHERE id = '${moved.data.holdId}'`)).status).toBe('released');
    expect((await book('call_F', '15:00', 'Caller F')).success).toBe(true);
  });

  // Round 3 H2 (gap 2): a voice reschedule into another call's held time is refused exactly like a booking; the call that
  // holds the time may move its appointment into it, and the hold is used up.
  it('voice reschedule: another call\'s hold blocks the move; the holding call\'s own move goes through', async () => {
    const caller = { verified: true as const, customerId: 'a6740000-0000-4000-8000-0000000000e1', phone: '+18565550190', name: 'Caller R' };
    const DAY2 = '2030-11-05';                              // its own day: the cases above leave Ava's DAY busy
    expect((await tool('call_R', 'create_appointment', { service_id: SVC, date: DAY2, start_time: '09:00', customer_name: 'Caller R', customer_phone: '+18565550190', confirmed: true })).success).toBe(true);
    const appt = await one(`SELECT id FROM pos_tech_appointments WHERE tenant_id = '${T}' AND customer_name = 'Caller R'`);
    const held = await tool('call_S', 'hold_slot', { service_id: SVC, date: DAY2, start_time: '16:00', technician_id: AVA });
    expect(held.data.held).toBe(true);
    const blocked = await manage.rescheduleAppointment(V, { appointmentId: appt.id, date: DAY2, startTime: '16:00', caller, confirmed: true, callSessionId: voiceCallSession(V, 'call_R') } as any);
    expect(blocked).toMatchObject({ ok: false, slotUnavailable: true });
    const mine = await tool('call_R', 'hold_slot', { service_id: SVC, date: DAY2, start_time: '17:00', technician_id: AVA });
    expect(mine.data.held).toBe(true);
    const moved = await manage.rescheduleAppointment(V, { appointmentId: appt.id, date: DAY2, startTime: '17:00', caller, confirmed: true, callSessionId: voiceCallSession(V, 'call_R') } as any);
    expect(moved).toMatchObject({ ok: true, startTime: '17:00' });
    expect((await one(`SELECT released_at IS NOT NULL OR converted_appointment_id IS NOT NULL AS used FROM booking_holds WHERE id = '${mine.data.holdId}'`)).used).toBe(true);
  });
});
