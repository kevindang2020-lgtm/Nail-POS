// AcceptInviteScreen.tsx — the invitee redeems their single-use invitation token and sets their OWN password
// (the admin never sets it). Pre-auth, standalone (no console shell). Reads ?token= from the URL, posts to the
// public accept endpoint, and on success routes the user to sign in. Honest, specific error states (expired / used /
// cancelled / invalid). Password rule mirrors the backend (≥10 chars) plus a local confirm-match check.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { publicApi } from '../api/publicApi';

const MIN_LEN = 10;

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
    publicApi.acceptInvitation({ token, password: pw, ...(fullName.trim() ? { fullName: fullName.trim() } : {}) })
      .then((r) => setDone({ email: r.email }))
      .catch((e: any) => setErr(e?.message || 'We couldn’t accept this invitation.'))
      .finally(() => setBusy(false));
  };

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--page,#F7EFE3)', padding: 20 }}>
      <div className="panel" style={{ width: 'min(440px, 96vw)', padding: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <img src="/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ height: 40 }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        </div>
        {children}
      </div>
    </div>
  );

  if (!token) return shell(
    <>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, marginBottom: 6 }}>Invitation link invalid</h1>
      <div className="muted" style={{ fontSize: 13 }}>This link is missing its invitation token. Please use the most recent link from your invitation, or ask your administrator to resend it.</div>
    </>,
  );

  if (done) return shell(
    <>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, marginBottom: 6 }}>You’re all set</h1>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>Your account <b>{done.email}</b> is now active. Sign in with the password you just chose.</div>
      <a className="btn" href="/" style={{ display: 'inline-block', textDecoration: 'none' }}>Go to sign in</a>
    </>,
  );

  return shell(
    <>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, marginBottom: 6 }}>Accept your invitation</h1>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>Set a password to activate your AI PowerSalon account. This invitation link can be used once.</div>
      {err ? <div className="err" style={{ marginBottom: 12 }}>{err}</div> : null}
      <label style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        <div className="muted" style={{ marginBottom: 4 }}>Full name (optional)</div>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" style={{ width: '100%', padding: '9px 10px' }} />
      </label>
      <label style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        <div className="muted" style={{ marginBottom: 4 }}>Create password</div>
        <input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={`At least ${MIN_LEN} characters`} style={{ width: '100%', padding: '9px 10px' }} />
      </label>
      <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
        <div className="muted" style={{ marginBottom: 4 }}>Confirm password</div>
        <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" style={{ width: '100%', padding: '9px 10px' }} />
      </label>
      <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 12px', cursor: 'pointer' }}>
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
      </label>
      {pwErrors.length ? <div className="muted" style={{ fontSize: 11.5, color: 'var(--danger,#B85B4D)', marginBottom: 10 }}>{pwErrors.join(' ')}</div> : null}
      <button className="btn" disabled={!ready} style={!ready ? { opacity: 0.5, width: '100%' } : { width: '100%' }} onClick={submit}>{busy ? 'Activating…' : 'Activate account'}</button>
      <div className="muted" style={{ fontSize: 11, marginTop: 10, textAlign: 'center' }}>Your password is set by you and stored only as a hash. The link expires and can be used once.</div>
    </>,
  );
}
