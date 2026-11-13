// booking-200-scale.pgtest — booking200 addendum §13/§18 + the 44-page guide §8–§10, §82–§86, §94 (round 12): the
// Booking board's 200-technician scale proven on the SERVER, on the real schema (PGlite, every migration), through the
// real booking engine (KyselyBookingRepository + BookingService) and THE ONE exact-service eligibility authority
// (EligibilitySkillsAdapter over TechnicianEligibilityService — booking cannot import workforce, so the proof lives here).
//
//   • 200 active technicians (+1 inactive), mixed exact skills, 36 off today (weekly schedule off or a full-day block)
//   • a busy day: 1,000+ appointments (6–7 per working technician, mixed statuses) + lunch
//   • paging 12 a page: page 1 = #1–12, page 8 = #85–96, page 17 = #193–200; working-only 164 → 14 pages; totals
//     0, 1, 11, 12, 13, 24, 25, 199, 200, 201 (each its own salon); server search by name / number / exact skill; locate
//     #200 → page 17; Find an Opening / Best Matches for a 45-minute service (hard eligibility first, deterministic)
//   • no hidden cap: 201 live holds all come back from the hold read (it carried LIMIT 200)
//   • latency MEASURED here (p50 / p95 of repeated runs) and printed as one `MEASURE {...}` line — copied into
//     docs/PERFORMANCE_REPORT.md. PGlite is in-process WASM Postgres on the test machine, not production hardware.
// Fixed dates; the branch clock is pinned on the repository instance (10:00 on the test Monday).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyBookingRepository, BookingService, KyselyHoldRepository } from '@aipowersalon/booking';
import { TechnicianEligibilityService, KyselyEligibilityReader } from './technician-eligibility';
import { EligibilitySkillsAdapter } from './technician-eligibility.module';
import { NoAvailabilityPort } from '../workforce-status/workforce-ports';

const u = (x: string) => `a9860000-0000-4000-8000-${x.padStart(12, '0')}`;
const T = u('1'), B = u('2');
const CAT_M = u('c1'), CAT_P = u('c2'), CAT_A = u('c3'), CAT_N = u('c4');
const GEL = u('51'), PEDI = u('52'), ACR = u('53'), ART = u('54');
const tech = (i: number) => `a9860000-0000-4000-8000-${(0xe0000 + i).toString(16).padStart(12, '0')}`;
const DAY = '2026-11-02';   // Monday (day_of_week 1)
const ctx = { tenantId: T, branchId: B, userId: 'u-front-desk', role: 'MANAGER', permissions: ['pos.booking.view'] };
// the skill matrix (realistic: generalists + specialists, nobody skilled for everything by default)
const skilled = { [GEL]: (i: number) => i % 4 !== 2, [PEDI]: (i: number) => i % 4 === 2 || i % 4 === 0, [ACR]: (i: number) => i % 4 === 3, [ART]: (i: number) => i % 10 === 0 };
const offBySchedule = (i: number) => i % 8 === 5;                       // 25 technicians: weekly schedule says not working Mondays
const offByBlock = (i: number) => i % 20 === 7 || i === 2;              // 11 technicians: a full-day block on DAY
const working = (i: number) => !offBySchedule(i) && !offByBlock(i);     // 164
let pg: any; let db: any; let repo: KyselyBookingRepository; let svc: BookingService;
const measures: Record<string, unknown> = {};

const timeIt = async <X>(fn: () => Promise<X>, n = 7): Promise<{ result: X; p50: number; p95: number; bytes: number }> => {
  const ts: number[] = []; let result!: X;
  for (let k = 0; k < n; k++) { const t0 = performance.now(); result = await fn(); ts.push(performance.now() - t0); }
  ts.sort((a, b) => a - b);
  return { result, p50: +ts[Math.floor(n * 0.5)].toFixed(1), p95: +ts[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(1), bytes: Buffer.byteLength(JSON.stringify(result)) };
};
const pinClock = (r: KyselyBookingRepository) => { (r as any).clock = async () => ({ today: DAY, nowMinute: 600, timeZone: 'America/New_York' }); return r; };
const engine = (r: KyselyBookingRepository) => new BookingService(r, undefined, undefined, undefined, undefined, undefined,
  new EligibilitySkillsAdapter(new TechnicianEligibilityService({ reader: new KyselyEligibilityReader(db), workforce: null, availability: new NoAvailabilityPort() } as never)));

/** n technicians "Tech 001".."Tech n" (+ `inactive` more after them), bulk-inserted with generate_series. */
async function seedSalon(tenantId: string, branchId: string, slug: string, n: number, inactive = 0) {
  await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1,$2,$2,$3,$4,'active')`, [tenantId, 'Scale ' + slug, 'scale-' + slug + '-986', ('S' + slug).slice(0, 10).toUpperCase()]);
  await pg.query(`INSERT INTO branches (id, tenant_id, name, status) VALUES ($1,$2,'Main','active')`, [branchId, tenantId]);
  if (n + inactive === 0) return;
  await pg.query(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, service_eligibility_mode)
    SELECT ('a9860000-0000-4000-8000-' || lpad(to_hex(${slug === 'main' ? 0xe0000 : 0xf0000} + g + $3 * 1000), 12, '0'))::uuid, $1, $2, 'Tech', lpad(g::text, 3, '0'), 'Tech ' || lpad(g::text, 3, '0'),
      CASE WHEN g > $4 THEN 'suspended' ELSE 'active' END, g <= $4, 'exact'
    FROM generate_series(1, $5::int) g`, [tenantId, branchId, slug === 'main' ? 0 : Number(slug.replace(/\D/g, '')) || 0, n, n + inactive]);
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await seedSalon(T, B, 'main', 200, 1);   // #201 is inactive (status = all → 201)
  await pg.exec(`
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT_M}', '${T}', '${B}', 'Manicure'), ('${CAT_P}', '${T}', '${B}', 'Pedicure'), ('${CAT_A}', '${T}', '${B}', 'Acrylic'), ('${CAT_N}', '${T}', '${B}', 'Nail Art');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES
      ('${GEL}', '${T}', '${B}', '${CAT_M}', 'Gel Manicure', 45, 4500, 'active'), ('${PEDI}', '${T}', '${B}', '${CAT_P}', 'Spa Pedicure', 60, 5500, 'active'),
      ('${ACR}', '${T}', '${B}', '${CAT_A}', 'Acrylic Full Set', 90, 8000, 'active'), ('${ART}', '${T}', '${B}', '${CAT_N}', 'Nail Art', 30, 2500, 'active');
  `);
  const ids = (f: (i: number) => boolean) => Array.from({ length: 200 }, (_, k) => k + 1).filter(f).map(tech);
  for (const [svcId, f] of Object.entries(skilled)) {
    await pg.query(`INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) SELECT $1, $2, t, $3 FROM unnest($4::uuid[]) t`, [T, B, svcId, ids(f)]);
  }
  await pg.query(`INSERT INTO technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, lunch_start_time, lunch_end_time, is_working)
    SELECT $1, $2, t, 1, '09:00', '19:00', '12:00', '12:30', NOT (t = ANY($4::uuid[])) FROM unnest($3::uuid[]) t`, [T, B, ids(() => true), ids(offBySchedule)]);
  await pg.query(`INSERT INTO technician_blocked_times (tenant_id, branch_id, technician_id, block_date, start_time, end_time, reason) SELECT $1, $2, t, $3, '09:00', '19:00', 'time_off' FROM unnest($4::uuid[]) t`, [T, B, DAY, ids(offByBlock)]);
  // the busy day: 6 appointments per working technician (+ a 17:30 for every 5th) — 45 min each, mixed statuses
  const svcJson = JSON.stringify([{ serviceId: GEL, serviceName: 'Gel Manicure', durationMinutes: 45, priceCents: 4500 }]);
  for (const [st, en, status] of [['09:00', '09:45', 'completed'], ['10:00', '10:45', 'in_service'], ['11:00', '11:45', 'confirmed'], ['13:00', '13:45', 'booked'], ['14:30', '15:15', 'booked'], ['16:00', '16:45', 'confirmed']]) {
    await pg.query(`INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, source, appt_date, start_time, end_time, duration_minutes, status, deposit_status, is_vip)
      SELECT $1, $2, t, 'Guest', $3::jsonb, 'manual', $4, $5, $6, 45, $7, 'not_required', false FROM unnest($8::uuid[]) t`, [T, B, svcJson, DAY, st, en, status, ids(working)]);
  }
  await pg.query(`INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, source, appt_date, start_time, end_time, duration_minutes, status, deposit_status, is_vip)
    SELECT $1, $2, t, 'Guest', $3::jsonb, 'phone', $4, '17:30', '18:15', 45, 'booked', 'not_required', false FROM unnest($5::uuid[]) t`, [T, B, svcJson, DAY, ids((i) => working(i) && i % 5 === 1)]);
  repo = pinClock(new KyselyBookingRepository(db));
  svc = engine(repo);
}, 300000);

describe('200 technicians on the real schema — server paging (booking200 §13, guide §8/§82)', () => {
  it('fixture: 200 active (+1 inactive), 164 working today, 1,000+ appointments on the busy day', async () => {
    const n = Number((await pg.query(`SELECT count(*)::int AS n FROM pos_tech_appointments WHERE tenant_id = $1 AND appt_date = $2`, [T, DAY])).rows[0].n);
    expect(n).toBeGreaterThanOrEqual(1000);
    measures.appointmentsOnDay = n;
  });
  it('total 200, pageSize 12, totalPages 17; page 1 = #1–12, page 8 = #85–96, page 16 = #181–192, page 17 = #193–200 (8 real columns)', async () => {
    const p1 = await svc.technicianPage(ctx as never, { date: DAY, page: 1 });
    expect(p1).toMatchObject({ total: 200, totalAll: 201, pageSize: 12, page: 1, totalPages: 17, workingCount: 164 });
    expect(p1.technicians.map((t) => t.rosterNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(p1.technicians[0]).toMatchObject({ technicianId: tech(1), name: 'Tech 001' });
    expect((await svc.technicianPage(ctx as never, { date: DAY, page: 8 })).technicians.map((t) => t.rosterNumber)).toEqual([85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96]);
    expect((await svc.technicianPage(ctx as never, { date: DAY, page: 16 })).technicians.map((t) => t.rosterNumber)).toEqual(Array.from({ length: 12 }, (_, k) => 181 + k));
    const p17 = await svc.technicianPage(ctx as never, { date: DAY, page: 17 });
    expect(p17.technicians.map((t) => t.rosterNumber)).toEqual([193, 194, 195, 196, 197, 198, 199, 200]);
    expect(p17.technicians.at(-1)).toMatchObject({ technicianId: tech(200), name: 'Tech 200' });
    const all: string[] = [];
    for (let p = 1; p <= 17; p++) all.push(...(await svc.technicianPage(ctx as never, { date: DAY, page: p })).technicians.map((t) => t.technicianId));
    expect(all.length).toBe(200); expect(new Set(all).size).toBe(200);
    // the inactive #201 is in the 'all' scope only — and then the last page holds 9
    const everyone = await svc.technicianPage(ctx as never, { date: DAY, status: 'all', page: 17 });
    expect([everyone.total, everyone.technicians.length, everyone.technicians.at(-1)?.rosterNumber]).toEqual([201, 9, 201]);
  });
  it('working-only: 164 working today → 14 pages (13 × 12 + 8), each a working technician; an out-of-range page is repaired', async () => {
    const w = await svc.technicianPage(ctx as never, { date: DAY, working: true, page: 99 });
    expect([w.total, w.totalPages, w.page, w.technicians.length]).toEqual([164, 14, 14, 8]);
    const seen: number[] = [];
    for (let p = 1; p <= 14; p++) seen.push(...(await svc.technicianPage(ctx as never, { date: DAY, working: true, page: p })).technicians.map((t) => t.rosterNumber));
    expect(seen).toEqual(Array.from({ length: 200 }, (_, k) => k + 1).filter(working));
  });
  it('server search: "#200" / "200" / "tech 200" find #200; locate #200 from page 1 → page 17 (index 199)', async () => {
    for (const search of ['#200', '200', 'tech 200']) expect((await svc.technicianPage(ctx as never, { date: DAY, search })).technicians.map((t) => t.technicianId), search).toContain(tech(200));
    const loc = await svc.technicianPage(ctx as never, { date: DAY, page: 1, locate: tech(200) });
    expect(loc.page).toBe(17);
    expect(loc.located).toEqual({ technicianId: tech(200), page: 17, index: 199 });
    // in the working-only view #200 is the 164th → page 14; #197 (off by schedule) is excluded → located null, page kept
    expect((await svc.technicianPage(ctx as never, { date: DAY, working: true, locate: tech(200) })).located).toEqual({ technicianId: tech(200), page: 14, index: 163 });
    const gone = await svc.technicianPage(ctx as never, { date: DAY, working: true, page: 2, locate: tech(197) });
    expect([gone.located, gone.page]).toEqual([null, 2]);
  });
  it('exact skill through the ONE eligibility authority: Acrylic Full Set → exactly the 50 acrylic specialists (5 pages)', async () => {
    const acr = await svc.technicianPage(ctx as never, { date: DAY, serviceIds: [ACR] });
    expect([acr.total, acr.totalPages]).toEqual([50, 5]);
    const ids: string[] = [];
    for (let p = 1; p <= 5; p++) ids.push(...(await svc.technicianPage(ctx as never, { date: DAY, serviceIds: [ACR], page: p })).technicians.map((t) => t.technicianId));
    expect(ids.sort()).toEqual(Array.from({ length: 200 }, (_, k) => k + 1).filter(skilled[ACR]).map(tech).sort());
    expect((await svc.technicianPage(ctx as never, { date: DAY, serviceIds: [ART] })).total).toBe(20);
    expect((await svc.technicianPage(ctx as never, { date: DAY, serviceIds: [GEL], working: true })).total).toBe(Array.from({ length: 200 }, (_, k) => k + 1).filter((i) => skilled[GEL](i) && working(i)).length);
  });
  it('totals 0, 1, 11, 12, 13, 24, 25, 199, 200, 201 — page math, last-page size, no phantom columns (each its own salon)', async () => {
    for (const [n, pages] of [[0, 1], [1, 1], [11, 1], [12, 1], [13, 2], [24, 2], [25, 3], [199, 17], [200, 17], [201, 17]] as const) {
      const tid = `a9860000-0000-4000-8000-${(0xa000 + n).toString(16).padStart(12, '0')}`, bid = `a9860000-0000-4000-8000-${(0xb000 + n).toString(16).padStart(12, '0')}`;
      await seedSalon(tid, bid, 'n' + n, n);
      const s = engine(pinClock(new KyselyBookingRepository(db)));
      const c = { ...ctx, tenantId: tid, branchId: bid };
      const last = await s.technicianPage(c as never, { date: DAY, page: 999 });
      expect([n, last.total, last.totalPages, last.page], `n=${n}`).toEqual([n, n, pages, pages]);
      expect(last.technicians.length, `n=${n}`).toBe(n === 0 ? 0 : n - (pages - 1) * 12);
      const first = await s.technicianPage(c as never, { date: DAY, page: 1 });
      expect(first.technicians.length, `n=${n}`).toBe(Math.min(12, n));
    }
  });
  it('the day grid for page 17 carries only those 8 technicians\' appointments (never all 200 calendars)', async () => {
    const ids = (await svc.technicianPage(ctx as never, { date: DAY, page: 17 })).technicians.map((t) => t.technicianId);
    const g: any = await svc.dayGrid(ctx as never, DAY, ids);
    expect(g.columns.map((c: any) => c.technicianId)).toEqual(ids);
    const expected = Number((await pg.query(`SELECT count(*)::int AS n FROM pos_tech_appointments WHERE tenant_id = $1 AND appt_date = $2 AND technician_id = ANY($3::uuid[])`, [T, DAY, ids])).rows[0].n);
    expect(g.appointments.length).toBe(expected);
    expect(g.appointments.every((a: any) => ids.includes(a.technicianId))).toBe(true);
  });
});

describe('Find an Opening / Best Matches on a 200-technician busy day — 45-minute Gel Manicure (guide §10/§85/§86)', () => {
  it('hard eligibility first: only exact-skilled, working technicians with a real opening; ranked; top 10 + View More; deterministic', async () => {
    const a = await svc.openings(ctx as never, { date: DAY, serviceIds: [GEL], limit: 10 });
    expect(a.durationMinutes).toBe(45);
    expect(a.eligibleCount).toBe(150);   // active AND exact-skilled for Gel (the schedule is not eligibility)
    expect(a.openings.length).toBe(10); expect(a.hasMore).toBe(true);
    expect(a.openings.map((o) => o.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const o of a.openings) {
      const i = Number(o.name.slice(5));
      expect(skilled[GEL](i) && working(i), o.name).toBe(true);
      expect(o.time >= '10:00', o.name).toBe(true);   // never before "now" (10:00) on today
    }
    const times = a.openings.map((o) => o.time);
    expect([...times].sort()).toEqual(times);
    expect(await svc.openings(ctx as never, { date: DAY, serviceIds: [GEL], limit: 10 })).toEqual(a);
    // View More continues the same ranking without repeats
    const more = await svc.openings(ctx as never, { date: DAY, serviceIds: [GEL], limit: 10, offset: 10 });
    expect(more.openings[0].rank).toBe(11);
    expect(new Set([...a.openings, ...more.openings].map((o) => o.technicianId)).size).toBe(20);
    // the full ranked list never contains an unskilled or off technician
    const all = await svc.openings(ctx as never, { date: DAY, serviceIds: [GEL], limit: 50 });
    let off = 0; for (let k = 0; k < all.withOpenings; k += 50) {
      const pg50 = await svc.openings(ctx as never, { date: DAY, serviceIds: [GEL], limit: 50, offset: k });
      off += pg50.openings.filter((o) => { const i = Number(o.name.slice(5)); return !(skilled[GEL](i) && working(i)); }).length;
    }
    expect(off).toBe(0);
    expect(all.withOpenings).toBeGreaterThan(0);
    expect(all.withOpenings).toBeLessThanOrEqual(Array.from({ length: 200 }, (_, k) => k + 1).filter((i) => skilled[GEL](i) && working(i)).length);
  });
  it('an exact service filters Find an Opening: Acrylic openings belong only to acrylic specialists', async () => {
    const r = await svc.openings(ctx as never, { date: DAY, serviceIds: [ACR], limit: 50 });
    expect(r.eligibleCount).toBe(50);
    expect(r.openings.every((o) => skilled[ACR](Number(o.name.slice(5))))).toBe(true);
  });
});

describe('no hidden caps (guide §51 / booking200 §13)', () => {
  it('the live-hold read returns every hold in the window — 201 holds, 201 rows (it carried LIMIT 200: hold #201 stopped blocking)', async () => {
    const holds = new KyselyHoldRepository(db as never);
    const sess = (i: number) => `a9860000-0000-4000-8000-${(0xc0000 + i).toString(16).padStart(12, '0')}`;
    const start = Date.parse('2999-01-04T15:00:00Z'), end = start + 45 * 60_000, exp = Date.now() + 3600_000;
    for (let i = 1; i <= 200; i++) await holds.create({ tenantId: T, branchId: B, technicianId: tech(i), startsAt: start, endsAt: end, bookingSessionId: sess(i), channel: 'pos', expiresAt: exp } as never);
    await holds.create({ tenantId: T, branchId: B, technicianId: tech(1), startsAt: start + 3 * 3600_000, endsAt: end + 3 * 3600_000, bookingSessionId: sess(201), channel: 'pos', expiresAt: exp } as never);
    const live = await holds.liveHolds(T, B, start - 3600_000, end + 4 * 3600_000);
    expect(live.length).toBe(201);
    expect(new Set(live.map((h) => h.holdId)).size).toBe(201);
  });
});

describe('measured latency (recorded in docs/PERFORMANCE_REPORT.md)', () => {
  it('times the board\'s server reads at 200 technicians / 1,000+ appointments', async () => {
    const p1 = await timeIt(() => svc.technicianPage(ctx as never, { date: DAY, page: 1 }));
    const p17 = await timeIt(() => svc.technicianPage(ctx as never, { date: DAY, page: 17 }));
    const working164 = await timeIt(() => svc.technicianPage(ctx as never, { date: DAY, working: true, page: 1 }));
    const skillFilter = await timeIt(() => svc.technicianPage(ctx as never, { date: DAY, serviceIds: [ACR] }));
    const search200 = await timeIt(() => svc.technicianPage(ctx as never, { date: DAY, search: '#200' }));
    const locate200 = await timeIt(() => svc.technicianPage(ctx as never, { date: DAY, page: 1, locate: tech(200) }));
    const ids17 = p17.result.technicians.map((t) => t.technicianId);
    const grid17 = await timeIt(() => svc.dayGrid(ctx as never, DAY, ids17));
    const openings = await timeIt(() => svc.openings(ctx as never, { date: DAY, serviceIds: [GEL], limit: 10 }));
    const kpis = await timeIt(() => svc.kpiCards(ctx as never, { date: DAY }));
    const plan = (await pg.query(`EXPLAIN (ANALYZE, FORMAT JSON) SELECT id, technician_id, start_time, end_time, status FROM pos_tech_appointments
      WHERE tenant_id = $1 AND (branch_id = $2 OR branch_id IS NULL) AND appt_date = $3 AND technician_id = ANY($4::uuid[]) ORDER BY start_time, id`, [T, B, DAY, ids17])).rows[0]['QUERY PLAN'];
    const planTop = Array.isArray(plan) ? plan[0] : (typeof plan === 'string' ? JSON.parse(plan)[0] : plan);
    const m = {
      engine: 'PGlite (in-process WASM Postgres 16, test machine)', technicians: 200, inactive: 1, workingToday: 164, appointmentsOnDay: measures.appointmentsOnDay, runsPerRead: 7,
      technicianPage1: { p50: p1.p50, p95: p1.p95, bytes: p1.bytes }, technicianPage17: { p50: p17.p50, p95: p17.p95, bytes: p17.bytes },
      workingFilter164: { p50: working164.p50, p95: working164.p95 }, exactSkillFilter: { p50: skillFilter.p50, p95: skillFilter.p95 },
      search200: { p50: search200.p50, p95: search200.p95 }, locate200: { p50: locate200.p50, p95: locate200.p95 },
      dayGridPage17: { p50: grid17.p50, p95: grid17.p95, bytes: grid17.bytes },
      findOpening45min: { p50: openings.p50, p95: openings.p95, bytes: openings.bytes, eligible: openings.result.eligibleCount, withOpenings: openings.result.withOpenings, first: openings.result.openings[0]?.time },
      kpiCards: { p50: kpis.p50, p95: kpis.p95, bytes: kpis.bytes },
      explainVisibleAppointments: { executionMs: planTop?.['Execution Time'] ?? null, planningMs: planTop?.['Planning Time'] ?? null, topNode: planTop?.Plan?.['Node Type'] ?? null },
    };
    console.log('MEASURE ' + JSON.stringify(m));
    // payload sanity (guide §93): a technician page is light — never 200 technicians' data
    expect(p1.result.technicians.length).toBe(12);
    expect(p1.bytes).toBeLessThan(20000);
    expect(openings.result.openings.length).toBe(10);
  });
});
