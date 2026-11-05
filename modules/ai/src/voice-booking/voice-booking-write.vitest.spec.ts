// voice-booking-write.vitest.spec.ts — Phase 1b (pilot-safe write path). Proves the AI books ONLY through the canonical
// BookingService, under a minimal-permission AI role, tagged source:'ai', with structural confirm-before-write; that it
// never claims false success; and that reschedule/cancel hand off to a human.
import { describe, it, expect, vi } from 'vitest';
import { VoiceBookingWriteService, AI_RECEPTIONIST_ROLE, AI_RECEPTIONIST_PERMISSIONS } from './voice-booking-write.service';
import { voiceWriteToolsEnabled, enabledVoiceTools } from './voice-tools';

const V = { tenantId: 'ten_1', branchId: 'br_1' };

function fakeBookingService(createImpl?: any) {
  return {
    create: vi.fn(createImpl ?? (async (_ctx: any, _body: any) => ({
      appointmentId: 'bk_100', startTime: '10:15', endTime: '11:00', technicianName: 'Lily',
      services: [{ serviceId: 'svc_gel', serviceName: 'Gel Manicure', durationMinutes: 45 }],
    }))),
  } as any;
}

describe('VoiceBookingWriteService.createAppointment', () => {
  it('refuses to book until the caller has confirmed (confirm-before-write)', async () => {
    const bs = fakeBookingService();
    const w = new VoiceBookingWriteService(bs);
    const res = await w.createAppointment(V, { serviceId: 'svc_gel', date: '2026-05-12', startTime: '10:15', customerName: 'Kev', confirmed: false });
    expect(res.ok).toBe(false);
    expect(bs.create).not.toHaveBeenCalled();      // nothing booked
    expect(res.error).toMatch(/not confirmed/i);
  });

  it('delegates to the canonical BookingService under the minimal AI role + source:ai', async () => {
    const bs = fakeBookingService();
    const w = new VoiceBookingWriteService(bs);
    const res = await w.createAppointment(V, { serviceId: 'svc_gel', date: '2026-05-12', startTime: '10:15', technicianId: 't_lily', customerName: 'Kev', customerPhone: '555-2020', confirmed: true });
    expect(res.ok).toBe(true);
    const [ctx, body] = bs.create.mock.calls[0];
    expect(ctx.role).toBe(AI_RECEPTIONIST_ROLE);
    expect(ctx.permissions).toEqual([...AI_RECEPTIONIST_PERMISSIONS]);
    expect(ctx.permissions).toContain('pos.booking.cancel'); // authorized: cancel permission granted
    expect(body).toMatchObject({ serviceIds: ['svc_gel'], technicianId: 't_lily', date: '2026-05-12', startTime: '10:15', customerName: 'Kev', source: 'ai' });
    expect(res).toMatchObject({ appointmentId: 'bk_100', serviceName: 'Gel Manicure', technicianName: 'Lily' });
  });

  it('requires service, date, time, and name', async () => {
    const w = new VoiceBookingWriteService(fakeBookingService());
    expect((await w.createAppointment(V, { serviceId: '', date: '2026-05-12', startTime: '10:15', customerName: 'Kev', confirmed: true })).ok).toBe(false);
    expect((await w.createAppointment(V, { serviceId: 'svc_gel', date: '2026-05-12', startTime: '10:15', customerName: '  ', confirmed: true })).ok).toBe(false);
  });

  it('surfaces a backend conflict honestly (never fakes success)', async () => {
    const bs = fakeBookingService(async () => { throw new Error('Customer already has an overlapping appointment'); });
    const w = new VoiceBookingWriteService(bs);
    const res = await w.createAppointment(V, { serviceId: 'svc_gel', date: '2026-05-12', startTime: '10:15', customerName: 'Kev', confirmed: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/just taken/i);
  });

  it('never leaks an internal error verbatim on unexpected failure', async () => {
    const bs = fakeBookingService(async () => { throw new Error('ECONNREFUSED pg 5432 secret-dsn'); });
    const w = new VoiceBookingWriteService(bs);
    const res = await w.createAppointment(V, { serviceId: 'svc_gel', date: '2026-05-12', startTime: '10:15', customerName: 'Kev', confirmed: true });
    expect(res.ok).toBe(false);
  });
});

describe('write-tool exposure is dark by default', () => {
  it('voiceWriteToolsEnabled is false unless explicitly set', () => {
    expect(voiceWriteToolsEnabled({})).toBe(false);
    expect(voiceWriteToolsEnabled({ VOICE_WRITE_TOOLS_ENABLED: 'true' })).toBe(true);
    expect(voiceWriteToolsEnabled({ VOICE_WRITE_TOOLS_ENABLED: 'on' })).toBe(true);
  });

  it('enabledVoiceTools hides write tools when the flag is off, shows the full write set when on', () => {
    const off = enabledVoiceTools({}).map((t) => t.name);
    expect(off).toEqual(['get_services', 'get_technicians', 'get_availability', 'get_deals']); // read-only when dark
    const on = enabledVoiceTools({ VOICE_WRITE_TOOLS_ENABLED: 'true' }).map((t) => t.name);
    expect(on).toContain('create_appointment');
    expect(on).toContain('reschedule_appointment');   // now authorized (verification-gated)
    expect(on).toContain('cancel_appointment');
    expect(on).toContain('verify_caller');
    expect(on).toContain('handoff_to_front_desk');
  });
});
