// OwnerAiQueueCard.test.tsx — BUILD_PLAN Phase 6 (ai_queue_assignment) in the Owner App: the AI queue branch
// comparison (avg / longest wait, acceptance, auto-assigned, open alerts per branch), its period chips mapped to the
// summary route's ?days=, a CSV export, an honest empty state, a hidden card on 403 and a retry on failure.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api: Record<string, any> = { summary: vi.fn() };
vi.mock('../api/ownerAiQueueApi', () => ({ ownerAiQueueApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
import { OwnerAiQueueCard } from './OwnerAiQueueCard';

// the exact shape of C's ownerSummary (ai-queue-assignment-ops.service.ts): acceptanceRate is a 0–1 share
const summary = (over: any = {}) => ({
  days: 7, range: { from: '2026-09-30T00:00:00.000Z', to: '2026-10-07T00:00:00.000Z' },
  branches: [
    { branchId: 'b1', name: 'Cherry Hill', served: 40, avgWaitMinutes: 12.4, longestWaitMinutes: 41, acceptanceRate: 0.756, staffDecisions: 25, autoAssigned: 9, openAlerts: 2 },
    { branchId: 'b2', name: 'Marlton', served: 12, avgWaitMinutes: 21, longestWaitMinutes: 55, acceptanceRate: null, staffDecisions: 0, autoAssigned: 0, openAlerts: 0 },
  ],
  totals: { branchId: null, name: null, served: 52, avgWaitMinutes: 16, longestWaitMinutes: 55, acceptanceRate: 0.7, staffDecisions: 25, autoAssigned: 9, openAlerts: 2 },
  ...over,
});
beforeEach(() => { api.summary.mockReset(); api.summary.mockResolvedValue(summary()); });
afterEach(() => { vi.restoreAllMocks(); });

describe('Owner AI queue branch comparison', () => {
  it('asks for the last 7 days first and shows each branch: waits, acceptance as a percent, auto-assigned, alerts', async () => {
    render(<OwnerAiQueueCard />);
    const rows = await screen.findAllByTestId('ai-queue-branch');
    expect(api.summary).toHaveBeenCalledWith(7);
    expect(rows[0]).toHaveTextContent('Cherry Hill');
    expect(rows[0]).toHaveTextContent('40 served · avg wait 12 min · longest 41 min');
    expect(rows[0]).toHaveTextContent('Accepted 76% of 25 staff decisions · 9 auto-assigned');
    expect(rows[0]).toHaveTextContent('2 open alerts');
    expect(rows[1]).toHaveTextContent('Accepted — · 0 auto-assigned');         // no decisions → no made-up rate
    expect(rows[1]).toHaveTextContent('No alerts');
    const card = screen.getByTestId('owner-ai-queue');
    expect(card).toHaveTextContent('70%');
    expect(card).toHaveTextContent('52 served');
    expect(screen.getByTestId('ai-queue-slowest')).toHaveTextContent('Marlton (21 min)');
  });

  it('the period chips refetch with the matching number of days', async () => {
    render(<OwnerAiQueueCard />);
    await screen.findAllByTestId('ai-queue-branch');
    const chips = within(screen.getByRole('tablist', { name: 'Period' }));
    expect(chips.queryByText('Year')).toBeNull();            // the summary route is days-based; no year chip
    fireEvent.click(chips.getByText('Month'));
    await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith(30));
    fireEvent.click(chips.getByText('Today'));
    await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith(1));
    fireEvent.click(chips.getByText('Quarter'));
    await waitFor(() => expect(api.summary).toHaveBeenLastCalledWith(90));
  });

  it('downloads the comparison as CSV', async () => {
    const created: Blob[] = [];
    (URL as any).createObjectURL = vi.fn((b: Blob) => { created.push(b); return 'blob:x'; });
    (URL as any).revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<OwnerAiQueueCard />);
    fireEvent.click(await screen.findByText('Download CSV'));
    expect(click).toHaveBeenCalled();
    const text = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(created[0]!); });
    expect(text).toContain('last 7 day(s)');
    expect(text).toContain('Cherry Hill,40,12.4,41,76,25,9,2');
    expect(text).toContain('All branches,52,16,55,70,25,9,2');
  });

  it('says plainly when there was no queue activity', async () => {
    api.summary.mockResolvedValue(summary({ branches: [] }));
    render(<OwnerAiQueueCard />);
    expect(await screen.findByTestId('ai-queue-empty')).toHaveTextContent('No queue activity for this period.');
    expect(screen.queryByText('Download CSV')).toBeNull();
  });

  it('hides itself without the owner dashboard permission (403)', async () => {
    api.summary.mockRejectedValue({ status: 403, message: 'Forbidden' });
    const { container } = render(<OwnerAiQueueCard />);
    await waitFor(() => expect(api.summary).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('a failure is shown with Retry, which loads again', async () => {
    api.summary.mockRejectedValueOnce({ status: 500, message: 'Something went wrong. Please try again.' });
    render(<OwnerAiQueueCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findAllByTestId('ai-queue-branch')).toHaveLength(2);
  });
});
