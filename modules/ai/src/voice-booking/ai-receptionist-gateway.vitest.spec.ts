// ai-receptionist-gateway.vitest.spec.ts — Phase 1 Booking Gateway contracts. Covers the spec's highest-stakes rules:
// the stable envelope + error taxonomy, Idempotency-Key semantics (required / replay / conflict / in-flight / release
// on failure), the write-flag-off handoff behavior (never fake success), server-derived handoff destination,
// verification-gated detail with the cross-customer block, DST-correct branch-timezone ISO, and the rate limiter.
import { describe, it, expect, vi } from 'vitest';
import { AiReceptionistGatewayController } from './ai-receptionist-gateway.controller';
import { VoiceIdempotencyService, InMemoryVoiceIdempotencyRepo } from './voice-idempotency.service';
import { gwFail, mapGatewayError, hashPayload, isoAt, dayNameOf, addDays, maskPhone, FixedWindowLimiter, GW_ERRORS } from './voice-gateway-core';
import { ConflictError, ValidationError } from '@aipowersalon/booking';

const V = { tenantId: 'ten_1', branchId: 'br_1' };
const req = () => ({ voiceCtx: V });
const HOURS = { timezone: 'America/New_York', storeHours: { monday: { isOpen: true, openTime: '09:00', closeTime: '19:30' }, tuesday: { isOpen: true, openTime: '09:00', closeTime: '19:30' }, wednesday: { isOpen: true, openTime: '09:00', closeTime: '19:30' }, thursday: { isOpen: true, openTime: '09:00', closeTime: '19:30' }, friday: { isOpen: true, openTime: '09:00', closeTime: '19:30' }, saturday: { isOpen: true, openTime: '09:00', closeTime: '19:30' }, sunday: { isOpen: false, openTime: null, closeTime: null } } };

function ctrl(over: any = {}) {
  const gateway = over.gateway ?? { services: vi.fn(async () => [{ serviceId: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500 }]), availability: vi.fn(async () => [{ startTime: '10:00', endTime: '10:45', technicianId: 't1', durationMinutes: 45, priceEstimateCents: 4500 }]) };
  const write = over.write ?? { createAppointment: vi.fn(async () => ({ ok: true, appointmentId: 'bk_1', date: '2026-07-06', startTime: '10:00', endTime: '10:45', technicianName: 'Amy', serviceName: 'Gel Manicure' })) };
  const manage = over.manage ?? {
    verifyCaller: vi.fn(async () => ({ verified: true, customerId: 'c1', phone: '8565552020', name: 'Kevin' })),
    getOwnAppointment: vi.fn(async () => ({ ok: true, appointment: { id: 'bk_1', status: 'booked', date: '2026-07-06', startTime: '10:00', endTime: '10:45', services: [], technician: null, customer: { firstName: 'Kevin' }, canReschedule: true, canCancel: true } })),
    rescheduleAppointment: vi.fn(async () => ({ ok: true, appointmentId: 'bk_1', date: '2026-07-07', startTime: '14:00', endTime: '14:45' })),
    cancelAppointment: vi.fn(async () => ({ ok: true, appointmentId: 'bk_1' })),
    lookupOrCreateCustomer: vi.fn(async () => ({ ok: true, customerId: 'c1', created: false, matchType: 'PHONE_EXACT', customer: { firstName: 'Kevin', lastName: null, phone: '8565552020' } })),
    customerContact: vi.fn(async () => ({ name: 'Kevin Dang', phone: '8565552020' })),
    filterBookable: vi.fn(async (_v: any, _d: any, opts: any[]) => opts),
  };
  const idem = over.idem ?? new VoiceIdempotencyService(new InMemoryVoiceIdempotencyRepo());
  const branchInfo = over.branchInfo ?? { storeHours: vi.fn(async () => HOURS), transferDestination: vi.fn(async () => '+18565559876') };
  const outcomes = over.outcomes ?? { record: vi.fn(async () => ({ id: 'oc_1' })) };
  const followUps = over.followUps ?? { createFromHandoff: vi.fn(async () => ({ id: 'fu_1' })) };
  return { c: new AiReceptionistGatewayController(gateway as any, write as any, manage as any, idem, branchInfo as any, outcomes as any, followUps as any), gateway, write, manage, branchInfo, outcomes, followUps };
}
const fail = async (p: Promise<any>) => { try { await p; return null; } catch (e: any) { return e?.getResponse?.() ?? e; } };

describe('gateway core', () => {
  it('error taxonomy carries status + retryable + suggestedAction', () => {
    expect(GW_ERRORS.SLOT_UNAVAILABLE).toMatchObject({ status: 409, retryable: true, suggestedAction: 'CHECK_AVAILABILITY' });
    const e = (() => { try { gwFail('SLOT_UNAVAILABLE', 'Taken.', 'req_1'); } catch (x: any) { return x; } })();
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse()).toMatchObject({ success: false, error: { code: 'SLOT_UNAVAILABLE', retryable: true }, meta: { requestId: 'req_1' } });
  });
  it('maps ConflictError → SLOT_UNAVAILABLE and ValidationError → VALIDATION_ERROR; internals never leak', () => {
    const c = (() => { try { mapGatewayError(new ConflictError('Technician already booked'), 'r'); } catch (x: any) { return x.getResponse(); } })();
    expect(c.error.code).toBe('SLOT_UNAVAILABLE');
    const v = (() => { try { mapGatewayError(new ValidationError('Service is required'), 'r'); } catch (x: any) { return x.getResponse(); } })();
    expect(v.error.code).toBe('VALIDATION_ERROR');
    const i = (() => { try { mapGatewayError(new Error('pg: relation xyz broke at /srv/db.ts:42'), 'r'); } catch (x: any) { return x.getResponse(); } })();
    expect(i.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(i)).not.toMatch(/pg:|\/srv|relation/); // sanitized
  });
  it('hashPayload is key-order stable and value sensitive', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
  it('isoAt returns the branch offset — DST-correct (EDT in July, EST in January)', () => {
    expect(isoAt('2026-07-06', '10:00', 'America/New_York')).toBe('2026-07-06T10:00:00-04:00');
    expect(isoAt('2026-01-12', '10:00', 'America/New_York')).toBe('2026-01-12T10:00:00-05:00');
    expect(isoAt('2026-07-06', '10:00', null)).toBe('2026-07-06T10:00:00'); // honest: no tz → no fabricated offset
  });
  it('day helpers + phone masking', () => {
    expect(dayNameOf('2026-07-06')).toBe('monday');
    expect(addDays('2026-07-06', 1)).toBe('2026-07-07');
    expect(maskPhone('+1 (856) 555-2020')).toBe('***-***-2020');
  });
  it('rate limiter allows within the window and blocks over it with a retry-after', () => {
    const l = new FixedWindowLimiter(2, 60_000);
    expect(l.allow('k', 0).ok).toBe(true);
    expect(l.allow('k', 1).ok).toBe(true);
    const third = l.allow('k', 2);
    expect(third.ok).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);
    expect(l.allow('k', 60_001).ok).toBe(true); // window reset
  });
});

describe('reads: services / hours / availability', () => {
  it('services returns the envelope with tenantTimezone', async () => {
    const { c } = ctrl();
    const out: any = await c.services(req());
    expect(out.success).toBe(true);
    expect(out.data.services[0].priceCents).toBe(4500); // integer cents, repo invariant
    expect(out.meta.tenantTimezone).toBe('America/New_York');
  });
  it('hours maps per-day store hours over a bounded range (Sunday closed)', async () => {
    const { c } = ctrl();
    const out: any = await c.hours(req(), '2026-07-06', '7');
    expect(out.data.hours).toHaveLength(7);
    expect(out.data.hours[0]).toMatchObject({ date: '2026-07-06', dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00' });
    expect(out.data.hours.find((h: any) => h.dayOfWeek === 'SUNDAY')).toMatchObject({ isOpen: false, openTime: null });
  });
  it('availability requires serviceId + date and returns offset ISO slots', async () => {
    const { c } = ctrl();
    const bad: any = await fail(c.availability(req(), '', '2026-07-06'));
    expect(bad.error.code).toBe('VALIDATION_ERROR');
    const out: any = await c.availability(req(), 's1', '2026-07-06');
    expect(out.data.slots[0].startAt).toBe('2026-07-06T10:00:00-04:00');
  });
});

describe('idempotency semantics on mutations', () => {
  const body = { serviceId: 's1', date: '2026-07-06', startTime: '10:00', customerName: 'Kevin', callerConfirmed: true };
  const on = async (fn: () => Promise<any>) => { process.env.VOICE_WRITE_TOOLS_ENABLED = 'true'; try { return await fn(); } finally { delete process.env.VOICE_WRITE_TOOLS_ENABLED; } };

  it('a mutation without an Idempotency-Key is refused', async () => {
    const { c } = ctrl();
    const out: any = await on(() => fail(c.book(req(), body, undefined)));
    expect(out.error.code).toBe('VALIDATION_ERROR');
    expect(out.error.message).toMatch(/Idempotency-Key/);
  });
  it('a retried identical call replays the original result — the appointment is created ONCE', async () => {
    const { c, write } = ctrl();
    const first: any = await on(() => c.book(req(), body, 'fn_1'));
    const second: any = await on(() => c.book(req(), body, 'fn_1'));
    expect(write.createAppointment).toHaveBeenCalledTimes(1); // the §20 guarantee
    expect(second.data.appointment.id).toBe(first.data.appointment.id);
    expect(second.meta.idempotentReplay).toBe(true);
  });
  it('the same key with a DIFFERENT payload is an idempotency conflict', async () => {
    const { c } = ctrl();
    await on(() => c.book(req(), body, 'fn_2'));
    const out: any = await on(() => fail(c.book(req(), { ...body, startTime: '11:00' }, 'fn_2')));
    expect(out.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('a failed request releases its key so a clean retry can proceed', async () => {
    const write = { createAppointment: vi.fn(async () => { throw new ConflictError('taken'); }) };
    const shared = new VoiceIdempotencyService(new InMemoryVoiceIdempotencyRepo());
    const bad = ctrl({ write, idem: shared });
    const out: any = await on(() => fail(bad.c.book(req(), body, 'fn_3')));
    expect(out.error.code).toBe('SLOT_UNAVAILABLE');
    const good = ctrl({ idem: shared });                       // same idempotency store, healthy write path
    const retry: any = await on(() => good.c.book(req(), body, 'fn_3'));
    expect(retry.success).toBe(true);                          // key was released, retry proceeds
  });
});

describe('write flag + verification + handoff', () => {
  it('mutations while writes are dark return HUMAN_HANDOFF_REQUIRED — never fake success', async () => {
    const { c, write } = ctrl();
    const out: any = await fail(c.book(req(), { callerConfirmed: true }, 'fn_9'));
    expect(out.error.code).toBe('HUMAN_HANDOFF_REQUIRED');
    expect(out.error.suggestedAction).toBe('HANDOFF_TO_HUMAN');
    expect(write.createAppointment).not.toHaveBeenCalled();
  });
  it('booking without caller confirmation is refused', async () => {
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    try {
      const { c, write } = ctrl();
      const out: any = await fail(c.book(req(), { serviceId: 's1', date: '2026-07-06', startTime: '10:00', customerName: 'K' }, 'fn_10'));
      expect(out.error.code).toBe('CONFIRMATION_REQUIRED');
      expect(write.createAppointment).not.toHaveBeenCalled();
    } finally { delete process.env.VOICE_WRITE_TOOLS_ENABLED; }
  });
  it('appointment detail is verification-gated; an unverified phone gets CALLER_VERIFICATION_REQUIRED', async () => {
    const { c } = ctrl({ manage: { verifyCaller: vi.fn(async () => null) } });
    const out: any = await fail(c.getAppointment(req(), 'bk_1', '999-999-9999'));
    expect(out.error.code).toBe('CALLER_VERIFICATION_REQUIRED');
  });
  it("another customer's appointment reads as APPOINTMENT_NOT_FOUND (cross-customer block preserved)", async () => {
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    try {
      const manage = { verifyCaller: vi.fn(async () => ({ verified: true, customerId: 'c1', phone: '8565552020', name: 'K' })), rescheduleAppointment: vi.fn(async () => ({ ok: false, error: 'I couldn\u2019t find that appointment under your account.' })) };
      const { c } = ctrl({ manage });
      const out: any = await fail(c.reschedule(req(), 'bk_other', { phone: '8565552020', startTime: '14:00', callerConfirmed: true }, 'fn_11'));
      expect(out.error.code).toBe('APPOINTMENT_NOT_FOUND');   // never reveals it exists
    } finally { delete process.env.VOICE_WRITE_TOOLS_ENABLED; }
  });
  it('handoff destination is server-derived and works even when writes are dark; callback fallback when unconfigured', async () => {
    const { c, branchInfo } = ctrl();
    const out: any = await c.handoff(req(), { reason: 'CUSTOMER_REQUESTED_HUMAN', callId: 'call_1' }, 'fn_12');
    expect(out.data.handoff.transferDestination).toBe('+18565559876'); // from the branch record, not the request
    expect(branchInfo.transferDestination).toHaveBeenCalled();
    const noDest = ctrl({ branchInfo: { storeHours: vi.fn(async () => HOURS), transferDestination: vi.fn(async () => null) } });
    const cb: any = await noDest.c.handoff(req(), { reason: 'OTHER', callId: 'call_9' }, 'fn_13');
    expect(cb.data.handoff).toMatchObject({ transferEnabled: false, callbackRequested: true });
    expect(noDest.followUps.createFromHandoff).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1' }), expect.objectContaining({ reason: 'CALLBACK', providerCallId: 'call_9' }));
    expect(cb.data.handoff.referenceId).toBe('fu_1');     // the created follow-up id is returned for staff reference
  });
  it('lookup-or-create: found customer works even when writes are dark; consent path surfaces CUSTOMER_CONSENT_REQUIRED when on', async () => {
    const { c } = ctrl();
    const found: any = await c.lookupOrCreateCustomer(req(), { phone: '8565552020' }, 'fn_14');
    expect(found.data).toMatchObject({ created: false, matchType: 'PHONE_EXACT' });
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    try {
      const noMatch = ctrl({ manage: { lookupOrCreateCustomer: vi.fn(async () => ({ ok: false, error: 'I can only save your details with your permission.' })) } });
      const out: any = await fail(noMatch.c.lookupOrCreateCustomer(req(), { phone: '2025550000', firstName: 'New' }, 'fn_15'));
      expect(out.error.code).toBe('CUSTOMER_CONSENT_REQUIRED');
    } finally { delete process.env.VOICE_WRITE_TOOLS_ENABLED; }
  });
});
