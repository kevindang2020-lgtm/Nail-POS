// OwnerDealsCard.test.tsx — BUILD_PLAN Phase 5 in the Owner App: deals given away net of refunds, unpaid on tickets,
// the approval queue (approve; reject needs a reason the technician sees), pause, and an honest "not running" state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api: Record<string, any> = { summary: vi.fn(), approve: vi.fn(), reject: vi.fn(), pause: vi.fn() };
vi.mock('../api/ownerDealsApi', () => ({ ownerDealsApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
import { OwnerDealsCard } from './OwnerDealsCard';

const summary = (over: any = {}) => ({
  dashboard: { days: 30, live: { active: 2, scheduled: 1, pendingApproval: 1, activeCoupons: 0 }, totals: { openApplications: 2, openDiscountCents: 900, redemptions: 7, netDiscountCents: 7000, views: 40, reversals: 1 },
    top: [{ dealId: 'd1', title: 'Spring Gel', kind: 'deal', status: 'active', redemptions: 7, discountedCents: 7000, conversion: 17.5 }] },
  pending: [{ id: 'p1', title: 'Lisa weekday gel', ownerType: 'technician', technicianId: 't1', discountType: 'percent', discountPercent: 15, discountCents: null, originalPriceCents: 5000, finalPriceCents: 4250, status: 'pending_approval', createdAt: '2026-10-01' }],
  switches: { running: true, reason: null, stackingPolicy: 'best_single', allowTechnicianDeals: 'on_with_approval', maxActiveDeals: 5 },
  ...over,
});
beforeEach(() => { for (const f of Object.values(api)) f.mockReset(); api.summary.mockResolvedValue(summary()); });

describe('Owner deals', () => {
  it('shows net giveaway, refunds, unpaid-on-ticket and the plan limit', async () => {
    render(<OwnerDealsCard />);
    const card = await screen.findByTestId('owner-deals');
    expect(card).toHaveTextContent('$70.00');
    expect(card).toHaveTextContent('1 refunded back');
    expect(card).toHaveTextContent('2 unpaid ticket(s) carry $9.00');
    expect(card).toHaveTextContent('limit 5');
    expect(screen.getByTestId('owner-top-deal')).toHaveTextContent('17.5% of views');
  });

  it('approves a pending deal and reloads', async () => {
    api.approve.mockResolvedValue({});
    render(<OwnerDealsCard />);
    fireEvent.click(await screen.findByText('Approve'));
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith('p1'));
    expect(await screen.findByRole('status')).toHaveTextContent('Lisa weekday gel approved.');
    expect(api.summary).toHaveBeenCalledTimes(2);
  });

  it('rejecting needs a reason, which is sent', async () => {
    api.reject.mockResolvedValue({});
    render(<OwnerDealsCard />);
    fireEvent.click(await screen.findByText('Reject…'));
    expect(screen.getByText('Send back')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Keep it to 10% on gel' } });
    fireEvent.click(screen.getByText('Send back'));
    await waitFor(() => expect(api.reject).toHaveBeenCalledWith('p1', 'Keep it to 10% on gel'));
  });

  it('pauses a live deal', async () => {
    api.pause.mockResolvedValue({});
    render(<OwnerDealsCard />);
    fireEvent.click(await screen.findByText('Pause'));
    await waitFor(() => expect(api.pause).toHaveBeenCalledWith('d1'));
  });

  it('says plainly when deals are not running and why', async () => {
    api.summary.mockResolvedValue(summary({ switches: { running: false, reason: 'Deals are not part of this salon’s plan.', stackingPolicy: 'best_single', allowTechnicianDeals: 'off', maxActiveDeals: null } }));
    render(<OwnerDealsCard />);
    expect(await screen.findByTestId('deals-off')).toHaveTextContent('not part of this salon’s plan');
  });

  it('a server refusal on approve is shown', async () => {
    api.approve.mockRejectedValue(new Error('Only a pending deal can be approved (this one is approved).'));
    render(<OwnerDealsCard />);
    fireEvent.click(await screen.findByText('Approve'));
    expect(await screen.findByRole('status')).toHaveTextContent('Only a pending deal can be approved');
  });
});
