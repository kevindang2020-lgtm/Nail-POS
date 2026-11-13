// SUNMI batch 8 (Nov 9 2026): each Devices sub-page reads its OWN registry (/pos/device-fleet) — the old test asserted the
// buggy filter of the customer displays by types they never store.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ ov: vi.fn(), summary: vi.fn(), devices: vi.fn(), history: vi.fn(), check: vi.fn(), exportCsv: vi.fn(), download: vi.fn() }));
vi.mock('../api/posDevicesApi', () => ({ posDevicesApi: { overview: m.ov } }));
vi.mock('../api/posDeviceFleetApi', () => ({ posDeviceFleetApi: { summary: m.summary, devices: m.devices, history: m.history, check: m.check, exportCsv: m.exportCsv } }));
vi.mock('../components/FitKit', async (orig) => ({ ...(await orig<typeof import('../components/FitKit')>()), downloadText: m.download }));
import { POSDeviceFleetScreen } from './POSDeviceFleetScreen';

const dev = (o: Record<string, unknown> = {}) => ({ id: 'd1', source: 'station', class: 'reception_pos', name: 'Front Desk 1', type: 'reception_pos', branchId: 'b1', branch: 'Main', station: 'Front Desk 1', status: 'online', reason: null, lastSeenAt: null, createdAt: '2026-11-01T10:00:00Z', updatedAt: null, facts: { displays: 1 }, ...o });
const listOf = (items: unknown[]) => ({ class: 'reception_pos', items, total: items.length, page: 1, pageSize: 25, totalPages: 1, checkedAt: '2026-11-09T10:00:00Z', applied: {} });
const overview = { kpis: { connectedDevices: 3, onlineDevices: 2, onlinePct: 66.7, paymentTerminals: 1, locationsConnected: 1 }, fleet: [], terminals: [], charts: { statusMix: { online: 2, offline: 1, maintenance: 0 } }, dataQuality: {} };
const r = (view: Parameters<typeof POSDeviceFleetScreen>[0]['view']) => render(<MemoryRouter><POSDeviceFleetScreen view={view} /></MemoryRouter>);
beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.summary.mockResolvedValue({ class: 'reception_pos', checkedAt: '2026-11-09T10:00:00Z', registered: 3, online: 1, attention: 1, unassigned: 1, disabled: 0, retired: 1, extra: {} });
  m.devices.mockResolvedValue(listOf([dev(), dev({ id: 'd2', name: 'Back Bar', status: 'unassigned', reason: 'NO_DEDICATED_DISPLAY' })]));
  m.history.mockResolvedValue({ class: 'reception_pos', items: [{ id: 'h1', at: '2026-11-08T10:00:00Z', event: 'pos_station_created', entity: 'pos_station', deviceId: 'd2', actor: 'Kevin Owner', actorRole: 'OWNER', source: 'audit' }], total: 1, page: 1, pageSize: 25, totalPages: 1 });
  m.ov.mockResolvedValue(overview);
});

describe('Devices sub-pages', () => {
  it('Tablets 11: Export inventory asks the server for the redacted CSV with the current filters (no page) and downloads it; a refusal is shown; receipts have no export', async () => {
    m.exportCsv.mockResolvedValueOnce('Export,Device inventory and health\r\n').mockRejectedValueOnce(Object.assign(new Error('no'), { status: 403, code: 'PERMISSION_DENIED' }));
    const v = r('reception-pos');
    fireEvent.click(await screen.findByTestId('dfx-kpi-attention'));
    await waitFor(() => expect(m.devices).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'attention' })));
    fireEvent.click(screen.getByTestId('dfx-export'));
    await waitFor(() => expect(m.download).toHaveBeenCalledWith('device-inventory-reception_pos.csv', 'Export,Device inventory and health\r\n'));
    const arg = m.exportCsv.mock.calls[0][0];
    expect(arg).toMatchObject({ class: 'reception_pos', status: 'attention', page: undefined, pageSize: undefined });
    expect(await screen.findByTestId('dfx-export-note')).toHaveTextContent('Device inventory downloaded.');
    fireEvent.click(screen.getByTestId('dfx-export'));
    await waitFor(() => expect(screen.getByTestId('dfx-export-note').className).toContain('warn'));
    v.unmount();
    r('receipt-devices');
    await screen.findByTestId('dfx-check');
    expect(screen.queryByTestId('dfx-export')).toBeNull();
  });
  it('Reception POS reads the registers: four cards, the six columns, a reason, "connected" kept', async () => {
    r('reception-pos');
    expect(await screen.findByRole('heading', { name: 'Reception POS' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('dfx-kpi-registered').textContent).toContain('3'));
    expect(m.devices).toHaveBeenCalledWith(expect.objectContaining({ class: 'reception_pos', sort: 'newest', page: 1, pageSize: 25 }));
    expect(screen.getByTestId('dfx-connected').textContent).toMatch(/^1 connected/);
    expect(await screen.findAllByTestId('dfx-row')).toHaveLength(2);
    expect(screen.getByText(/No customer display paired/)).toBeInTheDocument();
  });
  it('a card filters the table; search goes to the server', async () => {
    r('reception-pos');
    fireEvent.click(await screen.findByTestId('dfx-kpi-attention'));
    await waitFor(() => expect(m.devices).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'attention', page: 1 })));
    fireEvent.change(screen.getByTestId('dfx-search'), { target: { value: 'front' } });
    fireEvent.click(screen.getByTestId('dfx-search-btn'));
    await waitFor(() => expect(m.devices).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'front' })));
  });
  it('Receipt Devices: printers NOT CONFIGURED, digital receipts are the history', async () => {
    m.summary.mockResolvedValue({ class: 'receipt', checkedAt: '2026-11-09T10:00:00Z', registered: 0, online: 0, attention: 0, unassigned: 0, disabled: 0, retired: 0, extra: { printerRegistry: 'not_configured', emailToday: 4, smsToday: 2, noReceiptToday: 1, failedToday: 0 } });
    m.history.mockResolvedValue({ class: 'receipt', items: [], receipts: [{ id: 'r1', at: '2026-11-09T10:00:00Z', choice: 'email', status: 'sent', ticket: '12', station: 'Front Desk 1' }], total: 1, page: 1, pageSize: 25, totalPages: 1 });
    r('receipt-devices');
    expect(await screen.findByText(/No receipt printer connected/)).toBeInTheDocument();
    expect(screen.getByTestId('dfx-kpi-printers').textContent).toMatch(/Not configured/);
    await waitFor(() => expect(screen.getByTestId('dfx-kpi-email').textContent).toContain('4'));
    expect(m.devices).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('dfx-tab-history'));
    expect(await screen.findByText('#12')).toBeInTheDocument();
  });
  it('Check-In Kiosks: kiosks are set up by AI PowerSalon (decision 1) — the page says so and links to support', async () => {
    m.summary.mockResolvedValue({ class: 'kiosk', checkedAt: '2026-11-09T10:00:00Z', registered: 0, online: 0, attention: 0, unassigned: 0, disabled: 0, retired: 0, extra: {} });
    m.devices.mockResolvedValue({ ...listOf([]), class: 'kiosk' });
    r('check-in-kiosk');
    expect(await screen.findByTestId('ksk-note')).toBeInTheDocument();
    expect(screen.getByTestId('ksk-request')).toBeInTheDocument();
  });
  it('Device Health keeps its original four cards from the Devices Overview', async () => {
    r('health');
    expect(await screen.findByRole('heading', { name: 'Device Health' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('dfx-kpi-connected').textContent).toContain('3'));
    expect(screen.getByTestId('dfx-kpi-terminals').textContent).toContain('1');
    expect(screen.getByTestId('dfx-kpi-locations').textContent).toContain('1');
    expect(m.devices).toHaveBeenCalledWith(expect.objectContaining({ class: 'all' }));
  });
  it('details show the device history; the check is read-only', async () => {
    m.check.mockResolvedValue({ class: 'reception_pos', overall: 'WARNING', checkedAt: '2026-11-09T10:00:00Z', checks: [{ key: 'devices_reporting', state: 'WARNING', count: 1 }, { key: 'no_side_effects', state: 'READY' }] });
    r('reception-pos');
    fireEvent.click((await screen.findAllByTestId('dfx-view'))[1]);
    const d = await screen.findByTestId('dfx-detail');
    await waitFor(() => expect(m.history).toHaveBeenCalledWith(expect.objectContaining({ class: 'reception_pos', deviceId: 'd2' })));
    expect(await within(d).findByText('Kevin Owner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('dfx-check'));
    expect(await screen.findByTestId('dfx-chk-devices_reporting')).toBeInTheDocument();
  });
});

describe('extras Device Assignments 09 — payment terminal routing guard', () => {
  it('a terminal\'s details show the server verdict, register pairing, reservation, processor and links; nothing is sent', async () => {
    const term = dev({ id: 't1', source: 'terminal', class: 'terminal', name: 'Compact 2', type: 'payment_terminal', status: 'online',
      facts: { operational: 'PROCESSING', hsnMasked: '••••0002', routing: { verdict: 'busy', operational: 'PROCESSING', registerPaired: true, reservedFor: 'ticket', reservedUntil: '2026-11-12T15:06:00Z',
        processor: 'clover', environment: 'sandbox', lastPingOk: true, lastPingAt: '2026-11-12T15:00:00Z', movesMoney: false } } });
    m.summary.mockResolvedValue({ class: 'terminal', checkedAt: '2026-11-09T10:00:00Z', registered: 1, online: 1, attention: 0, unassigned: 0, disabled: 0, retired: 0, extra: {} });
    m.devices.mockResolvedValue({ ...listOf([term]), class: 'all' });
    r('assignments');
    fireEvent.click((await screen.findAllByTestId('dfx-view'))[0]);
    const g = await screen.findByTestId('dfx-routing');
    expect(g).toHaveAttribute('data-verdict', 'busy');
    expect(g).toHaveTextContent('Reserved — another checkout is using it');
    expect(g).toHaveTextContent('Paired with a register');
    expect(g).toHaveTextContent(/Held by a checkout until Nov/);
    expect(g).toHaveTextContent('Clover · Sandbox / UAT');
    expect(g).toHaveTextContent('nothing is sent to the terminal');
    expect(within(screen.getByTestId('dfx-detail')).queryByText('[object Object]')).toBeNull();   // the routing object is not dumped as a fact
    expect(within(g).getByTestId('dfx-route-gateway')).toBeInTheDocument();
  });
  it('a register (not a terminal) has no routing guard', async () => {
    r('reception-pos');
    fireEvent.click((await screen.findAllByTestId('dfx-view'))[0]);
    await screen.findByTestId('dfx-detail');
    expect(screen.queryByTestId('dfx-routing')).toBeNull();
  });
});

describe('Reception POS — verified connected count (extras Reception POS #11)', () => {
  it('an unreadable registry summary shows "— connected", never a made-up 0; the readable count carries its checked-at time', async () => {
    m.summary.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    r('reception-pos');
    await waitFor(() => expect(screen.getByTestId('dfx-connected').textContent).toMatch(/^— connected/));
    expect(screen.getByTestId('dfx-connected').textContent).not.toMatch(/^0 /);
  });
});

describe('Device Assignments — duplicate identity (extras #06)', () => {
  it('the read-only check names devices that share a name in one location, with the count', async () => {
    m.check.mockResolvedValue({ class: 'reception_pos', overall: 'WARNING', checkedAt: '2026-11-09T10:00:00Z', checks: [{ key: 'duplicate_names', state: 'WARNING', count: 2 }] });
    r('reception-pos');
    await screen.findAllByTestId('dfx-row');
    fireEvent.click(screen.getByTestId('dfx-check'));
    const c = await screen.findByTestId('dfx-chk-duplicate_names');
    expect(c).toHaveTextContent('Devices sharing a name in one location (never merged automatically)');
    expect(c).toHaveTextContent('2');
  });
});

describe('Tablets — app version lifecycle (extras #08)', () => {
  it('each display shows its app version, older than the newest seen, or not reported; no upgrade is required without a policy', async () => {
    m.devices.mockResolvedValue(listOf([
      dev({ id: 't1', source: 'display', class: 'tablet', name: 'Tab A', type: 'tablet', facts: { appVersion: '2.10.0' } }),
      dev({ id: 't2', source: 'display', class: 'tablet', name: 'Tab B', type: 'tablet', facts: { appVersion: '2.9.4' } }),
      dev({ id: 't3', source: 'display', class: 'tablet', name: 'Tab C', type: 'tablet', facts: { appVersion: null } }),
    ]));
    r('tablets');
    const rows = await screen.findAllByTestId('dfx-row');
    const kinds = rows.map((x) => within(x).getByTestId('dfx-ver').getAttribute('data-kind'));
    expect(kinds).toEqual(['current', 'older', 'unreported']);
    expect(within(rows[1]).getByTestId('dfx-ver')).toHaveTextContent('Older app version 2.9.4 — newest on your devices is 2.10.0');
    expect(screen.getByTestId('dfx-ver-policy')).toHaveTextContent('no upgrade is required');
    expect(screen.queryByText(/unsupported/i)).toBeNull();
  });
  it('round 10 (Tablets 02): a display shows its OS and battery as reported — low battery reason, charging, when read, stale marked; unreported says so', async () => {
    m.devices.mockResolvedValue(listOf([
      dev({ id: 't1', source: 'display', class: 'tablet', name: 'Tab A', type: 'tablet', reason: 'BATTERY_LOW', facts: { appVersion: '2.10.0', osVersion: 'Android 13', batteryPercent: 9, batteryCharging: false, batteryReportedAt: '2026-11-13T10:00:00Z', batteryStale: false } }),
      dev({ id: 't2', source: 'display', class: 'tablet', name: 'Tab B', type: 'tablet', facts: { appVersion: '2.10.0', osVersion: null, batteryPercent: null, batteryCharging: null, batteryReportedAt: null, batteryStale: false } }),
      dev({ id: 't3', source: 'display', class: 'tablet', name: 'Tab C', type: 'tablet', facts: { batteryPercent: 80, batteryCharging: true, batteryReportedAt: '2026-11-12T10:00:00Z', batteryStale: true } }),
    ]));
    r('tablets');
    const rows = await screen.findAllByTestId('dfx-row');
    expect(rows[0]).toHaveTextContent('Battery low and not charging — plug it in');
    fireEvent.click(within(rows[0]).getByTestId('dfx-view'));
    let d = await screen.findByTestId('dfx-detail');
    expect(d).toHaveTextContent('Android 13');
    expect(within(d).getByTestId('dfx-battery')).toHaveTextContent(/^9% · not charging · read /);
    expect(within(d).queryByText('false')).toBeNull();   // booleans are words, never "false"
    fireEvent.click(within(d).getByText('Close'));
    fireEvent.click(within(rows[1]).getByTestId('dfx-view'));
    d = await screen.findByTestId('dfx-detail');
    expect(within(d).getByTestId('dfx-battery')).toHaveTextContent('this device does not report its battery');
    fireEvent.click(within(d).getByText('Close'));
    fireEvent.click(within(rows[2]).getByTestId('dfx-view'));
    d = await screen.findByTestId('dfx-detail');
    expect(within(d).getByTestId('dfx-battery')).toHaveTextContent('80% · charging');
    expect(within(d).getByTestId('dfx-battery')).toHaveTextContent('old reading — not the current level');
  });
  it('round 10 (Tablets 10): says whose devices these are; the location filter lists the server\'s locations with counts and asks the server', async () => {
    m.devices.mockResolvedValue({ ...listOf([dev({ id: 't1', source: 'display', class: 'tablet', name: 'Tab A', type: 'tablet', branch: 'Main', branchId: 'b1' })]),
      scope: { branchId: null, branchName: null }, branches: [{ branchId: 'b1', name: 'Main', devices: 3 }, { branchId: 'b2', name: 'Second', devices: 1 }, { branchId: null, name: null, devices: 2 }] });
    r('tablets');
    expect(await screen.findByTestId('dfx-scope')).toHaveTextContent('Showing devices of every location of the salon. · 2 not assigned to a location');
    const sel = screen.getByTestId('dfx-branch');
    expect([...sel.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['All locations in this list', 'Main (3)', 'Second (1)']);
    fireEvent.change(sel, { target: { value: 'b2' } });
    await waitFor(() => expect(m.devices).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: 'b2', page: 1 })));
  });
  it('a register (not a display) has no version line', async () => {
    r('reception-pos');
    await screen.findAllByTestId('dfx-row');
    expect(screen.queryByTestId('dfx-ver')).toBeNull();
    expect(screen.queryByTestId('dfx-ver-policy')).toBeNull();
  });

  it('extras Device Assignments 08: Device Assignments opens this register\'s hardware readiness (measured live, read only); other views have no such button', async () => {
    r('assignments');
    fireEvent.click(await screen.findByTestId('dfx-hw-open'));
    const dlg = await screen.findByTestId('dfx-hw');
    for (const k of ['screen', 'viewport', 'touch', 'browser', 'os', 'mode', 'network', 'reconnect', 'agent', 'peripherals']) expect(within(dlg).getByTestId(`dfx-hw-${k}`)).toBeInTheDocument();
    expect(within(dlg).getByTestId('dfx-hw-agent').getAttribute('data-state')).toBe('not_reported');
    expect(within(dlg).getByTestId('dfx-hw-peripherals')).toHaveTextContent('No driver support is claimed here.');
    expect(m.check).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByTestId('dfx-hw-again'));
    expect(screen.getByTestId('dfx-hw')).toBeInTheDocument();
  });
  it('extras Device Assignments 08: the Reception POS view has no hardware readiness button', async () => {
    r('reception-pos');
    await screen.findByRole('heading', { name: 'Reception POS' });
    expect(screen.queryByTestId('dfx-hw-open')).toBeNull();
  });
});
