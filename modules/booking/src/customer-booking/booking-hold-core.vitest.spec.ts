// booking-hold-core.vitest.spec.ts
//
// A hold reserves a slot while the customer verifies their phone. The failures that matter are the two that
// cost real money:
//
//   • UNDER-holding → two customers both verify and are both told the same slot is theirs. A double-booked
//     technician and a customer turned away at the door.
//   • OVER-holding  → one abandoned script parks the whole Saturday. A denial-of-service on the salon's own
//     calendar, dressed up as a setting.
//
// Almost everything below is one of those two.
import { describe, it, expect } from 'vitest';
import {
  decideHold, canConvert, overlapsSlot, isLive, isExpired, nextExpiry, clampHoldSeconds,
  MIN_HOLD_SECONDS, MAX_HOLD_SECONDS, DEFAULT_HOLD_SECONDS,
  type ActiveHold, type HoldRequest,
} from './booking-hold-core';

const NOW = 1_700_000_000_000;
const T = (mins: number) => NOW + mins * 60_000;

const hold = (o: Partial<ActiveHold> = {}): ActiveHold => ({
  holdId: 'h1', tenantId: 't1', branchId: 'b1', technicianId: 'tech1',
  startsAt: T(60), endsAt: T(120), expiresAt: NOW + 600_000,
  bookingSessionId: 's1', released: false, convertedAppointmentId: null,
  ...o,
});

const req = (o: Partial<HoldRequest> = {}): HoldRequest => ({
  tenantId: 't1', branchId: 'b1', technicianId: 'tech1',
  startsAt: T(60), endsAt: T(120), bookingSessionId: 's2',
  ...o,
});

describe('overlapsSlot — the rule that stops a double-booking', () => {
  it('back-to-back appointments do NOT collide', () => {
    // Half-open [start, end). If the boundary counted as a conflict, no salon could run 10–11 then 11–12 —
    // which is how salons actually run.
    expect(overlapsSlot(hold({ startsAt: T(0), endsAt: T(60) }), req({ startsAt: T(60), endsAt: T(120) }))).toBe(false);
  });

  it('any real time overlap on the same technician collides', () => {
    expect(overlapsSlot(hold({ startsAt: T(0), endsAt: T(60) }), req({ startsAt: T(59), endsAt: T(120) }))).toBe(true);
    expect(overlapsSlot(hold({ startsAt: T(30), endsAt: T(90) }), req({ startsAt: T(0), endsAt: T(120) }))).toBe(true);   // enclosing
  });

  it('different technicians at the same time do NOT collide', () => {
    expect(overlapsSlot(hold({ technicianId: 'tech1' }), req({ technicianId: 'tech2' }))).toBe(false);
  });

  it('a FIRST-AVAILABLE hold collides with every technician at that time', () => {
    // We do not yet know which technician it will land on. Letting a specific-technician booking through would
    // be double-selling the very person the first-available hold is about to take. Over-holding costs one slot
    // for a few minutes; under-holding double-books a real customer.
    expect(overlapsSlot(hold({ technicianId: null }), req({ technicianId: 'tech9' }))).toBe(true);
    expect(overlapsSlot(hold({ technicianId: 'tech9' }), req({ technicianId: null }))).toBe(true);
    expect(overlapsSlot(hold({ technicianId: null }), req({ technicianId: null }))).toBe(true);
  });
});

describe('decideHold', () => {
  it('creates a hold on a free slot', () => {
    expect(decideHold([], req(), NOW)).toEqual({ action: 'create' });
  });

  it("REJECTS a slot another session is holding — first to hold, first served", () => {
    const d = decideHold([hold({ bookingSessionId: 's1' })], req({ bookingSessionId: 's2' }), NOW);
    expect(d.action).toBe('rejected');
    expect((d as any).reason).toBe('slot_held');
  });

  it('ignores an EXPIRED hold — a lapsed reservation must not block the calendar forever', () => {
    const stale = hold({ bookingSessionId: 's1', expiresAt: NOW - 1 });
    expect(decideHold([stale], req({ bookingSessionId: 's2' }), NOW)).toEqual({ action: 'create' });
  });

  it('ignores a released hold, and a hold already converted to an appointment', () => {
    expect(decideHold([hold({ bookingSessionId: 's1', released: true })], req({ bookingSessionId: 's2' }), NOW).action).toBe('create');
    expect(decideHold([hold({ bookingSessionId: 's1', convertedAppointmentId: 'a1' })], req({ bookingSessionId: 's2' }), NOW).action).toBe('create');
  });

  it('REFRESHES when the same session re-asks for the same slot (the customer is still verifying)', () => {
    const d = decideHold([hold({ bookingSessionId: 's1' })], req({ bookingSessionId: 's1' }), NOW);
    expect(d).toEqual({ action: 'refresh', holdId: 'h1' });
  });

  it('REPLACES when the same session moves to a different slot — one session, one hold', () => {
    // Otherwise a customer clicking through five times parks five slots, and an abandoned flow leaves them all
    // parked. This is the over-holding failure, and it is the easy one to ship by accident.
    const d = decideHold([hold({ bookingSessionId: 's1' })], req({ bookingSessionId: 's1', startsAt: T(180), endsAt: T(240) }), NOW);
    expect(d).toEqual({ action: 'replace', releaseHoldId: 'h1' });
  });

  it("a session cannot jump onto someone else's live hold, even to 'move' its own", () => {
    const others = hold({ holdId: 'h9', bookingSessionId: 's9', startsAt: T(180), endsAt: T(240) });
    const own = hold({ holdId: 'h1', bookingSessionId: 's1' });
    const d = decideHold([own, others], req({ bookingSessionId: 's1', startsAt: T(180), endsAt: T(240) }), NOW);
    expect(d.action).toBe('rejected');
  });

  it('rejects an invalid time range rather than holding nothing at all', () => {
    expect(decideHold([], req({ startsAt: T(120), endsAt: T(60) }), NOW).action).toBe('rejected');
    expect(decideHold([], req({ startsAt: T(60), endsAt: T(60) }), NOW).action).toBe('rejected');   // zero-length
  });

  it('never leaks WHO holds a contended slot', () => {
    const d = decideHold([hold({ bookingSessionId: 's1' })], req({ bookingSessionId: 's2' }), NOW);
    expect((d as any).message).not.toMatch(/s1|tech1|session/i);
  });
});

describe('hold duration is bounded by the PLATFORM, not by tenant configuration', () => {
  it('clamps a too-short duration up', () => {
    expect(clampHoldSeconds(5)).toBe(MIN_HOLD_SECONDS);      // a slow SMS must not lose the slot
  });
  it('clamps a too-long duration down', () => {
    // An hour-long hold is a denial-of-service on the salon's own calendar. A tenant may not configure that.
    expect(clampHoldSeconds(3600)).toBe(MAX_HOLD_SECONDS);
  });
  it('falls back to the default on nonsense', () => {
    expect(clampHoldSeconds(null)).toBe(DEFAULT_HOLD_SECONDS);
    expect(clampHoldSeconds(NaN as any)).toBe(DEFAULT_HOLD_SECONDS);
    expect(clampHoldSeconds('abc' as any)).toBe(DEFAULT_HOLD_SECONDS);
  });
  it('the default matches the OTP lifetime, so the hold cannot outlive the code it waits for', () => {
    expect(DEFAULT_HOLD_SECONDS).toBe(600);                  // = OTP_TTL_SECONDS in customer-activation-core
  });
  it('nextExpiry clamps too', () => {
    expect(nextExpiry(NOW, 99_999)).toBe(NOW + MAX_HOLD_SECONDS * 1000);
  });
});

describe('canConvert — the last gate before an appointment exists', () => {
  const ok = { bookingSessionId: 's1', tenantId: 't1' };

  it('allows a live hold owned by this session', () => {
    expect(canConvert(hold(), ok, NOW)).toEqual({ ok: true });
  });

  it('REFUSES a hold belonging to another booking session — the replay attack', () => {
    // Verify one booking, then present that verified session against somebody else's hold. This is the exact
    // replay the spec calls out, and it dies here.
    const r = canConvert(hold({ bookingSessionId: 's9' }), ok, NOW);
    expect(r).toMatchObject({ ok: false, reason: 'wrong_session' });
  });

  it('REFUSES a hold belonging to another TENANT', () => {
    const r = canConvert(hold({ tenantId: 't2' }), ok, NOW);
    expect(r).toMatchObject({ ok: false, reason: 'wrong_tenant' });
  });

  it('refuses expired, released, and already-converted holds', () => {
    expect(canConvert(hold({ expiresAt: NOW - 1 }), ok, NOW)).toMatchObject({ ok: false, reason: 'expired' });
    expect(canConvert(hold({ released: true }), ok, NOW)).toMatchObject({ ok: false, reason: 'released' });
    expect(canConvert(hold({ convertedAppointmentId: 'a1' }), ok, NOW)).toMatchObject({ ok: false, reason: 'already_converted' });
  });

  it('refuses when there is no hold at all', () => {
    expect(canConvert(null, ok, NOW)).toMatchObject({ ok: false, reason: 'no_hold' });
  });

  it('a wrong-session refusal is INDISTINGUISHABLE from an expired one', () => {
    // "That hold belongs to someone else" confirms the hold exists. That is an enumeration oracle, so the
    // message is deliberately identical.
    const a = canConvert(hold({ bookingSessionId: 's9' }), ok, NOW) as any;
    const b = canConvert(hold({ expiresAt: NOW - 1 }), ok, NOW) as any;
    expect(a.message).toBe(b.message);
  });

  it('double-converting the same hold cannot create a second appointment', () => {
    const converted = hold({ convertedAppointmentId: 'appt-1' });
    expect(canConvert(converted, ok, NOW)).toMatchObject({ ok: false, reason: 'already_converted' });
  });
});

describe('isLive / isExpired', () => {
  it('a hold is live only when it is unreleased, unconverted, and unexpired', () => {
    expect(isLive(hold(), NOW)).toBe(true);
    expect(isLive(hold({ released: true }), NOW)).toBe(false);
    expect(isLive(hold({ convertedAppointmentId: 'a' }), NOW)).toBe(false);
    expect(isLive(hold({ expiresAt: NOW }), NOW)).toBe(false);      // expiry is inclusive — at the instant it lapses, it is gone
  });
  it('isExpired is inclusive at the boundary', () => {
    expect(isExpired({ expiresAt: NOW }, NOW)).toBe(true);
    expect(isExpired({ expiresAt: NOW + 1 }, NOW)).toBe(false);
  });
});
