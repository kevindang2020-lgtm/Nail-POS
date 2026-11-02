import { useEffect, useState } from 'react';
import { useT, verifyDeviceOwner, faceIdState, recordBiometricFailure, resetBiometricFailures, biometricLockedOut, BIOMETRIC_MAX_FAILURES } from '@aipowersalon/mobile-sdk';
import { authApi } from '../api/authApi';
import { signOutNow } from '../lib/signOut';

// "Return to Staff" (mandate §61; Secure Tap to Pay §53 / §12): leaving Customer Handoff Mode needs the EMPLOYEE.
//   • Face ID / Touch ID / the device passcode through the ONE biometric adapter (verifyDeviceOwner — the app lock's proof);
//   • when this phone has no biometric / passcode check (faceIdState not 'available', e.g. the web build or a phone without
//     a passcode) the employee's PASSWORD instead (POST /auth/step-up — it also stamps this session as freshly proved).
//     Before Oct 26 2026 a plain tap left Handoff Mode on such a phone — the customer holding it could do it.
//   • §12: failed / cancelled checks count in the shared budget (the app lock's too); at the limit the phone signs out and a
//     full password sign-in is required. A cancel of this sheet (onDismiss) stays in Handoff Mode — it never exits it.
export function ReturnToStaff({ onDone, onDismiss, onForceSignOut = () => { void signOutNow(); }, maxFailures = BIOMETRIC_MAX_FAILURES }:
  { onDone: () => void; onDismiss?: () => void; onForceSignOut?: () => void; maxFailures?: number }) {
  const tr = useT();
  const [canVerify, setCanVerify] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [forced, setForced] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  useEffect(() => { let alive = true; void faceIdState().then((s) => { if (alive) setCanVerify(s.status === 'available'); }).catch(() => { if (alive) setCanVerify(false); }); return () => { alive = false; }; }, []);

  const fail = (message: string) => {
    if (biometricLockedOut(recordBiometricFailure(), maxFailures)) { resetBiometricFailures(); setForced(true); onForceSignOut(); return; }
    setFailed(message);
  };
  const go = async () => {
    setBusy(true); setFailed(null);
    try {
      if (canVerify) {
        const ok = await verifyDeviceOwner().catch(() => false);   // a thrown / cancelled check is a failure, never an exit
        if (!ok) { fail(tr('pay.handoff.couldNotConfirm')); return; }
      } else {
        if (!password) return;
        try { await authApi.stepUp(password, code.replace(/\s+/g, '') || undefined); }
        catch (e: any) {
          // a refused password / code (403 STEP_UP_FAILED) or the server's attempt lock (429) counts; a missing code (400) or a
          // network failure does not — it proved nothing either way, the employee retries
          if (e?.code === 'STEP_UP_FAILED' || e?.status === 403 || e?.status === 429) fail(tr('pay.handoff.wrongPassword'));
          else setFailed(e?.status === 400 && e?.message ? String(e.message) : tr('pay.handoff.couldNotCheck'));
          return;
        }
      }
      resetBiometricFailures();
      onDone();
    } finally { setBusy(false); }
  };
  const needsPassword = canVerify === false;
  return (
    <div className="pay-returnstaff" role="dialog" aria-modal="true" aria-label={tr('pay.handoff.returnToStaff')}>
      <div className="box">
        <div className="t">{tr('pay.handoff.returnToStaff')}</div>
        {forced ? <div className="pay-proceedresult block" role="alert" data-testid="rts-forced">{tr('pay.handoff.tooManyAttempts')}</div> : (
          <>
            <div className="muted">{needsPassword ? tr('pay.handoff.passwordToReturn') : tr('pay.handoff.verifyToReturn')}</div>
            {needsPassword && (
              <>
                <input className="pay-reasoninput" type="password" autoComplete="current-password" aria-label={tr('pay.ticket.stepUpPassword')} placeholder={tr('pay.ticket.stepUpPassword')} value={password} onChange={(e) => setPassword(e.target.value)} />
                <input className="pay-reasoninput" inputMode="numeric" autoComplete="one-time-code" aria-label={tr('pay.stepUp.code')} placeholder={tr('pay.stepUp.code')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </>
            )}
            {failed && <div className="pay-proceedresult block" role="alert">{failed}</div>}
            <button className="pay-btn" disabled={busy || canVerify === null || (needsPassword && password.length === 0)} onClick={() => void go()}>{tr('pay.handoff.returnToStaff')}</button>
            {onDismiss && <button className="pay-linkbtn" style={{ marginTop: 8 }} onClick={onDismiss}>{tr('pay.handoff.cancel')}</button>}
          </>
        )}
      </div>
    </div>
  );
}
