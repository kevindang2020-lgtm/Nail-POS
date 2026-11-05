// voice-manage.service.ts — verification-gated appointment management for the voice receptionist (reschedule / cancel /
// search) plus consent-gated customer creation. Every mutating action requires (1) the caller verified against a
// customer on file per the configured policy, and (2) the target appointment to be OWNED by that verified customer —
// the AI can never see or change another customer's appointment. All actions delegate to the canonical BookingService /
// CustomersService (no booking/customer logic duplicated) under the AI_RECEPTIONIST role.
import { BookingService, type BookingContext } from '@aipowersalon/booking';
import { isSlotConflict } from './voice-booking-write.service';
import { Injectable, Inject } from '@nestjs/common';
import { CustomersService } from '@aipowersalon/customers';
import { AI_RECEPTIONIST_ROLE, AI_RECEPTIONIST_PERMISSIONS } from './voice-booking-write.service';
import { verificationMode, verifyCaller, ownsAppointment, normalizePhone } from './voice-caller-verify-core';
import type { VoiceContext } from './voice-booking.service';

export interface VerifiedCaller { verified: true; customerId: string; phone: string; name: string }
export interface VoiceApptSummary { appointmentId: string; date: string; startTime: string; endTime: string; serviceName: string; technicianName: string | null; status: string }
export interface VoiceManageResult { ok: boolean; error?: string; handoff?: boolean; appointmentId?: string; date?: string; startTime?: string; endTime?: string; /** The slot is taken — from the error's type/code (isSlotConflict), never its wording. */ slotUnavailable?: boolean }

@Injectable()
export class VoiceManageService {
  constructor(
    @Inject(BookingService) private readonly booking: BookingService,
    @Inject(CustomersService) private readonly customers: CustomersService,
  ) {}

  private bctx(v: VoiceContext): BookingContext {
    return { tenantId: v.tenantId, branchId: v.branchId, userId: 'voice-receptionist', role: AI_RECEPTIONIST_ROLE, permissions: [...AI_RECEPTIONIST_PERMISSIONS] };
  }
  private cctx(v: VoiceContext): any {
    return { tenantId: v.tenantId, branchId: v.branchId, userId: 'voice-receptionist', role: AI_RECEPTIONIST_ROLE, permissions: [...AI_RECEPTIONIST_PERMISSIONS] };
  }

  /**
   * Verify the caller against a customer on file per VOICE_VERIFICATION_MODE. Returns the verified customer or a null
   * result the agent must relay ("I couldn't verify that number"). NEVER reveals whether a number exists beyond the
   * verification outcome.
   */
  /**
   * Constitution 12 §108–110 (finding M12). `provided.phone` is what the caller SAID — filled into the tool arguments
   * by the voice AI. On its own it proved nothing: knowing a customer's number (an ex, a coworker, anyone with the
   * salon's contact list) was enough to hear their upcoming appointments and, with write tools on, to cancel or move
   * them. `callerId` is the number the call actually COMES FROM, reported by the telephony provider and outside the
   * caller's (and the model's) control. The spoken number must match it; no caller id — withheld, unknown, or an
   * integration that does not send it — means no verification, and the agent hands off to the front desk.
   * REQUIRED, not optional, so no call site can skip it by omission.
   */
  async verifyCaller(v: VoiceContext, provided: { phone: string; name?: string | null }, callerId: string | null): Promise<VerifiedCaller | null> {
    const phone = normalizePhone(provided.phone);
    if (!phone || phone.length < 10) return null;
    const fromNumber = normalizePhone(callerId);
    if (!fromNumber || fromNumber.length < 10 || fromNumber !== phone) return null;
    // find a customer by phone via the canonical service (search), then confirm exact phone match
    const res = await this.customers.list(this.cctx(v), { search: phone } as any).catch(() => null);
    const rows: any[] = (res as any)?.items ?? (res as any)?.customers ?? (Array.isArray(res) ? res : []);
    // The customer's CURRENT number (normalized_phone) — never the editable display text, and never a replaced number
    // (Phase 3, audit E4: this matched phone_display, which activation had filled with a mask and staff could edit).
    const match = rows.find((r) => normalizePhone(r.normalizedPhone) === phone) ?? null;
    if (!match) return null;
    if (!verifyCaller(verificationMode(), provided, { customerId: match.customerId, phone: match.normalizedPhone, firstName: match.firstName, lastName: match.lastName })) return null;
    return { verified: true, customerId: match.customerId, phone, name: match.displayName ?? match.firstName ?? '' };
  }

  /** The verified caller's own upcoming appointments — filtered to them, never another customer's. */
  async searchAppointments(v: VoiceContext, caller: VerifiedCaller): Promise<VoiceApptSummary[]> {
    const res = await this.booking.appointments(this.bctx(v), { search: caller.phone } as any);
    const items: any[] = (res as any)?.items ?? [];
    return items
      .filter((a) => ownsAppointment(caller.customerId, a, caller.phone) && !['cancelled', 'no_show', 'completed'].includes(a.status))
      .map((a) => ({ appointmentId: a.appointmentId, date: a.date ?? '', startTime: a.startTime, endTime: a.endTime, serviceName: a.services?.[0]?.serviceName ?? '', technicianName: a.technicianName ?? null, status: a.status }));
  }

  /** Reschedule — only the verified caller's own appointment, only after confirmation. Delegates to the atomic path. */
  // Round 3 H2: `callSessionId` (server-derived voiceCallSession) — the move runs under the call's booking session, so the
  // call's own hold on the new time does not block it (and is used up), while another call's / desk's hold does.
  async rescheduleAppointment(v: VoiceContext, input: { appointmentId: string; date?: string; startTime: string; caller: VerifiedCaller; confirmed: boolean; callSessionId?: string | null }): Promise<VoiceManageResult> {
    if (!input.confirmed) return { ok: false, error: 'Not changed: the caller has not confirmed the new time yet.' };
    const owned = await this.assertOwned(v, input.appointmentId, input.caller);
    if (!owned.ok) return owned;
    try {
      const row = await this.booking.reschedule(this.bctx(v), input.appointmentId, { startTime: input.startTime, date: input.date, reason: 'Rescheduled by AI receptionist', holdSessionId: input.callSessionId ?? null } as any);
      return { ok: true, appointmentId: row.appointmentId, date: (row as any).date ?? input.date, startTime: row.startTime, endTime: row.endTime };
    } catch (e: any) {
      if (isSlotConflict(e)) return { ok: false, slotUnavailable: true, error: 'That time isn\u2019t available.' };
      if (/hours/i.test(String(e?.message))) return { ok: false, error: 'That time isn\u2019t available.' };   // outside store / technician hours
      return { ok: false, error: e?.message || 'I could not complete that change.' };
    }
  }

  /** Cancel — only the verified caller's own appointment, only after explicit confirmation. */
  async cancelAppointment(v: VoiceContext, input: { appointmentId: string; caller: VerifiedCaller; confirmed: boolean; reason?: string }): Promise<VoiceManageResult> {
    if (!input.confirmed) return { ok: false, error: 'Not cancelled: the caller has not confirmed the cancellation yet.' };
    const owned = await this.assertOwned(v, input.appointmentId, input.caller);
    if (!owned.ok) return owned;
    try {
      await this.booking.cancel(this.bctx(v), input.appointmentId, { reason: input.reason?.slice(0, 200) || 'Cancelled by AI receptionist', notifyCustomer: true } as any);
      return { ok: true, appointmentId: input.appointmentId };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'I could not cancel that appointment.' };
    }
  }

  /**
   * Look up a customer by phone, or create one — creation REQUIRES explicit consent (the caller agreed to save their
   * details). Without consent, creation is refused. Reuses CustomersService (duplicate detection included).
   * Returns safe booking-conversation fields only; flags ambiguity instead of guessing between matches.
   */
  async lookupOrCreateCustomer(v: VoiceContext, input: { phone: string; name?: string; consent?: boolean }): Promise<{ ok: boolean; customerId?: string; created?: boolean; ambiguous?: boolean; matchType?: string; customer?: { firstName: string; lastName: string | null; phone: string | null }; error?: string }> {
    const phone = normalizePhone(input.phone);
    if (!phone || phone.length < 10) return { ok: false, error: 'A valid phone number is required.' };
    const res = await this.customers.list(this.cctx(v), { search: phone } as any).catch(() => null);
    const rows: any[] = (res as any)?.items ?? (res as any)?.customers ?? [];
    const matches = rows.filter((r) => normalizePhone(r.phone) === phone);
    if (matches.length > 1) return { ok: false, ambiguous: true, error: 'More than one customer matches that phone number.' };
    const existing = matches[0];
    if (existing) return { ok: true, customerId: existing.customerId, created: false, matchType: 'PHONE_EXACT', customer: { firstName: existing.firstName ?? existing.displayName ?? '', lastName: existing.lastName ?? null, phone: existing.phone ?? null } };
    if (input.consent !== true) return { ok: false, error: 'I can only save your details with your permission. May I have your consent to create a profile?' };
    const [firstName, ...rest] = String(input.name ?? '').trim().split(/\s+/);
    try {
      const row: any = await this.customers.create(this.cctx(v), { firstName: firstName || 'Guest', lastName: rest.join(' ') || undefined, phone } as any);
      return { ok: true, customerId: row.customerId, created: true, matchType: 'CREATED', customer: { firstName: row.firstName ?? firstName ?? 'Guest', lastName: row.lastName ?? null, phone: row.phone ?? phone } };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'I could not save that profile.' };
    }
  }

  /** Contact fields for a tenant-owned customer id (used when the gateway books by customerId). Null if not found. */
  async customerContact(v: VoiceContext, customerId: string): Promise<{ name: string; phone: string | null } | null> {
    try {
      const d: any = await this.customers.detail(this.cctx(v), customerId);
      if (!d) return null;
      return { name: d.displayName ?? [d.firstName, d.lastName].filter(Boolean).join(' ') ?? 'Guest', phone: d.phone ?? null };
    } catch { return null; }
  }

  /** The verified caller's OWN appointment detail (masked) — cross-customer requests read as not-found. */
  async getOwnAppointment(v: VoiceContext, caller: VerifiedCaller, appointmentId: string): Promise<{ ok: boolean; error?: string; appointment?: any }> {
    let a: any;
    try { a = await this.booking.detail(this.bctx(v), appointmentId); }
    catch { return { ok: false, error: 'I couldn\u2019t find that appointment.' }; }
    if (!a || !ownsAppointment(caller.customerId, a, caller.phone)) return { ok: false, error: 'I couldn\u2019t find that appointment under your account.' };
    const modifiable = !['cancelled', 'no_show', 'completed'].includes(a.status);
    return { ok: true, appointment: {
      id: a.appointmentId, status: a.status, date: a.date ?? null, startTime: a.startTime, endTime: a.endTime,
      services: (a.services ?? []).map((s: any) => ({ id: s.serviceId ?? null, name: s.serviceName ?? '' })),
      technician: a.technicianId ? { id: a.technicianId, name: a.technicianName ?? null } : null,
      customer: { firstName: String(a.customerName ?? '').split(/\s+/)[0] || null },
      canReschedule: modifiable, canCancel: modifiable,
    } };
  }


  /** Load the appointment and confirm the verified caller owns it — the core cross-customer safety gate. */
  private async assertOwned(v: VoiceContext, appointmentId: string, caller: VerifiedCaller): Promise<VoiceManageResult> {
    let appt: any;
    try { appt = await this.booking.detail(this.bctx(v), appointmentId); }
    catch { return { ok: false, error: 'I couldn\u2019t find that appointment.' }; }
    if (!appt || !ownsAppointment(caller.customerId, appt, caller.phone)) {
      // Do NOT reveal another customer's appointment — treat as not found.
      return { ok: false, error: 'I couldn\u2019t find that appointment under your account.' };
    }
    return { ok: true };
  }

  /**
   * Drop candidate slots that the authoritative booking rules would reject at create() time. The customer-booking
   * availability grid the gateway rides on does not pad the booking buffer, but BookingService.create enforces it —
   * so a boundary slot can be offered then fail with SLOT_UNAVAILABLE. This re-verifies each candidate against the
   * EXISTING buffer-aware BookingService.checkConflict (the same rule create uses — no duplicated conflict math) so
   * the AI never offers an unbookable time. Bounded to `cap` candidates to keep phone-paced latency in check; returns
   * the bookable ones in order. Voice-path only — customer-web availability is unchanged (its buffer alignment is a
   * separate product decision).
   */
  async filterBookable<T extends { startTime: string; endTime: string; technicianId: string }>(v: VoiceContext, date: string, options: T[], cap = 12): Promise<T[]> {
    const ctx = this.bctx(v);
    const out: T[] = [];
    for (const o of options.slice(0, cap)) {
      try {
        const res = await this.booking.checkConflict(ctx, { technicianId: o.technicianId, startTime: o.startTime, endTime: o.endTime, date });
        if (res.status !== 'conflict') out.push(o);
      } catch { /* if the check itself fails, omit the slot rather than offer an unverifiable time */ }
    }
    return out;
  }
}
