// StepUpHost — Constitution 7 §8: the prompt the API client opens when a critical action needs a fresh step-up.
// Mounted once in the Super Admin shell. It re-confirms the password + authenticator code for THIS session
// (POST /auth/step-up) and tells the client to retry the original action; Cancel leaves the action refused.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { setStepUpHandler } from '../api/step-up';

export function StepUpHost() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setStepUpHandler(() => new Promise<boolean>((resolve) => { pending.current = resolve; setErr(null); setPassword(''); setCode(''); setOpen(true); }));
    return () => setStepUpHandler(null);
  }, []);

  const finish = (ok: boolean) => { setOpen(false); const r = pending.current; pending.current = null; r?.(ok); };
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await api.post('/auth/step-up', { password, code }); finish(true); }
    catch (e: any) { setErr(e?.message || 'Password or code is not correct.'); }
    finally { setBusy(false); }
  };
  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-label="Confirm it's you" data-testid="step-up">
      <div className="modal-card" style={{ maxWidth: 380 }}>
        <h3>Confirm it's you</h3>
        <p className="muted" style={{ fontSize: 13 }}>This is a critical action. Re-enter your password and the 6-digit code from your authenticator app.</p>
        <label>Password<input aria-label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <label>Authenticator code<input aria-label="Authenticator code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" /></label>
        {err ? <div className="error" role="alert">{err}</div> : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn" disabled={busy || !password || code.length !== 6} onClick={submit}>{busy ? 'Checking…' : 'Confirm'}</button>
          <button className="btn ghost" onClick={() => finish(false)} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
