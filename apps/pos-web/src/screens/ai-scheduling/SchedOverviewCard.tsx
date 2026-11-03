// SchedOverviewCard.tsx — today at a glance: run the optimizer for the location's day (or one technician's day), the
// latest run's day measures (one utilization formula — workforce/tech-utilization, server-side), gaps / conflicts found,
// and how many recommendations wait on staff or on a customer. Runs are idempotent per click (one key per intent).
// Scheduling Optimizer guide (Nov 2026): the waiting / customer / failed / automation counts moved to the server-computed
// counters above the tabs (SchedCounters — they were three `limit=1` list calls and "waiting" counted review_required only);
// the blank space below now shows the newest recommendations (SchedQueueCard, compact).
import { useEffect, useState } from 'react';
import type { SchedRun, SchedSettingsView } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import { P, type SchedCardProps, card, cardHead, btnGold, muted, errText, okText, Stat, when, row, newKey, schedErrorText, pctNum, pretty } from './schedUi';
import { TechnicianPickerButton } from '../../components/TechnicianPickerButton';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { SchedQueueCard } from './SchedCenter';

export function SchedOverviewCard({ tick, can, onChanged, date, settings, onOpenRun, onSelectRec }: SchedCardProps & {
  date: string; settings: SchedSettingsView | null; onOpenRun: (runId: string) => void; onSelectRec: (id: string) => void;
}) {
  const [latest, setLatest] = useState<SchedRun | null | 'none'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tech, setTech] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.runs({ date, limit: 5 })
      .then((rs) => { setLatest(rs.find((r) => r.status === 'completed') ?? rs[0] ?? 'none'); setErr(null); })
      .catch((e) => setErr(schedErrorText(e, 'ops.sched.err.runs')));
  }, [date, tick]);

  const runNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const d = await api.runDay(tech ? { scope: 'technician_day', date, technicianId: tech, idempotencyKey: newKey() } : { scope: 'branch_day', date, idempotencyKey: newKey() });
      const n = d?.recommendations?.length ?? d?.run?.recommendationCount ?? 0;
      setMsg({ ok: true, text: tx('ops.sched.ok.runDone', { recs: n, gaps: d?.gaps?.length ?? 0, conflicts: d?.conflicts?.length ?? 0 }) });
      onChanged();
    } catch (e) { setMsg({ ok: false, text: schedErrorText(e, 'ops.sched.err.runFailed') }); } finally { setBusy(false); }
  };

  const eff = settings?.effective;
  const run = latest && latest !== 'none' ? latest : null;
  const m = run?.metrics;
  return (
    <section style={card} aria-label={tx('pos.overview')}>
      <div style={cardHead}>{tx('pos.today_8')}{' '}{date}</div>
      {eff && (!eff.enabled || eff.killed || eff.platformKilled) ? (
        <div role="alert" style={{ ...errText, marginBottom: 8 }} data-testid="sched-off">
          {eff.platformKilled ? tx('pos.the_optimizer_is_paused_platform_wide') : eff.killed ? tx('pos.the_emergency_stop_is_on_for_1a3d') : tx('pos.the_optimizer_is_switched_off_for_qbdy')} {tx('pos.suggestions_cannot_be_generated_until_it_xkbt')}
        </div>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
        <Stat label={tx('pos.utilization')} value={m ? pctNum(m.utilizationPct) : '—'} />
        <Stat label={tx('pos.idle_time')} value={m ? tx('pos.idlemin_min', { idleMin: String(Math.round(m.idleMin)) }) : '—'} />
        <Stat label={tx('pos.customer_wait')} value={m ? tx('pos.waitmin_min', { waitMin: String(Math.round(m.waitMin)) }) : '—'} />
        <Stat label={tx('pos.gaps_2')} value={run ? String(run.gapCount) : '—'} />
        <Stat label={tx('pos.conflicts_2')} value={run ? String(run.conflictCount) : '—'} tone={run && run.conflictCount > 0 ? '#B4451E' : undefined} />
      </div>
      {err ? <div style={errText}>{err}</div> : latest === 'none' ? <div style={{ ...muted, marginTop: 8 }}>{tx('pos.the_optimizer_has_not_run_for_1xaq')}</div>
        : run ? <div style={{ ...muted, marginTop: 8 }} data-testid="sched-last-run">
          {tx('pos.last_run')}{' '}{when(run.completedAt ?? run.startedAt)} · {run.trigger === 'manual' ? tx('pos.run_by_staff') : run.trigger === 'job' ? tx('pos.scheduled_scan') : tx('ops.sched.runBy.automation')} · {pretty(run.status)}
          {run.errorCode ? ` (${run.errorCode})` : ''} · <button style={{ background: 'none', border: 0, color: '#A96F22', cursor: 'pointer', padding: 0, font: 'inherit' }} onClick={() => onOpenRun(run.id)}>{tx('pos.see_gaps_conflicts')}</button>
        </div> : null}
      {can(P.generate) && (
        <div style={{ ...row, marginTop: 12 }}>
          {/* 200-technician §2: a server-paged, searchable picker — never the whole roster in a <select> */}
          <TechnicianPickerButton value={tech} emptyLabel={tx('pos.whole_location')} anyLabel={tx('pos.whole_location')} ariaLabel={tx('pos.run_for')} date={date}
            onChange={(id) => setTech(id)} />
          <button style={btnGold} disabled={busy} onClick={runNow}>{busy ? tx('pos.optimizing') : tx('pos.run_optimizer')}</button>
        </div>
      )}
      {msg ? <div role={msg.ok ? 'status' : 'alert'} style={{ ...(msg.ok ? okText : errText), marginTop: 6 }}>{msg.text}</div> : null}
      <div style={{ marginTop: 12 }}><SchedQueueCard compact tick={tick} onSelect={onSelectRec} /></div>
    </section>
  );
}
