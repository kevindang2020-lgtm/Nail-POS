import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HistoryScreen } from './HistoryScreen';

vi.mock('../api/mobileCheckoutApi', () => ({
  mobileCheckoutApi: { recentAttempts: vi.fn() },
}));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';

const attempt = (over: Partial<any>) => ({ id: 'a1', ticketId: 'tk123456789', amountCents: 3233, method: 'tap_to_pay', status: 'failed', idempotencyKey: 'K1', createdAt: new Date().toISOString(), updatedAt: '', ...over });

describe('HistoryScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists recent attempts with honest statuses and formatted amounts under a Today group', async () => {
    (mobileCheckoutApi.recentAttempts as any).mockResolvedValue([
      attempt({ id: 'a1', amountCents: 3233, status: 'failed' }),
      attempt({ id: 'a2', amountCents: 5000, status: 'created' }),
    ]);
    render(<HistoryScreen />);
    expect(await screen.findByText('$32.33')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    // honesty: nothing invented as paid/settled
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
    expect(screen.queryByText('Settled')).not.toBeInTheDocument();
  });

  it('shows an empty state when there is no activity', async () => {
    (mobileCheckoutApi.recentAttempts as any).mockResolvedValue([]);
    render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByText('No checkout activity yet')).toBeInTheDocument());
  });
});
