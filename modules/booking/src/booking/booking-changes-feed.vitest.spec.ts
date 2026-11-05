// booking-changes-feed.vitest.spec.ts — Smooth Refresh spec §25–§27/§89/§91: the Booking board change feed.
// Service rules on the in-memory twin; the database stamp that makes every writer visible is proven on real Postgres in
// booking-concurrency.postgres-race.vitest.spec.ts.
import { describe, expect, it } from 'vitest';
import { InMemoryBookingRepository } from './booking.repository';
import { DEFAULT_BOOKING_SETTINGS, BookingResyncRequired, BOOKING_FEED, encodeBookingCursor } from './booking.dto';
import { BookingService } from './booking.service';

class Repo extends InMemoryBookingRepository {
  async settings() { return { ...DEFAULT_BOOKING_SETTINGS, bufferMinutes: 0, openTime: '08:00', closeTime: '21:00' }; }
}
const PERMS = ['pos.booking.view', 'pos.booking.create', 'pos.booking.edit', 'pos.booking.reschedule'];
const ctx = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_fd', role: 'FRONT_DESK', permissions: PERMS } as any;
const DATE = '2026-06-08';
const book = (svc: BookingService, startTime: string, name = 'Ava') => svc.create(ctx, { customerName: name, serviceIds: ['svc_mani'], date: DATE, startTime, technicianId: 'tech_mia', source: 'manual' });

describe('GET /pos/booking/changes (spec §25–§27)', () => {
  it('first call returns an empty list and a baseline cursor + serverTime (§91)', async () => {
    const r = await new BookingService(new Repo()).changes(ctx, undefined);
    expect(r.appointments).toEqual([]);
    expect(r.cursor).toMatch(/^v1\./);
    expect(Date.parse(r.serverTime)).toBeGreaterThan(0);
  });

  it('a new booking and a reschedule come back as complete rows with their version; a quiet tick returns nothing new', async () => {
    const svc = new BookingService(new Repo());
    const base = await svc.changes(ctx, undefined, Date.now() - 1_000);
    const a = await book(svc, '10:00');
    const r1 = await svc.changes(ctx, base.cursor);
    expect(r1.appointments.map((x) => x.appointmentId)).toContain(a.appointmentId);
    await svc.reschedule(ctx, a.appointmentId, { startTime: '11:00', expectedVersion: a.version });
    const r2 = await svc.changes(ctx, r1.cursor);
    const moved = r2.appointments.find((x) => x.appointmentId === a.appointmentId)!;
    expect(moved.startTime).toBe('11:00');
    expect(moved.version).toBe((a.version ?? 1) + 1);
  });

  it('§26: garbage or expired cursors → RESYNC_REQUIRED (the board reloads its snapshot, no page refresh)', async () => {
    const svc = new BookingService(new Repo());
    await expect(svc.changes(ctx, 'not-a-cursor')).rejects.toBeInstanceOf(BookingResyncRequired);
    const old = encodeBookingCursor(new Date(Date.now() - BOOKING_FEED.maxAgeMs - 1_000).toISOString());
    const e = await svc.changes(ctx, old).catch((x) => x);
    expect(e).toBeInstanceOf(BookingResyncRequired);
    expect(e.code).toBe('RESYNC_REQUIRED');
    expect(e.reason).toBe('cursor_expired');
  });

  it('§26: a burst of more than maxRows changes → RESYNC_REQUIRED(too_many_changes) instead of a huge delta', async () => {
    const repo = new Repo(); const svc = new BookingService(repo);
    const base = await svc.changes(ctx, undefined, Date.now() - 1_000);
    const many = Array.from({ length: BOOKING_FEED.maxRows + 1 }, (_, i) => ({ id: `x${i}`, updatedAt: new Date().toISOString() }));
    (repo as any).changedSince = async () => many;
    const e = await svc.changes(ctx, base.cursor).catch((x) => x);
    expect(e.reason).toBe('too_many_changes');
  });

  it('the cursor never moves backwards and never past serverTime', async () => {
    const svc = new BookingService(new Repo());
    const now = Date.now();
    const base = await svc.changes(ctx, undefined, now - 5_000);
    await book(svc, '12:00');
    const r = await svc.changes(ctx, base.cursor, now);
    const at = (c: string) => Date.parse(Buffer.from(c.slice(3), 'base64url').toString('utf8'));
    expect(at(r.cursor)).toBeGreaterThanOrEqual(at(base.cursor));
    expect(at(r.cursor)).toBeLessThanOrEqual(now);
  });

  it('a quiet board\'s cursor keeps advancing — 40 quiet minutes of ticks never trigger RESYNC_REQUIRED', async () => {
    // Regression pin: the cursor used to stay at the last change, so after maxAgeMs every idle board was told to reload.
    const svc = new BookingService(new Repo());
    // RELATIVE to the real clock: the fixture rows are stamped with the real time, so a fixed t0 made this test pass
    // only until that hour of that day (it failed at 18:50 UTC on Sep 30 2026). A day ahead keeps every row before the window.
    const t0 = Date.now() + 86_400_000;
    let r = await svc.changes(ctx, undefined, t0);
    for (let m = 1; m <= 40; m++) {
      r = await svc.changes(ctx, r.cursor, t0 + m * 60_000);    // one tick a minute, nothing changes
      expect(r.appointments).toEqual([]);
    }
    expect(r.cursor).not.toBe(encodeBookingCursor(new Date(t0).toISOString()));
    expect(Date.parse(Buffer.from(r.cursor.slice(3), 'base64url').toString('utf8'))).toBeGreaterThanOrEqual(t0 + 40 * 60_000 - BOOKING_FEED.lookBackMs);
  });
});

