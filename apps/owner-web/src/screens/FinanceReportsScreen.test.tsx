// FinanceReportsScreen (owner money screen, read + export): Summary tab (revenue hero, net-profit EST, expenses, avg
// ticket, transactions, tax, tips, payment-mix bars) and Reports tab (catalog with CSV export). Verifies the KPI money
// formatting (whole-dollar hero vs cents elsewhere), the up/down trend directions, the payment mix rows, the empty-mix
// state, the report CSV export wiring (period + branch passed through), and a friendly 403.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ branchId: 'branch-x' as string | undefined }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ openExpenses: vi.fn() }) }));
vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: h.branchId }) }));
vi.mock('../api/ownerApi', () => ({
  ownerFinanceApi: { summary: vi.fn(), paymentMix: vi.fn(), reports: vi.fn(), export: vi.fn() },
  ownerActivityApi: { view: vi.fn().mockResolvedValue(undefined) },
}));

import { ownerFinanceApi } from '../api/ownerApi';
import { FinanceReportsScreen } from './FinanceReportsScreen';

const summary = (over: any = {}) => ({
  period: { from: '2026-06-01', to: '2026-06-30' },
  totalRevenueCents: 4850000, revenueTrendPercent: 12.5, totalExpensesCents: 1200000, totalCommissionCents: 1200000,
  netProfitCents: 3650000, profitTrendPercent: -3.2, averageTicketCents: 6500, totalTransactions: 746,
  taxCollectedCents: 320000, tipsCents: 480000, discountsCents: 50000,
  topServices: [{ name: 'Gel Full Set', revenueCents: 1620000 }, { name: 'Acrylic Fill', revenueCents: 1150000 }, { name: 'Gel Manicure', revenueCents: 870000 }], ...over,
});
const mix = (methods: any[] = [
  { method: 'credit_card', amountCents: 3000000, count: 500, percentage: 61.9 },
  { method: 'cash', amountCents: 1850000, count: 246, percentage: 38.1 },
]) => ({ period: { from: '2026-06-01', to: '2026-06-30' }, methods, totalCents: 4850000 });
const reports = () => [{ id: 'sales', title: 'Sales Report', description: 'Daily revenue and transaction counts.', formats: ['csv'] }];

beforeEach(() => {
  vi.clearAllMocks();
  h.branchId = 'branch-x';
  (ownerFinanceApi.summary as any).mockResolvedValue(summary());
  (ownerFinanceApi.paymentMix as any).mockResolvedValue(mix());
  (ownerFinanceApi.reports as any).mockResolvedValue(reports());
  (ownerFinanceApi.export as any).mockResolvedValue({ reportId: 'sales', filename: 'sales.csv', contentType: 'text/csv', content: 'a,b\n1,2' });
  (global.URL as any).createObjectURL = vi.fn(() => 'blob:x');
  (global.URL as any).revokeObjectURL = vi.fn();
});

describe('FinanceReportsScreen', () => {
  it('renders the summary KPIs with the right money formatting', async () => {
    render(<FinanceReportsScreen />);
    expect(await screen.findByText('$48,500')).toBeInTheDocument();       // revenue hero (whole dollars)
    expect(screen.getByText('$36,500')).toBeInTheDocument();             // net profit
    expect(screen.getByText('$12,000')).toBeInTheDocument();             // expenses
    expect(screen.getByText('$65.00')).toBeInTheDocument();              // avg ticket (cents)
    expect(screen.getByText('746')).toBeInTheDocument();                 // transactions
    expect(screen.getByText('$3,200.00')).toBeInTheDocument();          // tax
    expect(screen.getByText('$4,800.00')).toBeInTheDocument();          // tips
    // Top Services (by revenue)
    expect(screen.getByText('Top Services')).toBeInTheDocument();
    expect(screen.getByText('Gel Full Set')).toBeInTheDocument();
    expect(screen.getByText('$16,200')).toBeInTheDocument();             // top service revenue (whole dollars)
  });

  it('shows up/down trend directions', async () => {
    render(<FinanceReportsScreen />);
    expect(await screen.findByText(/▲ 12.5% vs last month/)).toBeInTheDocument();   // revenue up
    expect(screen.getByText('▼ 3.2%')).toBeInTheDocument();                         // profit down
  });

  it('renders the payment mix rows', async () => {
    render(<FinanceReportsScreen />);
    await screen.findByText('$48,500');
    expect(screen.getByText('500 · 61.9%')).toBeInTheDocument();
    expect(screen.getByText('246 · 38.1%')).toBeInTheDocument();
    expect(screen.getByText('$30,000.00')).toBeInTheDocument();
    expect(screen.getByText('$18,500.00')).toBeInTheDocument();
  });

  it('shows an empty payment-mix message', async () => {
    (ownerFinanceApi.paymentMix as any).mockResolvedValue(mix([]));
    render(<FinanceReportsScreen />);
    await screen.findByText('$48,500');
    expect(screen.getByText('No payments in this period.')).toBeInTheDocument();
  });

  it('refetches finance with the selected period', async () => {
    render(<FinanceReportsScreen />);
    await screen.findByText('$48,500');
    fireEvent.click(screen.getByText('Quarter'));
    await waitFor(() => expect(ownerFinanceApi.summary).toHaveBeenCalledWith('quarter', 'branch-x'));
    expect(ownerFinanceApi.paymentMix).toHaveBeenCalledWith('quarter', 'branch-x');
  });

  it('exports a report CSV with the period and branch', async () => {
    render(<FinanceReportsScreen />);
    await screen.findByText('$48,500');
    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    expect(await screen.findByText('Sales Report')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /CSV/i }));
    await waitFor(() => expect(ownerFinanceApi.export).toHaveBeenCalledWith('sales', 'month', 'branch-x'));
  });

  it('shows a friendly message on a 403', async () => {
    (ownerFinanceApi.summary as any).mockRejectedValue({ status: 403 });
    render(<FinanceReportsScreen />);
    expect(await screen.findByText('You do not have access to finance reports.')).toBeInTheDocument();
  });
});
