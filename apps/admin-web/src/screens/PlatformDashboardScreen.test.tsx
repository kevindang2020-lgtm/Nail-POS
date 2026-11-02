import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const overview = {
  data: {
    kpis: { totalTenants: 2418, activeSalons: 1862, pendingApplications: 28, paymentSetupNeeded: 37, monthlyCardVolumeCents: 324000000, openSupportTickets: 56, systemHealthPercent: 99.9, systemHealthLabel: 'Excellent', trends: {} },
    platformKpis: { activeUsers: 8642, totalLocations: 3317, technicians: 18927, customers: 1320000, totalAppointments: 245320, aiInteractions: 628450 },
    monthlySalesVolume: [{ label: 'May 01', valueCents: 1000000 }, { label: 'May 08', valueCents: 1500000 }],
    tenantsByStatus: [{ status: 'active', label: 'Active', count: 1862, percent: 77 }, { status: 'pending', label: 'Pending', count: 28, percent: 1 }],
    topPerformingTenants: [{ rank: 1, tenantId: 't1', name: 'Glamour Nails Studio', city: 'New York', state: 'NY', monthlyVolumeCents: 12845000, growthPercent: 12 }],
    recentActivity: [{ id: 'a1', icon: '', title: 'New tenant created', tenantName: 'Luxe Nails', message: '', ageLabel: '2m ago', severity: 'info' }],
    recentAlerts: [], recentTenantApplications: [], hardwareSummary: {}, hardwarePackageStatus: [], quickActionsPermissions: {}, blockers: [], generatedAt: '',
  },
  loading: false, error: null, range: 'month', setRange: vi.fn(), reload: vi.fn(),
};
vi.mock('../api/superAdminOverviewApi', () => ({ useSuperAdminOverviewState: () => overview }));
vi.mock('../api/superAdminDashboardApi', () => ({
  useSuperAdminDashboard: () => ({
    data: { estimatedMrrCents: 50000000, averageUsagePercent: 62, tenantsOverUsage: 14, planDistribution: [{ planTier: 'Enterprise', count: 612 }, { planTier: 'Professional', count: 1128 }] },
    health: { ok: true, database: { ok: true, counts: { tenants: 2418, users: 8642, activeSubscriptions: 1862 } }, process: { uptimeSeconds: 3600, node: 'v20', pid: 1, memoryRssMb: 120, memoryHeapUsedMb: 80, env: 'production' } },
    loading: false, error: null, reload: vi.fn(),
  }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { fullName: 'Kevin Dang', role: 'SUPER_ADMIN' } }) }));

import { PlatformDashboardScreen } from './PlatformDashboardScreen';

describe('PlatformDashboardScreen (S02)', () => {
  it('renders platform KPIs, subscription economics, system health, and honest gaps', () => {
    render(<MemoryRouter><PlatformDashboardScreen /></MemoryRouter>);
    expect(screen.getByText('Super Admin Dashboard')).toBeInTheDocument();
    expect(screen.getAllByText('Est. MRR').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Subscription & Usage')).toBeInTheDocument();
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
    expect(screen.getByText('System Health & Services')).toBeInTheDocument();
    expect(screen.getAllByText('Operational').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Top Tenants')).toBeInTheDocument();
    expect(screen.getByText('Glamour Nails Studio')).toBeInTheDocument();
    expect(screen.getAllByText(/not connected/).length).toBeGreaterThanOrEqual(1);
  });
});
