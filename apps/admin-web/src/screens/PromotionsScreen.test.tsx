import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockOverview, mockApprove, mockDisable } = vi.hoisted(() => ({ mockOverview: vi.fn(), mockApprove: vi.fn(), mockDisable: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { promotionsOverview: () => mockOverview(), promotionApprove: (id: string) => mockApprove(id), promotionDisable: (id: string, reason: string) => mockDisable(id, reason) } }));

import { PromotionsScreen } from './PromotionsScreen';

const gap = (note: string) => ({ value: null, available: false, note });
const real = (value: number) => ({ value, available: true });
const overview = {
  kpis: {
    promotionTemplates: gap('No promotion-template schema'), activePromotions: real(78), scheduledPromotions: real(22), completedPromotions: real(164),
    platformOffers: real(24), discountRedemptions: real(12846), revenueImpactCents: real(12876400), abuseAlerts: gap('No abuse schema'),
    participatingBranches: real(342), averageDiscountPct: { value: 18.7, available: true }, redemptionRatePct: gap('No exposure denom'), highValuePending: real(11),
  },
  statusMix: { segments: [{ label: 'Active', value: 78, tone: 'ok' }, { label: 'Scheduled', value: 22, tone: 'warn' }, { label: 'Completed', value: 164, tone: 'info' }], total: 264 },
  trend: [{ day: '2026-05-06', redemptions: 1842, revenueCents: 1862000 }, { day: '2026-05-05', redemptions: 1500, revenueCents: 1600000 }],
  redemptionsVsRevenue: [{ day: '2026-05-06', redemptions: 1842, revenueCents: 1862000 }, { day: '2026-05-05', redemptions: 1500, revenueCents: 1600000 }],
  topPromotions: [{ id: 'c1', name: 'May Glow Up Special', tenant: 'Glamour Studio', branch: 'Downtown', offer: '20% OFF', status: 'Active', statusTone: 'ok', revenueCents: 2145000, redemptions: 1842, startAt: '2026-05-01T00:00:00Z', endAt: null }],
  tenantOversight: [{ tenantId: 't1', tenant: 'Glamour Studio', active: 8, redemptions: 2145, revenueCents: 2243000, lastActivity: '2026-05-06T13:15:00Z' }],
  offerExceptions: [{ id: 'o1', name: 'Holiday Special', tenant: 'Luxe Salon & Spa', issue: 'Expired but still active', severity: 'Medium' }],
  bottom: {
    redemptionsToday: real(1842), revenueTodayCents: real(1862000), newOffersToday: real(7),
    abuseCasesOpen: gap('No abuse schema'), approvalSlaHours: gap('No approval queue'), averageOfferRoi: gap('No promotion-cost schema'),
  },
  promotionMixByType: { available: true, segments: [{ label: 'Percentage Discount', value: 38 }, { label: 'Fixed Amount Discount', value: 20 }], total: 58 },
  abuseByStatus: { available: false, note: 'No abuse-detection schema' },
  abuseReview: { available: false, note: 'No abuse-case schema' },
  meta: { redemptionsLabel: 'Campaign-attributed bookings', revenueLabel: 'Gross attributed campaign revenue', activeRatePct: 29.5 },
};

beforeEach(() => { mockOverview.mockReset(); mockApprove.mockReset(); mockDisable.mockReset(); mockOverview.mockResolvedValue(overview); mockApprove.mockResolvedValue({ id: 'c1', status: 'approved' }); mockDisable.mockResolvedValue({ id: 'c1', status: 'disabled' }); });

describe('PromotionsScreen — Promotions & Offers', () => {
  it('renders the header, all 12 KPIs (real + honest gaps), controls, analytics, tables, quick actions, bottom cards', async () => {
    render(<MemoryRouter><PromotionsScreen /></MemoryRouter>);
    expect(await screen.findByText('Promotions & Offers')).toBeInTheDocument();
    expect(screen.getByText('Controls promotion templates, platform offers, and tenant-level promotion oversight.')).toBeInTheDocument();
    ['Promotion Templates', 'Active Promotions', 'Scheduled Promotions', 'Completed Promotions', 'Platform Offers', 'Discount Redemptions', 'Revenue Impact', 'Abuse Alerts', 'Participating Branches', 'Average Discount', 'Redemption Rate', 'High-Value Promos Pending'].forEach((l) => expect(screen.getAllByText(l).length).toBeGreaterThanOrEqual(1));
    // real values + honest gaps both present
    expect(screen.getAllByText('78').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Not connected').length).toBeGreaterThanOrEqual(4);
    // control sections
    expect(screen.getByText('Platform-Level Promotion Controls')).toBeInTheDocument();
    expect(screen.getByText('Tenant-Level Promotion Oversight')).toBeInTheDocument();
    ['Create Promotion Templates', 'Set Eligibility Rules', 'Approve High-Value Promotions', 'Disable Invalid Offers'].forEach((l) => expect(screen.getAllByText(l).length).toBeGreaterThanOrEqual(1));
    // analytics
    ['Promotion Performance Trend', 'Redemptions vs Revenue Impact', 'Promotion Mix by Type', 'Offer Status Overview', 'Abuse Alerts by Status'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    // tables
    expect(screen.getByText('Top Promotions This Week')).toBeInTheDocument();
    expect(screen.getByText('May Glow Up Special')).toBeInTheDocument();
    expect(screen.getByText('Offer Exceptions')).toBeInTheDocument();
    expect(screen.getByText('Expired but still active')).toBeInTheDocument();
    // bottom cards
    ['Total Redemptions Today', 'Promotion Revenue Today', 'New Offers Created', 'Abuse Cases Open', 'Approval SLA (Avg.)', 'Average Offer ROI'].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
  });

  it('renders all eight Quick Actions and Create Offer stays platform-safe', async () => {
    render(<MemoryRouter><PromotionsScreen /></MemoryRouter>);
    const panel = (await screen.findByText('Quick Actions')).closest('section')!;
    ['Create Template', 'Launch Platform Offer', 'Set Eligibility Rules', 'Approve Promotion', 'Review Abuse', 'Disable Offer', 'Track Redemptions', 'Export Report'].forEach((l) => expect(within(panel).getByRole('button', { name: l })).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ Create Offer'));
    expect(await screen.findByText(/never modifies a tenant-owned promotion/)).toBeInTheDocument();
  });

  it('shows honest gaps for unsourced widgets rather than fabricated data', async () => {
    render(<MemoryRouter><PromotionsScreen /></MemoryRouter>);
    await screen.findByText('Promotion Mix by Type');
    expect(screen.getByText(/No abuse-detection schema/)).toBeInTheDocument();
  });

  it('Approve Promotion needs a selection, then calls the approve endpoint on the selected row', async () => {
    render(<MemoryRouter><PromotionsScreen /></MemoryRouter>);
    const actions = (await screen.findByText('Quick Actions')).closest('section')!;
    fireEvent.click(within(actions).getByRole('button', { name: 'Approve Promotion' }));
    expect(await screen.findByText(/Select a promotion/)).toBeInTheDocument();
    expect(mockApprove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('May Glow Up Special'));
    fireEvent.click(within(actions).getByRole('button', { name: 'Approve Promotion' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve promotion' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(mockOverview).toHaveBeenCalledTimes(2));
  });

  it('Disable Offer requires a reason before calling the disable endpoint', async () => {
    render(<MemoryRouter><PromotionsScreen /></MemoryRouter>);
    const actions = (await screen.findByText('Quick Actions')).closest('section')!;
    fireEvent.click(screen.getByText('May Glow Up Special'));
    fireEvent.click(within(actions).getByRole('button', { name: 'Disable Offer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disable promotion' });
    const disableBtn = within(dialog).getByRole('button', { name: 'Disable' }) as HTMLButtonElement;
    expect(disableBtn.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Disable reason'), { target: { value: 'policy violation' } });
    expect(disableBtn.disabled).toBe(false);
    fireEvent.click(disableBtn);
    await waitFor(() => expect(mockDisable).toHaveBeenCalledWith('c1', 'policy violation'));
  });
});
