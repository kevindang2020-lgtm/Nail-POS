import { useState } from 'react';
import { api } from '../api/client';
import { t } from '@aipowersalon/mobile-sdk/i18n';

// Pre-auth password recovery. Posts to the EXISTING backend route POST /auth/password-reset/request
// ({ salonCode, phone }) — no new reset system. The response is deliberately tenant-safe: we always show the
// same confirmation whether or not the account exists, so this page can never be used to discover which store
// codes or phone numbers are registered. Rate limiting and the expiring token live in the backend service.
const GOLD = 'var(--brand-gold, #A96F22)';
const GOLD_DEEP = 'var(--brand-deep-gold, #84561A)';
const GOLD_BRONZE = 'var(--brand-bronze, #C9971B)';
const LINE = 'var(--brand-border, #E7DCC9)';
const TEXT = 'var(--brand-text, #2A2118)';
const MUTED = 'var(--brand-text-muted, #8A7A66)';
const SERIF = 'var(--brand-font-head, Georgia, "Times New Roman", serif)';

const inputStyle: React.CSSProperties = {
  width: '100%', height: 46, borderRadius: 10, border: `1px solid ${LINE}`, background: '#FFFDF8',
  padding: '0 14px', fontFamily: 'inherit', fontSize: 14.5, color: TEXT, outline: 'none',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 };

export function ForgotPasswordScreen() {
  const [salonCode, setSalonCode] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (!salonCode.trim() || !phone.trim()) { setErr(t('pos.enter_your_store_code_and_the_z87w')); return; }
    setBusy(true);
    try {
      await api.post('/auth/password-reset/request', { salonCode: salonCode.trim(), phone: phone.trim() });
      setSent(true);                       // always the same outcome — never reveals whether the account exists
    } catch (e: any) {
      const msg = e?.message || '';
      if (/network|fetch/i.test(msg)) setErr(t('pos.unable_to_connect_to_ai_powersalon_euqs'));
      else setSent(true);                  // even on a backend rejection we do not disclose account existence
    } finally { setBusy(false); }
  };

  return (
    <div className="aps-login" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--brand-page, #F7EFE3)', fontFamily: 'var(--brand-font-body, system-ui, sans-serif)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 448, background: '#FFFDF8', border: `1px solid ${LINE}`, borderRadius: 22, boxShadow: '0 20px 60px rgba(42,33,24,.10)', padding: '30px 32px 24px' }}>
        <img src="/brand/aipowersalon-logo.png" alt={t('pos.ai_powersalon')} width={100} style={{ width: 100, height: 'auto', display: 'block', margin: '0 auto 10px' }} draggable={false} />
        <h1 style={{ fontFamily: SERIF, fontSize: 27, color: TEXT, textAlign: 'center', margin: '6px 0 4px', fontWeight: 600 }}>{t('pos.reset_your_password')}</h1>

        {sent ? (
          <>
            <p style={{ textAlign: 'center', color: MUTED, fontSize: 14, lineHeight: 1.5, margin: '8px 0 20px' }}>
              {t('pos.if_an_account_matches_that_store_zzr8')}
            </p>
            <a href="/" style={{ display: 'flex', height: 47, alignItems: 'center', justifyContent: 'center', borderRadius: 11, border: `1px solid ${GOLD}`, color: GOLD_DEEP, textDecoration: 'none', fontSize: 14.5, fontWeight: 500, background: '#fff' }}>
              {t('pos.back_to_sign_in')}
            </a>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <p style={{ textAlign: 'center', color: MUTED, fontSize: 14, margin: '0 0 20px' }}>
              {t('pos.enter_your_store_code_and_the_z87w')}
            </p>
            {err ? <div role="alert" style={{ marginBottom: 13, padding: '10px 12px', borderRadius: 9, fontSize: 13.5, background: '#FBEDE9', border: '1px solid #F0D2C9', color: '#8F3226' }}>{err}</div> : null}

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="fp-store" style={labelStyle}>{t('pos.store_code')}</label>
              <input id="fp-store" style={inputStyle} placeholder={t('pos.enter_store_code')} value={salonCode}
                onChange={(e) => setSalonCode(e.target.value)} autoComplete="organization" spellCheck={false} />
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="fp-phone" style={labelStyle}>{t('pos.phone_number')}</label>
              <input id="fp-phone" style={inputStyle} type="tel" placeholder={t('pos.enter_your_phone_number')} value={phone}
                onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" />
            </div>

            <button type="submit" disabled={busy}
              style={{ width: '100%', height: 50, borderRadius: 11, border: 'none', cursor: busy ? 'default' : 'pointer',
                background: busy ? '#D6C097' : `linear-gradient(180deg, ${GOLD_BRONZE} 0%, ${GOLD} 55%, ${GOLD_DEEP} 100%)`,
                color: '#FFFDF8', fontSize: 16, fontFamily: SERIF, boxShadow: busy ? 'none' : '0 8px 20px rgba(169,111,34,.28)' }}>
              {busy ? t('pos.sending') : t('pos.send_reset_instructions')}
            </button>
            <a href="/" style={{ display: 'block', textAlign: 'center', marginTop: 14, color: GOLD, fontSize: 13.5, textDecoration: 'none', fontWeight: 500 }}>
              {t('pos.back_to_sign_in')}
            </a>
          </form>
        )}
      </div>
    </div>
  );
}
