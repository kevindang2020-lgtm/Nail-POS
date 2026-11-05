import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { byBdayMock } = vi.hoisted(() => ({ byBdayMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { byBirthdayMonth: byBdayMock } }));
import { POSBirthdaysScreen } from './POSBirthdaysScreen';
beforeEach(() => byBdayMock.mockReset());

describe('POSBirthdaysScreen', () => {
  it('loads current month birthdays and lists them', async () => {
    byBdayMock.mockResolvedValue({ items: [{ customerId: 'c1', fullName: 'Birthday Bob', phone: '555-2000', visitsCount: 3, loyaltyTier: 'Silver', totalSpendCents: 15000 }] });
    render(<POSBirthdaysScreen />);
    await waitFor(() => expect(byBdayMock).toHaveBeenCalledWith(new Date().getMonth() + 1));
    expect(await screen.findByText('Birthday Bob')).toBeInTheDocument();
  });
  it('changing month refetches for that month', async () => {
    byBdayMock.mockResolvedValue({ items: [] });
    render(<POSBirthdaysScreen />);
    await screen.findByText(/No customers with a birthday/);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '12' } });
    await waitFor(() => expect(byBdayMock).toHaveBeenCalledWith(12));
  });
});
