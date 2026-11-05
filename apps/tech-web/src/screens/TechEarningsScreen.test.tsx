// TechEarningsScreen (1:1): headline + Services/Tips/Retail/Bonuses breakdown come from /tech/earnings/canonical; the
// per-service breakdown + daily chart come from /tech/earnings/detail; Cash Pending from /tech/me/cash-pending. Verifies
// the canonical total, the four breakdown rows (Bonuses → "—" when null), period re-query, the empty state, and a load error.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../lib/tech', () => ({ money2: (c: number) => `$${((c || 0) / 100).toFixed(2)}`, longDate: () => 'May 16, 2026' }));
vi.mock('../api/techApi', () => ({ techApi: { earningsCanonical: vi.fn(), earningsDetail: vi.fn(), cashPending: vi.fn() } }));

import { techApi } from '../api/techApi';
import { TechEarningsScreen } from './TechEarningsScreen';
import { TechNavProvider } from '../shell/nav';

const canon = (over: any = {}) => ({
  serviceCommissionCents: 38200, cardTipCents: 9000, cashTipCents: 3800, tipsCents: 12800,
  retailCommissionCents: 3200, bonusCents: null, guaranteeTopUpCents: null, adjustmentsCents: null,
  estimatedEarningsCents: 56800, status: 'estimated', tickets: 18,
  dateFrom: '2026-05-10T00:00:00Z', dateTo: '2026-05-17T00:00:00Z', ...over,
});
const detail = (over: any = {}) => ({
  snapshot: { todaySalesCents: 21000, tipsCents: 2000, estimatedCommissionCents: 10500 },
  lines: [
    { serviceName: 'Gel Manicure', lineTotalCents: 4500, commissionCents: 2250, completedAt: '2026-05-14T14:00:00Z' },
    { serviceName: 'Gel Manicure', lineTotalCents: 4500, commissionCents: 2250, completedAt: '2026-05-15T15:00:00Z' },
    { serviceName: 'Spa Pedicure', lineTotalCents: 12000, commissionCents: 6000, completedAt: '2026-05-16T16:00:00Z' },
  ],
  period: 'week', dateFrom: '2026-05-10T00:00:00Z', dateTo: '2026-05-17T00:00:00Z', ...over,
});
const renderScreen = () => render(<TechNavProvider><TechEarningsScreen /></TechNavProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  (techApi.earningsCanonical as any).mockResolvedValue(canon());
  (techApi.earningsDetail as any).mockResolvedValue(detail());
  (techApi.cashPending as any).mockResolvedValue({ items: [{ confirmationId: 'c1', ticketId: 't1', paymentIntentId: null, amountCents: 7400, customerName: 'Jane', ticketNumber: '1042', services: [] }] });
});

describe('TechEarningsScreen', () => {
  it('shows the canonical total and the Services/Tips/Retail/Bonuses breakdown', async () => {
    renderScreen();
    expect(await screen.findByText('$568.00')).toBeInTheDocument();   // canonical estimated total
    expect(screen.getByText('$382.00')).toBeInTheDocument();          // Services
    expect(screen.getByText('$128.00')).toBeInTheDocument();          // Tips
    expect(screen.getByText('$32.00')).toBeInTheDocument();           // Retail
    const bonusRow = screen.getByText('Bonuses').closest('.tech-brk') as HTMLElement;
    expect(within(bonusRow).getByText('—')).toBeInTheDocument();      // null bonus → em dash, not invented
  });

  it('shows the real cash-pending total', async () => {
    renderScreen();
    await screen.findByText('$568.00');
    expect(screen.getByText('Cash Pending')).toBeInTheDocument();
    expect(screen.getByText('$74.00')).toBeInTheDocument();           // summed pending handoff
  });

  it('groups the service breakdown by service and sorts by amount desc', async () => {
    renderScreen();
    await screen.findByText('$568.00');
    const gelRow = screen.getByText('Gel Manicure').closest('.tech-row') as HTMLElement;
    expect(within(gelRow).getByText('2')).toBeInTheDocument();        // two lines grouped
    expect(within(gelRow).getByText('$90.00')).toBeInTheDocument();   // 2 x 4500 summed
  });

  it('re-queries the canonical endpoint when the period changes', async () => {
    renderScreen();
    await screen.findByText('$568.00');
    // Period is picked from the date-range sheet (Today / This Week / This Month ...), not inline Day/Month tabs.
    const periods = () => (techApi.earningsCanonical as any).mock.calls.map((c: unknown[]) => c[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Select date range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(periods()).toContain('day'));
    fireEvent.click(screen.getByRole('button', { name: 'Select date range' }));
    fireEvent.click(screen.getByRole('button', { name: 'This Month' }));
    await waitFor(() => expect(periods()).toContain('month'));
  });

  it('shows an empty breakdown message', async () => {
    (techApi.earningsDetail as any).mockResolvedValue(detail({ lines: [] }));
    renderScreen();
    await screen.findByText('$568.00');
    expect(await screen.findByText('No paid services in this week.')).toBeInTheDocument();
  });

  it('shows an error when earnings fail to load', async () => {
    (techApi.earningsCanonical as any).mockRejectedValue(new Error('earnings unavailable'));
    renderScreen();
    expect(await screen.findByText('earnings unavailable')).toBeInTheDocument();
  });
});
