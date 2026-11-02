// CheckInDevicesScreen — verifies the tenant picker loads, devices + settings render, the master switch and feature
// toggles call updateSettings, create surfaces the one-time token, regenerate reveals a new token, and disable wires through.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { state: vi.fn() } }));
vi.mock('../api/checkInDevicesApi', () => ({
  checkInDevicesApi: {
    state: vi.fn(), createDevice: vi.fn(), updateSettings: vi.fn(),
    setStatus: vi.fn(), regenerateToken: vi.fn(), disableDevice: vi.fn(), setBranches: vi.fn(), logs: vi.fn(),
  },
}));

import { superAdminApi } from '../api/superAdminApi';
import { checkInDevicesApi } from '../api/checkInDevicesApi';
import { CheckInDevicesScreen } from './CheckInDevicesScreen';

const SETTINGS = {
  enabled: true, appointmentCheckinEnabled: true, walkinCheckinEnabled: false, newCustomerEnabled: true,
  serviceSelectionEnabled: true, technicianPreferenceEnabled: false, tenantPhoneLookupEnabled: true,
  centralLookupEnabled: false, customerLinkingEnabled: true, showWaitEstimate: true, autoSendToQueue: true, requireFrontDeskApproval: false,
};
const device = (over: any = {}) => ({
  deviceId: 'd1', deviceName: 'Front Desk iPad', branchId: 'b1', deviceType: 'ipad_display',
  checkinSlug: 'abc123', publicUrl: 'https://checkin.x/go-check-in/abc123', status: 'active', lastSeenAt: '2026-06-17T00:00:00Z',
  tokenExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), allowedBranchIds: [], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (superAdminApi.state as any).mockResolvedValue({ tenants: [{ id: 't1', name: 'Palace Nails', branches: [{ id: 'b1', name: 'Cherry Hill' }, { id: 'b2', name: 'Marlton' }] }] });
  (checkInDevicesApi.state as any).mockResolvedValue({ devices: [device()], settings: { ...SETTINGS } });
  (checkInDevicesApi.logs as any).mockResolvedValue({ logs: [{ id: 'l1', branchId: 'b1', deviceId: 'd1', sessionId: null, eventType: 'session_started', safeMessage: 'Device created', createdAt: '2026-06-17T00:00:00Z' }] });
  (checkInDevicesApi.updateSettings as any).mockResolvedValue({ ...SETTINGS });
  (checkInDevicesApi.setStatus as any).mockResolvedValue(device({ status: 'inactive' }));
  (checkInDevicesApi.disableDevice as any).mockResolvedValue(device({ status: 'disabled' }));
  (checkInDevicesApi.setBranches as any).mockResolvedValue(device());
  (checkInDevicesApi.regenerateToken as any).mockResolvedValue({ deviceToken: 'NEW-TOKEN-XYZ', tokenExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString() });
  (checkInDevicesApi.createDevice as any).mockResolvedValue({ deviceId: 'd2', checkinSlug: 'new9', publicUrl: 'https://checkin.x/go-check-in/new9', deviceToken: 'ONE-TIME-TOK', tokenExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString() });
});

const renderScreen = () => render(<MemoryRouter initialEntries={['/?tenantId=t1']}><CheckInDevicesScreen /></MemoryRouter>);

describe('CheckInDevicesScreen', () => {
  it('loads the selected tenant\'s devices, status, and master state', async () => {
    renderScreen();
    expect(await screen.findByText('Front Desk iPad')).toBeInTheDocument();
    expect(screen.getByText(/Go Check-In is ON/)).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);   // device status badge
    expect(screen.getByText(/1 active · 1 total/)).toBeInTheDocument();
    expect(checkInDevicesApi.state).toHaveBeenCalledWith('t1');
  });

  it('shows pairing-token expiry, flagging an expired device', async () => {
    (checkInDevicesApi.state as any).mockResolvedValue({
      devices: [device({ status: 'active', tokenExpiresAt: new Date(Date.now() - 86400000).toISOString() })],
      settings: { ...SETTINGS },
    });
    renderScreen();
    await screen.findByText('Front Desk iPad');
    expect(screen.getByText('Active')).toBeInTheDocument();    // status badge
    expect(screen.getByText('Expired')).toBeInTheDocument();   // token column (past expiry)
  });

  it('shows the multi-branch indicator and edits a device\'s allowed branches', async () => {
    (checkInDevicesApi.state as any).mockResolvedValue({
      devices: [device({ branchId: 'b1', allowedBranchIds: ['b2'] })],
      settings: { ...SETTINGS },
    });
    const { container } = renderScreen();
    await screen.findByText('Front Desk iPad');
    expect(screen.getByText('+1')).toBeInTheDocument();                  // serves 1 additional branch
    fireEvent.click(screen.getByText('edit'));                           // open the inline branch editor
    // toggle Marlton off (it was an allowed branch) by unchecking it
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(checkInDevicesApi.setBranches).toHaveBeenCalledWith('t1', 'd1', { branchId: 'b1', allowedBranchIds: [] }));
  });

  it('master switch toggles the tenant enable flag', async () => {
    renderScreen();
    await screen.findByText('Front Desk iPad');
    const masterPanel = screen.getByText(/Go Check-In is/).closest('.panel') as HTMLElement;
    fireEvent.click(within(masterPanel).getByRole('switch'));
    await waitFor(() => expect(checkInDevicesApi.updateSettings).toHaveBeenCalledWith('t1', { enabled: false }));
  });

  it('a feature toggle calls updateSettings with that key', async () => {
    renderScreen();
    await screen.findByText('Front Desk iPad');
    const row = screen.getByText('Walk-in check-in').parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole('switch'));                  // was false → flips to true
    await waitFor(() => expect(checkInDevicesApi.updateSettings).toHaveBeenCalledWith('t1', { walkinCheckinEnabled: true }));
  });

  it('creating a device shows the one-time token', async () => {
    renderScreen();
    await screen.findByText('Front Desk iPad');
    fireEvent.change(screen.getByPlaceholderText('Front desk iPad'), { target: { value: 'Lobby Kiosk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create device' }));
    expect(await screen.findByText('ONE-TIME-TOK')).toBeInTheDocument();
    expect(checkInDevicesApi.createDevice).toHaveBeenCalledWith('t1', expect.objectContaining({ deviceName: 'Lobby Kiosk', deviceType: 'ipad_display' }));
  });

  it('regenerate reveals a fresh token and disable wires through', async () => {
    renderScreen();
    await screen.findByText('Front Desk iPad');
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(await screen.findByText('NEW-TOKEN-XYZ')).toBeInTheDocument();
    expect(checkInDevicesApi.regenerateToken).toHaveBeenCalledWith('t1', 'd1');

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(checkInDevicesApi.disableDevice).toHaveBeenCalledWith('t1', 'd1'));
  });
});
