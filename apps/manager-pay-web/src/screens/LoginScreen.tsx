import { useEffect, useState } from 'react';
import { authApi, type Principal } from '../api/authApi';
import { saveNativeToken, tokenFromResponse } from '../auth/native-auth';
import { faceIdMode, signInWithFaceId, isFaceIdEnrolled, enrollFaceId, type FaceIdMode } from '../auth/faceid';
import { isTapToPayAvailable } from '../native/tapToPay';
import logoImage from '../../public/brand/taptopay.png';

/*
 * Manager Tap to Pay — login. Matches the reference design and drives the REAL POST /auth/login on the tenant
 * portal. Manager Pay users are salon staff (owner/manager/authorized cashier or receptionist); the backend
 * resolves tenant + branch and enforces role + payment permission + device registration — the app never assigns
 * its own role. The salon code (needed to resolve the tenant) is remembered per device after the first sign-in, so
 * a provisioned device shows exactly the design (email/mobile + password); a fresh device is asked for it once.
 *
 * The "Tap to Pay Experience" panel describes what the app does; it does NOT claim this specific device is ready —
 * real device/merchant/processor/entitlement readiness is verified server-side AFTER sign-in
 * (GET /mobile-checkout/readiness), which the app already surfaces before any payment.
 */

const SALON_KEY = 'aps_pay_salon_code';
const getStorage = () => (typeof window !== 'undefined' && window.localStorage ? window.localStorage : (globalThis as any).localStorage);
const rememberedSalon = (): string => { try { return getStorage()?.getItem(SALON_KEY) ?? ''; } catch { return ''; } };
const persistSalon = (code: string): void => { try { if (code) getStorage()?.setItem(SALON_KEY, code); } catch { /* ignore */ } };

const IconUser = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" /></svg>);
const IconLock = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>);
const IconStore = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5v10h16v-10M4 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" /></svg>);
const IconEye = ({ open }: { open: boolean }) => (open
  ? <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>
  : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 6.2A9 9 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-3.3 3.9M6.3 7.9A15 15 0 0 0 2.5 12S6 18 12 18a8.6 8.6 0 0 0 3.4-.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>);
const IconCheck = () => (<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>);
const IconFaceId = () => (<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M9 10v1M15 10v1M12 9v4l-1 1" /><path d="M9 15c.9.8 1.9 1.2 3 1.2s2.1-.4 3-1.2" /></svg>);
const IconContactless = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7a12 12 0 0 1 0 10M11 4.5a17 17 0 0 1 0 15M15 2.5a22 22 0 0 1 0 19" /></svg>);
const IconTimer = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 13V9M9 2h6M18 6l1.5-1.5" /></svg>);
const IconShieldLock = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5-4-1.2-7-5.1-7-9.5V6l7-3Z" /><rect x="9.5" y="11" width="5" height="4.5" rx="1" /><path d="M10.5 11v-1a1.5 1.5 0 0 1 3 0v1" /></svg>);
const IconShield = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5-4-1.2-7-5.1-7-9.5V6l7-3Z" /><path d="M9 12l2 2 4-4" /></svg>);

// The contactless illustration from the design — a phone emitting waves toward a gold card.
const ContactlessArt = () => (
  <svg className="pl-art" viewBox="0 0 200 120" fill="none" aria-hidden="true">
    <rect x="34" y="18" width="52" height="88" rx="11" fill="#FFFDF8" stroke="var(--pay-border-gold)" strokeWidth="2" />
    <rect x="46" y="24" width="28" height="5" rx="2.5" fill="var(--pay-border)" />
    <g stroke="var(--pay-primary)" strokeWidth="3.4" strokeLinecap="round" fill="none">
      <path d="M96 46a20 20 0 0 1 0 28" /><path d="M104 40a30 30 0 0 1 0 40" /><path d="M112 34a40 40 0 0 1 0 52" />
    </g>
    <g transform="rotate(-16 150 60)">
      <rect x="124" y="42" width="60" height="40" rx="7" fill="url(#plg)" stroke="#C9933B" strokeWidth="1.5" />
      <path d="M150 54a10 10 0 0 1 0 16" stroke="#FFFDF8" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M156 50a16 16 0 0 1 0 24" stroke="#FFFDF8" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".85" />
    </g>
    <defs><linearGradient id="plg" x1="124" y1="42" x2="184" y2="82" gradientUnits="userSpaceOnUse"><stop stopColor="#EBCD84" /><stop offset="1" stopColor="#C6952F" /></linearGradient></defs>
  </svg>
);

export function LoginScreen({ onAuthed }: { onAuthed: (p: Principal) => void }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [salonCode, setSalonCode] = useState(rememberedSalon);
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [mode, setMode] = useState<'signin' | 'forgot' | 'branch'>('signin');
  const [branches, setBranches] = useState<any[]>([]);
  const [lastToken, setLastToken] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fid, setFid] = useState<FaceIdMode>('none');
  const [fidBusy, setFidBusy] = useState(false);
  const [tapCapable] = useState(() => { try { return isTapToPayAvailable(); } catch { return false; } });

  // Forgot-password (reuses the real reset endpoint)
  const [fpPhone, setFpPhone] = useState('');
  const [fpBusy, setFpBusy] = useState(false);
  const [fpMsg, setFpMsg] = useState<string | null>(null);

  useEffect(() => { void faceIdMode().then(setFid).catch(() => setFid('none')); }, []);

  const chooseBranch = async (branchId: string) => {
    setErr(null); setBusy(true);
    try {
      const codeToSend = salonCode.trim();
      const sRes = await authApi.selectBranch(branchId);
      if (sRes.principal) {
        await saveNativeToken(tokenFromResponse(sRes) || lastToken);
        persistSalon(codeToSend);
        try { localStorage.setItem('aps_last_branch_id', branchId); } catch { /* ignore */ }
        // A password sign-in on the payment phone turns Face ID on (the server allows it right after a password check).
        if (password) void enrollFaceId(sRes.principal.userId).catch(() => {});
        onAuthed(sRes.principal);
        return;
      }
      setErr('Could not select branch.');
    } catch (e: any) {
      setErr(e?.message || 'Could not select branch.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const codeToSend = salonCode.trim();
      if (!codeToSend) { setErr('Enter your salon code.'); return; }
      const r = await authApi.login({
        portal: 'tenant', salonCode: codeToSend, identifier: identifier.trim(), password,
        rememberMe: remember, ...(mfaNeeded ? { mfaCode: mfaCode.trim() } : {}),
      });
      await saveNativeToken(tokenFromResponse(r)); // native only; web keeps the httpOnly cookie
      if (r.outcome === 'SUCCESS' && r.principal) {
        persistSalon(codeToSend);
        void enrollFaceId(r.principal.userId).catch(() => {});
        onAuthed(r.principal); return;
      }
      if (r.outcome === 'BRANCH_SELECTION_REQUIRED') {
        const bRes = await authApi.branches().catch(() => null);
        const list = (bRes?.branches || []).filter((b: any) => b.isActive);
        if (list.length === 1) {
          const sRes = await authApi.selectBranch(list[0].id);
          if (sRes.principal) {
            await saveNativeToken(tokenFromResponse(sRes) || tokenFromResponse(r));
            persistSalon(codeToSend);
            try { localStorage.setItem('aps_last_branch_id', list[0].id); } catch { /* ignore */ }
            void enrollFaceId(sRes.principal.userId).catch(() => {});
            onAuthed(sRes.principal);
            return;
          }
        } else if (list.length > 1) {
          setBranches(list);
          setLastToken(tokenFromResponse(r));
          setMode('branch');
          return;
        }
      }
      if (r.outcome === 'MFA_REQUIRED') {
        setErr(mfaNeeded ? 'That code wasn’t valid — please try again.' : 'Enter your 6-digit verification code to continue.');
        setMfaNeeded(true); return;
      }
      setErr(r.message || 'Unable to sign in.');
    } catch (e: any) { setErr(e?.message || 'Unable to sign in.'); }
    finally { setBusy(false); }
  };

  const faceIdSignIn = async () => {
    setErr(null); setFidBusy(true);
    try {
      const isEnrolled = await isFaceIdEnrolled().catch(() => false);
      if (!isEnrolled) {
        setErr('Sign in with your password first to enable Face ID.');
        setFidBusy(false);
        return;
      }

      // The server opens the session from the biometric device credential (no password is stored on the phone).
      const p: any = await signInWithFaceId(
        async () => await authApi.me(),
        identifier.trim() || undefined,
      );
      if (p?.needsBranchSelection) {
        const bRes = await authApi.branches().catch(() => null);
        const list = (bRes?.branches || []).filter((b: any) => b.isActive);
        if (list.length === 1) { await chooseBranch(list[0].id); return; }
        if (list.length > 1) { setBranches(list); setMode('branch'); return; }
      }
      if (p) { onAuthed(p); return; }
      setErr('Biometric sign-in was unsuccessful. Please use your password.');
    } catch (e: any) {
      const m = String(e?.message ?? '');
      if (/cancel/i.test(m)) return;
      if (/not enrolled|no credential|first to enable/i.test(m) || e?.reason === 'not_enrolled') {
        setErr('Sign in with your password first to enable Face ID.');
        return;
      }
      if (e?.reason === 'session_invalid' || /session|expired/i.test(m)) {
        setErr('Session expired. Please sign in with your password to continue.');
        return;
      }
      if (/mismatch/i.test(m)) {
        setErr('Face ID did not match. Please try again or use your password.');
        return;
      }
      setErr(m || 'Face ID is unavailable. Use your password.');
    } finally { setFidBusy(false); }
  };

  const submitForgot = async () => {
    setFpBusy(true); setFpMsg(null);
    try {
      await authApi.requestPasswordReset(salonCode.trim(), fpPhone.trim());
      setFpMsg('If that account exists, a reset code has been sent by SMS. Follow it to set a new password, then sign in.');
    } catch (e: any) { setFpMsg(e?.message || 'Could not start a reset. Check your details and try again.'); }
    finally { setFpBusy(false); }
  };

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && salonCode.trim() && identifier.trim() && password) void submit(); };

  return (
    <div className="pay-login">
      <div className="pay-login__marble" aria-hidden="true" />
      <div className="pay-login__scroll">
        <div className="pay-login__inner">
          <img className="pl-logo" src={logoImage} alt="AI PowerSalon" width={170} draggable={false} />
     
          <div className="pl-section">TAP TO PAY ON IPHONE</div>
          <h1 className="pl-welcome">{mode === 'branch' ? 'Select Branch' : 'Welcome Back'}</h1>
          <p className="pl-sub">{mode === 'branch' ? 'Choose the location you want to accept payments for.' : 'Accept contactless payments with elegance and confidence.'}</p>

          <div className="pl-artwrap"><ContactlessArt /></div>

          {mode === 'branch' ? (
            <div className="pl-form">
              {err ? (
                <div className="pl-err" role="alert">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span>{err}</span>
                </div>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginBottom: 16 }}>
                {branches.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void chooseBranch(b.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 16px',
                      borderRadius: 12,
                      border: '1.5px solid var(--pay-border-gold, #D6C097)',
                      background: '#FFFDF8',
                      cursor: busy ? 'default' : 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#2A2118', fontSize: 15 }}>{b.name || 'Branch'}</div>
                      {b.city ? <div style={{ fontSize: 12.5, color: '#7A6B58', marginTop: 2 }}>📍 {b.city}</div> : null}
                    </div>
                    <span style={{ color: '#A96F22', fontWeight: 600, fontSize: 13 }}>{busy ? 'Selecting…' : 'Select →'}</span>
                  </button>
                ))}
              </div>
              <button className="pl-btn pl-btn--ghost" disabled={busy} onClick={() => { setMode('signin'); setBranches([]); setErr(null); }}>
                Back to sign in
              </button>
            </div>
          ) : mode === 'forgot' ? (
            <div className="pl-form">
              <div className="pl-note">{fpMsg ?? 'Enter the salon code and the mobile number on your account and we’ll text a reset code.'}</div>
              <div className="pl-field"><span className="pl-lead"><IconStore /></span><input className="pl-input" placeholder="Salon code" value={salonCode} onChange={(e) => { setSalonCode(e.target.value); if (err) setErr(null); }} autoCapitalize="characters" aria-label="Salon code" /></div>
              <div className="pl-field"><span className="pl-lead"><IconUser /></span><input className="pl-input" placeholder="Mobile number" value={fpPhone} onChange={(e) => { setFpPhone(e.target.value); if (err) setErr(null); }} inputMode="tel" autoComplete="tel" aria-label="Mobile number" /></div>
              <button className="pl-btn" disabled={fpBusy || !salonCode.trim() || !fpPhone.trim()} onClick={submitForgot}>{fpBusy ? 'Sending…' : 'Send reset code'}</button>
              <button className="pl-btn pl-btn--ghost" disabled={fpBusy} onClick={() => { setMode('signin'); setFpMsg(null); }}>Back to sign in</button>
            </div>
          ) : (
            <div className="pl-form">
              {err ? (
                <div className="pl-err" role="alert">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span>{err}</span>
                </div>
              ) : null}
              <div className="pl-field"><span className="pl-lead"><IconStore /></span>
                <input className="pl-input" placeholder="Salon code" value={salonCode} onChange={(e) => { setSalonCode(e.target.value); if (err) setErr(null); }} onKeyDown={onKey} autoCapitalize="characters" autoCorrect="off" spellCheck={false} aria-label="Salon code" />
              </div>
              <div className="pl-field"><span className="pl-lead"><IconUser /></span>
                <input className="pl-input" placeholder="Email or Mobile Number" value={identifier} onChange={(e) => { setIdentifier(e.target.value); if (err) setErr(null); }} onKeyDown={onKey} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Email or Mobile Number" />
              </div>
              <div className="pl-field"><span className="pl-lead"><IconLock /></span>
                <input className="pl-input" style={{ paddingRight: 48 }} type={showPw ? 'text' : 'password'} placeholder="Password" value={password} onChange={(e) => { setPassword(e.target.value); if (err) setErr(null); }} onKeyDown={onKey} autoComplete="current-password" aria-label="Password" />
                <button type="button" className="pl-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}><IconEye open={showPw} /></button>
              </div>
              {mfaNeeded ? (
                <div className="pl-field"><span className="pl-lead"><IconShield /></span>
                  <input className="pl-input" inputMode="numeric" maxLength={6} placeholder="6-digit code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={onKey} aria-label="Verification code" />
                </div>
              ) : null}

              <div className="pl-row">
                <label className="pl-remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span className="pl-check">{remember ? <IconCheck /> : null}</span>
                  Remember Me
                </label>
                <button type="button" className="pl-forgot" onClick={() => { setMode('forgot'); setErr(null); }}>Forgot Password?</button>
              </div>

              <button className="pl-btn" disabled={busy || !salonCode.trim() || !identifier.trim() || !password} onClick={submit}>{busy ? 'Signing in…' : 'Sign In'}</button>

              {fid !== 'none' ? (
                <>
                  <div className="pl-or">OR</div>
                  <button type="button" className="pl-btn pl-btn--ghost" disabled={fidBusy} onClick={faceIdSignIn}>
                    <IconFaceId />
                    {fidBusy ? 'Verifying…' : 'Sign In with Face ID'}
                  </button>
                </>
              ) : null}

              <div className="pl-panel">
                <div className="pl-panel__h">Tap to Pay Experience</div>
                <div className="pl-panel__grid">
                  <div className="pl-feat"><IconContactless /><div className="pl-feat__t">Tap to Pay Ready</div></div>
                  <div className="pl-feat"><IconTimer /><div className="pl-feat__t">Fast Checkout</div></div>
                  <div className="pl-feat"><IconShieldLock /><div className="pl-feat__t">Secure Transactions</div></div>
                </div>
                {!tapCapable ? <div className="pl-panel__note">Tap to Pay readiness is confirmed after sign-in on a registered, supported device.</div> : null}
              </div>

              <div className="pl-foot"><IconShield />Secure payment access only</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
