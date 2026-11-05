import { useCallback, useEffect, useState } from 'react';
import { posFollowUpApi, type FollowUpSettings } from '../api/posFollowUpApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

// Settings > End-of-Day Follow-Ups. Reads/writes the real /pos/follow-ups/settings (scoped to this branch server-side).
// Branch timezone is shown read-only (it comes from Store Hours); the generation time + toggles are editable. Desktop-fit:
// a single internal-scroll .work column. Honest save/error states; no fabricated values.
const TIME_OPTS = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'];
const EXPIRE_OPTS: { v: number; label: string }[] = [
  { v: 0, get label() { return tx('pos.never_2'); } }, { v: 12, get label() { return tx('pos.after_12_hours'); } }, { v: 24, get label() { return tx('pos.after_24_hours'); } }, { v: 48, get label() { return tx('pos.after_48_hours'); } }, { v: 72, get label() { return tx('pos.after_72_hours'); } },
];
const labelTime = (t: string) => { const [h, m] = t.split(':'); let hh = Number(h); const ap = hh < 12 ? 'AM' : 'PM'; hh = hh % 12 || 12; return `${hh}:${m} ${ap}`; };

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <div><div className="t">{label}</div>{hint ? <div className="s">{hint}</div> : null}</div>
      <button className={'btn' + (on ? '' : ' ghost')} onClick={() => onChange(!on)} aria-pressed={on}>{on ? tx('pos.on') : tx('pos.off')}</button>
    </div>
  );
}

export function EndOfDayFollowUpSettings() {
  const [s, setS] = useState<FollowUpSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    posFollowUpApi.getSettings().then((r) => { setS(r); setError(null); }).catch((e: { message?: string }) => setError(e?.message || tx('pos.failed_to_load_settings')));
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = (p: Partial<FollowUpSettings>) => setS((cur) => (cur ? { ...cur, ...p } : cur));
  const save = async () => {
    if (!s) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const saved = await posFollowUpApi.saveSettings({
        enabled: s.enabled, generationTime: s.generationTime, allowTechEditMessage: s.allowTechEditMessage,
        allowCustomerReplies: s.allowCustomerReplies, requireManagerApproval: s.requireManagerApproval,
        reminderToTech: s.reminderToTech, createMode: s.createMode, autoExpirePendingHours: s.autoExpirePendingHours,
      });
      setS(saved); setNote(tx('pos.settings_saved'));
    } catch (e) { setError((e as { message?: string })?.message || tx('pos.could_not_save_settings')); }
    finally { setBusy(false); }
  };

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.end_of_day_follow_ups')}</h1>
        <div className="sub mb-3">{tx('pos.when_and_how_this_salon_generates_k18z')}</div>
      </div>

      {error ? <div className="err" style={{ marginBottom: 12 }}>{error}</div> : null}
      {note ? <div className="muted" style={{ marginBottom: 10 }}>{note}</div> : null}

      {!s ? <div className="muted">{tx('pos.loading')}</div> : (
        <section className="panel" style={{ maxWidth: 640 }}>
          <div className="list" style={{ maxHeight: 'none', gap: 10 }}>
            <Toggle label={tx('pos.enable_end_of_day_follow_ups')} hint={tx('pos.generate_a_daily_follow_up_list_uull')} on={s.enabled} onChange={(v) => patch({ enabled: v })} />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><div className="t">{tx('pos.daily_generation_time')}</div><div className="s">{tx('pos.branch_local_time')}{s.timezone})</div></div>
              <select value={s.generationTime} onChange={(e) => patch({ generationTime: e.target.value })}
                style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', background: '#FFFDF8', fontWeight: 700 }}>
                {(TIME_OPTS.includes(s.generationTime) ? TIME_OPTS : [s.generationTime, ...TIME_OPTS]).map((t) => <option key={t} value={t}>{labelTime(t)}</option>)}
              </select>
            </div>
            <Toggle label={tx('pos.allow_tech_to_edit_message_before_138u')} on={s.allowTechEditMessage} onChange={(v) => patch({ allowTechEditMessage: v })} />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><div className="t">{tx('pos.auto_remove_unsent_follow_ups')}</div><div className="s">{tx('pos.clear_tasks_a_tech_never_sent_9zvv')}</div></div>
              <select value={s.autoExpirePendingHours} onChange={(e) => patch({ autoExpirePendingHours: Number(e.target.value) })}
                style={{ height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', background: '#FFFDF8', fontWeight: 700 }}>
                {(EXPIRE_OPTS.some((o) => o.v === s.autoExpirePendingHours) ? EXPIRE_OPTS : [{ v: s.autoExpirePendingHours, label: tx('pos.after_autoexpirependinghours_hours', { autoExpirePendingHours: String(s.autoExpirePendingHours) }) }, ...EXPIRE_OPTS]).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <Toggle label={tx('pos.allow_customer_replies')} on={s.allowCustomerReplies} onChange={(v) => patch({ allowCustomerReplies: v })} />
            <Toggle label={tx('pos.require_manager_approval_before_sending')} on={s.requireManagerApproval} onChange={(v) => patch({ requireManagerApproval: v })} />
            <Toggle label={tx('pos.reminder_notification_to_technician')} hint={tx('pos.notify_each_tech_when_their_list_n3r5')} on={s.reminderToTech} onChange={(v) => patch({ reminderToTech: v })} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" disabled={busy} onClick={save}>{busy ? tx('pos.saving_2') : tx('pos.save_settings')}</button>
          </div>
        </section>
      )}
    </div>
  );
}
