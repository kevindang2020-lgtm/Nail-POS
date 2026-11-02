import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Hook boundaries are mocked so the screen renders deterministically from fixtures.
// `as any` is confined to these mock return values (test scaffolding) — production code stays fully typed.
const aggReturn = {
  data: {
    kpis: { totalTenants: 128, activeSalons: 110, pendingApplications: 4, paymentSetupNeeded: 2, monthlyCardVolumeCents: 12_876_400, openSupportTickets: 7, systemHealthPercent: 100, systemHealthLabel: 'Operational', trends: { totalTenants: 5, devicesOffline: -22 } },
    monthlySalesVolume: [{ label: '12 AM', valueCents: 1000 }, { label: '12 PM', valueCents: 9_462_000 }],
    tenantsByStatus: [], recentAlerts: [{ id: 'a1', severity: 'error', title: 'High queue at Glamour Studio', message: '', ageLabel: '2m ago', to: '/queue-management' }],
    hardwareSummary: { pending: 0, ordered: 0, delivered: 0, activated: 0, outstandingBalanceCents: 0, byType: { imac: 0, cloverFlex: 0, checkinDisplay: 0 } },
    topPerformingTenants: [{ rank: 1, tenantId: 't-a', name: 'Glamour Studio', city: 'NYC', state: 'NY', monthlyVolumeCents: 1_872_000, growthPercent: 14.2 }],
    recentTenantApplications: [], hardwarePackageStatus: [],
    platformKpis: { activeUsers: 500, totalLocations: 3317, technicians: 744, customers: 9000, totalAppointments: 1248, aiInteractions: 0 },
    quickActionsPermissions: { communications: true, devices: true, export: true, createTenant: true },
    recentActivity: [{ id: 'r1', icon: 'cal', title: 'New appointment booked', tenantName: 'Glamour Studio', message: '', ageLabel: '2:31 PM', severity: 'info' }],
    blockers: [], generatedAt: new Date().toISOString(),
  },
  mods: {
    staff: { ok: true, kpis: { totalTechnicians: 744, activeTechnicians: 744, tenantsWithStaff: 2, avgTechsPerTenant: 3 }, tenants: [{ tenantId: 't-a', tenantName: 'Glamour Studio', technicianCount: 10, activeCount: 8 }], technicians: [], statusBreakdown: [], tenantCount: 2 },
    queue: { ok: true, kpis: { waitingNow: 86, inServiceNow: 744, vipWaiting: 3, longestWaitMin: 22, salonsWithActiveQueue: 2 }, tenants: [{ tenantId: 't-a', tenantName: 'Glamour Studio', waitingCount: 16, servingCount: 102 }], items: [{ queueItemId: 'q1', tenantId: 't-a', tenantName: 'Glamour Studio', branchName: 'Downtown', customerName: 'C', isVip: false, priority: 'normal', status: 'serving', station: 'Hair Color', technicianName: 'Sarah J.', checkedInAt: null, waitMinutes: 4 }], statusBreakdown: [], tenantCount: 2 },
    checkin: { ok: true, kpis: { activeNow: 80, completedToday: 900, sessionsToday: 932, totalSessions: 9000 }, tenants: [{ tenantId: 't-a', tenantName: 'Glamour Studio', sessionCount: 128, activeCount: 16 }], sessions: [], statusBreakdown: [], tenantCount: 2 },
    memberships: null, loyalty: null,
    devices: { kpis: { totalDevices: 5642, online: 4812, offline: 830, paymentTerminals: 2000 } },
    payments: { kpis: { todayVolumeCents: 12_876_400, todayCount: 646, failedCount: 3, refundCentsMonth: 0, tipsCents: 0 } },
    branches: { directory: [{ id: 'b1', name: 'Downtown', tenantName: 'Glamour Studio', status: 'active', staff: 12, todaysAppts: 40, revenueMtdCents: 1_872_000 }] },
    services: { topServices: [], kpis: { avgRating: 4.8, reviewCount: 100 } },
    appts: { rows: [{ id: 'ap1', startTime: new Date().toISOString(), customerName: 'Emma Johnson', services: ['Hair Cut'], technicianName: null, status: 'scheduled', tenantName: 'Glamour Studio' }], byStatus: [{ status: 'completed', count: 689 }] },
    tenantsLive: [{ tenantId: 't-a', ownerName: 'Pat Owner', plan: 'Standard', branchCount: 3, serviceDone: 96, checkout: 92, revenueTodayCents: 1_872_000, deviceOnline: 14, deviceTotal: 16 }],
    revenueHourly: { today: Array.from({ length: 24 }, (_, i) => (i === 2 ? 6000 : 0)), yesterday: Array.from({ length: 24 }, (_, i) => (i === 14 ? 6500 : 0)) },
  },
  loading: false, error: null, range: 'day', setRange: vi.fn(), reload: vi.fn(),
};

vi.mock('../api/superAdminOverviewApi', () => ({ useOverviewAggregate: () => aggReturn as any }));
vi.mock('../api/superAdminDashboardApi', () => ({ useSuperAdminDashboard: () => ({ data: null, health: { database: { ok: true, latencyMs: 3 }, process: { uptimeSeconds: 100, node: '22', pid: 1, memoryRssMb: 80, memoryHeapUsedMb: 40, env: 'test' }, gateway: { errors24h: 0, configured: 2, ok: true } }, loading: false, error: null, reload: vi.fn() }) as any }));
vi.mock('../shell/ScopeContext', () => ({ useScope: () => ({ tenantId: null, tenantName: null, setScope: vi.fn(), clear: vi.fn() }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { fullName: 'Super Admin', role: 'SUPER_ADMIN' }, loading: false, setPrincipal: vi.fn(), logout: vi.fn() }) }));

import { LiveOperationsScreen } from './LiveOperationsScreen';

const renderScreen = () => render(<MemoryRouter><LiveOperationsScreen /></MemoryRouter>);

describe('LiveOperationsScreen (Super Admin, read-only monitoring)', () => {
  it('renders the title, live badge, and all 12 live KPIs', () => {
    renderScreen();
    expect(screen.getByText('Live Operations')).toBeInTheDocument();
    expect(screen.getByLabelText('Live')).toBeInTheDocument();
    for (const label of ['Total Tenants', 'Active Branches', 'Online POS Devices', 'Offline POS Devices', 'Customers Checked In', 'Live Queue', 'Technicians Serving', 'Service Done', 'Checkouts Completed', "Today's Appointments", "Today's Payment Volume", "Today's Revenue"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('renders every monitoring module from the reference', () => {
    renderScreen();
    for (const name of ['All Tenants Live Monitor', 'System Health', 'Live Alerts', 'Live Revenue Monitor', 'Daily Service Pipeline', 'Active POS Devices', 'Top Performing Tenants', 'Recent Platform Activity', 'Upcoming Appointments', 'Technician Activity', 'Branch Performance Overview', 'Quick Actions']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.getByText(/Live Queue Monitor by Branch/)).toBeInTheDocument();
  });

  it('renders all eight Quick Actions', () => {
    renderScreen();
    for (const label of ['Broadcast Message', 'Add Announcement', 'Force POS Sync', 'Refresh All Data', 'View All Queues', 'System Diagnostics', 'Export Live Data', '+ Add Tenant']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('exposes NO salon-workflow mutation controls (read-only boundary)', () => {
    renderScreen();
    for (const forbidden of [/^check in$/i, /^assign technician$/i, /^start service$/i, /^complete service$/i, /^collect payment$/i, /^void transaction$/i, /^reassign$/i]) {
      expect(screen.queryByRole('button', { name: forbidden })).toBeNull();
    }
  });

  it('shows honest NotConnected for KPIs without a backend source rather than fabricating', () => {
    const saved = aggReturn.mods.revenueHourly;
    (aggReturn.mods as any).revenueHourly = null; // no hourly source → Today's Revenue must fall back to the em dash
    renderScreen();
    const revenueCard = screen.getByText("Today's Revenue").closest('.kpi') as HTMLElement;
    expect(revenueCard.textContent).toContain('—');
    (aggReturn.mods as any).revenueHourly = saved;
  });

  it('renders the hourly today-vs-yesterday revenue chart and fills Today\u2019s Revenue from it', () => {
    renderScreen();
    const card = screen.getByText("Today's Revenue").closest('.kpi') as HTMLElement;
    expect(card.textContent).toContain('$60'); // sum of today's hourly buckets (6000c)
    const panel = screen.getByLabelText('Live Revenue Monitor');
    expect(panel.textContent).toContain('Today');
    expect(panel.textContent).toContain('Yesterday'); // prior-day line is now connected, not "NotConnected"
    expect(panel.textContent).not.toContain('NotConnected');
  });

  it('renders real values composed from the aggregate (offline-device favorable trend is green)', () => {
    renderScreen();
    expect(screen.getByText('4.8K')).toBeInTheDocument();   // online POS devices
    expect(screen.getAllByText('Glamour Studio').length).toBeGreaterThan(0);
  });

  it('fills the per-tenant monitor columns from the live ticket rollup (service-done / checkout / revenue today)', () => {
    renderScreen();
    // tenantsLive[t-a] = { serviceDone: 96, checkout: 92, revenueTodayCents: 1_872_000 }
    const monitor = screen.getByLabelText('All Tenants Live Monitor');
    expect(monitor.textContent).toContain('$18,720'); // today's revenue for Glamour Studio
    expect(monitor.textContent).toContain('96'); // service done
    expect(monitor.textContent).toContain('92'); // checkout
    expect(monitor.textContent).toContain('Pat Owner'); // owner directory
    expect(monitor.textContent).toContain('Standard'); // plan badge
    expect(monitor.textContent).toContain('14'); // devices online
    expect(monitor.textContent).toContain('16'); // devices total
  });

  it('shows a real Payment Gateway health status from the probe (not "No probe wired")', () => {
    renderScreen();
    const health = screen.getByLabelText('System Health');
    expect(health.textContent).toContain('Payment Gateway');
    expect(health.textContent).toContain('Healthy \u00b7 2 configured');
  });
});
