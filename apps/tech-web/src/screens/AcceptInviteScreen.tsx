// AcceptInviteScreen.tsx (tech-web) — cross-app host of the invitee accept flow so a TECHNICIAN who lands on the tech
// origin can redeem an invitation. Same contract as the admin/POS pages; identity is set by the token server-side
// (this page never sends a user id). Self-styled (inline) so it renders correctly regardless of app CSS.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { techPublicApi } from '../api/techPublicApi';

const MIN_LEN = 10;
const GOLD = 'var(--g7, #A96F22)';
const card: React.CSSProperties = { background: 'var(--card, #FFFCF6)', border: '1px solid var(--line, #E9DAC4)', borderRadius: 14, padding: 24, width: 'min(440px, 96vw)' };
const input: React.CSSProperties = { width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--line, #E9DAC4)', background: '#fff' };
const primaryBtn = (enabled: boolean): React.CSSProperties => ({ width: '100%', padding: '10px 12px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontWeight: 700, cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5 });
const muted: React.CSSProperties = { color: 'var(--muted, #9B8B78)' };

export function AcceptInviteScreen() {
  const [params] = useSearchParams();
  const token = (params.get('token') || '').trim();
  const [fullName, setFullName] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string } | null>(null);

  const pwErrors = useMemo(() => {
    const e: string[] = [];
    if (pw && pw.length < MIN_LEN) e.push(`Use at least ${MIN_LEN} characters.`);
    if (confirm && pw !== confirm) e.push('Passwords don’t match.');
    return e;
  }, [pw, confirm]);
  const ready = !!token && pw.length >= MIN_LEN && pw === confirm && !busy;

  const submit = () => {
    if (!ready) return;
    setBusy(true); setErr(null);
    techPublicApi.acceptInvitation({ token, password: pw, ...(fullName.trim() ? { fullName: fullName.trim() } : {}) })
      .then((r) => setDone({ email: r.email }))
      .catch((e: any) => setErr(e?.message || 'We couldn’t accept this invitation.'))
      .finally(() => setBusy(false));
  };

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--page, #F7EFE3)', padding: 20 }}>
      <div style={card}>
        <div style={{ textAlign: 'center', fontFamily: "'Playfair Display', serif", fontSize: 18, color: GOLD, marginBottom: 14 }}>AI PowerSalon</div>
        {children}
      </div>
    </div>
  );

  if (!token) return shell(
    <>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, marginBottom: 6 }}>Invitation link invalid</h1>
      <div style={{ fontSize: 13, ...muted }}>This link is missing its invitation token. Please use the most recent link from your invitation, or ask your administrator to resend it.</div>
    </>,
  );

  if (done) return shell(
    <>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, marginBottom: 6 }}>You’re all set</h1>
      <div style={{ fontSize: 13, marginBottom: 14, ...muted }}>Your account <b>{done.email}</b> is now active. Sign in with the password you just chose.</div>
      <a href="/" style={{ ...primaryBtn(true), display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}>Go to sign in</a>
    </>,
  );

  return shell(
    <>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, marginBottom: 6 }}>Accept your invitation</h1>
      <div style={{ fontSize: 12.5, marginBottom: 14, ...muted }}>Set a password to activate your AI PowerSalon account. This invitation link can be used once.</div>
      {err ? <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, background: 'rgba(184,91,77,0.12)', color: 'var(--danger, #B85B4D)', fontSize: 12.5 }}>{err}</div> : null}
      <label style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        <div style={{ marginBottom: 4, ...muted }}>Full name (optional)</div>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" style={input} />
      </label>
      <label style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        <div style={{ marginBottom: 4, ...muted }}>Create password</div>
        <input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={`At least ${MIN_LEN} characters`} style={input} />
      </label>
      <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
        <div style={{ marginBottom: 4, ...muted }}>Confirm password</div>
        <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" style={input} />
      </label>
      <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 12px', cursor: 'pointer' }}>
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
      </label>
      {pwErrors.length ? <div style={{ fontSize: 11.5, color: 'var(--danger, #B85B4D)', marginBottom: 10 }}>{pwErrors.join(' ')}</div> : null}
      <button disabled={!ready} style={primaryBtn(ready)} onClick={submit}>{busy ? 'Activating…' : 'Activate account'}</button>
      <div style={{ fontSize: 11, marginTop: 10, textAlign: 'center', ...muted }}>Your password is set by you and stored only as a hash. The link expires and can be used once.</div>
    </>,
  );
}
