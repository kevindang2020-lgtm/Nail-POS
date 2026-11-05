import { useState } from 'react';
import { authApi } from '../api/authApi';

// OwnerForgotPasswordScreen — the way back in that a salon owner did not have.
//
// == THE BUG THIS CLOSES ==================================================================================
//
// `RESET_ALLOWED_ROLES` in the API is:
//
//     ["OWNER", "MANAGER", "FRONT_DESK", "RECEPTION"]
//
// OWNER is first on the list. The three endpoints — request, temp-login, complete — have been live the whole
// time, rate-limited, audited, and returning a deliberately generic message so an attacker cannot enumerate
// accounts. Everything worked.
//
// And owner-web had no forgot-password link anywhere in it. No screen called Super Admin's `resetOwnerPassword`
// either — that client method existed and nothing invoked it.
//
// So: POS staff could reset their password. Technicians' apps had the button. Customers could reset. And a salon
// OWNER who forgot theirs was locked out of their own business, permanently, with no self-serve path and no
// support path. The one person who pays for this platform was the one person who could not get back in.
//
// == WHAT THE UI MUST NOT DO =============================================================================
//
// The request endpoint returns the SAME message whether or not the account exists. That is on purpose. So this
// screen never says "we sent you a code" — it says what is actually true: *if* an owner account matches, a code
// is on its way. Claiming a send we cannot confirm is the same lie as an invitation that reports `sent` when no
// transport is configured.

type Step = 'request' | 'code' | 'password' | 'done';

export function OwnerForgotPasswordScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<Step>('request');
  const [salonCode, setSalonCode] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e: any) { setErr(e?.message || 'That didn’t work. Try again.'); }
    finally { setBusy(false); }
  };

  const request = () => go(async () => {
    if (!salonCode.trim() || !phone.trim()) throw new Error('Enter your salon code and the mobile number on your owner account.');
    await authApi.requestPasswordReset(salonCode.trim(), phone.trim());
    // Deliberately does NOT claim a code was sent — the server will not tell us, and neither will we.
    setStep('code');
  });

  const verify = () => go(async () => {
    const r = await authApi.tempLogin(salonCode.trim(), phone.trim(), code.trim());
    if (!r?.resetSessionToken) throw new Error(r?.message || 'That code is not right, or it has expired.');
    setToken(r.resetSessionToken);
    setStep('password');
  });

  const complete = () => go(async () => {
    if (pw.length < 10) throw new Error('Use at least 10 characters.');
    if (pw !== pw2) throw new Error('The two passwords do not match.');
    const r = await authApi.completePasswordReset(token, pw, pw2);
    if (!r?.ok) throw new Error(r?.message || 'Could not set that password.');
    setStep('done');
  });

  const field: React.CSSProperties = {
    width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #E3D8C6',
    fontSize: 15, marginBottom: 10, boxSizing: 'border-box',
  };
  const primary: React.CSSProperties = {
    width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid #A96F22',
    background: '#A96F22', color: '#fff', fontWeight: 700, fontSize: 15, cursor: busy ? 'default' : 'pointer',
  };

  return (
    <div style={{ padding: 22, maxWidth: 380, margin: '0 auto' }}>
      <button onClick={onBack} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.7, marginBottom: 14, padding: 0 }}>‹ Back to sign in</button>
      <h1 className="owner-serif" style={{ fontSize: 20, margin: '0 0 6px' }}>Reset your password</h1>

      {err ? <div style={{ color: '#B3403C', fontSize: 13, marginBottom: 10 }}>{err}</div> : null}

      {step === 'request' ? (
        <>
          <div style={{ fontSize: 13.5, opacity: 0.75, lineHeight: 1.5, marginBottom: 14 }}>
            Enter your salon code and the mobile number on your owner account. We’ll text you a 6-digit code.
          </div>
          <input style={field} placeholder="Salon code" value={salonCode} autoCapitalize="characters"
            onChange={(e) => setSalonCode(e.target.value)} />
          <input style={field} placeholder="Mobile number" value={phone} inputMode="tel" autoComplete="tel"
            onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && request()} />
          <button style={primary} disabled={busy} onClick={request}>{busy ? 'Sending…' : 'Send me a code'}</button>
        </>
      ) : null}

      {step === 'code' ? (
        <>
          {/* NOT "we sent you a code". The server returns the same answer whether the account exists or not, so
              claiming a send would be asserting something we were deliberately never told. */}
          <div style={{ fontSize: 13.5, opacity: 0.75, lineHeight: 1.5, marginBottom: 14 }}>
            If an owner account matches that salon code and number, a 6-digit code is on its way by text. Enter it
            below. It expires shortly.
          </div>
          <input style={field} placeholder="6-digit code" value={code} inputMode="numeric" autoComplete="one-time-code"
            onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && verify()} />
          <button style={primary} disabled={busy} onClick={verify}>{busy ? 'Checking…' : 'Continue'}</button>
          <button onClick={() => setStep('request')} style={{ ...primary, background: 'transparent', color: '#A96F22', marginTop: 8 }} disabled={busy}>
            Use a different number
          </button>
        </>
      ) : null}

      {step === 'password' ? (
        <>
          <div style={{ fontSize: 13.5, opacity: 0.75, lineHeight: 1.5, marginBottom: 14 }}>
            Choose a new password. At least 10 characters.
          </div>
          <input style={field} type="password" placeholder="New password" value={pw} autoComplete="new-password"
            onChange={(e) => setPw(e.target.value)} />
          <input style={field} type="password" placeholder="Confirm new password" value={pw2} autoComplete="new-password"
            onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && complete()} />
          <button style={primary} disabled={busy} onClick={complete}>{busy ? 'Saving…' : 'Set new password'}</button>
        </>
      ) : null}

      {step === 'done' ? (
        <>
          <div style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
            Your password is set. Sign in with it now.
          </div>
          <button style={primary} onClick={onBack}>Back to sign in</button>
        </>
      ) : null}
    </div>
  );
}
