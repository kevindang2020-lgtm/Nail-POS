import { useCallback, useEffect, useState } from 'react';
import { posFollowUpApi, type FollowUpListResult, type FollowUpTaskView } from '../api/posFollowUpApi';
import { useRealtime } from '../realtime/useRealtime';
import { FollowUpTechnicianSummary } from './FollowUpTechnicianSummary';
import { FollowUpTaskTable } from './FollowUpTaskTable';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { deviceToday } from '../lib/deviceToday';

// The manager Follow-Up Queue panel: date + technician + status filters, a "Generate Now" top-up, a by-technician
// summary, and the task table. Reads the real /pos/follow-ups (scoped to the manager's branch server-side); Send / Skip
// and Generate Now call the backend. Honest empty + error states; the unique index makes Generate Now safe to re-run.
const STATUS_FILTERS = [
  { key: '', get label() { return tx('pos.all'); } }, { key: 'pending', get label() { return tx('pos.pending'); } }, { key: 'sent', get label() { return tx('pos.sent'); } }, { key: 'skipped', get label() { return tx('pos.skipped'); } },
];
const todayIso = () => deviceToday();

export function FollowUpQueuePanel() {
  const [date, setDate] = useState(todayIso());
  const [status, setStatus] = useState('');
  const [techFilter, setTechFilter] = useState<string | undefined>(undefined);
  const [data, setData] = useState<FollowUpListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    posFollowUpApi.list({ date: date || undefined, status: status || undefined })
      .then((d) => { setData(d); setError(null); })
      .catch((e: { message?: string }) => setError(e?.message || tx('pos.failed_to_load_the_follow_up_yi6z')));
  }, [date, status]);
  useEffect(() => { load(); }, [load]);
  // Live updates: refetch when a follow-up is generated, sent, skipped, approved, or auto-expired anywhere in this branch.
  useRealtime('follow-ups', load);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key); setError(null); setNote(null);
    try { await fn(); if (ok) setNote(ok); load(); }
    catch (e) { setError((e as { message?: string })?.message || tx('pos.action_failed')); }
    finally { setBusy(null); }
  };

  const generate = () => act('gen', async () => {
    const r = await posFollowUpApi.generateNow();
    setNote(r.alreadyRan && r.created === 0 ? tx('pos.already_generated_for_businessdate_created_new_t5bw', { businessDate: String(r.businessDate), created: String(r.created) }) : tx('pos.generated_created_follow_up_plural_for_10v3', { created: String(r.created), plural: String(r.created === 1 ? '' : 's'), businessDate: String(r.businessDate) }));
  });
  const send = (t: FollowUpTaskView) => act(t.id, () => posFollowUpApi.send(t.id));
  const skip = (t: FollowUpTaskView) => act(t.id, () => posFollowUpApi.skip(t.id));
  const approve = (t: FollowUpTaskView) => act(t.id, () => posFollowUpApi.approve(t.id));

  const tasks = (data?.tasks ?? []).filter((t) => !techFilter || t.technicianId === techFilter);
  const s = data?.stats;

  return (
    <>
      <div className="kpis">
        <div className="kpi"><div className="l">{tx('pos.pending')}</div><div className="v" style={(s?.pending ?? 0) > 0 ? { color: 'var(--warn)' } : undefined}>{s ? s.pending : '—'}</div></div>
        <div className="kpi"><div className="l">{tx('pos.sent')}</div><div className="v">{s ? s.sent : '—'}</div></div>
        <div className="kpi"><div className="l">{tx('pos.skipped')}</div><div className="v">{s ? s.skipped : '—'}</div></div>
        <div className="kpi"><div className="l">{tx('pos.rebooked')}</div><div className="v">{s ? s.rebooked : '—'}</div></div>
        <div className="kpi"><div className="l">{tx('pos.total_today')}</div><div className="v">{s ? s.total : '—'}</div></div>
      </div>

      {error ? <div className="err" style={{ marginBottom: 12 }}>{error}</div> : null}
      {note ? <div className="muted" style={{ marginBottom: 10 }}>{note}</div> : null}

      <section className="panel" style={{ marginBottom: 14 }}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-3">
          <label className="s flex items-center">{tx('pos.date')}{' '}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginLeft: 6, height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', background: '#FFFDF8' }} /></label>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button key={f.key} className={'btn' + (status === f.key ? '' : ' ghost')} style={{ padding: '6px 10px' }} onClick={() => setStatus(f.key)}>{f.label}</button>
            ))}
          </div>
          <button className="btn sm:ml-auto w-full sm:w-auto mt-2 sm:mt-0" disabled={busy === 'gen'} onClick={generate}>{busy === 'gen' ? tx('pos.generating') : tx('pos.generate_now')}</button>
        </div>
        <FollowUpTechnicianSummary tasks={data?.tasks ?? []} activeTech={techFilter} onPick={setTechFilter} />
      </section>

      <section className="panel">
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{tx('pos.follow_up_tasks')}{techFilter ? tx('pos.filtered_by_technician') : ''}</h2>
        {!data ? <div className="muted">{tx('pos.loading')}</div> : <FollowUpTaskTable tasks={tasks} busy={busy} onSend={send} onSkip={skip} onApprove={approve} />}
      </section>
    </>
  );
}
