// NotificationsScreen (technician, read + mark-read): lists technician_notifications with an unread dot and mark-all-read,
// and deep-links to a ticket when a row has a reference. Verifies rendering (titles/bodies/unread dot/badge), mark-all-read
// clearing the badge after reload, the ticket deep-link, the empty state, and the error path.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ back: vi.fn(), openTicket: vi.fn() }));
vi.mock('../shell/nav', () => ({ useTechNav: () => nav }));
vi.mock('../api/techApi', () => ({ techApi: { notifications: vi.fn(), markNotificationsRead: vi.fn() } }));

import { techApi } from '../api/techApi';
import { NotificationsScreen } from './NotificationsScreen';

const n1 = { id: 'n1', type: 'change_approved', title: 'Service change approved', body: 'Your add-on was approved', reference: 'TKT-1001', readAt: null, createdAt: new Date(Date.now() - 5 * 60000).toISOString() };
const n2 = { id: 'n2', type: 'info', title: 'Schedule updated', body: null, reference: null, readAt: '2026-06-16T10:00:00.000Z', createdAt: '2026-06-16T09:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  (techApi.notifications as any).mockResolvedValue({ items: [n1, n2], unread: 1 });
  (techApi.markNotificationsRead as any).mockResolvedValue({ ok: true, marked: 1 });
});

describe('NotificationsScreen', () => {
  it('renders notifications with an unread dot and a mark-all badge', async () => {
    render(<NotificationsScreen />);
    expect(await screen.findByText('Service change approved')).toBeInTheDocument();
    expect(screen.getByText('Your add-on was approved')).toBeInTheDocument();
    expect(screen.getByText('Schedule updated')).toBeInTheDocument();
    expect(screen.getByText('Mark all read (1)')).toBeInTheDocument();
    expect(screen.getByLabelText('Unread')).toBeInTheDocument();          // only the unread row
  });

  it('marks all read and clears the badge after reload', async () => {
    (techApi.notifications as any)
      .mockResolvedValueOnce({ items: [n1, n2], unread: 1 })
      .mockResolvedValueOnce({ items: [{ ...n1, readAt: new Date().toISOString() }, n2], unread: 0 });
    render(<NotificationsScreen />);
    fireEvent.click(await screen.findByText('Mark all read (1)'));
    await waitFor(() => expect(techApi.markNotificationsRead).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/Mark all read/)).not.toBeInTheDocument());
  });

  it('opens the referenced ticket when a notification is tapped', async () => {
    (techApi.notifications as any).mockResolvedValue({ items: [n1], unread: 1 });
    render(<NotificationsScreen />);
    fireEvent.click((await screen.findByText('Service change approved')).closest('button') as HTMLElement);
    expect(nav.openTicket).toHaveBeenCalledWith('TKT-1001');
  });

  it('shows the empty state when there are no notifications', async () => {
    (techApi.notifications as any).mockResolvedValue({ items: [], unread: 0 });
    render(<NotificationsScreen />);
    expect(await screen.findByText(/No notifications yet/)).toBeInTheDocument();
  });

  it('shows an error when notifications cannot be loaded', async () => {
    (techApi.notifications as any).mockRejectedValue({ message: 'Could not load notifications.' });
    render(<NotificationsScreen />);
    expect(await screen.findByText('Could not load notifications.')).toBeInTheDocument();
  });
});
