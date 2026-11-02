import { useEffect, useState } from 'react';
import { authApi, type BranchOption, type Principal } from '../api/authApi';
import { saveNativeSession, faceIdMode, signInWithFaceId, type FaceIdMode, useT } from '@aipowersalon/mobile-sdk';
import '../i18n/catalog';   // this app's EN / VI strings (registered on import, so tests and screens see them)
import { isTapToPayAvailable } from '../native/tapToPay';
import { DEVICE_ID } from '../util/session';

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
const rememberedSalon = (): string => { try { return globalThis.localStorage?.getItem(SALON_KEY) ?? ''; } catch { return ''; } };
const persistSalon = (code: string): void => { try { if (code) globalThis.localStorage?.setItem(SALON_KEY, code); } catch { /* ignore */ } };

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
  const tr = useT();   // C6 §97 (Phase 13): EN / VI; every English key is today's text
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [salonInit] = useState(rememberedSalon);
  const [salonCode, setSalonCode] = useState(salonInit);
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [mode, setMode] = useState<'signin' | 'forgot' | 'branch'>('signin');
  // BRANCH_SELECTION_REQUIRED: a multi-branch person is authenticated but branchless until they pick a location
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tapCapable] = useState(() => { try { return isTapToPayAvailable(); } catch { return false; } });

  // Forgot-password (reuses the real reset endpoint)
  const [fpPhone, setFpPhone] = useState('');
  const [fpBusy, setFpBusy] = useState(false);
  const [fpMsg, setFpMsg] = useState<string | null>(null);

  const needSalon = !salonInit; // ask for the salon code only until the device remembers it

  // Face ID (BUILD_PLAN Phase 13 D, audit bug 3 follow-up): the plugin + NSFaceIDUsageDescription now ship in this app, and
  // the button appears only when the server has Face ID on AND this device has an enrolled credential path. Face ID
  // unlocks the device credential; the SERVER opens a fresh session (or refuses, and the credential is wiped).
  const [fid, setFid] = useState<FaceIdMode>('none');
  const [fidBusy, setFidBusy] = useState(false);
  useEffect(() => { void faceIdMode().then(setFid).catch(() => setFid('none')); }, []);
  // The platform's ONE branch switch (POST /auth/select-branch): the session is re-signed for the chosen location (native: a
  // new token — persisted, or the next launch would come back branchless). The phone names itself, as everywhere else.
  const pickBranch = async (branchId: string) => {
    setErr(null); setPicking(branchId);
    try {
      const r = await authApi.selectBranch(branchId, DEVICE_ID);
      await saveNativeSession(r);
      if (r.principal) { persistSalon(salonCode.trim()); onAuthed(r.principal); return; }
      setErr(tr('pay.login.branchFailed'));
    } catch (e: any) { setErr(e?.message || tr('pay.login.branchFailed')); }
    finally { setPicking(null); }
  };
  // GET /auth/branches is already narrowed to the locations this person may enter (§121): one → enter it, several → ask.
  const loadBranches = async () => {
    try {
      const active = (await authApi.branches()).filter((b) => b.isActive);
      if (active.length === 1) { await pickBranch(active[0].id); return; }
      if (active.length === 0) { setErr(tr('pay.login.noBranches')); return; }
      setBranches(active); setMode('branch');
    } catch (e: any) { setErr(e?.message || tr('pay.login.branchFailed')); }
  };

  const faceIdSignIn = async () => {
    setErr(null); setFidBusy(true);
    try {
      const p: any = await signInWithFaceId(async () => await authApi.me(), undefined);
      if (p && p.role && !p.branchId && p.role !== 'OWNER') { await loadBranches(); return; }
      if (p && p.role) { onAuthed(p as Principal); return; }
      setErr('Face ID could not sign you in. Use your password.');
    } catch (e: any) {
      const m = String(e?.message ?? '');
      if (e?.reason === 'cancelled' || /cancel/i.test(m)) return;
      setErr(e?.reason === 'session_invalid' && m ? m : 'Face ID is unavailable. Sign in with your password, then turn on Face ID under Account.');
    } finally { setFidBusy(false); }
  };

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await authApi.login({
        portal: 'tenant', salonCode: salonCode.trim(), identifier: identifier.trim(), password,
        rememberMe: remember, ...(mfaNeeded ? { mfaCode: mfaCode.trim() } : {}),
      });
      if (r.outcome === 'SUCCESS' && r.principal) {
        await saveNativeSession(r);   // access + refresh token (Constitution 3 Step 2b) // native only; web keeps the httpOnly cookie
        persistSalon(salonCode.trim());
        onAuthed(r.principal); return;
      }
      if (r.outcome === 'BRANCH_SELECTION_REQUIRED') {
        await saveNativeSession(r);   // native: the branchless token is what lets /auth/select-branch be called
        await loadBranches(); return;
      }
      if (r.outcome === 'MFA_REQUIRED') {
        setErr(mfaNeeded ? 'That code wasn\u2019t valid — please try again.' : 'Enter your 6-digit verification code to continue.');
        setMfaNeeded(true); return;
      }
      setErr(r.message || 'Unable to sign in.');
    } catch (e: any) { setErr(e?.message || 'Unable to sign in.'); }
    finally { setBusy(false); }
  };

  const submitForgot = async () => {
    setFpBusy(true); setFpMsg(null);
    try {
      await authApi.requestPasswordReset(salonCode.trim(), fpPhone.trim());
      setFpMsg('If that account exists, a reset code has been sent by SMS. Follow it to set a new password, then sign in.');
    } catch (e: any) { setFpMsg(e?.message || 'Could not start a reset. Check your details and try again.'); }
    finally { setFpBusy(false); }
  };

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && identifier.trim() && password && (!needSalon || salonCode.trim())) void submit(); };

  return (
    <div className="pay-login">
      <div className="pay-login__marble" aria-hidden="true" />
      <div className="pay-login__scroll">
        <div className="pay-login__inner">
          <img className="pl-logo" src="/brand/aipowersalon-logo.png" alt="AI PowerSalon" width={175} draggable={false} />
          <div className="pl-tagline">{tr('common.tagline')}</div>
          <div className="pl-section">{tr('pay.login.tapToPay')}</div>
          <h1 className="pl-welcome">{mode === 'branch' ? tr('pay.login.selectBranch') : tr('common.welcomeBack')}</h1>
          <p className="pl-sub">{mode === 'branch' ? tr('pay.login.selectBranchHint') : tr('pay.login.subtitle')}</p>

          <div className="pl-artwrap"><ContactlessArt /></div>

          {mode === 'branch' ? (
            <div className="pl-form">
              {err ? <div className="pl-err" role="alert">{err}</div> : null}
              <div className="pl-branches">
                {branches.map((b) => (
                  <button key={b.id} type="button" className="pl-branch" disabled={!!picking} onClick={() => void pickBranch(b.id)}>
                    <span className="pl-branch__meta">
                      <span className="pl-branch__name">{b.name || tr('pay.account.branch')}</span>
                      {b.city ? <span className="pl-branch__city">{b.city}</span> : null}
                    </span>
                    <span className="pl-branch__go">{picking === b.id ? tr('pay.login.selecting') : tr('pay.login.select')}</span>
                  </button>
                ))}
              </div>
              <button className="pl-btn pl-btn--ghost" disabled={!!picking} onClick={() => { setMode('signin'); setBranches([]); setErr(null); }}>{tr('common.backToSignIn')}</button>
            </div>
          ) : mode === 'forgot' ? (
            <div className="pl-form">
              <div className="pl-note">{fpMsg ?? 'Enter the salon code and the mobile number on your account and we\u2019ll text a reset code.'}</div>
              {needSalon || !salonCode ? <div className="pl-field"><span className="pl-lead"><IconStore /></span><input className="pl-input" placeholder={tr('common.salonCode')} value={salonCode} onChange={(e) => setSalonCode(e.target.value)} autoCapitalize="characters" aria-label={tr('common.salonCode')} /></div> : null}
              <div className="pl-field"><span className="pl-lead"><IconUser /></span><input className="pl-input" placeholder={tr('common.mobileNumber')} value={fpPhone} onChange={(e) => setFpPhone(e.target.value)} inputMode="tel" autoComplete="tel" aria-label={tr('common.mobileNumber')} /></div>
              <button className="pl-btn" disabled={fpBusy || !salonCode.trim() || !fpPhone.trim()} onClick={submitForgot}>{fpBusy ? 'Sending…' : 'Send reset code'}</button>
              <button className="pl-btn pl-btn--ghost" disabled={fpBusy} onClick={() => { setMode('signin'); setFpMsg(null); }}>{tr('common.backToSignIn')}</button>
            </div>
          ) : (
            <div className="pl-form">
              {err ? <div className="pl-err" role="alert">{err}</div> : null}
              {needSalon ? (
                <div className="pl-field"><span className="pl-lead"><IconStore /></span>
                  <input className="pl-input" placeholder={tr('common.salonCode')} value={salonCode} onChange={(e) => setSalonCode(e.target.value)} onKeyDown={onKey} autoCapitalize="characters" autoCorrect="off" spellCheck={false} aria-label={tr('common.salonCode')} />
                </div>
              ) : null}
              <div className="pl-field"><span className="pl-lead"><IconUser /></span>
                <input className="pl-input" placeholder={tr('common.emailOrMobile')} value={identifier} onChange={(e) => setIdentifier(e.target.value)} onKeyDown={onKey} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label={tr('common.emailOrMobile')} />
              </div>
              <div className="pl-field"><span className="pl-lead"><IconLock /></span>
                <input className="pl-input" style={{ paddingRight: 48 }} type={showPw ? 'text' : 'password'} placeholder={tr('common.password')} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onKey} autoComplete="current-password" aria-label={tr('common.password')} />
                <button type="button" className="pl-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}><IconEye open={showPw} /></button>
              </div>
              {mfaNeeded ? (
                <div className="pl-field"><span className="pl-lead"><IconShield /></span>
                  <input className="pl-input" inputMode="numeric" maxLength={6} placeholder={tr('pay.login.codePlaceholder')} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={onKey} aria-label={tr('common.verificationCode')} />
                </div>
              ) : null}

              <div className="pl-row">
                <label className="pl-remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span className="pl-check">{remember ? <IconCheck /> : null}</span>
                  Remember Me
                </label>
                <button type="button" className="pl-forgot" onClick={() => { setMode('forgot'); setErr(null); }}>{tr('common.forgotPassword')}</button>
              </div>

              <button className="pl-btn" disabled={busy || !identifier.trim() || !password || (needSalon && !salonCode.trim())} onClick={submit}>{busy ? 'Signing in…' : 'Sign In'}</button>

              {fid !== 'none' ? (
                <>
                  <div className="pl-or">{tr('pay.login.or')}</div>
                  <button type="button" className="pl-btn pl-btn--ghost" disabled={fidBusy} onClick={faceIdSignIn}><IconFaceId />{fidBusy ? 'Checking…' : 'Sign in with Face ID'}</button>
                </>
              ) : null}

              <div className="pl-panel">
                <div className="pl-panel__h">{tr('pay.login.experience')}</div>
                <div className="pl-panel__grid">
                  <div className="pl-feat"><IconContactless /><div className="pl-feat__t">{tr('pay.login.ready')}</div></div>
                  <div className="pl-feat"><IconTimer /><div className="pl-feat__t">{tr('pay.login.fast')}</div></div>
                  <div className="pl-feat"><IconShieldLock /><div className="pl-feat__t">{tr('pay.login.secureTx')}</div></div>
                </div>
                {!tapCapable ? <div className="pl-panel__note">Tap to Pay readiness is confirmed after sign-in on a registered, supported device.</div> : null}
              </div>

              <div className="pl-foot"><IconShield />{tr('pay.login.secureOnly')}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
