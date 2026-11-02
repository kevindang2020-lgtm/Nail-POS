import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockLive, mockIncident, mockNotify, mockExport, mockXlsx, mockPdf, mockSupport } = vi.hoisted(() => ({ mockSupport: vi.fn(), mockLive: vi.fn(), mockIncident: vi.fn(), mockNotify: vi.fn(), mockExport: vi.fn(), mockXlsx: vi.fn(), mockPdf: vi.fn() }));
vi.mock('../api/superAdminQueueApi', async () => {
  const actual = await vi.importActual<any>('../api/superAdminQueueApi');
  return { ...actual, superAdminQueueApi: { liveOverview: (q: any) => mockLive(q), openIncident: (b: any) => mockIncident(b), notifyBranch: (b: any) => mockNotify(b), exportCsv: (q: any) => mockExport(q), exportXlsx: (q: any) => mockXlsx(q), exportPdf: (q: any) => mockPdf(q), supportSession: (b: any) => mockSupport(b) } };
});

import QueueManagementScreen from './QueueManagementScreen';

const overview = (active: boolean) => ({
  ok: true,
  meta: { generatedAt: '2026-05-06T18:34:00Z', scope: 'platform' },
  kpis: {
    customersWaiting: active ? 86 : 0, techniciansAvailable: active ? 142 : null, customersInService: active ? 198 : 0,
    avgWaitMin: active ? 21 : 0, longestWaitMin: active ? 68 : 0, unassignedCustomers: active ? 23 : 0,
    queueSyncPct: null, stuckRecords: active ? 7 : 0, offlineDevices: active ? 9 : 0,
    customersOverThreshold: active ? 14 : 0, congestedBranches: active ? 5 : 0,
  },
  queues: {
    rows: active ? [
      { queueId: 'q-100245aa', tenantId: '11111111-1111-1111-1111-111111111111', branchId: 'b1111111-1111-1111-1111-111111111111', customer: 'Emma Johnson', tenantName: 'Glamour Studio', branchName: 'Downtown', status: 'waiting', bucket: 'unassigned', waitMin: 18, technicianName: null, service: 'Hair Cut', isVip: false, deviceStatus: 'unknown', syncStatus: 'unknown', thresholdFlag: 'none', stuck: false, stuckReason: null },
      { queueId: 'q-100241aa', tenantId: '11111111-1111-1111-1111-111111111111', branchId: 'b2222222-2222-2222-2222-222222222222', customer: 'Ava Miller', tenantName: 'Radiant Beauty', branchName: 'West End', status: 'waiting', bucket: 'unassigned', waitMin: 67, technicianName: null, service: 'Blow Dry', isVip: false, deviceStatus: 'unknown', syncStatus: 'unknown', thresholdFlag: 'critical', stuck: true, stuckReason: 'waiting_no_change' },
    ] : [],
    total: active ? 86 : 0, page: 1, pageSize: 10, totalPages: active ? 9 : 1,
  },
  healthAlerts: { congestedBranches: active ? 5 : 0, offlineDevices: active ? 9 : 0, customersOverThreshold: active ? 14 : 0, stuckRecords: active ? 7 : 0 },
  waitTimeByBranch: active ? [{ branchId: 'b1', branch: 'West End', avgWaitMin: 31 }] : [],
  liveStatusDistribution: { slices: active ? [{ bucket: 'in_service', count: 198 }, { bucket: 'waiting', count: 86 }] : [], total: active ? 284 : 0 },
  topBranches: active ? [{ branchId: 'b1', branch: 'Downtown', activeCount: 58 }] : [],
  synchronizationStatus: { available: false, reason: 'No per-queue synchronization source connected' },
  recentEvents: active ? [{ at: '2026-05-06T18:32:00Z', queueId: 'q-100237', summary: 'q-100237 added to queue', branch: 'Uptown', tenantName: 'Elite Cuts', newState: 'waiting', kind: 'queued' }] : [],
  branchesOverThreshold: active ? [{ branchId: 'b1', branch: 'West End', overThreshold: 5, longestWaitMin: 67 }] : [],
  congestion: active ? [{ branchId: 'b1', branch: 'West End', level: 'critical', score: 0, waiting: 12 }] : [],
  technicianAvailability: active ? { total: 214, available: 142, busy: 64, onBreak: 8, slices: [{ label: 'Available', count: 142 }, { label: 'Busy', count: 64 }, { label: 'On Break', count: 8 }] } : { available: false, reason: 'No technician availability reported' },
  queueVolumeTrend: active ? [{ hour: 8, count: 12 }, { hour: 14, count: 30 }] : [],
  todaySummary: { totalQueues: active ? 282 : 0, totalCustomers: active ? 306 : 0, avgWaitMin: active ? 21 : 0, longestWaitMin: active ? 68 : 0, completedServices: active ? 198 : 0, thresholdBreaches: active ? 14 : 0, syncSuccessPct: null, stuckRecords: active ? 7 : 0, offlineDevices: active ? 9 : 0 },
  waitAnalytics: {
    overall: { count: active ? 86 : 0, avgMin: active ? 21 : 0, medianMin: active ? 18 : 0, p90Min: active ? 52 : 0, longestMin: active ? 67 : 0 },
    overThreshold: active ? 14 : 0, thresholds: { warningMin: 30, alertMin: 45, criticalMin: 60 },
    byBranch: active ? [{ branchId: 'b1', branch: 'West End', waiting: 12, overThreshold: 5, avgMin: 31, medianMin: 28, p90Min: 60, longestMin: 67 }] : [],
  },
  stuckRecords: active ? [{ queueId: 'q-100241aa', tenantName: 'Radiant Beauty', branchName: 'West End', customer: 'Ava Miller', status: 'waiting', reason: 'waiting_no_change', stuckMin: 95, waitMin: 67 }] : [],
  queueTimelines: active ? [{ queueId: 'q-100241aa', customer: 'Ava Miller', tenantName: 'Radiant Beauty', branchName: 'West End', source: 'walk_in', currentState: 'waiting', events: [{ at: '2026-05-06T13:27:00Z', label: 'Entered queue via walk in', state: 'waiting', kind: 'queued' }, { at: '2026-05-06T14:34:00Z', label: 'Wait exceeded 45 min (critical)', state: 'alert', kind: 'threshold' }] }] : [],
  trends: active ? { customersWaiting: { delta: -3, pct: -3.4, favorable: true }, stuckRecords: { delta: 2, pct: 40, favorable: false }, techniciansAvailable: { delta: 0, pct: 0, favorable: null } } : {},
  trendsSince: active ? '2026-05-06T12:34:00Z' : null,
});

const renderScreen = (view: any = 'all') => render(<MemoryRouter><QueueManagementScreen view={view} /></MemoryRouter>);

beforeEach(() => { mockSupport.mockReset(); mockLive.mockReset(); mockIncident.mockReset(); mockNotify.mockReset(); mockExport.mockReset(); mockXlsx.mockReset(); mockPdf.mockReset(); });

describe('Live Queue Monitor (Super Admin)', () => {
  it('renders all 11 KPI cards', async () => {
    mockLive.mockResolvedValue(overview(true));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Customers Waiting')).toBeInTheDocument());
    for (const l of ['Customers Waiting', 'Technicians Available', 'Customers Being Served', 'Average Wait Time', 'Longest Wait Time', 'Unassigned Customers', 'Queue Sync Status', 'Stuck Queue Records', 'Offline Queue Devices', 'Customers Over Threshold', 'Congested Branches']) {
      expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    }
  });

  it('renders every reference module + the monitoring boundary', async () => {
    mockLive.mockResolvedValue(overview(true));
    renderScreen();
    await waitFor(() => expect(screen.getByText('All Live Queues')).toBeInTheDocument());
    for (const m of ['All Live Queues', 'Queue Health & Alerts', 'Oversight Actions', 'Queue Volume Trend', 'Avg Wait by Branch', 'Live Status Distribution', 'Top Branches by Queue Size', 'Queue Synchronization Status', 'Recent Queue Events', 'Branches Over Threshold', 'Technician Availability', 'At-a-Glance Summary (Today)', 'SUPER ADMIN MONITORING BOUNDARY']) {
      expect(screen.getByText(m)).toBeInTheDocument();
    }
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument();
    expect(screen.getByText('Ava Miller')).toBeInTheDocument();
  });

  it('renders the 8 oversight actions', async () => {
    mockLive.mockResolvedValue(overview(true));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Oversight Actions')).toBeInTheDocument());
    for (const a of ['Filter queues by tenant or branch', 'Review queue timelines', 'Investigate stuck records', 'Retry synchronization', 'Notify branch manager', 'Open support incident', 'View queue history', 'Export wait-time analytics']) {
      expect(screen.getByText(a)).toBeInTheDocument();
    }
  });

  it('shows sync as NotConnected (honest gap) and never fabricates a sync %', async () => {
    mockLive.mockResolvedValue(overview(true));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Queue Synchronization Status')).toBeInTheDocument());
    expect(screen.getAllByText('NotConnected').length).toBeGreaterThan(0);
  });

  it('does NOT render any queue-mutation controls (monitoring boundary)', async () => {
    mockLive.mockResolvedValue(overview(true));
    renderScreen();
    await waitFor(() => expect(screen.getByText('All Live Queues')).toBeInTheDocument());
    const buttonLabels = screen.getAllByRole('button').map((b) => (b.textContent || '').toLowerCase());
    for (const forbidden of ['reorder', 'assign technician', 'start service', 'complete service', 'checkout', 'capture payment', 'remove from queue', 'mark serving']) {
      expect(buttonLabels.some((l) => l.includes(forbidden))).toBe(false);
    }
  });

  it('focuses Stuck Records view (filters to stuck rows)', async () => {
    mockLive.mockResolvedValue(overview(true));
    renderScreen('stuck');
    await waitFor(() => expect(screen.getAllByText('Ava Miller').length).toBeGreaterThan(0));
    expect(screen.queryByText('Emma Johnson')).toBeNull(); // non-stuck filtered out in stuck view
  });

  it('opens a real Support Incident modal from a row action and creates the incident', async () => {
    mockLive.mockResolvedValue(overview(true));
    mockIncident.mockResolvedValue({ ok: true, ticketNumber: 'SUP-XYZ', ticketId: 'tk1', status: 'submitted' });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Emma Johnson')).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText('Row actions')[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open support incident' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Open Support Incident' })).toBeInTheDocument());
    fireEvent.click(screen.getByText('Open Incident'));
    await waitFor(() => expect(mockIncident).toHaveBeenCalled());
    const arg = mockIncident.mock.calls[0][0];
    expect(arg.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(arg.queueIds).toContain('q-100245aa');
  });

  it('renders a dedicated Wait-Time Analytics panel on the wait-times view', async () => {
    mockLive.mockResolvedValue(overview(true));
    renderScreen('wait-times');
    await waitFor(() => expect(screen.getByText('Wait-Time Analytics')).toBeInTheDocument());
    expect(screen.getByText('90th pct')).toBeInTheDocument();
    expect(screen.getByText(/Thresholds — warning 30m/)).toBeInTheDocument();
  });

  it('renders a dedicated Stuck Records table on the stuck view', async () => {
    mockLive.mockResolvedValue(overview(true));
    renderScreen('stuck');
    await waitFor(() => expect(screen.getAllByText('Stuck Records').length).toBeGreaterThan(0));
    expect(screen.getByText('Waiting with no change')).toBeInTheDocument();
    expect(screen.getByText(/never changes a customer/)).toBeInTheDocument();
  });

  it('renders a dedicated Queue Timelines view reconstructed from lifecycle timestamps', async () => {
    mockLive.mockResolvedValue(overview(true));
    renderScreen('timelines');
    await waitFor(() => expect(screen.getByText('Queue Timelines')).toBeInTheDocument());
    expect(screen.getByText('Entered queue via walk in')).toBeInTheDocument();
    expect(screen.getByText(/reconstructed from lifecycle timestamps/i)).toBeInTheDocument();
  });

  it('renders business-semantic trend chips on KPI cards', async () => {
    mockLive.mockResolvedValue(overview(true));
    renderScreen();
    await waitFor(() => expect(screen.getByText('Customers Waiting')).toBeInTheDocument());
    expect(screen.getAllByText(/vs prior/).length).toBeGreaterThan(0);
    expect(screen.getByText(/trends vs/)).toBeInTheDocument(); // subtitle baseline note
  });

  it('offers a real XLSX export that calls the server export-xlsx endpoint', async () => {
    mockLive.mockResolvedValue(overview(true));
    mockXlsx.mockResolvedValue(new Blob(['x'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Export (XLSX)')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Export (XLSX)'));
    await waitFor(() => expect(mockXlsx).toHaveBeenCalledTimes(1));
  });

  it('offers a real PDF export that calls the server export-pdf endpoint', async () => {
    mockLive.mockResolvedValue(overview(true));
    mockPdf.mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' }));
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Export (PDF)')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Export (PDF)'));
    await waitFor(() => expect(mockPdf).toHaveBeenCalledTimes(1));
  });

  it('surfaces an honest error with retry when there is no data yet', async () => {
    mockLive.mockRejectedValue(new Error('platform API down'));
    renderScreen();
    await waitFor(() => expect(screen.getByText('platform API down')).toBeInTheDocument());
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
  it('support mode: names masked by default; a reasoned support session re-queries with supportTenantId; only a server-confirmed supportMode shows as on', async () => {
    mockLive.mockImplementation((q: any) => Promise.resolve({ ...overview(true), supportMode: q?.supportTenantId ? { tenantId: q.supportTenantId } : null }));
    mockSupport.mockResolvedValue({ ok: true, sessionId: 's1' });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Emma Johnson')).toBeInTheDocument());
    expect(screen.getByText(/Customer names are masked/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText('Row actions')[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: /Support mode/ }));
    const input = await screen.findByLabelText('Reason');
    fireEvent.change(input, { target: { value: 'Ticket 4411 — salon asked' } });
    fireEvent.click(screen.getByText('Open support session'));
    await waitFor(() => expect(mockSupport).toHaveBeenCalledWith({ tenantId: '11111111-1111-1111-1111-111111111111', branchId: 'b1111111-1111-1111-1111-111111111111', reason: 'Ticket 4411 — salon asked' }));
    await waitFor(() => expect(mockLive.mock.calls.some((c) => c[0]?.supportTenantId === '11111111-1111-1111-1111-111111111111')).toBe(true));
    await waitFor(() => expect(screen.getByText('End support mode')).toBeInTheDocument());
  });

  it('support mode: a session the server did not honour is reported as not granted (names stay masked)', async () => {
    mockLive.mockResolvedValue({ ...overview(true), supportMode: null });
    mockSupport.mockResolvedValue({ ok: true });
    renderScreen();
    await waitFor(() => expect(screen.getByText('Emma Johnson')).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText('Row actions')[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: /Support mode/ }));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'checking a stuck row' } });
    fireEvent.click(screen.getByText('Open support session'));
    await waitFor(() => expect(screen.getByText(/was not granted/)).toBeInTheDocument());
    expect(screen.queryByText('End support mode')).toBeNull();
  });
});
