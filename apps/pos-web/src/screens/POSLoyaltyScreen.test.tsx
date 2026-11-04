// POSLoyaltyScreen — the one-screen overview (/pos/loyalty/overview + paged rewards / members / redemptions). The old
// /pos/loyalty/state client method is retired; a failed overview is an error with Retry, never zeros.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { overview: vi.fn(), rewards: vi.fn(), members: vi.fn(), redemptions: vi.fn(), redeem: vi.fn(), createReward: vi.fn(), tiers: vi.fn(), createTier: vi.fn(), updateTier: vi.fn(), setMemberTier: vi.fn() } }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
vi.mock('../api/posLoyaltyApi', () => ({ posLoyaltyApi: api }));
import { POSLoyaltyScreen } from './POSLoyaltyScreen';

const empty = { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 };
const overview = { period: { label: 'This month', start: '2026-10-01', timeZone: 'America/New_York' }, kpis: { loyaltyMembers: 2, newMembersThisMonth: 1, pointsOutstanding: 620, balanceReconciled: true, activeRewards: 1, totalRewards: 2, redemptionsThisMonth: 1, redemptionsPending: 0, pointsRedeemedThisMonth: 200 },
  tiers: [{ tier: 'VIP', members: 1, points: 500 }, { tier: 'Regular', members: 1, points: 120 }] };
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.overview.mockResolvedValue(overview); api.rewards.mockResolvedValue(empty); api.members.mockResolvedValue(empty); api.redemptions.mockResolvedValue(empty);
});
const mount = () => render(<MemoryRouter><POSLoyaltyScreen /></MemoryRouter>);

describe('POSLoyaltyScreen', () => {
  it('shows the server\'s KPIs and tiers', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('kpi-points')).toHaveTextContent('620'));
    expect(screen.getByTestId('kpi-members')).toHaveTextContent('2');
    expect(screen.getByTestId('panel-tiers')).toHaveTextContent('VIP');
  });
  it('a failed overview is an error with Retry — never zeros', async () => {
    api.overview.mockRejectedValue({ status: 503 });
    mount();
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-points')).toBeNull();
  });
  it('a front-desk redemption shows the reward code in the dialog until Done (it used to close at once, code unseen)', async () => {
    const m = { customerId: 'c1', customerName: 'Ann Lee', avatarUrl: null, maskedPhone: null, tier: 'VIP', pointsBalance: 500, totalEarned: 500, totalRedeemed: 0, enrolledAt: null };
    api.members.mockResolvedValue({ ...empty, items: [m], totalItems: 1 });
    api.rewards.mockResolvedValue({ ...empty, items: [{ id: 'r1', title: 'Free polish', pointsCost: 200, kind: 'service', valueCents: 1500, status: 'active' }], totalItems: 1 });
    api.redeem.mockResolvedValue({ code: 'LR-7Q4K', balanceAfter: 300 });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Redeem reward' }));
    const dlg = await screen.findByTestId('dlg-redeem');
    fireEvent.click(await within(dlg).findByText('Free polish'));
    fireEvent.click(screen.getByTestId('redeem-confirm'));
    expect(await screen.findByTestId('redeem-code')).toHaveTextContent('LR-7Q4K');
    expect(screen.getByTestId('dlg-redeem')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('redeem-done'));
    await waitFor(() => expect(screen.queryByTestId('dlg-redeem')).toBeNull());
  });
  it('the catalog says why a reward cannot be redeemed, and the redeem picker blocks it (out of stock, ended, wrong tier); later pages are reachable', async () => {
    const m = { customerId: 'c1', customerName: 'Ann Lee', avatarUrl: null, maskedPhone: null, tier: 'Regular', pointsBalance: 900, totalEarned: 900, totalRedeemed: 0, enrolledAt: null };
    api.members.mockResolvedValue({ ...empty, items: [m], totalItems: 1 });
    const base = { description: '', active: true, rewardType: 'amount_off', valueCents: 500, percent: 0, validDays: null, createdAt: null, redemptions: 2, redemptionsThisMonth: 0 };
    const items = [
      { ...base, id: 'r1', title: 'Gone', pointsCost: 10, stockTotal: 2, stockLeft: 0, availability: 'out_of_stock' },
      { ...base, id: 'r2', title: 'Old', pointsCost: 10, endsOn: '2026-01-01', availability: 'expired' },
      { ...base, id: 'r3', title: 'VIP only', pointsCost: 10, eligibleTiers: ['VIP'], availability: 'available' },
      { ...base, id: 'r4', title: 'Open', pointsCost: 10, availability: 'available' },
    ];
    api.rewards.mockImplementation(async (q: any) => q.page === 2 ? { items: [{ ...base, id: 'r9', title: 'Page two reward', pointsCost: 10, availability: 'available' }], page: 2, pageSize: 20, totalItems: 21, totalPages: 2 } : { items, page: 1, pageSize: q.pageSize, totalItems: q.status ? 21 : 4, totalPages: q.status ? 2 : 1 });
    mount();
    expect(await screen.findByTestId('reward-avail-r1')).toHaveTextContent('Out of stock');
    expect(screen.getByTestId('reward-avail-r2')).toHaveTextContent('Ended');
    expect(screen.getByTestId('reward-avail-r4')).toHaveTextContent(/active/i);
    fireEvent.click(await screen.findByRole('button', { name: 'Redeem reward' }));
    const dlg = await screen.findByTestId('dlg-redeem');
    expect(await within(dlg).findByTestId('redeem-pick-r1')).toBeDisabled();
    expect(within(dlg).getByTestId('redeem-pick-r2')).toBeDisabled();
    expect(within(dlg).getByTestId('redeem-pick-r3')).toBeDisabled();
    expect(within(dlg).getByTestId('redeem-pick-r3')).toHaveTextContent("Not for this member's tier");
    expect(within(dlg).getByTestId('redeem-pick-r4')).not.toBeDisabled();
    fireEvent.click(within(dlg).getByRole('button', { name: /next/i }));
    expect(await within(dlg).findByText('Page two reward')).toBeInTheDocument();
  });
  it('a new reward carries its dates, stock, per-member limit and eligible tiers', async () => {
    api.createReward.mockResolvedValue({});
    mount();
    await waitFor(() => expect(screen.getByTestId('kpi-points')).toHaveTextContent('620'));
    fireEvent.click((await screen.findAllByRole('button', { name: /create (your first )?reward/i }))[0]!);
    const dlg = await screen.findByTestId('dlg-reward');
    fireEvent.change(within(dlg).getByPlaceholderText(/\$10 off/i), { target: { value: 'Spring set' } });
    fireEvent.change(within(dlg).getByLabelText('Points cost'), { target: { value: '150' } });
    fireEvent.change(within(dlg).getByLabelText('Dollars off'), { target: { value: '5.00' } });
    fireEvent.change(within(dlg).getByTestId('reward-starts'), { target: { value: '2026-12-01' } });
    fireEvent.change(within(dlg).getByTestId('reward-ends'), { target: { value: '2026-11-01' } });
    fireEvent.change(within(dlg).getByTestId('reward-stock'), { target: { value: '25' } });
    fireEvent.change(within(dlg).getByTestId('reward-limit'), { target: { value: '1' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'VIP' }));
    fireEvent.click(within(dlg).getByRole('button', { name: /save reward/i }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('The end date is before the start date.');
    expect(api.createReward).not.toHaveBeenCalled();
    fireEvent.change(within(dlg).getByTestId('reward-ends'), { target: { value: '2027-01-31' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /save reward/i }));
    await waitFor(() => expect(api.createReward).toHaveBeenCalledWith(expect.objectContaining({ title: 'Spring set', startsOn: '2026-12-01', endsOn: '2027-01-31', stockTotal: 25, perMemberLimit: 1, eligibleTiers: ['VIP'] })));
  });
  it('Manage Tiers lists configured tiers with threshold and benefits, sets up a label-only tier, and shows a refused retire', async () => {
    let list: any = { items: [{ id: 't1', name: 'VIP', rank: 1, minPoints: 1000, benefits: 'Free polish', active: true, members: 1 }], unconfigured: [{ name: 'Regular', members: 1 }] };
    api.tiers.mockImplementation(async () => list);
    api.createTier.mockImplementation(async (b: any) => { list = { items: [...list.items, { id: 't2', ...b, members: 1 }], unconfigured: [] }; return list.items[1]; });
    api.updateTier.mockRejectedValue({ status: 409, code: 'LOYALTY_TIER_IN_USE', message: 'Members are in this tier.' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /manage tiers/i }));
    const dlg = await screen.findByTestId('dlg-tiers');
    expect(await within(dlg).findByTestId('tier-row-VIP')).toHaveTextContent('Free polish');
    expect(within(dlg).getByTestId('tier-row-VIP')).toHaveTextContent('1,000');
    expect(within(dlg).getByTestId('tier-row-Regular')).toHaveTextContent('Label only');
    fireEvent.click(within(dlg).getByTestId('tier-setup-Regular'));
    expect(within(dlg).getByTestId('tier-name')).toHaveValue('Regular');
    fireEvent.change(within(dlg).getByTestId('tier-threshold'), { target: { value: '0' } });
    fireEvent.click(within(dlg).getByTestId('tier-save'));
    await waitFor(() => expect(api.createTier).toHaveBeenCalledWith(expect.objectContaining({ name: 'Regular', minPoints: 0, active: true })));
    expect(await within(dlg).findByRole('status')).toHaveTextContent('Tier Regular saved.');
    fireEvent.click(within(dlg).getByTestId('tier-edit-VIP'));
    fireEvent.click(within(dlg).getByTestId('tier-active'));
    fireEvent.click(within(dlg).getByTestId('tier-save'));
    expect(await within(dlg).findByRole('alert')).toBeInTheDocument();
    expect(api.updateTier).toHaveBeenCalledWith('t1', expect.objectContaining({ active: false }));
  });
  it('an owner moves a member to another tier with a reason; members can be filtered by status and sorted', async () => {
    const m = { customerId: 'c1', customerName: 'Ann Lee', avatarUrl: null, maskedPhone: null, tier: 'Regular', pointsBalance: 500, totalEarned: 500, totalRedeemed: 0, enrolledAt: null };
    api.members.mockResolvedValue({ ...empty, items: [m], totalItems: 1 });
    api.tiers.mockResolvedValue({ items: [{ id: 't1', name: 'VIP', rank: 1, minPoints: null, benefits: '', active: true, members: 0 }, { id: 't9', name: 'Old', rank: 2, minPoints: null, benefits: '', active: false, members: 0 }], unconfigured: [] });
    api.setMemberTier.mockResolvedValue({ ...m, tier: 'VIP' });
    mount();
    fireEvent.click(await screen.findByTestId('member-tier-c1'));
    const dlg = await screen.findByTestId('dlg-member-tier');
    const pick = await within(dlg).findByTestId('member-tier-pick');
    expect(Array.from((pick as HTMLSelectElement).options).map((o) => o.value)).toEqual(['', 'VIP']);   // retired and current tiers are not offered
    fireEvent.change(pick, { target: { value: 'VIP' } });
    expect(within(dlg).getByTestId('member-tier-save')).toBeDisabled();   // a reason is required
    fireEvent.change(within(dlg).getByTestId('member-tier-reason'), { target: { value: 'loyal guest' } });
    fireEvent.click(within(dlg).getByTestId('member-tier-save'));
    await waitFor(() => expect(api.setMemberTier).toHaveBeenCalledWith('c1', { tier: 'VIP', reason: 'loyal guest' }));
    await waitFor(() => expect(screen.queryByTestId('dlg-member-tier')).toBeNull());
    fireEvent.change(screen.getByTestId('members-status'), { target: { value: 'inactive' } });
    await waitFor(() => expect(api.members).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'inactive', page: 1 })));
    fireEvent.change(screen.getByTestId('members-sort'), { target: { value: 'balance' } });
    await waitFor(() => expect(api.members).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'balance', status: 'inactive', page: 1 })));
  });
});

