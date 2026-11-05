// The notification inbox is server-backed (GET /owner/notifications, POST /owner/notifications/read).
// The earlier test targeted a static mock with category chips and preference sections that no longer exist.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const back = vi.hoisted(() => vi.fn());
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back }) }));
vi.mock('../api/ownerApi', () => ({ ownerNotificationsApi: { get: vi.fn(), markRead: vi.fn() } }));

import { ownerNotificationsApi } from '../api/ownerApi';
import { OwnerNotificationScreen } from './OwnerNotificationScreen';

const now = new Date().toISOString();
const inbox = () => ({
  unreadCount: 1,
  items: [
    { id: 'n1', type: 'payment', title: 'Payroll Approval Required', body: 'Week 44 is ready', reference: null, readAt: null, createdAt: now },
    { id: 'n2', type: 'appointment', title: 'Booking confirmed', body: null, reference: null, readAt: now, createdAt: now },
  ],
});

describe('OwnerNotificationScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (ownerNotificationsApi.get as any).mockResolvedValue(inbox());
    (ownerNotificationsApi.markRead as any).mockResolvedValue({ ok: true });
  });

  it('shows a loading state, then the server notifications and unread count', async () => {
    render(<OwnerNotificationScreen />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(await screen.findByText('Payroll Approval Required')).toBeInTheDocument();
    expect(screen.getByText('Week 44 is ready')).toBeInTheDocument();
    expect(screen.getByText('Booking confirmed')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('triggers back navigation on back button click', () => {
    render(<OwnerNotificationScreen />);
    fireEvent.click(screen.getByLabelText('Back'));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when there are no notifications', async () => {
    (ownerNotificationsApi.get as any).mockResolvedValue({ unreadCount: 0, items: [] });
    render(<OwnerNotificationScreen />);
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark all read/ })).toBeDisabled();
  });

  it('marks all notifications as read on the server', async () => {
    render(<OwnerNotificationScreen />);
    await screen.findByText('Payroll Approval Required');
    fireEvent.click(screen.getByRole('button', { name: /Mark all read/ }));
    await waitFor(() => expect(ownerNotificationsApi.markRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Mark all read/ })).toBeDisabled();
  });
});
