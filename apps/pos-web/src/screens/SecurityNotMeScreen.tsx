// SecurityNotMeScreen.tsx — Constitution 3 Step 10a: where the "This wasn't me" link in a new-device alert lands. Pre-auth
// (the account may be compromised; no session is assumed). One tap: every device signed out, the new one blocked, then
// straight on to choosing a new password. The link's token is the only credential, and it works once.
import { useState } from 'react';
import { api } from '../api/client';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { errorTextOf } from '../i18n/error-text';

export function SecurityNotMeScreen() {
  const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') ?? '' : '';
  const [state, setState] = useState<{ phase: 'ask' | 'busy' | 'done' | 'error'; text?: string }>({ phase: token ? 'ask' : 'error' });
  const secure = async () => {
    setState({ phase: 'busy' });
    try { const r = await api.post<{ message: string }>('/public/security/not-me', { token }); setState({ phase: 'done', text: r.message }); }
    catch (e: any) { setState({ phase: 'error', text: errorTextOf(e, t('pos.that_did_not_work_sign_in_1abk')) }); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 440, width: '100%', background: 'var(--panel, #fff)', border: '1px solid var(--line)', borderRadius: 14, padding: 24 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>{t('pos.secure_your_account')}</h1>
        {state.phase === 'ask' && <>
          <p style={{ fontSize: 14 }}>{t('pos.a_new_device_signed_in_to_fc93')}</p>
          <button className="btn" onClick={secure}>{t('pos.it_wasn_t_me_secure_my_1yt0')}</button>
        </>}
        {state.phase === 'busy' && <p className="muted">{t('pos.securing_your_account')}</p>}
        {state.phase === 'done' && <>
          <p style={{ fontSize: 14 }} role="status">{state.text}</p>
          <a className="btn" href="/forgot-password">{t('pos.choose_a_new_password')}</a>
        </>}
        {state.phase === 'error' && <p className="err" role="alert" style={{ fontSize: 14 }}>{state.text ?? t('pos.this_link_is_incomplete_open_it_xr44')}</p>}
      </div>
    </div>
  );
}
