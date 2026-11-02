// ai-booking-mutation.vitest.spec.ts — the Stage 2 mutation facade. Proves the cross-channel contract: no write without
// explicit confirmation, idempotent replay (never double-book), channel source stamped onto the delegated create, and
// domain errors mapped to stable failure codes — all while delegating to the authoritative BookingService.
import { describe, it, expect, vi } from 'vitest';
import { AiBookingMutationService } from './ai-booking-mutation.service';
import { ConflictError, ForbiddenError } from '@aipowersalon/booking';

const ctx = { tenantId: 'ten_A', branchId: 'br_1', userId: 'u1', role: 'MANAGER', permissions: ['pos.booking.create','ai_booking.create','ai_booking.reschedule','ai_booking.cancel','ai_booking.confirm'], source: 'AI_PHONE_RECEPTIONIST' as const, correlationId: 'c1', supportSessionId: null };
const conv = () => ({ record: vi.fn(async () => undefined) });

describe('AiBookingMutationService', () => {
  it('refuses to write without explicit confirmation (no booking created)', async () => {
    const booking = { create: vi.fn() };
    const svc = new AiBookingMutationService(booking as any, conv() as any, undefined);
    const res = await svc.createAppointment(ctx, { customerName: 'A', serviceIds: ['s1'], date: '2026-07-11', startTime: '11:00', confirm: false });
    expect(res.requiresConfirmation).toBe(true);
    expect(res.errorCode).toBe('HUMAN_CONFIRMATION_REQUIRED');
    expect(booking.create).not.toHaveBeenCalled();
  });

  it('on confirm, delegates to BookingService.create and stamps the channel source', async () => {
    const booking = { create: vi.fn(async () => ({ appointmentId: 'appt_1' })) };
    const svc = new AiBookingMutationService(booking as any, conv() as any, undefined);
    const res = await svc.createAppointment(ctx, { customerName: 'A', serviceIds: ['s1'], date: '2026-07-11', startTime: '11:00', confirm: true });
    expect(res.ok).toBe(true);
    expect(res.appointmentId).toBe('appt_1');
    // AI_PHONE_RECEPTIONIST → domain source 'phone'; tenant/branch from trusted ctx
    expect(booking.create.mock.calls[0][0]).toMatchObject({ tenantId: 'ten_A', branchId: 'br_1' });
    expect(booking.create.mock.calls[0][1]).toMatchObject({ source: 'phone', serviceIds: ['s1'] });
  });

  it('replays an idempotent request instead of creating a second appointment', async () => {
    const booking = { create: vi.fn(async () => ({ appointmentId: 'appt_1' })) };
    const store = new Map<string, any>();
    const ledger = {
      find: async (t: string, k: string) => store.get(t + k) ?? null,
      record: async (t: string, _b: any, k: string, _op: string, ok: boolean, rid: string | null) => { store.set(t + k, { ok, resourceId: rid }); },
    };
    const svc = new AiBookingMutationService(booking as any, conv() as any, ledger as any);
    const first = await svc.createAppointment(ctx, { customerName: 'A', serviceIds: ['s1'], date: '2026-07-11', startTime: '11:00', confirm: true, idempotencyKey: 'idem-1' });
    const replay = await svc.createAppointment(ctx, { customerName: 'A', serviceIds: ['s1'], date: '2026-07-11', startTime: '11:00', confirm: true, idempotencyKey: 'idem-1' });
    expect(first.appointmentId).toBe('appt_1');
    expect(replay.duplicate).toBe(true);
    expect(replay.appointmentId).toBe('appt_1');
    expect(booking.create).toHaveBeenCalledTimes(1);   // never executed twice
  });

  it('maps a concurrent double-booking conflict to APPOINTMENT_CONFLICT', async () => {
    const booking = { create: vi.fn(async () => { throw new ConflictError('double-booked', 'appt_x'); }) };
    const svc = new AiBookingMutationService(booking as any, conv() as any, undefined);
    const res = await svc.createAppointment(ctx, { customerName: 'A', serviceIds: ['s1'], date: '2026-07-11', startTime: '11:00', confirm: true });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('APPOINTMENT_CONFLICT');
  });

  it('maps a permission failure to PERMISSION_DENIED', async () => {
    const booking = { cancel: vi.fn(async () => { throw new ForbiddenError(); }) };
    const svc = new AiBookingMutationService(booking as any, conv() as any, undefined);
    const res = await svc.cancelAppointment(ctx, 'appt_1', { reason: 'customer request', confirm: true });
    expect(res.errorCode).toBe('PERMISSION_DENIED');
  });

  it('records the funnel: attempt → succeeded on a confirmed create', async () => {
    const booking = { create: vi.fn(async () => ({ appointmentId: 'appt_1' })) };
    const conversion = conv();
    const svc = new AiBookingMutationService(booking as any, conversion as any, undefined);
    await svc.createAppointment(ctx, { customerName: 'A', serviceIds: ['s1'], date: '2026-07-11', startTime: '11:00', confirm: true });
    const stages = conversion.record.mock.calls.map((c: any) => c[1].stage);
    expect(stages).toContain('BOOKING_ATTEMPTED');
    expect(stages).toContain('BOOKING_SUCCEEDED');
  });
});

describe('AiBookingMutationService.confirmAppointment (§23)', () => {
  it('refuses without explicit confirmation', async () => {
    const booking = { confirm: vi.fn() };
    const svc = new AiBookingMutationService(booking as any, conv() as any, undefined);
    const res = await svc.confirmAppointment(ctx, 'appt_1', { confirm: false });
    expect(res.errorCode).toBe('HUMAN_CONFIRMATION_REQUIRED');
    expect(booking.confirm).not.toHaveBeenCalled();
  });
  it('delegates to BookingService.confirm and does NOT emit a conversion funnel event', async () => {
    const booking = { confirm: vi.fn(async () => ({ appointmentId: 'appt_1', status: 'confirmed' })) };
    const conversion = conv();
    const svc = new AiBookingMutationService(booking as any, conversion as any, undefined);
    const res = await svc.confirmAppointment(ctx, 'appt_1', { confirm: true });
    expect(res.ok).toBe(true);
    expect(booking.confirm).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_A' }), 'appt_1');
    expect(conversion.record).not.toHaveBeenCalled();   // confirmation is not a booking-conversion stage
  });
  it('is idempotent (replay returns original, engine runs once)', async () => {
    const booking = { confirm: vi.fn(async () => ({ appointmentId: 'appt_1' })) };
    const store = new Map<string, any>();
    const ledger = { find: async (t: string, k: string) => store.get(t + k) ?? null, record: async (t: string, _b: any, k: string, _op: string, ok: boolean, rid: string | null) => { store.set(t + k, { ok, resourceId: rid }); } };
    const svc = new AiBookingMutationService(booking as any, conv() as any, ledger as any);
    await svc.confirmAppointment(ctx, 'appt_1', { confirm: true, idempotencyKey: 'k1' });
    const replay = await svc.confirmAppointment(ctx, 'appt_1', { confirm: true, idempotencyKey: 'k1' });
    expect(replay.duplicate).toBe(true);
    expect(booking.confirm).toHaveBeenCalledTimes(1);
  });
});

describe('AiBookingMutationService §54 permission matrix', () => {
  it('denies create when the channel lacks ai_booking.create (even with the domain perm)', async () => {
    const booking = { create: vi.fn(async () => ({ appointmentId: 'a1' })) };
    const svc = new AiBookingMutationService(booking as any, conv() as any, undefined);
    const noAib = { ...ctx, permissions: ['pos.booking.create'] };   // domain perm only, no ai_booking.create
    const r = await svc.createAppointment(noAib as any, { customerName: 'A', serviceIds: ['s1'], date: '2026-07-11', startTime: '11:00', confirm: true });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('PERMISSION_DENIED');
    expect(booking.create).not.toHaveBeenCalled();
  });
});

// ── Phone-verification refusals must be ACTIONABLE codes, never INTERNAL_ERROR ────────────────────────────────
// Found while building the public (no-login) booking page: the refusals fell through mapError's default, so a guest on
// a signed public link was told "the booking action could not be completed". Phase 4: the public link admits through
// the shared verified-booking flow (RemoteBookingAdmission); these pin the mapping and the flow's use.
describe('AiBookingMutationService — the public link admits through the verified-booking flow', () => {
  const pub = { ...ctx, role: 'PUBLIC_BOOKING', source: 'ONLINE_BOOKING' as const, jti: 'link-1' };
  const admitting = (admit: any) => ({ admit: vi.fn(admit), complete: vi.fn(async () => undefined), abandon: vi.fn(async () => undefined) });
  const throwing = (e: Error) => admitting(async () => { throw e; });
  const mk = (adm: any, booking: any = { create: vi.fn() }, ledger?: any) => new AiBookingMutationService(booking as any, conv() as any, ledger, adm as any);
  const input = { customerName: 'A', customerPhone: '+18565550101', serviceIds: ['s1'], date: '2026-07-11', startTime: '11:00', confirm: true };

  it('unverified phone → PHONE_VERIFICATION_REQUIRED with the SEALED session, the mask and the hold end; booking NOT created', async () => {
    const { RemoteVerificationRequiredError } = await import('@aipowersalon/booking');
    const booking = { create: vi.fn() };
    const res = await mk(throwing(new RemoteVerificationRequiredError('Verify your phone to book.', 'sealed.tok', '••••0101', 'policy_requires', Date.UTC(2026, 6, 11, 15))), booking).createAppointment(pub as any, input);
    expect(res).toMatchObject({ ok: false, errorCode: 'PHONE_VERIFICATION_REQUIRED', bookingSessionId: 'sealed.tok', maskedPhone: '••••0101', holdExpiresAt: '2026-07-11T15:00:00.000Z' });
    expect(res.message).toContain('Verify your phone');
    expect(booking.create).not.toHaveBeenCalled();
  });

  it('the refusal is NOT recorded under the idempotency key — the verified retry with the same key books', async () => {
    const { RemoteVerificationRequiredError } = await import('@aipowersalon/booking');
    const store = new Map<string, any>();
    const ledger = { find: async (t: string, k: string) => store.get(t + k) ?? null, record: async (t: string, _b: any, k: string, _o: string, ok: boolean, rid: string | null) => { store.set(t + k, { ok, resourceId: rid }); } };
    let proven = false;
    const adm = admitting(async () => { if (!proven) throw new RemoteVerificationRequiredError('Verify.', 'tok', '••••0101', 'r', null); return { label: 'verified', proof: { sessionId: 'vs1' }, hold: null }; });
    const booking = { create: vi.fn(async () => ({ appointmentId: 'appt-9' })) };
    const svc = mk(adm, booking, ledger);
    expect((await svc.createAppointment(pub as any, { ...input, idempotencyKey: 'k1' })).errorCode).toBe('PHONE_VERIFICATION_REQUIRED');
    proven = true;
    const ok = await svc.createAppointment(pub as any, { ...input, idempotencyKey: 'k1', bookingSessionId: 'tok' });
    expect(ok).toMatchObject({ ok: true, appointmentId: 'appt-9' });
    expect(adm.admit.mock.calls[1][1]).toMatchObject({ principal: 'link:link-1', bookingSessionToken: 'tok', phone: '+18565550101' });
    expect(adm.complete).toHaveBeenCalledWith(expect.objectContaining({ channel: 'online' }), expect.objectContaining({ proof: { sessionId: 'vs1' } }), 'appt-9');
  });

  it('the engine refusing the booking gives the proof back (abandon), and reports its own error', async () => {
    const ticket = { label: 'verified', proof: { sessionId: 'vs2' }, hold: null };
    const adm = admitting(async () => ticket);
    const res = await mk(adm, { create: vi.fn(async () => { throw new ConflictError('taken'); }) }).createAppointment(pub as any, input);
    expect(res.errorCode).toBe('APPOINTMENT_CONFLICT');
    expect(adm.abandon).toHaveBeenCalledWith(ticket);
    expect(adm.complete).not.toHaveBeenCalled();
  });

  it('a slot held for another guest → APPOINTMENT_CONFLICT', async () => {
    const { HoldSlotTakenError } = await import('@aipowersalon/booking');
    expect((await mk(throwing(new HoldSlotTakenError('held'))).createAppointment(pub as any, input)).errorCode).toBe('APPOINTMENT_CONFLICT');
  });

  it('staff using the copilot are NOT asked for the customer\'s code (audit: it was checked as "online")', async () => {
    const adm = admitting(async () => { throw new Error('must not be called'); });
    const res = await mk(adm, { create: vi.fn(async () => ({ appointmentId: 'a1' })) }).createAppointment(ctx, input);
    expect(res.ok).toBe(true);
    expect(adm.admit).not.toHaveBeenCalled();
  });

  it('verification provider down → PHONE_VERIFICATION_UNAVAILABLE (refuses, never lets the booking through)', async () => {
    const { BookingVerificationUnavailableError } = await import('@aipowersalon/booking');
    const booking = { create: vi.fn() };
    const res = await mk(throwing(new BookingVerificationUnavailableError('Verification is unavailable.', 'provider_down')), booking).createAppointment(pub as any, input);
    expect(res.errorCode).toBe('PHONE_VERIFICATION_UNAVAILABLE');
    expect(booking.create).not.toHaveBeenCalled();
  });

  it('unparseable phone → INVALID_PHONE', async () => {
    const { BookingPhoneInvalidError } = await import('@aipowersalon/booking');
    expect((await mk(throwing(new BookingPhoneInvalidError())).createAppointment(pub as any, input)).errorCode).toBe('INVALID_PHONE');
  });

  // w4 sweep SW-20 (Oct 13 2026): a guest on the PUBLIC booking link proved the phone and retried — and was refused
  // "That time is being held for another booking". The verification hold placed on the first (refused) attempt is keyed
  // to the booking session; the create did not say which session it was, so the guest's OWN hold blocked the guest
  // (live-phase4-booking-verification: PUBLIC LINK retry). The customer app passes it; the link must too.
  it('a verified public-link booking is made FROM its own hold (holdSessionId = the admitted session)', async () => {
    const booking = { create: vi.fn(async () => ({ appointmentId: 'appt_9' })) };
    const verification = { admit: vi.fn(async () => ({ proofId: 'p1', hold: { holdId: 'h1', bookingSessionId: 'sess-opened-1' } })), complete: vi.fn(async () => undefined), abandon: vi.fn(async () => undefined) };
    const svc = new AiBookingMutationService(booking as any, conv() as any, undefined, verification as any);
    const pub = { ...ctx, role: 'PUBLIC_BOOKING', permissions: ['ai_booking.create'], source: 'ONLINE_BOOKING' as const, jti: 'jti-1' } as any;
    const res = await svc.createAppointment(pub, { customerName: 'Gwen', customerPhone: '+16095550111', serviceIds: ['s1'], date: '2026-10-20', startTime: '11:00', confirm: true, bookingSessionId: 'bs~sealed' });
    expect(res.ok).toBe(true);
    expect(booking.create.mock.calls[0][1]).toMatchObject({ holdSessionId: 'sess-opened-1' });
    expect(verification.complete).toHaveBeenCalled();
  });
});
