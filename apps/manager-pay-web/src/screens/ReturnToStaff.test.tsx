// ReturnToStaff.test — Secure Tap to Pay §53 / §12 (Oct 26 2026): leaving Customer Handoff Mode needs the employee.
// With Face ID / passcode: the check gates it; failures count, and at 3 the phone signs out (full sign-in). Without a
// biometric / passcode check: the employee's PASSWORD (POST /auth/step-up) — a plain tap no longer exits Handoff Mode.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { setBiometricStore, NoBiometrics, resetBiometricFailures, biometricFailures, recordBiometricFailure, type BiometricStore } from '@aipowersalon/mobile-sdk';
const { stepUp } = vi.hoisted(() => ({ stepUp: vi.fn() }));
vi.mock('../api/authApi', () => ({ authApi: { stepUp } }));
vi.mock('../lib/signOut', () => ({ signOutNow: vi.fn() }));
import { ReturnToStaff } from './ReturnToStaff';

const tick = () => new Promise((r) => setTimeout(r, 0));
const lastBtn = () => { const b = screen.getAllByRole('button', { name: 'Return to Staff' }); return b[b.length - 1]; };
const bio = (verify: () => Promise<boolean>): BiometricStore => ({ isAvailable: async () => ({ available: true, kind: 'face' }), enroll: async () => {}, unlock: async () => null, clear: async () => {}, verify });
const refused = () => Object.assign(new Error('Password is not correct.'), { status: 403, code: 'STEP_UP_FAILED' });
const mount = (over: Partial<Parameters<typeof ReturnToStaff>[0]> = {}) => {
  const onDone = vi.fn(); const onForceSignOut = vi.fn(); const onDismiss = vi.fn();
  render(<ReturnToStaff onDone={onDone} onDismiss={onDismiss} onForceSignOut={onForceSignOut} {...over} />);
  return { onDone, onForceSignOut, onDismiss };
};
const press = async () => { await act(async () => { fireEvent.click(lastBtn()); await tick(); }); };

beforeEach(() => { stepUp.mockReset(); resetBiometricFailures(); });
afterEach(() => { setBiometricStore(new NoBiometrics()); resetBiometricFailures(); });

describe('ReturnToStaff — Face ID / passcode available', () => {
  it('a successful check exits Handoff Mode and clears the failure budget', async () => {
    recordBiometricFailure();
    setBiometricStore(bio(async () => true));
    const { onDone } = mount();
    await act(async () => { await tick(); });
    await press();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(biometricFailures()).toBe(0);
  });
  it('§12: three failed checks → no exit, the phone signs out for a full password sign-in', async () => {
    setBiometricStore(bio(async () => false));
    const { onDone, onForceSignOut } = mount();
    await act(async () => { await tick(); });
    await press(); await press();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm it is you. Try again.');
    expect(onForceSignOut).not.toHaveBeenCalled();
    await press();
    expect(onForceSignOut).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId('rts-forced')).toHaveTextContent('Too many attempts');
    expect(screen.queryByRole('button', { name: 'Return to Staff' })).toBeNull();
  });
  it('a thrown / cancelled check is a failure, never an exit', async () => {
    setBiometricStore(bio(async () => { throw new Error('user cancel'); }));
    const { onDone } = mount();
    await act(async () => { await tick(); });
    await press();
    expect(onDone).not.toHaveBeenCalled();
    expect(biometricFailures()).toBe(1);
  });
});

describe('ReturnToStaff — §53 no biometric / passcode check on this phone', () => {
  it('a plain tap does NOT exit: the password is required (the button stays disabled until one is typed)', async () => {
    setBiometricStore(new NoBiometrics());
    const { onDone } = mount();
    await act(async () => { await tick(); });
    expect(screen.getByText(/Enter your password to return/)).toBeInTheDocument();
    const btn = lastBtn() as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await press();
    expect(onDone).not.toHaveBeenCalled();
    expect(stepUp).not.toHaveBeenCalled();
  });
  it('the employee\'s password (POST /auth/step-up) exits Handoff Mode', async () => {
    stepUp.mockResolvedValue({ ok: true });
    const { onDone } = mount();
    await act(async () => { await tick(); });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'hunter2' } });
    await press();
    expect(stepUp).toHaveBeenCalledWith('hunter2', undefined);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
  it('a wrong password stays in Handoff Mode; three wrong → forced sign-out; a network failure is not counted', async () => {
    stepUp.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0, code: 'NETWORK' })).mockRejectedValue(refused());
    const { onDone, onForceSignOut } = mount();
    await act(async () => { await tick(); });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'guess' } });
    await press();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not check right now');
    expect(biometricFailures()).toBe(0);
    await press(); await press();
    expect(screen.getByRole('alert')).toHaveTextContent('That password is not correct.');
    expect(onForceSignOut).not.toHaveBeenCalled();
    await press();
    expect(onForceSignOut).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
  it('Cancel keeps the customer screen (never exits Handoff Mode)', async () => {
    const { onDone, onDismiss } = mount();
    await act(async () => { await tick(); });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onDismiss).toHaveBeenCalled(); expect(onDone).not.toHaveBeenCalled();
  });
});
