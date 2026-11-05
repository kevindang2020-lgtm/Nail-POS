import { useEffect, useRef, useState } from 'react';
import { authApi } from '../api/authApi';
import { useAuth } from '../auth/AuthContext';

/*
 * Super Admin Portal login — the two-column luxury design. It drives the REAL POST /auth/login on portal
 * 'super-admin'. SUPER_ADMIN MFA is MANDATORY and enforced server-side (ROLE_MFA.SUPER_ADMIN = 'required'), so
 * NO super-admin login can ever skip the second factor — not with Remember Me, not with a trusted device. The
 * flow is: email/username + password → MFA_REQUIRED → "Verify Your Identity" (6-digit code) → SUCCESS. The code
 * is generated and verified entirely on the backend; the client only relays it. Nothing here bypasses that.
 *
 * The verification screen carries the masked phone the server returns (`maskedPhone`) when present; it degrades to
 * a generic prompt otherwise, so it never claims a delivery channel the backend did not report.
 */

const OTP_SECONDS = 300; // 5-minute window shown in the countdown

const IconUser = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" /></svg>);
const IconLock = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>);
const IconEye = ({ open }: { open: boolean }) => (open
  ? <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>
  : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 6.2A9 9 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-3.3 3.9M6.3 7.9A15 15 0 0 0 2.5 12S6 18 12 18a8.6 8.6 0 0 0 3.4-.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>);
const IconCheck = () => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>);
const IconArrow = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>);
const IconShield = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5-4-1.2-7-5.1-7-9.5V6l7-3Z" /><path d="M9 12l2 2 4-4" /></svg>);
const IconChart = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20V11M9.5 20V7M15 20v-5M20.5 20V4" /><path d="M3.5 9 8 5l4 3 7-5" /></svg>);
const IconUsers = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="M16 6.5a3 3 0 0 1 0 5.5M18 19c0-2.2-.9-3.8-2.4-4.7" /></svg>);
const IconDollar = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M14.5 9.2c-.5-.9-1.5-1.2-2.5-1.2-1.4 0-2.4.8-2.4 1.9 0 2.6 5 1.3 5 4 0 1.2-1.1 2.1-2.6 2.1-1.1 0-2.2-.4-2.7-1.4" /></svg>);

type LoginBody = { ok: boolean; outcome: string; message?: string; principal?: any; maskedPhone?: string };

export function LoginScreen() {
  const { setPrincipal } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mode, setMode] = useState<'signin' | 'mfa' | 'forgot'>('signin');
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(OTP_SECONDS);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    setLeft(OTP_SECONDS);
    if (tick.current) clearInterval(tick.current);
    tick.current = setInterval(() => setLeft((s) => (s <= 1 ? (clearInterval(tick.current!), 0) : s - 1)), 1000);
  };
  useEffect(() => () => { if (tick.current) clearInterval(tick.current); }, []);

  // One code path for password and MFA submit — the backend decides what's next from the outcome.
  const attempt = async (withCode: boolean) => {
    setErr(null); setBusy(true);
    try {
      const r = await authApi.login({
        portal: 'super-admin', identifier: identifier.trim(), password,
        rememberMe: remember, ...(withCode ? { mfaCode: mfaCode.trim() } : {}),
      }) as LoginBody;
      if (r.outcome === 'SUCCESS' && r.principal) { setPrincipal(r.principal); return; }
      if (r.outcome === 'MFA_REQUIRED') {
        if (r.maskedPhone) setMaskedPhone(r.maskedPhone);
        if (mode !== 'mfa') { setMode('mfa'); startTimer(); }
        else setErr("That code wasn't valid — please try again.");
        return;
      }
      setErr(r.message || 'Unable to sign in.');
    } catch (e: any) { setErr(e?.message || 'Unable to sign in.'); }
    finally { setBusy(false); }
  };

  const cancelMfa = () => { setMode('signin'); setMfaCode(''); setErr(null); if (tick.current) clearInterval(tick.current); };
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  return (
    <div className="sa-login">
      <aside className="sa-login__brand">
        <img className="sa-brand__logo" src="/brand/aipowersalon-logo.png" alt="AI PowerSalon" draggable={false} />
        <div className="sa-brand__label">SUPER ADMIN PORTAL</div>
        <div className="sa-brand__tag">Control your platform<br />with clarity, security, and confidence.</div>
        <div className="sa-cards">
          <div className="sa-card"><div className="sa-card__ic"><IconChart /></div><div className="sa-card__t">Platform Overview</div><div className="sa-card__d">Real-time insights and performance at a glance.</div></div>
          <div className="sa-card"><div className="sa-card__ic"><IconUsers /></div><div className="sa-card__t">Tenant Management</div><div className="sa-card__d">Manage tenants, subscriptions and platform access.</div></div>
          <div className="sa-card"><div className="sa-card__ic"><IconDollar /></div><div className="sa-card__t">Payments &amp; Revenue</div><div className="sa-card__d">Track transactions, revenue and financial performance.</div></div>
        </div>
      </aside>

      <section className="sa-login__side">
        <div className="sa-panel">
          <img className="sa-panel__logo" src="/brand/aipowersalon-logo.png" alt="AI PowerSalon" draggable={false} />

          {mode === 'forgot' ? (
            <>
              <h1 className="sa-panel__title" style={{ fontSize: 30 }}>Password help</h1>
              <div className="sa-rule" aria-hidden="true" />
              <div className="sa-note">Super Admin accounts are recovered by the platform operator, not through self-service — this protects the account that controls every tenant. Contact your platform operator to run a secure system reset, then sign in again here.</div>
              <button className="sa-btn sa-btn--ghost" style={{ marginTop: 14 }} onClick={() => setMode('signin')}>Back to sign in</button>
            </>
          ) : mode === 'mfa' ? (
            <>
              <h1 className="sa-panel__title" style={{ fontSize: 32 }}>Verify Your Identity</h1>
              <p className="sa-panel__sub">Enter the 6-digit verification code to continue.</p>
              {maskedPhone ? <div className="sa-mask">Code sent to <b>{maskedPhone}</b></div> : null}
              <div className="sa-rule" aria-hidden="true" />
              {err ? <div className="sa-err" role="alert">{err}</div> : null}
              <input
                className="sa-input" style={{ textAlign: 'center', letterSpacing: '0.5em', fontSize: 22, fontWeight: 800, paddingLeft: 16 }}
                inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
                value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && mfaCode.length === 6 && attempt(true)} aria-label="6-digit verification code" autoFocus
              />
              <div className="sa-timer">{left > 0 ? <>Code expires in <b>{mm}:{ss}</b></> : <b>Code expired — request a new one.</b>}</div>
              <button className="sa-btn" disabled={busy || mfaCode.length !== 6} onClick={() => attempt(true)}><IconShield />{busy ? 'Verifying…' : 'Verify'}</button>
              <div className="sa-actions">
                <button className="sa-btn sa-btn--ghost" disabled={busy} onClick={() => attempt(false)}>Resend code</button>
                <button className="sa-btn sa-btn--ghost" disabled={busy} onClick={cancelMfa}>Cancel login</button>
              </div>
            </>
          ) : (
            <>
              <h1 className="sa-panel__title">Welcome Back</h1>
              <p className="sa-panel__sub">Sign in to your Super Admin portal</p>
              <div className="sa-rule" aria-hidden="true" />
              {err ? <div className="sa-err" role="alert">{err}</div> : null}
              <div className="sa-form">
                <div className="sa-label">Email or Username</div>
                <div className="sa-field">
                  <span className="sa-ic"><IconUser /></span>
                  <input className="sa-input" placeholder="Enter your email or username" value={identifier} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setIdentifier(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && identifier.trim() && password && attempt(false)} aria-label="Email or Username" />
                </div>
                <div className="sa-label">Password</div>
                <div className="sa-field">
                  <span className="sa-ic"><IconLock /></span>
                  <input className="sa-input" style={{ paddingRight: 48 }} type={showPw ? 'text' : 'password'} placeholder="Enter your password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && identifier.trim() && password && attempt(false)} aria-label="Password" />
                  <button type="button" className="sa-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}><IconEye open={showPw} /></button>
                </div>
                <div className="sa-row">
                  <label className="sa-remember">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    <span className="sa-check">{remember ? <IconCheck /> : null}</span>
                    Remember me
                  </label>
                  <button type="button" className="sa-forgot" onClick={() => setMode('forgot')}>Forgot password?</button>
                </div>
                <button className="sa-btn" disabled={busy || !identifier.trim() || !password} onClick={() => attempt(false)}>
                  {busy ? 'Signing in…' : 'Sign In'}{!busy ? <IconArrow /> : null}
                </button>
              </div>
              <div className="sa-foot__wrap">
                <div className="sa-foot"><IconShield />Secure super admin access only</div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
