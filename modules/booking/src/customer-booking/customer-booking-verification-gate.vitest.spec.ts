// customer-booking-verification-gate.vitest.spec.ts
//
// The single fact this module exists to enforce:
//
//     AN APPOINTMENT MUST NOT BE CREATED BEFORE THE PHONE BEHIND IT IS PROVEN.
//
// BUILD_PLAN Phase 4: the audit found every test here used a FAKE gate — and the real adapter passed `customerPhone:
// null` and always answered "not verified", so the customer app looped on 428 forever while these tests were green.
// These now drive the REAL chain: CustomerBookingService → customerAppAdmission → VerifiedBookingFlow → the guard and
// the policy resolver, with only the database rows (config, sessions, holds) in memory. `insertBookingAtomic` is
// spied on: if it was called, an appointment exists.
import { describe, it, expect } from 'vitest';
import { phoneKey } from '@aipowersalon/customers';
import {
  CustomerBookingService, PhoneVerificationRequiredError, PhoneVerificationUnavailableError, BookingConflictError, BookingValidationError,
} from './customer-booking.service';
import { customerAppAdmission } from './customer-booking.module';
import { BookingVerificationGuard, type BookingVerificationConfigPort } from './booking-verification-guard';
import { VerifiedBookingFlow, type ProofStore } from './booking-verification-flow';
import { BookingHoldService, type HoldPort } from './booking-hold.kysely';
import type { ActiveHold } from './booking-hold-core';
import { openBookingSession, sealBookingSession } from './booking-session-token';

const CTX = { tenantId: 't1', branchId: 'b1', userId: 'u1' } as any;
const BODY = { serviceId: 'svc1', technicianId: 'tech1', date: '2026-08-01', startTime: '10:00' };
const PHONE = '+18565550101';

interface World {
  required: boolean; configured: boolean; healthy: boolean; verifyEvery: boolean;
  lastVerifiedAt: number | null; phone: string | null; throwOn?: 'platform' | 'lastVerified';
}

function build(w: Partial<World> = {}, opts: { bound?: boolean } = {}) {
  const world: World = { required: true, configured: true, healthy: true, verifyEvery: false, lastVerifiedAt: null, phone: PHONE, ...w };
  const inserted: any[] = [];
  const cfg: BookingVerificationConfigPort = {
    async platform() { if (world.throwOn === 'platform') throw new Error('db down'); return { emergencyDisabled: false, moduleEnabled: true, requiredForTenant: false, blockedForTenant: false, version: 1 }; },
    async tenant() { return { enabled: world.required, channels: { customer_app: true }, verifyEveryBooking: world.verifyEvery, reverifyAfterSeconds: 86_400, reverifyOnGroupBooking: true, reverifyOnDeposit: true, reverifyOnHighValue: true, version: 1 }; },
    async branch() { return null; },
    async provider() { return { configured: world.configured, healthy: world.healthy, version: 1 }; },
    async lastVerified() { if (world.throwOn === 'lastVerified') throw new Error('db down'); return world.lastVerifiedAt == null ? null : { verifiedAt: world.lastVerifiedAt }; },
  };
  // the session rows: pending (opened by a 428) → verified (by the check route) → consumed (by ONE appointment)
  const sessions = new Map<string, { phoneHash: string; status: string; consumed: boolean; appointmentId: string | null; label: string | null; override?: boolean }>();
  const store: ProofStore = {
    async openPending(i) { const cur = sessions.get(i.bookingSessionId); sessions.set(i.bookingSessionId, { phoneHash: i.phoneHash, status: cur?.status === 'verified' ? 'verified' : 'pending', consumed: false, appointmentId: null, label: null }); },
    async claimProof(_t, sid, hash) { const s = sessions.get(sid); if (!s || s.status !== 'verified' || s.consumed || s.phoneHash !== hash) return null; s.consumed = true; return { sessionId: sid, method: s.override ? 'staff_override' : 'verified' }; },
    async attachProof(_t, sid, appt, label) { if (sid) { const s = sessions.get(sid)!; s.appointmentId = appt; s.label = label; } labels.set(appt, label); },
    async releaseProof(sid) { const s = sessions.get(sid); if (s && !s.appointmentId) s.consumed = false; },
    async holdSeconds() { return 600; },
  };
  const labels = new Map<string, string | null>();
  const holds: ActiveHold[] = [];
  let n = 0;
  const repo: HoldPort = {
    async liveHolds() { return holds.filter((h) => !h.released && !h.convertedAppointmentId && h.expiresAt > Date.now()); },
    async create(r) { const id = 'h' + ++n; holds.push({ holdId: id, tenantId: r.tenantId, branchId: r.branchId, technicianId: r.technicianId, startsAt: r.startsAt, endsAt: r.endsAt, expiresAt: r.expiresAt, bookingSessionId: r.bookingSessionId, released: false, convertedAppointmentId: null }); return { holdId: id }; },
    async refresh(id, exp) { const h = holds.find((x) => x.holdId === id); if (h) h.expiresAt = exp; },
    async release(id) { const h = holds.find((x) => x.holdId === id); if (h) h.released = true; },
    async get(_t, id) { return holds.find((x) => x.holdId === id) ?? null; },
    async convert(id, appt) { const h = holds.find((x) => x.holdId === id); if (!h || h.convertedAppointmentId) return false; h.convertedAppointmentId = appt; return true; },
    async sweepExpired() { return 0; },
    async bySession(_t, sid) { return [...holds].reverse().find((h) => h.bookingSessionId === sid) ?? null; },
  };
  const flow = new VerifiedBookingFlow(new BookingVerificationGuard(cfg), store, { service: new BookingHoldService(repo), repo });
  const phones = { async phoneFor() { return world.phone; } };
  const bookRepo: any = {
    async resolveCustomerId() { return { id: 'c1', fullName: 'Jane Doe' }; },
    async getService() { return { id: 'svc1', name: 'Gel', durationMinutes: 60, priceCents: 4000 }; },
    async getTechnician() { return { id: 'tech1', fullName: 'Tech One' }; },
    async existingForDate() { return []; },
    async insertBookingAtomic(row: any) { inserted.push(row); return { ok: true, id: 'appt-' + inserted.length }; },
  };
  const svc = new CustomerBookingService(bookRepo, undefined, opts.bound === false ? undefined : customerAppAdmission(flow, phones as any, {} as any));
  /** What the check route does on a right code. */
  const verify = (token: string) => { const sid = openBookingSession(token, { tenantId: 't1', customerId: 'u1' })!; sessions.get(sid)!.status = 'verified'; };
  return { svc, inserted, sessions, holds, labels, world, verify };
}

/** The controller seals the session it got from the 428 — the client presents that token. */
const tokenOf = (e: PhoneVerificationRequiredError) => sealBookingSession(e.bookingSessionId, { tenantId: 't1', customerId: 'u1' });

describe('the gate — an unverified booking must not become an appointment', () => {
  it('REFUSES the booking (428) when verification is required — and HOLDS the slot for this booking session', async () => {
    const { svc, inserted, holds } = build();
    const e = await svc.book(CTX, BODY).catch((x) => x);
    expect(e).toBeInstanceOf(PhoneVerificationRequiredError);
    expect(inserted).toHaveLength(0);                                   // the only assertion that really matters
    expect(holds).toHaveLength(1);
    expect(holds[0].bookingSessionId).toBe(e.bookingSessionId);
    expect(e.holdExpiresAt).toBe(holds[0].expiresAt);
  });
  it('the whole loop: refuse → verify → retry with the session → booked, labelled, the hold converted', async () => {
    const { svc, inserted, holds, labels, verify } = build();
    const e = await svc.book(CTX, BODY).catch((x) => x) as PhoneVerificationRequiredError;
    const token = tokenOf(e);
    verify(token);
    const done = await svc.book(CTX, { ...BODY, bookingSessionId: token });
    expect(done.appointmentId).toBe('appt-1');
    expect(inserted).toHaveLength(1);
    expect(labels.get('appt-1')).toBe('verified');
    expect(holds[0].convertedAppointmentId).toBe('appt-1');
    // Wave 3 (§73): the atomic insert re-reads live holds INSIDE its transaction — it must know which session's hold is
    // this booking's own, or the customer's verification hold would refuse the customer's own booking.
    expect(inserted[0].bookingSessionId).toBe(holds[0].bookingSessionId);
  });
  it('"verify every booking": one proof is ONE appointment — the next booking asks again', async () => {
    const { svc, verify } = build({ verifyEvery: true });
    const e = await svc.book(CTX, BODY).catch((x) => x) as PhoneVerificationRequiredError;
    const token = tokenOf(e);
    verify(token);
    await svc.book(CTX, { ...BODY, bookingSessionId: token });
    await expect(svc.book(CTX, { ...BODY, startTime: '13:00', bookingSessionId: token })).rejects.toBeInstanceOf(PhoneVerificationRequiredError);
  });
  it('a token sealed for another user (or a raw id) proves nothing — refused, nothing created, the proof untouched', async () => {
    const { svc, verify, inserted, sessions } = build();
    const e = await svc.book(CTX, BODY).catch((x) => x) as PhoneVerificationRequiredError;
    verify(tokenOf(e));
    const otherUsers = sealBookingSession(e.bookingSessionId, { tenantId: 't1', customerId: 'u2' });
    // Without a token that opens, the slot is held by "another booking" (the session it cannot name) — refused.
    await expect(svc.book(CTX, { ...BODY, bookingSessionId: otherUsers })).rejects.toBeInstanceOf(BookingConflictError);
    await expect(svc.book(CTX, { ...BODY, bookingSessionId: e.bookingSessionId })).rejects.toBeInstanceOf(BookingConflictError);
    // …and at another time, where nothing is held, it is simply a new verification
    await expect(svc.book(CTX, { ...BODY, startTime: '15:00', bookingSessionId: otherUsers })).rejects.toBeInstanceOf(PhoneVerificationRequiredError);
    expect(inserted).toHaveLength(0);
    expect(sessions.get(e.bookingSessionId)!.consumed).toBe(false);
  });
  it('carries a booking session and a MASKED phone — never the full number', async () => {
    const { svc } = build();
    const err = await svc.book(CTX, BODY).catch((e) => e) as PhoneVerificationRequiredError;
    expect(err.maskedPhone).toContain('0101');
    expect(JSON.stringify({ m: err.message, p: err.maskedPhone })).not.toMatch(/\d{7,}/);
  });
  it('a customer with no number on file is told to add one — nothing is created', async () => {
    const { svc, inserted } = build({ phone: null });
    await expect(svc.book(CTX, BODY)).rejects.toBeInstanceOf(BookingValidationError);
    expect(inserted).toHaveLength(0);
  });
});

describe('holds', () => {
  it('a slot held for ANOTHER booking session is not bookable — even when verification is not required', async () => {
    const a = build();
    await a.svc.book(CTX, BODY).catch(() => null);                     // customer A is verifying for 10:00
    const b = build({ required: false });
    b.holds.push(...a.holds);
    await expect(b.svc.book({ ...CTX, userId: 'u9' }, BODY)).rejects.toBeInstanceOf(BookingConflictError);
    expect(b.inserted).toHaveLength(0);
  });
  it('a slot taken between the code and the retry gives the proof back (no new code needed for another time)', async () => {
    const w = build();
    const e = await w.svc.book(CTX, BODY).catch((x) => x) as PhoneVerificationRequiredError;
    const token = tokenOf(e);
    w.verify(token);
    const svcRepo = (w.svc as any).repo;
    const orig = svcRepo.insertBookingAtomic;
    svcRepo.insertBookingAtomic = async () => ({ ok: false });
    await expect(w.svc.book(CTX, { ...BODY, bookingSessionId: token })).rejects.toBeInstanceOf(BookingConflictError);
    svcRepo.insertBookingAtomic = orig;
    const sid = e.bookingSessionId;
    expect(w.sessions.get(sid)!.consumed).toBe(false);
  });
});

describe('a broken provider REFUSES the booking — it never waves it through', () => {
  it('not configured → PhoneVerificationUnavailable, nothing created, nothing held', async () => {
    const { svc, inserted, holds } = build({ configured: false });
    await expect(svc.book(CTX, BODY)).rejects.toBeInstanceOf(PhoneVerificationUnavailableError);
    expect(inserted).toHaveLength(0);
    expect(holds).toHaveLength(0);
  });
  it('blocked even when the customer WAS previously verified', async () => {
    const { svc, inserted } = build({ healthy: false, lastVerifiedAt: Date.now() - 60_000 });
    await expect(svc.book(CTX, BODY)).rejects.toBeInstanceOf(PhoneVerificationUnavailableError);
    expect(inserted).toHaveLength(0);
  });
  it('does not leak the provider name to the customer', async () => {
    const { svc } = build({ configured: false });
    const e = await svc.book(CTX, BODY).catch((x) => x);
    expect(String(e.message)).not.toMatch(/twilio/i);
  });
});

describe('the gate does not fire when the policy says it should not', () => {
  it('proceeds when verification is not required (unlabelled)', async () => {
    const { svc, inserted, labels } = build({ required: false });
    await svc.book(CTX, BODY);
    expect(inserted).toHaveLength(1);
    expect(labels.get('appt-1') ?? null).toBeNull();
  });
  it('proceeds on the account’s recent verification — labelled "recently verified", no new code', async () => {
    const { svc, inserted, labels } = build({ lastVerifiedAt: Date.now() - 60_000 });
    await svc.book(CTX, BODY);
    expect(inserted).toHaveLength(1);
    expect(labels.get('appt-1')).toBe('recently_verified');
  });
  it('proceeds when no admission is bound at all — existing tenants are not broken by this shipping', async () => {
    const { svc, inserted } = build({}, { bound: false });
    await svc.book(CTX, BODY);
    expect(inserted).toHaveLength(1);
  });
});

describe('the gate cannot be bypassed by breaking it', () => {
  it('a config lookup that THROWS fails the booking — an exception never becomes an unverified appointment', async () => {
    const { svc, inserted } = build({ throwOn: 'platform' });
    await expect(svc.book(CTX, BODY)).rejects.toThrow('db down');
    expect(inserted).toHaveLength(0);
  });
  it('a verification-history lookup that throws also fails the booking', async () => {
    const { svc, inserted } = build({ throwOn: 'lastVerified' });
    await expect(svc.book(CTX, BODY)).rejects.toThrow('db down');
    expect(inserted).toHaveLength(0);
  });
});

describe('the gate runs AFTER the conflict check', () => {
  it('a taken slot is rejected without holding or texting anything', async () => {
    const w = build();
    (w.svc as any).repo.existingForDate = async () => [{ appointmentId: 'x', technicianId: 'tech1', startTime: '10:00', endTime: '11:00', status: 'booked' }];
    await expect(w.svc.book(CTX, BODY)).rejects.toBeInstanceOf(BookingConflictError);
    expect(w.holds).toHaveLength(0);
    expect(w.sessions.size).toBe(0);
  });
});

void phoneKey;
