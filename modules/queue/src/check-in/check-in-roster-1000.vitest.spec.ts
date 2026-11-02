// check-in-roster-1000.vitest.spec — 200-technician mandate §2 (Oct 27 2026): GET /pos/check-in/state carried every
// technician twice — `technicians` (the Quick Check-In <select>) and `availableTechnicians` (the card shows 5). With
// roster=none the name list is dropped (the POS picks through the server-paged picker) and techPage / techPageSize return
// ONE page of Available Technicians (available first, then busy, by name) with the totals; KPIs count everyone.
import { describe, it, expect } from 'vitest';
import { mapToCheckInState, CHECK_IN_TECH_PAGE_SIZE_MAX } from './check-in.dto';

const N = 1000;
const pad = (i: number) => String(i).padStart(4, '0');
const techs = Array.from({ length: N }, (_, i) => ({ technicianId: `t${pad(i + 1)}`, name: `Tech ${pad(N - i)}`, avatarUrl: null }));
// every 4th technician is busy (an active assignment)
const load = techs.filter((_, i) => i % 4 === 0).map((t) => ({ technicianId: t.technicianId, activeAssignments: 1 }));
const full = (): any => ({
  kpis: { checkedInToday: 0, appointmentsCheckedIn: 0, walkInsCheckedIn: 0, waitingNow: 0, sentToQueue: 0, sentToTechQueue: 0, startedService: 0, averageWaitMinutes: 0, noShowsToday: 0, onlineArrivalsToday: 0 },
  recentCheckIns: { items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 } }, appointmentsReadyForCheckIn: [],
  filters: { sources: [], statuses: [], technicians: techs, services: [], branches: [] }, settings: {},
  aggregates: { technicianLoad: load, sourceCounts: [], arrivalByHour: [] },
});

describe('§2 Check-In state at 1,000 technicians', () => {
  it('roster=none + techPage: no name list, one page of Available Technicians (available first, by name), the totals', () => {
    const st = mapToCheckInState(full(), Date.now(), { roster: 'none', techPage: 1, techPageSize: 5 });
    expect(st.technicians).toEqual([]);
    expect(st.availableTechnicians).toHaveLength(5);
    expect(st.availableTechnicians!.every((t) => t.status === 'available')).toBe(true);
    expect(st.availableTechnicians!.map((t) => t.displayName)).toEqual(['Tech 0001', 'Tech 0002', 'Tech 0003', 'Tech 0005', 'Tech 0006']);
    expect(st.technicianPage).toEqual({ page: 1, pageSize: 5, total: N, totalPages: 200, totalAll: N });
    expect(st.kpis.techsAvailable).toBe(750);   // the KPI still counts everyone
    expect(JSON.stringify(st).length).toBeLessThan(JSON.stringify(mapToCheckInState(full())).length / 20);
  });
  it('the size cap, a page past the end, and the legacy shape without options', () => {
    expect(mapToCheckInState(full(), Date.now(), { techPage: 1, techPageSize: 5000 }).availableTechnicians).toHaveLength(CHECK_IN_TECH_PAGE_SIZE_MAX);
    expect(mapToCheckInState(full(), Date.now(), { techPage: 9999, techPageSize: 5 }).technicianPage!.page).toBe(200);
    const legacy = mapToCheckInState(full());
    expect(legacy.technicians).toHaveLength(N); expect(legacy.availableTechnicians).toHaveLength(N); expect(legacy.technicianPage).toBeUndefined();
  });
});
