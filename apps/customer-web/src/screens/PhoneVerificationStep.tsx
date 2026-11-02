// PhoneVerificationStep.tsx — the six-digit code screen.
//
// ── Why this file is the difference between a feature and a wall ────────────────────────────────────────
// The backend refuses an unverified remote booking with a 428 and hands back a `bookingSessionId` and a MASKED
// phone. Until this screen existed, nothing consumed that: the customer app caught the error, showed "This time
// is no longer available", and the booking simply failed. The enforcement worked perfectly and **no customer
// could ever satisfy it.**
//
// ── What it must never show ─────────────────────────────────────────────────────────────────────────────
// The full phone number. The spec is explicit, and the reason is worth stating: once a code has been SENT, the
// screen echoing the whole number back turns any shoulder-surfer — or anyone who picked up an unlocked phone —
// into someone who now knows both the number and that a code is in flight to it. The server only ever gives us a
// mask, so this component *cannot* leak it even by accident.
import { useEffect, useRef, useState, useCallback } from 'react';
import { customerApi } from '../api/customerApi';
import { CaptchaChallenge } from '../components/CaptchaChallenge';
import type { CaptchaClientConfig } from '@aipowersalon/api-contracts';

const GOLD = 'var(--customer-accent, #A96F22)';
const LINE = 'var(--customer-line, #E7DBC6)';
const TEXT = 'var(--customer-text, #2B2118)';
const MUTED = '#8A7A66';

export interface PhoneVerificationStepProps {
  /** Server-issued. Binds this code to ONE booking attempt. Never generated on the client. */
  bookingSessionId: string;
  /** Already masked by the server — "••••4567". The full number is never sent to us. */
  maskedPhone: string;
  /** Phase 4: until when the salon holds this time for the customer (ISO; null = not held). */
  holdExpiresAt?: string | null;
  /** Phase 4: the send was challenged — show the human check, then send. */
  needsCaptcha?: boolean;
  onVerified: () => void;
  onCancel: () => void;
  onChangePhone?: () => void;
}

const RESEND_COOLDOWN = 60;

export function PhoneVerificationStep({
  bookingSessionId, maskedPhone, holdExpiresAt, needsCaptcha, onVerified, onCancel, onChangePhone,
}: PhoneVerificationStepProps) {
  // Phase 4: the human check, when the send was challenged. The code goes out once it is passed.
  const [captcha, setCaptcha] = useState<CaptchaClientConfig | null>(null);
  const [challenge, setChallenge] = useState(!!needsCaptcha);
  useEffect(() => { if (challenge) customerApi.bookingCaptcha().then(setCaptcha).catch(() => setCaptcha({ provider: null, siteKey: null })); }, [challenge]);
  const sendWithToken = async (captchaToken: string) => {
    setBusy(true); setError(null);
    try { await customerApi.sendBookingVerification({ bookingSessionId, captchaToken }); setChallenge(false); setCooldown(RESEND_COOLDOWN); }
    catch (e: any) { setError(e?.message || 'We could not send a code just now.'); }
    finally { setBusy(false); }
  };
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { refs.current[0]?.focus(); }, []);

  // Countdown to the next allowed resend. The SERVER enforces the cooldown regardless — this only stops the
  // customer wasting a tap on a request that will be refused.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = useCallback(async (code: string) => {
    setBusy(true); setError(null);
    try {
      await customerApi.checkBookingVerification({ bookingSessionId, code });
      onVerified();
    } catch (e: any) {
      // The server's message is already customer-safe and already precise ("That code is incorrect", "This code
      // has expired") — it is the actionable half of the interaction, so it is shown as-is rather than replaced
      // with something generic.
      setError(e?.message || 'That code is incorrect.');
      setDigits(['', '', '', '', '', '']);
      refs.current[0]?.focus();
    } finally { setBusy(false); }
  }, [bookingSessionId, onVerified]);

  const setAt = (i: number, v: string) => {
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    // Auto-advance, and auto-submit on the sixth digit. Making someone hunt for a Continue button after typing
    // the last digit is friction for no gain.
    if (v && i < 5) refs.current[i + 1]?.focus();
    if (next.every((d) => d !== '')) void submit(next.join(''));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    // Paste support is not a nicety: the code arrives by SMS, and on a phone the natural gesture is to copy it
    // from the notification. Without this, six boxes are six chances to mistype.
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = text.split('').concat(Array(6 - text.length).fill(''));
    setDigits(next);
    if (text.length === 6) void submit(text);
    else refs.current[text.length]?.focus();
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  };

  const resend = async () => {
    setBusy(true); setError(null);
    try {
      await customerApi.sendBookingVerification({ bookingSessionId });
      setCooldown(RESEND_COOLDOWN);
      setDigits(['', '', '', '', '', '']);
      refs.current[0]?.focus();
    } catch (e: any) {
      setError(e?.message || 'We could not send another code just now.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ padding: '20px 16px' }}>
      <h2 style={{ font: '700 20px/1.2 "Playfair Display",serif', color: TEXT, margin: '0 0 6px' }}>
        Verify your phone
      </h2>

      {/* MASKED, always. The server never gives us the full number, so this cannot leak it. */}
      {challenge ? (
        <div style={{ margin: '0 0 20px' }} data-testid="captcha-step">
          <p style={{ fontSize: 14, color: MUTED, margin: '0 0 12px' }}>One quick check before we text a code to <strong style={{ color: TEXT }}>{maskedPhone}</strong>.</p>
          <CaptchaChallenge config={captcha} onToken={(t) => void sendWithToken(t)} />
        </div>
      ) : (
        <p style={{ fontSize: 14, color: MUTED, margin: '0 0 20px' }}>
          We sent a 6-digit code to <strong style={{ color: TEXT }}>{maskedPhone}</strong>.
        </p>
      )}
      {holdExpiresAt ? (
        <p data-testid="hold-note" style={{ fontSize: 12.5, color: MUTED, margin: '-12px 0 18px' }}>
          We’re holding this time for you until {new Date(holdExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
        </p>
      ) : null}

      <div
        style={{ display: 'flex', gap: 8, marginBottom: 14 }}
        role="group"
        aria-label="6-digit verification code"
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            value={d}
            onChange={(e) => setAt(i, e.target.value.replace(/\D/g, '').slice(-1))}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={onPaste}
            disabled={busy}
            // inputMode + autoComplete: a numeric keypad on mobile, and iOS/Android will offer the code straight
            // from the SMS notification. A customer should not have to leave the app to read their own code.
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            aria-label={`Digit ${i + 1} of 6`}
            style={{
              width: 46, height: 56, textAlign: 'center', fontSize: 22, fontWeight: 700,
              color: TEXT, border: `1.5px solid ${error ? '#C9695B' : d ? GOLD : LINE}`,
              borderRadius: 10, background: '#fff', outlineColor: GOLD,
            }}
          />
        ))}
      </div>

      {/* Announced to screen readers, not just coloured red. */}
      {error ? (
        <div role="alert" aria-live="assertive" style={{ fontSize: 13.5, color: '#8F3226', marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      {busy ? (
        <div role="status" aria-live="polite" style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>
          Checking…
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
        <button
          onClick={resend}
          disabled={busy || cooldown > 0}
          style={{
            background: 'none', border: 0, padding: 0, cursor: cooldown > 0 ? 'default' : 'pointer',
            color: cooldown > 0 ? MUTED : GOLD, fontSize: 13.5, fontWeight: 600,
          }}
        >
          {/* The countdown is announced, so a screen-reader user is not left wondering why the button is dead. */}
          {cooldown > 0 ? <span aria-live="polite">Resend code in {cooldown}s</span> : 'Resend code'}
        </button>

        {onChangePhone ? (
          <button onClick={onChangePhone} disabled={busy} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: GOLD, fontSize: 13.5, fontWeight: 600 }}>
            Change number
          </button>
        ) : null}
      </div>

      <button
        onClick={onCancel}
        disabled={busy}
        style={{ marginTop: 22, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: MUTED, fontSize: 13 }}
      >
        Cancel booking
      </button>

      <p style={{ fontSize: 11.5, color: MUTED, marginTop: 18, lineHeight: 1.5 }}>
        Your time slot is held while you verify. Codes expire after 10 minutes.
      </p>
    </div>
  );
}
