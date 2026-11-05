import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TenantDirectoryAnalytics } from './TenantDirectoryAnalytics';
import type { DirectoryOverview } from '../api/superAdminApi';

const data = (over: Partial<DirectoryOverview> = {}): DirectoryOverview => ({
  kpis: {
    totalTenants: 1248, activeTenants: 1062, trialTenants: 118, pendingApprovals: 32, suspendedTenants: 68,
    enterpriseTenants: 156, totalBranches: 3317, totalCustomers: 1284741, monthlyRevenueCents: 423589200,
    churnRiskHigh: 23, overduePayments: 8, activePosDevices: 5642, openSupportTickets: null,
  },
  planDistribution: [
    { key: 'enterprise', label: 'Enterprise', count: 156, pct: 12.5 },
    { key: 'growth', label: 'Growth', count: 412, pct: 33.0 },
  ],
  statusDistribution: [
    { key: 'active', label: 'Active', count: 1062, pct: 85.1 },
    { key: 'trial', label: 'Trial', count: 118, pct: 9.5 },
  ],
  healthDistribution: [
    { key: 'excellent', label: 'Excellent (90–100)', count: 312, pct: 25.0 },
    { key: 'critical', label: 'Critical (0–29)', count: 23, pct: 1.8 },
  ],
  healthAlerts: [
    { key: 'high_churn_risk', label: 'tenants at high churn risk', count: 23, available: true },
    { key: 'subscriptions_expiring_7d', label: 'subscriptions expiring in 7 days', count: 0, available: false },
  ],
  growthTrend: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, label: 'Jun', totalTenants: 1000 + i * 20 })),
  onboardingPipeline: { stages: [{ key: 'received', label: 'Applications Received', count: 68 }, { key: 'approved', label: 'Approved', count: 12 }], conversionRatePct: 17.6, available: true },
  upcomingRenewals: { rows: [{ tenantId: 'a', tenantName: 'Elite Beauty Group', plan: 'Enterprise', renewalDate: new Date().toISOString(), daysRemaining: 24, warning: 'ok' }], available: true },
  meta: { growthDefinition: 'Total tenants existing at each month-end (cumulative).', revenueDefinition: 'Monthly Revenue = sum of per-tenant monthlyRevenueCents.' },
  ...over,
});

describe('TenantDirectoryAnalytics', () => {
  it('renders all 12 KPI cards with reference labels', () => {
    render(<TenantDirectoryAnalytics data={data()} />);
    // Sep 2026 redesign: each KPI is a <button title="Filter by …"> in a grid (no .kpis/.kpi classes)
    const cards = screen.getAllByTitle(/^Filter by /);
    const grid = cards[0].parentElement as HTMLElement;
    for (const l of ['Total Tenants', 'Active Tenants', 'Pending Approvals', 'Suspended Tenants', 'Trial Tenants',
      'Enterprise Tenants', 'Total Branches', 'Active POS Devices', 'Total Customers', 'Monthly Revenue',
      'Open Support Tickets', 'Churn Risk (High)']) {
      expect(within(grid).getByText(l)).toBeInTheDocument();
    }
    expect(within(grid).getByText('$4.24M')).toBeInTheDocument(); // monthly revenue formatted from cents
    expect(cards).toHaveLength(12);
  });

  it('renders "—" for an unconnected KPI rather than a fabricated number', () => {
    render(<TenantDirectoryAnalytics data={data()} />);
    const ticketsCard = screen.getByTitle('Filter by Open Support Tickets');
    expect(within(ticketsCard).getByText('—')).toBeInTheDocument();
  });

  it('lets the parent supply Open Support Tickets from governance KPIs', () => {
    render(<TenantDirectoryAnalytics data={data()} openSupportTickets={128} />);
    const ticketsCard = screen.getByTitle('Filter by Open Support Tickets');
    expect(within(ticketsCard).getByText('128')).toBeInTheDocument();
  });

  it('shows health alerts honestly: available counts vs NotConnected', () => {
    render(<TenantDirectoryAnalytics data={data()} />);
    expect(screen.getByText('23 tenants at high churn risk')).toBeInTheDocument();
    expect(screen.getByText(/subscriptions expiring in 7 days — NotConnected/)).toBeInTheDocument();
  });

  it('renders plan + status legends and the onboarding conversion rate', () => {
    render(<TenantDirectoryAnalytics data={data()} />);
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
    expect(screen.getByText('156 (12.5%)')).toBeInTheDocument();
    expect(screen.getByText(/Conversion Rate:/)).toHaveTextContent('Conversion Rate: 17.6%');   // the rate is bold in the redesign
    expect(screen.getByText('Elite Beauty Group')).toBeInTheDocument(); // renewal row
  });

  it('honestly reports unavailable onboarding + renewals sources', () => {
    render(<TenantDirectoryAnalytics data={data({
      onboardingPipeline: { stages: [], conversionRatePct: 0, available: false },
      upcomingRenewals: { rows: [], available: false },
    })} />);
    expect(screen.getByText('Onboarding source not connected.')).toBeInTheDocument();
    expect(screen.getByText('Renewal source not connected.')).toBeInTheDocument();
  });

  it('fires onKpi with the right key when a card is clicked', () => {
    const onKpi = vi.fn();
    render(<TenantDirectoryAnalytics data={data()} onKpi={onKpi} />);
    fireEvent.click(screen.getByTitle('Filter by Suspended Tenants'));
    expect(onKpi).toHaveBeenCalledWith('suspended');
  });
});
