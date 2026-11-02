// ApprovalCenterScreen (owner, Approvals tab): one queue of pending payroll approvals/locks (each deep-links to the
// payroll screen pre-selected to that period) + an operational alerts entry. Verifies the pending items + action labels,
// the deep-link call with the period id, the alert entry with its count, and the caught-up empty state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const openPayroll = vi.fn();
const openAlerts = vi.fn();
const streamCb = vi.hoisted(() => ({ fn: null as null | ((e: string) => void) }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ openPayroll, openAlerts }) }));
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: (cb: (e: string) => void) => { streamCb.fn = cb; } }));
vi.mock('../api/ownerApi', () => ({ ownerApprovalsApi: { get: vi.fn() } }));
// BUILD_PLAN Phase 8: the Safety Community card is tested in OwnerCommunityCard.test.tsx — stubbed here
vi.mock('./OwnerCommunityCard', () => ({ OwnerCommunityCard: () => <div data-testid="owner-community-stub" /> }));
// BUILD_PLAN Phase 9: the approvals-engine requests card is tested in OwnerApprovalRequestsCard.test.tsx — stubbed here
vi.mock('./OwnerApprovalRequestsCard', () => ({ OwnerApprovalRequestsCard: () => <div data-testid="owner-approval-requests-stub" /> }));

import { ownerApprovalsApi } from '../api/ownerApi';
import { ApprovalCenterScreen } from './ApprovalCenterScreen';

const resp = (over: any = {}) => ({
  items: [
    { kind: 'payroll', action: 'approve', periodId: 'p4', label: 'Period p4', detail: '2026-05-01 – 2026-05-15', status: 'draft', amountCents: 300000, branchId: null },
    { kind: 'payroll', action: 'lock', periodId: 'p2', label: 'Period p2', detail: '2026-04-16 – 2026-04-30', status: 'finalized', amountCents: 500000, branchId: null },
  ],
  counts: { payrollToApprove: 1, payrollToLock: 1, openAlerts: 5 },
  generatedAt: '2026-06-27T15:00:00.000Z',
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); (ownerApprovalsApi.get as any).mockResolvedValue(resp()); });

describe('ApprovalCenterScreen', () => {
  it('lists pending payroll items with their action labels', async () => {
    render(<ApprovalCenterScreen />);
    await waitFor(() => expect(screen.getByText('Period p4')).toBeInTheDocument());
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Lock & Pay')).toBeInTheDocument();
    expect(screen.getByText('2 pending')).toBeInTheDocument();
  });

  it('deep-links to the payroll screen for that period on tap', async () => {
    render(<ApprovalCenterScreen />);
    await waitFor(() => expect(screen.getByText('Period p4')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Period p4'));
    expect(openPayroll).toHaveBeenCalledWith('p4');
  });

  it('shows the operational alerts entry with its open count', async () => {
    render(<ApprovalCenterScreen />);
    await waitFor(() => expect(screen.getByText(/Alerts · 5 open/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Alerts · 5 open/));
    expect(openAlerts).toHaveBeenCalled();
  });

  it('shows a caught-up state when nothing is pending', async () => {
    (ownerApprovalsApi.get as any).mockResolvedValue(resp({ items: [], counts: { payrollToApprove: 0, payrollToLock: 0, openAlerts: 0 } }));
    render(<ApprovalCenterScreen />);
    await waitFor(() => expect(screen.getByText('No payroll periods awaiting your approval.')).toBeInTheDocument());
    expect(screen.getByText('Up to date')).toBeInTheDocument();
  });

  it('refetches live on payroll and alert events, but ignores unrelated ones', async () => {
    render(<ApprovalCenterScreen />);
    await waitFor(() => expect(screen.getByText('Period p4')).toBeInTheDocument());
    expect(ownerApprovalsApi.get).toHaveBeenCalledTimes(1);
    await act(async () => { streamCb.fn?.('owner_payroll_updated'); });
    await waitFor(() => expect(ownerApprovalsApi.get).toHaveBeenCalledTimes(2));
    await act(async () => { streamCb.fn?.('owner_alert_updated'); });
    await waitFor(() => expect(ownerApprovalsApi.get).toHaveBeenCalledTimes(3));
    await act(async () => { streamCb.fn?.('queue_updated'); });
    expect(ownerApprovalsApi.get).toHaveBeenCalledTimes(3); // unrelated event → no refetch
  });

  it('BUILD_PLAN Phase 9: the approvals-engine requests card sits on the Approval Center', async () => {
    render(<ApprovalCenterScreen />);
    expect(await screen.findByTestId('owner-approval-requests-stub')).toBeInTheDocument();
  });
});
