import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeliveryHistory } from './AccountKit';
import { posMePrefsApi } from '../api/posMePrefsApi';

vi.mock('../api/posMePrefsApi', () => ({ posMePrefsApi: { deliveries: vi.fn(), notifications: vi.fn(), setNotifications: vi.fn(), loginAlerts: vi.fn() } }));

describe('DeliveryHistory (batch 8 decision 7)', () => {
  it('reads my own deliveries newest first and filters on the server', async () => {
    vi.mocked(posMePrefsApi.deliveries).mockResolvedValue({ items: [
      { id: 'd1', channel: 'sms', targetMasked: '***-0101', template: 'missed_call_alert', status: 'delivered', error: null, createdAt: '2026-11-09T15:00:00Z' },
      { id: 'd2', channel: 'email', targetMasked: 'o***@x.test', template: 'weekly_report', status: 'failed', error: 'mailbox full', createdAt: '2026-11-08T15:00:00Z' },
    ], page: 1, pageSize: 10, total: 2, totalPages: 1 });
    render(<DeliveryHistory />);
    expect(await screen.findAllByTestId('acx-dh-row')).toHaveLength(2);
    expect(screen.getByText('mailbox full')).toBeInTheDocument();
    expect(posMePrefsApi.deliveries).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
    fireEvent.change(screen.getByTestId('acx-dh-status'), { target: { value: 'failed' } });
    await waitFor(() => expect(posMePrefsApi.deliveries).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', page: 1 })));
  });
});
