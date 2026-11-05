// POSIntegrationsScreen.tsx — Integrations → Apps. An honest, read-only overview of the services AIPowerSalon
// actually integrates with, aggregating REAL statuses already exposed elsewhere: the payment processor
// (/pos/payment-gateway/status), text messaging (/tenant/messaging/number), phone/A2P registration
// (notifications-reminders/a2p-status), and email (notification settings). Every row reflects real config and
// links to where it's managed — there is NO fake connector marketplace and no button that pretends to connect
// a service that isn't wired.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posPaymentGatewayApi } from '../api/posPaymentGatewayApi';
import { posPhoneApi } from '../api/posPhoneApi';
import { posSettingsApi } from '../api/posSettingsApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

// labels are thunks, read at render — rows live in state, and a language switch must re-label them in place
type Row = { name: () => string; category: () => string; status: 'connected' | 'partial' | 'not_connected'; detail: () => string; manage: string };

const chip = (s: Row['status']) => {
  const map = { connected: { t: t('pos.connected_2'), c: '#2E9E54' }, partial: { t: t('pos.needs_setup'), c: '#B5651D' }, not_connected: { t: t('pos.not_connected_2'), c: '#9A6a2a' } }[s];
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: map.c, display: 'inline-block' }} /><span style={{ color: map.c, fontWeight: 700, fontSize: 12.5 }}>{map.t}</span></span>;
};

export function POSIntegrationsScreen() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [gw, num, a2p, notif] = await Promise.all([
      posPaymentGatewayApi.status().catch(() => null),
      posPhoneApi.number().catch(() => null),
      posPhoneApi.a2p().catch(() => null),
      (posSettingsApi.getCategory('notifications-reminders') as Promise<any>).catch(() => null),
    ]);
    const out: Row[] = [];
    // Payment processor
    if (gw) {
      const connected = !gw.setupRequired && gw.processorType !== 'none';
      out.push({ name: () => (gw.processorType && gw.processorType !== 'none' ? gw.processorType.charAt(0).toUpperCase() + gw.processorType.slice(1) : t('pos.card_processing')), category: () => t('admin.integrations.category.payments'), status: connected ? 'connected' : 'not_connected', detail: () => (connected ? t('pos.taking_card_payments') : t('pos.set_up_during_onboarding')), manage: '/tenant/integrations/payment-gateway' });
    }
    // Text messaging
    if (num !== null) {
      const connected = !!num?.registeredNumber && !!num?.configured;
      out.push({ name: () => t('admin.integrations.textMessaging'), category: () => t('admin.integrations.category.messaging'), status: connected ? 'connected' : num?.configured ? 'partial' : 'not_connected', detail: () => (num?.registeredNumber ? String(num.registeredNumber) : t('pos.no_number_connected')), manage: '/tenant/integrations/sms' });
    }
    // Phone / A2P registration
    if (a2p) {
      const reg = a2p.a2pStatus === 'registered';
      out.push({ name: () => t('admin.integrations.a2p'), category: () => t('admin.integrations.category.messaging'), status: reg ? 'connected' : a2p.a2pStatus === 'pending' ? 'partial' : 'not_connected', detail: () => (reg ? t('admin.integrations.carrierRegistered') : a2p.a2pStatus === 'pending' ? t('pos.pending_carrier_review') : t('pos.not_registered')), manage: '/tenant/integrations/phone' });
    }
    // Email
    if (notif) {
      const hasSender = !!(notif.senderBrand && String(notif.senderBrand).trim());
      out.push({ name: () => t('admin.integrations.email'), category: () => t('admin.integrations.category.messaging'), status: hasSender ? 'connected' : 'partial', detail: () => (hasSender ? t('pos.sender_senderbrand', { senderBrand: String(notif.senderBrand) }) : t('pos.sender_name_not_set')), manage: '/tenant/integrations/email' });
    }
    setRows(out); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_integrations')}</div></div>;

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.integrations')}</h1><div className="sub mb-3">{t('pos.services_your_salon_connects_to')}</div></div>

      <section className="panel mb-3" style={{ padding: 0, overflow: 'hidden' }}>
        {!rows || rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_integration_status_available_right_now')}</div> : (
          <div className="overflow-x-auto w-full">
            <table className="tbl w-full min-w-max">
              <thead><tr><th>{t('pos.service_3')}</th><th>{t('pos.category')}</th><th>{t('pos.status')}</th><th>{t('pos.detail')}</th><th></th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.manage}>
                  <td style={{ fontWeight: 700 }}>{r.name()}</td>
                  <td className="sub" style={{ fontSize: 12.5 }}>{r.category()}</td>
                  <td>{chip(r.status)}</td>
                  <td className="sub" style={{ fontSize: 12.5 }}>{r.detail()}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn ghost whitespace-nowrap w-fit" onClick={() => nav(r.manage)}>{t('pos.manage')}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <div className="sub" style={{ fontSize: 12, marginTop: 12, maxWidth: 640, lineHeight: 1.6 }}>
        {t('pos.this_overview_reflects_the_real_status_gsn3')}
      </div>
    </div>
  );
}
