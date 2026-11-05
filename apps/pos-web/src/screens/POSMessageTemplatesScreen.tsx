// POSMessageTemplatesScreen.tsx — Communications → Templates. Reusable SMS/email message templates,
// reusing GET/POST /pos/settings/notifications-reminders/templates (real store). List, create, and edit
// templates the salon can reuse when messaging customers. Real data — no fabricated content.
import { useCallback, useEffect, useState } from 'react';
import { posMessageTemplatesApi, type MessageTemplate } from '../api/posMessageTemplatesApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';
// the success note is a sentinel, worded at render in the cashier's language (Vietnamese POS mandate §59)
const NOTE_OK = '\u0000ok';

const blank = { id: '', channel: 'sms' as 'sms' | 'email', name: '', body: '' };

export function POSMessageTemplatesScreen() {
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(blank);
  const editing = !!form.id;

  const load = useCallback(async () => {
    setError(null);
    try { const r = await posMessageTemplatesApi.list(); setTemplates(Array.isArray(r) ? r : []); }
    catch (e: any) { setError(reportError(e, 'templates')); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name.trim() || !form.body.trim()) { setNote(tx('pos.name_and_body_are_required')); return; }
    setSaving(true); setNote(null);
    try {
      await posMessageTemplatesApi.upsert({ id: form.id || undefined, channel: form.channel, name: form.name.trim(), body: form.body.trim() });
      setForm(blank); setNote(NOTE_OK); await load();
    } catch (e: any) { setNote(e?.message || tx('pos.could_not_save_the_template')); }
    finally { setSaving(false); }
  };
  const edit = (t: MessageTemplate) => { setForm({ id: t.id, channel: t.channel, name: t.name, body: t.body }); setNote(null); };

  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!templates) return <div className="work"><div className="state">{tx('pos.loading_templates')}</div></div>;

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{tx('pos.message_templates')}</h1><div className="sub">{tx('pos.reusable_sms_email_messages')}</div></div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-4 items-start">
        <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="p-h" style={{ padding: '14px 14px 0' }}>{tx('pos.your_templates')}</div>
          {templates.length === 0 ? <div className="state" style={{ padding: 16 }}>{tx('pos.no_templates_yet_create_one_on_1dpy')}</div> : (
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                <table className="tbl">
                  <thead><tr><th>{tx('pos.name')}</th><th>{tx('pos.channel')}</th><th>{tx('pos.preview')}</th><th></th></tr></thead>
                  <tbody>{templates.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 700 }}>{t.name}</td>
                      <td style={{ textTransform: 'uppercase', fontSize: 12, fontWeight: 700 }}>{codeLabel('admin.comms.channel', t.channel)}</td>
                      <td className="sub" style={{ fontSize: 12.5, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.body}</td>
                      <td style={{ textAlign: 'right' }}><button className="btn ghost" onClick={() => edit(t)}>{tx('pos.edit')}</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="p-h" style={{ marginBottom: 12 }}>{editing ? tx('pos.edit_template') : tx('pos.new_template')}</div>
          <div className="flex flex-col gap-0">
            <div className="lf">
              <label>{tx('pos.name')}</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tx('pos.e_g_appointment_confirmation')} style={{ width: '100%' }} />
            </div>
            <div className="lf">
              <label>{tx('pos.channel')}</label>
              <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as 'sms' | 'email' })} style={{ width: '100%' }}>
                <option value="sms">SMS</option>
                <option value="email">{tx('pos.email')}</option>
              </select>
            </div>
            <div className="lf" style={{ alignItems: 'flex-start' }}>
              <label style={{ marginTop: 10 }}>{tx('pos.message')}</label>
              <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={5} placeholder={tx('pos.hi_name_this_is_a_reminder_1piv')} style={{ width: '100%', resize: 'vertical', minHeight: 120 }} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
            <button className="btn" disabled={saving} onClick={save}>{saving ? tx('pos.saving_2') : editing ? tx('pos.update') : tx('pos.create_2')}</button>
            {editing ? <button className="btn ghost" onClick={() => { setForm(blank); setNote(null); }}>{tx('pos.cancel')}</button> : null}
            {note ? <span className="sub" role="status" style={{ color: note === NOTE_OK ? '#2E9E54' : '#C0392B', fontSize: 13 }}>{note === NOTE_OK ? tx('pos.saved_2') : note}</span> : null}
          </div>
        </section>
      </div>
      <div className="sub" style={{ fontSize: 12, marginTop: 12 }}>{tx('pos.templates_are_reused_when_sending_messages_1udo')}{' '}{'{name}'} {tx('pos.are_filled_in_per_recipient_at_11ok')}</div>
    </div>
  );
}
