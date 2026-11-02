// OwnerBranchHealthCard.test.tsx — BUILD_PLAN Phase 14 B (Constitution 11 §345): the owner's branches, worst first, each
// with why in owner words; unmeasured facts "—" never 0; not-yet-snapshotted said plainly; a selected branch filters;
// no permission hides the card; a failed read is an alert.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const get = vi.fn();
vi.mock('../api/ownerBranchHealthApi', () => ({ ownerBranchHealthApi: { get: () => get() } }));
import { OwnerBranchHealthCard } from './OwnerBranchHealthCard';

const T = '2026-10-09T10:00:00.000Z';
const facts = { openTickets: 4, queueWaiting: 2, queueLongestWaitSeconds: 1800, techniciansOnShift: 3, paymentsLastHour: 6, paymentsFailedLastHour: 4,
  displaysTotal: 2, displaysOnline: 1, kiosksTotal: 1, kiosksOnline: 1, terminalsPaired: 1, lastRealtimeEventAt: T, smsSentLastHour: 0, smsFailedLastHour: 0 };
const snap = (over: any) => ({ ...facts, branchId: 'x', branchName: 'x', observedAt: T, overall: 'HEALTHY', reasons: ['ok'], failedQueries: [], ...over });
const payload = {
  generatedAt: T,
  branches: [
    { branchId: 'b1', branchName: 'Mall', snapshot: snap({ branchId: 'b1', overall: 'HEALTHY' }) },
    { branchId: 'b2', branchName: 'Main St', snapshot: snap({ branchId: 'b2', overall: 'OUTAGE', reasons: ['payments_failing', 'query_failed:openTickets'], failedQueries: ['openTickets'], openTickets: null }) },
    { branchId: 'b3', branchName: 'New', snapshot: null },
  ],
};
beforeEach(() => { get.mockReset(); get.mockResolvedValue(payload); });

describe('Owner branch health card (§345)', () => {
  it('lists the branches worst first with why, unmeasured as "—"', async () => {
    render(<OwnerBranchHealthCard />);
    const card = await screen.findByTestId('owner-branch-health');
    const rows = within(card).getAllByTestId('bh-row');
    expect(rows.map((r) => r.textContent?.slice(0, 4))).toEqual(['Main', 'NewN', 'Mall']);   // 'New' + 'Not checked yet'
    expect(rows[0]).toHaveTextContent('Problem');
    expect(rows[0]).toHaveTextContent('most payments are failing · could not measure openTickets');
    expect(rows[0]).toHaveTextContent('— open tickets');
    expect(rows[0]).toHaveTextContent('Payments last hour 6 (4 failed)');
    expect(rows[0]).toHaveTextContent('waiting (longest 30 min)');
    expect(rows[1]).toHaveTextContent('Not checked yet');
    expect(rows[2]).toHaveTextContent('Healthy');
    expect(within(rows[2]).queryByText('ok')).toBeNull();   // the API's 'ok' reason is not shown
  });

  it('a selected branch shows only that branch', async () => {
    render(<OwnerBranchHealthCard branchId="b1" />);
    const card = await screen.findByTestId('owner-branch-health');
    expect(within(card).getAllByTestId('bh-row')).toHaveLength(1);
    expect(card).toHaveTextContent('Mall');
  });

  it('no permission hides the card; another failure is an alert', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 403 }));
    const { container, unmount } = render(<OwnerBranchHealthCard />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
    unmount();
    get.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }));
    render(<OwnerBranchHealthCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Branch health could not be loaded.');
  });
});
