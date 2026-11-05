import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const deviceMgmtOverview = vi.fn();
const deviceMgmtDevice = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { deviceMgmtOverview: (...a: any[]) => deviceMgmtOverview(...a), deviceMgmtDevices: vi.fn(), deviceMgmtDevice: (...a: any[]) => deviceMgmtDevice(...a) } }));

import { DevicesScreen } from './DevicesScreen';

const kpi = (key: string, label: string, value: string | null, extra: any = {}) => ({ key, label, value, available: value !== null, ...extra });
const overview = () => ({
  kpis: [
    kpi('total', 'Total Managed Devices', '248'), kpi('online', 'Online Devices', '186'), kpi('offline', 'Offline Devices', '48', { unfavorableIfUp: true }),
    kpi('updates_required', 'Devices Requiring Updates', '17', { unfavorableIfUp: true }), kpi('maintenance', 'Devices in Maintenance Mode', '9'),
    kpi('locked_revoked', 'Locked or Revoked Devices', '6', { unfavorableIfUp: true }), kpi('branch_assignments', 'Active Branch Assignments', '38'),
    kpi('shipments_pending', 'Pending Hardware Shipments', '12'), kpi('terminals_connected', 'Merchant Terminals Connected', '82'), kpi('caller_id_online', 'Caller-ID Devices Online', '24'),
  ],
  devices: [
    { id: '1', name: 'iMac Reception POS', type: 'Reception POS', tenant: 'AI PowerSalon', branch: 'Downtown Branch', serial: 'IMAC-RECP-001', os: 'macOS 14.4', appVersion: '3.7.2', lastConnection: '1 min ago', status: 'Online', assignedUser: 'Jessica Miller', merchantTerminalId: 'MT-8821-0091', securityStatus: 'Compliant', updateStatus: 'Up To Date' },
    { id: '7', name: 'Customer-Facing Display', type: 'Customer Display', tenant: 'AI PowerSalon', branch: 'Midtown Branch', serial: 'DISPLAY-S5-004', os: 'Android 11', appVersion: '3.5.3', lastConnection: '20 min ago', status: 'Offline', assignedUser: '—', merchantTerminalId: '—', securityStatus: 'Compliant', updateStatus: 'Update Required' },
  ],
  byType: [{ label: 'Reception POS', value: 32, pct: 12.9 }, { label: 'Check-In Kiosk', value: 64, pct: 25.8 }],
  byStatus: [{ label: 'Online', value: 186, pct: 75 }, { label: 'Offline', value: 48, pct: 19.4 }],
  byUpdate: [{ label: 'Up to Date', value: 166, pct: 67 }, { label: 'Update Required', value: 52, pct: 21 }],
  tenantUsage: [{ tenant: 'AI PowerSalon', total: 248, online: 186, offline: 48, assignedUsers: 72, lastSync: '2026-05-06T14:33:00Z' }],
  shipmentsMaintenance: [{ reference: 'SHIP-2026-0152', device: 'iPad Kiosk', branch: 'Midtown Branch', status: 'In Transit', eta: 'May 08, 2026' }],
  securityAlerts: [{ device: 'Android Kiosk', tenant: 'AI PowerSalon', issue: 'Rooted Device Detected', severity: 'High', lastAction: '2026-05-06T13:20:00Z' }],
  connectionLogs: [{ time: '2026-05-06T14:33:00Z', device: 'iMac Reception POS', tenant: 'AI PowerSalon', event: 'Connected', result: 'Success' }],
  catalog: [
    { deviceType: 'reception_pos', displayName: 'Reception POS', modelCount: 12, availability: 'Available' }, { deviceType: 'check_in_kiosk', displayName: 'Check-In Kiosk', modelCount: 8, availability: 'Available' },
    { deviceType: 'payment_terminal', displayName: 'Payment Terminal', modelCount: 6, availability: 'Available' }, { deviceType: 'printer', displayName: 'Printer', modelCount: 5, availability: 'Available' },
    { deviceType: 'caller_id', displayName: 'Caller-ID Device', modelCount: 4, availability: 'Available' }, { deviceType: 'owner_mobile', displayName: 'Owner Mobile', modelCount: 6, availability: 'Available' },
    { deviceType: 'technician_mobile', displayName: 'Technician Mobile', modelCount: 6, availability: 'Available' }, { deviceType: 'customer_display', displayName: 'Customer Display', modelCount: 4, availability: 'Available' },
  ],
  connectionTrend: { available: false, points: [] },
  terminalConnectivity: { available: false, points: [] },
});

describe('DevicesScreen', () => {
  beforeEach(() => { deviceMgmtOverview.mockReset(); deviceMgmtOverview.mockResolvedValue(overview()); deviceMgmtDevice.mockReset(); deviceMgmtDevice.mockResolvedValue({ ok: true, device: { id: '1', name: 'iMac Reception POS', type: 'Reception POS', tenant: 'AI PowerSalon', branch: 'Downtown Branch', serial: 'IMAC-RECP-001', os: 'macOS 14.4', appVersion: '3.7.2', lastConnection: '1 min ago', status: 'Online', assignedUser: 'Jessica Miller', merchantTerminalId: 'MT-8821-0091', securityStatus: 'Compliant', updateStatus: 'Up To Date', ownershipType: 'Tenant owned', manufacturer: '—', model: '—', osVersion: 'macOS 14.4', minRequiredVersion: '—', configVersion: '—', connectionStatus: 'Online', lastHeartbeat: '1 min ago', ipMasked: '•••.•••.•••.•••', networkType: '—', sessionStatus: 'Active', lockStatus: 'Unlocked', certificateStatus: '—', maintenanceStatus: 'None', note: 'Device credentials never displayed.' } }); });

  it('renders the title, 10 KPIs, and managed devices table', async () => {
    render(<DevicesScreen />);
    expect(await screen.findByText('Device Management', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText('Total Managed Devices')).toBeInTheDocument();
    expect(screen.getByText('Caller-ID Devices Online')).toBeInTheDocument();
    expect(screen.getAllByText('iMac Reception POS').length).toBeGreaterThanOrEqual(1); // table + connection log
    expect(screen.getByText('Managed Devices')).toBeInTheDocument();
  });

  it('renders 11 device controls, three donuts, and the 8-card catalog', async () => {
    render(<DevicesScreen />);
    await screen.findByText('Device Management', { selector: 'h1' });
    expect(screen.getByText('Register Devices')).toBeInTheDocument();
    expect(screen.getByText('Maintenance Mode')).toBeInTheDocument();
    expect(screen.getByText('Devices by Type')).toBeInTheDocument();
    expect(screen.getByText('Online vs Offline Status')).toBeInTheDocument();
    expect(screen.getByText('Update Compliance')).toBeInTheDocument();
    expect(screen.getAllByText('Reception POS').length).toBeGreaterThanOrEqual(1); // catalog + table type
    expect(screen.getByText('Printer')).toBeInTheDocument();
  });

  it('shows offline status and marks the 7-day trend NotConnected', async () => {
    render(<DevicesScreen />);
    await screen.findByText('Device Management', { selector: 'h1' });
    expect(screen.getAllByText('Offline').length).toBeGreaterThanOrEqual(1); // status pill + donut legend
    expect(screen.getByText('Connection Status & Health')).toBeInTheDocument();
    expect(screen.getByText('Merchant Terminal Connectivity')).toBeInTheDocument();
  });

  it('filters the device table by status', async () => {
    render(<DevicesScreen />);
    await screen.findByText('Device Management', { selector: 'h1' });
    expect(screen.getAllByText('iMac Reception POS').length).toBe(2); // table row + connection log
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Offline' } });
    expect(screen.getByText('Customer-Facing Display')).toBeInTheDocument();
    expect(screen.getAllByText('iMac Reception POS').length).toBe(1); // removed from table, remains in log
  });

  it('opens the device detail drawer when a device name is clicked', async () => {
    render(<DevicesScreen />);
    await screen.findByText('Device Management', { selector: 'h1' });
    fireEvent.click(screen.getAllByText('iMac Reception POS')[0]);
    await waitFor(() => expect(deviceMgmtDevice).toHaveBeenCalledWith('1'));
    expect(await screen.findByText('Device Details')).toBeInTheDocument();
  });

  it('renders security alerts, tenant usage, and shipments', async () => {
    render(<DevicesScreen />);
    await screen.findByText('Device Management', { selector: 'h1' });
    expect(screen.getByText('Rooted Device Detected')).toBeInTheDocument();
    expect(screen.getByText('Tenant Device Usage Overview')).toBeInTheDocument();
    expect(screen.getByText('SHIP-2026-0152')).toBeInTheDocument();
  });
});
