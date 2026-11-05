// Super-Admin Overview QA: the 1:1 /dashboard ("Overview") renders the platform KPI grid, Daily Operations Flow, the
// analytics row (Tenants-by-Status donut real), the performance row (Top-Performing Tenants + Live Queue real), the
// activity row (Recent Platform Activity + System Alerts real), Quick Actions, the At-a-Glance summary, and the honest
// "Not yet wired" footer — composing the overview state + the five platform module overviews (all mocked). Module-
// sourced values resolve asynchronously (Promise.allSettled), so those assertions wait.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useOverview = vi.fn();
vi.mock('../api/superAdminOverviewApi', () => ({ useOverviewAggregate: () => useOverview() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { fullName: 'Kevin Dang', role: 'SUPER_ADMIN' } }) }));

import { DashboardScreen } from './DashboardScreen';

const state = (over: any = {}) => ({
  kpis: { totalTenants: 2418, activeSalons: 1862, pendingApplications: 174, paymentSetupNeeded: 37, monthlyCardVolumeCents: 324_359_240, openSupportTickets: 128, systemHealthPercent: 99.98, systemHealthLabel: 'Good', trends: { totalTenants: 13.4, activeSalons: 12.7, monthlyCardVolume: 22.5, openSupportTickets: 6.1 } },
  monthlySalesVolume: [{ label: 'May 01', valueCents: 100000 }, { label: 'May 08', valueCents: 200000 }],
  tenantsByStatus: [{ status: 'active', label: 'Active', count: 1862, percent: 77.0 }, { status: 'suspended', label: 'Suspended', count: 52, percent: 2.1 }],
  recentAlerts: [{ id: 'a1', severity: 'error', title: 'High Server CPU Usage', message: 'Server 02 - 92%', ageLabel: '2m ago', to: '/alerts' }],
  hardwareSummary: { pending: 0, ordered: 0, delivered: 0, activated: 0, outstandingBalanceCents: 0, byType: { imac: 0, cloverFlex: 0, checkinDisplay: 0 } },
  topPerformingTenants: [{ rank: 1, tenantId: 't1', name: 'Glamour Studio', city: 'Houston', state: 'TX', monthlyVolumeCents: 31258400, growthPercent: 24.6 }],
  recentTenantApplications: [],
  hardwarePackageStatus: [],
  platformKpis: { activeUsers: 12746, totalLocations: 3317, technicians: 8924, customers: 1284741, totalAppointments: 1248, aiInteractions: 1284 },
  quickActionsPermissions: {},
  recentActivity: [{ id: 'e1', icon: 'activity', title: 'New branch registered', tenantName: 'Glamour Studio', message: 'Glow Studio', ageLabel: '2m ago', severity: 'success' }],
  blockers: [{ module: 'platformKpis.devices', reason: 'No device fleet feed wired yet.' }],
  generatedAt: '2026-06-17T00:00:00.000Z',
  ...over,
});
const mods = () => ({
  staff: { kpis: { totalTechnicians: 50, activeTechnicians: 312, tenantsWithStaff: 10, avgTechsPerTenant: 5 } },
  queue: { kpis: { waitingNow: 86, inServiceNow: 744, vipWaiting: 2, longestWaitMin: 24, salonsWithActiveQueue: 5 }, items: [{ queueItemId: 'q1', tenantId: 't1', tenantName: 'Glamour Studio', branchName: 'Downtown', customerName: 'Sarah J.', isVip: false, priority: 'normal', status: 'waiting', station: null, technicianName: null, checkedInAt: null, waitMinutes: 24 }], statusBreakdown: [] },
  checkin: { kpis: { activeNow: 10, completedToday: 100, sessionsToday: 932, totalSessions: 1000 } },
  memberships: { kpis: { totalMembers: 15000, activeMembers: 12846, activePctOfTotal: 85, newMembersThisMonth: 100, membershipRevenueCents: 38276600, revenueDeltaPct: 15.8, expiringSoon: 5, expiringWindowDays: 30, canceledThisMonth: 2, canceledDeltaPct: null } },
  loyalty: { kpis: { loyaltyMembers: 5000, pointsOutstanding: 100000, pointsRedeemed: 48712, activeRewards: 10, salonsWithLoyalty: 8 } },
  devices: { kpis: { totalDevices: 5642, online: 4812, offline: 830, paymentTerminals: 3000 } },
  payments: { kpis: { todayVolumeCents: 12876400, todayCount: 646, failedCount: 2148, refundCentsMonth: 1245600, tipsCents: 1284600 } },
  branches: { directory: [{ id: 'b1', name: 'Downtown', tenantName: 'Glamour Studio', status: 'active', staff: 8, todaysAppts: 98, revenueMtdCents: 1258400 }] },
  services: { topServices: [{ name: 'Hair Cut', bookings: 312, revenueCents: 1872000 }], kpis: { avgRating: 4.7, reviewCount: 100 } },
  appts: { rows: [{ id: 'ap1', startTime: new Date(Date.now() + 3600000).toISOString(), customerName: 'Emma Johnson', services: ['Hair Cut'], technicianName: null, status: 'confirmed', tenantName: 'Glamour Studio' }], byStatus: [{ status: 'completed', count: 689 }] },
});
const hookValue = (over: any = {}) => ({ data: state(), mods: mods(), loading: false, error: null, range: 'month', setRange: vi.fn(), reload: vi.fn(), ...over });

describe('Super-Admin Overview (1:1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the Overview title, real KPIs/donut/tables, and the honest footer', async () => {
    useOverview.mockReturnValue(hookValue());
    render(<MemoryRouter><DashboardScreen /></MemoryRouter>);
    // load anchor: a data-dependent KPI label (not the always-present h1)
    expect(await screen.findByText('Total Tenants')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Overview');
    expect(screen.getByText('Pending Approvals')).toBeInTheDocument();      // overview-sourced
    expect(screen.getByText('Active Memberships')).toBeInTheDocument();
    // module-sourced (resolve via Promise.allSettled)
    await waitFor(() => expect(screen.getAllByText('312').length).toBeGreaterThan(0)); // Active Technicians (+ At-a-Glance)
    await waitFor(() => expect(screen.getByText('Sarah J.')).toBeInTheDocument());      // Live Queue Monitor (queue)
    // platform devices/payments (resolve via Promise.allSettled)
    await waitFor(() => expect(screen.getAllByText('5,642').length).toBeGreaterThan(0)); // Active POS Devices (+ donut centers)
    expect(screen.getByText('$128,764.00')).toBeInTheDocument();                         // Today's Payment Volume
    // platform branches/services/appointments (resolve via Promise.allSettled)
    await waitFor(() => expect(screen.getByText('Emma Johnson')).toBeInTheDocument());    // Upcoming Appointments (appointments)
    expect(screen.getByText('Downtown')).toBeInTheDocument();                            // Branch Performance (branches-dashboard)
    expect(screen.getAllByText('Hair Cut').length).toBeGreaterThan(0);                   // Top Services (+ upcoming service)
    expect(screen.getAllByText('689').length).toBeGreaterThan(0);                        // Completed Services KPI (+ Service Done flow)
    expect(screen.getByText('4.7 / 5')).toBeInTheDocument();                             // CSAT (At-a-Glance, from service ratings)
    // sections present
    expect(screen.getByText('Daily Operations Flow')).toBeInTheDocument();
    expect(screen.getByText('Tenants by Status')).toBeInTheDocument();
    expect(screen.getByText('Top-Performing Tenants')).toBeInTheDocument();
    expect(screen.getAllByText('Glamour Studio').length).toBeGreaterThan(0); // top tenant row (+ live-queue salon)
    expect(screen.getByText('High Server CPU Usage')).toBeInTheDocument();  // System Alerts
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('At-a-Glance Summary (Today)')).toBeInTheDocument();
    expect(screen.getByText('Not yet wired to live data')).toBeInTheDocument();
  });

  it('surfaces an error with a retry control', async () => {
    useOverview.mockReturnValue(hookValue({ data: null, error: 'boom' }));
    render(<MemoryRouter><DashboardScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
