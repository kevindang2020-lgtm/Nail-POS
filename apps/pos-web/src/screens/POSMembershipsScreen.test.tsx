// POSMembershipsScreen — Membership Overview rebuild (Oct 29 2026): the five KPIs, the three panels, the four analytics and
// the ten Quick Actions stay; the search + period strip and the six tabs are added; a phone search opens Members.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api } = vi.hoisted(() => ({ api: { overview: vi.fn(), members: vi.fn(), memberDetail: vi.fn(), activity: vi.fn(), payments: vi.fn(), redemptions: vi.fn(), planList: vi.fn(), planPerformance: vi.fn(), discounts: vi.fn(),
  exportMembers: vi.fn(), exportPayments: vi.fn(), exportRedemptions: vi.fn(), previewReminders: vi.fn(), runReminders: vi.fn() } }));
vi.mock('../api/posMembershipsApi', () => ({ posMembershipsApi: api }));
import { POSMembershipsScreen, ReminderDialog } from './POSMembershipsScreen';

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-29' };
const ov = {
  kpis: { totalMembers: 2, newMembersThisMonth: 2, activeMembers: 2, activePctOfTotal: 100, membershipRevenueCents: 0, membershipPaymentsThisMonth: 0, revenueDeltaPct: null, expiringSoon: 0, expiringWindowDays: 7, canceledThisMonth: 0, canceledDeltaPct: null },
  plans: [{ planId: 'p1', name: 'VIP Nail Club', description: null, billingInterval: 'month', intervalCount: 1, priceCents: 0, isCustomPricing: true, status: 'active', isPopular: false, badge: null, memberCount: 2, revenueCents: 0 }],
  revenueSeries: [], statusBreakdown: [{ status: 'active', count: 2, pct: 100 }], statusTotal: 2, planDistribution: [{ planName: 'VIP Nail Club', count: 2, pct: 100, revenueCents: 0 }], distributionTotal: 2, topServices: [], rangeDays: 30,
};
const member = (id: string, name: string) => ({ membershipId: id, customerId: 'c' + id, customerName: name, avatarUrl: null, maskedPhone: '••• 1234', planId: 'p1', planName: 'VIP Nail Club', status: 'active', memberNumber: null,
  startedAt: '2026-10-20T12:00:00Z', nextDate: '2026-11-20T12:00:00Z', nextDateKind: 'renews', canceledAt: null, autoRenew: true, redemptions: 0, lifetimePaidCents: 0, lastPaymentStatus: null });
const page = (items: unknown[], extra = {}) => ({ period, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1, ...extra });
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.overview.mockResolvedValue(ov);
  api.members.mockResolvedValue(page([member('m1', 'Mai Le'), member('m2', 'mai le')]));
  api.activity.mockResolvedValue(page([{ id: 'a1', activityType: 'purchased', customerId: 'cm1', membershipId: 'm1', customerName: 'Mai Le', planName: 'VIP Nail Club', occurredAt: '2026-10-20T12:00:00Z', amountCents: null, status: null }], { types: [] }));
  api.planList.mockResolvedValue(page([{ planId: 'p1', name: 'VIP Nail Club', code: null, description: null, status: 'active', isPopular: false, badge: null, versionNumber: 1, billingInterval: 'month', intervalCount: 1, priceCents: 0, isCustomPricing: true, trialDays: null, activeMembers: 2, currentMembers: 2, benefits: 1, revenueThisMonthCents: 0, createdAt: '2026-10-01T12:00:00Z' }]));
});
const renderScreen = () => render(<MemoryRouter><POSMembershipsScreen /></MemoryRouter>);

describe('POSMembershipsScreen', () => {
  it('keeps the five KPIs, the three panels, the four analytics and all ten Quick Actions', async () => {
    renderScreen();
    expect((await screen.findAllByText('VIP Nail Club')).length).toBeGreaterThan(0);
    for (const t of ['Total Members', 'Expiring Soon', 'Canceled This Month', 'Membership Plans', 'Membership Activity', 'Membership Status', 'Plan Distribution', 'Top Membership Services']) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    const quick = screen.getByTestId('membership-quick');
    expect(quick.querySelectorAll('button')).toHaveLength(10);
    // two similar names stay two rows (two membership ids)
    expect(screen.getAllByTestId('member-li')).toHaveLength(2);
  });
  it('the six tabs are there; a phone search opens Members and searches the server', async () => {
    renderScreen();
    await screen.findAllByText('VIP Nail Club');
    for (const t of ['overview', 'members', 'plans', 'payments', 'benefits', 'activity']) expect(screen.getByTestId('tab-' + t)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('search'), { target: { value: '(856) 555-1234' } });
    expect(await screen.findByTestId('members-table', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(api.members).toHaveBeenCalledWith(expect.objectContaining({ q: '(856) 555-1234', filter: 'any' }));
  });
  it('Export scope review: rows are read, the real count + scope are shown, and the file is written only after Download', async () => {
    api.exportMembers.mockResolvedValue([{ customerName: 'Lan', planName: 'VIP', status: 'active', memberNumber: 'M1', joinDate: null, nextBillingAt: null, autoRenew: true }, { customerName: 'Mai', planName: 'VIP', status: 'active', memberNumber: 'M2', joinDate: null, nextBillingAt: null, autoRenew: false }]);
    const url = globalThis.URL as any; url.createObjectURL = vi.fn(() => 'blob:x'); url.revokeObjectURL = vi.fn();
    renderScreen();
    fireEvent.click(await screen.findByTestId('qa-export-members'));
    expect(await screen.findByTestId('export-preview-count')).toHaveTextContent('2');
    expect(url.createObjectURL).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('export-preview-go'));
    await waitFor(() => expect(url.createObjectURL).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('export-preview')).toBeNull();
  });
});

describe('Membership Overview 10 — consent-aware reminder preview with a text estimate', () => {
  const pv = (o: any = {}) => ({ withinDays: 7, due: 2, toRemind: 2, alreadyReminded: 0, inAppOnly: 0, texting: true,
    members: [{ membershipId: 'm1', customerId: 'c1', customerName: 'Mai Le', planName: 'VIP Nail Club', nextBillingAt: '2026-11-14T12:00:00Z', alreadyReminded: false, hasPhone: true, textOptedOut: true, segments: 0 },
      { membershipId: 'm2', customerId: 'c2', customerName: 'Linh Vo', planName: 'VIP Nail Club', nextBillingAt: '2026-11-15T12:00:00Z', alreadyReminded: false, hasPhone: true, textOptedOut: false, segments: 1 }],
    textOptedOut: 1, textEstimate: { texts: 1, segments: 1, metered: false }, ...o });
  it('shows who opted out (in-app only) and how many texts / segments would go out — nothing is sent by previewing', async () => {
    api.previewReminders.mockResolvedValue(pv());
    render(<MemoryRouter><ReminderDialog onClose={() => {}} onSent={() => {}} /></MemoryRouter>);
    expect(await screen.findByTestId('reminder-optout')).toHaveTextContent('1 opted out of texts (STOP)');
    expect(screen.getByTestId('reminder-estimate')).toHaveTextContent('Estimate: 1 texts · 1 SMS segments. Reminders are not counted against your SMS package.');
    expect(screen.getAllByTestId('reminder-stop')).toHaveLength(1);
    expect(api.runReminders).not.toHaveBeenCalled();
  });
  it('an older server (no opt-out data) or an in-app-only salon shows no consent or estimate line — never a made-up 0', async () => {
    api.previewReminders.mockResolvedValue(pv({ textOptedOut: null, textEstimate: undefined }));
    const v = render(<MemoryRouter><ReminderDialog onClose={() => {}} onSent={() => {}} /></MemoryRouter>);
    await screen.findAllByText('Mai Le');
    expect(screen.queryByTestId('reminder-optout')).toBeNull(); expect(screen.queryByTestId('reminder-estimate')).toBeNull();
    v.unmount();
    api.previewReminders.mockResolvedValue(pv({ texting: false }));
    render(<MemoryRouter><ReminderDialog onClose={() => {}} onSent={() => {}} /></MemoryRouter>);
    await screen.findAllByText('Mai Le');
    expect(screen.queryByTestId('reminder-estimate')).toBeNull();
  });
  it('extras Membership Overview 13·12 — Payments shows the server\'s monthly statement with the unconfirmed invoice share; an older server shows none', async () => {
    const totals = { collectedCents: 12300, refundedCents: 3900, netCents: 8400, failed: 1 };
    api.payments.mockResolvedValue(page([], { status: 'all', dateField: 'paid', totals, statement: [
      { month: '2026-11', payments: 7, collectedCents: 12300, refundedCents: 3900, netCents: 8400, failed: 1, cardCents: 1000, invoiceCents: 3500, recordedCents: 7800, invoiceConfirmedCents: 2000, invoiceUnconfirmedCents: 1500 },
      { month: '2026-10', payments: 1, collectedCents: 3900, refundedCents: 0, netCents: 3900, failed: 0, cardCents: 0, invoiceCents: 0, recordedCents: 3900, invoiceConfirmedCents: 0, invoiceUnconfirmedCents: 0 }] }));
    renderScreen();
    await screen.findAllByText('VIP Nail Club');
    fireEvent.click(screen.getByTestId('tab-payments'));
    const st = await screen.findByTestId('pay-statement');
    expect(st).toHaveTextContent('Monthly statement');
    expect(screen.getByTestId('stmt-2026-11')).toHaveTextContent('$123.00');
    expect(screen.getByTestId('stmt-unconfirmed-2026-11')).toHaveTextContent('$15.00 not confirmed by Invoices');
    expect(screen.queryByTestId('stmt-unconfirmed-2026-10')).toBeNull();
    api.payments.mockResolvedValue(page([], { status: 'all', dateField: 'paid', totals }));
  });
  it('an older server without a statement shows no statement panel — never invented months', async () => {
    api.payments.mockResolvedValue(page([], { status: 'all', dateField: 'paid', totals: { collectedCents: 0, refundedCents: 0, netCents: 0, failed: 0 } }));
    renderScreen();
    await screen.findAllByText('VIP Nail Club');
    fireEvent.click(screen.getByTestId('tab-payments'));
    await screen.findByTestId('pay-totals');
    expect(screen.queryByTestId('pay-statement')).toBeNull();
  });
});
