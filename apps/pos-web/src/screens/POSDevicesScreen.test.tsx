import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { POSDevicesScreen } from './POSDevicesScreen';

const { overview } = vi.hoisted(() => ({
  overview: {
    kpis: { connectedDevices: 42, onlineDevices: 38, onlinePct: 90.5, paymentTerminals: 6, terminalsAllConnected: true, locationsConnected: 2, integrationHealthPct: null, apiCallsToday: null, syncSuccessRate: null, pendingUpdates: null },
    fleet: [
      { id: '1', name: 'Reception iMac 24"', type: 'iMac (24-inch)', branch: 'Downtown Branch', branchId: 'b1', station: 'Reception Desk', status: 'online', lastSyncIso: null, lastSyncLabel: '1 min ago' },
      { id: '2', name: 'Tech iPhone — Lily', type: 'iPhone 14 Pro', branch: 'Downtown Branch', branchId: 'b1', station: 'Nail Station 5', status: 'reconnecting', lastSyncIso: null, lastSyncLabel: '9 min ago' },
    ],
    terminals: [{ id: 't1', label: 'Clover Flex #1', station: 'Front Desk', status: 'paired' }],
    charts: { statusMix: { online: 38, offline: 3, maintenance: 1 }, devicesByBranch: [{ branch: 'Downtown Branch', branchId: 'b1', count: 34 }, { branch: 'Uptown Branch', branchId: 'b2', count: 8 }], integrationHealthMix: null, syncSuccess7d: [] },
    dataQuality: { fleetSource: true, terminalsSource: true, metricsUnavailable: ['integrationHealthPct', 'apiCallsToday', 'syncSuccessRate', 'pendingUpdates'] },
  },
}));

vi.mock('../api/posDevicesApi', () => ({ posDevicesApi: {
  overview: vi.fn().mockResolvedValue(overview),
  refreshDevice: vi.fn().mockResolvedValue({ requested: true, online: false }),
  revokeDevice: vi.fn().mockResolvedValue({ revoked: true }),
  testTerminal: vi.fn().mockResolvedValue({ id: 't1', reachable: true, detail: 'reachable' }),
  unpairTerminal: vi.fn().mockResolvedValue({ ok: true }),
  pairTerminal: vi.fn().mockResolvedValue({ id: 'x', status: 'paired' }),
  setTerminalRegister: vi.fn().mockResolvedValue({ id: 't1', stationId: 'reg-back', registerName: 'Back Register' }),
} }));
vi.mock('../api/posCustomerDisplaysApi', () => ({ posCustomerDisplaysApi: { state: vi.fn().mockResolvedValue({ branchId: 'b1', devices: [], canManage: true, stations: [{ id: 'reg-front', name: 'Front Desk', branchId: 'b1' }, { id: 'reg-back', name: 'Back Register', branchId: 'b1' }] }) } }));
vi.mock('../api/posAiApi', () => ({
  posAiApi: { packages: vi.fn().mockResolvedValue({ packages: [
    { code: 'ai_phone_call_assistant', name: 'AI Phone Call Assistant', description: '', usageUnit: 'calls', subscription: { status: 'active', usageLimit: 500 }, used: 0, remainingUsage: 500, accessible: true, lockReason: null, lockLabel: null, trialAvailable: false },
    { code: 'ai_booking_assistant', name: 'AI Booking Assistant', description: '', usageUnit: 'messages', subscription: { status: 'cancelled', usageLimit: 0 }, used: 0, remainingUsage: 0, accessible: false, lockReason: 'cancelled', lockLabel: 'This AI package was cancelled', trialAvailable: false },
    { code: 'ai_voice_transcription', name: 'AI Voice Transcription', description: '', usageUnit: 'minutes', subscription: { status: 'trialing', usageLimit: 0 }, used: 0, remainingUsage: 0, accessible: false, lockReason: 'trial_expired', lockLabel: 'Your free trial has ended', trialAvailable: false },
  ] }) },
}));
vi.mock('../api/posPhoneApi', () => ({ posPhoneApi: {
  readiness: vi.fn().mockResolvedValue({ account: { state: 'connected', lastCheckedAt: null }, voice: { numberVoiceCapable: true, fixLink: '' }, outbound: { state: 'ready_to_attempt' } }),
  healthCheck: vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 })),
} }));
vi.mock('../api/posDeviceFleetApi', () => ({ posDeviceFleetApi: {
  summary: vi.fn().mockResolvedValue({ class: 'all', registered: 0, online: 0, attention: 0, unassigned: 0, disabled: 0, retired: 0, extra: {}, checkedAt: '2026-11-09T10:00:00Z' }),
  devices: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 }),
  history: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 }),
  check: vi.fn(),
} }));
vi.mock('../api/posSettingsApi', () => ({
  posSettingsApi: { gatewayStatus: vi.fn().mockResolvedValue({ processorType: 'Clover (Fiserv)', environment: 'production', merchantIdMasked: '••••6789', status: 'active', configured: true }) },
}));

vi.mock('../api/posDeploymentsApi', () => ({
  posDeploymentsApi: {
    state: vi.fn().mockResolvedValue({ deployments: [
      { id: 'd1', component: 'iPad App (Front Desk)', componentKind: 'app', installedVersion: 'v3.2.1', latestVersion: 'v3.3.0', targetCount: 2, status: 'available', scheduledIso: null, branchId: null, updateAvailable: true },
      { id: 'd2', component: 'AI Receptionist (Twilio)', componentKind: 'app', installedVersion: 'v1.4.2', latestVersion: 'v1.4.2', targetCount: 0, status: 'up_to_date', scheduledIso: null, branchId: null, updateAvailable: false },
    ], summary: { total: 2, pending: 1, upToDate: 1, inProgress: 0 } }),
    advance: vi.fn(),
  },
}));

describe('POSDevicesScreen', () => {
  it('renders the 1:1 command center wired to the real overview aggregate', async () => {
    render(<MemoryRouter><POSDevicesScreen /></MemoryRouter>);
    expect(await screen.findByText('Devices & Integrations')).toBeInTheDocument();
    expect(screen.getAllByText('Registered devices').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('42').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Device Fleet Overview')).toBeInTheDocument();
    expect(await screen.findByText('Reception iMac 24"')).toBeInTheDocument();
    expect(screen.getByText('Payment & POS Hardware')).toBeInTheDocument();
    expect(await screen.findByText('Clover Flex #1')).toBeInTheDocument();
    expect(screen.getByText('AI / Communication Integrations')).toBeInTheDocument();
    expect(await screen.findByText('AI Phone Call Assistant')).toBeInTheDocument();
    expect(screen.getByText('Device Status Mix')).toBeInTheDocument();
    expect(screen.getByText('Devices by Branch')).toBeInTheDocument();
    expect(screen.getByText('Deployment & Update Control')).toBeInTheDocument();
    expect(screen.getByText('Connection / Sync Insights')).toBeInTheDocument();
    expect(await screen.findByText('iPad App (Front Desk)')).toBeInTheDocument();
    expect(screen.getByText('1 Pending')).toBeInTheDocument();
    expect(screen.getAllByText(/Not connected/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Device' })).toBeInTheDocument();
  });

  it('AI & Communication shows subscription, provider and readiness separately — a connected provider never makes a cancelled package operable', async () => {
    render(<MemoryRouter><POSDevicesScreen /></MemoryRouter>);
    const rows = await screen.findAllByTestId('aic-row');
    expect(rows.map((r) => r.getAttribute('data-code'))).toEqual(['ai_booking_assistant', 'ai_phone_call_assistant', 'ai_voice_transcription']);
    const st = (r: HTMLElement, id: string) => r.querySelector(`[data-testid="${id}"]`)!.getAttribute('data-state');
    expect([st(rows[0], 'aic-ent'), st(rows[0], 'aic-prov'), st(rows[0], 'aic-ready')]).toEqual(['cancelled', 'connected', 'not_permitted']);
    expect([st(rows[1], 'aic-ent'), st(rows[1], 'aic-ready')]).toEqual(['active', 'ready']);
    expect(st(rows[2], 'aic-ent')).toBe('trial_expired');
    expect(screen.getByTestId('aic-m-entitled').textContent).toContain('1');
    expect(screen.getByTestId('dev-registry')).toBeInTheDocument();
  });

  it('shows an honest empty fleet when no devices are registered', async () => {
    const empty = { ...overview, kpis: { ...overview.kpis, connectedDevices: 0, onlineDevices: 0, onlinePct: null, paymentTerminals: 0, terminalsAllConnected: false, locationsConnected: 0 }, fleet: [], terminals: [], charts: { ...overview.charts, statusMix: { online: 0, offline: 0, maintenance: 0 }, devicesByBranch: [] } };
    const mod = await import('../api/posDevicesApi');
    (mod.posDevicesApi.overview as any).mockResolvedValueOnce(empty);
    render(<MemoryRouter><POSDevicesScreen /></MemoryRouter>);
    expect(await screen.findByText('No devices registered yet. Pair a device to populate the fleet.')).toBeInTheDocument();
  });
  it('a display\'s check is a real Refresh (the server says whether it is connected) and Add Device goes to pairing', async () => {
    const mod = await import('../api/posDevicesApi');
    render(<MemoryRouter initialEntries={['/tenant/devices/overview']}><Routes>
      <Route path="/tenant/devices/overview" element={<POSDevicesScreen />} />
      <Route path="/tenant/devices/customer-displays" element={<div>customer displays screen</div>} />
    </Routes></MemoryRouter>);
    await screen.findByText('Reception iMac 24"');
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
    expect((mod.posDevicesApi.refreshDevice as any)).toHaveBeenCalledWith('1');
    // offline: said plainly — never "test command sent" for a display that cannot hear it
    expect(await screen.findByText(/is offline — it loads fresh when it reconnects/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Device' }));
    expect(await screen.findByText('customer displays screen')).toBeInTheDocument();
  });

  // Oct 6 2026: a terminal serves one of the location's REGISTERS (it was a free-text "Station" no charge could match)
  it('a terminal shows the register it serves, and the register can be changed from the list', async () => {
    const mod = await import('../api/posDevicesApi');
    render(<MemoryRouter><POSDevicesScreen /></MemoryRouter>);
    const sel = await screen.findByLabelText('Register for Clover Flex #1') as HTMLSelectElement;
    await screen.findByRole('option', { name: 'Back Register' });
    expect(sel.value).toBe('reg-front');                                        // "Front Desk" is that register
    fireEvent.change(sel, { target: { value: 'reg-back' } });
    expect((mod.posDevicesApi.setTerminalRegister as any)).toHaveBeenCalledWith('t1', 'reg-back');
    expect(await screen.findByText('Clover Flex #1 now serves Back Register.')).toBeInTheDocument();
  });
  it('pairing a terminal picks its register from the location\'s registers (not free text)', async () => {
    const mod = await import('../api/posDevicesApi');
    render(<MemoryRouter><POSDevicesScreen /></MemoryRouter>);
    await screen.findByText('Clover Flex #1');
    fireEvent.click(screen.getByRole('button', { name: 'Pair Terminal' }));
    fireEvent.change(screen.getByPlaceholderText('6-digit code'), { target: { value: '123456' } });
    const reg = screen.getByLabelText('Register') as HTMLSelectElement;
    expect(reg.tagName).toBe('SELECT');
    fireEvent.change(reg, { target: { value: 'reg-back' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
    await screen.findByText('Terminal paired.');
    expect((mod.posDevicesApi.pairTerminal as any)).toHaveBeenCalledWith(expect.objectContaining({ code: '123456', stationId: 'reg-back' }));
  });
  // Tablets 04 Assignment Conflict Preview
  it('choosing a register another terminal already serves names it first and sends nothing until confirmed', async () => {
    const mod = await import('../api/posDevicesApi');
    (mod.posDevicesApi.overview as any).mockResolvedValue({ ...overview, terminals: [{ id: 't1', label: 'Clover Flex #1', station: 'Front Desk', status: 'paired' }, { id: 't2', label: 'Clover Flex #2', station: 'Back Register', status: 'paired' }] });
    (mod.posDevicesApi.setTerminalRegister as any).mockClear();
    render(<MemoryRouter><POSDevicesScreen /></MemoryRouter>);
    const sel = await screen.findByLabelText('Register for Clover Flex #1') as HTMLSelectElement;
    await screen.findAllByRole('option', { name: 'Back Register' });
    fireEvent.change(sel, { target: { value: 'reg-back' } });
    expect(await screen.findByTestId('register-conflict')).toHaveTextContent('Back Register is already served by Clover Flex #2. If Clover Flex #1 serves it too');
    expect((mod.posDevicesApi.setTerminalRegister as any)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('register-conflict-no'));
    expect(screen.queryByTestId('register-conflict')).toBeNull();
    expect((mod.posDevicesApi.setTerminalRegister as any)).not.toHaveBeenCalled();
    fireEvent.change(sel, { target: { value: 'reg-back' } });
    fireEvent.click(await screen.findByTestId('register-conflict-yes'));
    expect((mod.posDevicesApi.setTerminalRegister as any)).toHaveBeenCalledWith('t1', 'reg-back');
    // a free register goes straight through; the pairing form warns about a taken one
    (mod.posDevicesApi.setTerminalRegister as any).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Pair Terminal' }));
    fireEvent.change(screen.getByLabelText('Register'), { target: { value: 'reg-front' } });
    expect(screen.getByTestId('pair-register-conflict')).toHaveTextContent('Front Desk is already served by Clover Flex #1.');
    fireEvent.change(screen.getByLabelText('Register'), { target: { value: '' } });
    expect(screen.queryByTestId('pair-register-conflict')).toBeNull();
    (mod.posDevicesApi.overview as any).mockResolvedValue(overview);
  });
});
