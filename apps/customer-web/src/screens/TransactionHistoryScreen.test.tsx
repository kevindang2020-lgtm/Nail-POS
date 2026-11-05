import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { wallet: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { TransactionHistoryScreen } from './TransactionHistoryScreen';

describe('TransactionHistoryScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('lists the full wallet ledger with signed amounts', async () => {
    (customerApi.wallet as any).mockResolvedValue({ balanceCents: 1500, currency: 'USD', transactions: [
      { id: 't1', amountCents: 5000, type: 'top_up', reference: null, createdAt: '2026-06-09T10:00:00Z' },
      { id: 't2', amountCents: -3500, type: 'payment', reference: 'tk', createdAt: '2026-06-08T10:00:00Z' },
    ] });
    render(<MemoryRouter><TransactionHistoryScreen /></MemoryRouter>);
    expect(await screen.findByText('+$50.00')).toBeInTheDocument();
    expect(screen.getByText('−$35.00')).toBeInTheDocument();
  });

  it('renders centered empty state with icon when there are no transactions', async () => {
    (customerApi.wallet as any).mockResolvedValue({ balanceCents: 0, currency: 'USD', transactions: [] });
    render(<MemoryRouter><TransactionHistoryScreen /></MemoryRouter>);
    expect(await screen.findByText('No wallet transactions yet.')).toBeInTheDocument();
    expect(screen.getByText('🧾')).toBeInTheDocument();
  });
});

