// POSOverviewScreen.vi.test — English + Vietnamese POS mandate (WP-C1): the front desk's two command centres read in
// Vietnamese — Overview (Quick Actions from the glossary, status pills from codes, payment methods, the full-screen lists)
// and Live Operations (KPI sub-lines, card footers, AI insights written from their code + numbers, the weekday axis) — with
// no English left in what staff read. Data the salon typed (names, services) stays as typed. And a switch back to English
// re-labels in place.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';

vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'OWNER' } }) }));
vi.mock('../shell/tenant-access', async (orig) => ({ ...(await orig<any>()), useTenantNavAccess: () => ({ aiPackages: ['ai_insights'] }) }));

import { POSOverviewScreen } from './POSOverviewScreen';
import { POSDashboardScreen } from './POSDashboardScreen';

const appt = (id: string, name: string, status: string, startTime: string) => ({ appointmentId: id, customerName: name, serviceNames: ['Gel Manicure'], startTime, status, source: 'online', amountCents: 4500, durationMinutes: 45 });
const overview = {
  context: { salonName: 'Lotus Nails', branchName: 'Main', businessDate: '2026-10-27' },
  kpis: {
    todayRevenue: { amountCents: 120000, displayAmount: '$1,200.00', changePercent: 12 }, todayCheckIns: { count: 9, changePercent: 5 }, walkInsToday: { count: 3 },
    averageTicket: { amountCents: 6000, displayAmount: '$60.00', changePercent: 0 }, waitingGuests: { count: 2 }, servingNow: { count: 3 }, readyCheckout: { count: 1 },
    activeTechs: { active: 4, scheduled: 5 },
  },
  schedulePreview: { technicians: [{ technicianId: 't1', name: 'Trần Mỹ Linh', appointments: [appt('a1', 'Nguyễn Thị Hương', 'arrived', '2026-10-27T14:00:00Z'), appt('a2', 'Mai Pham', 'confirmed', '2026-10-27T15:00:00Z'), appt('a3', 'Lan Vo', 'in_progress', '2026-10-27T13:30:00Z')] }] },
  todayAppointments: { total: 3, completed: 1, noShow: 0, cancelled: 0, remaining: 2 },
  walkInStatus: { waiting: 2, estimatedWaitMinutes: 15, checkedInNotAssigned: 1 },
  analytics: { revenueTrend: [{ date: '2026-10-26', revenueCents: 90000 }, { date: '2026-10-27', revenueCents: 120000 }], topTechnicians: [], paymentMix: [{ method: 'card', amountCents: 90000, percent: 75 }, { method: 'gift_card', amountCents: 30000, percent: 25 }], quickInsights: [] },
};
const board = { communications: { reminders: [{ customerName: 'Mai Pham', whenLabel: '3:00', channel: 'sms', status: 'sent' }], messages: [], missedCalls: [], missedCallsAvailable: false }, inventoryAlerts: [] };

const dash = {
  context: { salonName: 'Lotus Nails', branchName: 'Main' },
  kpis: { todayRevenueCents: 120000, todayRevenueTrendPercent: 0, waitingGuests: 2, servingNow: 3, readyCheckout: 1, activeTechs: 4, totalTechs: 5, onlineBookings: 1, monthlyCardVolumeCents: 900000, checkInsToday: 9, appointmentsToday: 6, averageTicketCents: 6000, customerRetentionPercent: 60, aiBookingConversionPercent: 30 },
  calendar: { appointments: [], technicians: [] },
  todaysAppointments: { totalAppointments: 6, completed: 1, noShow: 0, cancelled: 0, remaining: 5, completedPercent: 17 },
  walkInStatus: { waitingCount: 2, estimatedWaitMinutes: 15, checkedInNotAssigned: 1 },
  operationsSnapshot: { waitingGuests: 2, estWaitMinutes: 15, walkInsToday: 3, walkInPercent: 33, readyCheckout: 1, readyCheckoutValueCents: 4500, completedServices: 1, noShows: 0, noShowPercent: 0, upcomingNext3h: 2 },
  revenueTrend: { period: 'week', totalCents: 210000, trendPercent: 0, series: [{ label: 'Mon', date: '2026-10-26', valueCents: 90000, apptCount: 4 }, { label: 'Tue', date: '2026-10-27', valueCents: 120000, apptCount: 6 }] },
  topServices: [{ name: 'Gel Manicure', revenueCents: 90000 }], topTechnicians: [{ technicianId: 't1', name: 'Trần Mỹ Linh', revenueCents: 90000, servicesCount: 3, utilizationPercent: 80, tipsCents: 1000, rating: 4.9 }],
  paymentMix: { period: 'week', entries: [{ method: 'card', percent: 75, amountCents: 90000 }, { method: 'gift_card', percent: 25, amountCents: 30000 }] },
  liveActivity: [{ time: '2:33 PM', startedAt: '2026-10-27T18:33:00Z', guestName: 'Nguyễn Thị Hương', serviceName: 'Gel Manicure', technicianName: 'Trần Mỹ Linh', status: 'in_progress', elapsedMinutes: 25 }],
  customerRetention: { returningPercent: 60, returningCount: 30, newPercent: 30, newCount: 15, inactivePercent: 10, inactiveCount: 5, totalCustomers: 50 },
  multiLocation: [], quickInsights: [],
  aiInsights: [
    { id: 'peak_time', icon: 'peak', tone: 'info', primary: 'Peak time today: 1:00 PM - 3:00 PM', secondary: 'High demand for Gel Manicure.', vars: { fromHour: 13, toHour: 15, service: 'Gel Manicure' } },
    { id: 'rebooking', icon: 'rebook', tone: 'success', primary: '12 customers due for rebooking', secondary: 'Reach out to increase retention.', vars: { count: 12 } },
    { id: 'low_stock', icon: 'stock', tone: 'danger', primary: 'Low stock alert', secondary: '3 products running low.', action: { label: 'View Inventory', kind: 'inventory' }, vars: { count: 3 } },
  ],
};
const routed = (bodies: Record<string, unknown>, fallback: unknown) => vi.fn(async (url: string) => {
  const hit = Object.keys(bodies).find((k) => String(url).includes(k));
  const body = hit ? bodies[hit] : fallback;
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } } as any;
});

beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

const NAMES = ['Lotus Nails', 'Main', 'Nguyễn Thị Hương', 'Mai Pham', 'Lan Vo', 'Trần Mỹ Linh', 'Gel Manicure'];

describe('Overview in Vietnamese (WP-C1)', () => {
  it('Quick Actions use the glossary, status pills and payment methods are labelled, no English left', async () => {
    await setLanguage('vi');
    globalThis.fetch = routed({ '/pos/overview/board': board }, overview) as any;
    const { container } = render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Nguyễn Thị Hương').length).toBeGreaterThan(0));
    for (const vi of ['Thu tiền', 'Chỉ định thợ', 'Tiếp nhận khách mới', 'Mở ngăn kéo tiền', 'Thẻ quà tặng']) expect(screen.getAllByText(new RegExp(vi)).length, vi).toBeGreaterThan(0);
    for (const en of ['Take Payment', 'Assign Tech', 'New Check-in', 'Open Cash Drawer', 'gift card', 'arrived', 'confirmed']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
    // a full-screen list: headers and the open button
    fireEvent.click(screen.getAllByText('Xem tất cả')[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
  });

  it('switching back to English re-labels the same screen in place', async () => {
    await setLanguage('vi');
    globalThis.fetch = routed({ '/pos/overview/board': board }, overview) as any;
    // the app's route tree subscribes to the language (App.tsx POSRoutes) and re-creates the screen element — as here
    function Live() { useLanguage(); return <POSOverviewScreen />; }
    render(<MemoryRouter><Live /></MemoryRouter>);
    await screen.findByText('Thu tiền');
    await act(async () => { await setLanguage('en'); });
    expect(screen.getByText('Take Payment')).toBeInTheDocument();
    expect(screen.queryByText('Thu tiền')).toBeNull();
  });
});

describe('Live Operations in Vietnamese (WP-C1)', () => {
  it('KPI lines, card footers, AI insights (from their codes) and the weekday axis are Vietnamese', async () => {
    await setLanguage('vi');
    globalThis.fetch = routed({ '/inventory/alerts': { alerts: [] } }, dash) as any;
    const { container } = render(<MemoryRouter><POSDashboardScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Nguyễn Thị Hương').length).toBeGreaterThan(0));
    expect(screen.getByText('12 khách đến hạn đặt lịch lại')).toBeInTheDocument();
    expect(screen.getByText('Nhu cầu cao cho Gel Manicure.')).toBeInTheDocument();
    expect(screen.getByText('Xem tồn kho')).toBeInTheDocument();
    for (const en of ['12 customers due for rebooking', 'Low stock alert', 'View Inventory', 'View Leaderboard', 'per paid ticket', 'Mon', 'Tue']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
  });
});
