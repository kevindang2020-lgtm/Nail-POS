// CustomersLoyaltyScreen (owner, read-only): retention/repeat + VIP/loyalty/gift-card + total/new/review KPIs, a loyalty
// points panel with tier rows, and a top-spenders list. Verifies KPI rendering, the loyalty panel, top spender, the period
// switch refetch, and the empty state. Data is typed from /owner/customers.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerCustomersApi: { overview: vi.fn() } }));

import { ownerCustomersApi } from '../api/ownerApi';
import { CustomersLoyaltyScreen } from './CustomersLoyaltyScreen';

const overview = (over: any = {}) => ({
  range: { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
  kpis: { totalCustomers: 1240, newCustomers: 86, retentionRatePercent: 62, repeatRatePercent: 48, vipCustomers: 236, loyaltyMembers: 128, giftCardOutstandingCents: 426000, giftCardCount: 31, reviewAverage: 4.8, reviewCount: 512 },
  loyalty: { pointsIssued: 50000, pointsRedeemed: 1260, pointsOutstanding: 48740, rewardRedemptionCount: 18, tiers: [{ tier: 'gold', customers: 40 }, { tier: 'silver', customers: 88 }] },
  topSpenders: [{ customerId: 'c1', name: 'Jennifer W.', lifetimeSpendCents: 128000, visits: 22 }],
  generatedAt: '2026-06-27T15:00:00.000Z',
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); (ownerCustomersApi.overview as any).mockResolvedValue(overview()); });

const card = (label: string) => screen.getByText(label).closest('.owner-kpi') as HTMLElement;

describe('CustomersLoyaltyScreen', () => {
  it('renders the headline KPIs', async () => {
    render(<CustomersLoyaltyScreen />);
    await waitFor(() => expect(screen.getByText('Retention Rate')).toBeInTheDocument());
    expect(card('Retention Rate')).toHaveTextContent('62%');
    expect(card('Repeat Rate')).toHaveTextContent('48%');
    expect(card('VIP Customers')).toHaveTextContent('236');
    expect(card('Loyalty Members')).toHaveTextContent('128');
    expect(card('Gift Cards')).toHaveTextContent('$4,260');
    expect(card('Review Score')).toHaveTextContent('4.8');
  });

  it('renders the loyalty points panel and tier rows', async () => {
    render(<CustomersLoyaltyScreen />);
    await waitFor(() => expect(screen.getByText('Points Issued')).toBeInTheDocument());
    expect(card('Redeemed')).toHaveTextContent('1,260');
    expect(card('Outstanding')).toHaveTextContent('48,740');
    expect(screen.getByText('gold')).toBeInTheDocument(); // capitalize is CSS-only; DOM text stays lowercase
    expect(screen.getByText('silver')).toBeInTheDocument();
  });

  it('renders the top spender with lifetime spend', async () => {
    render(<CustomersLoyaltyScreen />);
    await waitFor(() => expect(screen.getByText('Jennifer W.')).toBeInTheDocument());
    expect(screen.getByText('$1,280')).toBeInTheDocument();
    expect(screen.getByText(/22 visits/)).toBeInTheDocument();
  });

  it('refetches when the period changes', async () => {
    render(<CustomersLoyaltyScreen />);
    await waitFor(() => expect(ownerCustomersApi.overview).toHaveBeenCalledWith('month', undefined));
    fireEvent.click(screen.getByText('Quarter'));
    await waitFor(() => expect(ownerCustomersApi.overview).toHaveBeenCalledWith('quarter', undefined));
  });

  it('shows an empty state when there is no spend data', async () => {
    (ownerCustomersApi.overview as any).mockResolvedValue(overview({ topSpenders: [] }));
    render(<CustomersLoyaltyScreen />);
    await waitFor(() => expect(screen.getByText('No spend data yet.')).toBeInTheDocument());
  });
});
