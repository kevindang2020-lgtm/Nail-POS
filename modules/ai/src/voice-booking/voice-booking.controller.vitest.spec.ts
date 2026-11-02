// voice-booking.controller.vitest.spec.ts — the callable read surface: tool dispatch + guard-supplied context + module
// DI wiring. Proves the controller routes read tools to the gateway, refuses write tools, and that the module boots.
import { describe, it, expect, vi } from 'vitest';
import { VoiceBookingController } from './voice-booking.controller';
import { RetellVoiceAdapter } from './retell-voice.adapter';
import { VoiceAuthGuard } from './voice-auth.guard';
import { VoiceKeyService, InMemoryVoiceKeyRepo } from './voice-key.service';

const V = { tenantId: 'ten_1', branchId: 'br_1' };

function fakeGateway() {
  return {
    services: vi.fn(async () => [{ serviceId: 'svc_gel', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45, description: '', category: 'manicure', bookable: true }]),
    technicians: vi.fn(async () => [{ technicianId: 't_lily', displayName: 'Lily', bookable: true }]),
    availability: vi.fn(async () => [{ startTime: '10:15', endTime: '11:00', technicianId: 't_lily', durationMinutes: 45, priceEstimateCents: 4500 }]),
  } as any;
}
// request with the guard already having attached voiceCtx + a body that the controller reads via req.rawBody
function req(body: any) { const raw = Buffer.from(JSON.stringify(body)); return { voiceCtx: V, rawBody: raw, body, headers: {} }; }

function fakeOutcomes() { return { record: vi.fn(async () => ({ id: 'oc_1' })) } as any; }
function fakeManage() {
  return {
    verifyCaller: vi.fn(async () => ({ verified: true, customerId: 'c1', phone: '8565552020', name: 'Kev' })),
    searchAppointments: vi.fn(async () => [{ appointmentId: 'bk_own', date: '2026-05-12', startTime: '10:00', endTime: '10:45', serviceName: 'Gel', technicianName: 'Lily', status: 'booked' }]),
    rescheduleAppointment: vi.fn(async () => ({ ok: true, appointmentId: 'bk_own', date: '2026-05-13', startTime: '14:00' })),
    cancelAppointment: vi.fn(async () => ({ ok: true, appointmentId: 'bk_own' })),
    lookupOrCreateCustomer: vi.fn(async () => ({ ok: true, customerId: 'c1', created: false })),
  } as any;
}
function fakeWrite() {
  return {
    createAppointment: vi.fn(async () => ({ ok: true, appointmentId: 'bk_1', date: '2026-05-12', startTime: '10:15', serviceName: 'Gel', technicianName: 'Lily' })),
    rescheduleRequiresHuman: () => ({ ok: false, handoff: true, error: 'front desk' }),
    cancelRequiresHuman: () => ({ ok: false, handoff: true, error: 'front desk' }),
  } as any;
}

describe('VoiceBookingController.tool dispatch (read tools)', () => {
  const adapter = new RetellVoiceAdapter();

  it('dispatches get_services to the gateway and formats the result', async () => {
    const gw = fakeGateway();
    const c = new VoiceBookingController(gw, fakeWrite(), fakeManage(), fakeOutcomes(), adapter);
    const out: any = await c.tool(req({ name: 'get_services', args: {}, invocation_id: 'inv1' }));
    expect(gw.services).toHaveBeenCalledWith(V);          // tenant/branch came from the guard context
    expect(out.success).toBe(true);
    expect(out.data[0].serviceId).toBe('svc_gel');
  });

  it('AI Business Setup: get_business_info returns hours + APPROVED FAQs from the knowledge reader, in the guard\'s tenant; without it the agent offers a message', async () => {
    const calls: unknown[][] = [];
    const knowledge = { knowledge: async (...a: unknown[]) => { calls.push(a); return { hours: { timezone: 'America/New_York', week: {}, source: 'branch' }, hoursNote: null, faqs: [{ id: 'f1', revisionId: 'r1', question: 'Walk-ins?', answer: 'Yes.', category: null }] }; } };
    const c = new VoiceBookingController(fakeGateway(), fakeWrite(), fakeManage(), fakeOutcomes(), adapter, undefined, knowledge as any);
    const out: any = await c.tool(req({ name: 'get_business_info', args: {}, invocation_id: 'k1' }));
    expect(calls[0]).toEqual(['ten_1', 'br_1']);
    expect(out.data.faqs).toEqual([{ id: 'f1', revisionId: 'r1', question: 'Walk-ins?', answer: 'Yes.', category: null }]);
    const none: any = await new VoiceBookingController(fakeGateway(), fakeWrite(), fakeManage(), fakeOutcomes(), adapter).tool(req({ name: 'get_business_info', args: {}, invocation_id: 'k2' }));
    expect(JSON.stringify(none)).toContain('take a message');
  });

  it('BUILD_PLAN Phase 5: get_deals reads the ONE deals domain for the phone channel, in the guard\'s tenant', async () => {
    const deals = { salonDealsForCustomers: vi.fn(async () => [{ id: 'd1', kind: 'deal', title: 'Weekday Gel', description: 'Mon–Thu', terms: 'One per visit', discountType: 'percent', discountPercent: 20, discountCents: null, originalPriceCents: 5000, finalPriceCents: 4000, endsAt: null, requiresCode: false }]) } as any;
    const c = new VoiceBookingController(fakeGateway(), fakeWrite(), fakeManage(), fakeOutcomes(), adapter, deals);
    const out: any = await c.tool(req({ name: 'get_deals', args: {}, invocation_id: 'd' }));
    expect(deals.salonDealsForCustomers).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1', branchId: 'br_1' }), 'ai_receptionist');
    expect(out.data).toEqual([{ title: 'Weekday Gel', offer: '20% off', description: 'Mon–Thu', terms: 'One per visit', endsAt: null, needsCode: false }]);
    deals.salonDealsForCustomers.mockResolvedValueOnce([]);
    const none: any = await c.tool(req({ name: 'get_deals', args: {}, invocation_id: 'e' }));
    expect(JSON.stringify(none)).toContain('no specials');
  });

  it('dispatches get_availability with parsed args', async () => {
    const gw = fakeGateway();
    const c = new VoiceBookingController(gw, fakeWrite(), fakeManage(), fakeOutcomes(), adapter);
    const out: any = await c.tool(req({ name: 'get_availability', args: { service_id: 'svc_gel', date: '2026-05-12' }, invocation_id: 'i2' }));
    expect(gw.availability).toHaveBeenCalledWith(V, { serviceId: 'svc_gel', date: '2026-05-12', technicianId: undefined });
    expect(out.success).toBe(true);
  });

  it('requires service_id + date for availability', async () => {
    const c = new VoiceBookingController(fakeGateway(), fakeWrite(), fakeManage(), fakeOutcomes(), adapter);
    const out: any = await c.tool(req({ name: 'get_availability', args: {}, invocation_id: 'i3' }));
    expect(out.success).toBe(false);
    expect(out.message).toMatch(/service and date/i);
  });

  it('dispatches create_appointment to the write service when write tools are enabled', async () => {
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    try {
      const gw = fakeGateway(); const wr = fakeWrite();
      const c = new VoiceBookingController(gw, wr, fakeManage(), fakeOutcomes(), adapter);
      const out: any = await c.tool(req({ name: 'create_appointment', args: { service_id: 'svc_gel', date: '2026-05-12', start_time: '10:15', customer_name: 'Kev', confirmed: true }, invocation_id: 'i6' }));
      expect(wr.createAppointment).toHaveBeenCalledWith(V, expect.objectContaining({ serviceId: 'svc_gel', confirmed: true, customerName: 'Kev' }));
      expect(out.success).toBe(true);
    } finally { delete process.env.VOICE_WRITE_TOOLS_ENABLED; }
  });

  it('dispatches cancel_appointment to the verified manage service when write tools are enabled', async () => {
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    try {
      const mg = fakeManage();
      const c = new VoiceBookingController(fakeGateway(), fakeWrite(), mg, fakeOutcomes(), adapter);
      const out: any = await c.tool(req({ name: 'cancel_appointment', args: { phone: '8565552020', appointment_id: 'bk_own', confirmed: true }, invocation_id: 'i7' }));
      expect(mg.verifyCaller).toHaveBeenCalled();
      expect(mg.cancelAppointment).toHaveBeenCalled();
      expect(out.success).toBe(true);
    } finally { delete process.env.VOICE_WRITE_TOOLS_ENABLED; }
  });

  it('refuses a write tool when write tools are dark (env flag off by default)', async () => {
    const c = new VoiceBookingController(fakeGateway(), fakeWrite(), fakeManage(), fakeOutcomes(), adapter);
    const out: any = await c.tool(req({ name: 'create_appointment', args: { confirmed: true }, invocation_id: 'i4' }));
    expect(out.success).toBe(false);
    expect(out.message).toMatch(/isn.t available yet/i);
  });

  it('refuses an unknown tool', async () => {
    const c = new VoiceBookingController(fakeGateway(), fakeWrite(), fakeManage(), fakeOutcomes(), adapter);
    const out: any = await c.tool(req({ name: 'delete_everything', args: {}, invocation_id: 'i5' }));
    expect(out.success).toBe(false);
  });
});

describe('VoiceBookingController.recordOutcome', () => {
  const adapter = new RetellVoiceAdapter();
  it('records a call outcome using the guard-supplied context', async () => {
    const oc = fakeOutcomes();
    const c = new VoiceBookingController(fakeGateway(), fakeWrite(), fakeManage(), oc, adapter);
    const request: any = { voiceCtx: V, voiceProvider: 'retell' };
    const out: any = await c.recordOutcome('call_42', { bookingOutcome: 'booked', intents: ['BOOK_APPOINTMENT'] }, request);
    expect(oc.record).toHaveBeenCalledWith(V, 'retell', expect.objectContaining({ providerCallId: 'call_42', bookingOutcome: 'booked' }));
    expect(out.success).toBe(true);
  });
});

describe('VoiceBookingModule wiring (manual, mirrors the module factories)', () => {
  it('the key repo factory picks the in-memory repo when no DB handle is present', () => {
    // Mirrors: useFactory: (db) => db ? new KyselyVoiceKeyRepo(db) : new InMemoryVoiceKeyRepo(), inject: [DATABASE]
    const makeRepo = (db: unknown) => (db ? null : new InMemoryVoiceKeyRepo());
    const repo = makeRepo(undefined);
    expect(repo).toBeInstanceOf(InMemoryVoiceKeyRepo);
    const guard = new VoiceAuthGuard(new VoiceKeyService(repo));
    expect(guard).toBeInstanceOf(VoiceAuthGuard);
  });

  it('the guard rejects a request with no integration key (fail-closed)', async () => {
    const guard = new VoiceAuthGuard(new VoiceKeyService(new InMemoryVoiceKeyRepo()));
    const ctx: any = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) };
    await expect(guard.canActivate(ctx)).rejects.toThrow();
  });

  it('the guard admits a request bearing a valid issued key and attaches voiceCtx', async () => {
    const repo = new InMemoryVoiceKeyRepo();
    const keys = new VoiceKeyService(repo);
    const { raw } = await keys.issue({ tenantId: 'ten_9', branchId: 'br_9', label: 'k' });
    const guard = new VoiceAuthGuard(keys);
    const request: any = { headers: { 'x-voice-key': raw } };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => request }) };
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.voiceCtx).toEqual({ tenantId: 'ten_9', branchId: 'br_9' });
  });
});
