// AlertsScreen (owner, Module 6): lists owner_alerts with a status filter; each actionable alert exposes Ack/Resolve/Dismiss
// which POST and update the row in place. Verifies rendering (actions vs. status pill), the in-place transition after an action
// returns the updated alert, the filter→reload wiring, the empty state, and a friendly 403.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: () => {} }));
vi.mock('../api/ownerApi', () => ({ ownerMoreApi: { alerts: vi.fn(), acknowledge: vi.fn(), resolve: vi.fn(), dismiss: vi.fn() } }));

import { ownerMoreApi } from '../api/ownerApi';
import { AlertsScreen } from './AlertsScreen';

const al1 = { id: 'al1', severity: 'high', title: 'Low cash drawer', body: 'Drawer 2 below threshold', status: 'new', createdAt: '2026-06-17T14:30:00.000Z', branchId: 'br1' };
const al2 = { id: 'al2', severity: 'info', title: 'Weekly report ready', body: null, status: 'resolved', createdAt: '2026-06-16T09:00:00.000Z', branchId: 'br1' };

beforeEach(() => {
  vi.clearAllMocks();
  (ownerMoreApi.alerts as any).mockResolvedValue([al1, al2]);
  (ownerMoreApi.acknowledge as any).mockResolvedValue({ ...al1, status: 'acknowledged' });
  (ownerMoreApi.resolve as any).mockResolvedValue({ ...al1, status: 'resolved' });
  (ownerMoreApi.dismiss as any).mockResolvedValue({ ...al1, status: 'dismissed' });
});

describe('AlertsScreen', () => {
  it('renders alerts with actions for open ones and a status pill for closed ones', async () => {
    render(<AlertsScreen />);
    expect(await screen.findByText('Low cash drawer')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();             // severity badge
    expect(screen.getByText('Weekly report ready')).toBeInTheDocument();
    expect(screen.getByText('Ack')).toBeInTheDocument();              // al1 (new) is actionable
    expect(screen.getByText('resolved')).toBeInTheDocument();         // al2 status pill (lowercase, not the "Resolved" tab)
  });

  it('acknowledges an alert in place using the returned row', async () => {
    (ownerMoreApi.alerts as any).mockResolvedValue([al1]);
    render(<AlertsScreen />);
    fireEvent.click(await screen.findByText('Ack'));
    await waitFor(() => expect(ownerMoreApi.acknowledge).toHaveBeenCalledWith('al1'));
    expect(screen.queryByText('Ack')).not.toBeInTheDocument();        // no longer "new"
    expect(screen.getByText('Resolve')).toBeInTheDocument();          // still actionable
  });

  it('dismisses an alert in place, dropping its actions for a status pill', async () => {
    (ownerMoreApi.alerts as any).mockResolvedValue([al1]);
    render(<AlertsScreen />);
    fireEvent.click(await screen.findByText('Dismiss'));
    await waitFor(() => expect(ownerMoreApi.dismiss).toHaveBeenCalledWith('al1'));
    expect(screen.queryByText('Resolve')).not.toBeInTheDocument();    // no longer actionable
    expect(screen.getByText('dismissed')).toBeInTheDocument();        // status pill
  });

  it('reloads with a status filter when a tab is selected', async () => {
    render(<AlertsScreen />);
    await screen.findByText('Low cash drawer');
    fireEvent.click(screen.getByText('Acknowledged'));
    await waitFor(() => expect(ownerMoreApi.alerts).toHaveBeenCalledWith({ status: 'acknowledged' }));
  });

  it('shows the empty state when nothing matches', async () => {
    (ownerMoreApi.alerts as any).mockResolvedValue([]);
    render(<AlertsScreen />);
    expect(await screen.findByText('No alerts')).toBeInTheDocument();
  });

  it('shows a friendly 403 with Retry', async () => {
    (ownerMoreApi.alerts as any).mockRejectedValue({ status: 403 });
    render(<AlertsScreen />);
    expect(await screen.findByText('You do not have access to alerts.')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
