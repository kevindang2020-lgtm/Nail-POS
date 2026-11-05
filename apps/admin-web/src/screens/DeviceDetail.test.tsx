import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DeviceDetailDrawer } from './DeviceDetail';

const deviceMgmtDevice = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { deviceMgmtDevice: (...a: any[]) => deviceMgmtDevice(...a) } }));

const detail = (over: any = {}) => ({ ok: true, device: {
  id: '1', name: 'iMac Reception POS', type: 'Reception POS', tenant: 'AI PowerSalon', branch: 'Downtown Branch', serial: 'IMAC-RECP-001',
  os: 'macOS 14.4', appVersion: '3.7.2', lastConnection: '1 min ago', status: 'Online', assignedUser: 'Jessica Miller', merchantTerminalId: 'MT-8821-0091',
  securityStatus: 'Compliant', updateStatus: 'Up To Date', ownershipType: 'Tenant owned', manufacturer: '—', model: '—', osVersion: 'macOS 14.4',
  minRequiredVersion: '—', configVersion: '—', connectionStatus: 'Online', lastHeartbeat: '1 min ago', ipMasked: '•••.•••.•••.•••', networkType: '—',
  sessionStatus: 'Active', lockStatus: 'Unlocked', certificateStatus: '—', maintenanceStatus: 'None', note: 'Device credentials, tokens, and private keys are never displayed.', ...over,
} });

describe('DeviceDetailDrawer', () => {
  beforeEach(() => { deviceMgmtDevice.mockReset(); deviceMgmtDevice.mockResolvedValue(detail()); });

  it('shows identity, assignment, connectivity, and security with a masked IP', async () => {
    render(<DeviceDetailDrawer id="1" onClose={() => {}} />);
    expect(await screen.findByText('iMac Reception POS')).toBeInTheDocument();
    expect(screen.getByText('Ownership')).toBeInTheDocument();
    expect(screen.getByText('Tenant owned')).toBeInTheDocument();
    expect(screen.getByText('•••.•••.•••.•••')).toBeInTheDocument();
    expect(screen.getByText(/never displayed/)).toBeInTheDocument();
  });

  it('does not expose any secret/token/private-key value', async () => {
    render(<DeviceDetailDrawer id="1" onClose={() => {}} />);
    await screen.findByText('iMac Reception POS');
    // masked IP present, no raw credential rendered
    expect(screen.queryByText(/sk_live|-----BEGIN|bearer /i)).not.toBeInTheDocument();
  });

  it('shows an error when the device is missing', async () => {
    deviceMgmtDevice.mockResolvedValue({ ok: false, errors: ['Device not found.'] });
    render(<DeviceDetailDrawer id="x" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Device not found/)).toBeInTheDocument());
  });
});
