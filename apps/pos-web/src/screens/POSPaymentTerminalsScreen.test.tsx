// Devices → Payment Terminals (Oct 29 2026 one-screen rebuild): the four PHYSICAL KPIs come from the server summary (Tap to
// Pay counted apart), "Needs Attention" says why, a never-tested terminal is never "Online", the list pages on the server,
// Test Connection reports what the device answered, Disable asks for a reason inline, revoking an iPhone warns when it is
// the last way to take a card, and a routing change is confirmed before it is saved.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ summary: vi.fn(), physical: vi.fn(), physicalDetail: vi.fn(), phones: vi.fn(), phoneDetail: vi.fn(), activity: vi.fn(), routing: vi.fn() }));
const dev = vi.hoisted(() => ({ testTerminal: vi.fn(), renameTerminal: vi.fn(), disableTerminal: vi.fn(), enableTerminal: vi.fn(), unpairTerminal: vi.fn(), pairTerminal: vi.fn(), setTerminalRegister: vi.fn() }));
const mob = vi.hoisted(() => ({ approve: vi.fn(), suspend: vi.fn(), revoke: vi.fn(), createPairing: vi.fn(), activity: vi.fn() }));
const settings = vi.hoisted(() => ({ updateCategory: vi.fn() }));
vi.mock('../api/posTerminalsScreenApi', () => ({ posTerminalsScreenApi: api }));
vi.mock('../api/posDevicesApi', () => ({ posDevicesApi: dev }));
vi.mock('../api/posMobilePaymentsApi', () => ({ posMobilePaymentsApi: mob }));
vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: settings }));
vi.mock('../components/TapToPayDevicesPanel', () => ({ PairingQr: () => null, DeviceActivityView: () => null }));
vi.mock('./access/accessUi', () => ({ useStepUp: () => ({ run: (fn: () => Promise<unknown>) => fn(), prompt: null }), isStepUpCancelled: () => false }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
import { POSPaymentTerminalsScreen } from './POSPaymentTerminalsScreen';

const summary = { physical: { total: 2, online: 1, needsAttention: 1, disabled: 0, inUse: 0, reasons: { never_tested: 1, offline: 0 }, freshnessMinutes: 15 },
  tapToPay: { total: 1, active: 1, pending: 0, disabled: 0, revoked: 0, compromised: 0, seenRecently: 0, activeHere: 1 } };
const term = (o: Record<string, unknown> = {}) => ({ id: 'term_1', label: 'Front Desk Clover', model: 'clover_compact', provider: 'cardpointe', hsn: 'HSN1', serialNumber: null, connectionType: null, branchId: 'b1', branchName: 'Main',
  stationId: 's1', registerName: 'Front Desk', paired: true, pairedAt: '2026-10-20T12:00:00Z', status: 'UNKNOWN', group: 'attention', attention: ['never_tested'], lastSeenAt: null, lastPingAt: null, lastPingOk: null,
  lastTransactionAt: null, disabledAt: null, disabledReason: null, ...o });
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 10, total: items.length, pageCount: 1 });
const routing = { mode: 'front_desk', scope: 'tenant', lastChange: null, canEdit: true, unassignedTerminals: [], registers: [{ id: 's1', name: 'Front Desk', terminals: [{ id: 'term_1', label: 'Front Desk Clover', status: 'UNKNOWN' }], routedTerminal: { id: 'term_1', label: 'Front Desk Clover', status: 'UNKNOWN', via: 'assigned' }, problem: 'terminal_needs_attention' }] };
const phone = { deviceId: 'dev_1', deviceRef: '…ev_1', label: 'Lisa iPhone', platform: 'ios', osVersion: '18.1', appVersion: '3.2', status: 'active', staffName: 'Lisa', staffPhone: null, branchName: 'Main', allowedBranchIds: [], shared: false,
  tapToPayCapable: true, attestationStatus: 'verified', online: false, createdAt: '2026-10-01T12:00:00Z', lastSeenAt: null, lastPaymentAt: null, lastErrorCode: null, revokedAt: null, revokeReason: null, payments: 0 };
const mount = () => render(<MemoryRouter><POSPaymentTerminalsScreen /></MemoryRouter>);

beforeEach(() => {
  for (const g of [api, dev, mob, settings]) Object.values(g).forEach((f) => f.mockReset());
  api.summary.mockResolvedValue(summary); api.routing.mockResolvedValue(routing);
  api.physical.mockResolvedValue(page([term(), term({ id: 'term_2', label: 'Back Clover', status: 'ONLINE', group: 'online', attention: [], lastSeenAt: '2026-10-29T12:00:00Z' })]));
});

describe('POSPaymentTerminalsScreen', () => {
  it('shows the four physical KPIs from the server and says why a terminal needs attention (never "Online" untested)', async () => {
    mount();
    expect(await screen.findByText('Front Desk Clover')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-physical')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-attention')).toHaveTextContent('1 never tested');
    expect(screen.getAllByText('Not verified').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Never tested').length).toBeGreaterThan(0);
    expect(api.physical.mock.calls[0][0]).toMatchObject({ sort: 'created_desc', page: 1 });
  });
  it('searches on the server and offers Clear filters when nothing matches', async () => {
    mount(); await screen.findByText('Front Desk Clover');
    api.physical.mockResolvedValue(page([]));
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'zzz' } });
    await waitFor(() => expect(api.physical).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'zzz' })));
    expect(await screen.findByText('Clear filters')).toBeInTheDocument();
  });
  it('Test Connection reports what the device answered; Disable asks for a reason inline and posts it', async () => {
    api.physicalDetail.mockResolvedValue({ terminal: term(), history: [], recentPayments: [], freshnessMinutes: 15 });
    dev.testTerminal.mockResolvedValue({ id: 'term_1', reachable: false, probed: true, detail: 'the terminal did not answer' });
    dev.disableTerminal.mockResolvedValue({});
    mount();
    fireEvent.click(await screen.findByText('Front Desk Clover'));
    fireEvent.click(await screen.findByTestId('test-connection'));
    await waitFor(() => expect(dev.testTerminal).toHaveBeenCalledWith('term_1'));
    expect(await screen.findByText(/did not answer/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('disable'));
    fireEvent.change(screen.getByTestId('ask-input'), { target: { value: 'reader broken' } });
    fireEvent.click(screen.getByTestId('ask-confirm'));
    await waitFor(() => expect(dev.disableTerminal).toHaveBeenCalledWith('term_1', 'reader broken'));
  });
  it('revoking the last working iPhone warns first and needs a reason', async () => {
    api.summary.mockResolvedValue({ ...summary, physical: { ...summary.physical, online: 0 } });
    api.phones.mockResolvedValue(page([phone]));
    api.phoneDetail.mockResolvedValue({ device: { ...phone, deviceIdFull: 'dev_1' }, history: [], recentPayments: [] });
    mob.revoke.mockResolvedValue({ status: 'revoked' });
    mount();
    fireEvent.click(await screen.findByTestId('tab-phones'));
    fireEvent.click(await screen.findByText('Lisa iPhone'));
    fireEvent.click(await screen.findByTestId('revoke'));
    expect(await screen.findByTestId('last-capture-warning')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-revoke')).toBeDisabled();
    fireEvent.change(screen.getByTestId('revoke-reason'), { target: { value: 'phone lost' } });
    fireEvent.click(screen.getByTestId('confirm-revoke'));
    await waitFor(() => expect(mob.revoke).toHaveBeenCalledWith('dev_1', 'phone lost'));
  });
  it('a routing change is confirmed, then saved through the audited settings route', async () => {
    settings.updateCategory.mockResolvedValue({});
    mount();
    fireEvent.click(await screen.findByTestId('tab-routing'));
    fireEvent.click((await screen.findByTestId('mode-terminal')).querySelector('input')!);
    fireEvent.click(screen.getByTestId('save-routing'));
    expect(settings.updateCategory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-routing'));
    await waitFor(() => expect(settings.updateCategory).toHaveBeenCalledWith('payments-checkout', { customerDisplayCaptureMode: 'terminal' }));
  });
  it('payment activity marks a payment with no recorded device as Not linked', async () => {
    api.activity.mockResolvedValue({ ...page([{ paymentId: 'p1', ticketId: 't1', ticketNumber: '1042', processorRef: 'RR1', amountCents: 6500, tipCents: 0, status: 'approved', rawStatus: 'succeeded', at: '2026-10-29T15:00:00Z', card: 'Visa •••• 4242',
      device: { kind: 'unlinked', id: null, label: null, staff: null }, register: null, branch: 'Main', customer: null }]), period: { preset: 'month', from: '2026-10-01', to: '2026-10-31', tz: 'America/New_York', today: '2026-10-29' } });
    mount();
    fireEvent.click(await screen.findByTestId('tab-activity'));
    expect(await screen.findByText('RR1')).toBeInTheDocument();
    expect(screen.getAllByText('Not linked').length).toBeGreaterThan(0);
    expect(api.activity.mock.calls[0][0]).toMatchObject({ preset: 'month', dateField: 'transaction' });
  });
});
