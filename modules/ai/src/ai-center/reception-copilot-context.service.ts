// reception-copilot-context.service.ts — the read-only Copilot CONTEXT backbone (spec §4/§8–10). It never touches the
// database directly and never mutates: it DELEGATES to the existing tenant-isolated, permission-gated CustomersService
// and returns a safe, honest projection. Caller identity is server-derived (passed in from req.ctx), searched only
// within the caller's tenant. Caller ID is a lookup hint, not proof — so the result carries an explicit match state
// ('none' | 'exact' | 'multiple') and the receptionist confirms. Phone numbers are masked. No field is fabricated:
// everything comes from a real customer row, and absent data is simply omitted.
import { CustomersService, type CustomersContext } from '@aipowersalon/customers';
import { QueueService, type QueueContext } from '@aipowersalon/queue';
import { BookingService, SlotHoldService, HoldSlotTakenError, sealBookingSession, openBookingSession, type BookingContext } from '@aipowersalon/booking';
import { randomUUID } from 'node:crypto';
import { hasPermission } from '@aipowersalon/permissions';
import type { IntentResult, CopilotIntent } from '@aipowersalon/api-contracts/tenant';
export type { IntentResult, CopilotIntent };   // owned by packages/api-contracts (Constitution 13 §13)
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AiAssistantService } from '../ai/ai-assistant.service';
import type { SchedHold, SchedOption, CopilotHoldResult } from '@aipowersalon/api-contracts/tenant';
import { SCHED_OPTIONS_FINDER, type SchedOptionsFinder } from '../ai-scheduling-optimizer/ai-scheduling-ops.bridge';

export interface CopilotCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }
export interface SafeCustomer {
  customerId: string; fullName: string; maskedPhone: string; returning: boolean; visitsCount: number;
  lastVisitDate: string | null; loyaltyTier: string | null; favoriteServiceName: string | null; favoriteTechnicianName: string | null;
  /** WP-I (697): the language the salon's messages to this customer use ('en' / 'vi'); null = no preference (English). */
  language?: 'en' | 'vi' | null;
}

// Deterministic keyword classifier (no LLM needed). Scores each intent by matched cue words and returns the strongest;
// an LLM can refine this later when a provider key is set. Purely additive routing — it never performs an action.
const INTENT_CUES: { intent: CopilotIntent; label: string; cues: RegExp[] }[] = [
  { intent: 'cancel_appointment', label: 'Cancel an appointment', cues: [/\bcancel(l?ed|ling)?\b/i, /\bcall(ed)? off\b/i, /\bcan\u2019?t make it\b/i] },
  { intent: 'reschedule_appointment', label: 'Reschedule an appointment', cues: [/\breschedul/i, /\bmove (my|the|it|her|his) (appointment|booking|time)\b/i, /\bchange (the |my )?(time|day|date|appointment)\b/i, /\bpush (it|my|the) (back|to)\b/i] },
  { intent: 'book_appointment', label: 'Book an appointment', cues: [/\bbook\b/i, /\bschedule\b/i, /\bmake (an? )?appointment\b/i, /\bset up (an? )?appointment\b/i, /\bcome in\b/i] },
  { intent: 'check_availability', label: 'Find open times', cues: [/\bavailab/i, /\bopening/i, /\bfree (slot|time)/i, /\bwhen can\b/i, /\bany (time|slot)/i, /\bwhat times\b/i] },
  { intent: 'send_message', label: 'Send a text message', cues: [/\btext\b/i, /\bmessage\b/i, /\bsms\b/i, /\bremind(er)?\b/i, /\bnotify\b/i] },
  { intent: 'customer_lookup', label: 'Look up a caller', cues: [/\blook ?up\b/i, /\bwho is\b/i, /\bfind (the )?customer\b/i, /\btheir (history|info|number|phone)\b/i, /\bprofile\b/i] },
  { intent: 'queue_status', label: 'Queue summary', cues: [/\bqueue\b/i, /\bwait(ing| time)\b/i, /\bhow (many|long)\b/i, /\bwho\u2019?s next\b/i] },
];
export function classifyIntent(text: string): IntentResult {
  const t = (text || '').trim();
  if (!t) return { intent: 'general_question', confidence: 'low', label: 'General question', matched: [] };
  let best: { intent: CopilotIntent; label: string; hits: string[] } | null = null;
  for (const entry of INTENT_CUES) {
    const hits: string[] = [];
    for (const re of entry.cues) { const m = re.exec(t); if (m) hits.push(m[0]); }
    if (hits.length && (!best || hits.length > best.hits.length)) best = { intent: entry.intent, label: entry.label, hits };
  }
  if (!best) return { intent: 'general_question', confidence: 'low', label: 'General question', matched: [] };
  const confidence = best.hits.length >= 2 ? 'high' : 'medium';
  return { intent: best.intent, confidence, label: best.label, matched: best.hits };
}

export type DraftKind = 'reminder' | 'running_late' | 'ready_now' | 'thank_you' | 'reschedule_offer';
/** language (Vietnamese POS §120): the language of `body` — a draft is FOR THE CUSTOMER, so it follows the customer's own
 *  language (WP-I), never the receptionist's; the deterministic template is English. */
export interface DraftMessageResult { kind: DraftKind; body: string; matched: boolean; customerName: string | null; refined?: boolean; language?: 'en' | 'vi' }

// Pure, deterministic templates (no LLM needed). Appointment clauses are only included when real details exist, so the
// draft never invents a date/time. Times are taken from the ISO string's own components to avoid timezone drift.
function whenClause(startsAt: string | null): string {
  if (!startsAt) return '';
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(startsAt);
  return m ? ` on ${m[1]} at ${m[2]}` : '';
}
// Sanitize an LLM-produced SMS: strip surrounding quotes/whitespace, collapse blank lines, cap length. Returns null if
// the model gave back nothing usable (so the caller keeps the deterministic draft).
export function cleanSmsDraft(text: string): string | null {
  let s = (text || '').trim();
  if (!s) return null;
  s = s.replace(/^["'`]+|["'`]+$/g, '').trim();          // strip wrapping quotes
  s = s.replace(/\n{2,}/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  if (s.length > 320) s = s.slice(0, 317).trimEnd() + '…';
  return s.length ? s : null;
}

export function draftMessageBody(kind: DraftKind, name: string | null, appt: { startsAt: string; serviceName: string; technicianName: string } | null): string {
  const hi = name ? `Hi ${name},` : 'Hi there,';
  const when = whenClause(appt?.startsAt ?? null);
  const svc = appt?.serviceName ? ` for ${appt.serviceName}` : '';
  const tech = appt?.technicianName ? ` with ${appt.technicianName}` : '';
  switch (kind) {
    case 'reminder': return `${hi} this is a friendly reminder of your appointment${when}${svc}${tech}. Reply here if you need to make any changes.`;
    case 'running_late': return `${hi} we\u2019re running a few minutes behind and wanted to give you a heads up. Thank you for your patience \u2014 we\u2019ll be ready for you shortly!`;
    case 'ready_now': return `${hi} we\u2019re ready for you now \u2014 come on in whenever you\u2019re set.`;
    case 'thank_you': return `${hi} thank you for visiting us today! We\u2019d love to see you again soon.`;
    case 'reschedule_offer': return `${hi} we need to adjust your appointment${when} and want to find a time that works better for you. Please reply or give us a call and we\u2019ll get it sorted.`;
    default: return hi;
  }
}

export interface TechnicianRecommendation {
  available: boolean;
  technicians: { technicianId: string; name: string; firstAvailable: string | null; openSlots: number; isUsual: boolean }[];
  denied?: boolean;
  /** BUILD_PLAN Phase 7: 'optimizer' = ranked by the AI Scheduling Optimizer's findOptions; 'booking' = the fallback. */
  source?: 'optimizer' | 'booking';
}
export interface ConflictResult { hasConflict: boolean; status: string; conflictingAppointmentId: string | null; denied?: boolean; unavailable?: boolean }
export interface AvailabilityRecommendation {
  available: boolean;
  date: string | null;
  recommendations: { time: string; technicianId: string; technicianName: string }[];
  byTechnician: { technicianId: string; name: string; slotCount: number; firstSlot: string | null }[];
  denied?: boolean;
  source?: 'optimizer' | 'booking';
  /** The option held for the caller while the receptionist confirms (only when a hold was asked for). */
  hold?: SchedHold | null;
  /** Round 2 H: the sealed desk session the hold lives under — presented again to book from it or release it. */
  holdToken?: string | null;
}

/** Round 2 H (Oct 12 2026) — PERMISSION DECISION: placing / releasing a hold is a WRITE behind the booking-desk key the
 *  front desk already has for writing the diary. No new key. */
export const COPILOT_HOLD_PERMISSION = 'pos.booking.create';
/** A desk hold's session is sealed for this salon AND this staff member: only the receptionist who held a time can book
 *  from it or release it (a hold id alone is not enough). */
const deskBinding = (ctx: { tenantId: string; userId: string }) => ({ tenantId: ctx.tenantId, customerId: `staff:${ctx.userId}` });
export function openCopilotHoldToken(ctx: { tenantId: string; userId: string }, token: unknown): string | null {
  return token ? openBookingSession(token, deskBinding(ctx)) : null;
}
export type { CopilotHoldResult };   // owned by packages/api-contracts (Constitution 13 §13)
export interface DuplicateCandidateGroup { groupId: string; reason: string; members: { customerId: string; fullName: string; maskedPhone: string; visitCount: number | null }[] }
export interface DuplicatesResult { groups: DuplicateCandidateGroup[]; denied?: boolean }
export interface QueueSummaryResult {
  available: boolean;                 // false when no branch is in context (honest, not empty numbers)
  waiting: number;
  inService: number;
  unassigned: number;
  vipWaiting: number;
  longestWaitMinutes: number | null;  // estimate; null when nothing is waiting
  denied?: boolean;
}
export interface CustomerContextResult {
  matchState: 'none' | 'exact' | 'multiple';
  candidates: SafeCustomer[];
  customer: (SafeCustomer & { upcomingAppointment: { startsAt: string; serviceName: string; technicianName: string } | null }) | null;
  denied?: boolean;
}

/** Digits-only normalization for phone comparison (a lookup hint only, never identity proof). */
export function normalizePhone(raw: string): string { return String(raw || '').replace(/\D+/g, ''); }
/** Mask to the last 4 digits: (***) ***-1234. */
export function maskPhone(raw: string): string {
  const d = normalizePhone(raw);
  return d.length >= 4 ? `•••• ${d.slice(-4)}` : '••••';
}

@Injectable()
export class ReceptionCopilotContextService {
  constructor(
    private readonly customers: CustomersService, private readonly queue: QueueService, private readonly booking: BookingService, @Optional() private readonly ai?: AiAssistantService,
    // BUILD_PLAN Phase 7: the AI Scheduling Optimizer's findOptions — the ONE option finder. Optional: without it (or when
    // it refuses) the booking-availability path below answers, exactly as before.
    @Optional() @Inject(SCHED_OPTIONS_FINDER) private readonly finder: SchedOptionsFinder | null = null,
    // Round 2 H: exact-slot holds (booking module). Absent without a database — "Hold this time" then says so honestly.
    @Optional() private readonly holds: SlotHoldService | null = null,
  ) {}

  /** Round 2 H: "Hold this time" on a recommended slot — holds that EXACT slot for the salon's hold time under the desk
   *  session (a new one, or the one in `holdToken`: one hold per desk session, so holding another time moves it). */
  async holdSlot(ctx: CopilotCtx, input: { date: string; startTime: string; serviceIds: string[]; technicianId?: string | null; customerId?: string | null; holdToken?: string | null }): Promise<CopilotHoldResult> {
    if (!this.holds || !ctx.branchId) return { held: false, reason: 'unavailable' };
    const sid = openCopilotHoldToken(ctx, input.holdToken) ?? randomUUID();
    try {
      const h = await this.holds.place({ tenantId: ctx.tenantId, branchId: ctx.branchId, date: input.date, startTime: input.startTime, serviceIds: input.serviceIds ?? [], technicianId: input.technicianId ?? null, bookingSessionId: sid, channel: 'reception_copilot', customerId: input.customerId ?? null });
      return { held: true, holdToken: sealBookingSession(sid, deskBinding(ctx)), holdId: h.holdId, expiresAt: new Date(h.expiresAt).toISOString(), date: input.date, startTime: input.startTime, technicianId: h.technicianId };
    } catch (e: any) {
      if (e instanceof HoldSlotTakenError || e?.code === 'SLOT_HELD') return { held: false, reason: 'taken' };
      if (e?.code === 'VALIDATION_FAILED') return { held: false, reason: 'invalid' };
      throw e;
    }
  }

  /** Round 2 H: give the held time back (the caller walked away / the receptionist cancelled). Only the desk session that
   *  holds it can release it. */
  async releaseHold(ctx: CopilotCtx, input: { holdToken: string }): Promise<{ released: boolean }> {
    const sid = openCopilotHoldToken(ctx, input.holdToken);
    if (!this.holds || !sid) return { released: false };
    return { released: (await this.holds.releaseSession(ctx.tenantId, sid, 'customer_canceled')) > 0 };
  }

  /** Options from the optimizer for the receptionist's own session (its permissions apply); null = use the fallback. */
  private async optimizerOptions(ctx: CopilotCtx, input: { date?: string; serviceIds?: string[]; technicianId?: string; hold?: { customerId?: string | null; bookingSessionId?: string | null; seconds?: number | null } | null }): Promise<{ options: SchedOption[]; hold: SchedHold | null } | null> {
    if (!this.finder?.bound() || !ctx.branchId || !input.date || !input.serviceIds?.length) return null;
    try {
      const r = await this.finder.findOptions({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions, actor: 'user' }, {
        date: input.date, serviceIds: input.serviceIds, technicianId: input.technicianId ?? null, limit: 20,
        hold: input.hold ? { channel: 'reception_copilot', customerId: input.hold.customerId ?? null, bookingSessionId: input.hold.bookingSessionId ?? null, ...(input.hold.seconds != null ? { seconds: input.hold.seconds } : {}) } : null,
      });
      return { options: r?.options ?? [], hold: r?.hold ?? null };
    } catch { return null; }
  }

  private toCtx(ctx: CopilotCtx): CustomersContext {
    return { tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions } as CustomersContext;
  }

  private safe(item: any): SafeCustomer {
    return {
      customerId: item.customerId,
      fullName: item.fullName,
      maskedPhone: maskPhone(item.phone),
      returning: (item.visitsCount ?? 0) > 0,
      visitsCount: item.visitsCount ?? 0,
      lastVisitDate: item.lastVisitDate ?? null,
      loyaltyTier: item.loyaltyTier ?? null,
      favoriteServiceName: item.favoriteServiceName ?? null,
      favoriteTechnicianName: item.favoriteTechnicianName ?? null,
      language: item.preferredLanguage === 'vi' || item.preferredLanguage === 'en' ? item.preferredLanguage : null,
    };
  }

  /** Resolve a caller (by phone) or an open customer (by id) into safe, read-only context. */
  async customerContext(ctx: CopilotCtx, input: { phone?: string; customerId?: string }): Promise<CustomerContextResult> {
    const cctx = this.toCtx(ctx);
    try {
      if (input.customerId) {
        const list = await this.customers.search(cctx, { search: input.customerId });
        const item = list.items.find((i) => i.customerId === input.customerId) ?? list.items[0];
        if (!item) return { matchState: 'none', candidates: [], customer: null };
        return { matchState: 'exact', candidates: [this.safe(item)], customer: await this.withAppointment(cctx, item) };
      }

      const phone = normalizePhone(input.phone ?? '');
      if (!phone) return { matchState: 'none', candidates: [], customer: null };
      const list = await this.customers.search(cctx, { search: phone });
      // Distinguish exact normalized-phone matches from broader search hits.
      const exact = list.items.filter((i) => normalizePhone(i.phone) === phone);
      const pool = exact.length > 0 ? exact : list.items;
      if (pool.length === 0) return { matchState: 'none', candidates: [], customer: null };       // unknown caller
      if (pool.length === 1) return { matchState: 'exact', candidates: [this.safe(pool[0])], customer: await this.withAppointment(cctx, pool[0]) };
      return { matchState: 'multiple', candidates: pool.slice(0, 5).map((i) => this.safe(i)), customer: null };
    } catch (e: any) {
      // CustomersService enforces pos.customers.view; a permission error becomes an honest denied state, not a crash.
      if (String(e?.name || '').match(/Forbidden/i) || String(e?.message || '').match(/permission|forbidden/i)) {
        return { matchState: 'none', candidates: [], customer: null, denied: true };
      }
      throw e;
    }
  }

  /**
   * Live queue summary (spec §19), read-only, delegating to the tenant+branch-scoped QueueService. Wait times are
   * estimates. Requires a branch in context (the queue is per-branch); with none, returns available:false rather than
   * fabricating zeros. A permission error becomes an honest denied state.
   */
  async queueSummary(ctx: CopilotCtx): Promise<QueueSummaryResult> {
    const empty: QueueSummaryResult = { available: false, waiting: 0, inService: 0, unassigned: 0, vipWaiting: 0, longestWaitMinutes: null };
    if (!ctx.branchId) return empty;   // queue is per-branch; be honest rather than invent a number
    try {
      const qctx: QueueContext = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
      const { items } = await this.queue.items(qctx);
      const WAITING = new Set(['waiting', 'called', 'assigned', 'ready_for_tech']);
      const active = items.filter((i) => WAITING.has(i.status));
      const waits = active.map((i) => i.actualWaitMinutes).filter((n): n is number => typeof n === 'number');
      return {
        available: true,
        waiting: active.length,
        inService: items.filter((i) => i.status === 'in_service').length,
        unassigned: active.filter((i) => !i.assignedTechnicianName).length,
        vipWaiting: active.filter((i) => i.isVip).length,
        longestWaitMinutes: waits.length ? Math.max(...waits) : null,
      };
    } catch (e: any) {
      if (String(e?.name || '').match(/Forbidden/i) || String(e?.message || '').match(/permission|forbidden/i)) return { ...empty, denied: true };
      throw e;
    }
  }

  /**
   * Possible duplicate customers (spec §16/§22), read-only. Delegates to the existing tenant-scoped
   * CustomersService.duplicates (permission-gated pos.customers.view). Surfaces candidates for the receptionist to
   * review — it NEVER merges (a merge would be a separate confirmed action through the customer-merge service).
   */
  async duplicateCandidates(ctx: CopilotCtx): Promise<DuplicatesResult> {
    const cctx = this.toCtx(ctx);
    try {
      const groups = await this.customers.duplicates(cctx);
      return {
        groups: (groups || []).map((g: any) => ({
          groupId: g.duplicateGroupId,
          reason: g.reason,
          members: (g.members || []).map((m: any) => ({ customerId: m.customerId, fullName: m.displayName, maskedPhone: maskPhone(m.phone ?? ''), visitCount: typeof m.visitCount === 'number' ? m.visitCount : null })),
        })),
      };
    } catch (e: any) {
      if (String(e?.name || '').match(/Forbidden/i) || String(e?.message || '').match(/permission|forbidden/i)) return { groups: [], denied: true };
      throw e;
    }
  }

  /**
   * Availability recommendations (spec §14) — read-only, delegates to the real schedule-aware
   * BookingService.availability (store hours ∩ tech schedule − breaks − blocked − buffers − existing appointments).
   * Returns the earliest handful of open slots across qualified technicians plus a per-tech breakdown. No Copilot-only
   * availability engine. Requires a branch; permission (pos.booking.view) enforced by the domain service.
   */
  async recommendAvailability(ctx: CopilotCtx, input: { date?: string; serviceIds?: string[]; technicianId?: string; hold?: { customerId?: string | null; bookingSessionId?: string | null; seconds?: number | null } | null }): Promise<AvailabilityRecommendation> {
    const empty: AvailabilityRecommendation = { available: false, date: input.date ?? null, recommendations: [], byTechnician: [] };
    if (!ctx.branchId) return empty;
    // Round 2 H: a hold asked for here is the desk's — a sealed desk session (returned as holdToken) and the salon's hold time.
    let deskSid: string | null = null;
    if (input.hold && this.holds && hasPermission(ctx as any, COPILOT_HOLD_PERMISSION)) {
      deskSid = input.hold.bookingSessionId ?? randomUUID();
      input = { ...input, hold: { ...input.hold, bookingSessionId: deskSid, seconds: await this.holds.holdSeconds(ctx.tenantId, ctx.branchId).catch(() => null) } };
    }
    const opt = await this.optimizerOptions(ctx, input);
    if (opt) {
      // ranked best-first by the optimizer (wait, gap fit, preference, workload …); the per-technician view keeps time order
      const byTech = new Map<string, { technicianId: string; name: string; slots: string[] }>();
      for (const o of opt.options) { const t = byTech.get(o.technicianId) ?? { technicianId: o.technicianId, name: o.technicianName, slots: [] }; t.slots.push(o.startTime); byTech.set(o.technicianId, t); }
      return {
        available: opt.options.length > 0, date: input.date ?? null, source: 'optimizer', hold: opt.hold,
        holdToken: opt.hold && deskSid ? sealBookingSession(deskSid, deskBinding(ctx)) : null,
        recommendations: opt.options.slice(0, 6).map((o) => ({ time: o.startTime, technicianId: o.technicianId, technicianName: o.technicianName })),
        byTechnician: [...byTech.values()].map((t) => { const s = t.slots.slice().sort(); return { technicianId: t.technicianId, name: t.name, slotCount: s.length, firstSlot: s[0] ?? null }; }),
      };
    }
    try {
      const bctx: BookingContext = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
      const perTech = await this.booking.availability(bctx, { date: input.date, serviceIds: input.serviceIds, technicianId: input.technicianId });
      const flat: { time: string; technicianId: string; technicianName: string }[] = [];
      const byTechnician = perTech.map((t) => {
        const slots = (t.slots || []).slice().sort();
        for (const time of slots) flat.push({ time, technicianId: t.technicianId, technicianName: t.name });
        return { technicianId: t.technicianId, name: t.name, slotCount: slots.length, firstSlot: slots[0] ?? null };
      });
      flat.sort((a, b) => a.time.localeCompare(b.time));           // earliest first
      return { available: flat.length > 0, date: input.date ?? null, recommendations: flat.slice(0, 6), byTechnician };
    } catch (e: any) {
      if (String(e?.name || '').match(/Forbidden/i) || String(e?.message || '').match(/permission|forbidden/i)) return { ...empty, denied: true };
      throw e;
    }
  }

  /**
   * Appointment conflict detection (spec §16) — read-only, delegates to the buffer-aware
   * BookingService.checkConflict (permission-gated pos.booking.view). Advisory only: the receptionist still confirms,
   * and the backend re-validates during any actual booking transaction. Requires a branch.
   */
  async detectConflict(ctx: CopilotCtx, input: { technicianId: string; startTime: string; endTime: string; date?: string; appointmentId?: string }): Promise<ConflictResult> {
    const base: ConflictResult = { hasConflict: false, status: 'unknown', conflictingAppointmentId: null };
    if (!ctx.branchId) return { ...base, unavailable: true };
    if (!input.technicianId || !input.startTime || !input.endTime) return { ...base, unavailable: true };
    try {
      const bctx: BookingContext = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
      const res = await this.booking.checkConflict(bctx, { technicianId: input.technicianId, startTime: input.startTime, endTime: input.endTime, date: input.date, appointmentId: input.appointmentId });
      const status = String(res?.status ?? 'unknown');
      const conflictingAppointmentId = res?.conflictingAppointmentId ?? null;
      return { hasConflict: !!conflictingAppointmentId || /conflict/i.test(status), status, conflictingAppointmentId };
    } catch (e: any) {
      if (String(e?.name || '').match(/Forbidden/i) || String(e?.message || '').match(/permission|forbidden/i)) return { ...base, denied: true };
      throw e;
    }
  }

  /**
   * Technician recommendations (spec §15) — read-only. Reuses the real schedule-aware BookingService.availability
   * (qualification + schedule already applied) and ranks qualified technicians by earliest availability then open-slot
   * count (a light workload signal). A `preferredTechnicianName` (e.g. the customer's usual tech, already known from
   * customer context) is flagged as `isUsual` and floated up. No payroll/commission/private fields. Requires a branch.
   */
  async recommendTechnicians(ctx: CopilotCtx, input: { serviceIds?: string[]; date?: string; preferredTechnicianName?: string }): Promise<TechnicianRecommendation> {
    const empty: TechnicianRecommendation = { available: false, technicians: [] };
    if (!ctx.branchId) return empty;
    const pref0 = (input.preferredTechnicianName ?? '').trim().toLowerCase();
    const opt = await this.optimizerOptions(ctx, input);
    if (opt) {
      // technicians in the optimizer's rank order (their best option first), the usual technician floated up
      const seen = new Map<string, { technicianId: string; name: string; firstAvailable: string | null; openSlots: number; isUsual: boolean }>();
      for (const o of opt.options) {
        const t = seen.get(o.technicianId) ?? { technicianId: o.technicianId, name: o.technicianName, firstAvailable: null as string | null, openSlots: 0, isUsual: !!pref0 && o.technicianName.trim().toLowerCase() === pref0 };
        t.openSlots++; if (!t.firstAvailable || o.startTime < t.firstAvailable) t.firstAvailable = o.startTime; seen.set(o.technicianId, t);
      }
      const list = [...seen.values()].sort((a, b) => Number(b.isUsual) - Number(a.isUsual));
      return { available: list.length > 0, technicians: list.slice(0, 6), source: 'optimizer' };
    }
    try {
      const bctx: BookingContext = { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
      const perTech = await this.booking.availability(bctx, { date: input.date, serviceIds: input.serviceIds });
      const pref = (input.preferredTechnicianName ?? '').trim().toLowerCase();
      const techs = perTech.map((t) => {
        const slots = (t.slots || []).slice().sort();
        return { technicianId: t.technicianId, name: t.name, firstAvailable: slots[0] ?? null, openSlots: slots.length, isUsual: !!pref && t.name.trim().toLowerCase() === pref };
      });
      // Only technicians with availability are recommendable; usual tech first, then earliest slot, then more openings.
      const available = techs.filter((t) => t.openSlots > 0).sort((a, b) =>
        (Number(b.isUsual) - Number(a.isUsual)) || (a.firstAvailable ?? '99:99').localeCompare(b.firstAvailable ?? '99:99') || (b.openSlots - a.openSlots));
      return { available: available.length > 0, technicians: available.slice(0, 6) };
    } catch (e: any) {
      if (String(e?.name || '').match(/Forbidden/i) || String(e?.message || '').match(/permission|forbidden/i)) return { ...empty, denied: true };
      throw e;
    }
  }

  /**
   * Draft a text message (spec §20) — read-only, deterministic templates enriched with the customer's REAL upcoming
   * appointment (reused from customerContext). Never invents details: appointment clauses appear only when real data
   * exists, and an unknown caller gets a generic greeting. The receptionist reviews/edits, then sends via the
   * confirm-gated send_message action. No LLM required (works today); an AI provider can refine later.
   */
  async draftMessage(ctx: CopilotCtx, input: { kind: DraftKind; customerId?: string; phone?: string }): Promise<DraftMessageResult> {
    let name: string | null = null;
    let appt: { startsAt: string; serviceName: string; technicianName: string } | null = null;
    let lang: 'en' | 'vi' = 'en';
    if (input.customerId || input.phone) {
      const c = await this.customerContext(ctx, { customerId: input.customerId, phone: input.phone });
      if (c.customer) { name = c.customer.fullName ?? null; appt = c.customer.upcomingAppointment ?? null; lang = c.customer.language === 'vi' ? 'vi' : 'en'; }
    }
    const base = draftMessageBody(input.kind, name, appt);          // deterministic, always available
    const refined = await this.refineDraft(ctx, input.kind, name, appt, base, lang);
    return { kind: input.kind, body: refined ?? base, matched: !!name, customerName: name, refined: refined != null, language: refined != null ? lang : 'en' };
  }

  /**
   * Optional LLM polish for a draft. Runs the deterministic template first (above) and only replaces it when a REAL
   * provider is configured (an AI key is set) and returns usable text. With no key the assistant returns a mock
   * response, which we detect and ignore — so drafting works identically today and simply gets better the moment a key
   * is added. Package/subscription-gated and fail-soft: any block or error keeps the deterministic draft.
   */
  private async refineDraft(ctx: CopilotCtx, kind: DraftKind, name: string | null, appt: { startsAt: string; serviceName: string; technicianName: string } | null, base: string, lang: 'en' | 'vi' = 'en'): Promise<string | null> {
    if (!this.ai) return null;
    const apptLine = appt ? `Appointment: ${appt.serviceName} with ${appt.technicianName} at ${appt.startsAt}.` : 'No specific appointment details are known.';
    const prompt = [
      'Rewrite the following salon SMS to a customer so it sounds warm, professional, and concise (one short paragraph, under 300 characters).',
      'Rules: keep any real appointment details exactly; do NOT invent dates, times, prices, or names; no placeholders or brackets; return ONLY the message text with no preamble or quotes.',
      `Message purpose: ${kind}.`,
      `Customer name: ${name ?? '(unknown — do not guess)'}.`,
      apptLine,
      `Current draft: ${base}`,
    ].join('\n');
    try {
      // §120: a customer who reads Vietnamese (WP-I) gets the polished draft in Vietnamese; everyone else in English
      const resp = await this.ai.run({ tenantId: ctx.tenantId, userId: ctx.userId ?? null, packageCode: 'ai_reception_copilot', action: 'copilot_draft_refine', prompt, responseLanguage: lang });
      if (!resp.ok || !resp.text) return null;
      if (!resp.usage || resp.usage.provider === 'mock') return null;   // no real provider → keep deterministic
      return cleanSmsDraft(resp.text);
    } catch {
      return null;   // blocked/provider error → deterministic
    }
  }

  /**
   * Intent detection (spec §11) — deterministic keyword routing that maps a receptionist's free-text to the most
   * likely Copilot capability. Purely advisory: it suggests where to go, never acts. Works today with no AI key; an
   * LLM can refine it later. Stateless (no tenant data), but kept here so the Copilot owns the capability.
   */
  detectIntent(_ctx: CopilotCtx, input: { text: string }): IntentResult {
    return classifyIntent(input?.text ?? '');
  }

  private async withAppointment(cctx: CustomersContext, item: any): Promise<SafeCustomer & { upcomingAppointment: any }> {
    let upcomingAppointment: any = null;
    try {
      const appts = await this.customers.appointments(cctx, item.customerId);
      const now = Date.now();
      const upcoming = (appts || []).filter((a) => new Date(a.startsAt).getTime() >= now).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
      if (upcoming) upcomingAppointment = { startsAt: upcoming.startsAt, serviceName: upcoming.serviceName, technicianName: upcoming.technicianName };
    } catch { /* appointments are best-effort context; never block the summary */ }
    return { ...this.safe(item), upcomingAppointment };
  }
}
