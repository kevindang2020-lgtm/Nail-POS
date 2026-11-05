// ai-receptionist-booking-verification.vitest.spec.ts — BUILD_PLAN Phase 4: a caller on the AI receptionist proves the
// phone on the booking and the booking completes.
//
// What the audit found, each pinned here:
//   • the booking refusal carried no booking session, so nothing could ever be verified FOR that booking;
//   • the keypad callback sat behind the voice-key guard (Twilio cannot present our key), read the context from the
//     wrong field (`req.ctx`), and took the number from `To` — the SALON's line;
//   • "verification temporarily unavailable" was word-matched into SLOT_UNAVAILABLE, so the agent offered other times;
//   • the refusal was committed under the Idempotency-Key, so the verified retry replayed "enter your code".
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  RemoteBookingAdmission, RemoteVerificationRequiredError, BookingVerificationUnavailableError, HoldSlotTakenError, ConflictError,
  sealVoiceCallback, openVoiceCallback,
} from '@aipowersalon/booking';
import { VoiceBookingWriteService, voicePrincipal } from './voice-booking-write.service';
import { AiReceptionistGatewayController } from './ai-receptionist-gateway.controller';
import { AiReceptionistVerificationController } from './ai-receptionist-verification.controller';
import { VoiceIdempotencyService, InMemoryVoiceIdempotencyRepo } from './voice-idempotency.service';

const V = { tenantId: 'ten_1', branchId: 'br_1' };
const SID = '11111111-2222-4333-8444-555555555555';
const seal = new RemoteBookingAdmission(null as any, null as any);   // seal/open only
const sealed = seal.seal(V.tenantId, voicePrincipal(V), SID);
const input = { serviceId: 's1', date: '2026-07-06', startTime: '10:00', customerName: 'Kim', customerPhone: '(856) 555-0142', confirmed: true };

function admissionWith(admit: any) {
  return { admit: vi.fn(admit), complete: vi.fn(async () => undefined), abandon: vi.fn(async () => undefined), open: seal.open.bind(seal) };
}
const okBooking = () => ({ create: vi.fn(async () => ({ appointmentId: 'appt-1', startTime: '10:00', endTime: '10:45', services: [{ serviceName: 'Gel' }] })) });

describe('the write service: the refusal is actionable on a call', () => {
  it('texts the code NOW to the number on the booking, and seals the keypad callback (salon, session, that number)', async () => {
    const codes = { send: vi.fn(async () => ({ status: 'code_sent', maskedPhone: '••••0142', message: 'sent' })) };
    const adm = admissionWith(async () => { throw new RemoteVerificationRequiredError('Please verify your phone number to continue.', sealed, '••••0142', 'required', Date.UTC(2026, 6, 6, 14, 10)); });
    const w = new VoiceBookingWriteService(okBooking() as any, adm as any, codes as any);
    const r = await w.createAppointment(V, input);
    expect(r).toMatchObject({ ok: false, needsVerification: true, codeSent: true, maskedPhone: '••••0142', bookingSessionId: sealed });
    expect(codes.send.mock.calls[0][0]).toMatchObject({ tenantId: 'ten_1', branchId: 'br_1', channel: 'ai_receptionist', bookingSessionId: SID });
    expect(codes.send.mock.calls[0][1]).toBe('+18565550142');
    expect(openVoiceCallback(r.callback)).toEqual({ tenantId: 'ten_1', branchId: 'br_1', sid: SID, phone: '+18565550142' });
    expect(adm.admit.mock.calls[0][0]).toMatchObject({ channel: 'ai_receptionist' });
  });

  it('presents the session again after the code → books, ties the proof to the appointment', async () => {
    const ticket = { label: 'verified', proof: { sessionId: 'vs-1' }, hold: { holdId: 'h1', bookingSessionId: SID } };
    const adm = admissionWith(async () => ticket);
    const booking = okBooking();
    const r = await new VoiceBookingWriteService(booking as any, adm as any).createAppointment(V, { ...input, bookingSessionId: sealed });
    expect(r).toMatchObject({ ok: true, appointmentId: 'appt-1' });
    expect(adm.admit.mock.calls[0][1]).toMatchObject({ bookingSessionToken: sealed, principal: 'voice:ten_1:br_1', serviceIds: ['s1'] });
    expect(adm.complete).toHaveBeenCalledWith(expect.objectContaining({ channel: 'ai_receptionist' }), ticket, 'appt-1');
  });

  it('the engine refusing gives the proof back; held-by-another → slotUnavailable; cannot verify → verificationUnavailable (never "slot")', async () => {
    const ticket = { label: 'verified', proof: { sessionId: 'vs-2' }, hold: null };
    const adm = admissionWith(async () => ticket);
    const r1 = await new VoiceBookingWriteService({ create: vi.fn(async () => { throw new ConflictError('taken'); }) } as any, adm as any).createAppointment(V, input);
    expect(r1.slotUnavailable).toBe(true);
    expect(adm.abandon).toHaveBeenCalledWith(ticket);
    const r2 = await new VoiceBookingWriteService(okBooking() as any, admissionWith(async () => { throw new HoldSlotTakenError('held'); }) as any).createAppointment(V, input);
    expect(r2.slotUnavailable).toBe(true);
    const r3 = await new VoiceBookingWriteService(okBooking() as any, admissionWith(async () => { throw new BookingVerificationUnavailableError('Online booking is temporarily unavailable. Please call the salon to book.', 'provider_unavailable'); }) as any).createAppointment(V, input);
    expect(r3).toMatchObject({ ok: false, verificationUnavailable: true });
    expect(r3.slotUnavailable).toBeUndefined();
  });
});

describe('the gateway: an instruction the voice platform can act on', () => {
  afterEach(() => { delete process.env.VOICE_WRITE_TOOLS_ENABLED; });
  const mk = (write: any) => {
    const idem = new VoiceIdempotencyService(new InMemoryVoiceIdempotencyRepo());
    const branchInfo = { storeHours: vi.fn(async () => ({ timezone: 'America/New_York' })) };
    return new AiReceptionistGatewayController({} as any, write, {} as any, idem, branchInfo as any, {} as any, {} as any);
  };
  const body = { serviceId: 's1', date: '2026-07-06', startTime: '10:00', customerName: 'Kim', customerPhone: '8565550142', callerConfirmed: true };

  it('collect_verification_code: DTMF, the sealed session, the keypad URLs — and the SAME key then books', async () => {
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    let proven = false;
    const cb = sealVoiceCallback({ tenantId: 'ten_1', branchId: 'br_1', sid: SID, phone: '+18565550142' });
    const write = { createAppointment: vi.fn(async (_v: any, i: any) => (proven && i.bookingSessionId === sealed
      ? { ok: true, appointmentId: 'appt-1', date: '2026-07-06', startTime: '10:00', endTime: '10:45' }
      : { ok: false, needsVerification: true, error: 'Please verify your phone number to continue.', maskedPhone: '••••0142', bookingSessionId: sealed, holdExpiresAt: null, codeSent: true, callback: cb })) };
    const c = mk(write);
    const first: any = await c.book({ voiceCtx: V }, body, 'idem-1');
    expect(first).toMatchObject({ action: 'collect_verification_code', input: 'dtmf', numDigits: 6, codeSent: true, bookingSessionId: sealed, maskedPhone: '••••0142' });
    expect(first.dtmfUrl).toContain('/api/ai-receptionist/v1/verification/dtmf?vc=' + encodeURIComponent(cb));
    expect(first.say).toContain('0142');
    expect(JSON.stringify(first)).not.toContain('8565550142');
    proven = true;
    const second: any = await c.book({ voiceCtx: V }, { ...body, bookingSessionId: sealed }, 'idem-1');
    expect(second.success).toBe(true);
    expect(second.data.appointment.id).toBe('appt-1');
  });

  it('verification unavailable → PHONE_VERIFICATION_UNAVAILABLE (handoff), not SLOT_UNAVAILABLE', async () => {
    process.env.VOICE_WRITE_TOOLS_ENABLED = 'true';
    const c = mk({ createAppointment: vi.fn(async () => ({ ok: false, verificationUnavailable: true, error: 'Online booking is temporarily unavailable. Please call the salon to book.' })) });
    const out: any = await c.book({ voiceCtx: V }, body, 'idem-2').catch((e: any) => e.getResponse());
    expect(out.error.code).toBe('PHONE_VERIFICATION_UNAVAILABLE');
    expect(out.error.suggestedAction).toBe('HANDOFF_TO_HUMAN');
  });
});

describe('the keypad callback carries its own credential', () => {
  const svc = () => ({ check: vi.fn(async (_c: any, _p: string, code: string) => (code === '424242' ? { status: 'phone_verified', message: 'ok' } : { status: 'incorrect_code', message: 'That code is incorrect.' })) });
  const vc = sealVoiceCallback({ tenantId: 'ten_1', branchId: 'br_1', sid: SID, phone: '+18565550142' });

  it('checks the digits for the session and the number IN the sealed token — never `To` (the salon’s line)', async () => {
    const s = svc();
    const out: any = await new AiReceptionistVerificationController(s as any, seal).dtmf(vc, undefined, undefined, { Digits: '424242', To: '+18565559999' });
    expect(out).toMatchObject({ ok: true, status: 'phone_verified', entered: '[6 digits entered]' });
    expect(s.check.mock.calls[0][0]).toMatchObject({ tenantId: 'ten_1', branchId: 'br_1', bookingSessionId: SID, channel: 'ai_receptionist' });
    expect(s.check.mock.calls[0][1]).toBe('+18565550142');
    expect(JSON.stringify(out)).not.toContain('424242');
  });

  it('no token, a forged one, or an expired one → expired, and nothing is checked', async () => {
    const s = svc();
    const c = new AiReceptionistVerificationController(s as any, seal);
    const expired = sealVoiceCallback({ tenantId: 'ten_1', branchId: 'br_1', sid: SID, phone: '+18565550142' }, { now: Date.now() - 3_600_000 });
    for (const t of [undefined, 'vc.forged.token.x', vc.slice(0, -4) + 'AAAA', expired]) {
      expect(await c.dtmf(t, undefined, undefined, { Digits: '424242' })).toMatchObject({ ok: false, status: 'code_expired' });
    }
    expect(s.check).not.toHaveBeenCalled();
  });

  it('Twilio-native: the TwiML gathers DTMF only and posts back with the same token; the reply is TwiML', async () => {
    const c = new AiReceptionistVerificationController(svc() as any, seal);
    const twiml = c.twiml(vc, undefined, 'https://platform.example/resume');
    expect(twiml).toContain('input="dtmf"');
    expect(twiml).toContain(encodeURIComponent(vc).replace(/&/g, '&amp;'));
    expect(twiml).toContain('format=twiml');
    const res = { type: vi.fn() };
    const xml = await c.dtmf(vc, 'twiml', 'https://platform.example/resume', { Digits: '000000' }, res);
    expect(String(xml)).toContain('<Say>That code is incorrect.</Say>');
    expect(String(xml)).toContain('<Redirect method="POST">https://platform.example/resume</Redirect>');
    expect(res.type).toHaveBeenCalledWith('text/xml');
    expect(c.twiml('vc.bad')).toContain('expired');
  });

  it('resend (behind the key): a session sealed for ANOTHER line is refused', async () => {
    const codes = { send: vi.fn(), check: vi.fn() };
    const c = new AiReceptionistVerificationController(codes as any, seal);
    const other = seal.seal('ten_1', voicePrincipal({ tenantId: 'ten_1', branchId: 'br_OTHER' }), SID);
    await expect(c.send({ voiceCtx: V }, { bookingSessionId: other, customerPhone: '8565550142' })).rejects.toMatchObject({ status: 400 });
    expect(codes.send).not.toHaveBeenCalled();
    codes.send.mockResolvedValue({ status: 'code_sent', maskedPhone: '••••0142', message: 'sent' });
    const ok: any = await c.send({ voiceCtx: V }, { bookingSessionId: sealed, customerPhone: '8565550142' });
    expect(ok).toMatchObject({ ok: true, status: 'code_sent' });
    expect(openVoiceCallback(decodeURIComponent(ok.dtmfUrl.split('vc=')[1]))).toMatchObject({ sid: SID, phone: '+18565550142' });
  });
});
