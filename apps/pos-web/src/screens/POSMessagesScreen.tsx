import { useEffect, useState } from 'react';
import { posNotificationsApi, type NotifLogRow, type NotificationChannel, type OptOutRow } from '../api/posNotificationsApi';
import { posRemindersApi } from '../api/posRemindersApi';
import { feedbackForSend, type SendFeedback } from '../notifications/notificationsMessages';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { growthCode } from './growthLabels';

// POS Messages — tenant-facing SMS/email to customers. Compose + send (metered against the salon's messaging
// credits, opt-out enforced server-side) and a recent send log.
const fbColor: Record<string, string> = { success: 'var(--ok, #2e7d32)', warning: '#C9971B', error: 'var(--danger, #c0392b)' };
const statusColor: Record<string, string> = { sent: 'var(--ok, #2e7d32)', blocked: '#C9971B', failed: 'var(--danger, #c0392b)' };

export function POSMessagesScreen() {
  const [channel, setChannel] = useState<NotificationChannel>('sms');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<SendFeedback | null>(null);
  const [log, setLog] = useState<NotifLogRow[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [tab, setTab] = useState<'recent' | 'optouts' | 'reminders'>('recent');
  const [optOuts, setOptOuts] = useState<OptOutRow[]>([]);
  const [optOutsLoaded, setOptOutsLoaded] = useState(false);
  const [loadingOptOuts, setLoadingOptOuts] = useState(false);
  const [optChannel, setOptChannel] = useState<NotificationChannel>('sms');
  const [optAddr, setOptAddr] = useState('');
  const [optBusy, setOptBusy] = useState(false);
  const [optErr, setOptErr] = useState<string | null>(null);

  const loadOptOuts = () => {
    setLoadingOptOuts(true); setOptErr(null);
    posNotificationsApi.optOuts(200)
      .then((r) => setOptOuts(Array.isArray(r?.items) ? r.items : []))
      .catch(() => setOptOuts([]))
      .finally(() => { setLoadingOptOuts(false); setOptOutsLoaded(true); });
  };
  const addOptOut = async () => {
    setOptBusy(true); setOptErr(null);
    try { await posNotificationsApi.optOut(optChannel, optAddr.trim()); setOptAddr(''); loadOptOuts(); }
    catch (e: any) { setOptErr(e?.message || t('pos.could_not_add_opt_out')); }
    finally { setOptBusy(false); }
  };
  // Customer Notifications guide (741): re-subscribing needs a consent note (and a customer's STOP is undone only by their
  // START) — it is done in one place, Communications → Customer Notifications → Opt-outs, under those rules.
  const OPT_OUTS_ROUTE = '/tenant/communications/notifications?tab=optouts';

  // reminders config
  const [remEnabled, setRemEnabled] = useState(false);
  const [remLeadHours, setRemLeadHours] = useState(24);
  const [remChannel, setRemChannel] = useState<'sms' | 'email'>('sms');
  const [remLoaded, setRemLoaded] = useState(false);
  const [remBusy, setRemBusy] = useState(false);
  const [remMsg, setRemMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const loadReminders = () => {
    posRemindersApi.get()
      .then((c) => { setRemEnabled(!!c?.enabled); if (c?.leadMinutes) setRemLeadHours(Math.round(c.leadMinutes / 60)); if (c?.channel) setRemChannel(c.channel); })
      .catch(() => { /* keep defaults */ })
      .finally(() => setRemLoaded(true));
  };
  const saveReminders = async () => {
    setRemBusy(true); setRemMsg(null);
    try {
      const lead = Math.max(0, Math.round(remLeadHours)) * 60;
      const c = await posRemindersApi.update({ enabled: remEnabled, leadMinutes: lead, channel: remChannel });
      setRemEnabled(!!c?.enabled); if (c?.leadMinutes) setRemLeadHours(Math.round(c.leadMinutes / 60)); if (c?.channel) setRemChannel(c.channel);
      setRemMsg({ tone: 'success', text: t('pos.reminder_settings_saved') });
    } catch (e: any) {
      setRemMsg({ tone: 'error', text: e?.message || t('pos.could_not_save_settings') });
    } finally { setRemBusy(false); }
  };

  const loadLog = () => {
    setLoadingLog(true);
    posNotificationsApi.recent(50)
      .then((r) => setLog(Array.isArray(r?.items) ? r.items : []))
      .catch(() => setLog([]))
      .finally(() => setLoadingLog(false));
  };
  useEffect(loadLog, []);

  const canSend = to.trim().length > 0 && body.trim().length > 0 && !sending;

  const onSend = async () => {
    setSending(true); setFeedback(null);
    try {
      const res = await posNotificationsApi.send({ channel, to: to.trim(), subject: channel === 'email' ? subject.trim() || undefined : undefined, body: body.trim() });
      const fb = feedbackForSend(res);
      setFeedback(fb);
      if (res?.sent) { setBody(''); setSubject(''); loadLog(); }
    } catch (e: any) {
      setFeedback({ tone: 'error', message: e?.message || t('pos.could_not_send_the_message') });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="work">
      <div className="head"><h2>{t('pos.messages_2')}</h2><div className="muted mb-3">{t('pos.send_sms_or_email_to_customers_2hbn')}</div></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ gridTemplateRows: 'minmax(0,1fr)' }}>
        <section className="panel">
          <h3>{t('pos.compose')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={'btn' + (channel === 'sms' ? '' : ' ghost')} onClick={() => setChannel('sms')}>SMS</button>
              <button className={'btn' + (channel === 'email' ? '' : ' ghost')} onClick={() => setChannel('email')}>{t('pos.email')}</button>
            </div>
            <label className="s muted">{channel === 'sms' ? t('pos.recipient_phone_e_164_e_g_19bc') : t('pos.recipient_email')}</label>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === 'sms' ? '+15551234567' : 'guest@example.com'} />
            {channel === 'email' && (
              <>
                <label className="s muted">{t('pos.subject_optional')}</label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('pos.a_message_from_your_salon')} />
              </>
            )}
            <label className="s muted">{t('pos.message')}</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder={t('pos.type_your_message')} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn" disabled={!canSend} onClick={onSend}>{sending ? t('pos.sending') : t('pos.send_message_2')}</button>
              {feedback && <span className="s" style={{ color: fbColor[feedback.tone] }}>{feedback.message}</span>}
            </div>
          </div>
        </section>

        <section className="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h3 className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-2 sm:mb-0">
            <span className="flex flex-wrap gap-2">
              <button className={'btn' + (tab === 'recent' ? '' : ' ghost')} onClick={() => setTab('recent')}>{t('pos.recent_messages')}</button>
              <button className={'btn' + (tab === 'optouts' ? '' : ' ghost')} onClick={() => { setTab('optouts'); if (!optOutsLoaded) loadOptOuts(); }}>{t('pos.opt_outs')}</button>
              <button className={'btn' + (tab === 'reminders' ? '' : ' ghost')} onClick={() => { setTab('reminders'); if (!remLoaded) loadReminders(); }}>{t('pos.reminders')}</button>
            </span>
            {tab !== 'reminders' && <button className="btn ghost self-start sm:self-center shrink-0" onClick={() => (tab === 'recent' ? loadLog() : loadOptOuts())}>{t('pos.refresh')}</button>}
          </h3>

          {tab === 'recent' ? (
            loadingLog ? <div className="state muted">{t('pos.loading')}</div>
              : log.length === 0 ? <div className="state muted">{t('pos.no_messages_sent_yet')}</div>
              : (
                <div className="list" style={{ overflow: 'auto', minHeight: 0 }}>
                  {log.map((m) => (
                    <div className="row" key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="pill" style={{ textTransform: 'uppercase' }}>{growthCode(m.channel)}</span>
                      <div className="t" style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{m.toAddress}</div>
                        <div className="s muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.subject ? m.subject + ' — ' : ''}{m.body}</div>
                      </div>
                      <span className="s" style={{ color: statusColor[m.status], textTransform: 'capitalize' }}>{growthCode(m.status, 'notificationFailure')}{m.status !== 'sent' && m.failureReason ? ` (${m.failureReason})` : ''}</span>
                    </div>
                  ))}
                </div>
              )
          ) : tab === 'optouts' ? (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={optChannel} onChange={(e) => setOptChannel(e.target.value as NotificationChannel)} aria-label={t('pos.opt_out_channel')}>
                  <option value="sms">SMS</option><option value="email">{t('pos.email')}</option>
                </select>
                <input value={optAddr} onChange={(e) => setOptAddr(e.target.value)} placeholder={optChannel === 'sms' ? '+15551234567' : 'guest@example.com'} style={{ flex: 1, minWidth: 160 }} />
                <button className="btn" disabled={!optAddr.trim() || optBusy} onClick={addOptOut}>{t('pos.add_opt_out')}</button>
              </div>
              {optErr && <span className="s" style={{ color: 'var(--danger, #c0392b)' }}>{optErr}</span>}
              {loadingOptOuts ? <div className="state muted">{t('pos.loading')}</div>
                : optOuts.length === 0 ? <div className="state muted">{t('pos.no_opt_outs_recipients_who_opt_11x3')}</div>
                : (
                  <div className="list" style={{ overflow: 'auto', minHeight: 0 }}>
                    {optOuts.map((o) => (
                      <div className="row" key={o.channel + o.address} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="pill" style={{ textTransform: 'uppercase' }}>{growthCode(o.channel)}</span>
                        <div className="t" style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{o.address}</div>
                          {o.reason && <div className="s muted">{o.reason}</div>}
                        </div>
                        <a className="btn ghost" href={OPT_OUTS_ROUTE} data-testid="msg-optin-link">{t('pos.opt_in')}</a>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="s muted">{t('pos.automatically_text_customers_a_reminder_before_1s07')}</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={remEnabled} onChange={(e) => setRemEnabled(e.target.checked)} />
                <span style={{ fontWeight: 600 }}>{t('pos.enable_appointment_reminders')}</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="s">{t('pos.send')}</span>
                <input type="number" min={1} max={336} value={remLeadHours} onChange={(e) => setRemLeadHours(Number(e.target.value))} style={{ width: 72 }} disabled={!remEnabled} />
                <span className="s">{t('pos.hours_before_the_appointment')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="s">{t('pos.channel')}</span>
                <button className={'btn' + (remChannel === 'sms' ? '' : ' ghost')} disabled={!remEnabled} onClick={() => setRemChannel('sms')}>SMS</button>
                <button className={'btn' + (remChannel === 'email' ? '' : ' ghost')} disabled={!remEnabled} onClick={() => setRemChannel('email')}>{t('pos.email')}</button>
              </div>
              <div className="s muted">{remChannel === 'sms' ? t('pos.texts_the_mobile_number_on_the_8t28') : t('pos.emails_the_address_on_the_customer_1qrz')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="btn" disabled={remBusy} onClick={saveReminders}>{remBusy ? t('pos.saving_2') : t('pos.save_2')}</button>
                {remMsg && <span className="s" style={{ color: remMsg.tone === 'success' ? 'var(--ok, #2e7d32)' : 'var(--danger, #c0392b)' }}>{remMsg.text}</span>}
              </div>
              <div className="s muted">{t('pos.reminders_are_sent_by_a_scheduled_4d4i')}</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
