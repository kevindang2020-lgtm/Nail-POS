// CustomerDisplays.test.tsx — 23-inch dual-screen spec §8–§12, §81–§86, §122–§124 in the POS:
//   • Checkout's Customer Display card: ● Connected / ● Active "Showing Sophia's checkout" / ● Offline "continue checkout
//     on the POS" / ● Maintenance; Send to Display uses THIS POS's register (remembered on this workstation); Switch,
//     Refresh and Cancel are there for the front desk
//   • Devices → Customer Displays: pair by the code the display shows; every §86 field; owner-only actions hidden from
//     the front desk; registers
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, renderHook, within } from '@testing-library/react';
import type { PosCustomerDisplaysState, PosDisplayDeviceView } from '@aipowersalon/api-contracts/tenant';

const h = vi.hoisted(() => ({ state: null as any, pair: vi.fn(), update: vi.fn(), revoke: vi.fn(), refresh: vi.fn(), createStation: vi.fn(), retireStation: vi.fn(), renameStation: vi.fn(), send: vi.fn(), close: vi.fn(), cancelTerminal: vi.fn() }));
vi.mock('../api/posCustomerDisplaysApi', async (orig) => ({
  ...(await orig<typeof import('../api/posCustomerDisplaysApi')>()),
  posCustomerDisplaysApi: {
    state: () => (h.state instanceof Error ? Promise.reject(h.state) : Promise.resolve(h.state)),
    pair: (...a: any[]) => h.pair(...a), update: (...a: any[]) => h.update(...a), revoke: (...a: any[]) => h.revoke(...a), refresh: (...a: any[]) => h.refresh(...a),
    createStation: (...a: any[]) => h.createStation(...a), retireStation: (...a: any[]) => h.retireStation(...a), renameStation: (...a: any[]) => h.renameStation(...a),
  },
}));
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: { sendToCustomerDisplay: (...a: any[]) => h.send(...a), display: { closeSession: (...a: any[]) => h.close(...a), cancelTerminal: (...a: any[]) => h.cancelTerminal(...a) } } }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => undefined }));
import { CustomerDisplayCard, displayModeLabel, displayStatus, useCustomerDisplays } from './CustomerDisplayCard';
import { POSCustomerDisplaysScreen } from './POSCustomerDisplaysScreen';
import { myDisplay, getThisRegister } from '../api/posCustomerDisplaysApi';

const dev = (over: Partial<PosDisplayDeviceView> = {}): PosDisplayDeviceView => ({
  deviceId: 'd1', name: 'Front Display #1', branchId: 'b1', branchName: 'Cherry Hill', pairing: 'shared', stationId: null, stationName: null,
  state: 'ADVERTISEMENT', online: true, maintenance: false, lastSeenAt: new Date().toISOString(), mode: 'advertisement', appVersion: '0.1.0+2026-10-06',
  screen: { width: 1920, height: 1080, pixelRatio: 1 }, profile: 'CUSTOMER_DISPLAY_23_LANDSCAPE', session: null, pairedAt: new Date().toISOString(), awaitingPickup: false, ...over,
});
const stateOf = (devices: PosDisplayDeviceView[], over: Partial<PosCustomerDisplaysState> = {}): PosCustomerDisplaysState => ({ branchId: 'b1', devices, stations: [{ id: 'r1', name: 'Register 1', branchId: 'b1' }, { id: 'r2', name: 'Register 2', branchId: 'b1' }], canManage: true, ...over });

beforeEach(() => { localStorage.clear(); for (const k of Object.keys(h)) if (typeof (h as any)[k] === 'function') (h as any)[k].mockReset?.(); h.state = stateOf([dev()]); });

function Card({ ticketId = 'tk1', paid = false }: { ticketId?: string | null; paid?: boolean }) {
  const m = useCustomerDisplays(ticketId);
  return <CustomerDisplayCard m={m} ticketId={ticketId} ticketPaid={paid} onChanged={() => undefined} />;
}

describe('the status line (§81, §83, §85)', () => {
  it('connected / active with the first name / offline (checkout continues on the POS) / maintenance / none', () => {
    expect(displayStatus(dev())).toMatchObject({ label: 'Connected', detail: 'Front Display #1' });
    expect(displayStatus(dev({ session: { sessionId: 's', ticketId: 't', ticketNumber: '41', customerFirstName: 'Sophia', state: 'showing_ticket' } }))).toMatchObject({ label: 'Active', detail: 'Showing Sophia’s checkout on Front Display #1.' });
    expect(displayStatus(dev({ online: false, state: 'OFFLINE' }))).toMatchObject({ label: 'Offline', detail: 'Front Display #1 is offline — continue checkout on the POS.' });
    expect(displayStatus(dev({ maintenance: true, state: 'MAINTENANCE' }))).toMatchObject({ label: 'Maintenance' });
    expect(displayStatus(null)).toMatchObject({ label: 'No display' });
  });
  it('which display this POS uses: the one already showing this customer, its register\'s, else an online shared one', () => {
    const r1 = dev({ deviceId: 'r1d', pairing: 'dedicated', stationId: 'r1' });
    const sh = dev({ deviceId: 'shd' });
    const busy = dev({ deviceId: 'bz', session: { sessionId: 's', ticketId: 'tk9', ticketNumber: '9', customerFirstName: 'Ana', state: 'tip_selected' } });
    expect(myDisplay([sh, r1], 'r1')?.deviceId).toBe('r1d');
    expect(myDisplay([sh, r1], null)?.deviceId).toBe('shd');
    expect(myDisplay([sh, r1, busy], 'r1', 'tk9')?.deviceId).toBe('bz');
    expect(myDisplay([r1], 'r2')).toBeNull();
    // the server's own order (display-send-core): a dedicated display that can take the customer, then a shared one;
    // a register's display that is offline or busy falls back to a free shared display, as Send to Display does
    const r1off = dev({ deviceId: 'r1off', pairing: 'dedicated', stationId: 'r1', online: false, state: 'OFFLINE' });
    expect(myDisplay([r1off, r1, sh], 'r1')?.deviceId).toBe('r1d');
    expect(myDisplay([r1off, sh], 'r1')?.deviceId).toBe('shd');
    const r1busy = dev({ deviceId: 'r1busy', pairing: 'dedicated', stationId: 'r1', session: { sessionId: 's2', ticketId: 'tk8', ticketNumber: '8', customerFirstName: 'Ana', state: 'tip_selected' } });
    expect(myDisplay([r1busy, sh], 'r1', 'tk1')?.deviceId).toBe('shd');
    expect(myDisplay([r1busy], 'r1', 'tk1')?.deviceId).toBe('r1busy');   // in use: the card says whose checkout is on it
    expect(myDisplay([r1off], 'r1')?.deviceId).toBe('r1off');            // nothing can take it: the card says it is offline
  });
});

describe('Dual-Screen mandate §83–§84: current mode, and Reconnect', () => {
  it('the mode the display reports, only while it is reachable', () => {
    expect(displayModeLabel(dev({ state: 'ADVERTISEMENT' }))).toBe('Advertising');
    expect(displayModeLabel(dev({ state: 'CHECK_IN' }))).toBe('Check-in');
    expect(displayModeLabel(dev({ state: 'CHECKOUT' }))).toBe('Checkout');
    expect(displayModeLabel(dev({ state: 'ONLINE' }))).toBe('Idle');
    expect(displayModeLabel(dev({ online: false, state: 'OFFLINE' }))).toBeNull();
    expect(displayModeLabel(dev({ maintenance: true, state: 'MAINTENANCE' }))).toBeNull();
    expect(displayModeLabel(null)).toBeNull();
    // the last report of a display that has since gone quiet or is mid-pairing is not its mode
    expect(displayModeLabel(dev({ online: false, state: 'ADVERTISEMENT' }))).toBeNull();
    expect(displayModeLabel(dev({ awaitingPickup: true, state: 'ADVERTISEMENT' }))).toBeNull();
    expect(displayModeLabel(dev({ maintenance: true, state: 'ADVERTISEMENT' }))).toBeNull();
  });
  it('the card shows the current mode; an offline display offers Reconnect, which asks the server again', async () => {
    h.state = stateOf([dev({ state: 'CHECK_IN', mode: 'check_in' })]);
    const { unmount } = render(<Card />);
    expect(await screen.findByTestId('customer-display-mode')).toHaveTextContent('Current mode: Check-in');
    expect(screen.queryByText('Reconnect')).toBeNull();
    unmount();
    h.state = stateOf([dev({ online: false, state: 'OFFLINE' })]);
    render(<Card />);
    await screen.findByText('Reconnect');
    expect(screen.queryByTestId('customer-display-mode')).toBeNull();
    fireEvent.click(screen.getByText('Reconnect'));   // still down: said so, the checkout carries on
    expect(await screen.findByTestId('customer-display-note')).toHaveTextContent('Front Display #1 is still offline');
    h.state = stateOf([dev()]);   // the display came back
    fireEvent.click(screen.getByText('Reconnect'));
    expect(await screen.findByTestId('customer-display-note')).toHaveTextContent('Front Display #1 is connected.');
    expect(screen.getByTestId('customer-display-status')).toHaveTextContent('Connected');
  });
  it('the POS lost the display status: Reconnect retries it', async () => {
    h.state = new Error('Network down');
    render(<Card />);
    await screen.findByText('Network down');
    h.state = stateOf([dev()]);
    fireEvent.click(screen.getByText('Reconnect'));
    await waitFor(() => expect(screen.getByTestId('customer-display-status')).toHaveTextContent('Connected'));
  });
});

describe('Checkout → Customer Display card', () => {
  it('Send to Display sends THIS POS\'s register; the register choice is remembered on this workstation', async () => {
    h.send.mockResolvedValue({ sessionId: 's1' });
    h.state = stateOf([dev(), dev({ deviceId: 'r2d', name: 'Register 2 Display', pairing: 'dedicated', stationId: 'r2' })]);
    render(<Card />);
    await screen.findByTestId('customer-display-card');
    fireEvent.change(screen.getByLabelText("This POS's register"), { target: { value: 'r2' } });
    expect(getThisRegister('b1')).toBe('r2');
    expect(screen.getByTestId('customer-display-detail').textContent).toBe('Register 2 Display');
    fireEvent.click(screen.getByText('Send to Display'));
    await waitFor(() => expect(h.send).toHaveBeenCalledWith('tk1', { stationId: 'r2' }));
    expect(await screen.findByTestId('customer-display-note')).toHaveTextContent('Sent to the customer display.');
  });

  it('offline: says so, Send is disabled — the checkout continues on the POS', async () => {
    h.state = stateOf([dev({ online: false, state: 'OFFLINE' })]);
    render(<Card />);
    expect(await screen.findByTestId('customer-display-status')).toHaveTextContent('Offline');
    expect(screen.getByTestId('customer-display-detail').textContent).toMatch(/continue checkout on the POS/);
    expect((screen.getByText('Send to Display') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the customer on screen: Active, Cancel Display Session; Switch moves it to another online display', async () => {
    h.close.mockResolvedValue({ closed: true });
    h.send.mockResolvedValue({ sessionId: 's2' });
    h.state = stateOf([dev({ state: 'CHECKOUT', session: { sessionId: 's1', ticketId: 'tk1', ticketNumber: '41', customerFirstName: 'Sophia', state: 'showing_ticket' } }), dev({ deviceId: 'd2', name: 'Lobby' })]);
    render(<Card />);
    expect(await screen.findByTestId('customer-display-status')).toHaveTextContent('Active');
    expect(screen.queryByText('Send to Display')).toBeNull();
    fireEvent.change(screen.getByLabelText('Switch Display'), { target: { value: 'd2' } });
    await waitFor(() => expect(h.send).toHaveBeenCalledWith('tk1', { stationId: null, deviceId: 'd2' }));
    fireEvent.click(screen.getByText('Cancel Display Session'));
    await waitFor(() => expect(h.close).toHaveBeenCalledWith('s1'));
  });

  // Oct 21 2026: the terminal is prompting for a card and the guest walked away — the front desk calls the prompt off
  it('Cancel Terminal Prompt appears only while the terminal is prompting, and says what happened', async () => {
    h.state = stateOf([dev({ state: 'CHECKOUT', session: { sessionId: 's1', ticketId: 'tk1', ticketNumber: '41', customerFirstName: 'Sophia', state: 'showing_ticket' } })]);
    const { unmount } = render(<Card />);
    expect(await screen.findByTestId('customer-display-status')).toHaveTextContent('Active');
    expect(screen.queryByTestId('cancel-terminal')).toBeNull();                        // nothing to cancel while the guest reviews the ticket
    unmount();
    h.state = stateOf([dev({ state: 'CHECKOUT', session: { sessionId: 's1', ticketId: 'tk1', ticketNumber: '41', customerFirstName: 'Sophia', state: 'payment_processing' } })]);
    h.cancelTerminal.mockResolvedValue({ cancelled: true });
    render(<Card />);
    fireEvent.click(await screen.findByTestId('cancel-terminal'));
    await waitFor(() => expect(h.cancelTerminal).toHaveBeenCalledWith('s1'));
    expect(await screen.findByTestId('customer-display-note')).toHaveTextContent('Terminal prompt cancelled');
    h.cancelTerminal.mockResolvedValue({ cancelled: false, reason: 'NOTHING_IN_PROGRESS' });
    fireEvent.click(screen.getByTestId('cancel-terminal'));
    await waitFor(() => expect(screen.getByTestId('customer-display-note')).toHaveTextContent('not prompting right now'));
  });

  it('Refresh Display reports an offline display honestly', async () => {
    h.refresh.mockResolvedValue({ requested: true, online: false });
    render(<Card />);
    fireEvent.click(await screen.findByText('Refresh Display'));
    expect(await screen.findByTestId('customer-display-note')).toHaveTextContent('offline — it loads fresh when it reconnects');
  });

  it('a user who may not operate displays sees no card at all', async () => {
    h.state = Object.assign(new Error('Forbidden'), { status: 403 });
    const { container } = render(<Card />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="customer-display-card"]')).toBeNull();
  });

  it('the shared model is one source for the card and the workspace buttons', async () => {
    h.state = stateOf([dev({ session: { sessionId: 's9', ticketId: 'tk1', ticketNumber: '1', customerFirstName: null, state: 'showing_ticket' } })]);
    h.close.mockResolvedValue({ closed: true });
    const { result } = renderHook(() => useCustomerDisplays('tk1'));
    await waitFor(() => expect(result.current.ticketSession?.sessionId).toBe('s9'));
    await act(async () => { expect(await result.current.cancel()).toBe('Customer display cleared.'); });
    expect(h.close).toHaveBeenCalledWith('s9');
  });
});

describe('Devices → Customer Displays (§86)', () => {
  it('every §86 field for each display', async () => {
    h.state = stateOf([dev({ pairing: 'dedicated', stationId: 'r1', stationName: 'Register 1', session: { sessionId: 's', ticketId: 't', ticketNumber: '41', customerFirstName: 'Sophia', state: 'showing_ticket' }, state: 'CHECKOUT', mode: 'checkout' })], { canManage: false });
    render(<POSCustomerDisplaysScreen />);
    const row = await screen.findByTestId('display-row');
    for (const text of ['Front Display #1', 'Cherry Hill', 'Register 1', '23" landscape', '1920×1080', 'Connected', 'Checkout', 'Sophia · #41', '0.1.0+2026-10-06']) expect(row.textContent).toContain(text);
    expect(row.textContent).toMatch(/\ds ago/);
    // the front desk: refresh only — no pairing, rename, maintenance or revoke
    expect(screen.queryByText('+ PAIR A DISPLAY')).toBeNull();
    expect(screen.queryByText('Revoke')).toBeNull();
    expect(within(row).getByText('Refresh')).toBeInTheDocument();
  });

  it('the owner pairs a display with the code it shows (normalised), a name and a register', async () => {
    h.pair.mockResolvedValue(dev({ deviceId: 'new' }));
    render(<POSCustomerDisplaysScreen />);
    fireEvent.click(await screen.findByText('+ PAIR A DISPLAY'));
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: '4829-1374' } });
    expect((screen.getByLabelText('Pairing code') as HTMLInputElement).value).toBe('4829 1374');
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Front Display #2' } });
    fireEvent.change(screen.getByLabelText('Register'), { target: { value: 'r1' } });
    fireEvent.click(screen.getByText('Pair display'));
    await waitFor(() => expect(h.pair).toHaveBeenCalledWith({ code: '48291374', name: 'Front Display #2', stationId: 'r1' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Paired/);
  });

  it('owner actions: maintenance, register (dedicated/shared), rename inline, revoke after confirming; registers', async () => {
    h.update.mockResolvedValue(dev()); h.revoke.mockResolvedValue({ revoked: true }); h.createStation.mockResolvedValue({ id: 'r3', name: 'Register 3', branchId: 'b1' });
    render(<POSCustomerDisplaysScreen />);
    fireEvent.click(await screen.findByText('Maintenance'));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('d1', { maintenance: true }));
    fireEvent.change(screen.getByLabelText('Register for Front Display #1'), { target: { value: 'r2' } });
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('d1', { stationId: 'r2' }));
    fireEvent.click(screen.getAllByText('Rename')[0]);
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Window Display' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(h.update).toHaveBeenCalledWith('d1', { name: 'Window Display' }));
    fireEvent.click(screen.getByText('Revoke'));
    const sure = await screen.findByRole('button', { name: 'Revoke display' });
    expect(h.revoke).not.toHaveBeenCalled();   // nothing is revoked until the owner confirms
    fireEvent.click(sure);
    await waitFor(() => expect(h.revoke).toHaveBeenCalledWith('d1'));
    fireEvent.change(screen.getByLabelText('New register name'), { target: { value: 'Register 3' } });
    fireEvent.click(screen.getByText('Add register'));
    await waitFor(() => expect(h.createStation).toHaveBeenCalledWith('Register 3'));
  });

  it('round 10 (Tablets 06): Replace revokes the old display after confirming, then opens pairing with the same name and register — the new one types its OWN code', async () => {
    h.revoke.mockResolvedValue({ revoked: true }); h.pair.mockResolvedValue(dev({ deviceId: 'new' }));
    render(<POSCustomerDisplaysScreen />);
    fireEvent.click((await screen.findAllByTestId('display-replace'))[0]);
    const go = await screen.findByRole('button', { name: 'Revoke and pair the new one' });
    expect(h.revoke).not.toHaveBeenCalled();
    fireEvent.click(go);
    await waitFor(() => expect(h.revoke).toHaveBeenCalledWith('d1'));
    expect(await screen.findByTestId('display-replace-note')).toHaveTextContent('nothing is copied from the old device');
    expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Front Display #1');
    expect((screen.getByLabelText('Pairing code') as HTMLInputElement).value).toBe('');   // the code is the NEW display's, never carried over
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: '5551 2222' } });
    fireEvent.click(screen.getByText('Pair display'));
    await waitFor(() => expect(h.pair).toHaveBeenCalledWith(expect.objectContaining({ code: '55512222', name: 'Front Display #1' })));
  });
});

