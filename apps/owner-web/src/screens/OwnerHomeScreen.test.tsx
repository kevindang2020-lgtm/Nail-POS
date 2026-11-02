// OwnerHomeScreen (owner dashboard, read-only): hero revenue + trend, context tiles (Locations/Staff/Services Today),
// live ops tiles (Check-ins/Waiting/Active Services/Ready to Checkout), Quick Actions, the 7-day chart, and the
// self-contained End-of-Day Cash card. Verifies tile rendering + money formatting, ops/Quick-Action navigation, a
// friendly 403 with Retry, and the cash card (shows with activity / taps through). Data is typed from /owner/dashboard/state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ openBookings: vi.fn(), openCashHandoff: vi.fn(), go: vi.fn(), openInventory: vi.fn(), openAlerts: vi.fn(), openPayroll: vi.fn(), openMarketing: vi.fn(), openTechDetail: vi.fn(), openNotifications: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => nav }));
vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined, selection: { mode: 'single' }, branches: [{ branchId: 'b1' }, { branchId: 'b2' }, { branchId: 'b3' }] as any, setSelection: vi.fn() }) }));
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: () => {} }));
vi.mock('./SalonOverviewCards', () => ({ SalonOverviewCards: () => <div data-testid="salon-cards" /> }));
vi.mock('./OwnerBranchHealthCard', () => ({ OwnerBranchHealthCard: ({ branchId }: any) => <div data-testid="branch-health-card" data-branch={branchId ?? ''} /> }));
vi.mock('../api/ownerApi', () => ({
  ownerDashboardApi: { state: vi.fn() },
  ownerSalonsApi: { overview: vi.fn() },
  ownerContextApi: { select: vi.fn() },
  ownerActivityApi: { view: vi.fn().mockResolvedValue(undefined) },
  ownerCashHandoffApi: { state: vi.fn() },
  ownerAttentionApi: { get: vi.fn().mockResolvedValue({ payrollToApprove: 0, payrollToLock: 0, lowStock: 0, outOfStock: 0, openAlerts: 0, generatedAt: '' }) },
  ownerStaffApi: { performance: vi.fn() },
  ownerBookingsApi: { drillDown: vi.fn() },
}));

import { ownerDashboardApi, ownerCashHandoffApi, ownerAttentionApi, ownerStaffApi, ownerBookingsApi } from '../api/ownerApi';
import { OwnerHomeScreen } from './OwnerHomeScreen';

const dash = (over: any = {}) => ({
  owner: { firstName: 'Kevin', fullName: 'Kevin Tran' }, date: '2026-06-17', context: { currency: 'USD' }, unreadNotificationCount: 3,
  todayRevenueCents: 475000, todayRevenueTrendPercent: 12.5,
  weeklyRevenueCents: 2850000, weeklyRevenueTrendPercent: 8.0,
  totalBookings: 42, totalBookingsTrendPercent: -3.0,
  activeTechnicians: 5, scheduledTechnicians: 6,
  averageTicketCents: 6500, averageTicketTrendPercent: 2.0,
  tipsTodayCents: 48000, tipsTrendPercent: 5.0,
  newClients: 7, newClientsTrendPercent: 15.0,
  servicesToday: 42, checkInsToday: 156, waitingNow: 18, servingNow: 36, readyToCheckout: 14,
  revenueTrend: [300000, 350000, 280000, 410000, 390000, 500000, 480000].map((c, i) => ({ date: `2026-06-1${i}`, revenueCents: c })), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (ownerDashboardApi.state as any).mockResolvedValue(dash());
  (ownerCashHandoffApi.state as any).mockResolvedValue({ businessDate: '2026-06-17', technicianCount: 0, technicians: [], totalExpectedCents: 0, reconciledCount: 0, openCount: 0 });
  // Supporting home cards default to empty → they render null and never touch the assertions of the tests above.
  (ownerStaffApi.performance as any).mockResolvedValue({ topTechnicians: [] });
  (ownerBookingsApi.drillDown as any).mockResolvedValue([]);
});

describe('OwnerHomeScreen', () => {
  it('renders the hero revenue, the context tiles and the live ops tiles', async () => {
    render(<OwnerHomeScreen />);
    expect(await screen.findByText('$4,750.00')).toBeInTheDocument();          // today's revenue
    expect(screen.getByText('▲ 12.5% vs Yesterday')).toBeInTheDocument();      // hero trend (up)
    expect(screen.getByText('Kevin Tran')).toBeInTheDocument();
    expect(screen.getByText('$65.00')).toBeInTheDocument();                   // average ticket
    // context row + live ops tiles (matching the reference one-pager)
    for (const label of ['Locations', 'Staff on Duty', 'Services Today', 'Check-ins', 'Waiting Guests', 'Active Services', 'Ready to Checkout', 'Quick Actions']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('156')).toBeInTheDocument();                       // check-ins
    expect(screen.getByText('18')).toBeInTheDocument();                        // waiting guests
    expect(screen.getByText('14')).toBeInTheDocument();                        // ready to checkout
  });

  it('the bell opens the Notifications screen (developer merge, Oct 6 2026 — it did nothing)', async () => {
    render(<OwnerHomeScreen />);
    await screen.findByText('$4,750.00');
    fireEvent.click(screen.getByLabelText('Alerts & notifications'));
    expect(nav.openNotifications).toHaveBeenCalled();
  });
  it('routes the ops tiles to Live and the Quick Actions to their destinations', async () => {
    render(<OwnerHomeScreen />);
    await screen.findByText('$4,750.00');
    fireEvent.click(screen.getByText('Check-ins').closest('.owner-kpi') as HTMLElement);
    expect(nav.go).toHaveBeenCalledWith('live');
    fireEvent.click(screen.getByText('Approvals'));
    expect(nav.go).toHaveBeenCalledWith('approvals');
    fireEvent.click(screen.getByText('Payroll'));
    expect(nav.openPayroll).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Marketing'));
    expect(nav.openMarketing).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Reports'));
    expect(nav.go).toHaveBeenCalledWith('reports');
  });

  it('shows a Needs Attention strip with chips that open the right destinations', async () => {
    (ownerAttentionApi.get as any).mockResolvedValue({ payrollToApprove: 2, payrollToLock: 1, lowStock: 4, outOfStock: 2, openAlerts: 5, generatedAt: '' });
    render(<OwnerHomeScreen />);
    await screen.findByText('Needs attention');
    fireEvent.click(screen.getByText('approvals'));
    expect(nav.go).toHaveBeenCalledWith('approvals');
    fireEvent.click(screen.getByText('out of stock'));
    expect(nav.openInventory).toHaveBeenCalled();
    fireEvent.click(screen.getByText('alerts'));
    expect(nav.openAlerts).toHaveBeenCalled();
  });

  it('hides the Needs Attention strip when nothing needs attention', async () => {
    (ownerAttentionApi.get as any).mockResolvedValue({ payrollToApprove: 0, payrollToLock: 0, lowStock: 0, outOfStock: 0, openAlerts: 0, generatedAt: '' });
    render(<OwnerHomeScreen />);
    await screen.findByText('$4,750.00');
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
  });

  it('shows a friendly 403 with a working Retry', async () => {
    (ownerDashboardApi.state as any).mockRejectedValue({ status: 403 });
    render(<OwnerHomeScreen />);
    expect(await screen.findByText('You do not have access to this dashboard.')).toBeInTheDocument();
    (ownerDashboardApi.state as any).mockResolvedValue(dash());
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('$4,750.00')).toBeInTheDocument());
  });

  it('shows the End-of-Day Cash card when there is activity and taps through', async () => {
    (ownerCashHandoffApi.state as any).mockResolvedValue({ businessDate: '2026-06-17', technicianCount: 3, technicians: [{ status: 'reconciled' }, { status: 'discrepancy' }, { status: 'open' }], totalExpectedCents: 120000, reconciledCount: 1, openCount: 1 });
    render(<OwnerHomeScreen />);
    expect(await screen.findByText('End-of-Day Cash')).toBeInTheDocument();
    expect(screen.getByText('$1,200.00')).toBeInTheDocument();
    expect(screen.getByText('1 discrepancy')).toBeInTheDocument();
    fireEvent.click(screen.getByText('End-of-Day Cash').closest('[role="button"]') as HTMLElement);
    expect(nav.openCashHandoff).toHaveBeenCalled();
  });

  it('hides the End-of-Day Cash card when no technicians handled cash', async () => {
    render(<OwnerHomeScreen />);
    await screen.findByText('$4,750.00');
    expect(screen.queryByText('End-of-Day Cash')).not.toBeInTheDocument();
  });

  it('shows Top Technicians and Recent Appointments when there is activity, and taps through', async () => {
    (ownerStaffApi.performance as any).mockResolvedValue({ topTechnicians: [
      { technicianId: 't1', fullName: 'Dana Lee', roleLabel: 'Senior Tech', servicesCompleted: 9, salesCents: 82000, utilizationPercent: 71, rating: 4.8 },
    ] });
    (ownerBookingsApi.drillDown as any).mockResolvedValue([
      { appointmentId: 'a1', customerName: 'Jordan Pike', branchId: 'b1', technicianId: 't1', apptDate: '2026-06-17', startTime: '14:30:00', endTime: '15:15:00', status: 'checked_in', source: 'customer_app' },
    ]);
    render(<OwnerHomeScreen />);
    expect(await screen.findByText('Top Technicians')).toBeInTheDocument();
    expect(screen.getByText('Dana Lee')).toBeInTheDocument();
    expect(screen.getByText('$820.00')).toBeInTheDocument();                 // tech sales, integer cents
    expect(screen.getByText('Recent Appointments')).toBeInTheDocument();
    expect(screen.getByText('Jordan Pike')).toBeInTheDocument();
    expect(screen.getByText('2:30 PM')).toBeInTheDocument();                 // formatted start time

    fireEvent.click(screen.getByText('Dana Lee'));
    expect(nav.openTechDetail).toHaveBeenCalledWith('t1');
    const seeAll = screen.getAllByText('See all');
    fireEvent.click(seeAll[0]);                                              // Top Technicians → Staff tab
    expect(nav.go).toHaveBeenCalledWith('staff');
    fireEvent.click(seeAll[1]);                                              // Recent Appointments → Bookings
    expect(nav.openBookings).toHaveBeenCalled();
  });

  it('hides Top Technicians and Recent Appointments when there is no activity', async () => {
    render(<OwnerHomeScreen />);
    await screen.findByText('$4,750.00');
    expect(screen.queryByText('Top Technicians')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent Appointments')).not.toBeInTheDocument();
  });
});
