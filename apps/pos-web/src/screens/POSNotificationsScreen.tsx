// POSNotificationsScreen.tsx — Communications → Notifications. The tenant's recent notification send
// activity and opt-out (unsubscribe) list, reusing the pos/notifications backend. Two views: Activity
// (send log: channel, recipient, status, reason, time) and Opt-outs (compliance list + re-subscribe).
import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posNotificationsApi } from '../api/posNotificationsApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';

import { statusLabel } from '../i18n/status-label';
type LogRow = { id: string; channel: string; toAddress: string; subject: string | null; status: string; failureReason: string | null; createdAt: string };
type OptOut = { channel: string; address: string; reason: string | null; optedOutAt: string };

const fmtTime = (iso?: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(displayLocale(), { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
const statusChip = (status: string) => {
  const m: Record<string, { bg: string; fg: string }> = {
    sent: { bg: '#E9F6EC', fg: '#2E9E54' }, delivered: { bg: '#E9F6EC', fg: '#2E9E54' }, queued: { bg: '#EAF2FB', fg: '#2D6CBF' },
    blocked: { bg: '#FEF2E7', fg: '#B5651D' }, failed: { bg: '#FDEEEE', fg: '#C0392B' },
  };
  const s = m[status] || { bg: '#F0F0F0', fg: '#666' };
  return <span style={{ padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: s.bg, color: s.fg }}>{status[0].toUpperCase() + status.slice(1)}</span>;
};
const reasonLabel = (r: string | null) => !r ? '' : ({} as Record<string, string>)[r] || statusLabel('notificationFailure', r);

export function POSNotificationsScreen() {
  const [tab, setTab] = useState<'activity' | 'optouts'>('activity');
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [optOuts, setOptOuts] = useState<OptOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [l, o] = await Promise.all([posNotificationsApi.recent(50), posNotificationsApi.optOuts(100)]);
      setLog((l?.items || []) as LogRow[]); setOptOuts((o?.items || []) as OptOut[]);
    } catch (e: any) { setError(reportError(e, 'notifications')); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const resubscribe = async (o: OptOut) => {
    setBusy(o.channel + o.address); setNote(null);
    try { await posNotificationsApi.optIn(o.channel as 'sms' | 'email', o.address); await load(); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_re_subscribe')); }
    finally { setBusy(null); }
  };

  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!log || !optOuts) return <div className="work"><div className="state">{t('pos.loading_notifications')}</div></div>;

  const sent = log.filter((r) => r.status === 'sent' || r.status === 'delivered').length;
  const blocked = log.filter((r) => r.status === 'blocked' || r.status === 'failed').length;

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.notifications')}</h1><div className="sub">{t('pos.sms_email_activity_and_unsubscribes')}</div></div>

      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.sent_recent')}</div><div className="v" style={{ color: '#2E9E54' }}>{sent}</div></div>
        <div className="kpi"><div className="l">{t('pos.blocked_failed')}</div><div className="v" style={{ color: blocked > 0 ? '#C0392B' : undefined }}>{blocked}</div></div>
        <div className="kpi"><div className="l">{t('pos.opt_outs')}</div><div className="v">{optOuts.length}</div></div>
      </div>

      <div className="seg" style={{ marginTop: 12 }}>
        <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>{t('pos.activity')}</button>
        <button className={tab === 'optouts' ? 'on' : ''} onClick={() => setTab('optouts')}>{t('pos.opt_outs')}</button>
      </div>
      {note ? <div className="err" style={{ marginTop: 10 }}>{note}</div> : null}

      {tab === 'activity' ? (
        <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
          {log.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_notifications_sent_yet')}</div> : (
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                <table className="tbl">
                  <thead><tr><th>{t('pos.when')}</th><th>{t('pos.channel')}</th><th>{t('pos.recipient')}</th><th>{t('pos.status')}</th><th>{t('pos.detail')}</th></tr></thead>
                  <tbody>{log.map((r) => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.createdAt)}</td>
                      <td style={{ textTransform: 'uppercase', fontSize: 12, fontWeight: 700 }}>{codeLabel('admin.comms.channel', r.channel)}</td>
                      <td>{r.toAddress}</td>
                      <td>{statusChip(r.status)}</td>
                      <td className="sub" style={{ fontSize: 12.5 }}>{reasonLabel(r.failureReason) || (r.subject || '')}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
          {optOuts.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_opt_outs_everyone_is_subscribed')}</div> : (
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                <table className="tbl">
                  <thead><tr><th>{t('pos.recipient')}</th><th>{t('pos.channel')}</th><th>{t('pos.reason_2')}</th><th>{t('pos.since_2')}</th><th style={{ width: 140 }}></th></tr></thead>
                  <tbody>{optOuts.map((o) => (
                    <tr key={o.channel + o.address}>
                      <td style={{ fontWeight: 700 }}>{o.address}</td>
                      <td style={{ textTransform: 'uppercase', fontSize: 12, fontWeight: 700 }}>{codeLabel('admin.comms.channel', o.channel)}</td>
                      <td className="sub" style={{ fontSize: 12.5 }}>{o.reason || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(o.optedOutAt)}</td>
                      <td style={{ textAlign: 'right' }}><button className="btn ghost" disabled={busy === o.channel + o.address} onClick={() => resubscribe(o)}>{t('pos.re_subscribe')}</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
          <div className="sub" style={{ fontSize: 12, padding: '0 14px 12px' }}>{t('pos.opt_outs_are_honored_automatically_a_h1cz')}</div>
        </section>
      )}
    </div>
  );
}
