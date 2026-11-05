import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockFailed, mockRetry } = vi.hoisted(() => ({ mockFailed: vi.fn(), mockRetry: vi.fn() }));
vi.mock('../api/superAdminBookingCheckinApi', () => ({ superAdminBookingCheckinApi: { failedEvents: (q: any) => mockFailed(q), retryFailedEvent: (id: string, b: any) => mockRetry(id, b) } }));

import FailedEventsScreen from './FailedEventsScreen';

const row = (i: number, over: Partial<any> = {}) => ({
  id: `e${i}`, eventCode: `EVT-9000${i}`, branch: 'Downtown', category: 'check_in', source: 'kiosk', checkInMethod: 'kiosk',
  failureType: 'device_offline', errorCode: 'E_OFFLINE', errorMessage: 'Device did not respond', correlationId: `corr-${i}`,
  retryStatus: 'retry_available', retryCount: 0, attemptCount: 1, escalationState: 'none', resolution: '—',
  occurredAt: '2026-06-30T14:24:00Z', lastAttemptAt: null, ...over,
});
const pageResp = (rows: any[], total = rows.length, page = 1, pageSize = 25) => ({ ok: true, scope: { tenantId: null, branchId: null, label: 'All tenants' }, range: { start: '', endInclusive: '' }, page, pageSize, total, rows });

const renderScreen = () => render(<MemoryRouter initialEntries={['/booking-checkin/failed-events']}><FailedEventsScreen /></MemoryRouter>);
beforeEach(() => { mockFailed.mockReset(); mockRetry.mockReset(); });

describe('FailedEventsScreen', () => {
  it('renders the failed-events table rows', async () => {
    mockFailed.mockResolvedValue(pageResp([row(1), row(2)]));
    renderScreen();
    await waitFor(() => expect(screen.getByText('EVT-90001')).toBeInTheDocument());
    expect(screen.getByText('EVT-90002')).toBeInTheDocument();
    expect(screen.getByText('2 events')).toBeInTheDocument();
  });

  it('opens a safe detail drawer on row click (shows correlation id, no secret fields)', async () => {
    mockFailed.mockResolvedValue(pageResp([row(1)]));
    renderScreen();
    await waitFor(() => expect(screen.getByText('EVT-90001')).toBeInTheDocument());
    fireEvent.click(screen.getByText('EVT-90001'));
    await waitFor(() => expect(screen.getByText('Correlation ID')).toBeInTheDocument());
    expect(screen.getByText('corr-1')).toBeInTheDocument();
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
  });

  it('re-queries when the category filter changes', async () => {
    mockFailed.mockResolvedValue(pageResp([row(1)]));
    renderScreen();
    await waitFor(() => expect(mockFailed).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'api' } });
    await waitFor(() => expect(mockFailed).toHaveBeenCalledWith(expect.objectContaining({ category: 'api' })));
  });

  it('shows an empty state when there are no matching events', async () => {
    mockFailed.mockResolvedValue(pageResp([], 0));
    renderScreen();
    await waitFor(() => expect(screen.getByText('No failed events match these filters.')).toBeInTheDocument());
  });

  it('surfaces an error with a retry', async () => {
    mockFailed.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(pageResp([row(1)]));
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Couldn/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('EVT-90001')).toBeInTheDocument());
  });

  it('offers a controlled Retry for an eligible event and shows the result', async () => {
    mockFailed.mockResolvedValue(pageResp([row(1, { retryStatus: 'retry_available' })]));
    mockRetry.mockResolvedValue({ ok: true, eligible: true, idempotentReplay: false, escalated: false, attempt: { id: 'a1', attemptNumber: 1, status: 'requested', backoffSeconds: 30, nextRetryAt: null, createdAt: '' }, event: { retryStatus: 'retrying', retryCount: 1, escalationState: 'none' } });
    renderScreen();
    await waitFor(() => expect(screen.getByText('EVT-90001')).toBeInTheDocument());
    fireEvent.click(screen.getByText('EVT-90001'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry event' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Retry event' }));
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith('e1', expect.any(Object)));
    await waitFor(() => expect(screen.getByText(/Retry #1 queued/)).toBeInTheDocument());
  });

  it('does not offer Retry for a non-eligible event', async () => {
    mockFailed.mockResolvedValue(pageResp([row(2, { retryStatus: 'not_retryable' })]));
    renderScreen();
    await waitFor(() => expect(screen.getByText('EVT-90002')).toBeInTheDocument());
    fireEvent.click(screen.getByText('EVT-90002'));
    await waitFor(() => expect(screen.getByText(/only for events in the/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Retry event' })).not.toBeInTheDocument();
  });

});
