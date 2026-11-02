import { useEffect, useState } from 'react';
import { ActivateAccountScreen } from './ActivateAccountScreen';
import { signInWithFaceId, faceIdMode, useT } from '@aipowersalon/mobile-sdk';
import '../i18n/catalog';   // this app's EN / VI strings (registered on import, so tests and screens see them)
import { authApi } from '../api/authApi';
import { saveNativeSession } from '@aipowersalon/mobile-sdk';
import { useAuth } from '../auth/AuthContext';
import { RegisterScreen } from './RegisterScreen';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';

// Customer App sign-in.
//
// SAME auth system, not a second one — it posts to the existing /auth/login. The one change is the portal:
// `portal: 'customer'`, which drives a lookup whose SQL says `where role = 'CUSTOMER'`. A manager, technician,
// owner or Super Admin is therefore INVISIBLE to it and cannot sign in here even with correct credentials
// (spec §11). It also needs no salon code — a customer does not have one; they sign in with phone or email.
//
// Face ID reuses the existing WebAuthn implementation (`api/webauthn.ts`). The browser only produces a
// signature; the SERVER decides whether it is valid. Nothing here is trusted as proof of identity.

const GOLD = 'var(--customer-gold, #A96F22)';
const GOLD_DEEP = '#84561A';
const GOLD_BRONZE = '#C9971B';
const LINE = 'var(--customer-border, #E7DCC9)';
const TEXT = 'var(--customer-text, #2A2118)';
const MUTED = '#8A7A66';
const SERIF = 'Georgia, "Times New Roman", serif';

// The reference art is a photographic salon interior. The repo ships no licensed photograph, so the scene is a
// CSS/SVG marble + gold composition. Drop a licensed image at /brand/salon-bg.jpg and it is used automatically.
const SALON_BG = '/brand/salon-bg.jpg';

const field: React.CSSProperties = {
  width: '100%', height: 54, borderRadius: 14, border: `1px solid ${LINE}`, background: '#FFFFFF',
  padding: '0 44px 0 46px', fontFamily: 'inherit', fontSize: 16, color: TEXT, outline: 'none',
  boxShadow: '0 2px 10px rgba(42,33,24,.05)',            // 16px font avoids the iOS zoom-on-focus jump
};
const iconLeft: React.CSSProperties = { position: 'absolute', left: 15, display: 'flex', pointerEvents: 'none' };

function Scene() {
  const [hasPhoto, setHasPhoto] = useState(false);
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0 }}>
      {/* Warm ivory → cream → marble wash. This is the base, and it stands on its own: the screen is designed to
          look finished WITHOUT a photograph, because shipping a placeholder (or an unlicensed stock image) is
          worse than shipping something intentionally simple. Drop a licensed photo at /brand/salon-bg.jpg and it
          layers over this automatically. */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(125% 85% at 50% -5%, #FFFFFF 0%, #FEFCF7 32%, #F8F1E5 62%, #F2E7D6 100%)' }} />

      {/* Marble veining — a few long, soft strokes. Real marble is mostly field with sparse veins; the usual
          mistake is too many, too dark, too even. */}
      <svg viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}>
        <defs>
          <linearGradient id="vein" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#D8CDBA" stopOpacity="0" />
            <stop offset="45%" stopColor="#C9BCA4" stopOpacity=".55" />
            <stop offset="100%" stopColor="#D8CDBA" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="url(#vein)" strokeLinecap="round">
          <path d="M-30 120 C 80 190, 60 300, 170 360 S 300 470, 430 430" strokeWidth="1.4" />
          <path d="M-30 150 C 70 215, 55 315, 160 385" strokeWidth=".7" opacity=".7" />
          <path d="M430 90 C 330 160, 340 250, 250 300 S 120 380, -20 340" strokeWidth="1" opacity=".55" />
          <path d="M-20 610 C 110 560, 210 640, 430 570" strokeWidth=".9" opacity=".5" />
        </g>
      </svg>

      {/*
        The salon interior. DECORATIVE, not informative — it carries no meaning the sighted user gets and a
        screen-reader user misses, so it takes `alt=""` and the whole layer is `aria-hidden`. Announcing
        "salon interior photo" here would be noise on a sign-in screen.

        Responsive: WebP first (≈60% smaller than JPEG at the same quality), JPEG fallback for anything that
        can't take it. `sizes="100vw"` because it is a full-bleed background — the browser picks 480/760/1080
        by device width and DPR, so a phone never downloads the 1080 asset.

        If the file is ever missing it stays INVISIBLE (opacity 0) and the marble/gold composition beneath simply
        stands as the design. There is no broken-image state and no placeholder.
      */}
      <picture>
        <source
          type="image/webp"
          srcSet="/brand/salon-bg-480.webp 480w, /brand/salon-bg-760.webp 760w, /brand/salon-bg-1080.webp 1080w"
          sizes="100vw"
        />
        <img
          src={SALON_BG}
          srcSet="/brand/salon-bg-480.jpg 480w, /brand/salon-bg-760.jpg 760w, /brand/salon-bg-1080.jpg 1080w"
          sizes="100vw"
          alt=""
          decoding="async"
          fetchPriority="low"
          onLoad={() => setHasPhoto(true)}
          onError={() => setHasPhoto(false)}
          data-testid="salon-bg"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', opacity: hasPhoto ? 1 : 0, transition: 'opacity .45s' }}
        />
      </picture>

      {/* Solid white at the top fully masks any logo baked into the photo, easing to soft translucency below so every
          word stays readable over whatever is behind it. */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 38%, rgba(255,255,255,.88) 65%, rgba(255,255,255,.95) 100%)' }} />

      {/* Gold flowing lines near the bottom. */}
      <svg viewBox="0 0 400 800" preserveAspectRatio="xMidYMax slice" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <defs>
          <linearGradient id="cg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={GOLD_BRONZE} stopOpacity=".12" />
            <stop offset="45%" stopColor={GOLD} stopOpacity=".85" />
            <stop offset="100%" stopColor={GOLD_BRONZE} stopOpacity=".18" />
          </linearGradient>
          <linearGradient id="cg2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={GOLD} stopOpacity="0" />
            <stop offset="50%" stopColor={GOLD_BRONZE} stopOpacity=".5" />
            <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g fill="none" strokeLinecap="round">
          <path d="M-20 700 C 90 638, 220 762, 420 662" stroke="url(#cg)" strokeWidth="2.4" />
          <path d="M-20 722 C 100 663, 230 782, 420 686" stroke="url(#cg)" strokeWidth="1.1" opacity=".75" />
          <path d="M-20 745 C 110 690, 240 800, 420 710" stroke="url(#cg2)" strokeWidth=".7" opacity=".6" />
          <path d="M-20 766 C 120 716, 250 812, 420 732" stroke="url(#cg2)" strokeWidth=".5" opacity=".4" />
        </g>
      </svg>
    </div>
  );
}


export function LoginScreen({ onGuest, notice }: { onGuest?: () => void; notice?: string } = {}) {
  const tr = useT();   // C6 §97 (Phase 13): EN / VI; every English key is today's text
  const { setPrincipal } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'activate' | 'forgot'>('login');
  // A note left by Profile → My salon when the customer switched to a different salon (sign in again to land there).
  const [switchNote] = useState<string | null>(() => { try { const n = sessionStorage.getItem('aps_signin_note'); sessionStorage.removeItem('aps_signin_note'); return n; } catch { return null; } });
  const shownNotice = notice || switchNote || undefined;
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // null = we haven't finished asking the device yet. Treating "unknown" as "unavailable" made an early tap
  // report "Face ID isn't available" on a device where it plainly is.
  const [faceIdSupported, setFaceIdSupported] = useState<boolean | null>(null);
  const [faceBusy, setFaceBusy] = useState(false);

  useEffect(() => { faceIdMode().then((m) => setFaceIdSupported(m !== 'none')); }, []);


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (!identifier.trim()) { setErr('Enter your phone number or email.'); return; }
    if (!password) { setErr('Enter your password.'); return; }
    setBusy(true);
    try {
      // portal 'customer' → the lookup only ever sees role = 'CUSTOMER'. No salon code.
      const r = await authApi.login({ portal: 'customer', identifier: identifier.trim(), password, rememberMe: remember });
      // NATIVE only: the server returns a token when (and only when) the request came from the native app. On the
      // web this is absent and nothing is stored — the httpOnly cookie does the work and stays out of JavaScript.
      await saveNativeSession(r);   // access + refresh token (Constitution 3 Step 2b)
      if ((r as any).outcome === 'SUCCESS' && (r as any).principal) {
        setPrincipal((r as any).principal); return;
      }
      setErr((r as any).message || 'The login information is incorrect. Please try again.');
    } catch (e: any) {
      const msg = String(e?.message || '');
      setErr(/network|fetch/i.test(msg)
        ? 'Unable to connect to AI PowerSalon. Please check your connection and try again.'
        : (msg || 'The login information is incorrect. Please try again.'));
    } finally { setBusy(false); }
  };

  const faceId = async () => {
    if (faceBusy) return;
    setErr(null);
    if (faceIdSupported === false) { setErr('Face ID isn’t available on this device.'); return; }
    setFaceBusy(true);
    try {
      // The SERVER decides. Native unlocks the Keychain token and we revalidate it here; the web path verifies a
      // WebAuthn signature server-side. A biometric success is never treated as authentication on its own.
      const principal = await signInWithFaceId(async () => await authApi.me(), identifier.trim() || undefined);   // Phase 13 D: device credential → the server opens a fresh session
      setPrincipal(principal && (principal as any).role ? principal : null);
    } catch (e: any) {
      const msg = String(e?.message || '');
      // A cancelled prompt is NOT an authentication failure — return quietly to the form.
      if (/cancel/i.test(msg)) { setFaceBusy(false); return; }
      // Phase 13 D: a refused device credential was wiped — say so; otherwise the generic fallback
      setErr(e?.reason === 'session_invalid' && msg ? msg : 'Face ID sign-in didn’t work. Sign in with your password, then enable Face ID under Profile → Security.');
    } finally { setFaceBusy(false); }
  };

  const handleShortcutClick = async (route: string) => {
    try {
      sessionStorage.setItem('aps_customer_target_route', route);
    } catch { /* ignore */ }
    await faceId();
  };

  if (mode === 'activate') return <ActivateAccountScreen onBack={() => setMode('login')} onFindSalon={() => setMode('register')} />;
  if (mode === 'register') return <RegisterScreen onBack={() => setMode('login')} onRegistered={(email: string) => { setIdentifier(email); setMode('login'); setErr('Account created — please sign in.'); }} />;
  if (mode === 'forgot') return <ForgotPasswordScreen onBack={() => setMode('login')} />;

  return (
    <div className="aps-customer-login" style={{
      position: 'relative', minHeight: '100dvh', height: '100%', display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      // safe areas: never under the Dynamic Island or the home indicator
      padding: 'max(18px, env(safe-area-inset-top)) 20px max(16px, env(safe-area-inset-bottom))',
      overflowY: 'auto',
    }}>
      <Scene />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 440, margin: '0 auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* brand */}
        <img src="/brand/aipowersalon-logo.png" alt="AI PowerSalon" width={150}
          style={{ width: 150, height: 'auto', display: 'block', margin: '4px auto 4px' }} draggable={false} />
        <div style={{ textAlign: 'center', fontFamily: SERIF, fontSize: 24, letterSpacing: '.08em', color: TEXT, fontWeight: 500 }}>
          <span style={{ color: GOLD }}>AI</span>
          <span style={{ color: LINE, margin: '0 .3em', fontWeight: 300 }}>|</span>
          POWERSALON
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 4 }}>
          <span style={{ height: 1, width: 26, background: LINE }} />
          <span style={{ fontSize: 9.5, letterSpacing: '.16em', color: GOLD_DEEP, fontWeight: 600 }}>{tr('common.tagline')}</span>
          <span style={{ height: 1, width: 26, background: LINE }} />
        </div>
        <div className="customer-web-login-scroll-container" style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'transparent', width: '100%', boxSizing: 'border-box', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          <h1 style={{ fontFamily: SERIF, fontSize: 32, color: TEXT, textAlign: 'center', margin: '16px 0 6px', fontWeight: 600 }}>{tr('common.welcomeBack')}</h1>
          <p style={{ textAlign: 'center', color: MUTED, fontSize: 14, lineHeight: 1.45, margin: '0 0 8px' }}>
            Sign in to book appointments,<br />manage rewards, and explore beauty services
          </p>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <button type="button" onClick={() => onGuest?.()}
              style={{ background: 'rgba(169,111,34,0.08)', border: `1px solid ${LINE}`, borderRadius: 20, color: GOLD_DEEP, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>{tr('customer.login.exploreAsGuest')}</span>
              <span style={{ fontSize: 14 }} aria-hidden>&rarr;</span>
            </button>
          </div>
          {shownNotice && (
            <div style={{ background: 'rgba(169,111,34,0.10)', border: `1px solid ${LINE}`, borderRadius: 12, padding: '11px 14px', margin: '0 0 16px', textAlign: 'center', color: TEXT, fontSize: 13.5, fontWeight: 500 }}>{shownNotice}</div>
          )}

          {err ? (
            <div role="alert" style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, fontSize: 13.5, background: '#FBEDE9', border: '1px solid #F0D2C9', color: '#8F3226' }}>{err}</div>
          ) : null}

          <form onSubmit={submit} noValidate>
            {/* Phone or Email */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <span style={iconLeft}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" aria-hidden><circle cx="12" cy="8" r="3.6" /><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" /></svg>
              </span>
              <input id="c-identifier" aria-label={tr('customer.login.phoneOrEmail')} style={field} placeholder={tr('customer.login.phoneOrEmail')}
                value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} />
            </div>

            {/* Password */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <span style={iconLeft}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" aria-hidden><rect x="4.5" y="10" width="15" height="10" rx="2.4" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /><circle cx="12" cy="15" r="1.3" fill={GOLD} stroke="none" /></svg>
              </span>
              <input id="c-password" aria-label={tr('common.password')} style={field} type={showPw ? 'text' : 'password'} placeholder={tr('common.password')}
                value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              <button type="button" onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}
                style={{ position: 'absolute', right: 8, width: 40, height: 40, display: 'grid', placeItems: 'center', border: 0, borderRadius: 10, background: 'transparent', cursor: 'pointer' }}>
                {showPw ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M3 3l18 18" /><path d="M10.6 10.7a2 2 0 0 0 2.8 2.8" /><path d="M6.7 6.9C4.6 8.2 3 10.3 2.5 12c1.2 3.2 5 6 9.5 6 1.6 0 3.1-.35 4.4-.95" /><path d="M9.9 6.2A9.9 9.9 0 0 1 12 6c4.5 0 8.3 2.8 9.5 6-.4 1.2-1.3 2.6-2.6 3.8" /></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M2.5 12C3.7 8.8 7.5 6 12 6s8.3 2.8 9.5 6c-1.2 3.2-5 6-9.5 6s-8.3-2.8-9.5-6Z" /><circle cx="12" cy="12" r="2.6" /></svg>
                )}
              </button>
            </div>

            {/* Remember me + forgot */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '2px 0 14px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, color: TEXT, cursor: 'pointer', minHeight: 44 }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                  style={{ width: 20, height: 20, accentColor: '#A96F22', cursor: 'pointer' }} />
                Remember me
              </label>
              <button type="button" onClick={() => { setErr(null); setMode('forgot'); }}
                style={{ background: 'none', border: 0, color: GOLD, fontSize: 14, fontWeight: 500, cursor: 'pointer', padding: '10px 0', minHeight: 44 }}>
                Forgot password?
              </button>
            </div>

            <button type="submit" disabled={busy}
              style={{
                width: '100%', height: 56, borderRadius: 14, border: 'none', cursor: busy ? 'default' : 'pointer',
                background: busy ? '#D6C097' : `linear-gradient(180deg, ${GOLD_BRONZE} 0%, ${GOLD} 55%, ${GOLD_DEEP} 100%)`,
                color: '#FFFDF8', fontSize: 18, fontFamily: SERIF,
                boxShadow: busy ? 'none' : '0 8px 22px rgba(169,111,34,.3)',
              }}>
              {busy ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          {/* OR */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
            <span style={{ flex: 1, height: 1, background: LINE }} />
            <span style={{ width: 34, height: 34, borderRadius: '50%', border: `1px solid ${LINE}`, background: '#fff', display: 'grid', placeItems: 'center', fontSize: 11.5, color: MUTED, fontWeight: 600 }}>OR</span>
            <span style={{ flex: 1, height: 1, background: LINE }} />
          </div>

          <button type="button" onClick={() => { setErr(null); setMode('activate'); }}
            style={{ width: '100%', minHeight: 54, borderRadius: 14, border: `1px solid ${GOLD}`, background: 'rgba(255,255,255,.75)', color: GOLD_DEEP, fontSize: 17, fontFamily: SERIF, cursor: 'pointer' }}>
            Create Account
          </button>

          {/* Face ID + Guest */}
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button type="button" onClick={faceId} disabled={faceBusy}
              aria-label="Sign in with Face ID (biometric login)"
              style={{ flex: 1, minHeight: 66, borderRadius: 14, border: `1px solid ${LINE}`, background: 'rgba(255,255,255,.8)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', cursor: faceBusy ? 'default' : 'pointer', textAlign: 'left' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" aria-hidden>
                <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
                <path d="M9 10v1.5M15 10v1.5M9.5 15.2c.8.7 1.6 1 2.5 1s1.7-.3 2.5-1" />
              </svg>
              <span>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: TEXT }}>{faceBusy ? 'Verifying…' : 'Face ID'}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: MUTED }}>{tr('customer.login.biometric')}</span>
              </span>
            </button>

            <button type="button" onClick={() => onGuest?.()}
              aria-label="Continue as guest and browse services"
              style={{ flex: 1, minHeight: 66, borderRadius: 14, border: `1px solid ${LINE}`, background: 'rgba(255,255,255,.8)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ width: 34, height: 34, borderRadius: '50%', background: '#F3EDE2', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.7" strokeLinecap="round" aria-hidden><circle cx="12" cy="8" r="3.4" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
              </span>
              <span>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: TEXT }}>{tr('customer.login.guest')}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: MUTED }}>{tr('customer.login.browse')}</span>
              </span>
            </button>
          </div>

          {/* Benefits */}
          {/* <div style={{ display: 'flex', marginTop: 14, padding: '14px 6px', borderRadius: 16, background: 'rgba(255,255,255,.72)', border: `1px solid ${LINE}` }}>
            <Benefit kind="booking" title="Easy Booking" desc="Book anytime in seconds" />
            <span style={{ width: 1, background: LINE, margin: '2px 0' }} />
            <Benefit kind="rewards" title="Rewards" desc="Earn points & redeem" />
            <span style={{ width: 1, background: LINE, margin: '2px 0' }} />
            <Benefit kind="offers" title="Exclusive Offers" desc="Get special deals just for you" />
          </div> */}
          <div className="customer-login-shortcuts" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, fontFamily: SERIF, letterSpacing: '.1px' }}>{tr('customer.login.shortcuts')}</div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{tr('customer.login.shortcutsSub')}</div>
              </div>
              <span style={{ fontSize: 10.5, color: GOLD, fontWeight: 600, letterSpacing: '.3px' }}>{tr('customer.login.explore')}</span>
            </div>

            <div style={{ display: 'flex', padding: '8px 5px', borderRadius: 16, background: 'rgba(255,255,255,.72)', border: `1px solid ${LINE}`, boxShadow: '0 3px 14px rgba(70,45,20,.035)' }}>
              <button
                type="button"
                onClick={() => handleShortcutClick('/book')}
                disabled={faceBusy || busy}
                aria-label="Book Appointment with Face ID"
                style={{ flex: 1, minWidth: 0, minHeight: 86, border: 'none', borderRadius: 12, background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '9px 4px', cursor: (faceBusy || busy) ? 'default' : 'pointer', textAlign: 'center', transition: 'all .2s ease' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#FBF5EA'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 5px 14px rgba(70,45,20,.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <span style={{ width: 38, height: 38, borderRadius: 11, background: '#F5EBDD', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="17" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                    <path d="M8 14h2M14 14h2M8 18h2" />
                  </svg>
                </span>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: TEXT, lineHeight: 1.2 }}>{tr('customer.login.appointment')}</span>
                <span style={{ display: 'block', fontSize: 10, color: MUTED, lineHeight: 1.2 }}>{tr('customer.login.bookVisit')}</span>
              </button>

              <span style={{ width: 1, background: LINE, margin: '8px 0' }} />

              <button
                type="button"
                onClick={() => handleShortcutClick('/deals')}
                disabled={faceBusy || busy}
                aria-label="View Deals with Face ID"
                style={{ flex: 1, minWidth: 0, minHeight: 86, border: 'none', borderRadius: 12, background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '9px 4px', cursor: (faceBusy || busy) ? 'default' : 'pointer', textAlign: 'center', transition: 'all .2s ease' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#FBF5EA'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 5px 14px rgba(70,45,20,.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <span style={{ width: 38, height: 38, borderRadius: 11, background: '#F5EBDD', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.5 13.5L13.5 20.5a2 2 0 0 1-2.8 0L3.5 13.3V4h9.3l7.7 7.7a2.55 2.55 0 0 1 0 1.8Z" />
                    <circle cx="8" cy="8" r="1.3" />
                  </svg>
                </span>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: TEXT, lineHeight: 1.2 }}>{tr('nav.deals')}</span>
                <span style={{ display: 'block', fontSize: 10, color: MUTED, lineHeight: 1.2 }}>{tr('customer.login.specialOffers')}</span>
              </button>

              <span style={{ width: 1, background: LINE, margin: '8px 0' }} />

              <button
                type="button"
                onClick={() => handleShortcutClick('/wallet')}
                disabled={faceBusy || busy}
                aria-label="Open Wallet with Face ID"
                style={{ flex: 1, minWidth: 0, minHeight: 86, border: 'none', borderRadius: 12, background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '9px 4px', cursor: (faceBusy || busy) ? 'default' : 'pointer', textAlign: 'center', transition: 'all .2s ease' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#FBF5EA'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 5px 14px rgba(70,45,20,.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <span style={{ width: 38, height: 38, borderRadius: 11, background: '#F5EBDD', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v10A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10Z" />
                    <path d="M3 8h15.5A2.5 2.5 0 0 1 21 10.5v4h-4a2.5 2.5 0 0 1 0-5h4" />
                    <circle cx="17" cy="12" r=".8" fill={GOLD} />
                  </svg>
                </span>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: TEXT, lineHeight: 1.2 }}>{tr('nav.wallet')}</span>
                <span style={{ display: 'block', fontSize: 10, color: MUTED, lineHeight: 1.2 }}>{tr('customer.login.yourBalance')}</span>
              </button>
            </div>
          </div>
          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, margin: '10px 0 4px', color: MUTED, fontSize: 12 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="1.7" strokeLinecap="round" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /></svg>
            Secure access. Your data is protected.
          </div>
        </div>
      </div>
      <style>{`
        .aps-customer-login input:focus { border-color: ${GOLD} !important; box-shadow: 0 0 0 3px rgba(169,111,34,.14) !important; }
        .aps-customer-login button:focus-visible, .aps-customer-login input:focus-visible { outline: 2px solid ${GOLD}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { .aps-customer-login * { transition: none !important; animation: none !important; } }
      `}</style>
    </div>
  );
}
