import { useEffect, useState } from 'react';
import { OwnerForgotPasswordScreen } from './OwnerForgotPasswordScreen';
import { saveNativeSession, useT } from '@aipowersalon/mobile-sdk';
import '../i18n/catalog';   // this app's EN / VI strings (registered on import, so tests and screens see them)
import { authApi } from '../api/authApi';
import { ownerPublicApi } from '../api/ownerPublicApi';
import { useAuth } from '../auth/AuthContext';
// REUSED, not rebuilt. Face ID is the SAME implementation the tech app uses (native biometrics + Keychain on iOS,
// WebAuthn in a browser), talking to the SAME backend verifier. The rule is enforced by the server, not here:
// a biometric success is not authentication — the unlocked token is revalidated against /auth/me, so an owner who
// was suspended or whose session was revoked gets nothing, face or no face.
import { faceIdMode, signInWithFaceId, type FaceIdMode } from '@aipowersalon/mobile-sdk';

/*
 * Owner sign in — the 'owner' portal. Backend resolves the owner GLOBALLY by email/phone (owners have several
 * salons and therefore no single salon code); only role='OWNER' rows can be found, so no other role can enter here.
 * The session opens at the owner's PRIMARY salon; multi-salon owners switch afterwards via the existing SalonSwitcher
 * in OwnerLayout — no logout, no second account. Matches the reference design on the --owner-* system.
 *
 * "Owner Access Code" is an OPTIONAL second factor. It is sent to the backend and validated SERVER-side (never on
 * the client), and only enforced for an owner who has one configured — owners without one sign in with just
 * email/phone + password, exactly as before.
 */

// ── inline gold icons (currentColor); owner-web uses inline SVG, so no icon dependency is added ──
const IconUser = (p: { className?: string }) => (<svg className={p.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" /></svg>);
const IconLock = (p: { className?: string }) => (<svg className={p.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>);
const IconBuilding = (p: { className?: string }) => (<svg className={p.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="1.5" /><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 20v-3h4v3" /></svg>);
const IconShieldTrail = (p: { className?: string }) => (<svg className={p.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5-4-1.2-7-5.1-7-9.5V6l7-3Z" /><path d="M9 12l2 2 4-4" /></svg>);
const IconEye = (p: { open: boolean }) => (p.open
  ? <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>
  : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 6.2A9 9 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-3.3 3.9M6.3 7.9A15 15 0 0 0 2.5 12S6 18 12 18a8.6 8.6 0 0 0 3.4-.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>);
const IconCheck = () => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>);
const IconHeadset = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 13v-1a8 8 0 0 1 16 0v1" /><rect x="3" y="13" width="4" height="6" rx="1.5" /><rect x="17" y="13" width="4" height="6" rx="1.5" /><path d="M20 19a4 4 0 0 1-4 4h-2" /></svg>);
const IconFaceId = () => (<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M9 10v1M15 10v1M12 9v4l-1 1" /><path d="M9 15c.9.8 1.9 1.2 3 1.2s2.1-.4 3-1.2" /></svg>);
const IconShield = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5-4-1.2-7-5.1-7-9.5V6l7-3Z" /><path d="M9 12l2 2 4-4" /></svg>);
const IconDashboardCard = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20V11M9.5 20V7M15 20v-5M20.5 20V4" /><path d="M3.5 9 8 5l4 3 7-5" /><path d="M16 3h3.5v3.5" /></svg>);
const IconBookingsCard = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9h17M8 3v3M16 3v3" /><path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" /></svg>);
const IconReportsCard = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9h-9Z" /><path d="M12 3v9h9a9 9 0 0 0-9-9Z" /></svg>);

export function LoginScreen() {
  const tr = useT();   // C6 §97 (Phase 13): EN / VI; every English key is today's text
  const { setPrincipal } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [accessCode, setAccessCode] = useState('');   // never persisted: a second factor kept in browser storage is no factor
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'forgot' | 'request'>('signin');
  const [fid, setFid] = useState<FaceIdMode>('none');
  const [fidBusy, setFidBusy] = useState(false);

  // Request Access / Contact Support form
  const [raBusiness, setRaBusiness] = useState('');
  const [raOwner, setRaOwner] = useState('');
  const [raPhone, setRaPhone] = useState('');
  const [raEmail, setRaEmail] = useState('');
  const [raMessage, setRaMessage] = useState('');
  const [raBusy, setRaBusy] = useState(false);
  const [raMsg, setRaMsg] = useState<string | null>(null);

  useEffect(() => { void faceIdMode().then(setFid).catch(() => setFid('none')); }, []);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const cleanIdentifier = identifier.trim();
      const cleanAccessCode = accessCode.trim();
      
      if (!cleanIdentifier || !password) { setErr('Please enter both identifier and password.'); setBusy(false); return; }

      const r = await authApi.login({
        portal: 'owner',
        identifier: cleanIdentifier,
        password,
        ownerAccessCode: cleanAccessCode || undefined,  // OPTIONAL; validated server-side, never here
        rememberMe: remember,
      });
      // NATIVE only: the server returns a token when (and only when) the request came from the native app. On the
      // web this is absent and nothing is stored — the httpOnly cookie does the work and stays out of JS.
      await saveNativeSession(r);   // access + refresh token (Constitution 3 Step 2b)
      if (r.principal) {
        setPrincipal(r.principal); 
        return; 
      }
      setErr(r.message || 'The login information is incorrect or you do not have owner access.');
    } catch (e: any) { setErr(e?.message || 'The login information is incorrect or you do not have owner access.'); }
    finally { setBusy(false); }
  };

  const faceIdSignIn = async () => {
    setErr(null); setFidBusy(true);
    try {
      const principal: any = await signInWithFaceId(async () => await authApi.me(), identifier.trim() || undefined);   // Phase 13 D: device credential → the server opens a fresh session
      if (principal) { setPrincipal(principal); return; }
      setErr('Face ID could not sign you in. Use your password.');
    } catch (e: any) {
      const m = String(e?.message ?? '');
      if (/cancel/i.test(m)) return;                // cancellation is not a failed login
      // Phase 13 D: the server refused the device credential (revoked, password changed, Face ID off) — it is wiped
      if (e?.reason === 'session_invalid') { setErr(m || 'Sign in with your password to turn Face ID back on.'); return; }
      if (e?.reason === 'not_enrolled' || /not enrolled|no credential|first to enable|no session|expired/i.test(m)) {
        setErr('Sign in with your password and Owner Access Code first, then enable Face ID under Profile \u2192 Security.');
        return;
      }
      setErr('Face ID is unavailable. Use your password.');
    } finally { setFidBusy(false); }
  };

  const handleShortcutClick = async (target: { tab?: string; pushed?: any }) => {
    try {
      if (target.tab) sessionStorage.setItem('aps_owner_target_tab', target.tab);
      if (target.pushed) sessionStorage.setItem('aps_owner_target_pushed', JSON.stringify(target.pushed));
    } catch { /* ignore */ }
    await faceIdSignIn();
  };

  const submitRequest = async () => {
    setRaBusy(true); setRaMsg(null);
    try {
      await ownerPublicApi.requestAccess({
        businessName: raBusiness.trim(), ownerName: raOwner.trim(),
        phone: raPhone.trim(), email: raEmail.trim(), message: raMessage.trim(),
      });
      setRaMsg(tr('owner.login.requestSubmitted'));
    } catch (e: any) { setRaMsg(e?.message || 'Could not send your request. Please check your details and try again.'); }
    finally { setRaBusy(false); }
  };

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void submit(); };

  // Forgot password reuses the existing full-screen owner reset flow.
  if (mode === 'forgot') return <OwnerForgotPasswordScreen onBack={() => setMode('signin')} />;

  return (
    <div className="o-login">
      <div className="o-login__marble" aria-hidden="true" />
      <div className="o-login__scroll">
        <div className="o-login__inner">
          <header style={{ textAlign: 'center', marginBottom: 6 }}>
            {/* OFFICIAL logo asset — not a redraw */}
            <img className="ol-logo" src="/brand/aipowersalon-logo.png" alt="AI PowerSalon" width={175} draggable={false} style={{ mixBlendMode: 'multiply' }} />
            <div className="ol-brandlabel">{tr('owner.login.appName')}</div>
            {mode === 'request'
              ? <div className="ol-sub" role="status">{tr('owner.login.requestAccess')}</div>
              : (<>
                  <h1 className="ol-welcome">{tr('common.welcomeBack')}</h1>
                  <p className="ol-sub">{tr('owner.login.subtitle')}</p>
                </>)}
          </header>

          {err && mode === 'signin' ? <div className="ol-err" role="alert">{err}</div> : null}

          {mode === 'request' ? (
            <div className="ol-form">
              {/* developer merge (Oct 23 2026): say where the request goes (public lead intake → Super Admin Website Leads) */}
              <div style={{ background: 'rgba(197, 138, 46, 0.08)', border: '1px solid var(--owner-border)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: 'var(--owner-text)', textAlign: 'center', marginBottom: 4 }}>
                {tr('owner.login.routedToSa')}
              </div>
              {raMsg ? <div className="ol-note" role="status">{raMsg}</div> : null}
              <div className="ol-field"><IconBuilding className="ol-lead" /><input className="ol-input" placeholder={tr('owner.login.businessName')} value={raBusiness} onChange={(e) => setRaBusiness(e.target.value)} aria-label={tr('owner.login.businessName')} /></div>
              <div className="ol-field"><IconUser className="ol-lead" /><input className="ol-input" placeholder={tr('owner.login.yourName')} value={raOwner} onChange={(e) => setRaOwner(e.target.value)} aria-label={tr('owner.login.yourName')} /></div>
              <div className="ol-field"><IconUser className="ol-lead" /><input className="ol-input" placeholder={tr('owner.login.phone')} value={raPhone} onChange={(e) => setRaPhone(e.target.value)} inputMode="tel" autoComplete="tel" aria-label={tr('owner.login.phone')} /></div>
              <div className="ol-field"><IconUser className="ol-lead" /><input className="ol-input" placeholder={tr('owner.login.email')} value={raEmail} onChange={(e) => setRaEmail(e.target.value)} inputMode="email" autoComplete="email" aria-label={tr('owner.login.email')} /></div>
              <div className="ol-field"><textarea className="ol-input" style={{ height: 96, paddingTop: 12, resize: 'none' }} placeholder={tr('owner.login.howHelp')} value={raMessage} onChange={(e) => setRaMessage(e.target.value)} aria-label={tr('owner.login.message')} /></div>
              <button className="ol-btn" disabled={raBusy || (!raEmail.trim() && !raPhone.trim())} onClick={submitRequest}>{raBusy ? 'Sending\u2026' : tr('owner.login.submitToSa')}</button>
              <button className="ol-btn ol-btn--ghost" disabled={raBusy} onClick={() => { setMode('signin'); setRaMsg(null); }}>{tr('common.backToSignIn')}</button>
            </div>
          ) : (
            <div className="ol-form">
              <div className="ol-field">
                <IconUser className="ol-lead" />
                <input className="ol-input" placeholder={tr('common.emailOrMobile')} value={identifier} onChange={(e) => setIdentifier(e.target.value)} onKeyDown={onKey} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label={tr('common.emailOrMobile')} />
              </div>
              <div className="ol-field">
                <IconLock className="ol-lead" />
                <input className="ol-input" style={{ paddingRight: 48 }} type={showPw ? 'text' : 'password'} placeholder={tr('common.password')} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onKey} autoComplete="current-password" aria-label={tr('common.password')} />
                <button type="button" className="ol-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}><IconEye open={showPw} /></button>
              </div>
              <div className="ol-field">
                <IconBuilding className="ol-lead" />
                <input className="ol-input" style={{ paddingRight: 44 }} placeholder={tr('owner.login.accessCode')} value={accessCode} onChange={(e) => setAccessCode(e.target.value)} onKeyDown={onKey} autoComplete="off" autoCapitalize="characters" aria-label={tr('owner.login.accessCode')} />
                <IconShieldTrail className="ol-trail" />
              </div>

              <div className="ol-row">
                <label className="ol-remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span className="ol-check">{remember ? <IconCheck /> : null}</span>
                  Remember Me
                </label>
                <button type="button" className="ol-forgot" onClick={() => setMode('forgot')}>{tr('common.forgotPassword')}</button>
              </div>

              <button className="ol-btn" disabled={busy || !identifier.trim() || !password} onClick={submit}>
                <IconLock />
                {busy ? 'Signing in\u2026' : 'Sign In'}
              </button>

              <button className="ol-btn ol-btn--ghost" onClick={() => { setMode('request'); setErr(null); }}>
                <IconHeadset />
                Request Access / Contact Support
              </button>

              {/* Face ID is only offered when the platform can ACTUALLY do it. */}
              {fid !== 'none' ? (<>
                <div className="ol-or">OR</div>
                <button className="ol-btn ol-btn--ghost" disabled={fidBusy} onClick={faceIdSignIn}>
                  <IconFaceId />
                  {fidBusy ? 'Verifying\u2026' : 'Sign In with Face ID'}
                </button>
              </>) : null}

              {/* Manage. Grow. Succeed. */}
              <div className="ol-tools">
                <div className="ol-tools__h">{tr('owner.login.slogan')}</div>
                <div className="ol-cards">
                  <div
                    className="ol-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleShortcutClick({ tab: 'home' })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleShortcutClick({ tab: 'home' }); }}
                    aria-label="Open Dashboard with Face ID"
                  >
                    <IconDashboardCard />
                    <div className="ol-card__t">{tr('owner.login.dashboard')}</div>
                    <div className="ol-card__d">Overview &amp; KPIs</div>
                  </div>

                  <div
                    className="ol-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleShortcutClick({ pushed: { kind: 'bookings' } })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleShortcutClick({ pushed: { kind: 'bookings' } }); }}
                    aria-label="Open Bookings with Face ID"
                  >
                    <IconBookingsCard />
                    <div className="ol-card__t">{tr('owner.login.bookings')}</div>
                    <div className="ol-card__d">{tr('owner.login.manageAppointments')}</div>
                  </div>

                  <div
                    className="ol-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleShortcutClick({ tab: 'reports' })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleShortcutClick({ tab: 'reports' }); }}
                    aria-label="Open Reports with Face ID"
                  >
                    <IconReportsCard />
                    <div className="ol-card__t">{tr('nav.reports')}</div>
                    <div className="ol-card__d">Insights &amp; Analytics</div>
                  </div>
                </div>
              </div>

              <div className="ol-footer">
                <div className="ol-footer__row"><IconShield />{tr('owner.login.secureOnly')}</div>
                <div className="ol-footer__sub">{tr('common.dataProtected')}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
