// CommissionImpactPanel.test.tsx — Extras · Deals & Offers 12: deals whose commission impact is not approved are flagged;
// the sample and the funding are the server's; Approve (compensation.manage only) posts once and reloads.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const approveCommission = vi.fn(async () => ({}));
let payload: any;
const commissionReviews = vi.fn(async () => payload);
vi.mock('../../api/posDealsOffersApi', () => ({ posDealsOffersApi: { commissionReviews: (...a: any[]) => (commissionReviews as any)(...a), approveCommission: (...a: any[]) => (approveCommission as any)(...a) } }));
import { CommissionImpactPanel } from './CommissionImpactPanel';

const row = (o: any = {}) => ({ dealId: 'd1', title: 'Gel 20% off', status: 'active', ownerType: 'salon', technicianName: null, version: 1, fundingNow: 'proportional',
  sample: { serviceName: 'Gel manicure', priceCents: 5000, discountCents: 1000, technicians: 2, earningsFullMinCents: 2000, earningsFullMaxCents: 3000, earningsDiscountedMinCents: 1600, earningsDiscountedMaxCents: 2400, changeMinCents: -600, changeMaxCents: -400 },
  review: null, flag: 'not_reviewed', ...o });
beforeEach(() => {
  approveCommission.mockClear(); commissionReviews.mockClear();
  payload = { items: [row(), row({ dealId: 'd2', title: 'Anything 10%', sample: null, flag: 'terms_changed', review: { reviewedAt: '2026-11-01T00:00:00Z', reviewedBy: 'Owner Kim', version: 1, funding: 'proportional', note: null } })],
    page: 1, pageSize: 10, totalItems: 2, totalPages: 1, flaggedTotal: 2, fundingNow: 'proportional' };
});

describe('Deals & Offers 12 — commission impact review panel', () => {
  it('shows the flag, the engine sample and the funding exactly as the server sent them; no service → "—"', async () => {
    render(<CommissionImpactPanel canApprove />);
    const rows = await screen.findAllByTestId('ci-row');
    expect(within(rows[0]).getByTestId('ci-flag').textContent).toBe('Not approved');
    expect(within(rows[0]).getByTestId('ci-earn').textContent).toBe('Technician earns $20.00 – $30.00 → $16.00 – $24.00 (2 technician(s))');
    expect(within(rows[1]).getByTestId('ci-flag').textContent).toBe('Terms changed since approval');
    expect(within(rows[1]).getByText('—')).toBeInTheDocument();
    expect(within(rows[1]).getByText('by Owner Kim · version 1')).toBeInTheDocument();
    expect(screen.getByTestId('ci-funding').textContent).toMatch(/shared — it comes off the commission base/);
    expect(commissionReviews).toHaveBeenCalledWith({ flagged: true, page: 1, pageSize: 10 });
  });
  it('Approve posts once for that deal and reloads; without compensation.manage there is no Approve button', async () => {
    const { unmount } = render(<CommissionImpactPanel canApprove />);
    fireEvent.click((await screen.findAllByTestId('ci-approve'))[0]);
    await waitFor(() => expect(approveCommission).toHaveBeenCalledWith('d1', null));
    await waitFor(() => expect(commissionReviews).toHaveBeenCalledTimes(2));
    unmount();
    render(<CommissionImpactPanel canApprove={false} />);
    await screen.findAllByTestId('ci-row');
    expect(screen.queryByTestId('ci-approve')).toBeNull();
  });
});
