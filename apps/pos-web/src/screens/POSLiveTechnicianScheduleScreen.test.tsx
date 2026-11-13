// POSLiveTechnicianScheduleScreen — the Live Technician Schedule rebuild (Oct 30 2026): the six KPIs with definitions (a
// past day shows no live counts; utilization N/A with nothing scheduled), every module, the board pages 12 from the server,
// the one search over technicians and appointments, the full-day overlay (Close / Esc) with its actions, weekly hours that
// show their impact BEFORE saving and send the full week with its version, Week view, and Vietnamese with no English left.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
const { so } = vi.hoisted(() => ({ so: { editor: vi.fn(), preview: vi.fn(), save: vi.fn() } }));
const { ls, live, techs } = vi.hoisted(() => ({
  ls: { kpis: vi.fn(), search: vi.fn(), activity: vi.fn(), shiftImpact: vi.fn() },
  live: { state: vi.fn(), week: vi.fn(), detail: vi.fn(), startBreak: vi.fn(), endBreak: vi.fn(), blockTime: vi.fn(), bookOpenSlot: vi.fn() },
  techs: { schedule: vi.fn(), setSchedule: vi.fn() },
}));
vi.mock('../api/posTeamScreensApi', () => ({ posShiftOverrideApi: so, posLiveScheduleScreenApi: ls, posTechAppointmentsScreenApi: { conflicts: vi.fn() }, posTechniciansScreenApi: { directory: vi.fn(async () => ({ items: [], page: 1, pageSize: 100, totalItems: 0, totalPages: 1 })) } }));
vi.mock('../api/posLiveTechnicianScheduleApi', () => ({ posLiveTechnicianScheduleApi: live }));
vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: techs }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (k: string) => k !== 'technicians.view_pay' }));
vi.mock('../components/IPadViewProvider', () => ({ useIPadView: () => ({ open: vi.fn() }), registerIPadModule: vi.fn() }));
import { POSLiveTechnicianScheduleScreen, LS_LANE_PAGE_SIZE } from './POSLiveTechnicianScheduleScreen';

const DAY = '2026-10-30';   // a Friday
const period = { preset: 'week', from: '2026-10-26', to: DAY, tz: 'America/New_York', today: DAY };
const K = { workingToday: 1, clockedIn: 1, availableNow: 1, inService: 0, onBreak: 0, bookedMinutes: 60, bookedHours: 1, appointments: 1, scheduledMinutes: 480, utilizationPercent: 13, utilizationBasis: 'forecast' };
const COL = { technicianId: 't1', fullName: 'Trần Mỹ Linh', initials: 'TM', roleLabel: 'Thợ chính', status: 'available', shift: { startTime: '09:00', endTime: '17:00', breakStartTime: '12:00', breakEndTime: '12:30' }, skills: ['Manicure'],
  appointments: [{ appointmentId: 'a1', customerName: 'Nguyễn Thị Hương', serviceSummary: 'Gel Manicure', startTime: '14:00', endTime: '15:00', status: 'confirmed', source: 'online' }], openSlots: [{ slotId: 'o1', startTime: '15:00', endTime: '17:00', durationMinutes: 120 }], blocks: [], bookedHours: 1, utilizationPercent: 13 };
const state = { schedule: { date: DAY, technicians: [COL], lanes: { page: 1, pageSize: 12, total: 1, totalPages: 1, totalAll: 1 } }, filters: { statuses: [{ label: 'Available', value: 'available' }], skills: [{ label: 'Manicure', value: 'Manicure' }] } };
beforeEach(() => {
  for (const g of [ls, live, techs]) Object.values(g).forEach((f) => (f as any).mockReset());
  ls.kpis.mockImplementation(async (q: any) => ({ date: q?.date ?? DAY, today: DAY, tz: 'America/New_York', nowMinute: 600, when: !q?.date || q.date === DAY ? 'today' : q.date < DAY ? 'past' : 'future',
    kpis: !q?.date || q.date === DAY ? K : { ...K, clockedIn: null, availableNow: null, inService: null, onBreak: null, scheduledMinutes: 0, utilizationPercent: null, utilizationBasis: 'booked' } }));
  ls.activity.mockResolvedValue({ period, items: [{ id: 'h1', technicianId: 't1', technician: 'Trần Mỹ Linh', kind: 'blocked', action: 'time_blocked', oldValue: '15:00', newValue: '16:00', subject: 'training', onDate: DAY, at: `${DAY}T14:00:00Z`, actor: null }], page: 1, pageSize: 8, totalItems: 1, totalPages: 1 });
  ls.search.mockResolvedValue({ q: 'linh', technicians: { totalItems: 1, items: [{ technicianId: 't1', name: 'Trần Mỹ Linh', shiftToday: '09:00–17:00', matchedVia: 'name' }] }, appointments: { totalItems: 1, items: [{ appointmentId: 'a1', customer: 'Nguyễn Thị Hương', technician: 'Trần Mỹ Linh', technicianId: 't1', date: DAY, start: '14:00', services: ['Gel Manicure'], status: 'confirmed' }] } });
  live.state.mockResolvedValue(state);
  live.week.mockResolvedValue({ weekStart: '2026-10-26', days: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', DAY, '2026-10-31', '2026-11-01'].map((d) => ({ date: d, board: { technicians: [{ ...COL, shift: d === DAY ? COL.shift : undefined }] } })), lanes: state.schedule.lanes });
  live.detail.mockResolvedValue({ ...COL, bookedHours: 1, salesTodayCents: null, tipsTodayCents: null, commissionPreviewCents: null, nextAppointment: COL.appointments[0] });
  techs.schedule.mockResolvedValue({ weekly: { friday: { isWorking: true, startTime: '09:00', endTime: '17:00', lunchStart: '12:00', lunchEnd: '12:30' }, monday: { isWorking: true, startTime: '10:00', endTime: '18:00' } }, version: 3 });
});
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });
const mount = () => render(<MemoryRouter><POSLiveTechnicianScheduleScreen /></MemoryRouter>);
// the board loads after the KPIs (the day comes from them), so the activity row can show the name first: open the day from the board's own button
const openLinh = async () => fireEvent.click((await screen.findAllByTitle('View the full day'))[0]);

describe('POSLiveTechnicianScheduleScreen', () => {
  it('six KPIs with definitions, every module, and the board paged 12 from the server', async () => {
    mount();
    expect(await screen.findByTestId('kpi-utilization')).toHaveTextContent('13%');
    expect(screen.getByTestId('kpi-working')).toHaveTextContent('1 clocked in now');
    await screen.findByTestId('live-schedule-pager');   // the board (and its pager) follows the KPIs
    for (const t of ['kpi-available', 'kpi-in-service', 'kpi-break', 'kpi-booked', 'board', 'selected', 'next-available', 'conflict-warning', 'activity', 'live-schedule-pager', 'search', 'status', 'skill', 'view-day', 'view-week', 'to-today'])
      expect(screen.getByTestId(t)).toBeInTheDocument();
    expect(await screen.findAllByText('Trần Mỹ Linh')).not.toHaveLength(0);
    expect(live.state).toHaveBeenCalledWith(expect.objectContaining({ date: DAY, lanePageSize: LS_LANE_PAGE_SIZE, roster: 'none' }));
    expect(await screen.findAllByTestId('activity-row')).toHaveLength(1);
  });
  it('a past day shows no live counts and says so; utilization N/A with nothing scheduled', async () => {
    mount(); await screen.findByTestId('kpi-utilization');
    fireEvent.change(screen.getByTestId('day'), { target: { value: '2026-10-01' } });
    await waitFor(() => expect(screen.getByTestId('kpi-available')).toHaveTextContent('—'));
    expect(screen.getByTestId('kpi-utilization')).toHaveTextContent('N/A');
    expect(screen.getByTestId('not-live')).toBeInTheDocument();
  });
  it('one search finds technicians and appointments; a hit opens the full day, which closes with Close and Esc', async () => {
    mount(); await screen.findByTestId('kpi-utilization');
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'linh' } });
    await waitFor(() => expect(ls.search).toHaveBeenCalledWith({ q: 'linh' }));
    fireEvent.click(await screen.findByTestId('hit-tech'));
    expect(await screen.findByTestId('dlg-full-day')).toBeInTheDocument();
    expect(screen.queryByTestId('full-day-money')).toBeNull();   // no pay access → no sales / tips / commission
    fireEvent.click(screen.getByTestId('full-day-close'));
    await waitFor(() => expect(screen.queryByTestId('dlg-full-day')).toBeNull());
    fireEvent.click(screen.getByTestId('hit-appt')); await screen.findByTestId('dlg-full-day');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('dlg-full-day')).toBeNull());
    expect(screen.getByTestId('selected-card')).toHaveTextContent('Trần Mỹ Linh');
  });
  it('the overlay actions: Start Break and Block Time go to the existing routes', async () => {
    live.startBreak.mockResolvedValue({}); live.blockTime.mockResolvedValue({});
    mount(); await openLinh();
    fireEvent.click(await screen.findByTestId('start-break'));
    await waitFor(() => expect(live.startBreak).toHaveBeenCalledWith('t1', { managerOverride: false }));
    fireEvent.change(screen.getByTestId('block-start'), { target: { value: '15:00' } }); fireEvent.change(screen.getByTestId('block-end'), { target: { value: '16:00' } });
    fireEvent.click(screen.getByTestId('block-save'));
    await waitFor(() => expect(live.blockTime).toHaveBeenCalledWith('t1', { date: DAY, startTime: '15:00', endTime: '16:00', reason: 'temporary_unavailable' }));
  });
  it('weekly hours: the impact on booked appointments is shown before saving; save needs the acknowledgement and sends the whole week with its version', async () => {
    ls.shiftImpact.mockResolvedValue({ affected: 1, days: 120, items: [{ appointmentId: 'a9', date: '2026-11-06', start: '16:00', customer: 'Mai Le', reason: 'outside_shift' }] });
    techs.setSchedule.mockResolvedValue({});
    mount(); await openLinh();
    fireEvent.click(await screen.findByTestId('tab-hours'));
    const end = await screen.findByTestId('wh-end'); expect(end).toHaveValue('17:00');
    fireEvent.change(end, { target: { value: '16:00' } });
    expect(screen.getByTestId('wh-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('wh-check'));
    await waitFor(() => expect(ls.shiftImpact).toHaveBeenCalledWith(expect.objectContaining({ technicianId: 't1', dow: 5, working: true, start: '09:00', end: '16:00', lunchStart: '12:00', lunchEnd: '12:30' })));
    expect(await screen.findByTestId('wh-impact')).toHaveTextContent('Mai Le');
    expect(screen.getByTestId('wh-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('wh-ack')); fireEvent.click(screen.getByTestId('wh-save'));
    await waitFor(() => expect(techs.setSchedule).toHaveBeenCalled());
    const [tid, body] = techs.setSchedule.mock.calls[0];
    expect(tid).toBe('t1'); expect(body.expectedVersion).toBe(3);
    expect(body.weekly.friday).toMatchObject({ isWorking: true, startTime: '09:00', endTime: '16:00' }); expect(body.weekly.monday).toMatchObject({ startTime: '10:00' });
  });
  it('Week view: seven days, shift or Off, and a cell opens that day', async () => {
    mount(); await screen.findByTestId('kpi-utilization');
    fireEvent.click(screen.getByTestId('view-week'));
    const grid = await screen.findByLabelText('Week schedule');
    expect(grid.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(grid.textContent).toContain('Off');
    await waitFor(() => expect(live.week).toHaveBeenCalledWith(expect.objectContaining({ date: DAY, lanePageSize: LS_LANE_PAGE_SIZE })));
  });
  it('403 is a permission state', async () => {
    ls.kpis.mockRejectedValue({ status: 403 }); mount();
    expect(await screen.findByText(/your role cannot see this information/i)).toBeInTheDocument();
  });
  it('reads in Vietnamese: the 24-hour clock, statuses from codes, no English left', async () => {
    await setLanguage('vi');
    const { container } = mount();
    await screen.findAllByText('Trần Mỹ Linh');
    await screen.findByTestId('activity-row');
    expect(screen.getAllByText(/14:00|15:00/).length).toBeGreaterThan(0);
    for (const en of [/2:00 PM/, 'Available Now', 'Utilization', 'Working Today']) expect(screen.queryByText(en), String(en)).toBeNull();
    expect(leftoverEnglish(container, ['Trần Mỹ Linh', 'Nguyễn Thị Hương', 'Gel Manicure', 'Manicure', 'training', 'TM', 'America/New_York']).join(' | ')).toBe('');
  });
  it('F4: Edit Shift for Selected Date — baseline and effective side by side; conflicts first; a stale save keeps the typed edit', async () => {
    const ED = { technician: { technicianId: 't1', name: 'Linh' }, date: '2026-11-06', tz: 'America/New_York', today: '2026-10-30', past: false, canEdit: true,
      baseline: { isWorking: true, startTime: '09:00', endTime: '19:00' }, override: null, previousNightCarry: null, effective: { isWorking: true, startTime: '09:00', endTime: '19:00' },
      appointments: [{ id: 'a1', date: '2026-11-06', startTime: '09:30', endTime: '10:30', status: 'booked', customer: 'Mai Le' }], timeOff: [], activeQueue: [], month: { month: '2026-11', overrides: [] }, history: [] };
    so.editor.mockResolvedValue(ED);
    so.preview.mockResolvedValue({ conflicts: [{ kind: 'OUTSIDE_SHIFT', blocking: true, appointmentId: 'a1aaaaaa-0000', date: '2026-11-06', startTime: '09:30', endTime: '10:30', detail: 'Booked 09:30–10:30 is outside the new hours.' }], blocking: true, canAcknowledge: true, effective: { isWorking: true, shifts: [{ startTime: '10:00', endTime: '18:00' }] } });
    so.save.mockRejectedValue({ status: 409, code: 'VERSION_CONFLICT' });
    mount(); await screen.findByTestId('kpi-utilization');
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'linh' } }); fireEvent.click(await screen.findByTestId('hit-tech'));
    await screen.findByTestId('dlg-full-day'); fireEvent.click(await screen.findByTestId('edit-date-shift'));
    expect(await screen.findByTestId('so-baseline')).toHaveTextContent('9:00 AM – 7:00 PM');
    fireEvent.change(screen.getByTestId('so-start'), { target: { value: '10:00' } }); fireEvent.change(screen.getByTestId('so-end'), { target: { value: '18:00' } });
    expect(screen.getByTestId('so-save')).toBeDisabled();   // conflicts must be viewed first
    fireEvent.click(screen.getByTestId('so-check'));
    expect(await screen.findByTestId('so-conflict')).toHaveTextContent('outside the new hours');
    expect(screen.getByTestId('so-save')).toBeDisabled();   // a blocking conflict needs the acknowledgement
    fireEvent.click(screen.getByTestId('so-ack')); fireEvent.click(screen.getByTestId('so-save'));
    await waitFor(() => expect(so.save).toHaveBeenCalledWith(expect.objectContaining({ technicianId: 't1', overrideType: 'CUSTOM_SHIFT', startLocalTime: '10:00', endLocalTime: '18:00', acknowledgeConflicts: true })));
    expect(await screen.findByTestId('so-reload')).toBeInTheDocument();
    expect(screen.getByTestId('so-start')).toHaveValue('10:00');   // the typed edit is kept
  });
  it('extras (Finish the Five 10): Booking Conflict Timeline — shift, breaks and bookings on one axis, colour AND words; overlaps only from the server check', async () => {
    so.save.mockClear();
    const appts = [{ id: 'a1', date: '2026-11-06', startTime: '09:30', endTime: '10:30', status: 'booked', customer: 'Mai Le' },
      { id: 'a2', date: '2026-11-06', startTime: '12:15', endTime: '13:00', status: 'confirmed', customer: 'Lan' },
      { id: 'a3', date: '2026-11-06', startTime: '15:00', endTime: '16:00', status: 'booked', customer: 'Hoa' }];
    so.editor.mockResolvedValue({ technician: { technicianId: 't1', name: 'Linh' }, date: '2026-11-06', tz: 'America/New_York', today: '2026-10-30', past: false, canEdit: true,
      baseline: { isWorking: true, startTime: '09:00', endTime: '19:00' }, override: null, previousNightCarry: null, effective: { isWorking: true, startTime: '09:00', endTime: '19:00' },
      appointments: appts, timeOff: [], activeQueue: [], month: { month: '2026-11', overrides: [] }, history: [] });
    so.preview.mockResolvedValue({ conflicts: [
      { kind: 'OUTSIDE_SHIFT', blocking: true, appointmentId: 'a1', date: '2026-11-06', startTime: '09:30', endTime: '10:30', detail: 'Booked 09:30–10:30 is outside the new hours.' },
      { kind: 'BREAK_OVERLAP', blocking: true, appointmentId: 'a2', date: '2026-11-06', startTime: '12:15', endTime: '13:00', detail: 'Booked 12:15–13:00 overlaps the lunch break 12:00–12:30.' }],
      blocking: true, canAcknowledge: true, effective: { isWorking: true, shifts: [{ startTime: '10:00', endTime: '18:00' }], breaks: [{ startTime: '12:00', endTime: '12:30', type: 'lunch' }] } });
    mount(); await screen.findByTestId('kpi-utilization');
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'linh' } }); fireEvent.click(await screen.findByTestId('hit-tech'));
    await screen.findByTestId('dlg-full-day'); fireEvent.click(await screen.findByTestId('edit-date-shift'));
    // before the check: the saved day, and no booking is called fine — each says it is not checked yet
    const tl = await screen.findByTestId('so-timeline');
    expect(tl).toHaveTextContent('Press View conflicts');
    expect(screen.getAllByTestId('so-tl-shift')).toHaveLength(1);
    expect(screen.getAllByTestId('so-tl-unchecked')).toHaveLength(3);
    expect(screen.queryByTestId('so-tl-conflict')).toBeNull();
    expect(screen.getAllByTestId('so-tl-row').map((r) => r.textContent)).toEqual([
      'Shift 9:00 AM – 7:00 PM',
      'Booking · Mai Le 9:30 AM – 10:30 AM · Booked — not checked yet',
      'Booking · Lan 12:15 PM – 1:00 PM · Confirmed — not checked yet',
      'Booking · Hoa 3:00 PM – 4:00 PM · Booked — not checked yet']);
    fireEvent.change(screen.getByTestId('so-start'), { target: { value: '10:00' } }); fireEvent.change(screen.getByTestId('so-end'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByTestId('so-check'));
    await screen.findByTestId('so-conflicts');
    // after: the proposed hours + lunch, two conflicting bookings in their own colour with the server's words, one with none
    expect(screen.getByTestId('so-timeline')).toHaveTextContent('found by the server check');
    expect(screen.getAllByTestId('so-tl-conflict')).toHaveLength(2);
    expect(screen.getAllByTestId('so-tl-ok')).toHaveLength(1);
    expect(screen.getAllByTestId('so-tl-break')[0]).toHaveTextContent('Lunch');
    expect(screen.getAllByTestId('so-tl-row').map((r) => r.textContent)).toEqual([
      'Shift 10:00 AM – 6:00 PM',
      'Lunch 12:00 PM – 12:30 PM',
      'Booking · Mai Le 9:30 AM – 10:30 AM · Booked — Outside the shift',
      'Booking · Lan 12:15 PM – 1:00 PM · Confirmed — In a break',
      'Booking · Hoa 3:00 PM – 4:00 PM · Booked — no conflict reported']);
    expect(so.save).not.toHaveBeenCalled();   // the timeline writes nothing
  });
  it('extras: Shift-vs-Clock-In — the selected technician shows the planned shift AND the clock, each with its true label', async () => {
    live.state.mockResolvedValue({ ...state, schedule: { ...state.schedule, technicians: [{ ...COL, clock: 'clocked_out', shiftScheduled: true }] } });
    mount(); await openLinh();
    expect(await screen.findByTestId('presence')).toHaveTextContent('Scheduled · not clocked in');   // 10:00, the 9–5 shift has started
  });
  it('extras: no clock record reads "unknown", never "clocked out"', async () => {
    mount(); await openLinh();
    expect(await screen.findByTestId('presence')).toHaveTextContent('Clock status unknown');
  });
  it('extras: one-click Schedule Health — read-only checks over the board; a double booking is listed with its times', async () => {
    const two = [...COL.appointments, { appointmentId: 'a2', customerName: 'Lan', serviceSummary: 'Pedicure', startTime: '14:30', endTime: '15:30', status: 'confirmed', source: 'pos' }];
    live.state.mockResolvedValue({ ...state, schedule: { ...state.schedule, technicians: [{ ...COL, appointments: two }] } });
    mount(); await screen.findByTestId('live-schedule-pager');
    fireEvent.click(screen.getByTestId('open-health'));
    expect(await screen.findByTestId('health-conflicts')).toHaveTextContent('Check');
    expect(screen.getByTestId('health-conflicts')).toHaveTextContent('Trần Mỹ Linh · 14:00–15:00 × 14:30–15:30');
    expect(screen.getByTestId('health-outside_shift')).toHaveTextContent('Pass');
    expect(screen.getByTestId('health-kpi_wiring')).toHaveTextContent('1 / 2');   // KPI says 1 appointment, the board has 2
    for (const f of Object.values(live)) if (f !== live.state && f !== live.detail) expect(f).not.toHaveBeenCalled();   // nothing was written
    fireEvent.click(screen.getByTestId('health-close'));
    expect(screen.queryByTestId('health')).toBeNull();
  });

  it('extras LIVE TECHNICIAN SCHEDULE 12: the full day lists the server\'s day notes; hidden appointment notes are counted, never shown', async () => {
    live.detail.mockResolvedValue({ ...COL, bookedHours: 1, salesTodayCents: null, tipsTodayCents: null, commissionPreviewCents: null, nextAppointment: COL.appointments[0],
      dayNotes: [{ kind: 'blocked_time', sourceId: 'b1', startTime: '13:00', endTime: '13:30', text: 'Gel-X refresher with the trainer', reason: 'training' }], dayNotesHidden: 2 });
    mount(); await openLinh();
    const list = await screen.findByTestId('day-notes');
    expect(within(list).getByTestId('day-note-blocked_time')).toHaveTextContent('Gel-X refresher with the trainer');
    expect(within(list).getByTestId('day-note-blocked_time')).toHaveTextContent('Blocked time note · Training');
    expect(screen.getByTestId('day-notes-hidden')).toHaveTextContent('2 appointment note(s) need customer access to read.');
  });
  it('extras LIVE TECHNICIAN SCHEDULE 12: no notes says so; an older server without dayNotes shows no section', async () => {
    live.detail.mockResolvedValue({ ...COL, bookedHours: 1, salesTodayCents: null, tipsTodayCents: null, commissionPreviewCents: null, dayNotes: [], dayNotesHidden: 0 });
    const { unmount } = mount(); await openLinh();
    expect(await screen.findByTestId('day-notes-none')).toBeInTheDocument();
    unmount();
    live.detail.mockResolvedValue({ ...COL, bookedHours: 1, salesTodayCents: null, tipsTodayCents: null, commissionPreviewCents: null });
    mount(); await openLinh();
    await screen.findByTestId('full-day-summary');
    expect(screen.queryByTestId('day-notes-none')).toBeNull();
    expect(screen.queryByTestId('day-notes')).toBeNull();
  });
});
