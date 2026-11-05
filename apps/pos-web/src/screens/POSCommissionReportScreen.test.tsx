import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posCommissionReportApi', () => ({ posCommissionReportApi: { state: stateMock } }));
import { POSCommissionReportScreen } from './POSCommissionReportScreen';
beforeEach(() => stateMock.mockReset());

const state = {
  preset: 'month', from: '2026-07-01', to: '2026-07-07',
  kpis: { technicianCount: 2, totalServiceRevenueCents: 23000, totalCommissionCents: 7500, totalTipsCents: 2000, totalPayoutCents: 9500, averageRatePercent: 32.6 },
  rows: [
    { technicianId: 'A', technicianName: 'Ana Rivera', serviceCount: 2, serviceRevenueCents: 15000, commissionCents: 6000, tipsCents: 1200, payoutCents: 7200, effectiveRatePercent: 40 },
    { technicianId: 'B', technicianName: 'Ben Cho', serviceCount: 1, serviceRevenueCents: 8000, commissionCents: 1500, tipsCents: 800, payoutCents: 2300, effectiveRatePercent: 18.8 },
  ],
};

describe('POSCommissionReportScreen', () => {
  it('renders KPIs + per-technician payout rows', async () => {
    stateMock.mockResolvedValue(state);
    render(<POSCommissionReportScreen />);
    expect(await screen.findByRole('heading', { name: 'Commission Report' })).toBeInTheDocument();
    expect(screen.getByText('Ana Rivera')).toBeInTheDocument();
    expect(screen.getByText('Ben Cho')).toBeInTheDocument();
    expect(screen.getByText('$72.00')).toBeInTheDocument(); // Ana payout (7200c)
    expect(screen.getByText('$95.00')).toBeInTheDocument();    // total payout
  });
  it('shows empty state when no rows', async () => {
    stateMock.mockResolvedValue({ ...state, kpis: { ...state.kpis, technicianCount: 0 }, rows: [] });
    render(<POSCommissionReportScreen />);
    expect(await screen.findByText(/No commissionable activity/)).toBeInTheDocument();
  });
});
