// booking-concurrency.postgres-race.vitest.spec.ts — Smooth Refresh / Booking Concurrency spec §104 (10 POS devices
// booking the same technician/time at once → ONE booking, NINE conflicts), the same for RESCHEDULE (the path that used
// to swallow the database's refusal and report success), §14 (stale expectedVersion → VERSION_CONFLICT) and §11 (only a
// recorded, reasoned overbook passes the guard). TRUE concurrency needs real Postgres — PGlite is single-session and
// merges interleaved transactions (recorded limitation). Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingConflictRace, BookingVersionConflict, type PBServiceLine } from './booking.dto';

const url = process.env.PG_RACE_URL;
const T = 'a1000000-0000-4000-8000-0000000000aa';
const B = 'b1000000-0000-4000-8000-0000000000bb';
const TECH = 'c1000000-0000-4000-8000-0000000000cc';
const DATE = '2999-04-01';
const ctx = { tenantId: T, branchId: B, userId: 'u_race', role: 'FRONT_DESK', permissions: [] } as any;
const line: PBServiceLine = { serviceId: 'svc_gel', name: 'Gel Manicure', durationMinutes: 60, priceCents: 4500 } as any;
const item = (name: string, startTime: string, endTime: string) => ({
  appointmentId: '', technicianId: TECH, customerName: name, isVip: false, services: [line], source: 'manual', date: DATE,
  startTime, endTime, status: 'booked', depositStatus: 'not_required', depositCents: 0, notes: '', createdAt: '', updatedAt: '',
}) as any;

let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyBookingRepository;

describe.skipIf(!url)('real-Postgres booking races (Smooth Refresh spec §104, §11, §14)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyBookingRepository(db as any);
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Salon B', 'Race Salon B', 'race-salon-b', 'RACEB', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH}, ${T}, ${B}, 'Mia', 'Chen', 'Mia Chen', true) on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  const occupying = async () => Number((await sql`select count(*)::int as n from pos_tech_appointments where tenant_id = ${T} and appt_date = ${DATE} and status not in ('cancelled','no_show','completed')`.execute(db)).rows[0].n);

  it('§104 CREATE: ten devices book Sarah at 14:00 at the same instant — exactly one appointment, nine APPOINTMENT_CONFLICTs', async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => repo.create(ctx, item(`Guest ${i}`, '14:00', '15:00'), { bufferMinutes: 0 })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const conflicts = results.filter((r) => r.status === 'rejected' && (r as any).reason instanceof BookingConflictRace).length;
    const other = results.filter((r) => r.status === 'rejected' && !((r as any).reason instanceof BookingConflictRace));
    expect(other.map((r) => String((r as any).reason))).toEqual([]);
    expect(ok).toBe(1); expect(conflicts).toBe(9);
    expect(await occupying()).toBe(1);
  });

  it('§104/§75 RESCHEDULE: ten later appointments dragged onto the SAME free 16:00 slot — one moves, nine are refused (never "moved" then snapped back)', async () => {
    // ten appointments spread over the afternoon, each an hour long (all valid), then every device drags its own onto 16:00
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const h = 9 + i;                                                                     // 09:00 … 18:00, one per hour, no overlaps
      const s = `${String(h).padStart(2, '0')}:00`, e = `${String(h + 1).padStart(2, '0')}:00`;
      if (s === '14:00') { ids.push((await repo.create(ctx, item('Guest late', '19:30', '20:30'), { bufferMinutes: 0 })).appointmentId); continue; } // 14:00 is taken by the first test
      ids.push((await repo.create(ctx, item(`Move ${i}`, s, e), { bufferMinutes: 0 })).appointmentId);
    }
    // 16:00 is currently occupied by "Move 7" (16:00–17:00); free it first so ten movers compete for a genuinely free slot
    const holder = ids[7]; await repo.setStatus(ctx, holder, 'cancelled');
    const movers = ids.filter((id) => id !== holder);
    const results = await Promise.allSettled(movers.map((id) => repo.reschedule(ctx, id, undefined, '16:00', undefined, { bufferMinutes: 0 })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const conflicts = results.filter((r) => r.status === 'rejected' && (r as any).reason instanceof BookingConflictRace).length;
    const other = results.filter((r) => r.status === 'rejected' && !((r as any).reason instanceof BookingConflictRace));
    expect(other.map((r) => String((r as any).reason))).toEqual([]);
    expect(ok).toBe(1); expect(conflicts).toBe(movers.length - 1);
    const at16 = (await sql`select id from pos_tech_appointments where tenant_id = ${T} and appt_date = ${DATE} and start_time = '16:00' and status <> 'cancelled'`.execute(db)).rows;
    expect(at16.length).toBe(1);
  });

  it('§14/§16: a device holding a stale version cannot overwrite the newer change — VERSION_CONFLICT with the current version', async () => {
    const row = await repo.create(ctx, item('Version guest', '21:00', '22:00'), { bufferMinutes: 0 });
    const v1 = Number((await sql`select version from pos_tech_appointments where id = ${row.appointmentId}`.execute(db)).rows[0].version);
    expect(v1).toBe(1);
    await repo.reschedule(ctx, row.appointmentId, undefined, '21:15', undefined, { expectedVersion: 1 });          // device A moves it → v2
    let err: unknown = null;
    try { await repo.reschedule(ctx, row.appointmentId, undefined, '21:30', undefined, { expectedVersion: 1 }); } catch (e) { err = e; }   // device B, stale
    expect(err).toBeInstanceOf(BookingVersionConflict);
    expect((err as BookingVersionConflict).currentVersion).toBe(2);
    const t = (await sql`select start_time, version from pos_tech_appointments where id = ${row.appointmentId}`.execute(db)).rows[0] as any;
    expect(t.start_time).toBe('21:15'); expect(Number(t.version)).toBe(2);                                        // A's change survived
  });

  it('§11: a recorded, reasoned overbook is the ONLY way onto an occupied slot; the row carries who and why', async () => {
    let err: unknown = null;
    try { await repo.create(ctx, item('Walk-in double', '14:00', '15:00'), { bufferMinutes: 0 }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(BookingConflictRace);                                                              // the guard still holds
    const ob = await repo.create({ ...ctx, userId: '0b0b0b0b-0000-4000-8000-00000000a0a0' }, item('Authorized double', '14:00', '15:00'), { bufferMinutes: 0, skipConflict: true, overbook: { reason: 'VIP requested Sarah; helper covers polish' } });
    const r = (await sql`select overbook_ok, overbook_reason, overbook_by_user_id from pos_tech_appointments where id = ${ob.appointmentId}`.execute(db)).rows[0] as any;
    expect(r.overbook_ok).toBe(true); expect(r.overbook_reason).toMatch(/VIP requested/); expect(r.overbook_by_user_id).toBe('0b0b0b0b-0000-4000-8000-00000000a0a0');
    // moving the overbooked appointment onto ANOTHER occupied slot without a fresh overbook decision is refused again
    await repo.create(ctx, item('Early guest', '05:00', '06:00'), { bufferMinutes: 0 });
    let err2: unknown = null;
    try { await repo.reschedule(ctx, ob.appointmentId, undefined, '05:00', undefined, { bufferMinutes: 0 }); } catch (e) { err2 = e; }
    expect(err2).toBeInstanceOf(BookingConflictRace);
    const still = (await sql`select start_time, overbook_ok from pos_tech_appointments where id = ${ob.appointmentId}`.execute(db)).rows[0] as any;
    expect(still.start_time).toBe('14:00'); expect(still.overbook_ok).toBe(true);                                 // nothing moved, nothing lost
  });

  it('change history is written on BOTH paths: inside a reschedule transaction AND on the plain pool (assign)', async () => {
    // Regression pin (Sep 30 2026): the savepoint that keeps a failed log insert from aborting the caller's transaction
    // was first issued unconditionally; on the plain pool PostgreSQL refuses SAVEPOINT outside a transaction block, the
    // best-effort catch swallowed it, and assign / check-in / customer booking silently stopped recording history.
    await sql`delete from appointment_change_log where tenant_id = ${T}`.execute(db);
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    const a = await repo.create(ctx, item('History', '09:00', '10:00'), { bufferMinutes: 0 });
    await repo.reschedule(ctx, a.appointmentId, undefined, '11:00', undefined, { bufferMinutes: 0 });   // transaction path
    const TECH2 = 'c1000000-0000-4000-8000-0000000000cd';
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH2}, ${T}, ${B}, 'Ana', 'Ruiz', 'Ana Ruiz', true) on conflict (id) do nothing`.execute(db);
    await repo.assign(ctx, a.appointmentId, TECH2);                                                       // plain-pool path
    const types = (await sql<{ change_type: string }>`select change_type from appointment_change_log where tenant_id = ${T} and appointment_id = ${a.appointmentId}`.execute(db)).rows.map((r) => r.change_type);
    expect(types).toContain('rescheduled');
    expect(types).toContain('assigned');
  });

  it('483 trigger: a writer that stamps NOTHING still moves updated_at + version (so the change feed and stale-copy checks see it); a writer that bumps version is not double-bumped', async () => {
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    const a = await repo.create(ctx, item('Stamp', '09:00', '10:00'), { bufferMinutes: 0 });
    const before = (await sql<{ v: number; u: Date }>`select version as v, updated_at as u from pos_tech_appointments where id = ${a.appointmentId}`.execute(db)).rows[0];
    await new Promise((r) => setTimeout(r, 20));
    // like the customer-merge path: re-point a column and set NOTHING else
    await sql`update pos_tech_appointments set notes = 'merged' where id = ${a.appointmentId}`.execute(db);
    const after = (await sql<{ v: number; u: Date }>`select version as v, updated_at as u from pos_tech_appointments where id = ${a.appointmentId}`.execute(db)).rows[0];
    expect(Number(after.v)).toBe(Number(before.v) + 1);
    expect(new Date(after.u).getTime()).toBeGreaterThan(new Date(before.u).getTime());
    const seen = await repo.changedSince(ctx, new Date(new Date(before.u).getTime() + 1), 50);
    expect(seen.map((x) => x.id)).toContain(a.appointmentId);
    await repo.reschedule(ctx, a.appointmentId, undefined, '11:00', undefined, { expectedVersion: Number(after.v), bufferMinutes: 0 });
    const moved = (await sql<{ v: number }>`select version as v from pos_tech_appointments where id = ${a.appointmentId}`.execute(db)).rows[0];
    expect(Number(moved.v)).toBe(Number(after.v) + 1);   // repository bump + trigger = ONE increment
  });

  it('M4 change-feed paging on real Postgres: 30 rows stamped in ONE transaction (identical updated_at) page through a keyset of 7 — every row exactly once, upto bounds the sweep', async () => {
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    const t0 = new Date(Date.now() - 1_000);
    await sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, duration_minutes, status, overbook_ok)
              select ${T}, ${B}, ${TECH}, 'Feed ' || g, ${'2999-05-01'}::date, lpad((8 + g / 4)::text, 2, '0') || ':00', lpad((8 + g / 4)::text, 2, '0') || ':10', 10, 'booked', true
              from generate_series(0, 29) g`.execute(db);
    const stamps = (await sql<{ n: number }>`select count(distinct updated_at)::int n from pos_tech_appointments where tenant_id = ${T}`.execute(db)).rows[0].n;
    expect(stamps).toBe(1);                                                    // the worst case for a keyset: one shared stamp
    const upto = new Date(Date.now() + 1_000);
    const seen: string[] = []; let after: { ms: number; id: string } | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await repo.changedSince(ctx, t0, 7, { upto, after });
      seen.push(...page.map((r) => r.id));
      if (page.length < 7) break;
      const last = page[page.length - 1]; after = { ms: Date.parse(last.updatedAt), id: last.id };
    }
    expect(seen.length).toBe(30);
    expect(new Set(seen).size).toBe(30);
    expect((await repo.changedSince(ctx, t0, 100, { upto: new Date(t0.getTime() - 1) })).length).toBe(0);   // nothing after upto
  });

  it('the salon\'s SAVED Booking & Appointments settings reach the engine (policy, buffer, slot interval); a branch row wins; junk is ignored', async () => {
    // Regression pin: until Sep 30 2026 settings() returned hard-coded defaults for every salon, so nothing saved in
    // POS Settings → Booking & Appointments (including the new double-booking policy) had any effect on booking.
    await sql`delete from tenant_settings where tenant_id = ${T} and category = 'booking-appointments'`.execute(db);
    const none = await repo.settings(ctx);
    expect(none.overbookingPolicy).toBe('BLOCK');                                        // nothing saved → safe default
    await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values
      (${T}, null, 'booking-appointments', ${JSON.stringify({ overbookingPolicy: 'ALLOW_AUTHORIZED_ROLE', bufferMinutes: 20, slotIntervalMinutes: 30 })}::jsonb)`.execute(db);
    const tenantWide = await repo.settings(ctx);
    expect(tenantWide).toMatchObject({ overbookingPolicy: 'ALLOW_AUTHORIZED_ROLE', bufferMinutes: 20, slotIntervalMinutes: 30 });
    await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values
      (${T}, ${B}, 'booking-appointments', ${JSON.stringify({ overbookingPolicy: 'WARN_REQUIRE_CONFIRMATION', bufferMinutes: 0 })}::jsonb)`.execute(db);
    const branch = await repo.settings(ctx);
    expect(branch).toMatchObject({ overbookingPolicy: 'WARN_REQUIRE_CONFIRMATION', bufferMinutes: 0 });   // the branch row wins
    await sql`update tenant_settings set settings_json = ${JSON.stringify({ overbookingPolicy: 'ANYTHING_GOES', bufferMinutes: -5 })}::jsonb
      where tenant_id = ${T} and branch_id = ${B} and category = 'booking-appointments'`.execute(db);
    const junk = await repo.settings(ctx);
    expect(junk.overbookingPolicy).toBe('BLOCK');                                        // unknown policy → the safe default
    expect(junk.bufferMinutes).toBe(none.bufferMinutes);                                  // negative buffer → default
    await sql`delete from tenant_settings where tenant_id = ${T} and category = 'booking-appointments'`.execute(db);
  });
});

