// POSPhoneScreen.tsx — Phone integration status (Communications → Phone and Integrations → Phone). Read-only
// and honest: shows the salon's real registered messaging number and A2P 10DLC carrier-registration status
// from the existing messaging backend. Voice/SMS provisioning (buying a number, credentials, test message)
// lives in Messaging Setup — this page links there rather than duplicating a config form. Nothing is faked;
// unset values show as an honest not-configured state.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posPhoneApi } from '../api/posPhoneApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Num = { configured: boolean; usingOwnAccount: boolean; registeredNumber: string | null };
type A2P = { senderBrand: string; a2pStatus: string };
const A2P_LABEL: Record<string, { text: string; color: string }> = {
  registered: { get text() { return t('pos.registered'); }, color: '#2E9E54' },
  pending: { get text() { return t('pos.pending_review'); }, color: '#B5651D' },
  not_registered: { get text() { return t('pos.not_registered'); }, color: '#9A6a2a' },
  rejected: { get text() { return t('pos.rejected_2'); }, color: '#C0392B' },
};

export function POSPhoneScreen() {
  const nav = useNavigate();
  const [num, setNum] = useState<Num | null>(null);
  const [a2p, setA2p] = useState<A2P | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [n, a] = await Promise.all([posPhoneApi.number().catch(() => null), posPhoneApi.a2p().catch(() => null)]);
      setNum(n as Num); setA2p(a as A2P);
    } catch (e: any) { setError(reportError(e, t('growth.noun.phone'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_phone_status')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;

  const hasNumber = !!num?.registeredNumber;
  const a2pInfo = a2p ? (A2P_LABEL[a2p.a2pStatus] ?? { text: a2p.a2pStatus, color: '#666' }) : null;

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.phone_messaging_number')}</h1><div className="sub">{t('pos.your_salon_s_text_voice_number_q8or')}</div></div>

      <section className="panel" style={{ marginTop: 6, maxWidth: 620 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: hasNumber ? '#2E9E54' : '#B5651D', display: 'inline-block' }} />
          <span style={{ fontWeight: 800, fontSize: 15 }}>{hasNumber ? num!.registeredNumber : t('pos.no_number_connected_yet')}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-2 sm:gap-x-4 sm:gap-y-2 mt-3.5" style={{ fontSize: 13.5 }}>
          <div className="sub">{t('pos.messaging_account')}</div><div>{num?.configured ? (num.usingOwnAccount ? t('pos.connected_your_twilio_account') : t('growth.phone.connected')) : t('pos.not_connected_2')}</div>
          <div className="sub">{t('pos.number')}</div><div>{num?.registeredNumber || '—'}</div>
          <div className="sub">{t('pos.a2p_10dlc_brand')}</div><div>{a2p?.senderBrand || '—'}</div>
          <div className="sub">{t('pos.a2p_registration')}</div><div>{a2pInfo ? <span style={{ color: a2pInfo.color, fontWeight: 700 }}>{a2pInfo.text}</span> : '—'}</div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => nav('/tenant/communications/messaging-setup')}>{t('pos.open_messaging_setup')}</button>
        </div>
      </section>

      <div className="sub" style={{ fontSize: 12, marginTop: 12, maxWidth: 620, lineHeight: 1.6 }}>
        {t('pos.buying_a_number_entering_twilio_credentials_es6v')}
      </div>
    </div>
  );
}
