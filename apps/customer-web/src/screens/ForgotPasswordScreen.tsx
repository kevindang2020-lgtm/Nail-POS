import { useState } from 'react';
import { authApi } from '../api/authApi';

// Forgot password — wires the existing tenant reset flow: request a code (SMS), then exchange the code for a reset
// session and set a new password. Code delivery depends on the salon's configured SMS provider.
const field: React.CSSProperties = { height: 40, border: '1px solid var(--line)', borderRadius: 10, padding: '0 12px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', width: '100%' };

export function ForgotPasswordScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<'request' | 'reset' | 'done'>('request');
  const [salonCode, setSalonCode] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async () => {
    setErr(null); setBusy(true);
    try { await authApi.passwordResetRequest({ salonCode, phone }); setNote('If an account exists, we sent a reset code to that phone.'); setStep('reset'); }
    catch (e: any) { setErr(e?.message || 'Could not send a reset code.'); }
    finally { setBusy(false); }
  };
  const complete = async () => {
    setErr(null);
    if (newPassword !== confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const t = await authApi.passwordResetTempLogin({ salonCode, emailOrPhone: phone, password: code });
      if (!t.resetSessionToken) { setErr(t.message || 'That code is invalid or expired.'); return; }
      await authApi.passwordResetComplete({ resetSessionToken: t.resetSessionToken, newPassword, confirmPassword: confirm });
      setStep('done');
    } catch (e: any) { setErr(e?.message || 'Could not reset your password.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: 'var(--page)' }}>
      <div className="panel" style={{ width: 380, maxWidth: '92vw' }}>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22 }}>AIPowerSalon</div>
          <div className="muted" style={{ fontSize: 13 }}>Reset your password</div>
        </div>
        {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}
        {note && step !== 'done' ? <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>{note}</div> : null}
        {step === 'request' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input style={field} placeholder="Salon code" value={salonCode} onChange={(e) => setSalonCode(e.target.value)} autoComplete="off" />
            <input style={field} placeholder="Phone on file" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
            <button className="btn" disabled={busy || !salonCode || !phone} onClick={request}>{busy ? 'Sending…' : 'Send reset code'}</button>
            <button className="btn ghost" onClick={onBack} disabled={busy}>Back to sign in</button>
          </div>
        ) : step === 'reset' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input style={field} placeholder="Reset code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
            <input style={field} type="password" placeholder="New password (8+ characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            <input style={field} type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            <button className="btn" disabled={busy || !code || !newPassword || !confirm} onClick={complete}>{busy ? 'Updating…' : 'Set new password'}</button>
            <button className="btn ghost" onClick={onBack} disabled={busy}>Back to sign in</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center' }}>
            <div style={{ fontSize: 30 }} aria-hidden>✅</div>
            <div style={{ fontWeight: 700 }}>Password updated</div>
            <div className="muted" style={{ fontSize: 13 }}>You can now sign in with your new password.</div>
            <button className="btn" onClick={onBack}>Back to sign in</button>
          </div>
        )}
      </div>
    </div>
  );
}
