import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { stateMock, bySegmentMock } = vi.hoisted(() => ({ stateMock: vi.fn(), bySegmentMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { state: stateMock, bySegment: bySegmentMock } }));
import { POSSegmentsScreen } from './POSSegmentsScreen';
beforeEach(() => { stateMock.mockReset(); bySegmentMock.mockReset(); stateMock.mockResolvedValue({ kpis: { newCustomers: 3, returningCustomers: 12, vipCustomers: 2 } }); });

const row = (o: any = {}) => ({ customerId: 'c1', fullName: 'Jane Doe', phone: '555-1000', visitsCount: 5, loyaltyTier: 'Gold', lastVisitDate: '2026-06-01', totalSpendCents: 42000, ...o });

describe('POSSegmentsScreen', () => {
  it('loads the returning segment by default and lists members', async () => {
    bySegmentMock.mockResolvedValue({ items: [row()] });
    render(<POSSegmentsScreen />);
    await waitFor(() => expect(bySegmentMock).toHaveBeenCalledWith('returning'));
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('$420.00')).toBeInTheDocument();
  });
  it('switching to VIP requests the vip segment', async () => {
    bySegmentMock.mockResolvedValue({ items: [] });
    render(<POSSegmentsScreen />);
    await screen.findByText(/No customers in this segment/);
    fireEvent.click(screen.getByRole('button', { name: /VIP/ }));
    await waitFor(() => expect(bySegmentMock).toHaveBeenCalledWith('vip'));
  });
});
