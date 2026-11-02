import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockOverview, mockExport } = vi.hoisted(() => ({ mockOverview: vi.fn(), mockExport: vi.fn() }));
vi.mock('../api/superAdminBookingCheckinApi', () => ({ superAdminBookingCheckinApi: { overview: (q: any) => mockOverview(q), exportReport: (q: any) => mockExport(q) } }));

import BookingCheckinScreen from './BookingCheckinScreen';

const kpi = (key: string, label: string, value: number, available = true) => ({ key, label, value, display: value.toLocaleString(), deltaPct: 5, direction: 'up' as const, semantic: 'good' as const, available, href: 'booking-sources?source=online' });
const overview = (opts: { devices?: boolean; empty?: boolean } = {}) => ({
  ok: true,
  metadata: { generatedAt: '2026-06-30T00:00:00Z', range: { start: '2026-06-30', endInclusive: '2026-06-30' }, prior: { start: '2026-06-29', end: '2026-06-30' } },
  scope: { tenantId: null, branchId: null, label: 'All tenants' },
  boundary: 'Super Admin monitors the flow but does not act as the salon receptionist.',
  kpis: [
    kpi('online_bookings', 'Online Bookings', 1862), kpi('ai_bookings', 'AI Receptionist Bookings', 1248),
    kpi('mobile_bookings', 'Mobile-App Bookings', 1036), kpi('staff_bookings', 'Staff-Created Bookings', 784),
    kpi('walk_ins', 'Walk-Ins', 612), kpi('kiosk_check_ins', 'Kiosk Check-Ins', 326),
    kpi('failed_check_ins', 'Failed Check-Ins', 92), kpi('duplicate_check_ins', 'Duplicate Check-Ins', 64),
    kpi('avg_check_in_time', 'Average Check-In Time', 512), kpi('device_status', 'Check-In Device Status', 98),
    kpi('unmatched_customers', 'Unmatched Customer Records', 124), kpi('pending_confirmations', 'Bookings Waiting for Confirmation', 2),
    kpi('booking_api_failures', 'Booking API Failures', 27),
  ],
  lifecycle: { cohort: 'bookings_created_in_range', stages: [
    { key: 'booked', label: 'Booked', count: 10, pct: 100 }, { key: 'confirmed', label: 'Confirmed', count: 8, pct: 80 },
    { key: 'check_in_started', label: 'Check-In Started', count: 4, pct: 40 }, { key: 'waiting', label: 'Waiting', count: 1, pct: 10 },
    { key: 'serving', label: 'Serving / In Queue', count: 3, pct: 30 },
  ] },
  sourceBreakdown: { total: 10, rows: [{ key: 'online', label: 'Online', count: 7, pct: 70 }, { key: 'ai_receptionist', label: 'AI Receptionist', count: 3, pct: 30 }] },
  bookingsBySource: [{ key: 'online', label: 'Online', count: 7, pct: 70 }, { key: 'ai_receptionist', label: 'AI Receptionist', count: 3, pct: 30 }],
  checkInTrend: Array.from({ length: 7 }).map((_, i) => ({ day: `2026-06-2${i}`, checkIns: i, failed: 0 })),
  branchWaitTimes: [{ rank: 1, branchId: 'b1', branch: 'Downtown', avgWaitSeconds: 738, avgWaitDisplay: '12m 18s', bookings: 5, checkIns: 3, status: 'poor' as const }],
  deviceStatus: opts.devices === false
    ? { available: false, rows: [], totalDevices: 0, totalOffline: 0, overallUptime: 0 }
    : { available: true, rows: [{ type: 'kiosk', online: 2, offline: 1, uptime: 66.7 }], totalDevices: 7, totalOffline: 2, overallUptime: 71.4 },
  integrationHealth: { available: true, tenantsConfigured: 2, onlineBookingEnabled: 2, googleReserveConnected: 1, aiPhoneEnabled: 1, successRate24h: { value: null, available: false }, failedRequests24h: { value: 0, available: false }, retryQueue: { value: 0, available: false }, syncIssues: { value: 0, available: false } },
  pendingConfirmations: { available: true, count: 1, rows: [{ id: 'h1', branch: 'Downtown', bookedAt: '2026-06-30T14:00:00Z' }] },
  aiHandoffs: opts.empty ? { available: true, rows: [] } : { available: true, rows: [{ callCode: 'CALL-55671', branch: 'Downtown', transferredTo: 'front_desk', reason: 'complex_request', status: 'completed', time: '2026-06-30T14:31:00Z' }] },
  unmatchedCustomers: opts.empty ? { available: true, rows: [] } : { available: true, rows: [{ id: 'u1', name: 'J. Anderson', source: 'online', possibleMatches: 2, lastContact: '2026-06-30T14:28:00Z' }] },
  failedEvents: opts.empty ? { available: true, rows: [] } : { available: true, rows: [{ eventCode: 'EVT-98231', branch: 'Downtown', source: 'online', failureType: 'payment_failed', time: '2026-06-30T14:31:00Z', retryStatus: 'retrying' }] },
  todaySummary: { avgWait: { seconds: 512, display: '08m 32s', available: true }, duplicateCheckInRate: { value: 0, available: false }, confirmationRate: { value: 80, available: true }, deviceUptime: { value: 71.4, available: true }, queueConversion: { value: 75, available: true } },
});

const renderScreen = () => render(<MemoryRouter initialEntries={['/booking-checkin']}><BookingCheckinScreen /></MemoryRouter>);

beforeEach(() => { mockOverview.mockReset(); mockExport.mockReset(); });

describe('BookingCheckinScreen — Overview (Super Admin)', () => {
  it('renders the title, subtitle and boundary card', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    expect(screen.getByText('Booking & Check-In Monitor')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/does not act as the salon receptionist/)).toBeInTheDocument());
  });

  it('renders all 13 KPI cards with real values', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Online Bookings')).toBeInTheDocument());
    expect(screen.getByText('1,862')).toBeInTheDocument();
    expect(screen.getByText('Booking API Failures')).toBeInTheDocument();
    expect(screen.getByText('Duplicate Check-Ins')).toBeInTheDocument();
    expect(screen.getByText('124')).toBeInTheDocument();
  });

  it('renders the nine Super Admin Actions and the device status panel', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Super Admin Actions')).toBeInTheDocument());
    expect(screen.getByText('Retry Supported Events')).toBeInTheDocument();
    expect(screen.getByText('Open Controlled Support Mode')).toBeInTheDocument();
    expect(screen.getByText('Device Type')).toBeInTheDocument();
    expect(screen.getAllByText('71.4%').length).toBeGreaterThanOrEqual(1);
  });

  it('renders real rows in the failed-events, AI-handoff and unmatched modules', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText('AI Receptionist Handoff Monitor')).toBeInTheDocument());
    expect(screen.getByText('EVT-98231')).toBeInTheDocument();
    expect(screen.getByText('CALL-55671')).toBeInTheDocument();
    expect(screen.getByText('J. Anderson')).toBeInTheDocument();
  });

  it('shows honest in-range empty states when a provisioned store has no rows', async () => {
    mockOverview.mockResolvedValue(overview({ empty: true }));
    renderScreen();
    await waitFor(() => expect(screen.getByText('No failed events in range.')).toBeInTheDocument());
    expect(screen.getByText('No AI handoffs in range.')).toBeInTheDocument();
    expect(screen.getByText('No unmatched records.')).toBeInTheDocument();
  });

  it('shows an honest device empty state when no devices are registered', async () => {
    mockOverview.mockResolvedValue(overview({ devices: false }));
    renderScreen();
    await waitFor(() => expect(screen.getByText('No check-in devices registered in scope.')).toBeInTheDocument());
  });

  it('surfaces an error state with a retry that re-queries', async () => {
    mockOverview.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(overview());
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Couldn/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Online Bookings')).toBeInTheDocument());
  });

  it('re-queries when a filter changes (Status)', async () => {
    mockOverview.mockResolvedValue(overview());
    renderScreen();
    await waitFor(() => expect(mockOverview).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'confirmed' } });
    await waitFor(() => expect(mockOverview).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' })));
  });

  it('Export Report calls the server-side export endpoint', async () => {
    mockOverview.mockResolvedValue(overview());
    mockExport.mockResolvedValue({ ok: true, type: 'overview', format: 'csv', available: true, filename: 'booking-checkin-overview-2026-06-30.csv', csv: 'KPI,Value\nOnline Bookings,1862', rowCount: 1 });
    const origCreate = URL.createObjectURL; const origRevoke = URL.revokeObjectURL;
    (URL as any).createObjectURL = vi.fn(() => 'blob:x'); (URL as any).revokeObjectURL = vi.fn();
    render(<MemoryRouter><BookingCheckinScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Export Report/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Export Report/));
    await waitFor(() => expect(mockExport).toHaveBeenCalledWith(expect.objectContaining({ type: 'overview' })));
    (URL as any).createObjectURL = origCreate; (URL as any).revokeObjectURL = origRevoke;
  });


  it('shows a live auto-refresh indicator after loading', async () => {
    mockOverview.mockResolvedValue(overview());
    render(<MemoryRouter><BookingCheckinScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Live/)).toBeInTheDocument());
    expect(screen.getByText(/auto-refresh 20s/)).toBeInTheDocument();
  });

  it('auto-refreshes in the background on the interval', async () => {
    vi.useFakeTimers();
    try {
      mockOverview.mockResolvedValue(overview());
      render(<MemoryRouter><BookingCheckinScreen /></MemoryRouter>);
      await vi.advanceTimersByTimeAsync(0);
      const initial = mockOverview.mock.calls.length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(mockOverview.mock.calls.length).toBeGreaterThan(initial);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves last data and flags stale when a background refresh fails', async () => {
    vi.useFakeTimers();
    try {
      mockOverview.mockResolvedValueOnce(overview());
      render(<MemoryRouter><BookingCheckinScreen /></MemoryRouter>);
      await vi.advanceTimersByTimeAsync(0);
      mockOverview.mockRejectedValueOnce(new Error('blip'));
      await vi.advanceTimersByTimeAsync(20_000);
      // data preserved (KPIs still present) + stale banner shown
      expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
      expect(screen.getAllByText('Online Bookings').length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });

});
