// POSTechAppointmentsScreen — the Tech Appointments rebuild (Oct 30 2026): the nine KPIs as filters, every module of the
// guide, the one search, the original appointment actions (assign / reschedule echo the row's version; a 409 shows the
// race message), a live event refetches in place, and Vietnamese (24-hour clock, statuses from codes, no English left).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
const { scr, ta, live, ci, rt } = vi.hoisted(() => ({
  scr: { kpis: vi.fn(), appointments: vi.fn(), week: vi.fn(), conflicts: vi.fn(), history: vi.fn() },
  ta: { state: vi.fn(), appointment: vi.fn(), noShow: vi.fn(), startService: vi.fn(), assignTechnician: vi.fn(), reschedule: vi.fn(), cancel: vi.fn() },
  live: { board: vi.fn(), detail: vi.fn() },
  ci: { appointmentCheckIn: vi.fn() },
  rt: { cb: null as null | (() => void) },
}));
vi.mock('../api/posTeamScreensApi', () => ({ posTechAppointmentsScreenApi: scr, posTechniciansScreenApi: { directory: vi.fn(async () => ({ items: [{ technicianId: 't1', name: 'Mia' }, { technicianId: 't2', name: 'Leo' }], page: 1, pageSize: 100, totalItems: 2, totalPages: 1 })) } }));
vi.mock('../api/posTechAppointmentsApi', () => ({ posTechAppointmentsApi: ta }));
vi.mock('../api/posLiveTechnicianScheduleApi', () => ({ posLiveTechnicianScheduleApi: live }));
vi.mock('../api/posCheckInApi', () => ({ posCheckInApi: ci }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: (_s: string[], cb: () => void) => { rt.cb = cb; } }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
vi.mock('../components/TechnicianPickerButton', () => ({ TechnicianPickerButton: ({ ariaLabel, onChange }: any) => <button type="button" aria-label={ariaLabel} onClick={() => onChange('t2')}>pick</button> }));
import { POSTechAppointmentsScreen } from './POSTechAppointmentsScreen';

const DAY = '2026-10-30';
const period = { preset: 'today', from: DAY, to: DAY, tz: 'America/New_York', today: DAY };
const page = (items: unknown[]) => ({ period, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 });
const K = { today: 2, booked: 1, checkedIn: 0, inService: 0, completed: 0, cancelled: 0, noShows: 1, online: 1, conflicts: 1 };
const ROW = { appointmentId: 'a1', customer: 'Nguyễn Thị Hương', phone: '••• 1234', matchedVia: null, services: ['Gel Manicure'], online: true, source: 'online', technician: 'Mia', technicianId: 't1', anyTechnician: false,
  date: DAY, start: '14:30', end: '15:15', minutes: 45, status: 'confirmed', conflict: true, version: 4, vip: false };
const DETAIL = { appointmentId: 'a1', customerName: 'Nguyễn Thị Hương', date: DAY, startTime: '14:30', endTime: '15:15', durationMinutes: 45, status: 'booked', technicianId: 't1', source: 'online', services: [{ serviceId: 's1', serviceName: 'Gel Manicure' }], version: 4 };
beforeEach(() => {
  for (const g of [scr, ta, live, ci]) Object.values(g).forEach((f) => (f as any).mockReset());
  scr.kpis.mockResolvedValue({ date: DAY, today: DAY, tz: 'America/New_York', nowMinute: 600, kpis: K });
  scr.appointments.mockResolvedValue(page([ROW, { ...ROW, appointmentId: 'a2', customer: 'Mai Pham', start: '16:00', end: '16:45', status: 'no_show', conflict: false, online: false, source: 'walk_in' }]));
  scr.history.mockResolvedValue(page([{ id: 'h1', at: `${DAY}T14:00:00Z`, changeType: 'rescheduled', field: 'start_time', oldValue: '09:30', newValue: '10:30', customer: 'Mai Pham', technician: 'Mia', apptDate: DAY, apptStart: '10:30', actor: null }]));
  scr.week.mockResolvedValue({ days: [DAY], technicians: [], page: 1, pageSize: 12, totalItems: 0, totalPages: 1 });
  ta.state.mockResolvedValue({ technicians: [{ technicianId: 't1', displayName: 'Mia', workingStatus: 'available', appointmentCount: 1, scheduledMinutes: 45, availableMinutes: 400, serviceSkillGroups: [] }], appointments: [], lanes: { page: 1, pageSize: 12, total: 1, totalPages: 1, totalAll: 1 } });
  ta.appointment.mockResolvedValue(DETAIL);
  live.board.mockResolvedValue({ technicians: [] });
});
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });
const mount = () => render(<MemoryRouter><POSTechAppointmentsScreen /></MemoryRouter>);

describe('POSTechAppointmentsScreen', () => {
  it('the nine KPIs, every module, and a KPI filters the list', async () => {
    mount();
    expect(await screen.findByTestId('kpi-conflicts')).toHaveTextContent('1');
    for (const t of ['kpi-today', 'kpi-booked', 'kpi-checkedIn', 'kpi-inService', 'kpi-completed', 'kpi-cancelled', 'kpi-noShows', 'kpi-online', 'tech-cards', 'board', 'appointments-list', 'conflict-warning', 'next-available', 'history', 'ta-lane-pager'])
      expect(screen.getByTestId(t)).toBeInTheDocument();
    expect(await screen.findAllByTestId('appt-row')).toHaveLength(2);
    expect(await screen.findAllByTestId('history-row')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('kpi-conflicts'));
    await waitFor(() => expect(scr.appointments).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'conflict', page: 1 })));
    expect(ta.state).toHaveBeenCalledWith(expect.objectContaining({ lanePageSize: 12, roster: 'none' }));
  });
  it('one search goes to the server', async () => {
    mount(); await screen.findAllByTestId('appt-row');
    fireEvent.change(screen.getByTestId('search'), { target: { value: '(856) 555-1234' } });
    await waitFor(() => expect(scr.appointments).toHaveBeenLastCalledWith(expect.objectContaining({ q: '(856) 555-1234' })));
  });
  it('assign sends expectedVersion; a VERSION_CONFLICT shows the race message and keeps the dialog', async () => {
    ta.assignTechnician.mockRejectedValue({ status: 409, code: 'VERSION_CONFLICT', message: 'stale' });
    mount(); fireEvent.click((await screen.findAllByTestId('appt-details'))[0]);
    await screen.findByTestId('dlg-appointment');
    fireEvent.click(screen.getByLabelText('Choose technician…'));
    fireEvent.click(screen.getByTestId('act-assign'));
    expect(await screen.findByTestId('appt-error')).toHaveTextContent(/just booked or changed on another device/);
    expect(ta.assignTechnician).toHaveBeenCalledWith('a1', { technicianId: 't2', expectedVersion: 4 });
  });
  it('reschedule opens on the appointment date/time and posts HH:MM with the date and version', async () => {
    ta.reschedule.mockResolvedValue({});
    mount(); fireEvent.click((await screen.findAllByTestId('appt-details'))[0]);
    const when = (await screen.findByTestId('resched-when')) as HTMLInputElement;
    expect(when.value).toBe(`${DAY}T14:30`);
    fireEvent.change(when, { target: { value: '2026-10-31T10:30' } });
    fireEvent.click(screen.getByTestId('act-reschedule'));
    await waitFor(() => expect(ta.reschedule).toHaveBeenCalledWith('a1', { startTime: '10:30', date: '2026-10-31', expectedVersion: 4 }));
  });
  it('the detail falls back to the list row when its route fails', async () => {
    ta.appointment.mockRejectedValue({ status: 404 });
    mount(); fireEvent.click((await screen.findAllByTestId('appt-details'))[0]);
    expect(await screen.findByTestId('dlg-appointment')).toBeInTheDocument();
    expect(screen.getByTestId('act-check-in')).toBeInTheDocument();
  });
  it('a live appointment event refetches in place', async () => {
    mount(); await screen.findAllByTestId('appt-row');
    const before = scr.appointments.mock.calls.length;
    await act(async () => { rt.cb?.(); });
    await waitFor(() => expect(scr.appointments.mock.calls.length).toBeGreaterThan(before));
  });
  it('403 is a permission state', async () => {
    scr.kpis.mockRejectedValue({ status: 403 }); mount();
    expect(await screen.findByText(/your role cannot see this information/i)).toBeInTheDocument();
  });
  it('reads in Vietnamese: the 24-hour clock, statuses from codes, no English left', async () => {
    await setLanguage('vi');
    const { container } = mount();
    await screen.findAllByText(/Nguyễn Thị Hương/);
    expect(screen.getAllByText(/14:30/).length).toBeGreaterThan(0);
    for (const en of [/2:30 PM/, /No-Show/]) expect(screen.queryByText(en), String(en)).toBeNull();
    expect(leftoverEnglish(container, ['Nguyễn Thị Hương', 'Mai Pham', 'Gel Manicure', 'Mia', 'MP', 'NH', 'M', '••• 1234', 'VIP', 'pick', 'America/New_York']).join(' | ')).toBe('');
  });
});

describe('Tech Appointments — exact-time tooltip (extras #06)', () => {
  it('the When cell carries the exact scheduled start – end and length; an unknown end shows "—", never a guess', async () => {
    scr.appointments.mockResolvedValue(page([ROW, { ...ROW, appointmentId: 'a3', end: null, minutes: 30 }]));
    mount();
    const cells = await screen.findAllByTestId('appt-when');
    expect(cells[0].getAttribute('title')).toBe('2026-10-30 · scheduled 2:30 PM – 3:15 PM (45 min)');
    expect(cells[1].getAttribute('title')).toBe('2026-10-30 · scheduled 2:30 PM – — (30 min)');
  });
});

describe('Tech Appointments — availability confidence (extras #02)', () => {
  it('shows when the numbers were last verified; a failed refresh says the shown numbers are stale instead of zeroing them', async () => {
    mount();
    expect(await screen.findByTestId('ta-fresh')).toHaveTextContent(/^Numbers updated /);
    scr.kpis.mockRejectedValue(new Error('network'));
    fireEvent.click(screen.getByTestId('refresh'));
    await waitFor(() => expect(screen.getByTestId('ta-fresh')).toHaveTextContent(/^Refresh failed — the last good numbers are from /));
  });
});

describe('Tech Appointments — pending verification (extras #08)', () => {
  it('online bookings waiting on the SMS code are listed as NOT booked (KPIs untouched); an appointment says how its phone was proven', async () => {
    scr.kpis.mockResolvedValue({ date: DAY, today: DAY, tz: 'America/New_York', nowMinute: 600, kpis: K, pendingVerification: { count: 2, items: [
      { holdId: 'h1', start: '15:00', end: '15:45', technicianId: 't1', technician: 'Mia', verification: 'sent', phone: '•••• 7788', channel: 'online', codeSentAt: null, holdExpiresAt: null },
      { holdId: 'h2', start: '15:30', end: '16:15', technicianId: null, technician: null, verification: 'locked', phone: null, channel: 'online', codeSentAt: null, holdExpiresAt: null }] } });
    scr.appointments.mockResolvedValue(page([{ ...ROW, phoneVerification: 'staff_override' }, { ...ROW, appointmentId: 'a2', phoneVerification: null }]));
    mount();
    const box = await screen.findByTestId('pending-verification');
    expect(box).toHaveTextContent("2 online booking(s) waiting for the customer's SMS code");
    expect(box).toHaveTextContent('Not booked yet');
    expect(screen.getAllByTestId('pv-item').map((n) => n.textContent)).toEqual(['3:00 PM–3:45 PM · Mia · •••• 7788 Code sent — waiting', '3:30 PM–4:15 PM · Any technician Too many wrong codes']);
    expect(screen.getByTestId('kpi-today')).toHaveTextContent('2');
    expect((await screen.findAllByTestId('appt-phone-proof')).map((n) => n.textContent)).toEqual(['Phone confirmed by staff']);
  });
  it('nothing pending → no strip', async () => {
    mount();
    await screen.findAllByTestId('appt-row');
    expect(screen.queryByTestId('pending-verification')).toBeNull();
  });
  // extras round 10 (agent 5): TECH APPOINTMENTS 03 / 04 / 10
  it('03: each technician card says why it reads as it does (recorded status and when, or none recorded) and opens the appointment being served', async () => {
    ta.state.mockResolvedValue({ technicians: [
      { technicianId: 't1', displayName: 'Mia', workingStatus: 'in_service', appointmentCount: 1, scheduledMinutes: 45, availableMinutes: 400, serviceSkillGroups: [], statusWhy: { source: 'technician_status', since: `${DAY}T14:05:00Z`, recorded: 'in_service', servingAppointmentId: 'a1' } },
      { technicianId: 't2', displayName: 'Leo', workingStatus: 'available', appointmentCount: 0, scheduledMinutes: 0, availableMinutes: 400, serviceSkillGroups: [], statusWhy: { source: 'not_recorded', since: null, recorded: null, servingAppointmentId: null } }],
      appointments: [], lanes: { page: 1, pageSize: 12, total: 2, totalPages: 1 } });
    mount();
    const why = await screen.findAllByTestId('tech-status-why');
    expect(why[0]).toHaveTextContent(/set /); expect(why[1]).toHaveTextContent('No status recorded today — shown as Available');
    fireEvent.click(screen.getByTestId('tech-serving'));
    await waitFor(() => expect(ta.appointment).toHaveBeenCalledWith('a1'));
  });
  it('04: the gap finder highlights open gaps at least as long as the chosen service and lists them; shorter gaps are dimmed', async () => {
    live.board.mockResolvedValue({ technicians: [{ technicianId: 't1', fullName: 'Mia', status: 'available', shift: { startTime: '09:00', endTime: '17:00' }, appointments: [], blocks: [],
      openSlots: [{ slotId: 't1:540', startTime: '09:00', endTime: '09:30', durationMinutes: 30 }, { slotId: 't1:600', startTime: '10:00', endTime: '11:30', durationMinutes: 90 }] }] });
    mount();
    fireEvent.change(await screen.findByTestId('gap-len'), { target: { value: '60' } });
    expect(await screen.findByTestId('gap-count')).toHaveTextContent('1 open gap(s) of at least 60 min · Mia 10:00 AM–11:30 AM');
    expect(screen.getAllByTestId('gap-fit')).toHaveLength(1);
    expect(screen.getAllByTestId('gap-short')).toHaveLength(1);
    fireEvent.change(screen.getByTestId('gap-len'), { target: { value: '120' } });
    expect(await screen.findByTestId('gap-count')).toHaveTextContent('No open gap of 120 min or longer today');
  });
  it('10: a change recorded with its reason shows the reason in Recent booking changes', async () => {
    scr.history.mockResolvedValue(page([{ id: 'h2', at: `${DAY}T15:00:00Z`, changeType: 'status_changed', field: 'status', oldValue: 'booked', newValue: 'cancelled', reason: 'Customer called — flu', customer: 'Mai Pham', technician: 'Mia', apptDate: DAY, apptStart: '10:30', actor: 'Pat Owner' }]));
    mount();
    expect(await screen.findByTestId('history-reason')).toHaveTextContent('Reason: Customer called — flu');
  });
});
