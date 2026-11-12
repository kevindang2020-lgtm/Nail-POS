// POSAICampaignResultsScreen — Campaign Results guide (Nov 3 2026): period totals from their own sources, Campaign Center's campaign
// list, and per campaign every stage with what it is checked against. Loading never sends.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { c, cc } = vi.hoisted(() => ({ c: { summary: vi.fn(), check: vi.fn() }, cc: { list: vi.fn(), detail: vi.fn() } }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { center: c } }));
vi.mock('../api/posCampaignCenterApi', () => ({ posCampaignCenterApi: cc }));
import { POSAICampaignResultsScreen } from './POSAICampaignResultsScreen';
const counts = { selected: 10, selectedIsEstimate: false, eligible: 8, excluded: 2, queued: 0, attempted: 8, submitted: 8, skippedAtSend: 0, failed: 1, delivered: 6, unknown: 1, simulated: 0,
  booked: 2, redemptions: 1, discountCents: 500, associatedRevenueCents: 6500, legacyRevenueCents: 0, legacySentCount: 0, actualCostCents: 28, roi: null, roiNote: '' };
beforeEach(() => {
  vi.clearAllMocks();
  c.summary.mockResolvedValue({ period: { today: '2026-11-03' }, cards: { messagesSent: 8, delivered: 6, failed: 1, bookings: 2, completedVisits: 1, associatedRevenueCents: 6500, associatedTickets: 1, actualCostCents: 28, costPerBookingCents: 14 }, definitions: { associatedRevenue: 'x' } });
  cc.list.mockResolvedValue({ items: [{ id: 'c1', name: 'Gel rebooking', status: 'completed', displayStatus: 'completed', outcome: null, origin: 'assistant', channel: 'sms', budgetCents: 500, createdAt: '2026-11-01T10:00:00Z', counts }],
    pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 }, period: { today: '2026-11-03' } });
  cc.detail.mockResolvedValue({ id: 'c1', name: 'Gel rebooking', displayStatus: 'completed', outcome: null, channel: 'sms', createdAt: '2026-11-01T10:00:00Z', budgetCents: 500, counts });
});

describe('POSAICampaignResultsScreen', () => {
  it('period totals: accepted / delivered / failed, bookings and visits, cost per booking', async () => {
    render(<MemoryRouter><POSAICampaignResultsScreen /></MemoryRouter>);
    expect(await screen.findByTestId('amk-res-sent')).toHaveTextContent('6 delivered · 1 failed');
    expect(screen.getByTestId('amk-res-bookings')).toHaveTextContent('1 became completed visits');
    expect(screen.getByTestId('amk-res-costPerBooking')).toHaveTextContent('$0.14');
    fireEvent.click(screen.getByTestId('amk-preset-year'));
    expect(c.summary).toHaveBeenLastCalledWith({ preset: 'year' });
  });
  it('a campaign opens its funnel: each stage, its source, money spent vs budget', async () => {
    render(<MemoryRouter><POSAICampaignResultsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('amk-lib-open'));
    expect(cc.detail).toHaveBeenCalledWith('c1');
    expect(await screen.findByTestId('amk-stage-delivered')).toHaveTextContent('The provider delivery report');
    expect(screen.getByTestId('amk-stage-unknown')).toHaveTextContent('1');
    expect(screen.getByTestId('amk-stage-cost')).toHaveTextContent('$0.28');
    expect(screen.getByTestId('amk-res-detail')).toHaveTextContent('does not prove the campaign caused the visit');
  });
  it('Campaign Results 08 + 17: the open campaign stays highlighted; two to four ticked campaigns compare side by side with the server\'s rates (N/A when it has none)', async () => {
    const row2 = { id: 'c2', name: 'Spring email', status: 'completed', displayStatus: 'completed', outcome: null, origin: 'manual', channel: 'email', budgetCents: 0, createdAt: '2026-10-20T10:00:00Z',
      counts: { ...counts, selected: 5, eligible: 5, submitted: 0, delivered: 0, booked: 0, associatedRevenueCents: 0, actualCostCents: null, deliveryRatePercent: null, costPerBookingCents: null } };
    cc.list.mockResolvedValue({ items: [{ id: 'c1', name: 'Gel rebooking', status: 'completed', displayStatus: 'completed', outcome: null, origin: 'assistant', channel: 'sms', budgetCents: 500, createdAt: '2026-11-01T10:00:00Z',
      counts: { ...counts, deliveryRatePercent: 75, costPerBookingCents: 14 } }, row2], pagination: { page: 1, pageSize: 10, totalItems: 2, totalPages: 1 }, period: { today: '2026-11-03' } });
    render(<MemoryRouter><POSAICampaignResultsScreen /></MemoryRouter>);
    const rows = await screen.findAllByTestId('amk-lib-row');
    fireEvent.click(screen.getAllByTestId('amk-lib-open')[0]);
    await screen.findByTestId('amk-res-detail');
    expect(rows[0]).toHaveAttribute('aria-selected', 'true'); expect(rows[1]).not.toHaveAttribute('aria-selected');
    expect(screen.getByTestId('amk-cmp-open')).toBeDisabled();
    const picks = screen.getAllByTestId('amk-cmp-pick');
    fireEvent.click(picks[0]); fireEvent.click(picks[1]);
    expect(screen.getByTestId('amk-cmp-bar')).toHaveTextContent('2 of 4 picked');
    fireEvent.click(screen.getByTestId('amk-cmp-open'));
    const t = await screen.findByTestId('amk-cmp-table');
    expect(t).toHaveTextContent('Gel rebooking'); expect(t).toHaveTextContent('Spring email');
    expect(screen.getByTestId('amk-cmp-deliveryRate')).toHaveTextContent(/75%\s*N\/A/);
    expect(screen.getByTestId('amk-cmp-costPerBooking')).toHaveTextContent(/\$0\.14\s*N\/A/);
    expect(screen.getByTestId('amk-cmp-eligible')).toHaveTextContent('8');
    expect(screen.getByTestId('amk-cmp')).toHaveTextContent('does not prove the campaign caused the visit');
  });
});
