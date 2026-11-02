// QA for Platform Reports → Tenant Performance: summary KPIs, ranked table, growth colours, sort, and the
// ?report=tenant-performance highlight (opened from Top Performing Tenants → View Full Report).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { reports: vi.fn(), tenantPerformanceReport: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { PlatformReportsScreen } from './PlatformReportsScreen';

// Mirrors the backend tenant-performance-core so the server-driven table behaves accurately in tests.
const SORT: Record<string, string> = { monthlyCardVolume: 'monthlyCardVolumeCents', transactionCount: 'transactionCount', averageTicket: 'averageTicketCents', growth: 'growthPercent', salonName: 'tenantName', rank: 'rank' };
function applyQ(all: any[], q: any = {}) {
  let out = all.slice();
  if (q.search) { const t = String(q.search).toLowerCase(); out = out.filter((r) => [r.tenantName, r.city, r.state, r.plan, r.status].some((v) => (v || '').toLowerCase().includes(t))); }
  if (q.state) out = out.filter((r) => (r.state || '').toLowerCase() === String(q.state).toLowerCase());
  const key = SORT[q.sortBy || 'monthlyCardVolume'] || 'monthlyCardVolumeCents'; const dir = q.sortDirection === 'asc' ? 1 : -1;
  out.sort((a, b) => { const x = a[key], y = b[key]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  const limit = q.limit || 10, page = q.page || 1; const total = out.length;
  const cur = out.reduce((s, r) => s + r.monthlyCardVolumeCents, 0), txn = out.reduce((s, r) => s + r.transactionCount, 0), withVol = out.filter((r) => r.monthlyCardVolumeCents > 0);
  return { rows: out.slice((page - 1) * limit, page * limit), total, page, pageSize: limit, totalPages: Math.max(1, Math.ceil(total / limit)),
    summary: { totalVolumeCents: cur, totalTransactions: txn, averageTenantVolumeCents: withVol.length ? Math.round(cur / withVol.length) : 0, topTenantVolumeCents: out[0]?.monthlyCardVolumeCents ?? 0, momGrowthPercent: 7.7, activeTenantsIncluded: withVol.length } };
}

const perf = (over: any = {}) => ({ rank: 1, tenantId: 't1', tenantName: 'Luxe Nails & Spa', city: 'Houston', state: 'TX', plan: 'Pro', status: 'active', monthlyCardVolumeCents: 12485000, priorMonthVolumeCents: 10000000, growthPercent: 24.9, transactionCount: 420, averageTicketCents: 29726, ...over });
const reports = () => ({
  totals: { totalTenants: 2, activeTenants: 2, platformVolumeCents: 20000000, aiCallsUsed: 0, supportSessions30d: 0, gatewayErrorTenants: 0 },
  monthlyTenantGrowth: [], monthlyPaymentVolume: [], tenantsByState: [], leadFunnel: {}, applicationPipeline: {}, hardwareByStatus: {},
  topTenantsByVolume: [], subscriptionsByPlan: {},
  tenantPerformance: [perf(), perf({ rank: 2, tenantId: 't2', tenantName: 'Diamond Nail Bar', city: 'Miami', state: 'FL', monthlyCardVolumeCents: 9632000, growthPercent: -5.2 })],
});

describe('PlatformReportsScreen → Tenant Performance', () => {
  beforeEach(() => { vi.clearAllMocks(); (superAdminApi.reports as any).mockResolvedValue(reports()); (superAdminApi.tenantPerformanceReport as any).mockImplementation((q: any) => Promise.resolve(applyQ(reports().tenantPerformance, q))); });

  it('renders the tenant performance table with summary KPIs from real data', async () => {
    render(<MemoryRouter><PlatformReportsScreen /></MemoryRouter>);
    expect(await screen.findByText('Tenant Performance Report')).toBeInTheDocument();
    expect(screen.getByText('Luxe Nails & Spa')).toBeInTheDocument();
    expect(screen.getByText('Diamond Nail Bar')).toBeInTheDocument();
    expect(screen.getByText('Total Card Volume')).toBeInTheDocument();
    expect(screen.getByText('Houston, TX')).toBeInTheDocument();
  });

  it('shows positive and negative growth indicators', async () => {
    render(<MemoryRouter><PlatformReportsScreen /></MemoryRouter>);
    await screen.findByText('Luxe Nails & Spa');
    expect(screen.getByText(/▲ 24.9%/)).toBeInTheDocument();
    expect(screen.getByText(/▼ 5.2%/)).toBeInTheDocument();
  });

  it('sorts by a column when its header is clicked', async () => {
    render(<MemoryRouter><PlatformReportsScreen /></MemoryRouter>);
    await screen.findByText('Luxe Nails & Spa');
    const gh = screen.getByRole('columnheader', { name: /Growth/ });
    fireEvent.click(gh); fireEvent.click(gh);   // first click = desc, second = asc → most-negative first
    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      expect(rows[1].textContent).toContain('Diamond Nail Bar');
    });
  });

  it('opens a row action menu with tenant navigation', async () => {
    render(<MemoryRouter><PlatformReportsScreen /></MemoryRouter>);
    await screen.findByText('Luxe Nails & Spa');
    fireEvent.click(screen.getAllByText('⋮')[0]);
    expect(await screen.findByText('View Tenant')).toBeInTheDocument();
    expect(screen.getByText('Open Billing')).toBeInTheDocument();
  });
});
