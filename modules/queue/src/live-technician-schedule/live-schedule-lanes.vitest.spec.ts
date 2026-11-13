// live-schedule-lanes.vitest.spec.ts — 200-technician §2 (Oct 27 2026): the Live Technician Schedule pages its technician
// columns on the server (Tech Appointments' rule): name order, "#n" or an accent-insensitive name search, one page, the
// totals; without lanePage the legacy every-column shape is untouched; roster=none drops the name list.
import { describe, it, expect } from 'vitest';
import { pageLiveScheduleBoard, liveScheduleLaneIds, LiveTechnicianScheduleService } from './live-technician-schedule.service';

const col = (i: number, name = `Tech ${String(i).padStart(3, '0')}`) => ({ technicianId: `t${i}`, userId: undefined, fullName: name, initials: 'T', roleLabel: 'Nail Technician', status: 'available' as const, skills: [], appointments: [], openSlots: [], blocks: [], bookedHours: 0, utilizationPercent: 0 });
const cols = [...Array.from({ length: 199 }, (_, i) => col(i + 1)), col(200, 'Nguyễn Thị Hương')];
const board = { date: '2026-10-27', branchId: 'b1', timeRange: { startTime: '09:00', endTime: '19:00', slotMinutes: 30 }, technicians: cols as any[] };

describe('Live Technician Schedule — column paging at 200 technicians', () => {
  it('no lanePage → every column (legacy shape, no lanes)', () => {
    const out = pageLiveScheduleBoard(board as any, {});
    expect(out.technicians.length).toBe(200); expect(out.lanes).toBeUndefined();
  });
  it('lanePage → 12 columns in name order, 17 pages', () => {
    const out = pageLiveScheduleBoard(board as any, { lanePage: 1 });
    expect(out.technicians.length).toBe(12); expect(out.lanes).toEqual({ page: 1, pageSize: 12, total: 200, totalPages: 17, totalAll: 200 });
    expect(out.technicians[0].fullName).toBe('Nguyễn Thị Hương');   // "N" sorts before "T"
    const last = pageLiveScheduleBoard(board as any, { lanePage: 17 });
    expect(last.technicians.length).toBe(200 - 16 * 12); expect(last.technicians.at(-1)!.fullName).toBe('Tech 199');
  });
  it('page size is clamped to 48 and a page past the end is the last page', () => {
    expect(liveScheduleLaneIds(cols, { lanePage: 1, lanePageSize: 500 })!.lanes.pageSize).toBe(48);
    expect(liveScheduleLaneIds(cols, { lanePage: 99 })!.lanes.page).toBe(17);
  });
  it('laneSearch: "nguyen" finds "Nguyễn" (accent-insensitive); "#2" is the second in name order', () => {
    expect(pageLiveScheduleBoard(board as any, { lanePage: 1, laneSearch: 'nguyen' }).technicians.map((c) => c.fullName)).toEqual(['Nguyễn Thị Hương']);
    expect(pageLiveScheduleBoard(board as any, { lanePage: 1, laneSearch: 'NGUYỄN thị' }).technicians.length).toBe(1);
    expect(pageLiveScheduleBoard(board as any, { laneSearch: '#2' }).technicians.map((c) => c.fullName)).toEqual(['Tech 001']);
  });
  it('the service pages the day board and drops the roster with roster=none; KPIs stay whole-day', async () => {
    const repo: any = { today: async () => '2026-10-27', state: async () => board, kpis: async () => ({ techniciansOnShift: 200 }), filtersData: async () => ({ statuses: [], skills: [], technicians: cols.map((c) => ({ label: c.fullName, value: c.technicianId })) }) };
    const svc = new LiveTechnicianScheduleService(repo);
    const ctx: any = { tenantId: 'ten', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.technicians.view'] };
    const st = await svc.pageState(ctx, { lanePage: 2, roster: 'none' });
    expect(st.schedule.technicians.length).toBe(12); expect(st.schedule.lanes?.page).toBe(2);
    expect(st.filters.technicians).toEqual([]); expect((st.kpis as any).techniciansOnShift).toBe(200);
    const legacy = await svc.pageState(ctx, {});
    expect(legacy.schedule.technicians.length).toBe(200); expect(legacy.filters.technicians.length).toBe(200);
    const wk = await svc.week(ctx, { lanePage: 1, laneSearch: 'nguyen' });
    expect(wk.lanes?.total).toBe(1); expect(wk.days.every((d) => d.board.technicians.length === 1)).toBe(true);
  });
});

// extras 200-Technician 05 (round 10): No-Hidden-Limit Validator — every roster size, every page walked
describe('No-Hidden-Limit Validator — Live Technician Schedule at 12 / 24 / 50 / 100 / 199 / 200 / 201', () => {
  for (const n of [12, 24, 50, 100, 199, 200, 201]) {
    it(`${n} technicians: ceil(n/12) pages, every technician on exactly one page, none dropped, "#${n}" finds the last`, () => {
      const cs = Array.from({ length: n }, (_, i) => col(i + 1));
      const b = { ...board, technicians: cs } as any;
      const first = pageLiveScheduleBoard(b, { lanePage: 1 });
      expect(first.lanes).toEqual({ page: 1, pageSize: 12, total: n, totalPages: Math.ceil(n / 12), totalAll: n });
      const seen: string[] = [];
      for (let p = 1; p <= first.lanes!.totalPages; p++) seen.push(...pageLiveScheduleBoard(b, { lanePage: p }).technicians.map((t: any) => t.technicianId));
      expect(seen).toHaveLength(n); expect(new Set(seen).size).toBe(n);
      expect(pageLiveScheduleBoard(b, { lanePage: first.lanes!.totalPages }).technicians).toHaveLength(n - (Math.ceil(n / 12) - 1) * 12);
      expect(pageLiveScheduleBoard(b, { lanePage: 1, laneSearch: `#${n}` }).technicians.map((t: any) => t.fullName)).toEqual([`Tech ${String(n).padStart(3, '0')}`]);
    });
  }
});
