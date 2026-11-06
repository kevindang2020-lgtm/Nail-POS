import { useEffect, useState } from 'react';
import { saveNativeToken, tokenFromResponse } from '../auth/native-auth';
import { saveNativeRefreshToken } from '@aipowersalon/mobile-sdk';
import { authApi, type BranchOption } from '../api/authApi';
import { useAuth } from '../auth/AuthContext';
import logoImage from '../brand/techlogo.png';
// REUSED, not rebuilt. The platform already has a complete Face ID implementation (native biometrics + Keychain on
// iOS, WebAuthn in a browser) with the right rule baked in and stated in its own header:
//
//     "a biometric success is not authentication"
//
// The native path revalidates the unlocked token against the backend; the WebAuthn path has its signature verified
// server-side. NEITHER can mint a session on the client — so a stolen phone with a spoofed face still gets nothing
// unless the server agrees the technician is active, employed, and assigned to this salon.
//
// Building a second biometric system here would have meant a second set of those rules, and the weaker one would
// have been the one an attacker used.
import { faceIdMode, signInWithFaceId, type FaceIdMode } from '../auth/faceid';

/*
 * Technician sign in — tenant portal.
 *
 * VISUAL: matches the reference login image using the app's own champagne-gold mobile system (--tech-* tokens +
 * the .tech-login CSS in styles.css): ivory marble + fine gold veins, gold field icons, a gold-gradient Sign In,
 * a gold square Remember Me box, and iPhone safe-area insets. Nothing here is a mockup — every control drives the
 * real flow below.
 *
 * FLOW: salon code + email/phone + password (+ 6-digit code when MFA is required). On BRANCH_SELECTION_REQUIRED the
 * session is already authenticated but branchless; we fetch /auth/branches and let the tech pick one, which
 * finalizes the session via /auth/select-branch.
 *
 * The "Salon code" field is kept ON PURPOSE even though the reference image shows only two fields: this is a
 * multi-tenant platform and the tenant portal resolves the tenant from the salon code server-side. Removing it
 * would break tenant resolution, so correctness wins over a pixel-perfect field count. It is styled to match.
 */

// ── inline gold icons (currentColor); tech-web uses inline SVG everywhere, so no icon dependency is added ──
const IconUser = (p: { className?: string }) => (
  <svg className={p.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" /></svg>
);
const IconLock = (p: { className?: string }) => (
  <svg className={p.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
);
const IconStore = (p: { className?: string }) => (
  <svg className={p.className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8.5" /><path d="M3.5 10.5 5 4.5h14l1.5 6a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0Z" /></svg>
);
const IconEye = (p: { open: boolean }) => (
  p.open
    ? <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>
    : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 6.2A9 9 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-3.3 3.9M6.3 7.9A15 15 0 0 0 2.5 12S6 18 12 18a8.6 8.6 0 0 0 3.4-.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
);
const IconFaceId = (p: { className?: string }) => (
  <svg className={p.className} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M9 10v1M15 10v1M12 9v4l-1 1" /><path d="M9 15c.9.8 1.9 1.2 3 1.2s2.1-.4 3-1.2" /></svg>
);
const IconCheck = () => (<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>);
const IconShield = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5-4-1.2-7-5.1-7-9.5V6l7-3Z" /><path d="M9 12l2 2 4-4" /></svg>);
const IconScheduleCard = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 3v3M16 3v3" /><circle cx="15.5" cy="14.5" r="3" /><path d="M15.5 13v1.6l1 .8" /></svg>);
const IconQueueCard = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><circle cx="17" cy="9" r="2.4" /><path d="M15 14.2c2.5.3 4.5 2.2 4.5 4.8" /></svg>);
const IconEarningsCard = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20V10M9 20V6M14 20v-5" /><path d="M3.5 9 9 5l4 3 6.5-5" /><path d="M16 3h3.5V6.5" /><circle cx="18.5" cy="18" r="3" /><path d="M18.5 16.6v2.8M17.6 17.2h1.4a.7.7 0 0 1 0 1.4h-1a.7.7 0 0 0 0 1.4h1.4" /></svg>);

export function LoginScreen() {
  const { setPrincipal } = useAuth();
  const [salonCode, setSalonCode] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage ? (localStorage.getItem('aps_last_tech_salon') || '') : '';
    } catch {
      return '';
    }
  });
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [branchStep, setBranchStep] = useState(false);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [resetPhone, setResetPhone] = useState('');
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [fid, setFid] = useState<FaceIdMode>('none');
  const [fidBusy, setFidBusy] = useState(false);

  useEffect(() => { void faceIdMode().then(setFid).catch(() => setFid('none')); }, []);

  /**
   * Face ID sign-in. The biometric only UNLOCKS a device-bound credential, which is then exchanged with the server;
   * `authApi.me()` IS the revalidation — the server re-checks that the technician is still active, still employed,
   * and still assigned to this salon. A technician who left last week still has their face; they do not still have a
   * session.
   */
  const faceIdSignIn = async () => {
    setErr(null); setFidBusy(true);
    try {
      const cleanSalonCode = salonCode.trim();
      if (!cleanSalonCode) {
        setErr('Salon code is required.');
        setFidBusy(false);
        return;
      }
      if (cleanSalonCode) {
        try {
          if (typeof localStorage !== 'undefined' && localStorage) {
            localStorage.setItem('aps_last_tech_salon', cleanSalonCode);
          }
        } catch { /* ignore */ }
      }
      const principal: any = await signInWithFaceId(
        async () => await authApi.me(),
        cleanSalonCode
      );
      if (principal && principal.__outcome === 'MFA_REQUIRED') {
        setMfaNeeded(true); setErr('Enter your 6-digit verification code to continue.'); return;
      }
      if (principal && (principal.__outcome === 'BRANCH_SELECTION_REQUIRED' || principal.needsBranchSelection)) {
        await loadBranches(); return;
      }
      if (principal) { setPrincipal(principal); return; }
      setErr('Face ID could not sign you in. Use your password.');
    } catch (e: any) {
      // A CANCELLED biometric is not a failed login and must not be shown as one.
      const m = String(e?.message ?? '');
      if (/cancel/i.test(m)) return;
      if (e?.reason === 'not_enrolled' || e?.reason === 'session_invalid' || /not enrolled|no credential|first to enable|no session|expired/i.test(m)) {
        setErr('Sign in with your password and salon code first, then enable Face ID under Profile \u2192 Security.');
        return;
      }
      setErr('Face ID is unavailable. Use your password.');
    } finally { setFidBusy(false); }
  };

  const handleShortcutClick = async (target: { tab?: string; pushed?: any }) => {
    const cleanSalonCode = salonCode.trim();
    if (!cleanSalonCode) {
      setErr('Salon code is required to access shortcuts.');
      return;
    }
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage) {
        if (target.tab) sessionStorage.setItem('aps_tech_target_tab', target.tab);
        if (target.pushed) sessionStorage.setItem('aps_tech_target_pushed', JSON.stringify(target.pushed));
      }
    } catch { /* ignore */ }
    await faceIdSignIn();
  };

  const requestReset = async () => {
    setResetBusy(true); setResetMsg(null);
    try {
      await authApi.requestPasswordReset(salonCode.trim(), resetPhone.trim());
      setResetMsg('If an account exists for that salon code and phone, we\u2019ve sent password reset instructions.');
    } catch (e: any) { setResetMsg(e?.message || 'Could not send reset instructions.'); }
    finally { setResetBusy(false); }
  };

  const loadBranches = async () => {
    setErr(null);
    try {
      const r = await authApi.branches();
      const active = (r.branches || []).filter((b) => b.isActive);
      if (active.length > 0) {
        return pickBranch(active[0].id);
      }
      setBranches(active); setBranchStep(true);
      if (active.length === 0) setErr('No active branches for this account. Contact your manager.');
    } catch (e: any) { setErr(e?.message || 'Could not load branches.'); }
  };

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      // Trim/normalize before submission (spec §4). The server normalizes again; this just avoids surprising the
      // technician with a "wrong" login caused by a trailing space their keyboard inserted.

      const cleanSalonCode = salonCode.trim();
      const cleanIdentifier = identifier.trim();

      if (!cleanSalonCode) {
        setErr('Salon code is required.');
        setBusy(false);
        return;
      }
      if (!cleanIdentifier || !password) {
        setErr('Please enter both identifier and password.');
        setBusy(false);
        return;
      }

      if (cleanSalonCode) {
        try {
          if (typeof localStorage !== 'undefined' && localStorage) {
            localStorage.setItem('aps_last_tech_salon', cleanSalonCode);
          }
        } catch { /* ignore */ }
      }

      const r = await authApi.login({
        portal: 'tenant',
        salonCode: cleanSalonCode,
        identifier: cleanIdentifier,
        password,
        rememberMe: remember,                 // FIX: "Remember Me" now actually selects the server's extended session TTL
        ...(mfaNeeded ? { mfaCode: mfaCode.trim() } : {}),
      });
      await saveNativeRefreshToken((r as any)?.refreshToken);   // native only (the web never gets it): renews the 15-minute access token
      // NATIVE only: the server returns a token when (and only when) the request came from the native app. On the
      // web this is absent and nothing is stored — the httpOnly cookie does the work and stays out of JS.
      await saveNativeToken(tokenFromResponse(r));
      if (r.outcome === 'SUCCESS' && r.principal) {
        setPrincipal(r.principal);
        return;
      }
      if (r.outcome === 'MFA_REQUIRED') { setMfaNeeded(true); setErr('Enter your 6-digit verification code to continue.'); return; }
      if (r.outcome === 'BRANCH_SELECTION_REQUIRED') { await loadBranches(); return; }
      setErr(r.message || 'The login information is incorrect or you do not have technician access.');
    } catch (e: any) { setErr(e?.message || 'The login information is incorrect or you do not have technician access.'); }
    finally { setBusy(false); }
  };

  const pickBranch = async (bid: string) => {
    setErr(null); setPicking(bid);
    try {
      const r = await authApi.selectBranch(bid);
      // FIX: a branch-scoped token is issued here too — persist it on native so the session survives an app relaunch
      // (previously only the branchless login token was saved).
      await saveNativeToken(tokenFromResponse(r));
      if (r.principal) {
        setPrincipal(r.principal);
        return;
      }
      setErr('Could not select that branch.');
    } catch (e: any) { setErr(e?.message || 'Could not select that branch.'); }
    finally { setPicking(null); }
  };

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void submit(); };

  const headerSub = branchStep ? 'Select your branch'
    : mode === 'reset' ? 'Reset your password'
      : 'Manage your appointments, clients, schedule, and earnings with confidence.';

  return (
    <div className="tech-login">
      <div className="tech-login__marble" aria-hidden="true" />
      <div className="tech-login__scroll">
        <div className="tech-login__inner">
          {/* ── header / branding — the OFFICIAL logo asset, not a redraw ── */}
          <header style={{ textAlign: 'center', marginBottom: 6 }}>
            <img className="tl-logo" src={logoImage} alt="AI PowerSalon" width={200} draggable={false} style={{ mixBlendMode: 'multiply' }} />
            <div className="tl-tech-label">TECHNICIAN APP</div>
            {branchStep || mode === 'reset'
              ? <div className="tl-sub" role="status">{headerSub}</div>
              : (<>
                <h1 className="tl-welcome">Welcome Back</h1>
                <p className="tl-sub">{headerSub}</p>
              </>)}
          </header>

          {err ? <div className="tl-err" role="alert">{err}</div> : null}

          {/* ── branch picker (multi-salon technician) ── */}
          {branchStep ? (
            <div className="tl-form">
              {branches.map((b) => (
                <button key={b.id} className="tl-pick" disabled={!!picking} onClick={() => pickBranch(b.id)}>
                  <span>{b.name || b.id}{b.city ? <span className="tech-muted" style={{ fontSize: 12 }}> · {b.city}</span> : null}</span>
                  <span className="tech-muted" style={{ fontSize: 12 }}>{picking === b.id ? 'Selecting\u2026' : 'Select'}</span>
                </button>
              ))}
              <button className="tl-btn tl-btn--ghost" disabled={!!picking} onClick={() => { setBranchStep(false); setBranches([]); setErr(null); }}>Back</button>
            </div>

            /* ── forgot-password ── */
          ) : mode === 'reset' ? (
            <div className="tl-form">
              {resetMsg ? <div className="tl-note" role="status">{resetMsg}</div> : null}
              <div className="tl-field">
                <IconStore className="tl-lead" />
                <input className="tl-input" placeholder="Salon code" value={salonCode} onChange={(e) => setSalonCode(e.target.value)} autoComplete="off" aria-label="Salon code" />
              </div>
              <div className="tl-field">
                <IconUser className="tl-lead" />
                <input className="tl-input" placeholder="Mobile number" value={resetPhone} onChange={(e) => setResetPhone(e.target.value)} inputMode="tel" autoComplete="tel" aria-label="Mobile number" />
              </div>
              <button className="tl-btn" disabled={resetBusy || !salonCode.trim() || !resetPhone.trim()} onClick={requestReset}>{resetBusy ? 'Sending\u2026' : 'Send reset instructions'}</button>
              <button className="tl-btn tl-btn--ghost" disabled={resetBusy} onClick={() => { setMode('signin'); setResetMsg(null); setErr(null); }}>Back to sign in</button>
            </div>

            /* ── sign in ── */
          ) : (
            <div className="tl-form">
              <div className="tl-field">
                <IconStore className="tl-lead" />
                <input className="tl-input" placeholder="Salon code" value={salonCode} onChange={(e) => setSalonCode(e.target.value)} onKeyDown={onKey} autoComplete="off" autoCapitalize="characters" aria-label="Salon code" />
              </div>
              <div className="tl-field">
                <IconUser className="tl-lead" />
                <input className="tl-input" placeholder="Email or Mobile Number" value={identifier} onChange={(e) => setIdentifier(e.target.value)} onKeyDown={onKey} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Email or Mobile Number" />
              </div>
              <div className="tl-field">
                <IconLock className="tl-lead" />
                <input
                  className="tl-input" style={{ paddingRight: 48 }}
                  type={showPw ? 'text' : 'password'} placeholder="Password" value={password}
                  onChange={(e) => setPassword(e.target.value)} onKeyDown={onKey}
                  autoComplete="current-password" aria-label="Password"
                />
                <button type="button" className="tl-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                  <IconEye open={showPw} />
                </button>
              </div>

              {mfaNeeded ? (
                <div className="tl-field">
                  <IconLock className="tl-lead" />
                  <input className="tl-input" placeholder="6-digit verification code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} onKeyDown={onKey} inputMode="numeric" autoComplete="one-time-code" aria-label="Verification code" />
                </div>
              ) : null}

              <div className="tl-row">
                <label className="tl-remember">
                  {/* Remember Me selects the SESSION policy; it never stores the password. The token lives in the
                      platform's secure store (Keychain on native), which is what native-auth already does. */}
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span className="tl-check">{remember ? <IconCheck /> : null}</span>
                  Remember Me
                </label>
                <button type="button" className="tl-forgot" onClick={() => { setMode('reset'); setErr(null); setResetMsg(null); }}>Forgot Password?</button>
              </div>

              <button className="tl-btn" disabled={busy || !salonCode.trim() || !identifier.trim() || !password} onClick={submit}>
                <IconLock className="" />
                {busy ? 'Signing in\u2026' : mfaNeeded ? 'Verify & Sign In' : 'Sign In'}
              </button>

              {/* Only offered when the platform can ACTUALLY do it — a button that always appears and always fails
                  teaches people the feature is broken. */}
              {fid !== 'none' ? (
                <button className="tl-btn tl-btn--ghost" disabled={fidBusy || !salonCode.trim()} onClick={faceIdSignIn}>
                  <IconFaceId />
                  {fidBusy ? 'Verifying\u2026' : 'Sign In with Face ID'}
                </button>
              ) : null}

              {/* ── Your Tools. Your Day. Your Success. ── */}
              <div className="tl-tools">
                <div className="tl-tools__h">Your Tools. Your Day. Your Success.</div>
                <div className="tl-cards">
                  <div className="tl-card" role="button" tabIndex={0} onClick={() => handleShortcutClick({ tab: 'schedule' })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleShortcutClick({ tab: 'schedule' }); }} aria-label="Open Today's Schedule with Face ID"><IconScheduleCard /><div className="tl-card__t">Today&rsquo;s Schedule</div><div className="tl-card__d">View &amp; manage your bookings</div></div>
                  <div className="tl-card" role="button" tabIndex={0} onClick={() => handleShortcutClick({ tab: 'home', pushed: { kind: 'queue' } })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleShortcutClick({ tab: 'home', pushed: { kind: 'queue' } }); }} aria-label="Open Client Queue with Face ID"><IconQueueCard /><div className="tl-card__t">Client Queue</div><div className="tl-card__d">See upcoming clients &amp; status</div></div>
                  <div className="tl-card" role="button" tabIndex={0} onClick={() => handleShortcutClick({ tab: 'earnings' })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleShortcutClick({ tab: 'earnings' }); }} aria-label="Open Earnings with Face ID"><IconEarningsCard /><div className="tl-card__t">Earnings</div><div className="tl-card__d">Track performance &amp; commissions</div></div>
                </div>
              </div>

              {/* The footer claims a security property, so it must be TRUE: the session is httpOnly-cookie or
                  Keychain-bound, the biometric cannot mint a session, and the server re-checks employment on every
                  sign-in. We do not claim controls the platform does not actually implement. */}
              <div className="tl-footer">
                <div className="tl-footer__row"><IconShield />Secure technician access only</div>
                <div className="tl-footer__sub">Your data is protected with enterprise-grade security.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
