import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { reconMock } = vi.hoisted(() => ({ reconMock: vi.fn() }));
vi.mock('../api/posPaymentsApi', () => ({ posPaymentsApi: { overview: vi.fn(), reconciliation: reconMock } }));
import { POSSettlementsScreen } from './POSSettlementsScreen';

beforeEach(() => reconMock.mockReset());

describe('POSSettlementsScreen', () => {
  it('renders settlement + refund KPIs from the reconciliation endpoint', async () => {
    reconMock.mockResolvedValue({ from: null, to: null, refunds: { count: 2, totalCents: 3000 }, settlements: { count: 5, grossCents: 500000, feeCents: 12000, netCents: 488000 } });
    render(<POSSettlementsScreen />);
    expect(await screen.findByRole('heading', { name: 'Settlements' })).toBeInTheDocument();
    expect(screen.getAllByText('$5,000.00').length).toBeGreaterThan(0); // gross settled
    expect(screen.getAllByText('$4,880.00').length).toBeGreaterThan(0); // net deposited
    // called with a computed from/to date range
    expect(reconMock.mock.calls[0][0]).toHaveProperty('from');
    expect(reconMock.mock.calls[0][0]).toHaveProperty('to');
  });
});
