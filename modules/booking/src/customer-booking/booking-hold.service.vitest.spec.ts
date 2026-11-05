// booking-hold.service.vitest.spec.ts
//
// The hold service is what stops verification from racing the calendar. Two failures, both costing real money:
//
//   • the slot is sold while the customer types six digits → they verify, press Confirm, and are told it is gone
//   • two confirmations race                                → one hold becomes TWO appointments
//
// The second one is the reason `convert()` trusts the DATABASE and not its own read: a race beats any check the
// service could make.
import { describe, it, expect } from 'vitest';
import {
  BookingHoldService, HoldSlotTakenError, HoldNotConvertibleError, type HoldPort,
} from './booking-hold.kysely';
import { DEFAULT_HOLD_SECONDS, MAX_HOLD_SECONDS, type ActiveHold } from './booking-hold-core';

const NOW = 1_700_000_000_000;
const T = (m: number) => NOW + m * 60_000;

const req = (o: any = {}) => ({
  tenantId: 't1', branchId: 'b1', technicianId: 'tech1',
  startsAt: T(60), endsAt: T(120), bookingSessionId: 's1', channel: 'online',
  ...o,
});

function repo(initial: ActiveHold[] = []) {
  const holds = [...initial];
  const calls: string[] = [];
  let converted = false;
  const port: HoldPort = {
    async liveHolds() { return holds.filter((h) => !h.released && !h.convertedAppointmentId && h.expiresAt > NOW); },
    async create(r: any) { calls.push('create'); const h: ActiveHold = { holdId: 'new', tenantId: r.tenantId, branchId: r.branchId, technicianId: r.technicianId, startsAt: r.startsAt, endsAt: r.endsAt, expiresAt: r.expiresAt, bookingSessionId: r.bookingSessionId, released: false, convertedAppointmentId: null }; holds.push(h); return { holdId: 'new' }; },
    async refresh(id: string) { calls.push('refresh:' + id); },
    async release(id: string, reason: string) { calls.push(`release:${id}:${reason}`); const h = holds.find((x) => x.holdId === id); if (h) h.released = true; },
    async get(tenantId: string, id: string) { return holds.find((h) => h.holdId === id && h.tenantId === tenantId) ?? null; },
    async convert(id: string) { calls.push('convert:' + id); if (converted) return false; converted = true; return true; },
    async sweepExpired() { calls.push('sweep'); return 3; },
  };
  return { port, holds, calls, forceConverted: () => { converted = true; } };
}

const hold = (o: Partial<ActiveHold> = {}): ActiveHold => ({
  holdId: 'h1', tenantId: 't1', branchId: 'b1', technicianId: 'tech1',
  startsAt: T(60), endsAt: T(120), expiresAt: NOW + 600_000,
  bookingSessionId: 's9', released: false, convertedAppointmentId: null,
  ...o,
});

describe('acquire — hold the slot BEFORE sending a code', () => {
  it('creates a hold on a free slot', async () => {
    const { port, calls } = repo();
    const svc = new BookingHoldService(port);
    const r = await svc.acquire(req(), NOW);
    expect(r.holdId).toBe('new');
    expect(r.expiresAt).toBe(NOW + DEFAULT_HOLD_SECONDS * 1000);
    expect(calls).toContain('create');
  });

  it("REFUSES a slot another session holds — and never says who holds it", async () => {
    // Naming the holder would confirm another customer's booking exists.
    const { port } = repo([hold({ bookingSessionId: 'other' })]);
    const svc = new BookingHoldService(port);
    const err = await svc.acquire(req(), NOW).catch((e) => e);
    expect(err).toBeInstanceOf(HoldSlotTakenError);
    // Word-boundaried: "Please choose another" legitimately contains "other". What must not appear is the
    // identity of the holder — their session id or the technician they booked.
    expect(err.message).not.toMatch(/\bs9\b|\btech1\b|\bother\b(?!wise)/i);
    expect(err.message).not.toContain('s9');
    expect(err.message).not.toContain('tech1');
  });

  it('REFRESHES rather than duplicating when the same session re-asks', async () => {
    const { port, calls } = repo([hold({ holdId: 'mine', bookingSessionId: 's1' })]);
    const svc = new BookingHoldService(port);
    await svc.acquire(req({ bookingSessionId: 's1' }), NOW);
    expect(calls).toContain('refresh:mine');
    expect(calls).not.toContain('create');
  });

  it('RELEASES the old hold when the customer moves to a different slot', async () => {
    // One session, one hold. Otherwise a customer clicking through five times parks five slots, and an abandoned
    // flow leaves them all parked.
    const { port, calls } = repo([hold({ holdId: 'old', bookingSessionId: 's1' })]);
    const svc = new BookingHoldService(port);
    await svc.acquire(req({ bookingSessionId: 's1', startsAt: T(180), endsAt: T(240) }), NOW);
    expect(calls).toContain('release:old:superseded');
    expect(calls).toContain('create');
  });

  it('clamps an absurd hold duration — a tenant may not park a slot for an hour', async () => {
    const { port } = repo();
    const svc = new BookingHoldService(port);
    const r = await svc.acquire(req({ holdSeconds: 99_999 }), NOW);
    expect(r.expiresAt).toBe(NOW + MAX_HOLD_SECONDS * 1000);
  });
});

describe('convert — the last gate before an appointment exists', () => {
  it('converts a live hold owned by this session', async () => {
    const { port, calls } = repo([hold({ bookingSessionId: 's1' })]);
    const svc = new BookingHoldService(port);
    await svc.convert('t1', 'h1', 's1', 'appt-1', NOW);
    expect(calls).toContain('convert:h1');
  });

  it("REFUSES a hold belonging to another booking session — the replay", async () => {
    // Verify one booking, then present that verified session against somebody else's hold.
    const { port } = repo([hold({ bookingSessionId: 'someone-else' })]);
    const svc = new BookingHoldService(port);
    await expect(svc.convert('t1', 'h1', 's1', 'appt-1', NOW)).rejects.toBeInstanceOf(HoldNotConvertibleError);
  });

  it('REFUSES a hold belonging to another tenant', async () => {
    const { port } = repo([hold({ tenantId: 't2' })]);
    const svc = new BookingHoldService(port);
    await expect(svc.convert('t1', 'h1', 's9', 'appt-1', NOW)).rejects.toBeInstanceOf(HoldNotConvertibleError);
  });

  it('REFUSES an expired hold', async () => {
    const { port } = repo([hold({ bookingSessionId: 's1', expiresAt: NOW - 1 })]);
    const svc = new BookingHoldService(port);
    const err = await svc.convert('t1', 'h1', 's1', 'appt-1', NOW).catch((e) => e);
    expect(err.reason).toBe('expired');
  });

  it('TWO RACING CONFIRMATIONS cannot both create an appointment', async () => {
    // Both requests read "not yet converted" and both pass the pure check. Only the DATABASE can serialise this
    // — the UPDATE matches zero rows for the loser, and `convert()` returns false. A service-level check would
    // have let both through.
    const { port } = repo([hold({ bookingSessionId: 's1' })]);
    const svc = new BookingHoldService(port);
    const results = await Promise.allSettled([
      svc.convert('t1', 'h1', 's1', 'appt-A', NOW),
      svc.convert('t1', 'h1', 's1', 'appt-B', NOW),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as any).reason).toBeInstanceOf(HoldNotConvertibleError);
    expect((failed[0] as any).reason.reason).toBe('already_converted');
  });

  it("a wrong-session refusal reads the SAME as an expired one", async () => {
    // "That hold belongs to someone else" confirms the hold exists — an enumeration oracle.
    const { port: p1 } = repo([hold({ bookingSessionId: 'other' })]);
    const { port: p2 } = repo([hold({ bookingSessionId: 's1', expiresAt: NOW - 1 })]);
    const a = await new BookingHoldService(p1).convert('t1', 'h1', 's1', 'x', NOW).catch((e) => e);
    const b = await new BookingHoldService(p2).convert('t1', 'h1', 's1', 'x', NOW).catch((e) => e);
    expect(a.message).toBe(b.message);
  });
});

describe('release', () => {
  it("will not release another tenant's hold", async () => {
    // A hold id is a uuid, but releasing someone else's would hand their slot to whoever asked.
    const { port, calls } = repo([hold({ tenantId: 't2' })]);
    const svc = new BookingHoldService(port);
    await svc.release('t1', 'h1', 'customer_canceled');
    expect(calls.filter((c) => c.startsWith('release'))).toHaveLength(0);
  });

  it('releases its own', async () => {
    const { port, calls } = repo([hold()]);
    await new BookingHoldService(port).release('t1', 'h1', 'verification_failed');
    expect(calls).toContain('release:h1:verification_failed');
  });
});

describe('sweep', () => {
  it('hands lapsed slots back to the calendar', async () => {
    // Without this, a crashed or abandoned booking flow parks a prime slot until someone notices — a quiet
    // denial-of-service on the salon's own diary.
    const { port } = repo();
    expect(await new BookingHoldService(port).sweep(NOW)).toBe(3);
  });
});
