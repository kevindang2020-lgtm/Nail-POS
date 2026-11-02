// MfaRecoveryScreen — Constitution 7 §24: the page a platform user opens from the one-time recovery link after an
// administrator reset their MFA. Step 1: their own password → a new authenticator secret. Step 2: a live code → done.
// No session exists or is created here; afterwards they sign in normally with the new authenticator.
import { useState } from 'react';
import { api } from '../api/client';

export function MfaRecoveryScreen() {
  const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') ?? '' : '';
  const [password, setPassword] = useState('');
  const [enrol, setEnrol] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => { setBusy(true); setErr(null); try { setEnrol(await api.post('/public/mfa-recovery/start', { token, password })); } catch (e: any) { setErr(e?.message || 'That recovery link or password is not valid.'); } finally { setBusy(false); } };
  const confirm = async () => { setBusy(true); setErr(null); try { await api.post('/public/mfa-recovery/confirm', { token, code }); setDone(true); } catch (e: any) { setErr(e?.message || 'That code is not correct.'); } finally { setBusy(false); } };
  return (
    <div className="login-wrap" data-testid="mfa-recovery" style={{ maxWidth: 440, margin: '60px auto' }}>
      <h2>Set up a new authenticator</h2>
      {!token ? <p className="error">This link is incomplete. Ask a platform administrator for a new recovery link.</p>
        : done ? <p role="status">Your new authenticator is set up. <a href="/">Sign in</a> with your password and a code from it.</p>
        : !enrol ? (
          <>
            <p className="muted">An administrator reset your two-step sign-in. Confirm it's you with your password.</p>
            <label>Password<input aria-label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
            <button className="btn" disabled={busy || !password} onClick={start}>{busy ? 'Checking…' : 'Continue'}</button>
          </>
        ) : (
          <>
            <p>Add this account to your authenticator app, then enter the 6-digit code it shows.</p>
            <p><a href={enrol.otpauthUri}>Open in authenticator app</a></p>
            <p className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>Or enter this key manually: <code data-testid="mfa-secret">{enrol.secret}</code></p>
            <label>Code<input aria-label="Code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" /></label>
            <button className="btn" disabled={busy || code.length !== 6} onClick={confirm}>{busy ? 'Confirming…' : 'Confirm'}</button>
          </>
        )}
      {err ? <div className="error" role="alert">{err}</div> : null}
    </div>
  );
}
