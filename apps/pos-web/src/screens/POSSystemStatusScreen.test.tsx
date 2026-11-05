import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mock = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock('../api/posHelpCenterApi', () => ({ posHelpCenterApi: mock }));

import { POSSystemStatusScreen } from './POSSystemStatusScreen';

const healthy = {
  overall: { status: 'operational', label: 'All Systems Operational', healthy: true },
  components: [
    { key: 'db', name: 'Database', status: 'operational' },
    { key: 'sms', name: 'SMS Service', status: 'operational' },
  ],
  incidents: [{ id: 'i1', title: 'SMS delivery delay', status: 'resolved', impact: 'minor', startedAt: '2026-07-20T10:00:00Z', resolvedAt: '2026-07-20T11:00:00Z' }],
};

beforeEach(() => { vi.clearAllMocks(); mock.status.mockResolvedValue(healthy); });

describe('POSSystemStatusScreen (real /tenant/help/status only)', () => {
  it('renders overall, every component with its status, and past incidents — no fabricated metrics', async () => {
    render(<MemoryRouter><POSSystemStatusScreen /></MemoryRouter>);
    await screen.findByText('All Systems Operational');
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('SMS Service')).toBeInTheDocument();
    expect(screen.getByText(/No active alerts/)).toBeInTheDocument();
    expect(screen.getByText('SMS delivery delay')).toBeInTheDocument();
    // the mockup's unmeasured figures must NOT appear
    expect(screen.queryByText(/99\.9|Uptime \(7|Response Time \(Avg/)).toBeNull();
  });

  it('a degraded component surfaces as an Active Alert, never hidden behind a green banner', async () => {
    mock.status.mockResolvedValue({
      overall: { status: 'degraded', label: 'Degraded Performance', healthy: false },
      components: [{ key: 'sms', name: 'SMS Service', status: 'degraded' }],
      incidents: [],
    });
    render(<MemoryRouter><POSSystemStatusScreen /></MemoryRouter>);
    await screen.findByText('Degraded Performance');
    const alerts = screen.getAllByText('SMS Service');
    expect(alerts.length).toBeGreaterThanOrEqual(2);         // table row AND Active Alerts entry
    expect(screen.queryByText(/No active alerts/)).toBeNull();
  });

  it('Refresh re-queries the endpoint; a failed load says so honestly', async () => {
    render(<MemoryRouter><POSSystemStatusScreen /></MemoryRouter>);
    await screen.findByText('All Systems Operational');
    mock.status.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByText('Refresh Status'));
    await screen.findByText('Status Unavailable');
    await waitFor(() => expect(mock.status).toHaveBeenCalledTimes(2));
  });
});

  // "Last Check" is the one per-component metric with a real source (status_components.updated_at). The design's
// Response Time and Uptime (7D) columns have no column in the schema and must NOT appear as invented values.
it('renders Last Check from the API and shows a dash when the platform has not reported one', async () => {
  const withChecks = {
    overall: { status: 'operational', label: 'All Systems Operational', healthy: true },
    components: [
      { key: 'api', name: 'API Gateway', status: 'operational', lastCheckedAt: '2026-05-06T14:34:20.000Z' },
      { key: 'sms', name: 'SMS Service', status: 'operational', lastCheckedAt: null },
    ],
    incidents: [],
  };
  mock.status.mockResolvedValue(withChecks);
  render(<MemoryRouter><POSSystemStatusScreen /></MemoryRouter>);
  expect(await screen.findByText('API Gateway')).toBeInTheDocument();
  expect(screen.getByText('Last Check')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();                  // null → dash, never a made-up time
  expect(screen.queryByText(/Response Time/)).toBeNull();             // no invented per-service metrics
  expect(screen.queryByText(/Uptime/)).toBeNull();
});
