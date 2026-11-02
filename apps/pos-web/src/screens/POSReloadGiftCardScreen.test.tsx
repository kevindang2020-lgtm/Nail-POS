import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { getCatMock, ticketsMock, reloadMock } = vi.hoisted(() => ({ getCatMock: vi.fn(), ticketsMock: vi.fn(), reloadMock: vi.fn() }));
vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: { getCategory: getCatMock } }));
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: { tickets: ticketsMock, createGiftCardReload: reloadMock } }));
import { POSReloadGiftCardScreen } from './POSReloadGiftCardScreen';

const SETTINGS = { enabled: true, posSalesEnabled: true, presetAmountsCents: [2500, 5000, 10000], customAmountEnabled: true, minAmountCents: 1000, maxAmountCents: 50000 };
const TICKETS = [{ ticketId: 'tk1', ticketNumber: '#2042', customerName: 'Nora Patel', totalDueCents: 6500, status: 'ready_for_payment' }];

beforeEach(() => {
  getCatMock.mockReset(); ticketsMock.mockReset(); reloadMock.mockReset();
  getCatMock.mockResolvedValue({ ...SETTINGS });
  ticketsMock.mockResolvedValue(TICKETS);
  reloadMock.mockResolvedValue({ reference: 'GC-****-4567', amountCents: 5000, balanceCents: 5000, status: 'pending_payment' });
});

describe('POSReloadGiftCardScreen', () => {
  it('adds a reload onto an open checkout — pending, credits on payment', async () => {
    render(<POSReloadGiftCardScreen />);
    fireEvent.change(await screen.findByLabelText('Gift card code'), { target: { value: 'GC-ABC1234567' } });
    fireEvent.click(screen.getByRole('button', { name: '$50.00' }));
    fireEvent.change(screen.getByLabelText('Open checkout'), { target: { value: 'tk1' } });
    fireEvent.click(screen.getByRole('button', { name: /Add \$50\.00 reload/ }));
    await waitFor(() => expect(reloadMock).toHaveBeenCalledWith('tk1', { code: 'GC-ABC1234567', amountCents: 5000 }));
    expect(await screen.findByText(/GC-\*\*\*\*-4567/)).toBeInTheDocument();
  });

  it('shows an honest disabled state when gift cards are off', async () => {
    getCatMock.mockResolvedValue({ ...SETTINGS, enabled: false });
    render(<POSReloadGiftCardScreen />);
    expect(await screen.findByText(/Gift cards are turned off/)).toBeInTheDocument();
  });

  it('keeps the action disabled until a card code is entered', async () => {
    render(<POSReloadGiftCardScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '$50.00' }));
    fireEvent.change(screen.getByLabelText('Open checkout'), { target: { value: 'tk1' } });
    expect(screen.getByRole('button', { name: /Add \$50\.00 reload/ })).toBeDisabled(); // no code yet
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
