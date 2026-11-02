// AcceptInviteScreen.tsx (pos-web) — cross-app host of the invitee accept flow so tenant staff who land on the POS
// origin can redeem an invitation. Mirrors the admin-web page: reads ?token=, the invitee sets their OWN password
// (≥10, confirmed), posts to the public accept endpoint, honest error states, success → sign in. Identity is set by
// the token server-side; this page never sends a user id.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { posPublicApi } from '../api/posPublicApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const MIN_LEN = 10;
const cardBox: React.CSSProperties = { background: 'var(--card, #FFFCF6)', border: '1px solid var(--line)', borderRadius: 14, padding: 24, width: 'min(440px, 96vw)' };

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
    if (pw && pw.length < MIN_LEN) e.push(t('admin.invite.minLength', { n: String(MIN_LEN) }));
    if (confirm && pw !== confirm) e.push(t('admin.invite.mismatch'));
    return e;
  }, [pw, confirm]);
  const ready = !!token && pw.length >= MIN_LEN && pw === confirm && !busy;

  const submit = () => {
    if (!ready) return;
    setBusy(true); setErr(null);
    posPublicApi.acceptInvitation({ token, password: pw, ...(fullName.trim() ? { fullName: fullName.trim() } : {}) })
      .then((r) => setDone({ email: r.email }))
      .catch((e: any) => setErr(e?.message || t('pos.we_couldn_t_accept_this_invitation')))
      .finally(() => setBusy(false));
  };

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--page, #F7EFE3)', padding: 20 }}>
      <div style={cardBox}>
        <div style={{ textAlign: 'center', fontFamily: "'Playfair Display', serif", fontSize: 18, color: 'var(--g7, #A96F22)', marginBottom: 14 }}>{t('pos.ai_powersalon')}</div>
        {children}
      </div>
    </div>
  );

  if (!token) return shell(
    <>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, marginBottom: 6 }}>{t('pos.invitation_link_invalid')}</h1>
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('pos.this_link_is_missing_its_invitation_9oe6')}</div>
    </>,
  );

  if (done) return shell(
    <>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, marginBottom: 6 }}>{t('pos.you_re_all_set')}</h1>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>{t('pos.your_account')}{' '}<b>{done.email}</b> {t('pos.is_now_active_sign_in_with_ptjm')}</div>
      <a className="btn" href="/" style={{ display: 'inline-block', textDecoration: 'none' }}>{t('pos.go_to_sign_in')}</a>
    </>,
  );

  return shell(
    <>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, marginBottom: 6 }}>{t('pos.accept_your_invitation')}</h1>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>{t('pos.set_a_password_to_activate_your_1j1q')}</div>
      {err ? <div className="err" style={{ marginBottom: 12 }}>{err}</div> : null}
      <label style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{t('pos.full_name_optional')}</div>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('pos.your_name')} style={{ width: '100%', padding: '9px 10px' }} />
      </label>
      <label style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{t('pos.create_password')}</div>
        <input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('pos.at_least_min_len_characters', { MIN_LEN: String(MIN_LEN) })} style={{ width: '100%', padding: '9px 10px' }} />
      </label>
      <label style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
        <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{t('pos.confirm_password')}</div>
        <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={t('pos.re_enter_password')} style={{ width: '100%', padding: '9px 10px' }} />
      </label>
      <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 12px', cursor: 'pointer' }}>
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> {t('pos.show_password')}
      </label>
      {pwErrors.length ? <div style={{ fontSize: 11.5, color: 'var(--danger, #B85B4D)', marginBottom: 10 }}>{pwErrors.join(' ')}</div> : null}
      <button className="btn" disabled={!ready} style={!ready ? { opacity: 0.5, width: '100%' } : { width: '100%' }} onClick={submit}>{busy ? t('pos.activating') : t('pos.activate_account')}</button>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'center' }}>{t('pos.your_password_is_set_by_you_h0a3')}</div>
    </>,
  );
}
