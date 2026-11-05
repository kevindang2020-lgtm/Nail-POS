// Devices → Payment Terminals (wave 3 PAYI §12/§50/§52): the registry list with the ONE normalized status, honest
// "Not tested yet" for a terminal that never answered, and the audited actions through the real routes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { m } = vi.hoisted(() => ({ m: { terminals: vi.fn(), testTerminal: vi.fn(), renameTerminal: vi.fn(), disableTerminal: vi.fn(), enableTerminal: vi.fn(), unpairTerminal: vi.fn(), assignTerminalLocation: vi.fn() } }));
vi.mock('../api/posDevicesApi', () => ({ posDevicesApi: m }));
const { stepUp } = vi.hoisted(() => ({ stepUp: vi.fn() }));
vi.mock('../api/posStepUpApi', () => ({ posStepUpApi: { stepUp } }));
vi.mock('../components/TapToPayDevicesPanel', () => ({ TapToPayDevicesPanel: () => null }));   // its own test covers it
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => p === 'settings.edit' }));
import { POSPaymentTerminalsScreen } from './POSPaymentTerminalsScreen';

const row = (over: any = {}) => ({ id: 'term_1', label: 'Front Desk Clover', status: 'paired', hsn: 'HSN1', registerName: 'Front Desk', terminalType: 'clover_compact', operationalStatus: 'UNKNOWN', operationalLabel: 'Not tested yet', lastSeenAt: null, lastTransactionAt: null, disabledAt: null, ...over });
beforeEach(() => { for (const f of Object.values(m)) (f as any).mockReset(); stepUp.mockReset(); });

describe('POSPaymentTerminalsScreen', () => {
  it('a paired terminal with no location is flagged, and "Assign to this location" assigns it and reloads', async () => {
    m.terminals.mockResolvedValueOnce([row({ unassigned: true })]).mockResolvedValueOnce([row()]);
    m.assignTerminalLocation.mockResolvedValue(row());
    render(<POSPaymentTerminalsScreen />);
    expect(await screen.findByText(/takes no card payments until it is assigned/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Assign to this location'));
    await waitFor(() => expect(m.assignTerminalLocation).toHaveBeenCalledWith('term_1'));
    expect(await screen.findByText(/now belongs to this location/)).toBeInTheDocument();
    expect(screen.queryByText(/takes no card payments until it is assigned/)).toBeNull();
  });
  it('renders the registry with the normalized status — a paired terminal that never answered is "Not tested yet", not Online', async () => {
    m.terminals.mockResolvedValue([row(), row({ id: 'term_2', label: 'Back Clover', operationalStatus: 'ONLINE', operationalLabel: 'Online', lastSeenAt: '2026-10-13T12:00:00Z' })]);
    render(<POSPaymentTerminalsScreen />);
    expect(await screen.findByRole('heading', { name: 'Payment Terminals' })).toBeInTheDocument();
    expect(screen.getByText('Front Desk Clover')).toBeInTheDocument();
    expect(screen.getByText('Not tested yet')).toBeInTheDocument();
    expect(screen.getAllByText('Online').some((e) => e.tagName === 'TD')).toBe(true);   // the row (the KPI label is also 'Online')
    expect(screen.queryByText('All Connected')).toBeNull();
  });
  it('shows empty state when no terminals are paired', async () => {
    m.terminals.mockResolvedValue([]);
    render(<POSPaymentTerminalsScreen />);
    expect(await screen.findByText(/No terminals paired yet/i)).toBeInTheDocument();
  });
  it('Test connection reports what the device answered and reloads the registry', async () => {
    m.terminals.mockResolvedValue([row()]);
    m.testTerminal.mockResolvedValue({ id: 'term_1', reachable: false, probed: true, detail: 'the terminal did not answer — check that it is powered on, online and registered with the processor' });
    render(<POSPaymentTerminalsScreen />);
    fireEvent.click(await screen.findByText('Test connection'));
    await waitFor(() => expect(m.testTerminal).toHaveBeenCalledWith('term_1'));
    expect(await screen.findByText(/did not answer/)).toBeInTheDocument();
    expect(m.terminals).toHaveBeenCalledTimes(2);
  });
  it('Disable asks for a reason inline (no browser dialog) and posts it; a disabled terminal offers Enable', async () => {
    m.terminals.mockResolvedValueOnce([row()]).mockResolvedValueOnce([row({ operationalStatus: 'DISABLED', operationalLabel: 'Disabled by the salon', disabledAt: '2026-10-13T12:00:00Z', disabledReason: 'reader broken' })]);
    m.disableTerminal.mockResolvedValue(row({ operationalStatus: 'DISABLED' }));
    render(<POSPaymentTerminalsScreen />);
    fireEvent.click(await screen.findByText('Disable'));
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'reader broken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Disable terminal' }));
    await waitFor(() => expect(m.disableTerminal).toHaveBeenCalledWith('term_1', 'reader broken'));
    expect(await screen.findByText('Enable')).toBeInTheDocument();
    expect(screen.getByText('reader broken')).toBeInTheDocument();
  });
  // Security Deep Scan C7: terminal enable / disable / unpair / pair / register are step-up routes
  const STEP_UP = () => Object.assign(new Error('This action needs you to confirm your password and authentication code.'), { status: 403, code: 'STEP_UP_REQUIRED' });
  const disabledRow = () => row({ operationalStatus: 'DISABLED', operationalLabel: 'Disabled by the salon', disabledAt: '2026-10-13T12:00:00Z' });
  it('Enable answered STEP_UP_REQUIRED → password prompt → enabled on the one retry', async () => {
    m.terminals.mockResolvedValue([disabledRow()]);
    m.enableTerminal.mockRejectedValueOnce(STEP_UP()).mockResolvedValue(row());
    stepUp.mockResolvedValue({ ok: true });
    render(<POSPaymentTerminalsScreen />);
    fireEvent.click(await screen.findByText('Enable'));
    expect(await screen.findByText(/Pairing or changing a card terminal needs your password/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Front Desk Clover enabled.')).toBeInTheDocument();
    expect(stepUp).toHaveBeenCalledWith({ password: 'pw' });
    expect(m.enableTerminal).toHaveBeenCalledTimes(2);
  });
  it('cancelling the step-up prompt leaves the terminal as it was and shows no error', async () => {
    m.terminals.mockResolvedValue([disabledRow()]);
    m.enableTerminal.mockRejectedValueOnce(STEP_UP());
    render(<POSPaymentTerminalsScreen />);
    fireEvent.click(await screen.findByText('Enable'));
    await screen.findByLabelText('Your password');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('Your password')).toBeNull());
    expect(m.enableTerminal).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Front Desk Clover:/)).toBeNull();
    expect(screen.queryByText(/enabled\./)).toBeNull();
  });
});
