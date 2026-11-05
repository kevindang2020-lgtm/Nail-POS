// POSApprovalsScreen.test.tsx — BUILD_PLAN Phase 9 (agent D): the salon's one approvals inbox. Decide with the request's
// version; reject needs a note; the server's why-not is shown instead of buttons; a 409 re-reads the request; withdraw my
// own; rules (owners: step-up); ask for an approval; realtime key "approvals".
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const perms = vi.hoisted(() => ({ deny: new Set<string>() }));
vi.mock('../../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
const realtimeKeys: string[][] = vi.hoisted(() => []);
vi.mock('../../realtime/useRealtime', () => ({ useRealtime: (keys: string[]) => { realtimeKeys.push(keys); } }));
const api = vi.hoisted(() => ({ list: vi.fn(), one: vi.fn(), create: vi.fn(), decide: vi.fn(), cancel: vi.fn(), policies: vi.fn(), updatePolicy: vi.fn() }));
vi.mock('../../api/posApprovalsApi', async (orig) => ({ ...(await orig<any>()), posApprovalsApi: api }));
const stepUp = vi.hoisted(() => vi.fn());
vi.mock('../../api/posStepUpApi', () => ({ posStepUpApi: { stepUp: (...a: any[]) => stepUp(...a) } }));
import { POSApprovalsScreen } from './POSApprovalsScreen';

const req = (over: Record<string, unknown> = {}) => ({
  id: 'a1', kind: 'refund', status: 'pending', branchId: 'b1', branchName: 'Main', subjectType: 'payment', subjectId: 'p1', title: 'Refund $80.00 (cash)', amountCents: 8000,
  requestedByUserId: 'u-fd', requestedByName: 'Fran', reason: 'Color came out wrong', decidedByName: null, decidedAt: null, decisionNote: null,
  requiredPermission: 'checkout.approve_refund', canDecide: true, whyNot: null, expiresAt: '2026-10-09T12:00:00.000Z', createdAt: '2026-10-08T12:00:00.000Z', version: 1, payload: {}, ...over,
});
const page = (items: any[]) => ({ items, page: 1, pageSize: 50, total: items.length, hasMore: false });
const policy = (over: Record<string, unknown> = {}) => ({ kind: 'refund', label: 'Refund over the limit', enabled: true, thresholdCents: 20000, cashThresholdCents: 5000, approverLimitCents: null, approverPermission: 'checkout.approve_refund', requireDifferentApprover: true, expiresAfterHours: 24, version: 0, ...over });

beforeEach(() => {
  perms.deny = new Set(); realtimeKeys.length = 0;
  for (const f of Object.values(api)) f.mockReset();
  stepUp.mockReset();
  api.list.mockResolvedValue(page([req(), req({ id: 'a2', title: 'Deal: Fall Gel', kind: 'deal_publish', amountCents: null, canDecide: false, whyNot: 'requester_cannot_approve', version: 4 })]));
  api.policies.mockResolvedValue([policy(), policy({ kind: 'purchase_order', label: 'Purchase order', thresholdCents: null, cashThresholdCents: null, requireDifferentApprover: false, version: 2 })]);
});

describe('POS Approvals', () => {
  it('the inbox lists pending requests; the server\'s why-not replaces the buttons; realtime key "approvals"', async () => {
    render(<POSApprovalsScreen />);
    const rows = await screen.findAllByTestId('approval-row');
    expect(rows).toHaveLength(2);
    expect(api.list).toHaveBeenCalledWith({ status: 'pending', pageSize: 50 });
    expect(within(rows[0]).getByText(/\$80\.00 · asked by Fran/)).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(within(rows[1]).getByTestId('approval-why-not')).toHaveTextContent('You asked for this — someone else has to approve it.');
    expect(realtimeKeys.some((k) => k.includes('approvals'))).toBe(true);
  });
  it('approve sends the request\'s version and says what happened', async () => {
    api.decide.mockResolvedValue(req({ status: 'executed', version: 3 }));
    render(<POSApprovalsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Refund $80.00 (cash)' }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('a1', { decision: 'approve', note: null, expectedVersion: 1 }));
    expect(await screen.findByTestId('approval-notice')).toHaveTextContent('Approved and done: Refund $80.00 (cash).');
  });
  it('an approved request that did not complete says so (execution_failed)', async () => {
    api.decide.mockResolvedValue(req({ status: 'execution_failed', version: 3, payload: { executionResult: { error: 'Refund was declined by the processor' } } }));
    render(<POSApprovalsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Refund $80.00 (cash)' }));
    expect(await screen.findByTestId('approval-notice')).toHaveTextContent('Approved, but it did not complete: Refund was declined by the processor.');
  });
  it('reject needs a note (3+ characters) and sends it', async () => {
    api.decide.mockResolvedValue(req({ status: 'rejected', version: 2 }));
    render(<POSApprovalsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject: Refund $80.00 (cash)' }));
    const group = screen.getByRole('group', { name: 'Reject Refund $80.00 (cash)' });
    const go = within(group).getByRole('button', { name: 'Reject' });
    expect(go).toBeDisabled();
    fireEvent.change(within(group).getByLabelText('Note'), { target: { value: 'Not eligible' } });
    fireEvent.click(go);
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('a1', { decision: 'reject', note: 'Not eligible', expectedVersion: 1 }));
  });
  it('a 409 re-reads that request and says someone decided first', async () => {
    api.decide.mockRejectedValue(Object.assign(new Error('changed'), { status: 409, code: 'version_conflict' }));
    api.one.mockResolvedValue(req({ status: 'approved', version: 2, decidedByName: 'Mona' }));
    render(<POSApprovalsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Refund $80.00 (cash)' }));
    await waitFor(() => expect(api.one).toHaveBeenCalledWith('a1'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone changed this first');
  });
  it('without approvals.decide there is no inbox tab — Mine opens; I can withdraw my own pending request with a reason', async () => {
    perms.deny = new Set(['approvals.decide', 'approvals.manage_policies']);
    api.cancel.mockResolvedValue(req({ status: 'cancelled' }));
    render(<POSApprovalsScreen />);
    expect(screen.queryByRole('tab', { name: 'To decide' })).toBeNull();
    await waitFor(() => expect(api.list).toHaveBeenCalledWith({ mine: true, status: 'all', pageSize: 50 }));
    fireEvent.click((await screen.findAllByRole('button', { name: /Withdraw:/ }))[0]);
    const group = screen.getByRole('group', { name: 'Withdraw Refund $80.00 (cash)' });
    fireEvent.change(within(group).getByLabelText('Note'), { target: { value: 'Customer changed mind' } });
    fireEvent.click(within(group).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('a1', 'Customer changed mind'));
  });
  it('rules: read for everyone; an owner changes one with the version, a reason and a step-up when the server asks', async () => {
    api.updatePolicy.mockRejectedValueOnce(Object.assign(new Error('step up'), { status: 403, code: 'STEP_UP_REQUIRED' })).mockResolvedValueOnce(policy({ cashThresholdCents: 7000, version: 1 }));
    stepUp.mockResolvedValue({ ok: true });
    render(<POSApprovalsScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Rules' }));
    const rules = await screen.findAllByTestId('approval-rule');
    expect(within(rules[0]).getByText(/over \$200\.00 \(cash over \$50\.00\)/)).toBeInTheDocument();
    fireEvent.click(within(rules[0]).getByRole('button', { name: 'Change rule: Refund over the limit' }));
    fireEvent.change(screen.getByLabelText('Cash threshold'), { target: { value: '70' } });
    fireEvent.change(screen.getByLabelText('Reason for change'), { target: { value: 'trusted desk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.change(await screen.findByLabelText('Your password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.updatePolicy).toHaveBeenCalledTimes(2));
    expect(api.updatePolicy).toHaveBeenLastCalledWith({ kind: 'refund', expectedVersion: 0, enabled: true, thresholdCents: 20000, approverLimitCents: null, cashThresholdCents: 7000, requireDifferentApprover: true, expiresAfterHours: 24, reason: 'trusted desk' });
    expect(stepUp).toHaveBeenCalledWith({ password: 'pw' });
  });
  it('a manager without approvals.manage_policies reads the rules but cannot change them', async () => {
    perms.deny = new Set(['approvals.manage_policies']);
    render(<POSApprovalsScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Rules' }));
    await screen.findAllByTestId('approval-rule');
    expect(screen.queryByRole('button', { name: /Change rule/ })).toBeNull();
  });
  it('ask for a refund approval: names the payment, the amount, why', async () => {
    api.create.mockResolvedValue({ request: req({ title: 'Refund $25.00 (cash)' }), created: true });
    render(<POSApprovalsScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Ask for approval' }));
    const send = screen.getByRole('button', { name: 'Send for approval' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: 'pay-123' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Wrong color' } });
    fireEvent.click(send);
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ kind: 'refund', subjectType: 'payment', subjectId: 'pay-123', amountCents: 2500, reason: 'Wrong color' }));
    expect(await screen.findByTestId('approval-notice')).toHaveTextContent('Sent for approval: Refund $25.00 (cash).');
  });
  it('without approvals.request there is no Ask tab', async () => {
    perms.deny = new Set(['approvals.request']);
    render(<POSApprovalsScreen />);
    await screen.findAllByTestId('approval-row');
    expect(screen.queryByRole('tab', { name: 'Ask for approval' })).toBeNull();
  });
});
