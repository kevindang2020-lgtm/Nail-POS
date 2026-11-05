// POSTechAppointmentsScreen.vi.test — English + Vietnamese POS mandate (WP-C1): Tech Appointments and the Live Technician
// Schedule read in Vietnamese — times in the 24-hour Vietnamese clock, statuses and booking sources from their codes, the
// technician detail tiles, booked hours — with no English left. Names / services the salon typed stay as typed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
import { POSTechAppointmentsScreen } from './POSTechAppointmentsScreen';
import { POSLiveTechnicianScheduleScreen } from './POSLiveTechnicianScheduleScreen';

vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } } as any);
const NAMES = ['Trần Mỹ Linh', 'Nguyễn Thị Hương', 'Mai Pham', 'Gel Manicure', 'Manicure', 'TM', 'NT', 'MP', 'TT', 'NH', 'VIP'];

const appts = {
  kpis: { totalAppointmentsToday: 2, bookedAppointments: 1, checkedInAppointments: 0, inServiceAppointments: 0, completedAppointments: 0, cancelledAppointments: 0, noShowAppointments: 1, onlineBookings: 1, aiBookings: 0, googleBookings: 0, conflictCount: 0 },
  date: '2026-06-07',
  technicians: [{ technicianId: 't1', displayName: 'Trần Mỹ Linh', workingStatus: 'available', appointmentCount: 2, scheduledMinutes: 120, availableMinutes: 360, serviceSkillGroups: [] }],
  appointments: [
    { appointmentId: 'a1', technicianId: 't1', customerName: 'Nguyễn Thị Hương', source: 'online', services: [{ serviceName: 'Gel Manicure' }], startTime: '14:30', endTime: '15:30', durationMinutes: 60, status: 'booked', depositStatus: 'pending', version: 1 },
    { appointmentId: 'a2', technicianId: 't1', customerName: 'Mai Pham', source: 'walk_in', services: [{ serviceName: 'Gel Manicure' }], startTime: '16:00', endTime: '17:00', durationMinutes: 60, status: 'no_show', version: 1 },
  ],
  filters: { statuses: [], sources: [], serviceCategories: [], technicians: [], branches: [] },
};
const board = {
  kpis: { workingToday: 1, availableNow: 0, inService: 1, onBreakOrLunch: 0, bookedHours: 1, utilizationPercent: 13 },
  schedule: { date: '2026-06-08', timeRange: { startTime: '09:00', endTime: '19:00', slotMinutes: 30 }, technicians: [
    { technicianId: 't1', fullName: 'Trần Mỹ Linh', initials: 'TM', roleLabel: 'Thợ chính', status: 'in_service', shift: { startTime: '09:00', endTime: '17:00' }, skills: ['Manicure'],
      appointments: [{ appointmentId: 'a1', customerName: 'Nguyễn Thị Hương', customerInitials: 'NH', serviceSummary: 'Gel Manicure', startTime: '14:00', endTime: '15:00', status: 'in_service', source: 'walk_in' }],
      openSlots: [], bookedHours: 1, utilizationPercent: 13 },
  ] },
  filters: { statuses: [], skills: [], technicians: [] },
};

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

describe('Tech Appointments / Live Technician Schedule in Vietnamese (WP-C1)', () => {
  it('Tech Appointments: the 24-hour clock, statuses and sources from codes — no English left', async () => {
    await setLanguage('vi');
    globalThis.fetch = vi.fn(async () => ok(appts)) as any;
    const { container } = render(<POSTechAppointmentsScreen />);
    await screen.findAllByText(/Nguyễn Thị Hương/);
    expect(screen.getAllByText(/14:30/).length).toBeGreaterThan(0);
    for (const en of [/2:30 PM/, /No-Show/, /online/]) expect(screen.queryByText(en), String(en)).toBeNull();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
  });

  it('Live Technician Schedule: the board and a technician\'s detail tiles are Vietnamese', async () => {
    await setLanguage('vi');
    globalThis.fetch = vi.fn(async (url: any) => ok(String(url).includes('/live-detail') ? { technicianId: 't1', fullName: 'Trần Mỹ Linh', status: 'in_service', shift: { startTime: '09:00', endTime: '17:00', breakStartTime: '12:00', breakEndTime: '12:30' }, utilizationPercent: 13, bookedHours: 1, salesTodayCents: 9500, tipsTodayCents: 1000, commissionPreviewCents: 4000, appointments: [], openSlots: [], blocks: [], skills: ['Manicure'], initials: 'TM', roleLabel: 'Thợ chính' } : board)) as any;
    const { container } = render(<MemoryRouter><POSLiveTechnicianScheduleScreen /></MemoryRouter>);
    const names = await screen.findAllByText('Trần Mỹ Linh');
    expect(screen.getAllByText(/1 giờ/).length).toBeGreaterThan(0);
    fireEvent.click(names[0]);
    await screen.findByText('Ca hôm nay');
    for (const en of ['Today shift', 'Lunch', 'Utilization', 'Sales', 'Commission', /9:00 AM/]) expect(screen.queryByText(en), String(en)).toBeNull();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
  });
});
