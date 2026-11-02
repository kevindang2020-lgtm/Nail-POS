// time-clock-roster-1000.vitest.spec — 200-technician mandate §2 (Oct 27 2026): GET /pos/time-clock/state returned one row
// per technician of the salon (every punch and break of each). With ?page it returns ONE page of the day's roster (on the
// clock first, then hours today), searchable by name (accent-insensitive) and filterable by clock state; the KPIs still
// count every technician. Measured at 1,000 technicians, 300 of them on the clock.
import { describe, it, expect } from 'vitest';
import { InMemoryTimeClockRepository } from './time-clock.repository';
import { TimeClockService } from './time-clock.service';

const N = 1000;
const pad = (i: number) => String(i).padStart(4, '0');
const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.technicians.view'] };
const techs = Array.from({ length: N }, (_, i) => ({ technicianId: `t${pad(i + 1)}`, technicianName: i === 6 ? 'Nguyễn Thị Hương' : `Tech ${pad(i + 1)}`, avatarUrl: null }));
// technicians 1..300 clocked in an hour ago (open punch)
const start = new Date(Date.now() - 3600_000).toISOString();
const punches = techs.slice(0, 300).map((t, i) => ({ id: `p${i}`, technicianId: t.technicianId, startTime: start, endTime: null, status: 'active' }));
const svc = () => new TimeClockService(new InMemoryTimeClockRepository(techs as never, punches as never));

describe('§2 Time Clock state at 1,000 technicians', () => {
  it('?page: one page (on the clock first), the totals, KPIs over everyone', async () => {
    const st = await svc().getState(ctx as never, { page: 1, pageSize: 25 });
    expect(st.technicians).toHaveLength(25);
    expect(st.technicians.every((r) => r.state === 'clocked_in')).toBe(true);
    expect(st.page).toEqual({ page: 1, pageSize: 25, total: N, totalPages: 40, totalAll: N });
    expect(st.kpis.technicianCount).toBe(N);
    expect(st.kpis.clockedInCount).toBe(300);
  });
  it('last page / past the end / size cap (48) / name search (accent-insensitive) / state filter', async () => {
    const s = svc();
    expect((await s.getState(ctx as never, { page: 40, pageSize: 25 })).technicians).toHaveLength(25);
    expect((await s.getState(ctx as never, { page: 999, pageSize: 25 })).page!.page).toBe(40);
    expect((await s.getState(ctx as never, { page: 1, pageSize: 5000 })).technicians).toHaveLength(48);
    expect((await s.getState(ctx as never, { page: 1, search: 'nguyen thi' })).technicians.map((r) => r.technicianName)).toEqual(['Nguyễn Thị Hương']);
    expect((await s.getState(ctx as never, { page: 1, search: 'Tech 1000' })).technicians.map((r) => r.technicianName)).toEqual(['Tech 1000']);
    const out = await s.getState(ctx as never, { page: 1, pageSize: 25, state: 'off' });
    expect(out.page!.total).toBe(700); expect(out.technicians.every((r) => r.state === 'off')).toBe(true);
    expect((await s.getState(ctx as never, { page: 1, state: 'on_clock' })).page!.total).toBe(300);
  });
  it('no page = every row (the legacy shape an older client reads)', async () => {
    const st = await svc().getState(ctx as never);
    expect(st.technicians).toHaveLength(N); expect(st.page).toBeUndefined();
  });
});
