// BranchHealthScreen.test.tsx — BUILD_PLAN Phase 14 B (Constitution 11 §345): every salon's branches, worst first, with why;
// unmeasured facts are "—" with the failed query named; sort / status filters go to the server; paging appends.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configure, render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn() } }));
import { api } from '../api/client';
configure({ asyncUtilTimeout: 5000 });   // the full admin-web run is slow under load; 1 s findBy defaults flake
// Oct 20 2026 final run: the first test timed out at vitest's 5 s default while four lanes shared the box (two findBy
// waits of up to 5 s each) — passed alone in 272 ms. The TEST timeout must exceed the sum of the async waits it allows.
const SLOW = 30_000;
import { BranchHealthScreen } from './BranchHealthScreen';

const T = '2026-10-09T10:00:00.000Z';
const facts = { openTickets: 4, queueWaiting: 2, queueLongestWaitSeconds: 1800, techniciansOnShift: 3, paymentsLastHour: 5, paymentsFailedLastHour: 3,
  displaysTotal: 2, displaysOnline: 0, kiosksTotal: 1, kiosksOnline: 1, terminalsPaired: 1, lastRealtimeEventAt: T, smsSentLastHour: 1, smsFailedLastHour: 0 };
const outage = { ...facts, tenantId: 't1', tenantName: 'Lily Nails', branchId: 'b1', branchName: 'Main St', observedAt: T, overall: 'OUTAGE', reasons: ['payments_failing'], failedQueries: [] };
const unknown = { ...facts, openTickets: null, tenantId: 't2', tenantName: 'Rose Spa', branchId: 'b2', branchName: 'Mall', observedAt: T, overall: 'UNKNOWN', reasons: [], failedQueries: ['openTickets'] };
const page1 = { rows: [outage], generatedAt: T, total: 2, counts: { OUTAGE: 1, UNKNOWN: 1 }, nextCursor: 'c1' };
const page2 = { rows: [unknown], generatedAt: T, total: 2, counts: { OUTAGE: 1, UNKNOWN: 1 }, nextCursor: null };

describe('Branch health (§345)', () => {
  beforeEach(() => {
    cleanup(); vi.clearAllMocks();
    (api.get as any).mockImplementation((_p: string, q: any) => Promise.resolve(q?.cursor ? page2 : page1));
  });

  it('reads worst first, shows status, why and the facts; pages append', async () => {
    render(<BranchHealthScreen />);
    const row = await screen.findByTestId('bh-b1');
    expect(api.get).toHaveBeenCalledWith('/super-admin/branch-health', { sort: 'worst' });
    expect(within(row).getByText('OUTAGE')).toBeTruthy();
    expect(within(row).getByText('payments_failing')).toBeTruthy();
    expect(within(row).getByText('5 / 3 failed')).toBeTruthy();
    expect(within(row).getByText('2 · 30 min')).toBeTruthy();
    expect(within(row).getByText('0/2 · 1/1 · 1')).toBeTruthy();
    expect(screen.getByTestId('bh-counts').textContent).toMatch(/2 branch\(es\) · 1 outage · 0 degraded · 1 unknown · 0 healthy/);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    const r2 = await screen.findByTestId('bh-b2');
    expect(api.get).toHaveBeenLastCalledWith('/super-admin/branch-health', { sort: 'worst', cursor: 'c1' });
    expect(within(r2).getByText('not measured: openTickets')).toBeTruthy();
    expect(within(r2).getAllByRole('cell')[4].textContent).toBe('—');   // open tickets not measured, never 0
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  }, SLOW);

  it('Refresh starts paging again: the first page and its "Load more" arrive in the same render', async () => {
    render(<BranchHealthScreen />);
    await screen.findByTestId('bh-b1');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByTestId('bh-b2');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();   // last page
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
    await screen.findByTestId('bh-b1');
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
    expect(screen.queryByTestId('bh-b2')).toBeNull();
  }, SLOW);

  it('a page and its "Load more" are committed together (no frame with rows but no button)', async () => {
    // A MutationObserver sees every DOM commit before React's passive effects run; the cursor used to be derived in an
    // effect, so the first commit with rows had no button (the Oct 26 2026 admin-web flake). Record every commit.
    const frames: Array<{ rows: boolean; button: boolean }> = [];
    const obs = new MutationObserver(() => frames.push({
      rows: !!document.querySelector('[data-testid="bh-b1"]'),
      button: [...document.querySelectorAll('button')].some((b) => b.textContent === 'Load more'),
    }));
    obs.observe(document.body, { childList: true, subtree: true });
    try {
      render(<BranchHealthScreen />);
      await screen.findByTestId('bh-b1');
      await screen.findByRole('button', { name: 'Load more' });
    } finally { obs.disconnect(); }
    const withRows = frames.filter((f) => f.rows);
    expect(withRows.length).toBeGreaterThan(0);
    expect(withRows.every((f) => f.button)).toBe(true);
  }, SLOW);

  it('sort and status filters go to the server', async () => {
    render(<BranchHealthScreen />);
    await screen.findByTestId('bh-b1');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'DEGRADED' } });
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/super-admin/branch-health', { sort: 'worst', status: 'DEGRADED' }));
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name' } });
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/super-admin/branch-health', { sort: 'name', status: 'DEGRADED' }));
  }, SLOW);

  it('no snapshot yet is said plainly; a failed read is an alert', async () => {
    (api.get as any).mockResolvedValueOnce({ rows: [], generatedAt: T, total: 0, counts: {}, nextCursor: null });
    render(<BranchHealthScreen />);
    expect(await screen.findByText(/No branch has been snapshotted yet/)).toBeTruthy();
    cleanup();
    (api.get as any).mockRejectedValueOnce(new Error('down'));
    render(<BranchHealthScreen />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be read/);
  }, SLOW);
});
