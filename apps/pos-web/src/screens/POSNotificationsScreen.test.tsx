import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { recentMock, optOutsMock, optInMock } = vi.hoisted(() => ({ recentMock: vi.fn(), optOutsMock: vi.fn(), optInMock: vi.fn() }));
vi.mock('../api/posNotificationsApi', () => ({ posNotificationsApi: { recent: recentMock, optOuts: optOutsMock, optIn: optInMock, optOut: vi.fn(), send: vi.fn() } }));
import { POSNotificationsScreen } from './POSNotificationsScreen';
beforeEach(() => { [recentMock, optOutsMock, optInMock].forEach((m) => m.mockReset()); });

const log = [
  { id: 'n1', channel: 'sms', toAddress: '+15551234', subject: null, status: 'sent', failureReason: null, createdAt: '2026-07-06T10:00:00Z' },
  { id: 'n2', channel: 'email', toAddress: 'a@b.com', subject: 'Hi', status: 'blocked', failureReason: 'opted_out', createdAt: '2026-07-06T09:00:00Z' },
];
const opts = [{ channel: 'sms', address: '+15559999', reason: 'STOP', optedOutAt: '2026-07-01T08:00:00Z' }];

describe('POSNotificationsScreen', () => {
  it('shows KPIs and the send activity log', async () => {
    recentMock.mockResolvedValue({ items: log }); optOutsMock.mockResolvedValue({ items: opts });
    render(<POSNotificationsScreen />);
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('+15551234')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Recipient opted out')).toBeInTheDocument();
  });
  it('switches to opt-outs and re-subscribes a recipient', async () => {
    recentMock.mockResolvedValue({ items: log }); optOutsMock.mockResolvedValue({ items: opts }); optInMock.mockResolvedValue({});
    render(<POSNotificationsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Opt-outs' }));
    expect(await screen.findByText('+15559999')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Re-subscribe' }));
    await waitFor(() => expect(optInMock).toHaveBeenCalledWith('sms', '+15559999'));
  });
});
