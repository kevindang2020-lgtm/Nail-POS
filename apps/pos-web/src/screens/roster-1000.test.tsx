// roster-1000.test.tsx — 200-technician mandate §2 (Oct 26 2026): "design for 300 / 500 / 1,000+ technicians". Walk-In,
// New Booking, the AI Scheduling Optimizer and Tech Appointments each downloaded the whole roster (filters.technicians —
// every technician's name — and Tech Appointments one lane per technician). Here the four screens run against a fake
// server holding 1,000 technicians through the REAL api clients (a routed fetch), are driven through their technician
// pickers (open, search "#1000", next page) and the lane pager, and EVERY response is measured:
//   • no response carries more than one page of technicians (the largest page any screen asks for is 48)
//   • every booking-state read asks for ?roster=none (a screen that forgot would get all 1,000 names — and fail here)
//   • Tech Appointments reads one lane page (12) and never the roster
// Oct 27 2026 (§2 remainder): the POS Tech Queue (one lane page, the Workload Board as counts, Send Break / Reassign through
// the picker), the Time Clock (one roster page) and Check-In (one page of Available Technicians, the Quick Check-In picker)
// run here too — their state reads carry roster=none / a page, and the count below sees ANY technician-shaped list.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'OWNER', permissions: undefined } }) }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));

import { POSWalkInScreen } from './POSWalkInScreen';
import { POSNewBookingScreen } from './POSNewBookingScreen';
import { POSAISchedulingOptimizerScreen } from './POSAISchedulingOptimizerScreen';
import { POSTechAppointmentsScreen, TA_LANE_PAGE_SIZE } from './POSTechAppointmentsScreen';
import { POSTechQueueScreen, TQ_LANE_PAGE_SIZE } from './POSTechQueueScreen';
import { POSTimeClockScreen, TIME_CLOCK_PAGE_SIZE } from './POSTimeClockScreen';
import { POSCheckInScreen, CI_TECH_PAGE_SIZE } from './POSCheckInScreen';
import { pageTechQueueLanes, liveScheduleLaneIds } from '@aipowersalon/api-contracts/tenant';
import { POSLiveTechnicianScheduleScreen, LS_LANE_PAGE_SIZE } from './POSLiveTechnicianScheduleScreen';

const N = 1000;
const MAX_PAGE = 48;   // BOOKING_TECH_PAGE_SIZE_MAX / TECH_APPT_LANE_PAGE_SIZE_MAX on the server
const pad = (i: number) => String(i).padStart(4, '0');
const ROSTER = Array.from({ length: N }, (_, i) => ({ technicianId: `t${pad(i + 1)}`, name: `Tech ${pad(i + 1)}`, rosterNumber: i + 1 }));
const services = [{ serviceId: 's1', name: 'Gel Manicure', category: 'Manicure', priceCents: 4500, durationMinutes: 45 }];
type Seen = { path: string; query: URLSearchParams; technicians: number };
let seen: Seen[] = [];

/** the fake API: the server's own paging rules over 1,000 technicians */
function route(path: string, q: URLSearchParams): any {
  if (path === '/pos/booking/state') {
    return { kpis: {}, bookings: { items: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 } },
      filters: { statuses: [], sources: [], services, serviceCategories: ['Manicure'], branches: [], technicians: q.get('roster') === 'none' ? [] : ROSTER.map(({ technicianId, name }) => ({ technicianId, name })) } };
  }
  if (path === '/pos/booking/technicians') {
    const pageSize = Math.min(MAX_PAGE, Math.max(1, Number(q.get('pageSize')) || 12));
    const term = (q.get('search') || '').trim().toLowerCase();
    const num = /^#?\d+$/.test(term) ? Number(term.replace('#', '')) : null;
    const list = term ? ROSTER.filter((t) => (num != null ? t.rosterNumber === num : t.name.toLowerCase().includes(term))) : ROSTER;
    const locate = q.get('locate'); const idx = locate ? list.findIndex((t) => t.technicianId === locate) : -1;
    const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    const page = Math.min(totalPages, locate && idx >= 0 ? Math.floor(idx / pageSize) + 1 : Math.max(1, Number(q.get('page')) || 1));
    return { date: '2026-10-26', technicians: list.slice((page - 1) * pageSize, page * pageSize).map((t) => ({ ...t, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 })),
      total: list.length, totalAll: N, workingCount: N, page, pageSize, totalPages, ...(locate ? { located: idx >= 0 ? { technicianId: locate, page, index: idx } : null } : {}) };
  }
  if (path === '/pos/tech-appointments/state') {
    const paged = q.has('lanePage');
    const pageSize = Math.min(MAX_PAGE, Math.max(1, Number(q.get('lanePageSize')) || 12));
    const term = (q.get('laneSearch') || '').toLowerCase();
    const hit = term ? ROSTER.filter((t) => t.name.toLowerCase().includes(term)) : ROSTER;
    const totalPages = Math.max(1, Math.ceil(hit.length / pageSize)); const page = Math.min(totalPages, Math.max(1, Number(q.get('lanePage')) || 1));
    const lanes = (paged ? hit.slice((page - 1) * pageSize, page * pageSize) : ROSTER).map((t) => ({ technicianId: t.technicianId, displayName: t.name, workingStatus: 'available', appointmentCount: 0, scheduledMinutes: 0, availableMinutes: 600, serviceSkillGroups: [] }));
    return { kpis: { totalAppointmentsToday: 0, bookedAppointments: 0, checkedInAppointments: 0, inServiceAppointments: 0, completedAppointments: 0, cancelledAppointments: 0, noShowAppointments: 0, onlineBookings: 0, aiBookings: 0, googleBookings: 0, conflictCount: 0 },
      date: '2026-10-26', technicians: lanes, appointments: [],
      filters: { statuses: [], sources: [], serviceCategories: [], branches: [], technicians: q.get('roster') === 'none' ? [] : ROSTER.map(({ technicianId, name }) => ({ technicianId, name })) },
      ...(paged ? { lanes: { page, pageSize, total: hit.length, totalPages, totalAll: N } } : {}) };
  }
  if (path === '/pos/tech-queue/state') {
    // the server's rule (tech-queue.kysely.repository query): every lane only without lanePage
    const rows = ROSTER.map((t, i) => ({ rotationPosition: i + 1, technicianId: t.technicianId, technicianName: t.name, specialties: [], status: i % 10 === 9 ? 'on_break' : 'available', guests: 0, nextAvailableLabel: 'Now', nextAvailable: 'now', utilizationPercent: null, tipsTodayCents: 0, revenueTodayCents: 0 }));
    const kpis = { assignedTickets: 0, waitingForAcceptance: 0, acceptedTickets: 0, readyToStart: 0, delayedTickets: 0, activeTechnicians: 0, availableTechnicians: 900, averageAssignedWaitMinutes: 0, laborRevenueTodayCents: 0, utilizationTodayPercent: 0, upsellCapturePercent: 0, scheduledTechnicians: N, servicesInProgress: 0, waitingForAssignment: 0, avgTurnTimeMinutes: 0 };
    const lane = (r: (typeof rows)[number]) => ({ technicianId: r.technicianId, technicianName: r.technicianName, workingStatus: r.status, activeTicketCount: 0, acceptedTicketCount: 0, delayedTicketCount: 0, estimatedWorkloadMinutes: 0, tickets: [] });
    const base = { kpis, waitingGuests: [], insights: [], tickets: { items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 } } };
    if (!q.has('lanePage')) return { ...base, technicianRows: rows, technicianLanes: rows.map(lane), availableTechnicians: rows, filters: { technicians: rows.map((r) => r.technicianName) } };
    const size = Math.min(MAX_PAGE, Number(q.get('lanePageSize')) || 10);
    const pg = pageTechQueueLanes(rows, q.get('laneSearch') || '', q.get('laneStatus') || '', Number(q.get('lanePage')), size);
    const col = (pred: (r: (typeof rows)[number]) => boolean) => { const hit = rows.filter(pred); return { count: hit.length, items: hit.slice(0, 4) }; };
    return { ...base, technicianRows: pg.items, technicianLanes: pg.items.map(lane), availableTechnicians: rows.slice(0, size), availableTechniciansTotal: N,
      workload: { available: col((r) => r.status === 'available'), inProgress: col(() => false), finishing: col(() => false), breakOffline: col((r) => r.status === 'on_break') },
      lanes: { page: pg.page, pageSize: size, total: pg.total, totalPages: pg.totalPages, totalAll: N }, filters: { technicians: q.get('roster') === 'none' ? [] : rows.map((r) => r.technicianName), serviceCategories: [] } };
  }
  if (path === '/pos/time-clock/state') {
    const rows = ROSTER.map((t) => ({ technicianId: t.technicianId, technicianName: t.name, state: 'off', clockedInAt: null, onBreakSince: null, lastClockOutAt: null, hoursToday: 0, shiftCount: 0, shifts: [] }));
    const kpis = { technicianCount: N, clockedInCount: 0, totalHoursToday: 0 };
    if (!q.has('page')) return { kpis, technicians: rows };
    const size = Math.min(MAX_PAGE, Number(q.get('pageSize')) || 25); const term = (q.get('search') || '').toLowerCase();
    const hit = term ? rows.filter((r) => r.technicianName.toLowerCase().includes(term)) : rows;
    const totalPages = Math.max(1, Math.ceil(hit.length / size)); const page = Math.min(totalPages, Number(q.get('page')) || 1);
    return { kpis, technicians: hit.slice((page - 1) * size, page * size), page: { page, pageSize: size, total: hit.length, totalPages, totalAll: N } };
  }
  if (path === '/pos/technicians/live-schedule/state' || path === '/pos/technicians/live-schedule/week') {
    // the server's rule (live-technician-schedule.service): every column only without lanePage — one page with it
    const cols = ROSTER.map((t) => ({ technicianId: t.technicianId, fullName: t.name, initials: 'T', roleLabel: 'Nail Technician', status: 'available', skills: [], appointments: [], openSlots: [], blocks: [], bookedHours: 0, utilizationPercent: 0 }));
    const pg = liveScheduleLaneIds(cols, { lanePage: q.has('lanePage') ? Number(q.get('lanePage')) : undefined, lanePageSize: q.has('lanePageSize') ? Number(q.get('lanePageSize')) : undefined, laneSearch: q.get('laneSearch') || undefined });
    const keep = pg ? new Set(pg.ids) : null;
    const board = { date: '2026-10-26', branchId: 'b1', timeRange: { startTime: '09:00', endTime: '19:00', slotMinutes: 30 }, technicians: keep ? cols.filter((c) => keep.has(c.technicianId)) : cols, ...(pg ? { lanes: pg.lanes } : {}) };
    if (path.endsWith('/week')) return { weekStart: '2026-10-26', days: [board, board, board, board, board, board, board].map((b, i) => ({ date: `2026-10-${26 + i}`, board: b })), ...(pg ? { lanes: pg.lanes } : {}) };
    return { kpis: { techniciansOnShift: N, availableNow: N, inService: 0, onBreak: 0, upcomingAppointments: 0, openSlots: 0, utilizationPercent: 0, lateOrConflict: 0 }, schedule: board,
      filters: { statuses: [], skills: [], technicians: q.get('roster') === 'none' ? [] : cols.map((c) => ({ label: c.fullName, value: c.technicianId })) } };
  }
  if (path === '/pos/time-clock/break-policy') return { policy: { jurisdiction: 'NJ', restBreakPaidUpToMinutes: 20, mealBreakMinMinutes: 30, interruptedMealCompensable: true, kindDefaults: { break: 'rest', lunch: 'meal' } }, defaults: {}, version: 1, salon: null, branch: null };
  if (path === '/pos/check-in/state') {
    const avail = ROSTER.map((t) => ({ technicianId: t.technicianId, displayName: t.name, activeAssignments: 0, status: 'available' }));
    const paged = q.has('techPage'); const size = Math.min(MAX_PAGE, Number(q.get('techPageSize')) || 5);
    return { kpis: { todayCheckIns: 0, todayCheckInsTrendPercent: 0, waitingGuests: 0, estimatedWaitMinutes: 0, walkInsToday: 0, appointmentsArrived: 0, appointmentArrivalPercent: 0, readyForTech: 0, noShows: 0, techsAvailable: N, customerReturnRate: 0 },
      arrivals: [], appointmentCheckIn: { upcoming: [], arrived: [], noShow: [] }, waiting: [], readyForAssignment: [], services,
      technicians: q.get('roster') === 'none' ? [] : avail.map(({ technicianId, displayName }) => ({ technicianId, displayName })),
      availableTechnicians: paged ? avail.slice(0, size) : avail, ...(paged ? { technicianPage: { page: 1, pageSize: size, total: N, totalPages: Math.ceil(N / size), totalAll: N } } : {}) };
  }
  // the rebuilt screens' own read models (Oct 30 2026): KPIs carry the salon day; lists are server pages; no roster anywhere
  const emptyPage = { items: [], page: 1, pageSize: Number(q.get('pageSize')) || 10, totalItems: 0, totalPages: 1 };
  if (path === '/pos/tech-appointments-screen/kpis') return { date: '2026-10-26', today: '2026-10-26', tz: 'America/New_York', kpis: { today: 0, booked: 0, checkedIn: 0, inService: 0, completed: 0, cancelled: 0, noShows: 0, online: 0, conflicts: 0 } };
  if (path === '/pos/live-schedule-screen/kpis') return { date: '2026-10-26', today: '2026-10-26', tz: 'America/New_York', nowMinute: 600, when: 'today', kpis: { clockedIn: 0, availableNow: N, inService: 0, onBreak: 0, scheduledMinutes: 0, bookedMinutes: 0, utilizationPercent: 0, utilizationBasis: 'booked' } };
  if (path === '/pos/tech-appointments-screen/appointments' || path === '/pos/tech-appointments-screen/history' || path === '/pos/live-schedule-screen/activity') return emptyPage;
  if (path === '/pos/tech-appointments-screen/week') return { start: '2026-10-26', days: [], technicians: [], page: 1, pageSize: 12, totalItems: N, totalPages: Math.ceil(N / 12) };
  if (path === '/pos/technicians/live-schedule/board') return route('/pos/technicians/live-schedule/state', new URLSearchParams({ lanePage: q.get('lanePage') || '1', lanePageSize: q.get('lanePageSize') || '12', laneSearch: q.get('search') || '' })).schedule;
  if (path.startsWith('/pos/ai-scheduling-optimizer/recommendations') || path.endsWith('/time-off') || path.endsWith('/locks') || path.endsWith('/service-profiles')) return { items: [], total: 0 };
  if (path.startsWith('/pos/ai-scheduling-optimizer/runs')) return [];
  if (path === '/pos/booking/availability') return [];
  if (path.includes('drafts')) return { drafts: [] };
  return {};
}
/** how many technicians a response carries: the longest list, at any depth, that is keyed like a technician list
 *  (technicians, technicianRows, technicianLanes, availableTechnicians, …) or whose rows carry a technicianId */
function countTechnicians(body: any): number {
  if (!body || typeof body !== 'object') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(body)) {
    if (Array.isArray(v) && (/technician/i.test(k) || v.some((x) => x && typeof x === 'object' && 'technicianId' in x))) n = Math.max(n, v.length);
    if (v && typeof v === 'object') n = Math.max(n, countTechnicians(v));
  }
  return n;
}
beforeEach(() => {
  seen = [];
  globalThis.fetch = vi.fn(async (input: any) => {
    const u = new URL(String(input), 'http://pos.local');
    const path = u.pathname.replace(/^\/api\/v1(?=\/)/, '');
    const body = route(path, u.searchParams);
    seen.push({ path, query: u.searchParams, technicians: countTechnicians(body) });
    const text = JSON.stringify(body);
    return { ok: true, status: 200, statusText: 'OK', text: async () => text, json: async () => JSON.parse(text), headers: { get: () => null } } as any;
  }) as any;
});
const mount = (el: React.ReactElement, url = '/') => render(<MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>);
function expectOnePageAtMost() {
  expect(seen.length).toBeGreaterThan(0);
  const worst = seen.reduce((a, b) => (b.technicians > a.technicians ? b : a));
  expect(worst.technicians, `${worst.path}?${worst.query} carried ${worst.technicians} technicians`).toBeLessThanOrEqual(MAX_PAGE);
  for (const s of seen.filter((x) => ['/pos/booking/state', '/pos/tech-appointments/state', '/pos/tech-queue/state', '/pos/check-in/state', '/pos/technicians/live-schedule/state', '/pos/technicians/live-schedule/week'].includes(x.path))) expect(s.query.get('roster'), `${s.path} without roster=none`).toBe('none');
  for (const s of seen.filter((x) => x.path === '/pos/time-clock/state')) expect(s.query.get('page'), `${s.path} without a page`).toBeTruthy();
}
async function drivePicker() {
  const picker = await screen.findByTestId('technician-picker');
  await within(picker).findByText(/Page 1 of /);
  fireEvent.click(within(picker).getByText('Next'));
  await within(picker).findByText(/Page 2 of /);
  fireEvent.change(within(picker).getByRole('searchbox'), { target: { value: '#1000' } });
  expect(await within(picker).findByRole('option', { name: /Tech 1000/ })).toBeTruthy();
}

describe('§2 — nothing in the POS loads more than one page of technicians at 1,000', () => {
  it('Walk-In: the catalog read has no roster; choosing a technician pages from the server', async () => {
    mount(<POSWalkInScreen />);
    fireEvent.click(await screen.findByText('Gel Manicure'));
    fireEvent.click(screen.getByText('Choose Technician'));
    await drivePicker();
    fireEvent.click(await screen.findByRole('option', { name: /Tech 1000/ }));
    expect(await screen.findByText("Selected: Tech 1000")).toBeTruthy();
    expectOnePageAtMost();
  });
  it('New Booking: no roster; a preselected technician (?technicianId) is looked up as ONE row; the picker pages', async () => {
    mount(<POSNewBookingScreen />, '/x?technicianId=t0777');
    await waitFor(() => expect(seen.some((s) => s.path === '/pos/booking/technicians' && s.query.get('locate') === 't0777' && s.query.get('pageSize') === '1')).toBe(true));
    expect((await screen.findAllByText(/Tech 0777/)).length).toBeGreaterThan(0);
    await drivePicker();
    expectOnePageAtMost();
  });
  it('AI Scheduling Optimizer: the day without the roster; Run for / Find a time / Time off pick through the paged picker', async () => {
    mount(<POSAISchedulingOptimizerScreen />);
    fireEvent.click(await screen.findByLabelText('Run for'));
    await drivePicker();
    fireEvent.click(screen.getByRole('tab', { name: 'Find a time' }));
    fireEvent.click(await screen.findByLabelText('Preferred technician'));
    await screen.findByTestId('technician-picker');
    fireEvent.click(screen.getByRole('tab', { name: 'Time off & locks' }));
    fireEvent.click(await screen.findByLabelText('Time off technician'));
    await screen.findByTestId('technician-picker');
    // a recommendation naming a technician not on screen costs one row, not the roster
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expectOnePageAtMost();
  });
  it(`Tech Appointments: ${TA_LANE_PAGE_SIZE} lanes a page from the server, searchable, no roster`, async () => {
    mount(<POSTechAppointmentsScreen />);
    const pager = await screen.findByTestId('ta-lane-pager');
    expect(await within(pager).findByText(`Page 1 of ${Math.ceil(N / TA_LANE_PAGE_SIZE)}`)).toBeTruthy();
    const cards = () => within(screen.getByTestId('tech-card-grid')).getAllByText(/^Tech \d{4}$/);   // the board shows the same page of lanes
    expect(cards().length).toBe(TA_LANE_PAGE_SIZE);
    fireEvent.click(within(pager).getByText('Next'));
    expect(await within(pager).findByText(`Page 2 of ${Math.ceil(N / TA_LANE_PAGE_SIZE)}`)).toBeTruthy();
    fireEvent.change(within(pager).getByRole('searchbox'), { target: { value: 'Tech 0999' } });
    await waitFor(() => expect(cards().map((e) => e.textContent)).toEqual(['Tech 0999']));
    expect(seen.filter((s) => s.path === '/pos/tech-appointments/state').every((s) => s.query.get('lanePageSize') === String(TA_LANE_PAGE_SIZE))).toBe(true);
    expectOnePageAtMost();
  });
  it(`Tech Queue: ${TQ_LANE_PAGE_SIZE} lanes a page from the server, the Workload Board as counts, Send Break and Reassign through the picker`, async () => {
    mount(<POSTechQueueScreen />);
    const pager = await screen.findByTestId('tq-lane-pager');
    expect(pager.textContent).toContain(`Showing ${TQ_LANE_PAGE_SIZE} of ${N}`);
    expect(pager.textContent).toContain(`Page 1 of ${N / TQ_LANE_PAGE_SIZE}`);
    expect(screen.getAllByText('900').length).toBeGreaterThan(0);   // Available Now — counted over everyone, carried as a few rows
    fireEvent.click(within(pager).getByText('Next'));
    await waitFor(() => expect(screen.getByTestId('tq-lane-pager').textContent).toContain(`Page 2 of ${N / TQ_LANE_PAGE_SIZE}`));
    fireEvent.change(screen.getAllByLabelText('Find technician')[0], { target: { value: '#1000' } });
    await waitFor(() => expect(screen.getByTestId('tq-lane-pager').textContent).toContain('Showing 1 of 1'));
    fireEvent.change(screen.getByLabelText('Technician status filter'), { target: { value: 'break' } });
    fireEvent.change(screen.getAllByLabelText('Find technician')[0], { target: { value: '' } });
    await waitFor(() => expect(screen.getByTestId('tq-lane-pager').textContent).toContain('Showing 10 of 100'));
    fireEvent.click(screen.getByText('Send Break'));
    fireEvent.click(screen.getByLabelText('Break technician'));
    await drivePicker();
    expect(seen.filter((x) => x.path === '/pos/tech-queue/state').every((x) => x.query.get('lanePage') && x.query.get('lanePageSize') === String(TQ_LANE_PAGE_SIZE))).toBe(true);
    expectOnePageAtMost();
  });
  it(`Time Clock: ${TIME_CLOCK_PAGE_SIZE} technicians a page from the server, searchable`, async () => {
    mount(<POSTimeClockScreen />);
    const pager = await screen.findByTestId('tc-pager');
    expect(await within(pager).findByText(`Page 1 of ${N / TIME_CLOCK_PAGE_SIZE}`)).toBeTruthy();
    fireEvent.click(within(pager).getByText('Next'));
    expect(await within(pager).findByText(`Page 2 of ${N / TIME_CLOCK_PAGE_SIZE}`)).toBeTruthy();
    fireEvent.change(within(pager).getByRole('searchbox'), { target: { value: 'Tech 0999' } });
    await waitFor(() => expect(seen.some((x) => x.path === '/pos/time-clock/state' && x.query.get('search') === 'Tech 0999')).toBe(true));
    expect(await screen.findByText('Tech 0999')).toBeTruthy();
    expectOnePageAtMost();
  });
  it(`Check-In: no roster, ${CI_TECH_PAGE_SIZE} available technicians, the Quick Check-In technician pages from the server`, async () => {
    mount(<POSCheckInScreen />);
    fireEvent.click(await screen.findByText('New Customer'));
    fireEvent.click(await screen.findByLabelText('Requested Technician'));
    await drivePicker();
    expect(seen.filter((x) => x.path === '/pos/check-in/state').every((x) => x.query.get('techPageSize') === String(CI_TECH_PAGE_SIZE))).toBe(true);
    expectOnePageAtMost();
  });
  it(`Live Technician Schedule: ${LS_LANE_PAGE_SIZE} columns a page from the server (day and week), searchable, no roster`, async () => {
    mount(<POSLiveTechnicianScheduleScreen />);
    const pager = await screen.findByTestId('live-schedule-pager');
    const pages = Math.ceil(N / LS_LANE_PAGE_SIZE);
    expect(await within(pager).findByText(`Page 1 of ${pages}`)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/^Tech \d{4}$/).length).toBe(LS_LANE_PAGE_SIZE));
    fireEvent.click(within(pager).getByText('Next'));
    expect(await within(pager).findByText(`Page 2 of ${pages}`)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/^Tech \d{4}$/)[0].textContent).toBe('Tech 0013'));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find technician' }), { target: { value: '#1000' } });
    await waitFor(() => expect(screen.getAllByText(/^Tech \d{4}$/).map((e) => e.textContent)).toEqual(['Tech 1000']));
    // the week view pages its rows the same way
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find technician' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    await waitFor(() => expect(seen.some((x) => x.path === '/pos/technicians/live-schedule/week')).toBe(true));
    await waitFor(() => expect(within(screen.getByLabelText('Week schedule')).getAllByText(/^Tech \d{4}$/).length).toBe(LS_LANE_PAGE_SIZE));
    expect(seen.filter((x) => x.path.startsWith('/pos/technicians/live-schedule/')).every((x) => x.query.get('lanePageSize') === String(LS_LANE_PAGE_SIZE))).toBe(true);
    expectOnePageAtMost();
  });
});
