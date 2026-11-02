// security.test.tsx — BUILD_PLAN Phase 13 D (Constitution 6 §130, §179, §245–246): privacy screen + auto-lock.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { installPrivacyScreen, createAutoLock, PRIVACY_SCREEN_ID } from './privacy';
import { AppLock } from './AppLock';
import { biometricFailures, recordBiometricFailure, resetBiometricFailures, BIOMETRIC_MAX_FAILURES } from './biometric-failures';
import { setBiometricStore, NoBiometrics, type BiometricStore } from '../native-faceid';

afterEach(() => { cleanup(); setBiometricStore(new NoBiometrics()); vi.useRealTimers(); resetBiometricFailures(); });
const appState = () => { let cb: (s: { isActive: boolean }) => void = () => {}; return { plugin: { addListener: (_e: 'appStateChange', f: any) => { cb = f; return { remove() {} }; } }, fire: (isActive: boolean) => cb({ isActive }) }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('privacy screen (§179)', () => {
  it('covers the UI when the app resigns active and uncovers on return', async () => {
    const s = appState();
    const off = installPrivacyScreen({ plugin: s.plugin });
    await tick();
    s.fire(false); expect(document.getElementById(PRIVACY_SCREEN_ID)).not.toBeNull();
    s.fire(true); expect(document.getElementById(PRIVACY_SCREEN_ID)).toBeNull();
    off();
  });
});

describe('auto-lock (§245–246)', () => {
  it('locks after the idle time; activity resets the timer', () => {
    vi.useFakeTimers();
    const onLock = vi.fn();
    const l = createAutoLock({ idleMs: 1000, onLock, doc: document });
    vi.advanceTimersByTime(800); fireEvent.pointerDown(document); vi.advanceTimersByTime(800);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300); expect(onLock).toHaveBeenCalledTimes(1); expect(l.isLocked()).toBe(true);
    l.stop();
  });
  it('a long stay in the background locks on return; a short one does not', async () => {
    let t = 0; const s = appState(); const onLock = vi.fn();
    const l = createAutoLock({ idleMs: 60_000, onLock, plugin: s.plugin, now: () => t, setTimer: () => 1, clearTimer: () => {} });
    await tick();
    s.fire(false); t += 10_000; s.fire(true); expect(onLock).not.toHaveBeenCalled();
    s.fire(false); t += 120_000; s.fire(true); expect(onLock).toHaveBeenCalledTimes(1);
    l.stop();
  });
  it('lockOnStart covers a restored session at launch', () => {
    const onLock = vi.fn();
    createAutoLock({ idleMs: 60_000, onLock, lockOnStart: true, setTimer: () => 1, clearTimer: () => {} }).stop();
    expect(onLock).toHaveBeenCalledTimes(1);
  });
});

describe('<AppLock>', () => {
  it('hides the app behind the lock; Face ID / passcode unlocks it; "Sign in again" signs out', async () => {
    const bio: BiometricStore = { isAvailable: async () => ({ available: true, kind: 'face' }), enroll: async () => {}, unlock: async () => null, clear: async () => {}, verify: vi.fn(async () => true) };
    setBiometricStore(bio);
    const onSignOut = vi.fn();
    render(<AppLock active idleMinutes={5} lockOnLaunch onSignOut={onSignOut}><p>Revenue $1,234</p></AppLock>);
    expect(screen.getByTestId('aps-app-lock')).toBeTruthy();
    expect(screen.getByText('Revenue $1,234').parentElement!.getAttribute('aria-hidden')).toBe('true');
    await act(async () => { await tick(); });
    await act(async () => { fireEvent.click(screen.getByText('Unlock')); await tick(); });
    expect(bio.verify).toHaveBeenCalled();
    expect(screen.queryByTestId('aps-app-lock')).toBeNull();
  });
  it('a failed / cancelled check stays locked; sign out is always offered', async () => {
    setBiometricStore({ isAvailable: async () => ({ available: true, kind: 'face' }), enroll: async () => {}, unlock: async () => null, clear: async () => {}, verify: async () => false });
    const onSignOut = vi.fn();
    render(<AppLock active idleMinutes={5} lockOnLaunch onSignOut={onSignOut}><p>x</p></AppLock>);
    await act(async () => { await tick(); });
    await act(async () => { fireEvent.click(screen.getByText('Unlock')); await tick(); });
    expect(screen.getByTestId('aps-app-lock')).toBeTruthy();
    fireEvent.click(screen.getByText('Sign in again')); expect(onSignOut).toHaveBeenCalled();
  });
  it('no lock on the sign-in screen (not active)', () => {
    render(<AppLock active={false} idleMinutes={5} lockOnLaunch onSignOut={() => {}}><p>login</p></AppLock>);
    expect(screen.queryByTestId('aps-app-lock')).toBeNull();
  });
});

// Secure Tap to Pay §12 (Oct 26 2026): repeated biometric failures → a full sign-in
describe('repeated biometric failures (§12)', () => {
  const failing = (verify: () => Promise<boolean>) => setBiometricStore({ isAvailable: async () => ({ available: true, kind: 'face' }), enroll: async () => {}, unlock: async () => null, clear: async () => {}, verify });
  it(`after ${BIOMETRIC_MAX_FAILURES} failed checks the lock signs out (password sign-in) and offers no more Unlock; fewer failures do not`, async () => {
    const verify = vi.fn(async () => false); failing(verify);
    const onSignOut = vi.fn();
    render(<AppLock active idleMinutes={5} lockOnLaunch onSignOut={onSignOut}><p>x</p></AppLock>);
    await act(async () => { await tick(); });
    for (let i = 1; i < BIOMETRIC_MAX_FAILURES; i++) {
      await act(async () => { fireEvent.click(screen.getByText('Unlock')); await tick(); });
      expect(onSignOut).not.toHaveBeenCalled();
      expect(screen.getByText('Could not confirm it is you. Try again.')).toBeTruthy();
    }
    await act(async () => { fireEvent.click(screen.getByText('Unlock')); await tick(); });
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('aps-app-lock-forced')).toBeTruthy();
    expect(screen.queryByText('Unlock')).toBeNull();
    expect(verify).toHaveBeenCalledTimes(BIOMETRIC_MAX_FAILURES);
    expect(biometricFailures()).toBe(0);   // the full sign-in starts a fresh budget
  });
  it('a thrown / cancelled check counts as a failure, never an unlock; a success resets the count', async () => {
    let n = 0; failing(async () => { n++; if (n === 1) throw new Error('user cancel'); return n >= 3; });
    const onSignOut = vi.fn();
    render(<AppLock active idleMinutes={5} lockOnLaunch onSignOut={onSignOut}><p>x</p></AppLock>);
    await act(async () => { await tick(); });
    await act(async () => { fireEvent.click(screen.getByText('Unlock')); await tick(); });
    expect(screen.getByTestId('aps-app-lock')).toBeTruthy(); expect(biometricFailures()).toBe(1);
    await act(async () => { fireEvent.click(screen.getByText('Unlock')); await tick(); });
    expect(biometricFailures()).toBe(2);
    await act(async () => { fireEvent.click(screen.getByText('Unlock')); await tick(); });
    expect(screen.queryByTestId('aps-app-lock')).toBeNull(); expect(biometricFailures()).toBe(0); expect(onSignOut).not.toHaveBeenCalled();
  });
  it('the budget survives a relaunch (failures before the restart count) — killing the app does not reset it', async () => {
    recordBiometricFailure(); recordBiometricFailure();   // two failures, then the app was killed
    failing(async () => false); const onSignOut = vi.fn();
    render(<AppLock active idleMinutes={5} lockOnLaunch onSignOut={onSignOut}><p>x</p></AppLock>);
    await act(async () => { await tick(); });
    await act(async () => { fireEvent.click(screen.getByText('Unlock')); await tick(); });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
