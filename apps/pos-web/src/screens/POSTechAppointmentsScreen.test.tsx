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
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
  it('reads in Vietnamese: the 24-hour clock, statuses from codes, no English left', async () => {
    await setLanguage('vi');
    const { container } = mount();
    await screen.findAllByText(/Nguyễn Thị Hương/);
    expect(screen.getAllByText(/14:30/).length).toBeGreaterThan(0);
    for (const en of [/2:30 PM/, /No-Show/]) expect(screen.queryByText(en), String(en)).toBeNull();
    expect(leftoverEnglish(container, ['Nguyễn Thị Hương', 'Mai Pham', 'Gel Manicure', 'Mia', 'MP', 'NH', 'M', '••• 1234', 'VIP']).join(' | ')).toBe('');
  });
});
