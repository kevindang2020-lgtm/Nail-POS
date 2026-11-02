// ai-receptionist-verification.controller.ts — collecting a verification code on a phone call, WITHOUT letting it
// into the audio.
//
// ══ WHY THIS IS NOT JUST "EMIT A <Gather>" ════════════════════════════════════════════════════════════════
//
// The AI receptionist gateway (`api/ai-receptionist/v1`) emits **no TwiML at all** — it is a JSON API, and an
// external voice platform drives the call. We do not own the call flow, so we cannot simply hand Twilio a
// `<Gather>` from inside a booking response.
//
// So there are two doors, because there are two kinds of caller:
//
//   1. `POST appointments` refuses with a STRUCTURED INSTRUCTION when a code is needed. Any platform — Twilio,
//      ConversationRelay, Vonage, a bespoke stack — can read `action: 'collect_verification_code'` and do the
//      right thing with its own primitives.
//
//   2. `GET verification/twiml` returns ready-made TwiML for a platform that speaks Twilio natively.
//
// ══ THE POINT: THE DIGITS NEVER TOUCH THE RECOGNISER ══════════════════════════════════════════════════════
//
// `input="dtmf"` ONLY. Speech is not accepted, deliberately.
//
// I probed the platform's transcript redactor with the cases a real call produces, and **four of five leaked** —
// because a real exchange splits the keyword from the value across two turns ("say your six-digit code" / "one
// two three four five six"), and the redactor works one segment at a time. That is structural, not a tuning
// problem.
//
// A redactor that is 95% effective on an authentication secret is not a security control; it is a 5% leak. DTMF
// removes the problem instead of mitigating it: the digits arrive on a **separate channel** and never reach the
// speech recogniser, so there is nothing in the audio to transcribe, summarise, index, or leak.
//
// If the caller cannot use a keypad, the honest fallback is the SMS/web verification page — NOT taking the code
// by voice and hoping the redactor holds.
// ══ PHASE 4: THE KEYPAD CALLBACK HAS ITS OWN CREDENTIAL ═════════════════════════════════════════════════════
//
// The Gather's action is POSTed by the telephony provider, which cannot present our voice integration key — so the
// old route, behind the key guard, was unreachable by the one caller it existed for, and it also read the context
// from the wrong field (`req.ctx`; the guard sets `req.voiceCtx`) and the number from `To` (the SALON's line). The
// TwiML and the callback now take `vc`: a sealed token (salon, branch, booking session, the number the code was texted
// to) minted when the booking was refused. The resend route stays behind the key: only the voice platform resends.
import { VOICE_RECEPTIONIST_LOCALE } from '@aipowersalon/api-contracts';
import { BookingVerificationService, RemoteBookingAdmission, dtmfGather, safeDtmfLog, openVoiceCallback, sealVoiceCallback } from '@aipowersalon/booking';
import { normalizePhone } from '@aipowersalon/customers';
import { Body, Controller, Get, Header, HttpCode, HttpException, HttpStatus, Optional, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { VoiceAuthGuard } from './voice-auth.guard';
import { VoiceKeyRateLimitGuard } from '@aipowersalon/security/nest';
import { voicePrincipal } from './voice-booking-write.service';
import { ListQueries } from '@aipowersalon/database';
import { AiReceptionistVerificationControllerListQueries } from './ai-receptionist-verification.list-queries';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { GW_VERIFICATION_DTMF_BODY, GW_VERIFICATION_SEND_BODY } from '../request-schemas';
const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' } as any)[c]);
const base = () => (process.env.PUBLIC_API_BASE_URL || process.env.APS_API_BASE || '').replace(/\/+$/, '');

@ListQueries(AiReceptionistVerificationControllerListQueries)
@Controller('api/ai-receptionist/v1/verification')
export class AiReceptionistVerificationController {
  constructor(private readonly svc: BookingVerificationService, @Optional() private readonly admission?: RemoteBookingAdmission) {}

  /**
   * Resend the code (the voice platform, with its key). Takes the sealed booking session from the refusal and the
   * number on the booking; returns a fresh keypad callback.
   */
  @Post('send')
  @UseGuards(VoiceAuthGuard, VoiceKeyRateLimitGuard)  // Constitution 12 §58: a leaked key has a budget
  async send(@Req() req: any, @Body(ValidatedBody(GW_VERIFICATION_SEND_BODY)) body: any) {
    const v = req?.voiceCtx || {};
    const sid = this.admission && v.tenantId ? this.admission.open(v.tenantId, voicePrincipal(v), body?.bookingSessionId) : null;
    if (!sid) throw new HttpException({ status: 'verification_failed', message: 'This verification has expired. Please book the time again.' }, HttpStatus.BAD_REQUEST);
    const e164 = normalizePhone(String(body?.customerPhone ?? ''));
    if (!e164) throw new HttpException({ status: 'invalid_phone_number', message: 'That phone number does not look valid.' }, HttpStatus.BAD_REQUEST);
    const out = await this.svc.send({ tenantId: v.tenantId, branchId: v.branchId, channel: 'ai_receptionist', bookingSessionId: sid, customerId: null, requestIp: null, deviceId: null }, e164);
    const vc = encodeURIComponent(sealVoiceCallback({ tenantId: v.tenantId, branchId: v.branchId, sid, phone: e164 }));
    const ok = out.status === 'code_sent' || out.status === 'already_verified';
    return {
      ok, status: out.status, message: out.message, maskedPhone: (out as any).maskedPhone ?? null,
      retryAfterSeconds: (out as any).retryAfterSeconds ?? undefined,
      dtmfUrl: `${base()}/api/ai-receptionist/v1/verification/dtmf?vc=${vc}`, twimlUrl: `${base()}/api/ai-receptionist/v1/verification/twiml?vc=${vc}`,
    };
  }

  /**
   * Ready-made TwiML for a Twilio-native flow. Contains NO CODE — Twilio Verify holds it. The Gather posts the digits
   * to the callback with the same sealed `vc`, asking for a TwiML reply (`format=twiml`); `next` (https only) is where
   * the call returns to afterwards.
   */
  @Get('twiml')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  twiml(@Query('vc') vc?: string, @Query('lang') _lang?: string, @Query('next') next?: string): string {
    if (!openVoiceCallback(vc)) return '<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>This verification has expired. Goodbye.</Say></Response>';
    const nextQ = next && /^https:\/\//.test(next) ? `&next=${encodeURIComponent(next)}` : '';
    return dtmfGather({
      actionUrl: `${base()}/api/ai-receptionist/v1/verification/dtmf?vc=${encodeURIComponent(String(vc))}&format=twiml${nextQ}`,
      language: VOICE_RECEPTIONIST_LOCALE,   // the caller hears English (Kevin, Oct 28 2026) — ?lang is ignored
      numDigits: 6,
    });
  }

  /**
   * The keypad digits (Twilio's Gather action, or the voice platform relaying them).
   *
   * `Digits` is the SECRET. It is checked and discarded — never logged, never echoed, never returned. The audit trail
   * records THAT a code was entered (`[6 digits entered]`), never WHAT it was.
   */
  @Post('dtmf')
  async dtmf(@Query('vc') vcQ: string | undefined, @Query('format') format: string | undefined, @Query('next') next: string | undefined, @Body(ValidatedBody(GW_VERIFICATION_DTMF_BODY)) body: any, @Res({ passthrough: true }) res?: any) {
    const digits = String(body?.Digits ?? body?.digits ?? '').replace(/\D/g, '');
    const safe = safeDtmfLog(digits);
    const cb = openVoiceCallback(vcQ ?? body?.vc);
    const reply = (r: { ok: boolean; status: string; message: string }) => {
      if (format !== 'twiml') return { ...r, entered: safe };
      res?.type?.('text/xml');
      const redirect = next && /^https:\/\//.test(next) ? `<Redirect method="POST">${escapeXml(next)}</Redirect>` : '';
      return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>${escapeXml(r.message)}</Say>${redirect}</Response>`;
    };
    if (!cb) return reply({ ok: false, status: 'code_expired', message: 'This verification has expired. Please book the time again.' });
    if (!digits) return reply({ ok: false, status: 'verification_failed', message: 'We did not receive your code.' });
    // The number is the one the code was texted to, from the sealed callback — the service compares its hash with the
    // session's and refuses a mismatch.
    const out = await this.svc.check(
      { tenantId: cb.tenantId, branchId: cb.branchId, channel: 'ai_receptionist', bookingSessionId: cb.sid, customerId: null, requestIp: null, deviceId: null },
      cb.phone,
      digits,
    );
    // The message is already caller-safe (it never names the provider and never echoes the number).
    return reply({ ok: out.status === 'phone_verified', status: out.status, message: out.status === 'phone_verified' ? 'Thank you, your number is verified.' : out.message });
  }
}
