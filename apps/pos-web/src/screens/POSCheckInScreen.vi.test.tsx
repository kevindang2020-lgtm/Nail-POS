// POSCheckInScreen.vi.test — English + Vietnamese POS mandate (WP-C1): Check-In reads in Vietnamese — KPI cards, the live
// queue's status chips and actions, Front Desk Insights written from their code + numbers, the source mix from its codes,
// the Quick Check-In panel (sources, guest card) — with no English left in what staff read. Names stay as typed.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';

vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
import { POSCheckInScreen } from './POSCheckInScreen';

const state = {
  kpis: { todayCheckIns: 9, todayCheckInsTrendPercent: 12, waitingGuests: 2, estimatedWaitMinutes: 15, walkInsToday: 3, appointmentsArrived: 4, appointmentArrivalPercent: 80, readyForTech: 1, noShows: 0, techsAvailable: 3, customerReturnRate: 60 },
  arrivals: [
    { rowId: 'r1', customerId: 'c1', customerName: 'Nguyễn Thị Hương', phone: '555-0101', services: ['Gel Manicure'], technicianName: 'Trần Mỹ Linh', source: 'appointment', arrivalStatus: 'arrived', timeLabel: '2:30 PM' },
    { rowId: 'r2', customerId: 'c2', customerName: 'Mai Pham', phone: '555-0102', services: ['Pedicure'], source: 'walk_in', arrivalStatus: 'checked_in', timeLabel: '2:35 PM' },
  ],
  appointmentCheckIn: { upcoming: [{ appointmentId: 'u1', customerName: 'Lan Vo', serviceName: 'Gel Manicure', status: 'upcoming', timeLabel: '3:00 PM' }], arrived: [], noShow: [] },
  waiting: [{ queueItemId: 'q1', customerId: 'c2', customerName: 'Mai Pham', serviceName: 'Pedicure', status: 'waiting', waitedMinutes: 6, timeLabel: '2:35 PM' }],
  readyForAssignment: [],
  availableTechnicians: [{ technicianId: 't1', displayName: 'Trần Mỹ Linh', activeAssignments: 0, status: 'available' }],
  technicianPage: { page: 1, pageSize: 5, total: 4, totalPages: 1, totalAll: 4 },
  technicians: [], services: [{ serviceId: 's1', name: 'Gel Manicure', durationMinutes: 45 }],
  frontDeskInsights: [
    { id: 'peak', text: 'Peak arrival window around 2pm (5 check-ins).', severity: 'info', vars: { hour: 14, count: 5 } },
    { id: 'vip', text: '1 VIP guest(s) checked in today — ensure a premium experience.', severity: 'info', vars: { count: 1 } },
  ],
  sourceMix: [{ name: 'Walk-In', count: 3, pct: 33, source: 'walk_in' }, { name: 'Appointment', count: 6, pct: 67, source: 'appointment' }],
  arrivalTrend: [{ hour: 13, hourLabel: '1p', count: 2 }, { hour: 14, hourLabel: '2p', count: 5 }],
  customerType: { returning: 6, new: 3, vip: 1, returnRatePct: 60 },
  dailyPerformance: { checkInsCompleted: 9, noShowRatePct: 0, avgCheckInSeconds: 75, satisfaction: 4.8 },
};
const NAMES = ['Nguyễn Thị Hương', 'Trần Mỹ Linh', 'Mai Pham', 'Lan Vo', 'Gel Manicure', 'Pedicure', 'NT', 'MP', 'LV', 'TM'];   // + avatar initials
const fetchState = () => vi.fn(async (url: string) => {
  const body = String(url).includes('/pos/check-in/state') ? state : {};
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } } as any;
});
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

describe('Check-In in Vietnamese (WP-C1)', () => {
  it('KPIs, live queue, insights from their codes, source mix and the Quick Check-In panel: no English left', async () => {
    await setLanguage('vi');
    globalThis.fetch = fetchState() as any;
    const { container } = render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Nguyễn Thị Hương').length).toBeGreaterThan(0));
    expect(screen.getByText(/Khách đến đông nhất vào khoảng 14/)).toBeInTheDocument();
    expect(screen.getByText(/Hôm nay có 1 khách VIP đã tiếp nhận/)).toBeInTheDocument();
    for (const en of ['Peak arrival window', 'Walk-In', 'Appointment', 'Confirmed', 'Waiting', 'In Person', 'vs yesterday', 'ETA']) expect(screen.queryByText(new RegExp(`^${en}`)), en).toBeNull();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
    // the Quick Check-In "New Customer" tab: sources and the technician picker button
    fireEvent.click(screen.getByText('Khách mới'));
    expect(screen.getByRole('option', { name: 'Tại tiệm' })).toBeInTheDocument();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
  });
});
