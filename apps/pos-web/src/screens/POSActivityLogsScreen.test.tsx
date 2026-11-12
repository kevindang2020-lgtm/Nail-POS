import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSActivityLogsScreen } from './POSActivityLogsScreen';

const eventsMock = vi.fn();
vi.mock('../api/posAuditApi', () => ({ posAuditApi: { events: (...a: any[]) => eventsMock(...a) } }));

const page = {
  items: [
    { id: 'a1', occurredAt: '2026-05-06T14:21:00Z', actorUserId: 'u1', actorRole: 'OWNER', actorName: 'Sophia Nguyen', module: 'security', action: 'password.updated', resourceType: 'user', summary: 'Account password was changed', status: 'success', severity: 'medium', ip: '10.0.0.5', device: 'Chrome' },
    { id: 'a2', occurredAt: '2026-05-05T08:15:00Z', actorUserId: null, actorRole: null, actorName: 'System', module: 'billing', action: 'billing.receipt_generated', resourceType: 'invoice', summary: 'Receipt for May 2026 payment', status: 'success', severity: 'low', ip: null, device: null },
  ],
  pagination: { page: 1, pageSize: 12, totalItems: 37, totalPages: 4 },
};

beforeEach(() => { eventsMock.mockReset(); eventsMock.mockResolvedValue(page); });

describe('POSActivityLogsScreen', () => {
  it('renders real audit events from the feed with humanized actions', async () => {
    render(<MemoryRouter><POSActivityLogsScreen /></MemoryRouter>);
    expect(screen.getByText('Activity Log')).toBeInTheDocument();
    expect(await screen.findByText('Password Updated')).toBeInTheDocument();
    expect(screen.getByText('Billing Receipt Generated')).toBeInTheDocument();
    expect(screen.getByText('Account password was changed')).toBeInTheDocument();
    // total from pagination
    expect(screen.getByText('37')).toBeInTheDocument();
    // pagination state
    expect(screen.getByText('Page 1 / 4')).toBeInTheDocument();
  });

  it('passes filters to the endpoint and resets to page 1', async () => {
    render(<MemoryRouter><POSActivityLogsScreen /></MemoryRouter>);
    await screen.findByText('Password Updated');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });
    // the latest call should include status: 'failed' and page 1
    await vi.waitFor(() => {
      const calls = eventsMock.mock.calls;
      const last = calls[calls.length - 1]?.[0];
      expect(last).toMatchObject({ status: 'failed', page: 1, pageSize: 12 });
    });
  });
  it('a deep link (?module=&search=) opens the log pre-filtered — the Customer Retention audit shortcut', async () => {
    render(<MemoryRouter initialEntries={['/tenant/account/activity-logs?module=retention&search=cmp-1']}><POSActivityLogsScreen /></MemoryRouter>);
    await screen.findByText('Password Updated');
    expect(eventsMock.mock.calls[0][0]).toMatchObject({ module: 'retention', search: 'cmp-1', page: 1 });
  });
});
