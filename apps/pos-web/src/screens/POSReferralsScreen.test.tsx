// POSReferralsScreen — Referral Program guide (Oct 30 2026): the four original KPI cards (Rewards Paid is cash only → $0.00 with
// the reason), the honest empty state with codes, the Record a Referral form (check is read-only; record sends an idempotency
// key), the server query for search / tab / page size, the overlay's Open Booking handoff and the manager-only review actions.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api, cust, navigate, perms } = vi.hoisted(() => ({
  api: { summary: vi.fn(), referrals: vi.fn(), approvals: vi.fn(), referral: vi.fn(), check: vi.fn(), record: vi.fn(), review: vi.fn(), issue: vi.fn(), reverse: vi.fn(), codes: vi.fn(), codeStatus: vi.fn(), health: vi.fn(), healthRun: vi.fn(), healthLast: vi.fn(), filterOptions: vi.fn(), settings: vi.fn(), saveSettings: vi.fn(), plan: vi.fn(), save: vi.fn() },
  cust: { quickSearch: vi.fn() }, navigate: vi.fn(), perms: { list: ['marketing.view', 'marketing.manage', 'customers.view'] as string[] } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posReferralProgramApi', () => ({ posReferralProgramApi: api }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: cust }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => perms.list.includes(p) }));
import { POSReferralsScreen } from './POSReferralsScreen';

const SUM = { codes: 2, codesActive: 2, totalReferrals: 0, waitingForVisit: 0, qualified: 0, underReview: 0, pendingApproval: 0, pendingReward: 0, issuedRewards: 0, issuedPoints: 0, blockedPayouts: 0,
  failedIssuance: 0, reversedRewards: 0, cashPaidCents: 0, cashPaidEvidence: 'none', associatedRevenueCents: 0, legacyMarked: { count: 0, cents: 0 }, policy: { configured: false, version: 0 }, lastUpdated: '2026-10-31T12:00:00Z' };
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, today: '2026-10-31' });
const ROW = { id: 'r1', code: 'RITA10', state: 'REWARD_PENDING_APPROVAL', recordedAt: '2026-10-30T15:00:00Z', version: 2, flags: [], referrer: { customerId: 'c1', name: 'Rita Referrer', phone: '•••• 0101' },
  referred: { customerId: 'c2', name: 'Nia New', phone: '•••• 0103' }, reward: { id: 'w1', state: 'PENDING_APPROVAL', type: 'loyalty_points', points: 50 }, ticket: { number: '9001', totalCents: 6500 }, matchedAs: null };
const mount = () => render(<MemoryRouter><POSReferralsScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(api), cust.quickSearch, navigate]) f.mockReset();
  perms.list = ['marketing.view', 'marketing.manage', 'customers.view'];
  api.summary.mockResolvedValue(SUM); api.referrals.mockResolvedValue(page([])); api.approvals.mockResolvedValue(page([])); api.health.mockResolvedValue({ overall: 'ready', items: [] });
  api.healthRun.mockResolvedValue({ overall: 'ready', items: [] }); api.healthLast.mockResolvedValue(null);
  api.filterOptions.mockResolvedValue({ creators: [{ id: 'u1', name: 'Olivia Owner' }], reviewers: [{ id: 'u2', name: 'Mia Manager' }], branches: [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Mall' }] });
});

describe('POSReferralsScreen', () => {
  it('keeps the four original KPI cards; Rewards Paid is cash with proof only ($0.00) and the empty state is honest', async () => {
    mount();
    expect(await screen.findByText('No referrals recorded yet')).toBeInTheDocument();
    for (const l of ['Referral Codes', 'Total Referrals', 'Pending Reward', 'Rewards Paid']) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    expect(screen.getByTestId('rfp-kpi-paid')).toHaveTextContent('$0.00');
    expect(screen.getByTestId('rfp-kpi-codes')).toHaveTextContent('2');
    expect(screen.getByTestId('rfp-no-policy')).toBeInTheDocument();
  });
  it('asks the server for search / tab / page size (newest first by default)', async () => {
    mount(); await screen.findByText('No referrals recorded yet');
    fireEvent.change(screen.getByTestId('rfp-search'), { target: { value: '0103' } });
    await waitFor(() => expect(api.referrals).toHaveBeenLastCalledWith(expect.objectContaining({ q: '0103', tab: 'all', sort: 'newest', page: 1, pageSize: 20 })));
    fireEvent.click(screen.getByTestId('rfp-tab-review'));
    await waitFor(() => expect(api.referrals).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'review', page: 1 })));
  });
  it('Check Referral Eligibility is read-only; Record sends ONE idempotency key', async () => {
    cust.quickSearch.mockResolvedValue({ items: [{ customerId: 'c2', displayName: 'Nia New', phone: '•••• 0103' }] });
    api.check.mockResolvedValue({ result: 'ELIGIBLE_TO_RECORD', reasons: [{ code: 'code_valid', ok: true, text: 'Code RITA10 is active' }] });
    api.record.mockResolvedValue({ id: 'r9', duplicate: false });
    api.referral.mockResolvedValue({ ...ROW, id: 'r9', state: 'PENDING_QUALIFICATION', reward: null, overview: { id: 'r9', code: 'RITA10' }, referrerProfile: ROW.referrer, referredProfile: null, visit: null, rewardDetail: null, communication: { note: 'none' }, audit: [] });
    mount(); await screen.findByText('No referrals recorded yet');
    fireEvent.change(screen.getByTestId('rfp-code'), { target: { value: 'RITA10' } });
    fireEvent.change(screen.getByTestId('rfp-find'), { target: { value: 'Nia' } });
    fireEvent.click(await screen.findByTestId('rfp-hit'));
    fireEvent.click(screen.getByTestId('rfp-check'));
    expect(await screen.findByTestId('rfp-verdict')).toHaveTextContent('Eligible to record');
    expect(api.record).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('rfp-record-btn'));
    await waitFor(() => expect(api.record).toHaveBeenCalledWith(expect.objectContaining({ code: 'RITA10', referredCustomerId: 'c2', idempotencyKey: expect.any(String) })));
  });
  it('the overlay opens Booking with the referred customer and offers Approve to a manager only', async () => {
    api.referrals.mockResolvedValue(page([ROW])); api.summary.mockResolvedValue({ ...SUM, totalReferrals: 1, pendingReward: 1 });
    api.referral.mockResolvedValue({ ...ROW, overview: { id: 'r1', code: 'RITA10', branch: 'Main', recordedAt: ROW.recordedAt }, referrerProfile: ROW.referrer, referredProfile: { ...ROW.referred, completedVisits: 1, consent: { sms: true, email: false }, appointments: [] },
      visit: { ticketId: 't1', number: '9001', totalCents: 6500, payments: [], refunds: [] }, rewardDetail: { id: 'w1', state: 'PENDING_APPROVAL', type: 'loyalty_points', points: 50, disposition: 'pending_approval' }, communication: { note: 'none' }, audit: [] });
    mount();
    fireEvent.click(await screen.findByTestId('rfp-open'));
    expect(await screen.findByTestId('rfp-approve')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rfp-book'));
    expect(navigate).toHaveBeenCalledWith('/booking/new?customerId=c2&from=referrals');
  });
  it('a role without marketing.manage sees no Approve / Record actions', async () => {
    perms.list = ['marketing.view'];
    api.referrals.mockResolvedValue(page([ROW]));
    api.referral.mockResolvedValue({ ...ROW, overview: { id: 'r1', code: 'RITA10' }, referrerProfile: ROW.referrer, referredProfile: null, visit: null, rewardDetail: { id: 'w1', state: 'PENDING_APPROVAL', type: 'loyalty_points', points: 50, disposition: 'pending_approval' }, communication: { note: 'none' }, audit: [] });
    mount();
    fireEvent.click(await screen.findByTestId('rfp-open'));
    await screen.findByTestId('rfp-dialog');
    expect(screen.queryByTestId('rfp-approve')).not.toBeInTheDocument();
    expect(screen.getByTestId('rfp-record-btn')).toBeDisabled();
  });
  it('a 403 from the server shows the permission message (merged from the old .403 test)', async () => {
    api.summary.mockRejectedValue({ status: 403, code: 'PERMISSION_DENIED' });
    mount();
    expect(await screen.findByText('Your role cannot view the Referral Program.')).toBeInTheDocument();
  });
  it('A18 Nov 6: risk / branch / recorded-by / reviewed-by filters go to the server', async () => {
    mount();
    fireEvent.change(await screen.findByTestId('rfp-f-risk'), { target: { value: 'flagged' } });
    fireEvent.change(screen.getByTestId('rfp-f-branch'), { target: { value: 'b2' } });
    fireEvent.change(screen.getByTestId('rfp-f-creator'), { target: { value: 'u1' } });
    fireEvent.change(screen.getByTestId('rfp-f-reviewer'), { target: { value: 'u2' } });
    await waitFor(() => expect(api.referrals).toHaveBeenLastCalledWith(expect.objectContaining({ eligibility: 'flagged', branch: 'b2', creator: 'u1', reviewer: 'u2', page: 1 })));
  });
  it('Financial Liability Preview: shows what is still owed (points, unpaid cash, open + pending vouchers) and "nothing" when clear', async () => {
    api.summary.mockResolvedValue({ ...SUM, liability: { pointsOwed: 50, pointsRewards: 1, cashOwedCents: 1000, cashRewards: 1, vouchersOpenCents: 2000, vouchersOpen: 2, vouchersExpiring30d: 1, vouchersPendingCents: 1000, vouchersPending: 1, moneyOwedCents: 3000 } });
    const v = mount();
    const strip = await screen.findByTestId('rfp-liability');
    expect(strip).toHaveTextContent('50 points waiting to be issued (1 rewards)');
    expect(strip).toHaveTextContent('$10.00 cash not paid');
    expect(strip).toHaveTextContent('$20.00 in 2 open vouchers (1 expire within 30 days)');
    expect(strip).toHaveTextContent('$10.00 in 1 vouchers that open after a paid first visit');
    v.unmount();
    api.summary.mockResolvedValue({ ...SUM, liability: { pointsOwed: 0, pointsRewards: 0, cashOwedCents: 0, cashRewards: 0, vouchersOpenCents: 0, vouchersOpen: 0, vouchersExpiring30d: 0, vouchersPendingCents: 0, vouchersPending: 0, moneyOwedCents: 0 } });
    mount();
    expect(await screen.findByTestId('rfp-liability')).toHaveTextContent('nothing — no unissued rewards and no open vouchers.');
  });
});
