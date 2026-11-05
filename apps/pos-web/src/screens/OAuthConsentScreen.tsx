// OAuthConsentScreen.tsx — Constitution 3 Step 10d: where a partner app sends the salon's owner to connect it. The server
// validates the request first (registered app, exact return address, PKCE, grantable scopes) and says exactly what the app
// would be able to see; Allow sends the browser back to the app with a one-time code. Read-only access, revocable any time
// under Security & Access → Connected apps.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { errorTextOf } from '../i18n/error-text';

// an OAuth scope (a permission key) → what it lets the app see, read at render (admin.oauth.scope.<key>); unknown → the key
const scopeLabel = (s: string) => { const k = `admin.oauth.scope.${s}`; const l = t(k); return l !== k ? l : s; };
export function OAuthConsentScreen() {
  const params = typeof window !== 'undefined' ? Object.fromEntries(new URLSearchParams(window.location.search)) : {};
  const [info, setInfo] = useState<{ clientName: string; scopes: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<{ clientName: string; scopes: string[] }>('/oauth/authorize?' + new URLSearchParams(params as Record<string, string>).toString())
      .then(setInfo).catch((e: any) => setErr(errorTextOf(e, t('pos.this_connection_request_is_not_valid'))));
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const allow = async () => {
    setBusy(true);
    try { const r = await api.post<{ redirect: string }>('/oauth/authorize', params as Record<string, unknown>); window.location.assign(r.redirect); }
    catch (e: any) { setErr(errorTextOf(e, t('pos.could_not_connect'))); setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 480, margin: '40px auto', padding: 24, background: 'var(--panel, #fff)', border: '1px solid var(--line)', borderRadius: 14 }}>
      <h1 style={{ fontSize: 20, margin: '0 0 10px' }}>{t('pos.connect_an_app')}</h1>
      {err ? <p className="err" role="alert">{err}</p> : !info ? <p className="muted">{t('pos.checking_the_request')}</p> : <>
        <p style={{ fontSize: 14 }}><b>{info.clientName}</b> {t('pos.wants_to_connect_to_your_salon_8ztr')}</p>
        <ul style={{ fontSize: 14 }}>{info.scopes.map((s) => <li key={s}>{scopeLabel(s)}</li>)}</ul>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pos.it_cannot_change_anything_you_can_1etk')}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={allow} disabled={busy}>{busy ? t('pos.connecting') : t('pos.allow')}</button>
          <button className="btn ghost" onClick={() => window.history.back()} disabled={busy}>{t('pos.cancel')}</button>
        </div>
      </>}
    </div>
  );
}
