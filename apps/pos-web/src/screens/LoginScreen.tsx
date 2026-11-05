import { useState } from 'react';
import { authApi, type BranchOption } from '../api/authApi';
import { useAuth } from '../auth/AuthContext';


// Tenant (staff) POS login. SAME AUTH CONTRACT AS BEFORE — this is a redesign of the existing screen, not a
// second auth system: it still POSTs /auth/login with portal 'tenant' + salonCode (the "Store Code") +
// identifier + password, and still handles MFA_REQUIRED and BRANCH_SELECTION_REQUIRED exactly as before.
// Tenant, branch and role are derived SERVER-SIDE from the verified store record; nothing here is identity.
//
// The salon scene on the left is built from CSS gradients + inline SVG (marble wash, gold curves) because the
// repo ships no licensed salon photograph — an unlicensed stock image must not be embedded.

const GOLD = 'var(--brand-gold, #A96F22)';
const GOLD_DEEP = 'var(--brand-deep-gold, #84561A)';
const GOLD_BRONZE = 'var(--brand-bronze, #C9971B)';
const LINE = 'var(--brand-border, #E7DCC9)';
const TEXT = 'var(--brand-text, #2A2118)';
const MUTED = 'var(--brand-text-muted, #8A7A66)';
const SERIF = 'var(--brand-font-head, Georgia, "Times New Roman", serif)';
const LOGO = '/brand/aipowersalon-logo.png';
const bgImage = '/brand/newloaginimg.png';
// Optional licensed salon photograph. The repo ships none (and an unlicensed stock image must not be embedded),
// so the scene below renders a CSS/SVG marble composition by default. Drop a licensed photo at this path and it
// is used automatically — no code change. If the file is absent the <img> fails to load and we fall back.
const SALON_PHOTO = '/brand/salon-interior.jpg';
const MAIN_LOGO = '/brand/AI_PowerSalon_POS.png'

const BENEFITS = [
  { key: 'checkin', title: 'Fast Check-In', desc: 'Speed up client arrival with intelligent check-in.' },
  { key: 'booking', title: 'Smart Booking', desc: 'Manage appointments with real-time availability.' },
  { key: 'checkout', title: 'Seamless Checkout', desc: 'Process payments quickly and securely.' },
] as const;

function BenefitIcon({ kind }: { kind: string }) {
  const c = { width: 34, height: 34, viewBox: '0 0 24 24', fill: 'none', stroke: GOLD, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (kind === 'checkin') return (<svg {...c}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2" /><path d="M9 2h6" /><path d="M18.5 5.5 20 4" /></svg>);
  if (kind === 'booking') return (<svg {...c}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><circle cx="8.5" cy="14.5" r="1" fill={GOLD} stroke="none" /><circle cx="12" cy="14.5" r="1" fill={GOLD} stroke="none" /><circle cx="15.5" cy="14.5" r="1" fill={GOLD} stroke="none" /></svg>);
  return (<svg {...c}><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.2L21 7H6" /></svg>);
}

function Wordmark({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  const big = size === 'lg';
  return (
    <div style={{ textAlign: 'center' }} >
      <img className={big ? "mt-10" : "mt-0"} src={MAIN_LOGO} alt="AI PowerSalon" width={big ? 300 : 200}
        style={{ width: big ? 300 : 200, height: 'auto', display: 'block', margin: '0 auto' }} draggable={false} />
      {/* <div style={{ fontFamily: SERIF, color: TEXT, fontSize: big ? 52 : 24, letterSpacing: big ? '.10em' : '.07em', marginTop: big ? 16 : 6, whiteSpace: 'nowrap', fontWeight: 500 }}>
        <span style={{ color: GOLD }}>AI</span>
        <span style={{ color: LINE, margin: '0 .32em', fontWeight: 300 }}>|</span>
        POWERSALON
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginTop: big ? 14 : 5 }}>
        <span style={{ height: 1, width: big ? 44 : 22, background: LINE }} />
        <span style={{ fontSize: big ? 13 : 9.5, letterSpacing: '.19em', color: GOLD_DEEP, fontWeight: 600, whiteSpace: 'nowrap' }}>SMARTER SALON. STRONGER BUSINESS.</span>
        <span style={{ height: 1, width: big ? 44 : 22, background: LINE }} />
      </div> */}
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 };
const inputWrap: React.CSSProperties = { position: 'relative', display: 'flex', alignItems: 'center' };
const inputStyle: React.CSSProperties = { width: '100%', height: 46, borderRadius: 10, border: `1px solid ${LINE}`, background: '#FFFDF8', padding: '0 44px 0 42px', fontFamily: 'inherit', fontSize: 14.5, color: TEXT, boxShadow: 'inset 0 1px 2px rgba(42,33,24,.04)', outline: 'none' };
const iconLeft: React.CSSProperties = { position: 'absolute', left: 13, display: 'flex', pointerEvents: 'none' };
const errStyle: React.CSSProperties = { color: '#A63A2E', fontSize: 12.5, marginTop: 5 };

// Maps the backend's REAL login outcomes to a UI state. Two rules matter:
//  * INVALID_CREDENTIALS and TENANT_NOT_FOUND MUST render identically — otherwise the screen would disclose
//    whether a given store code exists, which is exactly what the security brief forbids.
//  * Account-access outcomes (suspended / cancelled / disabled / subscription) get a distinct, calm panel with a
//    support path, because the staff member can't fix those by retyping their password.
type LoginUiState =
  | { kind: 'error'; message: string }                          // generic, non-disclosing
  | { kind: 'locked'; message: string }                         // RATE_LIMITED
  | { kind: 'account'; message: string };                       // tenant/user/subscription blocked

const GENERIC = 'The login information is incorrect or you do not have access to this store.';
const ACCOUNT_OUTCOMES = new Set(['TENANT_SUSPENDED', 'TENANT_CANCELLED', 'USER_DISABLED', 'SUBSCRIPTION_BLOCKED', 'BRANCH_INACTIVE']);

export function outcomeToState(outcome: string | undefined, message?: string): LoginUiState {
  if (outcome === 'RATE_LIMITED') return { kind: 'locked', message: message || 'Too many sign-in attempts. Please try again shortly.' };
  if (outcome && ACCOUNT_OUTCOMES.has(outcome)) return { kind: 'account', message: message || 'This account cannot sign in right now.' };
  // INVALID_CREDENTIALS, TENANT_NOT_FOUND, UNKNOWN → the same generic message. Never disclose which failed.
  return { kind: 'error', message: GENERIC };
}

export function LoginScreen() {
  const { setPrincipal } = useAuth();
  const [salonCode, setSalonCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [err, setErr] = useState<LoginUiState | null>(null);
  const [fieldErr, setFieldErr] = useState<{ identifier?: string; password?: string; salonCode?: string }>({});
  const [busy, setBusy] = useState(false);
  const [branchStep, setBranchStep] = useState(false);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [picking, setPicking] = useState<string | null>(null);

  const loadBranches = async () => {
    setErr(null);
    try {
      const r = await authApi.branches();
      const active = (r.branches || []).filter((b) => b.isActive);
      setBranches(active);
      setBranchStep(true);
      if (active.length === 0) setErr({ kind: 'account', message: 'No active branches are available for this account. Contact your administrator.' });
    } catch (e: any) {
      setErr({ kind: 'error', message: e?.message || 'Could not load branches.' });
    }
  };

  const validate = () => {
    const fe: { identifier?: string; password?: string; salonCode?: string } = {};
    if (!identifier.trim()) fe.identifier = 'Enter your email or phone number.';
    if (!password) fe.password = 'Enter your password.';
    if (!salonCode.trim()) fe.salonCode = 'Enter your store code.';
    setFieldErr(fe);
    return Object.keys(fe).length === 0;
  };

  const submit = async () => {
    if (busy) return;
    setErr(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const r = await authApi.login({
        portal: 'tenant',
        salonCode: salonCode.trim(),
        identifier: identifier.trim(),
        password,
        rememberMe: remember,
        ...(mfaNeeded ? { mfaCode } : {}),
      });
      if (r.outcome === 'SUCCESS' && r.principal) { setPrincipal(r.principal); return; }
      if (r.outcome === 'MFA_REQUIRED') { setMfaNeeded(true); setErr({ kind: 'error', message: 'Enter your 6-digit verification code to continue.' }); return; }
      if (r.outcome === 'BRANCH_SELECTION_REQUIRED') { await loadBranches(); return; }
      setErr(outcomeToState(r.outcome, r.message));
    } catch (e: any) {
      const msg = e?.message || '';
      setErr(/network|fetch/i.test(msg)
        ? { kind: 'error', message: 'Unable to connect to AI PowerSalon. Please check your connection and try again.' }
        : outcomeToState(undefined, undefined));
    } finally { setBusy(false); }
  };

  const pickBranch = async (id: string) => {
    setErr(null); setPicking(id);
    try {
      const r = await authApi.selectBranch(id);
      if (r.principal) { setPrincipal(r.principal); return; }
      setErr({ kind: 'error', message: 'Could not select that branch.' });
    } catch (e: any) {
      setErr({ kind: 'error', message: e?.message || 'Could not select that branch.' });
    } finally { setPicking(null); }
  };

  const onSubmitForm = (e: React.FormEvent) => { e.preventDefault(); submit(); };

  return (
    <div className="aps-login" style={{ height: '100vh', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', background: `url(${bgImage}) center/cover fixed`, fontFamily: 'var(--brand-font-body, system-ui, sans-serif)' }}>
      <section className="aps-login-left justify-center" style={{ position: 'relative', display: 'flex', flexDirection: 'column', padding: '50px 56px', minWidth: 0 }}>
        <div style={{ position: 'relative', maxWidth: 440, margin: '0 auto', width: '100%' }}>
          <Wordmark size="lg" />
          <ul className="aps-features-list" style={{ position: 'relative', overflow: 'hidden', listStyle: 'none', padding: '10px 40px', margin: '0px auto 0', display: 'flex', flexDirection: 'column', borderRadius: 24, width: 'fit-content' }}>
            {BENEFITS.map((b, i) => (
              <li key={b.key} style={{ position: 'relative', zIndex: 1, display: 'flex', gap: 20, alignItems: 'center', padding: '18px 0', borderTop: i === 0 ? 'none' : '1px solid rgba(231,220,201,.9)' }}>
                <span style={{ flex: '0 0 auto', width: 64, height: 64, borderRadius: '50%', background: '#FFFFFF', border: `1px solid ${LINE}`, display: 'grid', placeItems: 'center', boxShadow: '0 6px 16px rgba(42,33,24,.06)' }}>
                  <BenefitIcon kind={b.key} />
                </span>
                <span>
                  <span className='font-semibold' style={{ display: 'block', fontFamily: SERIF, fontSize: 20, color: "#000000c5", marginBottom: 3 }}>{b.title}</span>
                  <span style={{ display: 'block', fontSize: 13.5, color: "#000000b7", lineHeight: 1.45, maxWidth: 250 }}>{b.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="aps-login-right" style={{ display: 'grid', placeItems: 'center', padding: '30px 40px', minWidth: 0 }}>
        <div style={{ width: '100%', maxWidth: 540, background: '#FFFDF8', border: `1px solid #9f6b28a6`, borderRadius: 28, boxShadow: '0 6px 35px 4px rgba(132, 86, 26, 0.40)', padding: '48px 48px 36px' }}>
          <Wordmark size="sm" />
          <h1 style={{ fontFamily: SERIF, fontSize: 40, color: TEXT, textAlign: 'center', margin: '6px 0 3px', fontWeight: 500 }}>
            {branchStep ? 'Select Your Branch' : 'Welcome Back'}
          </h1>
          <p style={{ textAlign: 'center', color: MUTED, fontSize: 14, margin: '0 0 18px' }}>
            {branchStep ? 'Choose the location you are signing in to' : 'Sign in to your POS system'}
          </p>

          {err ? (
            <div role="alert" style={{
              marginBottom: 13, padding: '11px 13px', borderRadius: 9, fontSize: 13.5,
              background: err.kind === 'error' ? '#FBEDE9' : '#FBF3DE',
              border: `1px solid ${err.kind === 'error' ? '#F0D2C9' : '#ECDCAE'}`,
              color: err.kind === 'error' ? '#8F3226' : '#7A5A12',
            }}>
              <div>{err.message}</div>
              {err.kind === 'locked' ? (
                <div style={{ marginTop: 6 }}>
                  <a href="/forgot-password" style={{ color: GOLD_DEEP, fontWeight: 600 }}>Reset your password</a>
                  <span style={{ color: MUTED }}> or </span>
                  <a href="https://aipowersalon.com/support" style={{ color: GOLD_DEEP, fontWeight: 600 }}>contact support</a>.
                </div>
              ) : null}
              {err.kind === 'account' ? (
                <div style={{ marginTop: 6 }}>
                  <a href="https://aipowersalon.com/support" style={{ color: GOLD_DEEP, fontWeight: 600 }}>Contact support</a>
                  <span style={{ color: MUTED }}> for help with account access.</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {branchStep ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {branches.map((b) => (
                <button key={b.id} type="button" disabled={!!picking} onClick={() => pickBranch(b.id)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 14px', borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', font: 'inherit', color: TEXT, cursor: 'pointer' }}>
                  <span>{b.name || b.id}{b.city ? <span style={{ color: MUTED, fontSize: 12 }}> · {b.city}</span> : null}</span>
                  <span style={{ color: GOLD, fontSize: 12.5, fontWeight: 600 }}>{picking === b.id ? 'Selecting…' : 'Select'}</span>
                </button>
              ))}
              <button type="button" disabled={!!picking} onClick={() => { setBranchStep(false); setBranches([]); setErr(null); }}
                style={{ marginTop: 4, padding: '11px 14px', borderRadius: 10, border: `1px solid ${LINE}`, background: 'transparent', font: 'inherit', color: MUTED, cursor: 'pointer' }}>Back</button>
            </div>
          ) : (
            <form onSubmit={onSubmitForm} noValidate>
              <div style={{ marginBottom: 13 }}>
                <label htmlFor="aps-identifier" style={labelStyle}>Email or Phone Number</label>
                <div style={inputWrap}>
                  <span style={iconLeft}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" aria-hidden><circle cx="12" cy="8" r="3.6" /><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" /></svg>
                  </span>
                  {/* The platform's login identifier is an email OR a phone number — phone IS the username.
                      Any format works ((856) 555-1234 / 856-555-1234 / +1 856 555 1234): the backend normalizes
                      to E.164 and matches users.normalized_phone. autoComplete="username" is the correct HTML
                      semantic for a login identifier field regardless of which form it takes. */}
                  <input id="aps-identifier" style={inputStyle} placeholder="Enter your email or phone number" value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false}
                    aria-invalid={!!fieldErr.identifier} aria-describedby={fieldErr.identifier ? 'err-identifier' : 'identifier-hint'} />
                </div>
                {fieldErr.identifier
                  ? <div id="err-identifier" style={errStyle}>{fieldErr.identifier}</div>
                  : <span id="identifier-hint" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Sign in with the email address or phone number your salon set up for you — either one works.</span>}
              </div>

              <div style={{ marginBottom: 13 }}>
                <label htmlFor="aps-password" style={labelStyle}>Password</label>
                <div style={inputWrap}>
                  <span style={iconLeft}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" aria-hidden><rect x="4.5" y="10" width="15" height="10" rx="2.2" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /><circle cx="12" cy="15" r="1.3" fill={GOLD} stroke="none" /></svg>
                  </span>
                  <input id="aps-password" style={inputStyle} type={showPw ? 'text' : 'password'} placeholder="Enter your password"
                    value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                    aria-invalid={!!fieldErr.password} aria-describedby={fieldErr.password ? 'err-password' : undefined} />
                  <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}
                    style={{ position: 'absolute', right: 8, width: 32, height: 32, display: 'grid', placeItems: 'center', border: 0, borderRadius: 8, background: 'transparent', cursor: 'pointer' }}>
                    {showPw ? (
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M3 3l18 18" /><path d="M10.6 10.7a2 2 0 0 0 2.8 2.8" /><path d="M6.7 6.9C4.6 8.2 3 10.3 2.5 12c1.2 3.2 5 6 9.5 6 1.6 0 3.1-.35 4.4-.95" /><path d="M9.9 6.2A9.9 9.9 0 0 1 12 6c4.5 0 8.3 2.8 9.5 6-.4 1.2-1.3 2.6-2.6 3.8" /></svg>
                    ) : (
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M2.5 12C3.7 8.8 7.5 6 12 6s8.3 2.8 9.5 6c-1.2 3.2-5 6-9.5 6s-8.3-2.8-9.5-6Z" /><circle cx="12" cy="12" r="2.6" /></svg>
                    )}
                  </button>
                </div>
                {fieldErr.password ? <div id="err-password" style={errStyle}>{fieldErr.password}</div> : null}
              </div>

              <div style={{ marginBottom: 13 }}>
                <label htmlFor="aps-store" style={labelStyle}>Store Code</label>
                <div style={inputWrap}>
                  <span style={iconLeft}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 9.5V20h16V9.5" /><path d="M3 5h18l1 4.2a2.6 2.6 0 0 1-5 .9 2.6 2.6 0 0 1-5 0 2.6 2.6 0 0 1-5 0 2.6 2.6 0 0 1-5-.9L3 5Z" /><rect x="10" y="14" width="4" height="6" /></svg>
                  </span>
                  <input id="aps-store" style={inputStyle} placeholder="Enter store code" value={salonCode}
                    onChange={(e) => setSalonCode(e.target.value)} autoComplete="organization" spellCheck={false}
                    aria-invalid={!!fieldErr.salonCode} aria-describedby={fieldErr.salonCode ? 'err-store' : undefined} />
                </div>
                {fieldErr.salonCode ? <div id="err-store" style={errStyle}>{fieldErr.salonCode}</div> : null}
              </div>

              {mfaNeeded ? (
                <div style={{ marginBottom: 13 }}>
                  <label htmlFor="aps-mfa" style={labelStyle}>Verification Code</label>
                  <input id="aps-mfa" style={{ ...inputStyle, padding: '0 14px', letterSpacing: '.3em', textAlign: 'center' }}
                    placeholder="6-digit code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)}
                    inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
                </div>
              ) : null}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: TEXT, cursor: 'pointer' }}>
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: '#A96F22', cursor: 'pointer' }} />
                  Remember me
                </label>
                <a href="/forgot-password" style={{ fontSize: 13.5, color: GOLD, textDecoration: 'none', fontWeight: 500 }}>Forgot password?</a>
              </div>

              <button type="submit" disabled={busy}
                style={{
                  width: '100%', height: 50, borderRadius: 11, border: 'none', cursor: busy ? 'default' : 'pointer',
                  background: busy ? '#D6C097' : `linear-gradient(180deg, ${GOLD_BRONZE} 0%, ${GOLD} 55%, ${GOLD_DEEP} 100%)`,
                  color: '#FFFDF8', fontSize: 16.5, fontFamily: SERIF, letterSpacing: '.02em',
                  boxShadow: busy ? 'none' : '0 8px 20px rgba(169,111,34,.28)'
                }}>
                {busy ? 'Signing in…' : mfaNeeded ? 'Verify & Sign In' : 'Sign In'}
              </button>

              <a href="https://aipowersalon.com/support"
                style={{ marginTop: 11, height: 47, borderRadius: 11, border: `1px solid ${GOLD}`, background: '#FFFFFF', color: GOLD_DEEP, fontSize: 14.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, textDecoration: 'none', fontWeight: 500 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M4 13v-1a8 8 0 0 1 16 0v1" /><rect x="2.5" y="13" width="4" height="6" rx="1.6" /><rect x="17.5" y="13" width="4" height="6" rx="1.6" /><path d="M19.5 19v.6a2.4 2.4 0 0 1-2.4 2.4H13" /></svg>
                Need Help? Contact Support
              </a>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 }}>
                <span style={{ flex: 1, height: 1, background: LINE }} />
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M12 2.8 19 6v5.5c0 4.2-2.9 8-7 9.7-4.1-1.7-7-5.5-7-9.7V6l7-3.2Z" /><path d="M12 11v3" /><circle cx="12" cy="9.2" r=".9" fill={GOLD} stroke="none" /></svg>
                <span style={{ flex: 1, height: 1, background: LINE }} />
              </div>
              <p style={{ textAlign: 'center', color: MUTED, fontSize: 12.5, margin: '9px 0 0' }}>Secure access for authorized staff only</p>
            </form>
          )}
        </div>
      </section>

      <style>{`
        .aps-features-list::before {
          content: "";
          position: absolute;
          inset: 0;
    background: radial-gradient(
    ellipse 42% 48% at 50% 50%,
    rgba(255, 255, 255, 0.96) 0%,
    rgba(255, 255, 255, 0.88) 35%,
    rgba(255, 255, 255, 0.60) 58%,
    rgba(255, 255, 255, 0.25) 75%,
    rgba(255, 255, 255, 0) 100%
  );
          z-index: 0;
          pointer-events: none;
        }
        .aps-login input:focus { border-color: ${GOLD} !important; box-shadow: 0 0 0 3px rgba(169,111,34,.14) !important; }
        .aps-login button:focus-visible, .aps-login a:focus-visible, .aps-login input:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px; }
        .aps-login a:hover { text-decoration: underline; }
        @media (max-width: 1024px) {
          .aps-login { grid-template-columns: 1fr !important; }
          .aps-login-left { display: none !important; }
          .aps-login-right { order: 1; padding: 26px 18px !important; }
        }
      `}</style>
    </div>
  );
}
