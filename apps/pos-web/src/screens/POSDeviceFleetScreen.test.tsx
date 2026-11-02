import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { ovMock } = vi.hoisted(() => ({ ovMock: vi.fn() }));
vi.mock('../api/posDevicesApi', () => ({ posDevicesApi: { overview: ovMock } }));
import { POSDeviceFleetScreen } from './POSDeviceFleetScreen';
beforeEach(() => ovMock.mockReset());

const dev = (o: any = {}) => ({ id: 'd1', name: 'Front Desk iPad', type: 'reception_pos', branch: 'Main', branchId: 'b1', station: 'S1', status: 'online', lastSyncIso: null, lastSyncLabel: '2m ago', ...o });
const overview = {
  kpis: { connectedDevices: 3, onlineDevices: 2, onlinePct: 66.7, paymentTerminals: 1, terminalsAllConnected: true, locationsConnected: 1, integrationHealthPct: null, apiCallsToday: null, syncSuccessRate: null, pendingUpdates: null },
  fleet: [dev(), dev({ id: 'd2', name: 'Lobby Kiosk', type: 'check_in_kiosk', status: 'offline' }), dev({ id: 'd3', name: 'Printer 1', type: 'printer', status: 'maintenance', station: null })],
  terminals: [{ id: 't1', label: 'Terminal 1', station: 'S1', status: 'connected' }],
  charts: { statusMix: { online: 2, offline: 1, maintenance: 0 }, devicesByBranch: [], integrationHealthMix: null, syncSuccess7d: [] },
  dataQuality: { fleetSource: true, terminalsSource: true, metricsUnavailable: ['syncSuccessRate'] },
};

describe('POSDeviceFleetScreen', () => {
  it('type view filters the fleet (reception-pos shows only reception_pos)', async () => {
    ovMock.mockResolvedValue(overview);
    render(<POSDeviceFleetScreen view="reception-pos" />);
    expect(await screen.findByRole('heading', { name: 'Reception POS' })).toBeInTheDocument();
    expect(screen.getByText('Front Desk iPad')).toBeInTheDocument();
    expect(screen.queryByText('Lobby Kiosk')).not.toBeInTheDocument();
  });
  it('receipt-devices shows an empty state when no printers', async () => {
    ovMock.mockResolvedValue({ ...overview, fleet: [dev()] });
    render(<POSDeviceFleetScreen view="receipt-devices" />);
    expect(await screen.findByText(/No receipt printer connected/)).toBeInTheDocument();
  });
  it('health view shows KPIs and the full fleet', async () => {
    ovMock.mockResolvedValue(overview);
    render(<POSDeviceFleetScreen view="health" />);
    expect(await screen.findByRole('heading', { name: 'Device Health' })).toBeInTheDocument();
    expect(screen.getByText('Connected Devices').closest('.kpi')?.querySelector('.v')?.textContent).toContain('3');
    expect(screen.getByText('Front Desk iPad')).toBeInTheDocument();
    expect(screen.getByText('Lobby Kiosk')).toBeInTheDocument();
  });
  it('assignments view groups by branch', async () => {
    ovMock.mockResolvedValue(overview);
    render(<POSDeviceFleetScreen view="assignments" />);
    expect(await screen.findByRole('heading', { name: 'Device Assignments' })).toBeInTheDocument();
    expect(screen.getAllByText('Main').length).toBeGreaterThan(0);
  });
});
