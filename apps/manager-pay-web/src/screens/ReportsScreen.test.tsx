import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ReportsScreen } from './ReportsScreen';

vi.mock('../api/mobileCheckoutApi', () => ({ mobileCheckoutApi: { report: vi.fn() } }));
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';

describe('ReportsScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders KPIs and outcomes, keeping Settled honest at $0 with an explanatory note', async () => {
    (mobileCheckoutApi.report as any).mockResolvedValue({
      period: '7d', totalAttempts: 3, byStatus: { failed: 2, created: 1 },
      attemptedTotalCents: 9000, settledTotalCents: 0,
      daily: [{ date: '2026-06-27', count: 1, attemptedCents: 3000 }, { date: '2026-06-28', count: 2, attemptedCents: 6000 }],
    });
    render(<ReportsScreen />);
    expect(await screen.findByText('$90.00')).toBeInTheDocument(); // attempted
    expect(screen.getByText('$0.00')).toBeInTheDocument(); // settled honestly zero
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Settled totals reflect completed card captures.', { exact: false })).toBeInTheDocument();
  });

  it('shows an empty state when there are no attempts in the period', async () => {
    (mobileCheckoutApi.report as any).mockResolvedValue({ period: 'today', totalAttempts: 0, byStatus: {}, attemptedTotalCents: 0, settledTotalCents: 0, daily: [] });
    render(<ReportsScreen />);
    await waitFor(() => expect(screen.getByText('No attempts in this period')).toBeInTheDocument());
  });
});
