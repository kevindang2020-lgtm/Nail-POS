// BranchHealthScreen.test.tsx — BUILD_PLAN Phase 14 B (Constitution 11 §345): every salon's branches, worst first, with why;
// unmeasured facts are "—" with the failed query named; sort / status filters go to the server; paging appends.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configure, render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn() } }));
import { api } from '../api/client';
configure({ asyncUtilTimeout: 5000 });   // the full admin-web run is slow under load; 1 s findBy defaults flake
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
  });

  it('sort and status filters go to the server', async () => {
    render(<BranchHealthScreen />);
    await screen.findByTestId('bh-b1');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'DEGRADED' } });
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/super-admin/branch-health', { sort: 'worst', status: 'DEGRADED' }));
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name' } });
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/super-admin/branch-health', { sort: 'name', status: 'DEGRADED' }));
  });

  it('no snapshot yet is said plainly; a failed read is an alert', async () => {
    (api.get as any).mockResolvedValueOnce({ rows: [], generatedAt: T, total: 0, counts: {}, nextCursor: null });
    render(<BranchHealthScreen />);
    expect(await screen.findByText(/No branch has been snapshotted yet/)).toBeTruthy();
    cleanup();
    (api.get as any).mockRejectedValueOnce(new Error('down'));
    render(<BranchHealthScreen />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be read/);
  });
});
