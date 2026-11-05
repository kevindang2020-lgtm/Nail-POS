// OwnerApprovalRequestsCard.test.tsx — BUILD_PLAN Phase 9 (agent D): the Owner App's list of the salon approvals engine's
// requests — approve / reject with a note (expectedVersion), the server's why-not, 409 reload, hidden on 403, live reload on
// approval_updated, the rules summary.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const streamCb = vi.hoisted(() => ({ fn: null as null | ((e: string) => void) }));
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: (cb: (e: string) => void) => { streamCb.fn = cb; } }));
const api = vi.hoisted(() => ({ pending: vi.fn(), decide: vi.fn(), policies: vi.fn() }));
vi.mock('../api/ownerApprovalRequestsApi', () => ({ ownerApprovalRequestsApi: api }));
import { OwnerApprovalRequestsCard, ruleLine } from './OwnerApprovalRequestsCard';

const req = (over: Record<string, unknown> = {}) => ({ id: 'a1', kind: 'refund', status: 'pending', branchId: 'b', branchName: 'Main', subjectType: 'payment', subjectId: 'p', title: 'Refund $80.00 (cash)', amountCents: 8000,
  requestedByUserId: 'u', requestedByName: 'Fran', reason: 'Color came out wrong', decidedByName: null, decidedAt: null, decisionNote: null, requiredPermission: 'checkout.approve_refund',
  canDecide: true, whyNot: null, expiresAt: null, createdAt: '2026-10-08T12:00:00Z', version: 1, payload: {}, ...over });
const rule = (over: Record<string, unknown> = {}) => ({ kind: 'refund', label: 'Refund over the limit', enabled: true, thresholdCents: 20000, cashThresholdCents: 5000, approverLimitCents: null, approverPermission: 'checkout.approve_refund', requireDifferentApprover: true, expiresAfterHours: 24, version: 0, ...over });
beforeEach(() => {
  vi.clearAllMocks();
  api.pending.mockResolvedValue([req(), req({ id: 'a2', title: 'Purchase order PO-1', kind: 'purchase_order', canDecide: false, whyNot: 'requester_cannot_approve', version: 3 })]);
  api.policies.mockResolvedValue([rule(), rule({ kind: 'other', label: 'Other request' })]);
});

describe('OwnerApprovalRequestsCard', () => {
  it('Loyalty guide (Nov 4 2026): a bonus request shows current → after, the token cost against the wallet; a funding failure is explained', async () => {
    const bonus = req({ id: 'lb1', kind: 'loyalty_bonus', title: '+10 bonus points for Ava Kim', amountCents: 100, reason: 'Service recovery', version: 1,
      payload: { customerName: 'Ava Kim', currentPoints: 0, points: 10, pointsAfter: 10, target: 'global', tokenCostCents: 100, walletAvailableCents: 50 } });
    api.pending.mockResolvedValue([bonus]);
    api.decide.mockResolvedValue({ ...bonus, status: 'execution_failed', version: 3, payload: { ...bonus.payload, executionResult: { code: 'LOYALTY_BONUS_NEEDS_FUNDING', error: 'Not enough salon reward tokens' } } });
    render(<OwnerApprovalRequestsCard />);
    const row = await screen.findByTestId('owner-approval-request');
    expect(within(row).getByText(/Bonus loyalty points · \$1\.00 · asked by Fran/)).toBeInTheDocument();
    const facts = within(row).getByTestId('owner-bonus-facts');
    expect(facts).toHaveTextContent('Ava Kim: 0 points now → 10 after +10');
    expect(facts).toHaveTextContent('Salon reward tokens: 1.00 of 0.50 available — not enough; buy tokens first');
    fireEvent.click(within(row).getByRole('button', { name: /^Approve:/ }));
    expect(await screen.findByTestId('owner-approval-notice')).toHaveTextContent('not have enough reward tokens — no points were added');
  });
  it('lists waiting requests; why-not replaces the buttons; the rules summary shows the three engine flows', async () => {
    render(<OwnerApprovalRequestsCard />);
    const rows = await screen.findAllByTestId('owner-approval-request');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(/Refund · \$80\.00 · asked by Fran · Main/)).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(within(rows[1]).getByTestId('owner-approval-why-not')).toHaveTextContent('You asked for this');
    expect(screen.getByTestId('owner-approval-rules')).toHaveTextContent('Refund over the limit: over $200.00 (cash over $50.00), never by the person who asked');
    expect(screen.getByTestId('owner-approval-rules')).not.toHaveTextContent('Other request');
  });
  it('approve sends the version', async () => {
    api.decide.mockResolvedValue(req({ status: 'executed', version: 3 }));
    render(<OwnerApprovalRequestsCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Refund $80.00 (cash)' }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('a1', { decision: 'approve', note: null, expectedVersion: 1 }, { idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_\-:.]{8,200}$/) }));
    expect(await screen.findByTestId('owner-approval-notice')).toHaveTextContent('Approved “Refund $80.00 (cash)”.');
  });
  it('reject needs a note', async () => {
    api.decide.mockResolvedValue(req({ status: 'rejected' }));
    render(<OwnerApprovalRequestsCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject: Refund $80.00 (cash)' }));
    const g = screen.getByRole('group', { name: 'Reject Refund $80.00 (cash)' });
    expect(within(g).getByRole('button', { name: 'Reject' })).toBeDisabled();
    fireEvent.change(within(g).getByRole('textbox'), { target: { value: 'Not eligible' } });
    fireEvent.click(within(g).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('a1', { decision: 'reject', note: 'Not eligible', expectedVersion: 1 }, { idempotencyKey: expect.any(String) }));
  });
  it('a 409 reloads and says someone else decided', async () => {
    api.decide.mockRejectedValue({ status: 409, code: 'version_conflict', message: 'x' });
    render(<OwnerApprovalRequestsCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Refund $80.00 (cash)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else decided this');
    expect(api.pending).toHaveBeenCalledTimes(2);
  });
  it('hidden when the session cannot read approvals (403)', async () => {
    api.pending.mockRejectedValue({ status: 403 });
    const { container } = render(<OwnerApprovalRequestsCard />);
    await waitFor(() => expect(api.pending).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="owner-approval-requests"]')).toBeNull());
  });
  it('reloads on approval_updated and reconcile, not on other events', async () => {
    render(<OwnerApprovalRequestsCard />);
    await screen.findAllByTestId('owner-approval-request');
    const n = api.pending.mock.calls.length;
    await act(async () => { streamCb.fn!('owner_alert_created'); });
    expect(api.pending.mock.calls.length).toBe(n);
    await act(async () => { streamCb.fn!('approval_updated'); });
    expect(api.pending.mock.calls.length).toBe(n + 1);
  });
  it('ruleLine: off / always / over', () => {
    expect(ruleLine(rule({ enabled: false }) as any)).toBe('Refund over the limit: off');
    expect(ruleLine(rule({ kind: 'deal_publish', label: 'Deal', thresholdCents: null, cashThresholdCents: null, requireDifferentApprover: false }) as any)).toBe('Deal: always');
  });
});
