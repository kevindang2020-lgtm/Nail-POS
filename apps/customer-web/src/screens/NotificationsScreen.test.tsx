import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { notifications: vi.fn(), markNotificationsRead: vi.fn().mockResolvedValue({ ok: true }) } }));
import { customerApi } from '../api/customerApi';
import { NotificationsScreen } from './NotificationsScreen';

describe('NotificationsScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('lists real notifications and marks them read on open', async () => {
    (customerApi.notifications as any).mockResolvedValue({ unreadCount: 1, items: [
      { id: 'n1', type: 'appointment', title: 'Appointment booked', body: 'Gel Manicure on 2026-07-01 at 10:00', reference: 'a1', readAt: null, createdAt: '2026-06-09T10:00:00Z' },
    ] });
    render(<MemoryRouter><NotificationsScreen /></MemoryRouter>);
    expect(await screen.findByText('Appointment booked')).toBeInTheDocument();
    expect(screen.getByText('Gel Manicure on 2026-07-01 at 10:00')).toBeInTheDocument();
    await waitFor(() => expect(customerApi.markNotificationsRead).toHaveBeenCalledTimes(1)); // badge clears
  });
  it('shows an honest empty state', async () => {
    (customerApi.notifications as any).mockResolvedValue({ unreadCount: 0, items: [] });
    render(<MemoryRouter><NotificationsScreen /></MemoryRouter>);
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
  });
});
