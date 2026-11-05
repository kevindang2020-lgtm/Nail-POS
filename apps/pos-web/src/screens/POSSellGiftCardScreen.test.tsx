import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { getCatMock, ticketsMock, saleMock } = vi.hoisted(() => ({ getCatMock: vi.fn(), ticketsMock: vi.fn(), saleMock: vi.fn() }));
vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: { getCategory: getCatMock } }));
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: { tickets: ticketsMock, createGiftCardSale: saleMock } }));
vi.mock('../lib/barcode-core', () => ({ scannerSupported: () => true, extractCardNumber: (x: string) => x }));
vi.mock('../components/CardScanner', () => ({ CardScanner: ({ onScan }: { onScan: (v: string) => void }) => (
  <button onClick={() => onScan('4827193655028411')}>MockScan</button>
) }));
import { POSSellGiftCardScreen } from './POSSellGiftCardScreen';

const SETTINGS = { enabled: true, posSalesEnabled: true, presetAmountsCents: [2500, 5000, 10000], customAmountEnabled: true, minAmountCents: 1000, maxAmountCents: 50000, sendToFriendEnabled: true };
const TICKETS = [{ ticketId: 'tk1', ticketNumber: '#2042', customerName: 'Nora Patel', totalDueCents: 6500, status: 'ready_for_payment' }];

beforeEach(() => {
  getCatMock.mockReset(); ticketsMock.mockReset(); saleMock.mockReset();
  getCatMock.mockResolvedValue({ ...SETTINGS });
  ticketsMock.mockResolvedValue(TICKETS);
  saleMock.mockResolvedValue({ code: 'GC-ABC1234567', reference: 'GC-****-4567', amountCents: 5000, status: 'pending_payment' });
});

describe('POSSellGiftCardScreen', () => {
  it('sells a gift card onto an open checkout — pending, activates on payment', async () => {
    render(<POSSellGiftCardScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '$50.00' }));
    fireEvent.change(screen.getByLabelText('Open checkout'), { target: { value: 'tk1' } });
    fireEvent.click(screen.getByRole('button', { name: /Add \$50\.00 gift card/ }));
    await waitFor(() => expect(saleMock).toHaveBeenCalledWith('tk1', { amountCents: 5000, recipient: undefined }));
    expect(await screen.findByText(/GC-\*\*\*\*-4567/)).toBeInTheDocument();
  });

  it('sells a physical card from stock by its pre-printed number', async () => {
    render(<POSSellGiftCardScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '$50.00' }));
    fireEvent.change(screen.getByLabelText('Open checkout'), { target: { value: 'tk1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Physical (from stock)' }));
    fireEvent.change(screen.getByLabelText('Physical card number'), { target: { value: '4827 1936 5502 8411' } });
    fireEvent.click(screen.getByRole('button', { name: /Add \$50\.00 gift card/ }));
    await waitFor(() => expect(saleMock).toHaveBeenCalledWith('tk1', expect.objectContaining({ amountCents: 5000, cardNumber: '4827193655028411' })));
  });

  it('keeps submit disabled until a physical card number is complete', async () => {
    render(<POSSellGiftCardScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '$50.00' }));
    fireEvent.change(screen.getByLabelText('Open checkout'), { target: { value: 'tk1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Physical (from stock)' }));
    fireEvent.change(screen.getByLabelText('Physical card number'), { target: { value: '4827 1936' } });
    expect(screen.getByRole('button', { name: /Add \$50\.00 gift card/ })).toBeDisabled();
  });

  it('scanning fills the physical card number', async () => {
    render(<POSSellGiftCardScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '$50.00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Physical (from stock)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    fireEvent.click(screen.getByRole('button', { name: 'MockScan' }));
    await waitFor(() => expect((screen.getByLabelText('Physical card number') as HTMLInputElement).value).toBe('4827193655028411'));
  });

  it('sells a physical card with a PIN, passing both to the backend', async () => {
    render(<POSSellGiftCardScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '$50.00' }));
    fireEvent.change(screen.getByLabelText('Open checkout'), { target: { value: 'tk1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Physical (from stock)' }));
    fireEvent.change(screen.getByLabelText('Physical card number'), { target: { value: '4827 1936 5502 8411' } });
    fireEvent.change(screen.getByLabelText('Physical card PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: /Add \$50\.00 gift card/ }));
    await waitFor(() => expect(saleMock).toHaveBeenCalledWith('tk1', expect.objectContaining({ cardNumber: '4827193655028411', pin: '4321' })));
  });

  it('shows an honest disabled state when gift cards are off', async () => {
    getCatMock.mockResolvedValue({ ...SETTINGS, enabled: false });
    render(<POSSellGiftCardScreen />);
    expect(await screen.findByText(/Gift cards are turned off/)).toBeInTheDocument();
  });

  it('keeps the action disabled for an amount outside the allowed range', async () => {
    getCatMock.mockResolvedValue({ ...SETTINGS, minAmountCents: 2500, maxAmountCents: 10000 });
    render(<POSSellGiftCardScreen />);
    fireEvent.change(await screen.findByLabelText('Custom amount'), { target: { value: '5.00' } }); // below min
    fireEvent.change(screen.getByLabelText('Open checkout'), { target: { value: 'tk1' } });
    expect(screen.getByRole('button', { name: /Add gift card to the checkout/ })).toBeDisabled();
    expect(saleMock).not.toHaveBeenCalled();
  });
});
