// POSRemindersScreen.tsx — Communications → Reminders. The tenant's appointment-reminder configuration,
// reusing GET/PATCH /pos/reminders (posRemindersApi). Owner-configurable: on/off, how far ahead to send,
// the send window, and the channel. Real config — no fabricated activity.
import { useCallback, useEffect, useState } from 'react';
import { posRemindersApi, type ReminderConfig } from '../api/posRemindersApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
// the success note is a sentinel, worded at render in the cashier's language (Vietnamese POS mandate §59)
const NOTE_OK = '\u0000ok';

const hoursFromMin = (m: number) => Math.round((m / 60) * 10) / 10;

export function POSRemindersScreen() {
  const [cfg, setCfg] = useState<ReminderConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // editable fields
  const [enabled, setEnabled] = useState(false);
  const [leadHours, setLeadHours] = useState('24');
  const [windowMinutes, setWindowMinutes] = useState('60');
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');

  const load = useCallback(async () => {
    setError(null);
    try {
      const c = await posRemindersApi.get();
      setCfg(c); setEnabled(!!c.enabled); setLeadHours(String(hoursFromMin(c.leadMinutes ?? 1440)));
      setWindowMinutes(String(c.windowMinutes ?? 60)); setChannel(c.channel === 'email' ? 'email' : 'sms');
    } catch (e: any) { setError(reportError(e, 'reminders')); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setNote(null);
    try {
      const leadMinutes = Math.max(0, Math.round(parseFloat(leadHours || '0') * 60));
      const win = Math.max(0, parseInt(windowMinutes, 10) || 0);
      const c = await posRemindersApi.update({ enabled, leadMinutes, windowMinutes: win, channel });
      setCfg(c); setNote(NOTE_OK);
    } catch (e: any) { setNote(e?.message || t('pos.could_not_save_2')); }
    finally { setSaving(false); }
  };

  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!cfg) return <div className="work"><div className="state">{t('pos.loading_reminders')}</div></div>;

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.appointment_reminders')}</h1><div className="sub">{t('pos.automatically_remind_customers_before_their_visit_1sgr')}</div></div>

      <section className="panel" style={{ marginTop: 6, maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--line)' }} onClick={() => setEnabled(!enabled)}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t('pos.send_appointment_reminders')}</div>
            <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>{t('pos.turn_on_automated_sms_or_email_d1ny')}</div>
          </div>
        </div>

        <div style={{ opacity: enabled ? 1 : 0.55, pointerEvents: enabled ? 'auto' : 'none' }}>
          <div className="lf">
            <label>{t('pos.lead_time_2')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" min="0" step="0.5" value={leadHours} onChange={(e) => setLeadHours(e.target.value)} style={{ width: 120 }} />
              <span className="sub">{t('pos.hours_before_the_appointment')}</span>
            </div>
          </div>
          <div className="lf">
            <label>{t('pos.send_window')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" min="0" value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} style={{ width: 120 }} />
              <span className="sub">{t('pos.minutes_window_width_to_check')}</span>
            </div>
          </div>
          <div className="lf">
            <label>{t('pos.channel')}</label>
            <select value={channel} onChange={(e) => setChannel(e.target.value as 'sms' | 'email')} style={{ width: '100%', maxWidth: 200 }}>
              <option value="sms">SMS</option>
              <option value="email">{t('pos.email')}</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <button className="btn" disabled={saving} onClick={save}>{saving ? t('pos.saving_2') : t('pos.save_reminders')}</button>
          {note ? <span className="sub" role="status" style={{ color: note === NOTE_OK ? '#2E9E54' : '#C0392B', fontSize: 13 }}>{note === NOTE_OK ? t('pos.saved_2') : note}</span> : null}
        </div>
      </section>

      <div className="sub" style={{ fontSize: 12, marginTop: 12, maxWidth: 560 }}>
        {t('pos.reminders_are_sent_by_a_scheduled_ukr6')}
      </div>
    </div>
  );
}
