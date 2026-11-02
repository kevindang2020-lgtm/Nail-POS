// booking-200-technicians.vitest.spec.ts — 200-technician mandate (Oct 23 2026): the Booking board's technician columns are
// paged ON THE SERVER (12 a page → 200 technicians = 17 pages), searchable (name / "#200"), filterable (working, status,
// skill, exact service), jumpable (locate), and Find an Opening / Best Matches run on the server with hard eligibility
// before ranking. In-memory repository with 200 technicians; the eligibility authority is the batch test double.
import { describe, it, expect } from 'vitest';
import { InMemoryBookingRepository } from './booking.repository';
import { BookingService } from './booking.service';
import { InMemoryTechnicianSkills } from './technician-skills.port';

const ctx = { tenantId: 'big200', branchId: 'br_big', userId: 'u1', role: 'MANAGER', permissions: ['pos.booking.view', 'pos.booking.create', 'pos.booking.edit', 'booking.override'] };
const pad = (n: number) => String(n).padStart(3, '0');
const DATE = '2026-06-08';

function bigSalon(n = 200, opts: { inactive?: number[]; skilledFor?: (i: number) => string[] } = {}) {
  const repo = new InMemoryBookingRepository();
  // seed: n technicians "Tech 001".."Tech n" (roster order = name), the fixture catalog (svc_mani, svc_gel, …)
  (repo as any).ensure(ctx.tenantId);
  (repo as any).catalog.set(ctx.tenantId, [
    { serviceId: 'svc_mani', name: 'Signature Manicure', categoryName: 'Manicure', durationMinutes: 45, priceCents: 5500 },
    { serviceId: 'svc_gel', name: 'Gel Extensions', categoryName: 'Manicure', durationMinutes: 45, priceCents: 7500 },
  ]);
  (repo as any).techs.set(ctx.tenantId, Array.from({ length: n }, (_, k) => {
    const i = k + 1;
    return { technicianId: `t${pad(i)}`, name: `Tech ${pad(i)}`, available: !(opts.inactive ?? []).includes(i), skills: i % 5 === 0 ? ['Pedicure'] : ['Manicure'], rating: i % 7 === 0 ? 4.9 : 4.5, reviewCount: 3 };
  }).reverse());   // stored out of order on purpose: the SERVER decides roster order
  const approved: Record<string, string[]> = {};
  for (let i = 1; i <= n; i++) approved[`t${pad(i)}`] = opts.skilledFor ? opts.skilledFor(i) : ['svc_mani'];
  const skills = new InMemoryTechnicianSkills(approved);
  return { repo, skills, svc: new BookingService(repo, undefined, undefined, undefined, undefined, undefined, skills) };
}

describe('GET /pos/booking/technicians — 200 technicians, 12 a page', () => {
  it('total 200, pageSize 12, totalPages 17; page 1 = #1–12, page 8 = #85–96, page 17 = #193–200 (never "two pages")', async () => {
    const { svc } = bigSalon();
    const p1 = await svc.technicianPage(ctx, { date: DATE, page: 1 });
    expect(p1).toMatchObject({ total: 200, totalAll: 200, pageSize: 12, page: 1, totalPages: 17 });
    expect(p1.technicians.map((t) => t.rosterNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(p1.technicians[0]).toMatchObject({ technicianId: 't001', name: 'Tech 001' });
    const p8 = await svc.technicianPage(ctx, { date: DATE, page: 8 });
    expect(p8.technicians.map((t) => t.rosterNumber)).toEqual([85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96]);
    const p17 = await svc.technicianPage(ctx, { date: DATE, page: 17 });
    expect(p17.technicians.map((t) => t.rosterNumber)).toEqual([193, 194, 195, 196, 197, 198, 199, 200]);
    expect(p17.technicians.at(-1)).toMatchObject({ technicianId: 't200', name: 'Tech 200' });
    // the 17 pages hold every technician exactly once
    const all: string[] = [];
    for (let p = 1; p <= 17; p++) all.push(...(await svc.technicianPage(ctx, { date: DATE, page: p })).technicians.map((t) => t.technicianId));
    expect(all.length).toBe(200); expect(new Set(all).size).toBe(200);
  });
  it('the projection is booking-only: no payroll, pay plan, tax, phone, e-mail or PIN field', async () => {
    const { svc } = bigSalon(13);
    const p = await svc.technicianPage(ctx, { date: DATE });
    expect(Object.keys(p.technicians[0]).sort()).toEqual(['available', 'avatarUrl', 'name', 'rating', 'reviewCount', 'rosterNumber', 'skills', 'technicianId', 'workingToday']);
  });
  it('Vietnamese mandate §41: an accent-free search ("tran", "dang") finds "Trần Mỹ Linh" / "Đặng Minh Tuấn" among 200', async () => {
    const { repo, svc } = bigSalon();
    const techs = (repo as any).techs.get(ctx.tenantId);
    techs.find((t: any) => t.technicianId === 't150').name = 'Trần Mỹ Linh';
    techs.find((t: any) => t.technicianId === 't151').name = 'Đặng Minh Tuấn';
    for (const [search, id] of [['tran', 't150'], ['TRAN my', 't150'], ['Trần', 't150'], ['dang', 't151'], ['đặng minh', 't151']] as const) {
      const r = await svc.technicianPage(ctx, { date: DATE, search });
      expect(r.technicians.map((t) => t.technicianId), search).toEqual([id]);
      expect(r.technicians[0].name).toBe(id === 't150' ? 'Trần Mỹ Linh' : 'Đặng Minh Tuấn');   // stored name untouched
    }
  });

  it('search "#200" / "200" / a name finds technician #200; locate jumps to page 17 with the filters kept', async () => {
    const { svc } = bigSalon();
    for (const search of ['#200', '200', 'tech 200']) {
      const r = await svc.technicianPage(ctx, { date: DATE, search });
      expect(r.technicians.map((t) => t.technicianId), search).toContain('t200');
    }
    const loc = await svc.technicianPage(ctx, { date: DATE, page: 1, locate: 't200' });
    expect(loc.page).toBe(17);
    expect(loc.located).toEqual({ technicianId: 't200', page: 17, index: 199 });
    expect(loc.technicians.some((t) => t.technicianId === 't200')).toBe(true);
    // a filter that excludes the technician: located = null and the requested page stays
    const gone = await svc.technicianPage(ctx, { date: DATE, page: 1, locate: 't200', serviceIds: ['svc_gel'] });
    expect(gone.located).toBeNull();
  });
  it('status and exact-service filters drive the count and the pages (one batch eligibility read, not 200)', async () => {
    const { svc, skills } = bigSalon(200, { inactive: [3, 8], skilledFor: (i) => (i % 4 === 0 ? ['svc_mani', 'svc_gel'] : ['svc_mani']) });
    const active = await svc.technicianPage(ctx, { date: DATE });
    expect(active.total).toBe(198);
    expect((await svc.technicianPage(ctx, { date: DATE, status: 'inactive' })).technicians.map((t) => t.technicianId)).toEqual(['t003', 't008']);
    expect((await svc.technicianPage(ctx, { date: DATE, status: 'all' })).total).toBe(200);
    skills.batchCalls = 0;
    const gel = await svc.technicianPage(ctx, { date: DATE, serviceIds: ['svc_gel'] });
    expect(skills.batchCalls).toBe(1);
    expect(gel.total).toBe(49);   // the 50 multiples of 4 (#4 … #200) minus the inactive #8
    expect(gel.totalPages).toBe(Math.ceil(49 / 12));
    expect(gel.technicians.every((t) => t.eligible === true && Number(t.technicianId.slice(1)) % 4 === 0)).toBe(true);
  });
  it('a skill (category) filter and the working filter', async () => {
    const { svc } = bigSalon();
    const ped = await svc.technicianPage(ctx, { date: DATE, skill: 'Pedicure' });
    expect(ped.total).toBe(40);
    const working = await svc.technicianPage(ctx, { date: DATE, working: true });
    expect(working.total).toBe(working.workingCount);
  });
  it('pagination edge totals 0, 1, 11, 12, 13, 24, 25, 199, 200, 201', async () => {
    for (const [n, pages] of [[0, 1], [1, 1], [11, 1], [12, 1], [13, 2], [24, 2], [25, 3], [199, 17], [200, 17], [201, 17]] as const) {
      const { svc } = bigSalon(n);
      const last = await svc.technicianPage(ctx, { date: DATE, page: 999 });
      expect([n, last.totalPages], `n=${n}`).toEqual([n, pages]);
      expect(last.page).toBe(pages);
      expect(last.technicians.length).toBe(n === 0 ? 0 : n - (pages - 1) * 12);
    }
  });
  it('pageSize is bounded (Full Screen may ask for more than 12, never 200 columns)', async () => {
    const { svc } = bigSalon();
    expect((await svc.technicianPage(ctx, { date: DATE, pageSize: 500 })).pageSize).toBe(48);
    expect((await svc.technicianPage(ctx, { date: DATE, pageSize: 24 })).totalPages).toBe(9);
  });
});

describe('day grid for the visible page only', () => {
  it('columns and appointments for the 12 requested technicians (+ unassigned), in the requested order', async () => {
    const { svc } = bigSalon();
    const ids = (await svc.technicianPage(ctx, { date: DATE, page: 17 })).technicians.map((t) => t.technicianId);
    await svc.create(ctx, { customerName: 'On 200', serviceIds: ['svc_mani'], date: DATE, startTime: '10:00', technicianId: 't200', source: 'manual' } as any);
    await svc.create(ctx, { customerName: 'On 1', serviceIds: ['svc_mani'], date: DATE, startTime: '10:00', technicianId: 't001', source: 'manual' } as any);
    const g: any = await svc.dayGrid(ctx, DATE, ids);
    expect(g.columns.map((c: any) => c.technicianId)).toEqual(ids);
    expect(g.appointments.map((a: any) => a.customerName)).toEqual(['On 200']);   // #1's appointment is not on page 17
  });
  it('the day grid keeps the WHOLE day for its columns (it kept the first 50 appointments of the day)', async () => {
    const { svc } = bigSalon(12);
    for (let i = 0; i < 60; i++) {
      const t = `t${pad((i % 12) + 1)}`; const h = 9 + Math.floor(i / 12);
      await svc.create(ctx, { customerName: `C${i}`, serviceIds: ['svc_mani'], date: DATE, startTime: `${String(h).padStart(2, '0')}:00`, technicianId: t, source: 'manual' } as any);
    }
    const g: any = await svc.dayGrid(ctx, DATE, Array.from({ length: 12 }, (_, k) => `t${pad(k + 1)}`));
    expect(g.appointments.length).toBe(60);
  });
});

describe('Find an Opening / Best Matches on the server', () => {
  it('hard eligibility first: an unapproved technician never appears, however free; ranking is earliest start then deterministic', async () => {
    const { svc } = bigSalon(200, { skilledFor: (i) => (i >= 150 ? ['svc_mani', 'svc_gel'] : ['svc_mani']) });
    const a = await svc.openings(ctx, { date: DATE, serviceIds: ['svc_gel'], limit: 10 });
    expect(a.eligibleCount).toBe(51);
    expect(a.openings.length).toBe(10);
    expect(a.openings.every((o) => o.rosterNumber >= 150)).toBe(true);
    expect(a.openings.map((o) => o.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(a.hasMore).toBe(true);
    const b = await svc.openings(ctx, { date: DATE, serviceIds: ['svc_gel'], limit: 10 });
    expect(b.openings).toEqual(a.openings);   // identical state → identical answer
    const more = await svc.openings(ctx, { date: DATE, serviceIds: ['svc_gel'], limit: 10, offset: 10 });
    expect(more.openings[0].rank).toBe(11);
    expect(new Set([...a.openings, ...more.openings].map((o) => o.technicianId)).size).toBe(20);
  });
  it('a booked technician ranks behind free ones at the same earliest time (fewer openings left)', async () => {
    const { svc } = bigSalon(3);
    await svc.create(ctx, { customerName: 'X', serviceIds: ['svc_mani'], date: DATE, startTime: '14:00', technicianId: 't001', source: 'manual' } as any);
    const r = await svc.openings(ctx, { date: DATE, serviceIds: ['svc_mani'] });
    expect(r.openings.map((o) => o.technicianId)).toEqual(['t002', 't003', 't001']);
  });
  it('availability for the visible page only', async () => {
    const { svc } = bigSalon();
    const rows = await svc.availability(ctx, { date: DATE, serviceIds: ['svc_mani'], technicianIds: ['t100', 't101'] });
    expect(rows.map((r) => r.technicianId).sort()).toEqual(['t100', 't101']);
  });
});

// 200-technician §2 (Oct 26 2026): at 1,000 technicians no POS read carries more than one page of them — the board state
// without the roster (?roster=none, every POS screen now) and the technician page capped at its maximum page size.
describe('1,000 technicians — §2 nothing carries more than one page', () => {
  it('GET /state?roster=none names no technician; without it the roster rides along (the legacy shape)', async () => {
    const { svc } = bigSalon(1000);
    const none = await svc.getState(ctx, { date: DATE, roster: 'none' });
    expect(none.filters.technicians).toEqual([]);
    const legacy = await svc.getState(ctx, { date: DATE });
    expect(legacy.filters.technicians).toHaveLength(1000);
    expect(JSON.stringify(none).length).toBeLessThan(JSON.stringify(legacy).length / 5);
  });
  it('GET /technicians pages 1,000 (84 pages of 12), caps a page at its maximum, finds #1000 and locates any one technician as one row', async () => {
    const { svc } = bigSalon(1000);
    const p = await svc.technicianPage(ctx, { date: DATE, page: 84 });
    expect(p).toMatchObject({ total: 1000, totalPages: 84, page: 84 });
    expect(p.technicians.map((t) => t.rosterNumber)).toEqual([997, 998, 999, 1000]);
    expect((await svc.technicianPage(ctx, { date: DATE, pageSize: 100000 })).technicians.length).toBeLessThanOrEqual(48);
    // "#1000" = roster number 1000 (and, as 4+ digits, a name / phone containing 1000)
    expect((await svc.technicianPage(ctx, { date: DATE, search: '#1000' })).technicians.map((t) => t.rosterNumber)).toContain(1000);
    const one = await svc.technicianPage(ctx, { date: DATE, locate: 't777', pageSize: 1, status: 'all' });
    expect(one.technicians.map((t) => t.technicianId)).toEqual(['t777']);
  });
});
