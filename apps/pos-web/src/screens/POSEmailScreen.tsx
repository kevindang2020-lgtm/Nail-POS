// POSEmailScreen.tsx — Email settings (Communications → Email and Integrations → Email). Reuses the real
// notification settings (GET/PATCH /pos/settings/notifications-reminders) and surfaces the email-relevant
// parts the send path actually uses: the sender ("from") name, whether booking confirmations go out by email,
// and whether receipts are emailed. Honest about delivery — without an email provider configured, messages
// are recorded but not sent. Read-only users can view but not save (server enforces edit rights).
import { useCallback, useEffect, useState } from 'react';
import { posSettingsApi } from '../api/posSettingsApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
// the success note is a sentinel, worded at render in the cashier's language (Vietnamese POS mandate §59)
const NOTE_OK = '\u0000ok';

type Notif = { emailConfirmation: boolean; senderBrand: string; receiptDelivery: string[] };

export function POSEmailScreen() {
  const [loaded, setLoaded] = useState<Notif | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [senderBrand, setSenderBrand] = useState('');
  const [emailConfirmation, setEmailConfirmation] = useState(false);
  const [emailReceipts, setEmailReceipts] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s: any = await posSettingsApi.getCategory('notifications-reminders');
      setLoaded(s); setSenderBrand(s?.senderBrand ?? '');
      setEmailConfirmation(!!s?.emailConfirmation);
      setEmailReceipts(Array.isArray(s?.receiptDelivery) && s.receiptDelivery.map((x: string) => x.toLowerCase()).includes('email'));
    } catch (e: any) { setError(reportError(e, t('admin.email.noun'))); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setNote(null);
    try {
      const existing: string[] = Array.isArray(loaded?.receiptDelivery) ? loaded!.receiptDelivery : [];
      const others = existing.filter((x) => x.toLowerCase() !== 'email');
      const receiptDelivery = emailReceipts ? [...others, 'Email'] : others;
      const s: any = await posSettingsApi.updateCategory('notifications-reminders', { senderBrand: senderBrand.trim(), emailConfirmation, receiptDelivery });
      setLoaded(s); setNote(NOTE_OK);
    } catch (e: any) { setNote(e?.message || t('pos.could_not_save_you_may_not_1wm7')); }
    finally { setSaving(false); }
  };

  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!loaded) return <div className="work"><div className="state">{t('pos.loading_email_settings')}</div></div>;

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.email')}</h1><div className="sub">{t('pos.how_your_salon_emails_customers')}</div></div>

      <section className="panel" style={{ marginTop: 6, maxWidth: 560 }}>
        <label style={{ fontSize: 13 }}>{t('pos.sender_name')}
          <div className="sub" style={{ fontSize: 12, marginTop: 2 }}>{t('pos.shown_as_the_from_name_on_mcx8')}</div>
          <input value={senderBrand} onChange={(e) => setSenderBrand(e.target.value)} placeholder={t('pos.your_salon')} style={{ width: '100%', padding: 8, marginTop: 6 }} />
        </label>

        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={emailConfirmation} onChange={(e) => setEmailConfirmation(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span>{t('pos.send_booking_confirmations_by_email')}</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={emailReceipts} onChange={(e) => setEmailReceipts(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span>{t('pos.email_receipts_to_customers')}</span>
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
          <button className="btn" disabled={saving} onClick={save}>{saving ? t('pos.saving_2') : t('pos.save_email_settings')}</button>
          {note ? <span className="sub" role="status" style={{ color: note === NOTE_OK ? '#2E9E54' : '#C0392B', fontSize: 13 }}>{note === NOTE_OK ? t('pos.saved_2') : note}</span> : null}
        </div>
      </section>

      <div className="sub" style={{ fontSize: 12, marginTop: 12, maxWidth: 560, lineHeight: 1.6 }}>
        {t('pos.email_delivery_uses_your_configured_email_1yjy')}
      </div>
    </div>
  );
}
