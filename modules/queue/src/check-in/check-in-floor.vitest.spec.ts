// check-in-floor.vitest.spec — Check-In 27-inch mandate (Oct 28 2026) §11–§13, §29–§34, §40–§44, §72, §84, §89. The Check-In
// screen's server rules: the arriving window (one list for the KPI and the card), a real "vs yesterday" (none without a
// baseline), Available Technicians from real on-duty signals (break / serving / off shift are not available), advisory
// insights with routes (≤ 5 shown), top rows + totals for a busy lounge, and a definition for every KPI.
import { describe, it, expect } from 'vitest';
import { arrivingWithin, lateAppointments, checkInTrendPercent, checkInStaff, buildCheckInInsights, clockMinutes, CHECK_IN_KPI_DEFINITIONS, CHECK_IN_TOP_ROWS, CHECK_IN_ARRIVAL_WINDOW_MINUTES } from './check-in-floor';
import { mapToCheckInState, type POSCheckInFullState, type POSCheckInRow } from './check-in.dto';
import type { FloorTech } from '../queue/queue-floor';

const tech = (id: string, name: string, status: FloorTech['signals']['status'], availableInMinutes: number | null = 0, rotationIndex: number | null = null): FloorTech =>
  ({ technicianId: id, name, skills: ['Manicure', 'Pedicure', 'Waxing'], activeAssignments: 0, rotationIndex, signals: { status, availableInMinutes, onBreak: status === 'on_break' } });

describe('Today\'s Appointments Arriving window (§32–§34)', () => {
  const appts = [{ startTime: '09:00' }, { startTime: '10:30' }, { startTime: '12:50' }, { startTime: '13:10' }, { startTime: '18:00' }];
  it('starts within 3 hours (late ones stay), in time order', () => {
    expect(arrivingWithin(appts, 10 * 60).map((a) => a.startTime)).toEqual(['09:00', '10:30', '12:50']);
    expect(CHECK_IN_ARRIVAL_WINDOW_MINUTES).toBe(180);
  });
  it('a time it cannot read is kept, not dropped; no branch clock = everything', () => {
    expect(arrivingWithin([{ startTime: 'tbd' }], 600)).toHaveLength(1);
    expect(arrivingWithin(appts, null)).toHaveLength(5);
  });
  it('late = past the start by more than 10 minutes and not checked in (no-show risk)', () => {
    expect(lateAppointments(appts, 10 * 60 + 45).map((a) => a.startTime)).toEqual(['09:00', '10:30']);
    expect(clockMinutes('7:05')).toBe(425); expect(clockMinutes('x')).toBeNull();
  });
});

describe('Check-ins vs yesterday (§84 — no fake comparison)', () => {
  it('against yesterday up to the same clock time; none without a baseline', () => {
    expect(checkInTrendPercent(12, 10)).toBe(20); expect(checkInTrendPercent(8, 10)).toBe(-20);
    expect(checkInTrendPercent(5, 0)).toBeNull(); expect(checkInTrendPercent(5, null)).toBeNull();
  });
});

describe('Available Technicians = real availability (§40–§44, §89)', () => {
  const techs = [tech('a', 'Amy', 'available', 0, 2), tech('b', 'Bea', 'in_service', 8), tech('c', 'Cam', 'on_break', null), tech('d', 'Dee', 'off_shift', null), tech('e', 'Eve', 'available', 0, 1), tech('f', 'Fay', 'in_service', 40), tech('g', 'Gia', 'blocked', 30)];
  const st = checkInStaff(techs, { a: 1 }, 4);
  it('off shift and blocked are not on duty; available first in Fair Turn order, then finishing soon, busy, break', () => {
    expect(st.rows.map((r) => r.name)).toEqual(['Eve', 'Amy', 'Bea', 'Fay']);
    expect(st.rows.map((r) => r.status)).toEqual(['Available', 'Available', 'Finishing Soon', 'Busy']);
    expect(st.summary).toEqual({ onDuty: 5, available: 2, finishing: 1, busy: 1, onBreak: 1, roster: 7 });
  });
  it('load = guests assigned and not yet in service; next = Now / minutes / —; specialty = top two skills', () => {
    const amy = st.rows.find((r) => r.name === 'Amy')!;
    expect(amy.currentLoad).toBe(1); expect(amy.nextAvailable).toBe('Now'); expect(amy.specialty).toBe('Manicure, Pedicure');
    expect(st.rows.find((r) => r.name === 'Bea')!.nextAvailable).toBe('8');
    expect(checkInStaff(techs, {}, 10).rows.find((r) => r.name === 'Cam')!.nextAvailable).toBe('—');
  });
  it('a 200-technician salon returns the requested rows, never the roster', () => {
    const many = Array.from({ length: 200 }, (_, i) => tech(`t${i}`, `Tech ${i}`, i % 2 ? 'available' : 'off_shift', 0, i));
    const r = checkInStaff(many, {}, 6);
    expect(r.rows).toHaveLength(6); expect(r.summary.onDuty).toBe(100); expect(r.summary.roster).toBe(200);
  });
});

describe('Front Desk Insights (§29–§31)', () => {
  const base = { longWaitCount: 0, waitingNow: 0, techsAvailable: 0, lateAppointments: 0, arrivingSoon: 0, averageWaitMinutes: 0, vip: 0, walkInsToday: 0, checkedInToday: 0, peak: null };
  it('nothing to say → none', () => { expect(buildCheckInInsights(base)).toEqual([]); });
  it('the operational ones first, each with where to act; advisory only', () => {
    const ins = buildCheckInInsights({ ...base, longWaitCount: 3, waitingNow: 7, techsAvailable: 4, lateAppointments: 1, arrivingSoon: 2, averageWaitMinutes: 25, vip: 1, walkInsToday: 6, checkedInToday: 9, peak: { hour: 13, count: 5 } });
    expect(ins.map((i) => i.id)).toEqual(['longWait', 'late', 'arriving', 'available', 'wait', 'vip', 'walkin', 'peak']);
    expect(ins[0]).toMatchObject({ route: '/queue', vars: { count: 3, minutes: 15 } });
    expect(ins.find((i) => i.id === 'available')!.route).toBe('/queue?assign=1');
  });
});

describe('the screen state: top rows + totals, real KPIs (§16, §72, §84)', () => {
  const now = Date.UTC(2026, 9, 28, 15, 0);
  const row = (n: number, status: POSCheckInRow['status'], minAgo: number): POSCheckInRow => ({ checkInId: `ci${n}`, tenantId: 't', branchId: 'b', customerId: `c${n}`, customerName: `Guest ${n}`, isVip: false, appointmentId: null, source: 'walk_in', services: [{ serviceId: 's', serviceName: 'Gel', durationMinutes: 45, priceCents: 4500 }], technicianId: null, technicianName: null, checkedInAt: new Date(now - minAgo * 60000).toISOString(), status, notes: '' } as POSCheckInRow);
  const rows = Array.from({ length: 25 }, (_, i) => row(i, 'checked_in', 30 - i));
  const full = (o: Partial<POSCheckInFullState> = {}): POSCheckInFullState => ({
    kpis: { checkedInToday: 25, appointmentsCheckedIn: 0, walkInsCheckedIn: 25, waitingNow: 25, sentToQueue: 0, sentToTechQueue: 0, startedService: 0, averageWaitMinutes: 18, noShowsToday: 2, onlineArrivalsToday: 0 },
    recentCheckIns: { items: rows.slice(0, 20) }, appointmentsReadyForCheckIn: [], filters: { sources: [], statuses: [], technicians: [], services: [], branches: [] } as any, settings: {} as any, ...o,
  });
  it('25 waiting: the lounge shows the 6 who waited longest, the total says 25', () => {
    const st = mapToCheckInState(full({ activeRows: rows, staffTechs: [tech('a', 'Amy', 'available')], branchNowMinutes: 660, checkInsYesterdaySameTime: 20 }), now);
    expect(st.waiting).toHaveLength(CHECK_IN_TOP_ROWS.waiting); expect(st.waiting[0].customerName).toBe('Guest 0');
    expect(st.arrivals).toHaveLength(CHECK_IN_TOP_ROWS.arrivals);
    expect(st.totals).toMatchObject({ arrivals: 25, waiting: 25, available: 1, onDuty: 1 });
    expect(st.kpis.todayCheckInsTrendPercent).toBe(25); expect(st.kpis.noShows).toBe(2); expect(st.kpis.techsAvailable).toBe(1);
    expect(st.frontDeskInsights!.length).toBeLessThanOrEqual(5); expect(st.frontDeskInsights![0].id).toBe('longWait');
  });
  it('an adapter without the new fields keeps the legacy answer and shows NO comparison', () => {
    const st = mapToCheckInState(full(), now);
    expect(st.kpis.todayCheckInsTrendPercent).toBeNull(); expect(st.waiting).toHaveLength(20);
  });
});

describe('KPI definitions (§84)', () => {
  it('all nine Check-In KPIs are defined', () => {
    for (const k of ['checkInsToday', 'waitingGuests', 'walkIns', 'arrivingSoon', 'readyForService', 'averageWait', 'noShows', 'techsAvailable', 'customerReturnRate']) expect(CHECK_IN_KPI_DEFINITIONS[k]?.length).toBeGreaterThan(30);
  });
});
