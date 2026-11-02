// GiftCardReportScreen (owner, read-only): outstanding liability + active/total cards, and period issued/redeemed
// activity from /owner/gift-cards/report. Verifies KPI rendering, the activity card, the period-switch refetch, and error.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerCustomersApi: { giftCardReport: vi.fn() } }));

import { ownerCustomersApi } from '../api/ownerApi';
import { GiftCardReportScreen } from './GiftCardReportScreen';

const report = (over: any = {}) => ({
  range: { from: '2026-06-01T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' },
  outstandingCents: 426000, activeCount: 31, totalCards: 58,
  issuedCents: 120000, issuedCount: 12, redeemedCents: 54000, redeemedCount: 22,
  generatedAt: '2026-06-27T15:00:00.000Z',
  ...over,
});

const card = (label: string) => screen.getByText(label).closest('.owner-kpi') as HTMLElement;

describe('GiftCardReportScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); (ownerCustomersApi.giftCardReport as any).mockResolvedValue(report()); });

  it('renders the liability KPIs', async () => {
    render(<GiftCardReportScreen />);
    await waitFor(() => expect(screen.getByText('Outstanding Liability')).toBeInTheDocument());
    expect(card('Outstanding Liability')).toHaveTextContent('$4,260');
    expect(card('Active Cards')).toHaveTextContent('31');
    expect(card('Total Cards')).toHaveTextContent('58');
  });

  it('renders the period activity', async () => {
    render(<GiftCardReportScreen />);
    await waitFor(() => expect(screen.getByText('Issued')).toBeInTheDocument());
    expect(card('Issued')).toHaveTextContent('$1,200');
    expect(card('Issued')).toHaveTextContent('12 cards');
    expect(card('Redeemed')).toHaveTextContent('$540');
    expect(card('Redeemed')).toHaveTextContent('22 redemptions');
  });

  it('refetches when the period changes', async () => {
    render(<GiftCardReportScreen />);
    await waitFor(() => expect(ownerCustomersApi.giftCardReport).toHaveBeenCalledWith('month', undefined));
    fireEvent.click(screen.getByText('Quarter'));
    await waitFor(() => expect(ownerCustomersApi.giftCardReport).toHaveBeenCalledWith('quarter', undefined));
  });

  it('shows an error state', async () => {
    (ownerCustomersApi.giftCardReport as any).mockRejectedValue(new Error('nope'));
    render(<GiftCardReportScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
