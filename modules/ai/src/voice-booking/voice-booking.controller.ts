// voice-booking.controller.ts — the callable surface for the AI voice receptionist (Phase 1a wiring).
//
// One webhook endpoint the voice provider's custom functions hit. Security is layered:
//   1. VoiceAuthGuard (mandatory): resolves tenant+branch from the integration key (X-Voice-Key / Bearer). Without a
//      valid key → 401. This is the tenant-isolating auth — the AI can never choose a tenant.
//   2. Retell signature (defense-in-depth, when configured): verifies the request genuinely came from Retell using the
//      provider adapter over req.rawBody. Enabled per deployment via RETELL_WEBHOOK_SIGNING_KEY; when unset, the
//      integration-key bearer auth is the sole (still-secret, revocable) gate and this is logged.
//
// Only READ tools are dispatched here. WRITE tools are declared in the catalog but disabled, so a create/cancel
// invocation is refused with an honest message until the write path is wired + confirmed.
import { Controller, Post, Param, Body, Req, UseGuards, Logger, Optional } from '@nestjs/common';
import { DealsService } from '@aipowersalon/deals';
import { SlotHoldService, HoldSlotTakenError } from '@aipowersalon/booking';
import { VoiceAuthGuard } from './voice-auth.guard';
import { VoiceKeyRateLimitGuard } from '@aipowersalon/security/nest';
import { VoiceBookingService, voiceCallSession, type VoiceContext } from './voice-booking.service';
import { VoiceBookingWriteService } from './voice-booking-write.service';
import { VoiceManageService } from './voice-manage.service';
import { VoiceCallOutcomeService } from './voice-call-outcome.service';
import { RetellVoiceAdapter } from './retell-voice.adapter';
import { VOICE_TOOLS, voiceWriteToolsEnabled } from './voice-tools';
import type { VoiceToolResult } from './voice-provider.port';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { VOICE_CALL_OUTCOME_BODY } from '../request-schemas';
@Controller('voice')
@UseGuards(VoiceAuthGuard, VoiceKeyRateLimitGuard)  // Constitution 12 §58: a leaked key has a budget
export class VoiceBookingController {
  private readonly log = new Logger('VoiceBookingController');
  constructor(
    private readonly gateway: VoiceBookingService,
    private readonly write: VoiceBookingWriteService,
    private readonly manage: VoiceManageService,
    private readonly outcomes: VoiceCallOutcomeService,
    private readonly retell: RetellVoiceAdapter,
    @Optional() private readonly deals?: DealsService,   // a plain class type (no union): a union emits Object and Nest would never inject it
    // Round 2 H: exact-slot holds for a call (booking module; absent without a database → the hold tools say so honestly)
    @Optional() private readonly holds?: SlotHoldService,
  ) {}

  /** POST /voice/calls/:callId/outcome — record the structured result of a call (idempotent by call id). */
  @Post('calls/:callId/outcome')
  async recordOutcome(@Param('callId') callId: string, @Body(ValidatedBody(VOICE_CALL_OUTCOME_BODY)) body: any, @Req() req: any) {
    const ctx: VoiceContext = req.voiceCtx;
    const provider: string = req.voiceProvider || 'retell';
    try {
      const rec = await this.outcomes.record(ctx, provider, { ...(body ?? {}), providerCallId: callId });
      // Round 2 H: the call is over — whatever time it still holds goes back to the calendar now, not at expiry.
      await this.holds?.releaseSession(ctx.tenantId, voiceCallSession(ctx, callId), 'call_ended').catch(() => 0);
      return { success: true, id: rec.id };
    } catch (e: any) {
      this.log.warn(`voice outcome record failed: ${e?.message ?? e}`);
      return { success: false, message: 'Could not record call outcome.' };
    }
  }

  /** POST /voice/tool — the provider custom-function endpoint. Verified, then dispatched to a read tool. */
  @Post('tool')
  async tool(@Req() req: any) {
    const ctx: VoiceContext = req.voiceCtx; // set by the guard, from the integration key — never from the body
    const rawBody: string = (req.rawBody ? req.rawBody.toString('utf-8') : JSON.stringify(req.body ?? {}));

    // Layer 2: verify the provider signature when a signing key is configured for this deployment.
    const signingKey = process.env.RETELL_WEBHOOK_SIGNING_KEY || '';
    if (signingKey) {
      const v = this.retell.verifyWebhook(rawBody, req.headers ?? {}, signingKey);
      if (!v.ok) { this.log.warn(`voice webhook signature rejected: ${v.reason}`); return { success: false, message: 'Signature verification failed.' }; }
    } else {
      this.log.warn('RETELL_WEBHOOK_SIGNING_KEY unset — relying on integration-key auth only (set it for origin verification).');
    }

    const call = this.retell.parseToolCall(rawBody);
    if (!call) return { success: false, message: 'Unrecognized tool request.' };

    const result = await this.dispatch(ctx, call.name, call.args, (call as any).callerId ?? null, call.callId ? String(call.callId) : null);
    return this.retell.formatToolResult(call, result);
  }

  /** Route a tool name to a gateway method. Read tools always; write tools only when VOICE_WRITE_TOOLS_ENABLED. */
  private async dispatch(ctx: VoiceContext, name: string, args: Record<string, unknown>, callerId: string | null, callId: string | null = null): Promise<VoiceToolResult> {
    const def = VOICE_TOOLS.find((t) => t.name === name);
    if (!def) return { data: null, error: `Unknown tool: ${name}` };
    // Write tools are refused unless both the catalog enables them AND the env flag is on (dark by default).
    if (def.kind === 'write' && (!def.enabled || !voiceWriteToolsEnabled())) return { data: null, error: `That action isn't available yet.` };
    if (def.kind === 'read' && !def.enabled) return { data: null, error: `That action isn't available.` };

    try {
      switch (name) {
        case 'get_services':
          return { data: await this.gateway.services(ctx) };
        case 'get_technicians':
          return { data: await this.gateway.technicians(ctx, { serviceId: str(args.service_id) }) };
        case 'get_availability': {
          const serviceId = str(args.service_id); const date = str(args.date);
          if (!serviceId || !date) return { data: null, error: 'A service and date are required to check availability.' };
          // Round 2 H: "ready to book" → hold the best option for THIS call (a write: only while write tools are on).
          if (args.hold === true && callId && voiceWriteToolsEnabled()) {
            const sid = voiceCallSession(ctx, callId);
            const r = await this.gateway.availabilityWithHold(ctx, { serviceId, date, technicianId: str(args.technician_id), bookingSessionId: sid });
            return { data: { options: r.options, hold: r.hold }, say: r.options.length ? undefined : 'There is no availability for that day.' };
          }
          // Round 3 H2: asked under the call's session, so a time this call holds is offered back to it (others' are not).
          const options = await this.gateway.availability(ctx, { serviceId, date, technicianId: str(args.technician_id), ...(callId ? { bookingSessionId: voiceCallSession(ctx, callId) } : {}) });
          return { data: options, say: options.length ? undefined : 'There is no availability for that day.' };
        }
        case 'hold_slot': {
          const serviceId = str(args.service_id); const date = str(args.date); const startTime = str(args.start_time);
          if (!serviceId || !date || !startTime) return { data: null, error: 'A service, date and time are required to hold a time.' };
          if (!this.holds || !callId) return { data: null, error: 'I can\u2019t hold a time right now, but I can book it straight away.' };
          const sid = voiceCallSession(ctx, callId);
          try {
            const h = await this.holds.place({ tenantId: ctx.tenantId, branchId: ctx.branchId, date, startTime, serviceIds: [serviceId], technicianId: str(args.technician_id) ?? null, bookingSessionId: sid, channel: 'ai_receptionist' });
            const minutes = Math.max(1, Math.round((h.expiresAt - Date.now()) / 60_000));
            return { data: { held: true, holdId: h.holdId, expiresAt: new Date(h.expiresAt).toISOString() }, say: `I'm holding ${startTime} on ${date} for you for about ${minutes} minutes.` };
          } catch (e: any) {
            if (e instanceof HoldSlotTakenError || e?.code === 'SLOT_HELD') return { data: { held: false, slotUnavailable: true }, error: 'That time was just taken. Let me find another one.' };
            if (e?.code === 'VALIDATION_FAILED') return { data: null, error: 'I couldn\u2019t hold that time — please pick one of the times I offered.' };
            throw e;
          }
        }
        case 'release_hold': {
          if (!this.holds || !callId) return { data: { released: 0 } };
          const released = await this.holds.releaseSession(ctx.tenantId, voiceCallSession(ctx, callId), 'customer_canceled');
          return { data: { released }, say: released ? 'No problem, I\u2019ve released that time.' : undefined };
        }
        case 'get_deals': {
          if (!this.deals) return { data: [], say: 'I don\u2019t have any specials to share right now.' };
          const all = await this.deals.salonDealsForCustomers({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: 'ai-receptionist', role: 'AI_RECEPTIONIST', permissions: [] }, 'ai_receptionist');
          const list = all.map((d) => ({ title: d.title, offer: d.discountType === 'percent' ? `${d.discountPercent}% off` : d.discountType === 'fixed_price' ? `for $${((d.discountCents ?? 0) / 100).toFixed(2)}` : `$${((d.discountCents ?? 0) / 100).toFixed(2)} off`,
            description: d.description, terms: d.terms, endsAt: d.endsAt, needsCode: d.requiresCode }));
          return { data: list, say: list.length ? undefined : 'There are no specials running right now.' };
        }
        case 'create_appointment': {
          const res = await this.write.createAppointment(ctx, {
            serviceId: str(args.service_id) ?? '', date: str(args.date) ?? '', startTime: str(args.start_time) ?? '',
            technicianId: str(args.technician_id), customerName: str(args.customer_name) ?? '', customerPhone: str(args.customer_phone),
            confirmed: args.confirmed === true,
            callSessionId: callId ? voiceCallSession(ctx, callId) : null,   // Round 2 H: the call's hold is converted
          });
          return res.ok
            ? { data: res, say: `Booked ${res.serviceName ?? 'your appointment'} on ${res.date} at ${res.startTime}${res.technicianName ? ' with ' + res.technicianName : ''}.` }
            : { data: null, error: res.error };
        }
        case 'verify_caller': {
          const caller = await this.manage.verifyCaller(ctx, { phone: str(args.phone) ?? '', name: str(args.name) }, callerId);
          return caller
            ? { data: { verified: true, customerId: caller.customerId, name: caller.name }, say: `Thanks ${caller.name || ''}, I've found your account.` }
            : { data: { verified: false }, say: 'I couldn\u2019t verify that number against an account. I can take a new booking or connect you to the front desk.' };
        }
        case 'search_appointments': {
          const caller = await this.manage.verifyCaller(ctx, { phone: str(args.phone) ?? '', name: str(args.name) }, callerId);
          if (!caller) return { data: { verified: false, appointments: [] }, say: 'I couldn\u2019t verify that number.' };
          const appts = await this.manage.searchAppointments(ctx, caller);
          return { data: { verified: true, appointments: appts }, say: appts.length ? undefined : 'I don\u2019t see any upcoming appointments under that number.' };
        }
        case 'lookup_or_create_customer': {
          const r = await this.manage.lookupOrCreateCustomer(ctx, { phone: str(args.phone) ?? '', name: str(args.customer_name), consent: args.consent === true });
          return r.ok ? { data: r } : { data: null, error: r.error };
        }
        case 'reschedule_appointment': {
          const caller = await this.manage.verifyCaller(ctx, { phone: str(args.phone) ?? '', name: str(args.name) }, callerId);
          if (!caller) return { data: null, error: 'I need to verify your phone number before changing an appointment.' };
          const res = await this.manage.rescheduleAppointment(ctx, { appointmentId: str(args.appointment_id) ?? '', date: str(args.date), startTime: str(args.start_time) ?? '', caller, confirmed: args.confirmed === true,
            callSessionId: callId ? voiceCallSession(ctx, callId) : null });   // Round 3 H2: the call's own hold may be moved into
          return res.ok ? { data: res, say: `Done — your appointment is moved to ${res.date} at ${res.startTime}.` } : { data: null, error: res.error };
        }
        case 'cancel_appointment': {
          const caller = await this.manage.verifyCaller(ctx, { phone: str(args.phone) ?? '', name: str(args.name) }, callerId);
          if (!caller) return { data: null, error: 'I need to verify your phone number before cancelling an appointment.' };
          const res = await this.manage.cancelAppointment(ctx, { appointmentId: str(args.appointment_id) ?? '', caller, confirmed: args.confirmed === true, reason: str(args.reason) });
          return res.ok ? { data: res, say: 'Your appointment has been cancelled. You\u2019ll get a confirmation shortly.' } : { data: null, error: res.error };
        }
        case 'handoff_to_front_desk':
          return { data: { handoff: true, reason: str(args.reason) ?? null }, say: 'I can connect you with the front desk.' };
        default:
          return { data: null, error: `Tool not implemented: ${name}` };
      }
    } catch (e: any) {
      this.log.error(`voice tool '${name}' failed: ${e?.message ?? e}`);
      return { data: null, error: `I couldn't complete that right now.` }; // honest, non-leaky failure the agent can relay
    }
  }
}

function str(v: unknown): string | undefined { return typeof v === 'string' && v.trim() ? v.trim() : undefined; }
