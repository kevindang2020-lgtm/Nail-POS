// booking-verification-flow.ts — the ONE way a remote booking is admitted (BUILD_PLAN Phase 4).
//
// The guard answers "may this appointment exist yet?". It could not answer it usefully on its own, which is why the
// audit found 0 of 3 remote channels able to finish a verified booking:
//   • a successful check only wrote the per-phone trust row — nothing tied the proof to the booking that asked for it,
//     so "verify every booking" could never be satisfied and the customer app looped on 428;
//   • holds existed and were never taken, while the screens told customers their slot was held;
//   • the public link trusted any recently verified number, whoever typed it.
//
// So every channel (customer app, public link, AI receptionist, kiosk) now goes through `admit()`:
//
//   1. the slot must not be held by another booking session;
//   2. the policy is resolved (the guard — one resolver for every channel);
//   3. verification required + a PROOF presented → the proof is CLAIMED atomically (one verified session = one
//      appointment; a second booking presenting it gets nothing);
//   4. verification required and not yet proven → the slot is HELD for this booking session (the salon's hold time),
//      a pending verification session is opened (staff can see it, and override it), and the caller gets
//      `BookingPhoneNotVerifiedError` carrying the booking session to send the code for;
//   5. after the appointment exists, `complete()` labels it (how its phone was proven), ties the proof to it and turns
//      the hold into it; if creating it failed, `abandon()` gives the proof back for a retry.
import { randomUUID } from 'node:crypto';
import { normalizePhone, phoneKey, maskPhone } from '@aipowersalon/customers';
import {
  BookingVerificationGuard, BookingPhoneNotVerifiedError, BookingVerificationUnavailableError, BookingPhoneInvalidError,
  type GuardCtx,
} from './booking-verification-guard';
import type { BookingRisk, PolicyResult } from './booking-verification-policy';
import { overlapsSlot, type ActiveHold } from './booking-hold-core';
import { HoldSlotTakenError, type BookingHoldService, type HoldPort } from './booking-hold.kysely';

/** A proof is good for this long after the code was entered. Long enough to finish the booking, not a trust window. */
export const PROOF_MAX_AGE_MS = 30 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VerificationLabel = 'verified' | 'recently_verified' | 'staff_override';

export interface ProofStore {
  /** Open (or re-open) the verification for this booking session: phone, hold, deadline. Not proven yet. */
  openPending(i: {
    tenantId: string; branchId: string; bookingSessionId: string; customerId: string | null; channel: string;
    phoneHash: string; phoneMask: string; holdId: string | null; expiresAt: number; requestIp?: string | null; deviceId?: string | null;
    /** The policy and configuration versions that asked for this verification (a disputed booking is explained from the row). */
    versions?: PolicyResult['versions'] | null;
    /** WHY this booking must verify (the resolver's machine reason) — the details overlay explains the rule from the row. */
    reason?: string | null;
  }): Promise<void>;
  /** Booking Phone Verification guide §9 (Oct 31 2026): the facts the special re-verification rules need, read server-side
   *  from the booked services — price (high-value line), whether the salon's deposit policy would charge a deposit. */
  riskFacts?(tenantId: string, branchId: string, serviceIds: string[]): Promise<{ priceCents: number; depositRequired: boolean; highValueThresholdCents: number | null } | null>;
  /** Claim this booking session's proof (SMS-verified, or a manager's override) for ONE booking. Atomic. */
  claimProof(tenantId: string, bookingSessionId: string, phoneHash: string, maxAgeMs: number): Promise<{ sessionId: string; method: 'verified' | 'staff_override' } | null>;
  /** The proof produced this appointment; the appointment says how its phone was proven. */
  attachProof(tenantId: string, sessionId: string | null, appointmentId: string, label: VerificationLabel | null): Promise<void>;
  /** Creating the appointment failed — the proof may be used again. */
  releaseProof(sessionId: string): Promise<void>;
  /** The salon's (or branch's) hold time, seconds. */
  holdSeconds(tenantId: string, branchId: string): Promise<number>;
}

export interface BookingSlot { technicianId: string | null; startsAt: number; endsAt: number; serviceIds?: string[] }

export interface AdmitInput {
  phone: string | null | undefined;
  /** The booking session (raw uuid, already unsealed by the channel) this request continues, if any. */
  bookingSessionId?: string | null;
  slot?: BookingSlot | null;
  customerId?: string | null;
  deviceId?: string | null;
  requestIp?: string | null;
  risk?: BookingRisk | null;
}

export interface Admission {
  policy: PolicyResult;
  label: VerificationLabel | null;
  proof: { sessionId: string } | null;
  hold: { holdId: string; bookingSessionId: string } | null;
}

export class VerifiedBookingFlow {
  constructor(
    private readonly guard: BookingVerificationGuard,
    private readonly store: ProofStore,
    private readonly holds?: { service: BookingHoldService; repo: HoldPort },
  ) {}

  /** Throws unless this booking may be created now. Returning is the ONLY permission. */
  async admit(ctx: GuardCtx, input: AdmitInput): Promise<Admission> {
    const session = input.bookingSessionId && UUID.test(input.bookingSessionId) ? input.bookingSessionId : null;

    // 1. somebody else is verifying for this slot
    if (input.slot && this.holds) await this.assertNotHeldByOthers(ctx, input.slot, session);

    // 2. the policy
    const risk = input.risk ?? await this.riskFor(ctx, input.slot ?? null);
    const policy = await this.guard.resolve(ctx, { customerPhone: input.phone ?? null, deviceId: input.deviceId ?? null, risk });
    if (policy.blocked) throw new BookingVerificationUnavailableError(policy.message, policy.reason);
    const ownHold = session && this.holds ? await this.holds.repo.bySession?.(ctx.tenantId, session) ?? null : null;
    const holdOf = (h: ActiveHold | null) => (h && !h.released && !h.convertedAppointmentId ? { holdId: h.holdId, bookingSessionId: h.bookingSessionId } : null);
    if (!policy.mustVerify) {
      return { policy, label: policy.decision === 'recent_verification_accepted' ? 'recently_verified' : null, proof: null, hold: holdOf(ownHold) };
    }

    const e164 = input.phone ? normalizePhone(String(input.phone)) : null;
    if (!e164) throw new BookingPhoneInvalidError();
    const hash = phoneKey(e164);

    // 3. a proof for THIS booking session and THIS number
    if (session) {
      const claimed = await this.store.claimProof(ctx.tenantId, session, hash, PROOF_MAX_AGE_MS);
      if (claimed) return { policy, label: claimed.method, proof: { sessionId: claimed.sessionId }, hold: holdOf(ownHold) };
    }

    // 4. not proven: hold the slot, open the verification, ask for the code
    const bookingSessionId = session ?? randomUUID();
    let holdId: string | null = null;
    let expiresAt = Date.now() + 10 * 60_000;
    if (input.slot && this.holds) {
      const held = await this.holds.service.acquire({
        tenantId: ctx.tenantId, branchId: ctx.branchId, technicianId: input.slot.technicianId,
        startsAt: input.slot.startsAt, endsAt: input.slot.endsAt, bookingSessionId,
        channel: ctx.channel, customerId: input.customerId ?? null, serviceIds: input.slot.serviceIds ?? [],
        holdSeconds: await this.store.holdSeconds(ctx.tenantId, ctx.branchId),
      });
      holdId = held.holdId; expiresAt = held.expiresAt;
    }
    await this.store.openPending({
      tenantId: ctx.tenantId, branchId: ctx.branchId, bookingSessionId, customerId: input.customerId ?? null, channel: ctx.channel,
      phoneHash: hash, phoneMask: maskPhone(e164), holdId, expiresAt, requestIp: input.requestIp ?? null, deviceId: input.deviceId ?? null,
      versions: policy.versions ?? null, reason: policy.reason ?? null,
    });
    throw new BookingPhoneNotVerifiedError(policy.message, maskPhone(e164), policy.reason, { bookingSessionId, holdExpiresAt: holdId ? expiresAt : null });
  }

  /**
   * The booking's special-case facts (guide §9), read from the SERVER's service rows — never from the client. A group
   * booking cannot arrive here today: no remote path (app, link, AI receptionist) books more than one guest, so
   * isGroupBooking stays false and the screen says the group switch has nothing to gate yet. No services named = no
   * risk facts (the ordinary policy still applies); a failed read throws (fail closed) rather than relax a rule.
   */
  private async riskFor(ctx: GuardCtx, slot: BookingSlot | null): Promise<BookingRisk | null> {
    const ids = (slot?.serviceIds ?? []).filter((x) => UUID.test(String(x)));
    if (!ids.length || !this.store.riskFacts) return null;
    // fail CLOSED: a database error here refuses the booking (like every other required-verification read in this module) —
    // swallowing it would answer "no special rule applies", i.e. LESS verification on exactly the error path
    const f = await this.store.riskFacts(ctx.tenantId, ctx.branchId, ids);
    if (!f) return null;
    return {
      isGroupBooking: false,
      requiresDeposit: !!f.depositRequired,
      isHighValue: f.highValueThresholdCents != null && f.priceCents >= f.highValueThresholdCents,
      highRisk: false,
    };
  }

  /** The appointment exists: label it, tie the proof to it, turn the hold into it. Never undoes the appointment.
   *  A conversion that fails here (the hold lapsed) does not unbook: the retry that got here re-ran admit(), which
   *  refuses a slot another session now holds, and the channel's own appointment-conflict check ran before insert —
   *  so a code entered after the hold expired can only confirm a time that is still free (guide §7 "separation of lifetimes"). */
  async complete(ctx: GuardCtx, a: Admission, appointmentId: string): Promise<void> {
    await this.store.attachProof(ctx.tenantId, a.proof?.sessionId ?? null, appointmentId, a.label).catch(() => undefined);
    if (a.hold && this.holds) await this.holds.service.convert(ctx.tenantId, a.hold.holdId, a.hold.bookingSessionId, appointmentId).catch(() => undefined);
  }

  /** Creating the appointment failed — give the proof back so the customer can retry without a new code. */
  async abandon(a: Admission | null): Promise<void> {
    if (a?.proof) await this.store.releaseProof(a.proof.sessionId).catch(() => undefined);
  }

  private async assertNotHeldByOthers(ctx: GuardCtx, slot: BookingSlot, ownSession: string | null): Promise<void> {
    const live = await this.holds!.repo.liveHolds(ctx.tenantId, ctx.branchId, slot.startsAt, slot.endsAt);
    const req = { tenantId: ctx.tenantId, branchId: ctx.branchId, technicianId: slot.technicianId, startsAt: slot.startsAt, endsAt: slot.endsAt, bookingSessionId: ownSession ?? '' };
    if (live.some((h) => h.bookingSessionId !== ownSession && overlapsSlot(h, req))) {
      // never says who holds it — that would confirm another customer's booking exists
      throw new HoldSlotTakenError('That time is being held for another booking. Please choose another time.');
    }
  }
}
