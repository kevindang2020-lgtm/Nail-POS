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

  it('M4: a burst bigger than one page is PAGED — hasMore + a continuation, every row exactly once, then the next tick\'s cursor', async () => {
    const repo = new Repo(); const svc = new BookingService(repo);
    const t0 = Date.now();
    const base = await svc.changes(ctx, undefined, t0 - 5_000);
    // 450 changed rows in this tick (a 200-technician minute at the M5 pilot's booking pace), stamped across 3 seconds
    const rows = Array.from({ length: 450 }, (_, i) => ({ id: `x${String(i).padStart(4, '0')}`, ms: t0 - 3_000 + Math.floor(i / 7) * 40 }));
    const calls: any[] = [];
    (repo as any).changedSince = async (_c: any, since: Date, limit: number, opts?: any) => {
      calls.push({ since: since.getTime(), limit, opts });
      return rows.filter((r) => r.ms >= since.getTime() && (!opts?.upto || r.ms <= opts.upto.getTime()) && (!opts?.after || r.ms > opts.after.ms || (r.ms === opts.after.ms && r.id > opts.after.id)))
        .sort((a, b) => (a.ms - b.ms) || (a.id < b.id ? -1 : 1)).slice(0, limit).map((r) => ({ id: r.id, updatedAt: new Date(r.ms).toISOString() }));
    };
    (repo as any).detailsMany = async (_c: any, ids: string[]) => ids.map((id) => ({ appointmentId: id }));
    const seen: string[] = [];
    let r = await svc.changes(ctx, base.cursor, t0);
    seen.push(...r.appointments.map((a) => a.appointmentId));
    expect(r.hasMore).toBe(true);
    expect(r.cursor).toMatch(/^v2\./);
    expect(r.appointments.length).toBe(BOOKING_FEED.pageRows);
    let pages = 1;
    while (r.hasMore) { r = await svc.changes(ctx, r.cursor, t0 + 50 * pages); seen.push(...r.appointments.map((a) => a.appointmentId)); pages++; }
    expect(pages).toBe(3);
    expect(seen.length).toBe(450);
    expect(new Set(seen).size).toBe(450);                       // nothing twice, nothing dropped
    expect(r.cursor).toMatch(/^v1\./);                         // the sweep is over: the next tick's cursor
    expect(calls.every((c) => c.opts?.upto?.getTime() === t0)).toBe(true);   // one fixed upper bound for the whole sweep
    expect(calls.every((c) => c.since === calls[0].since)).toBe(true);
  });

  it('M4: rows written DURING a sweep (after its upper bound) wait for the next tick — the sweep still ends', async () => {
    const repo = new Repo(); const svc = new BookingService(repo);
    const t0 = Date.now();
    const base = await svc.changes(ctx, undefined, t0 - 5_000);
    let n = 0;
    const rows: { id: string; ms: number }[] = Array.from({ length: 250 }, (_, i) => ({ id: `a${String(i).padStart(4, '0')}`, ms: t0 - 1_000 }));
    (repo as any).changedSince = async (_c: any, since: Date, limit: number, opts?: any) => {
      rows.push({ id: `late${n++}`, ms: t0 + 100 * n });          // a desk keeps booking while the board pages
      return rows.filter((r) => r.ms >= since.getTime() && (!opts?.upto || r.ms <= opts.upto.getTime()) && (!opts?.after || r.ms > opts.after.ms || (r.ms === opts.after.ms && r.id > opts.after.id)))
        .sort((a, b) => (a.ms - b.ms) || (a.id < b.id ? -1 : 1)).slice(0, limit).map((r) => ({ id: r.id, updatedAt: new Date(r.ms).toISOString() }));
    };
    (repo as any).detailsMany = async (_c: any, ids: string[]) => ids.map((id) => ({ appointmentId: id }));
    let r = await svc.changes(ctx, base.cursor, t0); const seen = r.appointments.map((a) => a.appointmentId);
    while (r.hasMore) { r = await svc.changes(ctx, r.cursor, t0 + 500); seen.push(...r.appointments.map((a) => a.appointmentId)); }
    expect(seen.filter((x) => x.startsWith('a')).length).toBe(250);
    expect(seen.some((x) => x.startsWith('late'))).toBe(false);
    let next = await svc.changes(ctx, r.cursor, t0 + 1_000);       // the next tick (its look-back re-reads the 250) picks the late ones up
    const again = next.appointments.map((a) => a.appointmentId);
    while (next.hasMore) { next = await svc.changes(ctx, next.cursor, t0 + 1_100); again.push(...next.appointments.map((a) => a.appointmentId)); }
    expect(again.some((x) => x.startsWith('late'))).toBe(true);
  });

  it('§26: a sweep longer than maxPages pages → RESYNC_REQUIRED(too_many_changes) — one board reload is cheaper than the rows', async () => {
    const repo = new Repo(); const svc = new BookingService(repo);
    const t0 = Date.now();
    const base = await svc.changes(ctx, undefined, t0 - 1_000);
    const many = Array.from({ length: BOOKING_FEED.pageRows * BOOKING_FEED.maxPages + 1 }, (_, i) => ({ id: `x${String(i).padStart(5, '0')}`, updatedAt: new Date(t0 - 500).toISOString() }));
    (repo as any).changedSince = async (_c: any, _s: Date, limit: number, opts?: any) => many.filter((r) => !opts?.after || r.id > opts.after.id).slice(0, limit);
    (repo as any).detailsMany = async (_c: any, ids: string[]) => ids.map((id) => ({ appointmentId: id }));
    let r = await svc.changes(ctx, base.cursor, t0);
    let e: any = null;
    for (let i = 0; i < 5 && r.hasMore && !e; i++) r = await svc.changes(ctx, r.cursor, t0).catch((x) => { e = x; return r; });
    expect(e?.code).toBe('RESYNC_REQUIRED');
    expect(e?.reason).toBe('too_many_changes');
  });

  it('M4: a tampered continuation cursor → RESYNC_REQUIRED(cursor_invalid)', async () => {
    const svc = new BookingService(new Repo());
    for (const bad of ['v2.' + Buffer.from('nope').toString('base64url'), 'v2.' + Buffer.from(JSON.stringify([1, 2, 3])).toString('base64url'),
      'v2.' + Buffer.from(JSON.stringify([Date.now(), Date.now() - 10, 0, 'x', 1])).toString('base64url')]) {
      const e = await svc.changes(ctx, bad).catch((x) => x);
      expect(e.reason, bad).toBe('cursor_invalid');
    }
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

