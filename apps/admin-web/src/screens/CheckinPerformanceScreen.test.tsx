import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockPerf } = vi.hoisted(() => ({ mockPerf: vi.fn() }));
vi.mock('../api/superAdminBookingCheckinApi', () => ({ superAdminBookingCheckinApi: { checkinPerformance: (q: any) => mockPerf(q) } }));

import CheckinPerformanceScreen from './CheckinPerformanceScreen';

const method = (key: string, label: string, over: Partial<any> = {}) => ({
  key, label, sessions: 4, completed: 3, expired: 1, failed: 0, active: 0, completionRate: 75, avgDurationSec: 600, avgDurationDisplay: '10m 00s', ...over,
});
const resp = (methods: any[], available = true) => ({
  ok: true, scope: { tenantId: null, branchId: null, label: 'All tenants' }, range: { start: '', endInclusive: '' },
  summary: { totalSessions: methods.reduce((t, m) => t + m.sessions, 0), completed: methods.reduce((t, m) => t + m.completed, 0), expired: methods.reduce((t, m) => t + m.expired, 0), failed: 0, active: 0, completionRate: 75, avgDurationSec: 600, avgDurationDisplay: '10m 00s', available },
  methods,
});
const renderScreen = () => render(<MemoryRouter initialEntries={['/booking-checkin/check-in-performance']}><CheckinPerformanceScreen /></MemoryRouter>);
beforeEach(() => { mockPerf.mockReset(); });

describe('CheckinPerformanceScreen', () => {
  it('renders summary stats and per-method rows', async () => {
    mockPerf.mockResolvedValue(resp([method('kiosk', 'Kiosk')]));
    renderScreen();
    await waitFor(() => expect(screen.getAllByText('10m 00s').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText('Kiosk')).toBeInTheDocument();
    expect(screen.getByText('completed sessions')).toBeInTheDocument();
  });

  it('re-queries when the date range changes', async () => {
    mockPerf.mockResolvedValue(resp([method('kiosk', 'Kiosk')]));
    renderScreen();
    await waitFor(() => expect(mockPerf).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: '30' } });
    await waitFor(() => expect(mockPerf).toHaveBeenCalledTimes(2));
  });

  it('shows an empty state when there are no sessions', async () => {
    mockPerf.mockResolvedValue(resp([], false));
    renderScreen();
    await waitFor(() => expect(screen.getByText('No check-in sessions in this period.')).toBeInTheDocument());
  });

  it('surfaces an error with a retry', async () => {
    mockPerf.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(resp([method('kiosk', 'Kiosk')]));
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Couldn/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Kiosk')).toBeInTheDocument());
  });
});
