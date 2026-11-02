// OwnerNotificationScreen — the owner's REAL alerts (Sep 2026 merge; the developer's version showed a hard-coded list).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const back = vi.hoisted(() => vi.fn());
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back }) }));
const alerts = vi.hoisted(() => vi.fn());
const acknowledge = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({})));
const markAll = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../api/ownerApi', () => ({ ownerMoreApi: { alerts: (...a: unknown[]) => alerts(...a), acknowledge: (...a: unknown[]) => acknowledge(...a), markAllNotificationsRead: () => markAll() } }));
import { OwnerNotificationScreen } from './OwnerNotificationScreen';

const now = new Date().toISOString();
const rows = [
  { id: 'a1', branchId: null, category: 'payroll', severity: 'high', status: 'new', title: 'Payroll approval needed', body: 'Week 38 is waiting for you', createdAt: now, resolvedAt: null },
  { id: 'a2', branchId: null, category: 'cash', severity: 'critical', status: 'acknowledged', title: 'Cash drawer short', body: 'Main register $40 short', createdAt: now, resolvedAt: null },
];

describe('OwnerNotificationScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); alerts.mockResolvedValue(rows); });
  it('shows a loading status, then the real open alerts (no demo items)', async () => {
    render(<OwnerNotificationScreen />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(await screen.findByText('Payroll approval needed')).toBeInTheDocument();
    expect(screen.getByText('Cash drawer short')).toBeInTheDocument();
    expect(alerts).toHaveBeenCalledWith({ status: 'open' });
    expect(screen.queryByText(/T-1045|Sophia Davis/)).toBeNull();
  });
  it('tapping an unread alert acknowledges it on the server; "Mark all read" acknowledges every unread one', async () => {
    render(<OwnerNotificationScreen />);
    fireEvent.click(await screen.findByText('Payroll approval needed'));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('a1'));
    expect(acknowledge).toHaveBeenCalledTimes(1);   // the already-acknowledged alert is not sent again
  });
  it('"Mark all read" is one server call (POST /owner/notifications/read), not one acknowledge per alert', async () => {
    alerts.mockResolvedValue([rows[0], { ...rows[1], id: 'a3', status: 'new', title: 'Rent due' }]);
    render(<OwnerNotificationScreen />);
    await screen.findByText('Payroll approval needed');
    expect(screen.getByText('2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(markAll).toHaveBeenCalledTimes(1));
    expect(acknowledge).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });
  it('a failed "Mark all read" restores the unread state', async () => {
    markAll.mockRejectedValueOnce(new Error('Offline'));
    render(<OwnerNotificationScreen />);
    await screen.findByText('Payroll approval needed');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(screen.getByRole('button', { name: 'Mark all read' })).not.toBeDisabled();
  });
  it('an empty inbox says so; a failed load says why', async () => {
    alerts.mockResolvedValueOnce([]);
    const { unmount } = render(<OwnerNotificationScreen />);
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    unmount();
    alerts.mockRejectedValueOnce(new Error('Network down'));
    render(<OwnerNotificationScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
  });
});
