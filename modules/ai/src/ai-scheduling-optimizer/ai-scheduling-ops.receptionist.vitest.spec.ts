// ai-scheduling-ops.receptionist.vitest.spec — BUILD_PLAN Phase 7 (agent B): the AI receptionist (voice-booking) and the
// Reception Copilot find times through the optimizer's findOptions (one option finder), hold the best option when booking
// is intended (channel ai_receptionist / reception_copilot), and fall back to booking availability when the optimizer is
// not in the process or refuses.
import { describe, it, expect, vi } from 'vitest';
import type { SchedOptionsResponse } from '@aipowersalon/api-contracts/tenant';
import { VoiceBookingService, minutesBetween } from '../voice-booking/voice-booking.service';
import { ReceptionCopilotContextService } from '../ai-center/reception-copilot-context.service';
import { SchedOptionsBridge } from './ai-scheduling-ops.bridge';

const T = '55555555-0000-4000-8000-000000000001';
const B = '55555555-0000-4000-8000-000000000002';
const opt = (technicianId: string, technicianName: string, startTime: string, endTime: string, score: number) =>
  ({ id: `${technicianId}@2026-10-20T${startTime}`, technicianId, technicianName, date: '2026-10-20', startTime, endTime, score, breakdown: {}, blocks: [], reasons: [], fallback: false });
const RESPONSE: SchedOptionsResponse = {
  options: [opt('t_mia', 'Mia', '13:00', '13:45', 0.9), opt('t_lily', 'Lily', '10:00', '10:45', 0.8), opt('t_mia', 'Mia', '09:30', '10:15', 0.7)],
  forecastAvailable: true, hold: null,
};
const bridge = (impl: any = async () => RESPONSE) => { const b = new SchedOptionsBridge(); const engine = { findOptions: vi.fn(impl) }; b.bind(engine); return { b, engine }; };

function fakeBooking() {
  return {
    getOptions: vi.fn(async () => ({ services: [{ serviceId: 'svc_gel', name: 'Gel', durationMinutes: 45, basePriceCents: 4500 }], technicians: [] })),
    availability: vi.fn(async () => ({ date: '2026-10-20', serviceId: 'svc_gel', durationMinutes: 45, slots: [{ startTime: '11:00', available: true, technicianIds: ['t_x'] }] })),
  } as any;
}

describe('AI receptionist (voice-booking)', () => {
  const V = { tenantId: T, branchId: B };
  it('availability comes from findOptions, with a SYSTEM receptionist context, projected to the voice shape', async () => {
    const booking = fakeBooking(); const { b, engine } = bridge();
    const out = await new VoiceBookingService(booking, b).availability(V, { serviceId: 'svc_gel', date: '2026-10-20' });
    expect(booking.availability).not.toHaveBeenCalled();
    expect(out[0]).toEqual({ startTime: '13:00', endTime: '13:45', technicianId: 't_mia', durationMinutes: 45, priceEstimateCents: 4500 });
    const [ctx, req] = engine.findOptions.mock.calls[0];
    expect(ctx).toMatchObject({ tenantId: T, branchId: B, role: 'SYSTEM', actor: 'system', userId: 'system:voice-receptionist', permissions: ['ai_scheduling.view', 'pos.booking.create'] });   // Round 2 H: the hold key comes from its booking authorization
    expect(req).toMatchObject({ date: '2026-10-20', serviceIds: ['svc_gel'], hold: null, limit: 20 });
  });
  it('booking intended → holds the best option on the ai_receptionist channel', async () => {
    const { b, engine } = bridge(async () => ({ ...RESPONSE, hold: { holdId: 'h1', optionId: RESPONSE.options[0].id, expiresAt: 'x' } }));
    const out = await new VoiceBookingService(fakeBooking(), b).availabilityWithHold(V, { serviceId: 'svc_gel', date: '2026-10-20', bookingSessionId: 'sess-1' });
    expect(out.hold?.holdId).toBe('h1');
    expect(engine.findOptions.mock.calls[0][1].hold).toEqual({ channel: 'ai_receptionist', bookingSessionId: 'sess-1', customerId: null, seconds: null });
  });
  it('no optimizer / unbound / refused → the booking path answers exactly as before', async () => {
    const booking = fakeBooking();
    expect((await new VoiceBookingService(booking).availability(V, { serviceId: 'svc_gel', date: '2026-10-20' }))[0].startTime).toBe('11:00');
    expect((await new VoiceBookingService(booking, new SchedOptionsBridge()).availability(V, { serviceId: 'svc_gel', date: '2026-10-20' }))[0].startTime).toBe('11:00');
    const { b } = bridge(async () => { throw Object.assign(new Error('off'), { code: 'MODULE_DISABLED' }); });
    const r = await new VoiceBookingService(booking, b).availabilityWithHold(V, { serviceId: 'svc_gel', date: '2026-10-20' });
    expect(r).toMatchObject({ hold: null, options: [{ startTime: '11:00', technicianId: 't_x' }] });
  });
  it('minutesBetween', () => { expect(minutesBetween('09:30', '10:15')).toBe(45); expect(minutesBetween('10:00', '09:00')).toBe(0); expect(minutesBetween('x', '1')).toBe(0); });
});

describe('Reception Copilot', () => {
  const ctx = { tenantId: T, branchId: B, userId: '55555555-0000-4000-8000-0000000000f1', role: 'RECEPTION', permissions: ['ai_scheduling.view', 'ai_scheduling.generate', 'pos.booking.view'] };
  const make = (b: SchedOptionsBridge | null) => {
    const booking = { availability: vi.fn(async () => [{ technicianId: 't_x', name: 'Xia', slots: ['11:00'] }]), checkConflict: vi.fn() };
    return { booking, s: new ReceptionCopilotContextService({} as any, {} as any, booking as any, undefined, b) };
  };
  it('recommendAvailability: optimizer rank order, the receptionist\'s OWN session, hold on reception_copilot when asked', async () => {
    const { b, engine } = bridge(async () => ({ ...RESPONSE, hold: { holdId: 'h2', optionId: 'o', expiresAt: 'x' } }));
    const { s, booking } = make(b);
    const r = await s.recommendAvailability(ctx, { date: '2026-10-20', serviceIds: ['svc_gel'], hold: { customerId: 'c1' } });
    expect(booking.availability).not.toHaveBeenCalled();
    expect(r.source).toBe('optimizer');
    expect(r.recommendations.map((x) => x.time)).toEqual(['13:00', '10:00', '09:30']);
    expect(r.byTechnician).toEqual([{ technicianId: 't_mia', name: 'Mia', slotCount: 2, firstSlot: '09:30' }, { technicianId: 't_lily', name: 'Lily', slotCount: 1, firstSlot: '10:00' }]);
    expect(r.hold?.holdId).toBe('h2');
    const [c, req] = engine.findOptions.mock.calls[0];
    expect(c).toMatchObject({ userId: ctx.userId, role: 'RECEPTION', actor: 'user', permissions: ctx.permissions });
    expect(req.hold).toEqual({ channel: 'reception_copilot', customerId: 'c1', bookingSessionId: null });
  });
  it('recommendTechnicians: optimizer order, the usual technician floated up', async () => {
    const { b } = bridge();
    const r = await make(b).s.recommendTechnicians(ctx, { date: '2026-10-20', serviceIds: ['svc_gel'], preferredTechnicianName: 'lily' });
    expect(r.source).toBe('optimizer');
    expect(r.technicians.map((t) => [t.technicianId, t.isUsual, t.firstAvailable, t.openSlots])).toEqual([['t_lily', true, '10:00', 1], ['t_mia', false, '09:30', 2]]);
  });
  it('without a date / services, without the optimizer, or when it refuses → booking availability', async () => {
    const { b } = bridge(async () => { throw new Error('FORBIDDEN'); });
    const refused = make(b);
    expect((await refused.s.recommendAvailability(ctx, { date: '2026-10-20', serviceIds: ['svc_gel'] })).recommendations[0]).toMatchObject({ time: '11:00', technicianId: 't_x' });
    const none = make(null);
    expect((await none.s.recommendTechnicians(ctx, { date: '2026-10-20', serviceIds: ['svc_gel'] })).technicians[0].technicianId).toBe('t_x');
    const noDate = make(bridge().b);
    await noDate.s.recommendAvailability(ctx, { serviceIds: ['svc_gel'] });
    expect(noDate.booking.availability).toHaveBeenCalledTimes(1);
  });
});
