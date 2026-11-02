// OwnerAiSchedulingCard.test.tsx — BUILD_PLAN Phase 7 (ai_scheduling_optimizer) in the Owner App: the per-branch
// comparison (utilization, idle, applied manual vs automated, open reviews, waiting proposals, conflicts, last run), the
// period chips mapped to ?days=, honest empty state, hidden on 403 / 402, retry on failure. The api test checks the path.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api: Record<string, any> = { summary: vi.fn() };
vi.mock('../api/ownerAiSchedulingApi', () => ({ ownerAiSchedulingApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
import { OwnerAiSchedulingCard } from './OwnerAiSchedulingCard';

const summary = (over: any = {}) => ({
  days: 7, generatedAt: '2026-10-08T12:00:00Z',
  branches: [
    { branchId: 'b1', name: 'Cherry Hill', utilizationPct: 78.4, idleMin: 120, openRecommendations: 3, applied: 9, automated: 2, pendingProposals: 1, openConflicts: 2, lastRunAt: '2026-10-08T11:00:00Z' },
    { branchId: 'b2', name: 'Marlton', utilizationPct: 52, idleMin: 300, openRecommendations: 0, applied: 1, automated: 0, pendingProposals: 0, openConflicts: 0, lastRunAt: null },
  ],
  ...over,
});
beforeEach(() => { api.summary.mockReset(); api.summary.mockResolvedValue(summary()); });

describe('Owner AI Scheduling branch comparison', () => {
  it('asks for 7 days first and shows each branch and the totals', async () => {
    render(<OwnerAiSchedulingCard />);
    const rows = await screen.findAllByTestId('ai-sched-branch');
    expect(api.summary).toHaveBeenCalledWith(7);
    expect(rows[0]).toHaveTextContent('Cherry Hill');
    expect(rows[0]).toHaveTextContent('Utilization 78% · idle 120 min');
    expect(rows[0]).toHaveTextContent('9 applied (2 automated) · 3 to review · 1 waiting on customers');
    expect(rows[0]).toHaveTextContent('2 conflicts');
    expect(rows[1]).toHaveTextContent('last run never');
    expect(rows[1]).toHaveTextContent('No conflicts');
    const card = screen.getByTestId('owner-ai-scheduling');
    expect(card).toHaveTextContent('10');                       // applied total
    expect(card).toHaveTextContent('2 automated (safe actions)');
    expect(screen.getByTestId('ai-sched-lowest')).toHaveTextContent('Marlton (52%)');
  });
  it('period chips refetch with the matching days', async () => {
    render(<OwnerAiSchedulingCard />);
    await screen.findAllByTestId('ai-sched-branch');
    const chips = within(screen.getByRole('tablist', { name: 'Period' }));
    fireEvent.click(chips.getByText('Month'));
    await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith(30));
    fireEvent.click(chips.getByText('Quarter'));
    await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith(90));
  });
  it('empty period → plain message', async () => {
    api.summary.mockResolvedValue(summary({ branches: [] }));
    render(<OwnerAiSchedulingCard />);
    expect(await screen.findByTestId('ai-sched-empty')).toBeInTheDocument();
  });
  it('403 / 402 hide the card; other errors offer a retry', async () => {
    api.summary.mockRejectedValue(Object.assign(new Error('no'), { status: 402 }));
    const { container, unmount } = render(<OwnerAiSchedulingCard />);
    await waitFor(() => expect(container.innerHTML).toBe(''));
    unmount();
    api.summary.mockRejectedValueOnce(Object.assign(new Error('Server down'), { status: 500 }));
    render(<OwnerAiSchedulingCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Server down');
    api.summary.mockResolvedValue(summary());
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findAllByTestId('ai-sched-branch')).toHaveLength(2);
  });
});
