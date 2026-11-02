// tech-appointments-lanes-1000.vitest.spec — 200-technician mandate §2 (Oct 26 2026): GET /pos/tech-appointments/state drew
// one lane per technician and named every technician in filters.technicians. With lanePage it returns ONE page of lanes (name
// order, searchable by name or "#n"), only the appointments on those lanes (+ unassigned), the lane totals; roster=none drops
// the names. Measured here at 1,000 technicians and 3,000 appointments.
import { describe, it, expect } from 'vitest';
import { pageTechApptLanes, TECH_APPT_LANE_PAGE_SIZE, TECH_APPT_LANE_PAGE_SIZE_MAX } from './tech-appointments.service';
import type { POSTechAppointmentsFullState } from './tech-appointments.dto';

const N = 1000;
const pad = (i: number) => String(i).padStart(4, '0');
// names deliberately NOT in id order (lanes are ordered by name)
const techs = Array.from({ length: N }, (_, i) => ({ technicianId: `t${pad(i + 1)}`, displayName: `Tech ${pad(N - i)}`, workingStatus: 'available' as const, appointmentCount: 3, scheduledMinutes: 135, availableMinutes: 600, serviceSkillGroups: [] }));
const appts = Array.from({ length: 3 * N + 5 }, (_, i) => ({ appointmentId: `a${i}`, technicianId: i < 3 * N ? `t${pad((i % N) + 1)}` : (null as any), customerName: `G${i}` })) as any[];
const state = (): POSTechAppointmentsFullState => ({ kpis: { totalAppointmentsToday: appts.length } as any, date: '2026-10-26', technicians: techs, appointments: appts,
  filters: { statuses: [], sources: [], serviceCategories: [], technicians: techs.map((t) => ({ technicianId: t.technicianId, name: t.displayName })), branches: [] }, settings: {} as any });

describe('pageTechApptLanes at 1,000 technicians', () => {
  it('no paging asked → the legacy shape, unchanged', () => {
    const st = state();
    expect(pageTechApptLanes(st, {})).toBe(st);
  });
  it('one page of 12 lanes in name order, only their appointments + the unassigned ones, the totals; KPIs stay the whole day', () => {
    const r = pageTechApptLanes(state(), { lanePage: 1, roster: 'none' });
    expect(r.technicians.map((t) => t.displayName)).toEqual(Array.from({ length: TECH_APPT_LANE_PAGE_SIZE }, (_, i) => `Tech ${pad(i + 1)}`));
    expect(r.lanes).toEqual({ page: 1, pageSize: TECH_APPT_LANE_PAGE_SIZE, total: N, totalPages: Math.ceil(N / TECH_APPT_LANE_PAGE_SIZE), totalAll: N });
    expect(r.appointments).toHaveLength(TECH_APPT_LANE_PAGE_SIZE * 3 + 5);
    const ids = new Set(r.technicians.map((t) => t.technicianId));
    expect(r.appointments.every((a) => !a.technicianId || ids.has(a.technicianId))).toBe(true);
    expect(r.filters.technicians).toEqual([]);
    expect(r.kpis.totalAppointmentsToday).toBe(3 * N + 5);
    expect(JSON.stringify(r).length).toBeLessThan(JSON.stringify(state()).length / 20);   // the payload shrinks with the page
  });
  it('the last page, a page past the end, the size cap, search by name and by "#n"', () => {
    const last = pageTechApptLanes(state(), { lanePage: 84 });
    expect(last.lanes!.page).toBe(84); expect(last.technicians.map((t) => t.displayName)).toEqual(['Tech 0997', 'Tech 0998', 'Tech 0999', 'Tech 1000']);
    expect(pageTechApptLanes(state(), { lanePage: 999 }).lanes!.page).toBe(84);
    expect(pageTechApptLanes(state(), { lanePage: 1, lanePageSize: 5000 }).technicians).toHaveLength(TECH_APPT_LANE_PAGE_SIZE_MAX);
    expect(pageTechApptLanes(state(), { laneSearch: 'tech 099' }).technicians.map((t) => t.displayName)).toEqual(Array.from({ length: 10 }, (_, i) => `Tech 099${i}`));
    expect(pageTechApptLanes(state(), { laneSearch: '#1000' }).technicians.map((t) => t.displayName)).toEqual(['Tech 1000']);
  });
  it('roster=none alone keeps every lane but drops the names list', () => {
    const r = pageTechApptLanes(state(), { roster: 'none' });
    expect(r.technicians).toHaveLength(N); expect(r.filters.technicians).toEqual([]); expect(r.lanes).toBeUndefined();
  });
});
