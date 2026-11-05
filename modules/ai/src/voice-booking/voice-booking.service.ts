// voice-booking.service.ts — Voice Booking Gateway (Phase 1a, read tools).
//
// A THIN adapter the AI voice agent's tools call. It owns NO booking logic: availability, service, and technician data
// all come from the canonical CustomerBookingService (the same conflict gate staff booking uses). This layer's only
// jobs are (1) accept a server-derived VoiceContext (tenant+branch resolved from the integration key — never from the
// caller/provider) and (2) project ONLY safe public fields, stripping anything private (employee PII, internal notes,
// secrets). It never fabricates availability or prices — everything is backend-computed or an honest empty result.
// BUILD_PLAN Phase 7: availability now comes from the AI Scheduling Optimizer's findOptions (one option finder for the
// POS, the Copilot and the receptionist) whenever the optimizer is in the process; the booking path is the fallback.
import { CustomerBookingService, SlotHoldService, type CustomerBookingContext } from '@aipowersalon/booking';
import { Injectable, Inject, Optional } from '@nestjs/common';
import type { SchedHold, SchedOptionsResponse } from '@aipowersalon/api-contracts/tenant';
import { SCHED_OPTIONS_FINDER, type SchedOptionsFinder } from '../ai-scheduling-optimizer/ai-scheduling-ops.bridge';
import { schedSystemCtx } from '../ai-scheduling-optimizer/ai-scheduling-ops.common';
import { createHash } from 'node:crypto';
import { AI_RECEPTIONIST_PERMISSIONS } from './voice-booking-write.service';

/** Server-derived call context. tenantId/branchId come from the integration key (Phase 2), NOT from the caller. */
export interface VoiceContext { tenantId: string; branchId: string; }

// Public projections — deliberately narrow. Nothing here may leak private employee data, internal notes, or secrets.
export interface VoicePublicService { serviceId: string; name: string; description: string; durationMinutes: number; priceCents: number; category: string | null; bookable: boolean; }
export interface VoicePublicTechnician { technicianId: string; displayName: string; bookable: boolean; }
export interface VoiceAvailabilityOption { startTime: string; endTime: string; technicianId: string; durationMinutes: number; priceEstimateCents: number; }

// The CustomerBookingService context uses a userId; for voice there is no end-user session, so we pass a stable
// synthetic principal that the audit trail can attribute to the voice channel. tenant/branch remain authoritative.
const VOICE_PRINCIPAL = 'voice-receptionist';
/** BUILD_PLAN Phase 7: what the receptionist may do in the optimizer — find options (and hold one when booking).
 *  Round 2 H (permission decision): holding is a write behind the booking-desk key `pos.booking.create`; the receptionist
 *  gets it from its existing voice-booking authorization (AI_RECEPTIONIST_PERMISSIONS — it already books, so it may hold),
 *  not from the optimizer's own `ai_scheduling.generate`. */
const VOICE_SCHED_PERMISSIONS = ['ai_scheduling.view', ...AI_RECEPTIONIST_PERMISSIONS.filter((p) => p === 'pos.booking.create')];

/** Round 2 H: the booking session a call's hold lives under — one per call (tenant + branch + the provider's call id), so
 *  every tool call of the same call refreshes / moves its ONE hold, the booking made on the call converts it, and the
 *  call's end releases it. Server-side only: it never leaves the server. */
export function voiceCallSession(v: VoiceContext, callId: string): string {
  const h = createHash('sha256').update(`voice-hold:${v.tenantId}:${v.branchId}:${callId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${(8 | (parseInt(h[16], 16) & 3)).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const OPTION_LIMIT = 20;

@Injectable()
export class VoiceBookingService {
  constructor(
    @Inject(CustomerBookingService) private readonly booking: CustomerBookingService,
    // BUILD_PLAN Phase 7: the AI Scheduling Optimizer's findOptions (shifts, breaks, time off, buffers, per-service
    // blocks, live holds, ranking). Optional: a process without the optimizer keeps the booking-availability path below.
    @Optional() @Inject(SCHED_OPTIONS_FINDER) private readonly finder: SchedOptionsFinder | null = null,
    // Round 2 H: the salon's own hold time (booking_verification_settings.hold_seconds) for a hold placed while finding times.
    @Optional() private readonly holds: SlotHoldService | null = null,
  ) {}

  private ctx(v: VoiceContext): CustomerBookingContext {
    return { tenantId: v.tenantId, branchId: v.branchId, userId: VOICE_PRINCIPAL };
  }

  /** Tool: GET /voice/booking/services — bookable services with real duration + integer-cent price. */
  async services(v: VoiceContext): Promise<VoicePublicService[]> {
    const { services } = await this.booking.getOptions(this.ctx(v));
    return (services || []).map((s: any) => ({
      serviceId: s.serviceId ?? s.id,
      name: s.name ?? '',
      description: s.description ?? '',
      durationMinutes: Number(s.durationMinutes ?? s.duration_minutes ?? 0),
      priceCents: Number(s.basePriceCents ?? s.priceCents ?? s.price_cents ?? 0), // integer cents, never fabricated
      category: s.category ?? s.categoryName ?? null,
      bookable: s.bookable !== false,
    }));
  }

  /** Tool: GET /voice/booking/technicians — safe public technician list (optionally filtered to a service). */
  async technicians(v: VoiceContext, opts: { serviceId?: string } = {}): Promise<VoicePublicTechnician[]> {
    const { technicians } = await this.booking.getOptions(this.ctx(v));
    let list = (technicians || []) as any[];
    if (opts.serviceId) list = list.filter((t) => !Array.isArray(t.serviceIds) || t.serviceIds.includes(opts.serviceId));
    return list.map((t) => ({
      technicianId: t.technicianId ?? t.id,
      displayName: t.displayName ?? t.firstName ?? t.first_name ?? 'Technician', // public display name only — no PII
      bookable: t.bookable !== false,
    }));
  }

  /**
   * Tool: GET /voice/booking/availability — REAL backend-computed options. Returns only truly-open slots, projected to
   * start/end/technician/duration/price. Never invents times; an empty array means "no availability", which the agent
   * must relay honestly.
   */
  async availability(v: VoiceContext, q: { serviceId: string; date: string; technicianId?: string; bookingSessionId?: string | null }): Promise<VoiceAvailabilityOption[]> {
    const viaOptimizer = await this.optimizerOptions(v, q, null);
    if (viaOptimizer) return viaOptimizer.options;
    // The fallback (no optimizer): live holds of OTHER sessions are not offered; the call's own hold is (Round 3 H2).
    const result = await this.booking.availability(this.ctx(v), { serviceId: q.serviceId, date: q.date, technicianId: q.technicianId, bookingSessionId: q.bookingSessionId ?? null });
    const dur = Number(result.durationMinutes || 0);
    const price = await this.servicePriceCents(v, q.serviceId);
    const open = (result.slots || []).filter((s) => s.available && s.technicianIds.length > 0);
    return open.map((s) => ({
      startTime: s.startTime,
      endTime: addMinutes(s.startTime, dur),
      technicianId: q.technicianId && s.technicianIds.includes(q.technicianId) ? q.technicianId : s.technicianIds[0],
      durationMinutes: dur,
      priceEstimateCents: price,
    }));
  }

  /**
   * BUILD_PLAN Phase 7: when the caller is about to book, find the options AND hold the best one for them (channel
   * 'ai_receptionist', the booking session the agent opened) so nobody else takes it while the call finishes. Needs the
   * optimizer; without it the agent books against the live availability as before (hold null).
   */
  async availabilityWithHold(v: VoiceContext, q: { serviceId: string; date: string; technicianId?: string; bookingSessionId?: string | null; customerId?: string | null; seconds?: number | null }): Promise<{ options: VoiceAvailabilityOption[]; hold: SchedHold | null }> {
    const seconds = q.seconds ?? (this.holds ? await this.holds.holdSeconds(v.tenantId, v.branchId).catch(() => null) : null);
    const viaOptimizer = await this.optimizerOptions(v, q, { channel: 'ai_receptionist', bookingSessionId: q.bookingSessionId ?? null, customerId: q.customerId ?? null, seconds });
    if (viaOptimizer) return viaOptimizer;
    return { options: await this.availability(v, q), hold: null };
  }

  /** findOptions through the optimizer, projected to the voice shape; null = not available here (caller falls back). */
  private async optimizerOptions(v: VoiceContext, q: { serviceId: string; date: string; technicianId?: string }, hold: { channel: 'ai_receptionist'; bookingSessionId: string | null; customerId: string | null; seconds: number | null } | null): Promise<{ options: VoiceAvailabilityOption[]; hold: SchedHold | null } | null> {
    if (!this.finder?.bound()) return null;
    let res: SchedOptionsResponse;
    try {
      res = await this.finder.findOptions(schedSystemCtx(v.tenantId, v.branchId, VOICE_PRINCIPAL, VOICE_SCHED_PERMISSIONS), {
        date: q.date, serviceIds: [q.serviceId], technicianId: q.technicianId ?? null, limit: OPTION_LIMIT, hold,
      });
    } catch { return null; }   // the optimizer refused (switched off, no data): the booking path answers instead
    const price = await this.servicePriceCents(v, q.serviceId);
    return {
      options: (res?.options || []).map((o) => ({ startTime: o.startTime, endTime: o.endTime, technicianId: o.technicianId, durationMinutes: minutesBetween(o.startTime, o.endTime), priceEstimateCents: price })),
      hold: res?.hold ?? null,
    };
  }

  private async servicePriceCents(v: VoiceContext, serviceId: string): Promise<number> {
    const svc = (await this.services(v)).find((s) => s.serviceId === serviceId);
    return svc ? svc.priceCents : 0;
  }
}

/** Minutes from one "HH:MM" to a later one (0 when malformed or not later). */
export function minutesBetween(from: string, to: string): number {
  const m = (x: string) => { const [h, mi] = String(x).split(':').map((n) => parseInt(n, 10)); return Number.isNaN(h) || Number.isNaN(mi) ? NaN : h * 60 + mi; };
  const d = m(to) - m(from);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/** Add whole minutes to an "HH:MM" time-of-day string (24h). Pure; no timezone math (the date carries the day). */
export function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = String(hhmm).split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const total = h * 60 + m + Math.max(0, Math.floor(minutes));
  const hh = Math.floor((total % (24 * 60)) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
