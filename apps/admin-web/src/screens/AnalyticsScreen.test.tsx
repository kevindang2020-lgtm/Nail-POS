import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../shell/ScopeContext', () => ({ useScope: () => ({ tenantId: null, tenantName: null }) }));

const payload = {
  ok: true,
  metadata: { generatedAt: '2026-06-29T12:00:00.000Z', range: '30d', by: 'admin@aps.test', compare: { mode: 'previous_period', label: 'previous period', offsetMonths: 1 } },
  scope: { tenantId: null, scoped: false },
  kpis: [
    { key: 'revenue', label: 'Total Revenue', valueCents: 324_359_240, format: 'money', deltaPct: 22.5, to: '/platform-reports' },
    { key: 'appointments', label: 'Total Appointments', value: 12_746, format: 'count', deltaPct: null, to: '/appointment-oversight' },
    { key: 'customers', label: 'Total Customers', value: 1_284_741, format: 'count', deltaPct: null, to: '/customer-data-oversight' },
    { key: 'activeTenants', label: 'Active Tenants', value: 2418, format: 'count', deltaPct: null, to: '/tenants?status=active' },
    { key: 'activeBranches', label: 'Active Branches', value: 3317, format: 'count', deltaPct: null, to: '/branches?status=active' },
    { key: 'activeDevices', label: 'Active POS Devices', value: 5642, format: 'count', deltaPct: null, to: '/devices-management' },
    { key: 'avgTicket', label: 'Average Ticket Size', valueCents: 7234, format: 'money', deltaPct: -2.3, to: '/platform-reports' },
    { key: 'membershipRevenue', label: 'Membership Revenue', valueCents: 38_276_600, format: 'money', deltaPct: null, to: '/memberships' },
  ],
  modules: {
    revenueTransactionsTrend: { available: true, granularity: 'monthly', dailyAvailable: false, series: [{ label: '2026-05', revenueCents: 324_359_240, transactions: 12_746 }] },
    appointmentActivity: { available: true, dailySeriesAvailable: false, total: 12_746, statusMix: [{ status: 'completed', count: 9000 }], sourceMix: [], note: 'x' },
    tenantGrowth: { available: true, newByMonth: [{ month: '2026-05', count: 41 }], totalTenants: 2418, churn: { available: false, reason: 'churn pending' } },
    paymentMethods: { available: true, totalCents: 324_359_240, byMethod: [{ method: 'card', count: 100, cents: 200_000 }, { method: 'cash', count: 20, cents: 40_000 }] },
    topTenants: { available: true, rows: [{ tenantId: 't1', tenantName: 'Glamour Studio', amountCents: 31_258_400 }] },
    branchComparison: { available: true, metric: 'revenue', rows: [{ branch: 'Downtown', volumeCents: 31_260_000 }] },
    serviceCategoryMix: { available: false, reason: 'per-category revenue pending' },
    customerRetention: { available: true, dailyAvailable: false, totalCustomers: 1_284_741, activeCustomers: 900_000, newThisMonth: 5000, newVsReturning: { available: false, reason: 'daily split pending' } },
    peakHours: { available: true, matrixAvailable: false, byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: h })) },
    deviceStatus: { available: true, total: 5642, online: 4812, offline: 830, byStatus: [] },
    aiReceptionist: { available: false, reason: 'AI call volume not instrumented', aiCallsUsed: 0, bookings: { available: true, aiBookings: 4120, totalBookings: 12746, automationRatePct: 32.3 }, reminders: { available: true, sent: 1200, sentThisMonth: 300, delivered: 1150, failed: 50, deliveryRatePct: 95.8 } },
    regionalPerformance: { available: true, model: 'us-state', byState: [{ state: 'NJ', tenants: 12 }], revenueByRegion: { available: false, reason: 'region revenue pending' } },
    recommendations: { available: true, items: [{ type: 'payments', severity: 'critical', metric: 'gateway_errors', message: '2 gateways in error.', action: 'Open payment gateways', to: '/payment-gateways', source: 'rule-based', generatedAt: '2026-06-29T12:00:00.000Z' }] },
    systemHealth: { available: true, metrics: { available: false, reason: 'monitoring store pending' }, alerts: { critical: 2, warning: 6, info: 14, source: 'rule-based' } },
  },
};

vi.mock('../api/superAdminAnalyticsApi', () => ({
  isGap: (x: any) => !!x && typeof x === 'object' && x.available === false,
  analyticsApi: { get: vi.fn(), export: vi.fn() },
  downloadExport: vi.fn(),
  useAnalytics: () => ({ data: payload, loading: false, error: null, range: '30d', setRange: vi.fn(), compareTo: 'previous_period', setCompareTo: vi.fn(), reload: vi.fn() }),
}));

import { AnalyticsScreen } from './AnalyticsScreen';

describe('AnalyticsScreen (S03 · platform analytics)', () => {
  const renderScreen = () => render(<MemoryRouter><AnalyticsScreen /></MemoryRouter>);

  it('renders the title, subtitle, and primary actions', () => {
    renderScreen();
    expect(screen.getByRole('heading', { name: /Analytics/ })).toBeInTheDocument();
    expect(screen.getByText(/Cross-tenant business intelligence/)).toBeInTheDocument();
    expect(screen.getByText(/Export Report/)).toBeInTheDocument();
    expect(screen.getByText(/Compare: previous period/)).toBeInTheDocument();
    expect(screen.getByText('+ Add Widget')).toBeInTheDocument();
  });

  it('renders all eight KPI cards', () => {
    renderScreen();
    for (const label of ['Total Revenue', 'Total Appointments', 'Total Customers', 'Active Tenants', 'Active Branches', 'Active POS Devices', 'Average Ticket Size', 'Membership Revenue'])
      expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders modules 1–14 in order with real data', () => {
    renderScreen();
    expect(screen.getByText('1. Revenue & Transactions Trend')).toBeInTheDocument();
    expect(screen.getByText('4. Payment Methods')).toBeInTheDocument();
    expect(screen.getByText('5. Top Performing Tenants')).toBeInTheDocument();
    expect(screen.getByText('Glamour Studio')).toBeInTheDocument();
    expect(screen.getByText('10. Device Status')).toBeInTheDocument();
    expect(screen.getByText('13. AI Insights & Recommendations')).toBeInTheDocument();
    expect(screen.getByText('14. System Health')).toBeInTheDocument();
  });

  it('renders honest NotConnected states for unbacked sections', () => {
    renderScreen();
    expect(screen.getByText('7. Service Category Mix')).toBeInTheDocument();
    expect(screen.getAllByText(/not connected/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders the Quick Actions bar in reference order', () => {
    renderScreen();
    for (const label of ['Open Dashboard', 'Revenue Report', 'Tenant Ranking', 'Device Analytics', 'Membership Report', 'AI Insights Report', 'Export Data', '+ Add Branch'])
      expect(screen.getByText(label)).toBeInTheDocument();
  });
});
