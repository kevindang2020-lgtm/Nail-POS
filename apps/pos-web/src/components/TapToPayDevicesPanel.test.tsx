// TapToPayDevicesPanel.test — Secure Tap to Pay M6-4 (POS): "Add Tap to Pay device" creates a pairing behind step-up and
// shows the QR + code + a live countdown (expired says so); the locations editor posts the ticked branches; suspend /
// revoke carry a reason and go through step-up; Cancel on the password prompt changes nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
const { m, stepUp, branches } = vi.hoisted(() => ({
  m: { devices: vi.fn(), createPairing: vi.fn(), setBranches: vi.fn(), approve: vi.fn(), suspend: vi.fn(), revoke: vi.fn(), activity: vi.fn(), rename: vi.fn() },
  stepUp: vi.fn(), branches: vi.fn(),
}));
vi.mock('../api/posMobilePaymentsApi', () => ({ posMobilePaymentsApi: m }));
vi.mock('../api/posStepUpApi', () => ({ posStepUpApi: { stepUp } }));
vi.mock('../api/authApi', () => ({ authApi: { branches } }));
import { TapToPayDevicesPanel, countdownLabel } from './TapToPayDevicesPanel';

const stepUpRefusal = () => Object.assign(new Error('Confirm your password.'), { status: 403, code: 'STEP_UP_REQUIRED' });
const phone = (over: any = {}) => ({ deviceId: 'dev_aaaaaaaa1', label: 'Front iPhone', branchId: 'b1', platform: 'ios', tapToPayCapable: true, status: 'active', online: true, allowedBranchIds: [], boundUserName: 'Kim', lastSeenAt: null, ...over });

beforeEach(() => {
  for (const f of [...Object.values(m), stepUp, branches]) (f as any).mockReset();
  m.devices.mockResolvedValue([phone()]);
  branches.mockResolvedValue({ ok: true, branches: [{ id: 'b1', name: 'Downtown', isActive: true }, { id: 'b2', name: 'Uptown', isActive: true }] });
});
afterEach(() => { vi.useRealTimers(); });

describe('TapToPayDevicesPanel', () => {
  it('lists the phones with status and home location', async () => {
    render(<TapToPayDevicesPanel canManage />);
    expect(await screen.findByText('Front iPhone')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(await screen.findByText('Downtown (home)')).toBeInTheDocument();
  });

  it('Add Tap to Pay device → step-up → the QR, the code and a countdown to expiresAt', async () => {
    m.createPairing.mockRejectedValueOnce(stepUpRefusal()).mockResolvedValue({ pairingCode: 'Zq3x_9-abcdefghijklmnopqrstuvwxyzABCDEFGHI', qrPayload: 'aipowersalon-pay://pair?code=Zq3x_9-abcdefghijklmnopqrstuvwxyzABCDEFGHI', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), branchId: 'b1', shared: true });
    stepUp.mockResolvedValue({ ok: true });
    render(<TapToPayDevicesPanel canManage />);
    fireEvent.click(await screen.findByText('Add Tap to Pay device'));
    fireEvent.change(screen.getByLabelText('Phone name'), { target: { value: 'Front desk iPhone' } });
    fireEvent.click(screen.getByLabelText('Shared salon phone'));
    fireEvent.click(screen.getByText('Create pairing code'));
    fireEvent.change(await screen.findByLabelText('Your password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByTestId('ttp-pairing')).toBeInTheDocument();
    expect(m.createPairing).toHaveBeenLastCalledWith({ label: 'Front desk iPhone', shared: true });
    expect(m.createPairing).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('img', { name: /Pairing QR code/ })).toBeInTheDocument();
    expect(screen.getByTestId('ttp-code')).toHaveTextContent('Zq3x_9-abcdefghijklmnopqrstuvwxyzABCDEFGHI');
    expect(screen.getByTestId('ttp-countdown').textContent).toMatch(/^Expires in [45]:\d\d$/);
  });

  it('an expired code says so and shows no QR', async () => {
    m.createPairing.mockResolvedValue({ pairingCode: 'Zq3x_9-abcdefghijklmnop', qrPayload: 'aipowersalon-pay://pair?code=Zq3x_9-abcdefghijklmnop', expiresAt: new Date(Date.now() - 1000).toISOString(), branchId: 'b1', shared: false });
    render(<TapToPayDevicesPanel canManage />);
    fireEvent.click(await screen.findByText('Add Tap to Pay device'));
    fireEvent.click(screen.getByText('Create pairing code'));
    expect(await screen.findByTestId('ttp-expired')).toHaveTextContent('This code has expired. Create a new one.');
    expect(screen.queryByRole('img', { name: /Pairing QR code/ })).toBeNull();
  });

  it('countdown is mm:ss and stops at 0:00', () => {
    expect(countdownLabel(new Date(1_000_000 + 125_000).toISOString(), 1_000_000).text).toBe('2:05');
    expect(countdownLabel(new Date(0).toISOString(), 1_000_000)).toEqual({ left: 0, text: '0:00' });
  });

  it('the locations editor posts exactly the ticked branches', async () => {
    m.setBranches.mockResolvedValue({ deviceId: 'dev_aaaaaaaa1', status: 'active', allowedBranchIds: ['b1', 'b2'] });
    render(<TapToPayDevicesPanel canManage />);
    await screen.findByText('Front iPhone');
    fireEvent.click(screen.getByRole('button', { name: 'Locations' }));
    const editor = await screen.findByTestId('ttp-branches-dev_aaaaaaaa1');
    fireEvent.click(await screen.findByLabelText('Downtown'));
    fireEvent.click(screen.getByLabelText('Uptown'));
    fireEvent.click(editor.querySelector('button')!);
    await waitFor(() => expect(m.setBranches).toHaveBeenCalledWith('dev_aaaaaaaa1', ['b1', 'b2']));
  });

  it('revoke asks why, confirms, then posts the reason; Cancel on step-up changes nothing', async () => {
    m.revoke.mockRejectedValueOnce(stepUpRefusal());
    render(<TapToPayDevicesPanel canManage />);
    await screen.findByText('Front iPhone');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    const input = await screen.findByRole('textbox', { name: /answer/i });
    fireEvent.change(input, { target: { value: 'lost phone' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText(/Remove Front iPhone for good\?/);
    const btns = screen.getAllByRole('button', { name: 'Revoke' });
    fireEvent.click(btns[btns.length - 1]);   // the confirmation's own button
    await waitFor(() => expect(m.revoke).toHaveBeenCalledWith('dev_aaaaaaaa1', 'lost phone'));
    await screen.findByLabelText('Your password');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('Your password')).toBeNull());
    expect(m.revoke).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('§15 Rename: the current name is prefilled, step-up is asked, the new name is posted and the list reloads; a revoked phone has no Rename', async () => {
    m.devices.mockResolvedValueOnce([phone(), phone({ deviceId: 'dev_revoked01', label: 'Lost iPhone', status: 'revoked' })]).mockResolvedValue([phone({ label: 'Front Desk 2' })]);
    m.rename.mockRejectedValueOnce(stepUpRefusal()).mockResolvedValue({ deviceId: 'dev_aaaaaaaa1', label: 'Front Desk 2', status: 'active' });
    stepUp.mockResolvedValue({ ok: true });
    render(<TapToPayDevicesPanel canManage />);
    await screen.findByText('Front iPhone');
    expect(screen.queryByTestId('ttp-rename-dev_revoked01')).toBeNull();
    fireEvent.click(screen.getByTestId('ttp-rename-dev_aaaaaaaa1'));
    const input = await screen.findByRole('textbox', { name: /answer/i }) as HTMLInputElement;
    expect(input.value).toBe('Front iPhone');
    fireEvent.change(input, { target: { value: '  Front Desk 2 ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(await screen.findByLabelText('Your password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(m.rename).toHaveBeenCalledTimes(2));
    expect(m.rename).toHaveBeenLastCalledWith('dev_aaaaaaaa1', 'Front Desk 2');
    expect(await screen.findByText('Renamed to Front Desk 2.')).toBeInTheDocument();
    expect(await screen.findByText('Front Desk 2')).toBeInTheDocument();
  });

  it('without pos.devices.manage there are no controls', async () => {
    render(<TapToPayDevicesPanel canManage={false} />);
    await screen.findByText('Front iPhone');
    expect(screen.queryByText('Add Tap to Pay device')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
  });

  it('the countdown ticks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    m.createPairing.mockResolvedValue({ pairingCode: 'Zq3x_9-abcdefghijklmnop', qrPayload: 'aipowersalon-pay://pair?code=Zq3x_9-abcdefghijklmnop', expiresAt: new Date(Date.now() + 3_000).toISOString(), branchId: 'b1', shared: false });
    render(<TapToPayDevicesPanel canManage />);
    fireEvent.click(await screen.findByText('Add Tap to Pay device'));
    fireEvent.click(screen.getByText('Create pairing code'));
    await screen.findByTestId('ttp-countdown');
    await act(async () => { vi.advanceTimersByTime(4_000); });
    expect(await screen.findByTestId('ttp-expired')).toBeInTheDocument();
  });
});

// Secure Tap to Pay M6-6 (§15 / §62): the owner opens one phone's sign-ins and history
describe('TapToPayDevicesPanel — sign-ins & history', () => {
  it('lists who signed in on the phone (now / ended) and its audit history; only for someone who can manage devices', async () => {
    m.activity.mockResolvedValue({
      deviceId: 'dev_aaaaaaaa1', label: 'Front iPhone', status: 'active', shared: true,
      sessions: [
        { ref: 'aaaa1111', userId: 'u-b', userName: 'Manager B', branchId: 'b1', signedInAt: '2026-10-23T15:00:00Z', lastActiveAt: '2026-10-23T15:10:00Z', expiresAt: '2026-10-24T03:00:00Z', revokedAt: null, state: 'active' },
        { ref: 'bbbb2222', userId: 'u-a', userName: 'Manager A', branchId: 'b1', signedInAt: '2026-10-23T09:00:00Z', lastActiveAt: null, expiresAt: '2026-10-23T21:00:00Z', revokedAt: '2026-10-23T14:59:00Z', state: 'revoked' },
      ],
      audit: [{ at: '2026-10-23T15:05:00Z', action: 'checkout_payment_claimed', actorUserId: 'u-b', actorName: 'Manager B', summary: null, reason: null, ticketId: 'tk123456789', status: 'success' }],
    });
    render(<TapToPayDevicesPanel canManage />);
    fireEvent.click(await screen.findByTestId('ttp-history-dev_aaaaaaaa1'));
    expect(await screen.findByTestId('ttp-activity-dev_aaaaaaaa1')).toBeInTheDocument();
    expect(m.activity).toHaveBeenCalledWith('dev_aaaaaaaa1');
    expect(screen.getAllByText('Manager B').length).toBeGreaterThan(0);
    expect(screen.getByText('Signed in now')).toBeInTheDocument();
    expect(screen.getByText('Ended')).toBeInTheDocument();
    expect(screen.getByText(/checkout payment claimed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ttp-history-dev_aaaaaaaa1'));   // Hide
    await waitFor(() => expect(screen.queryByTestId('ttp-activity-dev_aaaaaaaa1')).not.toBeInTheDocument());
  });
  it('a failed load says so; a person who cannot manage devices gets no history control', async () => {
    m.activity.mockRejectedValue(new Error('nope'));
    const { unmount } = render(<TapToPayDevicesPanel canManage />);
    fireEvent.click(await screen.findByTestId('ttp-history-dev_aaaaaaaa1'));
    expect(await screen.findByTestId('ttp-activity-failed-dev_aaaaaaaa1')).toBeInTheDocument();
    unmount();
    render(<TapToPayDevicesPanel canManage={false} />);
    await screen.findByText('Front iPhone');
    expect(screen.queryByTestId('ttp-history-dev_aaaaaaaa1')).not.toBeInTheDocument();
  });
});

