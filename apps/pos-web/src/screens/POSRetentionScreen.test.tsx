import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock, atRiskMock } = vi.hoisted(() => ({ stateMock: vi.fn(), atRiskMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { state: stateMock, atRisk: atRiskMock } }));
import { POSRetentionScreen } from './POSRetentionScreen';
beforeEach(() => { stateMock.mockReset(); atRiskMock.mockReset(); });

const state = { kpisFull: { totalCustomers: 200, returningRatePercent: 62, returningCustomers: 124, newThisMonth: 18, inactiveCustomers: 30 } };
const lapsed = { items: [
  { customerId: 'c1', fullName: 'Ana Rivera', phone: '555-1', visitsCount: 4, lastVisitDate: '2026-01-01T00:00:00Z', totalSpendCents: 42000, loyaltyTier: 'Gold' },
  { customerId: 'c2', fullName: 'Bo Chen', phone: '555-2', visitsCount: 2, lastVisitDate: '2026-03-01T00:00:00Z', totalSpendCents: 15000, loyaltyTier: 'Regular' },
] };

describe('POSRetentionScreen', () => {
  it('renders retention KPIs + win-back list', async () => {
    stateMock.mockResolvedValue(state); atRiskMock.mockResolvedValue(lapsed);
    render(<POSRetentionScreen />);
    expect(await screen.findByRole('heading', { name: 'Customer Retention' })).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();          // returning rate
    expect(screen.getByText('Ana Rivera')).toBeInTheDocument();
    expect(screen.getByText('Bo Chen')).toBeInTheDocument();
    expect(screen.getByText('$570.00')).toBeInTheDocument();       // lapsed value 42000+15000
  });
  it('shows healthy empty state when no lapsed customers', async () => {
    stateMock.mockResolvedValue(state); atRiskMock.mockResolvedValue({ items: [] });
    render(<POSRetentionScreen />);
    expect(await screen.findByText(/retention is healthy/)).toBeInTheDocument();
  });
});
