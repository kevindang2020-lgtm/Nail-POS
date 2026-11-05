// booking-hold-core.ts — the PURE rules for reserving an appointment slot while phone verification happens.
//
// ── The problem this exists to solve ─────────────────────────────────────────────────────────────────────
// Phone verification takes time: send an SMS, wait for the customer to read it, type six digits, maybe resend.
// That is thirty seconds to several minutes. Without a hold, the slot stays sellable for that whole window —
// so the customer verifies their phone, presses Confirm, and is told the time they picked is gone. Worse, two
// customers can both verify and both be told the slot is theirs.
//
// A hold reserves the slot BEFORE the code is sent, and releases it if verification fails, expires, or is
// abandoned. The appointment itself is not created until the phone is verified — that ordering is the entire
// point of the module, and it is why a hold (not an appointment) is what we take.
//
// ── Why this is a HOLD and not the existing checkout-lock ────────────────────────────────────────────────
// `checkout-lock` locks a TICKET so two devices do not check the same customer out twice. Same discipline,
// different resource: this reserves a TIME RANGE on a TECHNICIAN before an appointment row exists at all. The
// pure shape is deliberately modelled on checkout-lock-core (decide* / isExpired / nextExpiry) so the two read
// the same way.
//
// ── PURE ─────────────────────────────────────────────────────────────────────────────────────────────────
// No DB, no clock, no ids generated here. `now` is always passed in. The service persists; this decides.

/** A hold that currently exists on a slot. */
export interface ActiveHold {
  holdId: string;
  tenantId: string;
  branchId: string;
  technicianId: string | null;      // null = "first available" — see overlapsSlot()
  startsAt: number;                 // epoch ms
  endsAt: number;                   // epoch ms
  expiresAt: number;                // epoch ms — when the RESERVATION lapses, not when the appointment ends
  bookingSessionId: string;
  released: boolean;
  convertedAppointmentId: string | null;
}

/** Who is asking. `bookingSessionId` is the server-issued session — never a client-supplied id. */
export interface HoldRequest {
  tenantId: string;
  branchId: string;
  technicianId: string | null;
  startsAt: number;
  endsAt: number;
  bookingSessionId: string;
}

// ── platform-safe bounds ─────────────────────────────────────────────────────────────────────────────────
//
// A tenant may configure the hold duration, but only INSIDE these bounds. Too short and a customer who is slow
// with an SMS loses the slot they were told they had. Too long and one abandoned session can park a prime
// Saturday slot for an hour — which is a denial-of-service on the salon's own calendar, dressed up as a
// setting. Neither end is safe to leave to configuration alone.
export const MIN_HOLD_SECONDS = 120;          // 2 min — below this, a slow SMS loses the slot
export const MAX_HOLD_SECONDS = 900;          // 15 min — above this, abandonment becomes a booking-blocker
export const DEFAULT_HOLD_SECONDS = 600;      // 10 min — matches the existing OTP TTL, so the hold cannot
                                              // outlive the code it is waiting for, or vice versa

export function clampHoldSeconds(requested: number | null | undefined): number {
  // `Number(null)` is 0, NOT NaN — so a null (never-configured) duration would sail past a `isFinite` check and
  // clamp to the 2-minute MINIMUM. A tenant who simply never set this would silently get the shortest hold the
  // platform allows, and their customers would lose slots while typing an SMS code. Absent means DEFAULT.
  if (requested == null || (typeof requested === 'string' && (requested as string).trim() === '')) return DEFAULT_HOLD_SECONDS;
  const n = Number(requested);
  if (!Number.isFinite(n)) return DEFAULT_HOLD_SECONDS;
  return Math.min(MAX_HOLD_SECONDS, Math.max(MIN_HOLD_SECONDS, Math.round(n)));
}

/** One booking session may hold ONE slot. Otherwise a single script can park the whole day. */
export const MAX_HOLDS_PER_SESSION = 1;

export function isExpired(h: Pick<ActiveHold, 'expiresAt'>, now: number): boolean {
  return now >= h.expiresAt;
}

/** A hold only reserves anything while it is live: not released, not expired, not already converted. */
export function isLive(h: ActiveHold, now: number): boolean {
  return !h.released && h.convertedAppointmentId === null && !isExpired(h, now);
}

/**
 * Do two slots collide?
 *
 * Half-open intervals — [start, end) — so a 10:00–11:00 booking and an 11:00–12:00 booking do NOT collide.
 * Treating the boundary as a conflict would make back-to-back appointments impossible, which is how salons
 * actually run.
 *
 * A `null` technician means "first available". A held first-available slot collides with EVERY technician at
 * that time, because we do not yet know which one it will land on — and quietly letting a specific-technician
 * booking through would be double-selling the very technician the first-available hold is about to take.
 * Conservative on purpose: over-holding costs a salon one slot for a few minutes; under-holding double-books a
 * real customer.
 */
export function overlapsSlot(
  a: Pick<ActiveHold, 'technicianId' | 'startsAt' | 'endsAt'>,
  b: Pick<HoldRequest, 'technicianId' | 'startsAt' | 'endsAt'>,
): boolean {
  const timeOverlap = a.startsAt < b.endsAt && b.startsAt < a.endsAt;
  if (!timeOverlap) return false;
  if (a.technicianId === null || b.technicianId === null) return true;   // first-available collides with all
  return a.technicianId === b.technicianId;
}

export type HoldDecision =
  | { action: 'create' }
  | { action: 'refresh'; holdId: string }                    // same session re-asking for the same slot
  | { action: 'replace'; releaseHoldId: string }             // same session moved to a different slot
  | { action: 'rejected'; reason: 'slot_held'; message: string }
  | { action: 'rejected'; reason: 'invalid_range'; message: string };

const SLOT_TAKEN = 'That time was just taken. Please choose another.';

/**
 * Decide what to do with a hold request, given every hold that currently exists for this tenant+branch.
 *
 * `existing` MUST already be tenant+branch scoped by the caller. Nothing here re-checks tenancy, because
 * nothing here can: a pure function cannot know what it was not given. That is the service's job, and the
 * service tests pin it.
 */
export function decideHold(existing: ActiveHold[], req: HoldRequest, now: number): HoldDecision {
  if (!(req.startsAt < req.endsAt)) {
    return { action: 'rejected', reason: 'invalid_range', message: 'That appointment time is not valid.' };
  }

  const live = existing.filter((h) => isLive(h, now));

  // This session's own hold. A customer who goes back and changes the time must not be blocked by the slot they
  // themselves were holding a moment ago — and must not be able to accumulate a second one either.
  const mine = live.find((h) => h.bookingSessionId === req.bookingSessionId);

  const conflicting = live.find(
    (h) => h.bookingSessionId !== req.bookingSessionId && overlapsSlot(h, req),
  );
  // Somebody else's live hold wins, always. First to hold, first served — including over this session's own
  // attempt to move onto it.
  if (conflicting) {
    return { action: 'rejected', reason: 'slot_held', message: SLOT_TAKEN };
  }

  if (mine) {
    const sameSlot =
      mine.technicianId === req.technicianId && mine.startsAt === req.startsAt && mine.endsAt === req.endsAt;
    // Re-asking for the same slot extends it (the customer is still verifying). Asking for a DIFFERENT slot
    // releases the old one — one session, one hold, so an abandoned flow can never leave a slot parked.
    return sameSlot ? { action: 'refresh', holdId: mine.holdId } : { action: 'replace', releaseHoldId: mine.holdId };
  }

  return { action: 'create' };
}

/** When a new/refreshed hold lapses. */
export function nextExpiry(now: number, holdSeconds: number): number {
  return now + clampHoldSeconds(holdSeconds) * 1000;
}

export type ReleaseReason =
  | 'verification_failed'
  | 'verification_expired'
  | 'customer_canceled'
  | 'call_ended'            // Round 2 H: the AI receptionist's call finished with the time still held
  | 'hold_expired'
  | 'converted'
  | 'superseded';

/**
 * May this hold be turned into a real appointment?
 *
 * The last gate before an appointment exists. It refuses a hold that is expired, released, already converted,
 * or that belongs to a different booking session — the last of which is the replay attack: verify one booking,
 * then present that verified session against somebody else's hold.
 */
export function canConvert(
  h: ActiveHold | null,
  req: { bookingSessionId: string; tenantId: string },
  now: number,
): { ok: true } | { ok: false; reason: 'no_hold' | 'expired' | 'released' | 'already_converted' | 'wrong_session' | 'wrong_tenant'; message: string } {
  if (!h) return { ok: false, reason: 'no_hold', message: 'Your reservation has expired. Please pick a time again.' };
  // Tenant is re-checked HERE as well as in the service. A hold is the thing that becomes an appointment and an
  // appointment is money; one cheap comparison is worth more than the elegance of trusting the caller.
  if (h.tenantId !== req.tenantId) return { ok: false, reason: 'wrong_tenant', message: 'Your reservation has expired. Please pick a time again.' };
  if (h.bookingSessionId !== req.bookingSessionId) {
    // Deliberately the SAME message as an expired hold. Telling a caller "that hold belongs to someone else"
    // confirms the hold exists, which is an enumeration oracle.
    return { ok: false, reason: 'wrong_session', message: 'Your reservation has expired. Please pick a time again.' };
  }
  if (h.convertedAppointmentId !== null) return { ok: false, reason: 'already_converted', message: 'This booking has already been confirmed.' };
  if (h.released) return { ok: false, reason: 'released', message: 'Your reservation has expired. Please pick a time again.' };
  if (isExpired(h, now)) return { ok: false, reason: 'expired', message: 'Your reservation has expired. Please pick a time again.' };
  return { ok: true };
}

/** Round 3 H2 (Oct 12 2026): the ONE advisory-lock key that serialises "place a hold" against "book / move into a slot" for
 *  a branch's local day. Booking create / reschedule take it INSIDE their transaction (after the technician+day lock) and
 *  re-read live holds there; SlotHoldService.place takes it and re-reads appointments there — so a hold and a booking of
 *  the same slot, racing, can never both win. Lock order is always technician+day → this key (no deadlock). */
export function bookingHoldLockKey(tenantId: string, branchId: string, date: string): string {
  return `booking_holds|${tenantId}|${branchId}|${date}`;
}
