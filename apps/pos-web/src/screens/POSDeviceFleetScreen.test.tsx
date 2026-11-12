// SUNMI batch 8 (Nov 9 2026): each Devices sub-page reads its OWN registry (/pos/device-fleet) — the old test asserted the
// buggy filter of the customer displays by types they never store.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ ov: vi.fn(), summary: vi.fn(), devices: vi.fn(), history: vi.fn(), check: vi.fn() }));
vi.mock('../api/posDevicesApi', () => ({ posDevicesApi: { overview: m.ov } }));
vi.mock('../api/posDeviceFleetApi', () => ({ posDeviceFleetApi: { summary: m.summary, devices: m.devices, history: m.history, check: m.check } }));
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
