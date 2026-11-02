import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockSources } = vi.hoisted(() => ({ mockSources: vi.fn() }));
vi.mock('../api/superAdminBookingCheckinApi', () => ({ superAdminBookingCheckinApi: { bookingSources: (q: any) => mockSources(q) } }));

import BookingSourcesScreen from './BookingSourcesScreen';

const row = (key: string, label: string, over: Partial<any> = {}) => ({
  key, label, total: 7, confirmed: 5, completed: 2, cancelled: 1, noShow: 0, failed: 1,
  confirmationRate: 71.4, completionRate: 28.6, cancellationRate: 14.3, ...over,
});
const resp = (rows: any[]) => ({
  ok: true, scope: { tenantId: null, branchId: null, label: 'All tenants' }, range: { start: '', endInclusive: '' },
  rows, totals: rows.reduce((t, r) => ({ total: t.total + r.total, confirmed: t.confirmed + r.confirmed, completed: t.completed + r.completed, cancelled: t.cancelled + r.cancelled, noShow: t.noShow + r.noShow, failed: t.failed + r.failed }), { total: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0, failed: 0 }),
});
const renderScreen = () => render(<MemoryRouter initialEntries={['/booking-checkin/booking-sources']}><BookingSourcesScreen /></MemoryRouter>);
beforeEach(() => { mockSources.mockReset(); });

describe('BookingSourcesScreen', () => {
  it('renders per-source cards and the totals row', async () => {
    mockSources.mockResolvedValue(resp([row('online', 'Online'), row('ai_receptionist', 'AI Receptionist', { total: 3, confirmed: 2, failed: 0 })]));
    renderScreen();
    await waitFor(() => expect(screen.getByText('All Sources')).toBeInTheDocument());
    // Source labels appear in both card and table; both should render.
    expect(screen.getAllByText('Online').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('AI Receptionist').length).toBeGreaterThanOrEqual(1);
  });

  it('re-queries when the date range changes', async () => {
    mockSources.mockResolvedValue(resp([row('online', 'Online')]));
    renderScreen();
    await waitFor(() => expect(mockSources).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: '30' } });
    await waitFor(() => expect(mockSources).toHaveBeenCalledTimes(2));
  });

  it('shows an empty state when there are no bookings', async () => {
    mockSources.mockResolvedValue(resp([row('online', 'Online', { total: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0, failed: 0 })]));
    renderScreen();
    await waitFor(() => expect(screen.getByText('No bookings in this period.')).toBeInTheDocument());
  });

  it('surfaces an error with a retry', async () => {
    mockSources.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(resp([row('online', 'Online')]));
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Couldn/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('All Sources')).toBeInTheDocument());
  });
});
