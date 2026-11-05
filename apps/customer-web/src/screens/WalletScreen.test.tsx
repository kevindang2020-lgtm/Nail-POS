import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { wallet: vi.fn(), loyalty: vi.fn(), paymentMethods: vi.fn(), topUp: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { WalletScreen } from './WalletScreen';

const loyalty = { points: 1250, tier: 'Silver', nextTier: 'Gold', pointsToNextTier: 750, progressPercent: 62 };

describe('WalletScreen (Wallet & Rewards)', () => {
  beforeEach(() => { vi.clearAllMocks(); (customerApi.paymentMethods as any).mockResolvedValue([]); });

  it('shows wallet balance, the loyalty card, and signed transactions', async () => {
    (customerApi.wallet as any).mockResolvedValue({ balanceCents: 6850, currency: 'USD', transactions: [
      { id: 't1', amountCents: 5000, type: 'top_up', reference: null, createdAt: '2025-05-20T10:00:00Z' },
      { id: 't2', amountCents: -3500, type: 'payment', reference: 'ticket_9', createdAt: '2025-05-18T10:00:00Z' },
    ] });
    (customerApi.loyalty as any).mockResolvedValue(loyalty);
    render(<MemoryRouter><WalletScreen /></MemoryRouter>);
    expect(await screen.findByText('Wallet & Rewards')).toBeInTheDocument();
    expect(screen.getByText('$68.50')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Top Up' })).toBeEnabled();    // top-up is live
    expect(screen.getByText('1,250')).toBeInTheDocument();
    expect(screen.getByText('750 pts to Gold')).toBeInTheDocument();
    expect(screen.getByText('+$50.00')).toBeInTheDocument();
    expect(screen.getByText('−$35.00')).toBeInTheDocument();
  });

  it('shows a real $0.00 and empty transactions for a new wallet', async () => {
    (customerApi.wallet as any).mockResolvedValue({ balanceCents: 0, currency: 'USD', transactions: [] });
    (customerApi.loyalty as any).mockResolvedValue(loyalty);
    render(<MemoryRouter><WalletScreen /></MemoryRouter>);
    expect(await screen.findByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText('No wallet transactions yet.')).toBeInTheDocument();
  });

  it('tops up by charging a saved card and reloads the balance', async () => {
    (customerApi.wallet as any)
      .mockResolvedValueOnce({ balanceCents: 0, currency: 'USD', transactions: [] })
      .mockResolvedValueOnce({ balanceCents: 5000, currency: 'USD', transactions: [{ id: 't', amountCents: 5000, type: 'top_up', reference: 'RT', createdAt: '2026-06-09T10:00:00Z' }] });
    (customerApi.loyalty as any).mockResolvedValue(loyalty);
    (customerApi.paymentMethods as any).mockResolvedValue([{ id: 'pm1', brand: 'Visa', last4: '1111', expMonth: 12, expYear: 2030, isDefault: true }]);
    (customerApi.topUp as any).mockResolvedValue({ ok: true, balanceCents: 5000 });
    render(<MemoryRouter><WalletScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Top Up' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add $50.00' }));   // default preset + default card
    await waitFor(() => expect(customerApi.topUp).toHaveBeenCalledWith(5000, 'pm1'));
  });
});
