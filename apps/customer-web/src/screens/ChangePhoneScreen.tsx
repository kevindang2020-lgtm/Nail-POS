// ChangePhoneScreen.tsx — the customer changes their own number.
//
// ── VERIFY FIRST. This is the whole safety argument for this screen. ────────────────────────────────────
//
// The receptionist flow may save a new number as "pending" — the customer is standing at the counter, and a
// mistyped digit can be retyped on the spot.
//
// You are ALONE WITH YOUR PHONE. If you mistype one digit and we swapped your number immediately, we would have cut
// you off from your own account **and from every future code — including the one that would let you fix it.**
//
// So: the old number stays live until the new one answers. Nothing is replaced until an SMS arrives at the new
// handset and you type what it says. Cancel, or let it expire, and your old number is simply still there — there is
// nothing to roll back, because nothing was taken away.
import { useState } from 'react';
import { customerApi } from '../api/customerApi';

const GOLD = 'var(--customer-accent, #A96F22)';
const LINE = 'var(--customer-line, #E7DBC6)';
const TEXT = 'var(--customer-text, #2B2118)';
const MUTED = '#8A7A66';

export interface ChangePhoneScreenProps {
  /** Already masked by the server. The full number is never sent back to the client after a code goes out. */
  currentMasked: string | null;
  onDone: () => void;
  onCancel: () => void;
}

type Step = 'enter' | 'code' | 'done';

const input: React.CSSProperties = {
  width: '100%', padding: '11px 12px', border: `1px solid ${LINE}`, borderRadius: 10,
  fontSize: 15, marginBottom: 12, color: TEXT, background: '#fff',
};

export function ChangePhoneScreen({ currentMasked, onDone, onCancel }: ChangePhoneScreenProps) {
  const [step, setStep] = useState<Step>('enter');
  const [phone, setPhone] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [maskedNew, setMaskedNew] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await customerApi.phoneChangeStart(phone.trim());
      setSessionId(r.sessionId);
      setMaskedNew(r.maskedPhone);
      await customerApi.phoneChangeSend(r.sessionId, phone.trim());
      setStep('code');
    } catch (e: any) {
      // The server's messages are already precise and safe — "that number does not look valid", "another customer
      // already uses this number". Replacing them with something generic throws away the actionable half.
      setErr(e?.message || 'We could not send a code to that number.');
    } finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await customerApi.phoneChangeVerify(sessionId, phone.trim(), code.trim());
      if (r.activated) { setStep('done'); onDone(); }
      else setErr(r.message);
    } catch (e: any) {
      setErr(e?.message || 'That code is incorrect.');
      setCode('');
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (sessionId) await customerApi.phoneChangeCancel(sessionId).catch(() => undefined);
    onCancel();
  };

  const resend = async () => {
    setBusy(true); setErr(null);
    try { await customerApi.phoneChangeSend(sessionId, phone.trim()); }
    catch (e: any) { setErr(e?.message || 'We could not send another code just now.'); }
    finally { setBusy(false); }
  };

  if (step === 'enter') {
    return (
      <div style={{ padding: '20px 16px' }}>
        <h2 style={{ font: '700 20px/1.2 "Playfair Display",serif', color: TEXT, margin: '0 0 6px' }}>
          Change phone number
        </h2>
        <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 18px', lineHeight: 1.5 }}>
          Your number is currently <strong style={{ color: TEXT }}>{currentMasked || 'not set'}</strong>.
          {' '}We&rsquo;ll text a 6-digit code to the new number.{' '}
          {/* Said plainly, because it is the reassurance that matters: nothing is taken away until the new number
              answers. */}
          <strong style={{ color: TEXT }}>Your current number keeps working until you enter that code.</strong>
        </p>

        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="New mobile number"
          inputMode="tel"
          autoComplete="tel"
          aria-label="New phone number"
          style={input}
        />

        {err ? <div role="alert" style={{ fontSize: 13, color: '#8F3226', marginBottom: 12 }}>{err}</div> : null}

        <button
          onClick={() => void start()}
          disabled={busy || !phone.trim()}
          style={{ width: '100%', background: GOLD, color: '#fff', border: 0, borderRadius: 10, padding: '12px 16px', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: busy || !phone.trim() ? 0.5 : 1 }}
        >
          {busy ? 'Sending…' : 'Send verification code'}
        </button>
        <button onClick={cancel} disabled={busy} style={{ width: '100%', marginTop: 10, background: 'none', border: 0, color: MUTED, fontSize: 13.5, cursor: 'pointer', padding: 8 }}>
          Cancel
        </button>
      </div>
    );
  }

  if (step === 'code') {
    return (
      <div style={{ padding: '20px 16px' }}>
        <h2 style={{ font: '700 20px/1.2 "Playfair Display",serif', color: TEXT, margin: '0 0 6px' }}>
          Enter the code
        </h2>
        {/* MASKED. The server never hands the full number back once a code has been sent, so this screen cannot
            leak it even by accident. */}
        <p style={{ fontSize: 13.5, color: MUTED, margin: '0 0 18px' }}>
          We sent a 6-digit code to <strong style={{ color: TEXT }}>{maskedNew}</strong>.
        </p>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          aria-label="Verification code"
          style={{ ...input, letterSpacing: 6, fontSize: 22, fontWeight: 700, textAlign: 'center' }}
        />

        {err ? <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: '#8F3226', marginBottom: 12 }}>{err}</div> : null}

        <button
          onClick={() => void verify()}
          disabled={busy || code.length !== 6}
          style={{ width: '100%', background: GOLD, color: '#fff', border: 0, borderRadius: 10, padding: '12px 16px', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: busy || code.length !== 6 ? 0.5 : 1 }}
        >
          {busy ? 'Verifying…' : 'Verify and change my number'}
        </button>

        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 12 }}>
          <button onClick={() => void resend()} disabled={busy} style={{ background: 'none', border: 0, color: GOLD, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            Resend code
          </button>
          <button onClick={() => { setStep('enter'); setCode(''); setErr(null); }} disabled={busy} style={{ background: 'none', border: 0, color: GOLD, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
            Change number
          </button>
        </div>

        <button onClick={cancel} disabled={busy} style={{ width: '100%', marginTop: 16, background: 'none', border: 0, color: MUTED, fontSize: 13, cursor: 'pointer', padding: 8 }}>
          Cancel — keep my current number
        </button>

        <p style={{ fontSize: 11.5, color: MUTED, marginTop: 16, textAlign: 'center', lineHeight: 1.5 }}>
          Your current number stays active until this code is verified.
        </p>
      </div>
    );
  }

  return null;
}
