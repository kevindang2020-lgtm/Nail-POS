// ChangePhoneScreen.tsx — the customer changes their own number.
//
// ── VERIFY FIRST. This is the whole safety argument for this screen. ────────────────────────────────────
//
// You are ALONE WITH YOUR PHONE. If you mistype one digit and we swapped your number immediately, we would have cut
// you off from your own account and from every future code — including the one that would let you fix it. So the old
// number stays live until the new one answers. Cancel, or let it expire, and your old number is simply still there.
//
// BUILD_PLAN Phase 3 added what the audit found missing:
//   • your PASSWORD first (the salon's setting, on by default): a stolen phone or an unlocked laptop carries a signed-in
//     session, not the password;
//   • a resend countdown, and every send failure shown (they were swallowed);
//   • after the change, the option to use the new number to SIGN IN too — a separate, deliberate step (password again;
//     your old number is warned; every signed-in session ends).
import { useEffect, useState } from 'react';
import { customerApi } from '../api/customerApi';
import type { CustomerPhoneStatus } from '@aipowersalon/api-contracts';

const GOLD = 'var(--customer-accent, #A96F22)';
const LINE = 'var(--customer-line, #E7DBC6)';
const TEXT = 'var(--customer-text, #2B2118)';
const MUTED = '#8A7A66';
const BAD = '#8F3226';
const RESEND_SECONDS = 30;

export interface ChangePhoneScreenProps {
  /** Already masked by the server. */
  currentMasked: string | null;
  onDone: () => void;
  onCancel: () => void;
}

type Step = 'enter' | 'code' | 'done' | 'login' | 'login_done';

const input: React.CSSProperties = { width: '100%', padding: '11px 12px', border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 15, marginBottom: 12, color: TEXT, background: '#fff' };
const primary = (disabled: boolean): React.CSSProperties => ({ width: '100%', background: GOLD, color: '#fff', border: 0, borderRadius: 10, padding: '12px 16px', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: disabled ? 0.5 : 1 });
const link: React.CSSProperties = { background: 'none', border: 0, color: GOLD, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' };

export function ChangePhoneScreen({ currentMasked, onDone, onCancel }: ChangePhoneScreenProps) {
  const [step, setStep] = useState<Step>('enter');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [maskedNew, setMaskedNew] = useState('');
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loginPassword, setLoginPassword] = useState('');
  const [status, setStatus] = useState<CustomerPhoneStatus | null>(null);

  // The number's real proof, and a change already waiting for its code (entering the same number resumes it).
  useEffect(() => { customerApi.phoneStatus().then(setStatus).catch(() => setStatus(null)); }, []);

  useEffect(() => { if (resendIn <= 0) return; const t = setTimeout(() => setResendIn((n) => n - 1), 1000); return () => clearTimeout(t); }, [resendIn]);

  const sendCode = async (sid: string) => {
    await customerApi.phoneChangeSend(sid, phone.trim());
    setResendIn(RESEND_SECONDS);
  };

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await customerApi.phoneChangeStart(phone.trim(), password || undefined);
      setSessionId(r.sessionId); setMaskedNew(r.maskedPhone);
      try { await sendCode(r.sessionId); setStep('code'); }
      catch (e: any) {
        // The change is saved; the code did not go out. Say so — and let them resend from the code screen.
        setStep('code');
        setErr(e?.code === 'no_provider' ? 'Your salon cannot send verification codes right now. Please try again later or contact the salon.' : (e?.message || 'We could not send a code to that number.'));
      }
    } catch (e: any) {
      setErr(e?.code === 'reauth_required' ? 'Enter your password to change your phone number.' : (e?.message || 'We could not start the change.'));
    } finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await customerApi.phoneChangeVerify(sessionId, phone.trim(), code.trim());
      if (r.activated) setStep('done'); else { setErr(r.message); setCode(''); }
    } catch (e: any) { setErr(e?.message || 'That code is incorrect.'); setCode(''); }
    finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true); setErr(null);
    try { await sendCode(sessionId); }
    catch (e: any) { setErr(e?.message || 'We could not send another code just now.'); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (sessionId && step === 'code') await customerApi.phoneChangeCancel(sessionId).catch(() => undefined);
    onCancel();
  };

  const switchSignInNumber = async () => {
    setBusy(true); setErr(null);
    try { await customerApi.changeLoginNumber(phone.trim(), loginPassword); setStep('login_done'); }
    catch (e: any) { setErr(e?.message || 'We could not change your sign-in number.'); }
    finally { setBusy(false); }
  };

  const errBox = err ? <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: BAD, marginBottom: 12 }}>{err}</div> : null;
  const h2 = (t: string) => <h2 style={{ font: '700 20px/1.2 "Playfair Display",serif', color: TEXT, margin: '0 0 6px' }}>{t}</h2>;

  if (step === 'enter') {
    return (
      <div style={{ padding: '20px 16px' }}>
        {h2('Change phone number')}
        <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 18px', lineHeight: 1.5 }}>
          Your number is currently <strong style={{ color: TEXT }}>{currentMasked || 'not set'}</strong>. We&rsquo;ll text a 6-digit code to the new number.{' '}
          <strong style={{ color: TEXT }}>Your current number keeps working until you enter that code.</strong>
        </p>
        {status?.phone ? <p data-testid="phone-proof" style={{ fontSize: 12.5, color: MUTED, margin: '-8px 0 14px' }}>{status.phone.label}</p> : null}
        {status?.openChange && !status.openChange.expired ? (
          <p data-testid="open-change" style={{ fontSize: 12.5, color: TEXT, background: '#FBF3DE', borderRadius: 8, padding: '8px 10px', margin: '0 0 14px' }}>
            A change to <strong>{status.openChange.maskedPhone}</strong> is waiting for its code. Enter that number again to get a new code.
          </p>
        ) : null}
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="New mobile number" inputMode="tel" autoComplete="tel" aria-label="New phone number" style={input} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="Your password" aria-label="Your password" style={input} />
        <p style={{ fontSize: 11.5, color: MUTED, margin: '-6px 0 12px' }}>We ask for your password so nobody else holding your phone can move your number.</p>
        {errBox}
        <button onClick={() => void start()} disabled={busy || !phone.trim()} style={primary(busy || !phone.trim())}>{busy ? 'Sending…' : 'Send verification code'}</button>
        <button onClick={cancel} disabled={busy} style={{ width: '100%', marginTop: 10, background: 'none', border: 0, color: MUTED, fontSize: 13.5, cursor: 'pointer', padding: 8 }}>Cancel</button>
      </div>
    );
  }

  if (step === 'code') {
    return (
      <div style={{ padding: '20px 16px' }}>
        {h2('Enter the code')}
        <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 18px' }}>We sent a 6-digit code to <strong style={{ color: TEXT }}>{maskedNew}</strong>.</p>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          aria-label="Verification code" style={{ ...input, letterSpacing: 6, fontSize: 22, fontWeight: 700, textAlign: 'center' }} />
        {errBox}
        <button onClick={() => void verify()} disabled={busy || code.length !== 6} style={primary(busy || code.length !== 6)}>{busy ? 'Verifying…' : 'Verify and change my number'}</button>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 12 }}>
          <button onClick={() => void resend()} disabled={busy || resendIn > 0} style={{ ...link, opacity: busy || resendIn > 0 ? 0.5 : 1 }} data-testid="resend">
            {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
          </button>
          <button onClick={() => { setStep('enter'); setCode(''); setErr(null); }} disabled={busy} style={link}>Change number</button>
        </div>
        <button onClick={cancel} disabled={busy} style={{ width: '100%', marginTop: 16, background: 'none', border: 0, color: MUTED, fontSize: 13, cursor: 'pointer', padding: 8 }}>Cancel — keep my current number</button>
        <p style={{ fontSize: 11.5, color: MUTED, marginTop: 16, textAlign: 'center', lineHeight: 1.5 }}>Your current number stays active until this code is verified.</p>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div style={{ padding: '20px 16px' }} data-testid="phone-changed">
        {h2('Your number is changed')}
        <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 18px', lineHeight: 1.5 }}>
          Booking codes and appointment reminders now go to <strong style={{ color: TEXT }}>{maskedNew}</strong>.
        </p>
        <button onClick={() => { setStep('login'); setErr(null); }} style={{ ...primary(false), background: '#fff', color: GOLD, border: `1px solid ${GOLD}`, marginBottom: 10 }}>Also use this number to sign in…</button>
        <button onClick={onDone} style={primary(false)}>Done</button>
      </div>
    );
  }

  if (step === 'login') {
    return (
      <div style={{ padding: '20px 16px' }} data-testid="login-number">
        {h2('Sign in with your new number')}
        <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 14px', lineHeight: 1.5 }}>
          Your sign-in number changes to <strong style={{ color: TEXT }}>{maskedNew}</strong>. We&rsquo;ll text your old number to let you know,
          and every device signed in to your account will be signed out — including this one.
        </p>
        <input value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="Your password" aria-label="Password for sign-in change" style={input} />
        {errBox}
        <button onClick={() => void switchSignInNumber()} disabled={busy || !loginPassword} style={primary(busy || !loginPassword)}>{busy ? 'Changing…' : 'Change my sign-in number'}</button>
        <button onClick={onDone} disabled={busy} style={{ width: '100%', marginTop: 10, background: 'none', border: 0, color: MUTED, fontSize: 13.5, cursor: 'pointer', padding: 8 }}>Not now</button>
      </div>
    );
  }

  if (step === 'login_done') {
    return (
      <div style={{ padding: '20px 16px' }} data-testid="login-number-done">
        {h2('Sign in again')}
        <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 18px', lineHeight: 1.5 }}>Your sign-in number is now {maskedNew}. For your security every device was signed out — sign in with your new number.</p>
        <button onClick={onDone} style={primary(false)}>OK</button>
      </div>
    );
  }

  return null;
}
