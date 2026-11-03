// voice-holds.vitest.spec.ts — Round 2 H (Oct 12 2026): the AI receptionist's holds through the tool route. One booking
// session per call (voiceCallSession: tenant + branch + the provider's call id): get_availability {hold:true} holds the
// best option for the call, hold_slot holds the exact time picked, release_hold / the call's outcome (call end) release
// it, create_appointment books under the same session (so the booking converts the hold). Holds are writes: nothing is
// held while write tools are off.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { VoiceBookingController } from './voice-booking.controller';
import { RetellVoiceAdapter } from './retell-voice.adapter';
import { voiceCallSession } from './voice-booking.service';
import { HoldSlotTakenError } from '@aipowersalon/booking';

const V = { tenantId: 'a6730000-0000-4000-8000-000000000001', branchId: 'a6730000-0000-4000-8000-000000000002' };
const SVC = 'a6730000-0000-4000-8000-000000000051';
const req = (body: any) => ({ voiceCtx: V, rawBody: Buffer.from(JSON.stringify(body)), body, headers: {} });
const tool = (name: string, args: any, callId: string | null = 'call_77') => req({ name, args, invocation_id: 'i', ...(callId ? { call: { call_id: callId, direction: 'inbound' } } : {}) });

function setup() {
  const gw = {
    availability: vi.fn(async () => [{ startTime: '10:00', endTime: '11:00', technicianId: 't1', durationMinutes: 60, priceEstimateCents: 4500 }]),
    availabilityWithHold: vi.fn(async () => ({ options: [{ startTime: '10:00', endTime: '11:00', technicianId: 't1', durationMinutes: 60, priceEstimateCents: 4500 }], hold: { holdId: 'h1', optionId: 'o1', expiresAt: '2030-11-04T15:10:00.000Z' } })),
  } as any;
  const write = { createAppointment: vi.fn(async () => ({ ok: true, appointmentId: 'bk_1', date: '2030-11-04', startTime: '10:00' })) } as any;
  const outcomes = { record: vi.fn(async () => ({ id: 'oc_1' })) } as any;
  const holds = {
    place: vi.fn(async () => ({ holdId: 'h2', expiresAt: Date.now() + 5 * 60_000, startsAt: 0, endsAt: 0, technicianId: null })),
    releaseSession: vi.fn(async () => 1),
  } as any;
  const manage = {
    verifyCaller: vi.fn(async () => ({ verified: true, customerId: 'cus_1', phone: '+18565550190', name: 'Caller' })),
    rescheduleAppointment: vi.fn(async () => ({ ok: true, appointmentId: 'bk_9', date: '2030-11-04', startTime: '16:00', endTime: '17:00' })),
  } as any;
  const c = new VoiceBookingController(gw, write, manage, outcomes, new RetellVoiceAdapter(), undefined, undefined, holds);   // deals, business knowledge (AI Business Setup), holds
  return { c, gw, write, outcomes, holds, manage };
}
afterEach(() => { delete process.env.VOICE_WRITE_TOOLS_ENABLED; });

describe('AI receptionist holds (tool route)', () => {
  it('one session per call: deterministic, uuid-shaped, distinct per call and per salon', () => {
    const a = voiceCallSession(V, 'call_77');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(voiceCallSession(V, 'call_77')).toBe(a);
    expect(voiceCallSession(V, 'call_78')).not.toBe(a);
    expect(voiceCallSession({ ...V, tenantId: 'a6730000-0000-4000-8000-0000000000ff' }, 'call_77')).not.toBe(a);
  });

  it('get_availability {hold:true} holds the best option under the call\'s session (write tools on)', async () => {
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    const { c, gw } = setup();
    const out: any = await c.tool(tool('get_availability', { service_id: SVC, date: '2030-11-04', hold: true }));
    expect(gw.availabilityWithHold).toHaveBeenCalledWith(V, { serviceId: SVC, date: '2030-11-04', technicianId: undefined, bookingSessionId: voiceCallSession(V, 'call_77') });
    expect(gw.availability).not.toHaveBeenCalled();
    expect(out.data.hold).toMatchObject({ holdId: 'h1' });
  });

  it('a hold is a write: with write tools off (or no call id) get_availability only reads', async () => {
    const { c, gw } = setup();
    await c.tool(tool('get_availability', { service_id: SVC, date: '2030-11-04', hold: true }));
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    await c.tool(tool('get_availability', { service_id: SVC, date: '2030-11-04', hold: true }, null));
    expect(gw.availabilityWithHold).not.toHaveBeenCalled();
    expect(gw.availability).toHaveBeenCalledTimes(2);
    delete process.env.VOICE_WRITE_TOOLS_ENABLED;
    const { c: c2, holds } = setup();
    const refused: any = await c2.tool(tool('hold_slot', { service_id: SVC, date: '2030-11-04', start_time: '10:00' }));
    expect(refused.success).toBe(false);
    expect(holds.place).not.toHaveBeenCalled();
  });

  it('hold_slot holds the EXACT time on the ai_receptionist channel under the call\'s session; a taken time is relayed honestly', async () => {
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    const { c, holds } = setup();
    const out: any = await c.tool(tool('hold_slot', { service_id: SVC, date: '2030-11-04', start_time: '10:00', technician_id: 'a6730000-0000-4000-8000-0000000000a1' }));
    expect(holds.place).toHaveBeenCalledWith({ tenantId: V.tenantId, branchId: V.branchId, date: '2030-11-04', startTime: '10:00', serviceIds: [SVC], technicianId: 'a6730000-0000-4000-8000-0000000000a1', bookingSessionId: voiceCallSession(V, 'call_77'), channel: 'ai_receptionist' });
    expect(out).toMatchObject({ success: true, data: { held: true, holdId: 'h2' } });
    expect(out.message).toMatch(/holding 10:00 on 2030-11-04 for you for about 5 minutes/);
    holds.place.mockRejectedValueOnce(new HoldSlotTakenError('taken'));
    const taken: any = await c.tool(tool('hold_slot', { service_id: SVC, date: '2030-11-04', start_time: '10:00' }));
    expect(taken).toMatchObject({ success: false });
    expect(taken.message).toMatch(/just taken/);
    const noCall: any = await c.tool(tool('hold_slot', { service_id: SVC, date: '2030-11-04', start_time: '10:00' }, null));
    expect(noCall.success).toBe(false);
  });

  it('release_hold and the call\'s end release the call\'s hold; create_appointment books under the call\'s session', async () => {
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    const { c, holds, write } = setup();
    const sid = voiceCallSession(V, 'call_77');
    await c.tool(tool('release_hold', {}));
    expect(holds.releaseSession).toHaveBeenLastCalledWith(V.tenantId, sid, 'customer_canceled');
    await c.tool(tool('create_appointment', { service_id: SVC, date: '2030-11-04', start_time: '10:00', customer_name: 'Caller', confirmed: true }));
    expect(write.createAppointment.mock.calls[0][1]).toMatchObject({ callSessionId: sid, startTime: '10:00' });
    await c.recordOutcome('call_77', {}, req({}));
    expect(holds.releaseSession).toHaveBeenLastCalledWith(V.tenantId, sid, 'call_ended');
  });

  // Round 3 H2 (gaps 2 + 3): the call's own hold is offered back to it by plain availability, and a reschedule made on the
  // call runs under the call's session (its own hold does not block the move; another call's hold does).
  it('get_availability (no hold) asks under the call\'s session; reschedule_appointment moves under it', async () => {
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    const { c, gw, manage } = setup();
    const sid = voiceCallSession(V, 'call_77');
    await c.tool(tool('get_availability', { service_id: SVC, date: '2030-11-04' }));
    expect(gw.availability).toHaveBeenLastCalledWith(V, { serviceId: SVC, date: '2030-11-04', technicianId: undefined, bookingSessionId: sid });
    await c.tool(tool('get_availability', { service_id: SVC, date: '2030-11-04' }, null));
    expect(gw.availability).toHaveBeenLastCalledWith(V, { serviceId: SVC, date: '2030-11-04', technicianId: undefined });
    await c.tool(req({ name: 'reschedule_appointment', args: { appointment_id: 'bk_9', start_time: '16:00', phone: '+18565550190', confirmed: true }, invocation_id: 'i', call: { call_id: 'call_77', direction: 'inbound', from_number: '+18565550190' } }));
    expect(manage.rescheduleAppointment.mock.calls[0][1]).toMatchObject({ appointmentId: 'bk_9', startTime: '16:00', callSessionId: sid });
  });
});
