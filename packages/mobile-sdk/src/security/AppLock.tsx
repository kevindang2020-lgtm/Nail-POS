// AppLock.tsx — BUILD_PLAN Phase 13 D (Constitution 6 §130, §179, §245–246): the privacy screen + auto-lock, as one
// wrapper the owner, manager-pay and tech apps put around their signed-in UI.
//
//   privacy  : a neutral cover in the app switcher (all three)
//   autoLock : after `idleMinutes` idle / in the background, the UI is covered until Face ID / the device passcode
//              (verifyDeviceOwner) — or the person signs out. `lockOnLaunch` covers a RESTORED session at app start.
// The children stay mounted (no lost drafts) but hidden from view and from assistive tech while locked.
// Secure Tap to Pay §12 (Oct 26 2026): after `maxBiometricFailures` failed / cancelled checks in a row (default 3, the
// count shared with every verifyDeviceOwner gate and kept across a relaunch) the lock signs the person out — a full
// password sign-in is required; it never offers "try again" forever.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createAutoLock, installPrivacyScreen, type AppStatePluginLike, type AutoLock } from './privacy';
import { verifyDeviceOwner, faceIdState, nativeFaceIdEnrolled } from '../native-faceid';
import { BIOMETRIC_MAX_FAILURES, recordBiometricFailure, resetBiometricFailures, biometricLockedOut } from './biometric-failures';

export interface AppLockProps {
  children: ReactNode;
  /** a signed-in session exists (no lock on the sign-in screen) */
  active: boolean;
  privacyScreen?: boolean;
  /** 0 / undefined = no auto-lock */
  idleMinutes?: number;
  /** cover a RESTORED session at app start; 'when-enrolled' = only on a device with Face ID turned on (the default for the
   *  money apps: someone who chose Face ID is asked for it at launch) */
  lockOnLaunch?: boolean | 'when-enrolled';
  plugin?: AppStatePluginLike | null;
  onSignOut(): void;
  label?: string;
  /** §12: failed / cancelled checks before a forced sign-out (default 3; 0 = never) */
  maxBiometricFailures?: number;
}

export function AppLock(p: AppLockProps) {
  const [locked, setLocked] = useState(false);
  const [canVerify, setCanVerify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failedOnce, setFailedOnce] = useState(false);
  const [forced, setForced] = useState(false);
  const lockRef = useRef<AutoLock | null>(null);

  useEffect(() => (p.privacyScreen ? installPrivacyScreen({ plugin: p.plugin ?? null, label: p.label }) : undefined), [p.privacyScreen, p.plugin, p.label]);
  useEffect(() => { void faceIdState().then((s) => setCanVerify(s.status === 'available')); }, []);
  useEffect(() => {
    if (!p.active || !p.idleMinutes) { setLocked(false); return; }
    const l = createAutoLock({ idleMs: p.idleMinutes * 60_000, onLock: () => setLocked(true), lockOnStart: p.lockOnLaunch === true, plugin: p.plugin ?? null });
    lockRef.current = l;
    if (p.lockOnLaunch === 'when-enrolled') void nativeFaceIdEnrolled().then((on) => { if (on && lockRef.current === l) setLocked(true); });
    return () => { l.stop(); lockRef.current = null; };
    // lockOnLaunch is read once per session on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.active, p.idleMinutes, p.plugin]);

  const unlock = async () => {
    setBusy(true);
    try {
      const ok = await verifyDeviceOwner().catch(() => false);   // a thrown / cancelled check is a failure, never an unlock
      if (ok) { resetBiometricFailures(); setFailedOnce(false); lockRef.current?.unlock(); setLocked(false); return; }
      const n = recordBiometricFailure(); setFailedOnce(true);
      if (biometricLockedOut(n, p.maxBiometricFailures ?? BIOMETRIC_MAX_FAILURES)) { resetBiometricFailures(); setForced(true); p.onSignOut(); }
    } finally { setBusy(false); }
  };

  return (
    <>
      <div aria-hidden={locked || undefined} style={locked ? { visibility: 'hidden' } : undefined}>{p.children}</div>
      {locked && (
        <div role="dialog" aria-modal="true" aria-label="App locked" data-testid="aps-app-lock"
          style={{ position: 'fixed', inset: 0, zIndex: 2147483646, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: 'var(--aps-privacy-bg, #111827)', color: '#fff', padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{p.label ?? 'AIPowerSalon'} is locked</div>
          <div style={{ opacity: 0.8 }}>For your security the app locked after a period of inactivity.</div>
          {forced ? <div role="alert" data-testid="aps-app-lock-forced">Too many attempts. Sign in with your password.</div>
            : failedOnce ? <div role="alert">Could not confirm it is you. Try again.</div> : null}
          {canVerify && !forced && <button type="button" onClick={unlock} disabled={busy} style={{ minWidth: 220, minHeight: 48, borderRadius: 12, border: 0, fontWeight: 600 }}>Unlock</button>}
          <button type="button" onClick={() => p.onSignOut()} style={{ minWidth: 220, minHeight: 48, borderRadius: 12, border: '1px solid #fff', background: 'transparent', color: '#fff', fontWeight: 600 }}>Sign in again</button>
        </div>
      )}
    </>
  );
}
