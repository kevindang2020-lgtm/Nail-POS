// SchedRunsCard.tsx — two views over optimization runs:
//  • SchedRunDetailCard ("Gaps & conflicts"): one run's gaps (breaks are NOT gaps — the server passes them to detection),
//    conflicts / understaffing with severity, and the recommendations it produced. Defaults to the latest run of the day.
//  • SchedHistoryCard ("History"): every run — who / what triggered it, status, latency, counts, versions.
import { useEffect, useState } from 'react';
import type { SchedRun, SchedRunDetail } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import {
  type SchedCardProps, card, cardHead, btnGhost, input, muted, errText, pill, when, hm, pretty, row, table, th, td,
  STATUS_LABEL, TYPE_LABEL, schedErrorText, SEV,
} from './schedUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codedText } from '../../i18n/coded-text';
import { schedConflictCoded } from '@aipowersalon/api-contracts/tenant';

export function SchedRunDetailCard({ tick, techName, runId, date, onSelectRec }: Pick<SchedCardProps, 'tick' | 'techName'> & {
  runId: string | null; date: string; onSelectRec: (id: string) => void;
}) {
  const [detail, setDetail] = useState<SchedRunDetail | null | 'none'>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setErr(null);
    const pick = runId ? Promise.resolve(runId) : api.runs({ date, limit: 5 }).then((rs) => (rs.find((r) => r.status === 'completed') ?? rs[0])?.id ?? null);
    pick.then((id) => (id ? api.run(id).then(setDetail) : setDetail('none'))).catch((e) => setErr(schedErrorText(e, 'ops.sched.err.run')));
  }, [runId, date, tick]);

  if (err) return <section style={card} aria-label={t('pos.gaps_and_conflicts')}><div style={errText}>{err}</div></section>;
  if (!detail) return <section style={card} aria-label={t('pos.gaps_and_conflicts')}><div style={muted}>{t('pos.loading')}</div></section>;
  if (detail === 'none') return <section style={card} aria-label={t('pos.gaps_and_conflicts')}><div style={cardHead}>{t('pos.gaps_conflicts')}</div><div style={muted}>{t('pos.no_run_for')}{' '}{date} {t('pos.yet_run_the_optimizer_from_overview')}</div></section>;
  const { run, gaps, conflicts, recommendations } = detail;
  return (
    <section style={{ ...card, display: 'grid', gap: 12 }} aria-label={t('pos.gaps_and_conflicts')}>
      <div style={cardHead}>{t('pos.gaps_conflicts')}{' '}<span style={muted}>{t('pos.run')}{' '}{when(run.startedAt)} · {run.date ?? ''}{run.technicianId ? ` · ${techName(run.technicianId)}` : ''}</span></div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t('pos.unused_gaps')}{gaps.length})</div>
        {gaps.length === 0 ? <div style={muted}>{t('pos.no_unused_gaps_breaks_are_not_1b8l')}</div> : (
          <table style={table}><thead><tr><th style={th}>{t('pos.technician')}</th><th style={th}>{t('pos.when')}</th><th style={th}>{t('pos.length')}</th><th style={th}>{t('pos.services_that_fit')}</th></tr></thead>
            <tbody>{gaps.map((g) => (
              <tr key={g.id} data-testid="sched-gap"><td style={td}>{techName(g.technicianId)}</td><td style={td}>{hm(g.startTime)}–{hm(g.endTime)}</td><td style={td}>{g.durationMin} {t('pos.min')}</td><td style={td}>{g.servicesThatFit.length ? g.servicesThatFit.join(', ') : '—'}{g.cause ? <div style={muted}>{pretty(g.cause)}</div> : null}</td></tr>
            ))}</tbody></table>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t('pos.conflicts_understaffing')}{conflicts.length})</div>
        {conflicts.length === 0 ? <div style={muted}>{t('pos.no_conflicts_found')}</div> : (
          <div style={{ display: 'grid', gap: 4 }}>{conflicts.map((c) => (
            <div key={c.id} data-testid="sched-conflict" style={{ ...row, fontSize: 12.5 }}>
              <span style={pill(SEV[c.severity].bg, SEV[c.severity].fg)}>{pretty(c.severity)}</span>
              <strong>{pretty(c.type)}</strong><span>{codedText(c.messageCoded ?? schedConflictCoded(c.type, c.message), c.message ?? '')}</span>
              {c.technicianId ? <span style={muted}>{techName(c.technicianId)}</span> : null}
              {c.appointmentIds.length ? <span style={muted}>{c.appointmentIds.length} {t('pos.appointment_s')}</span> : null}
              {c.resolved ? <span style={pill('#E4F0E7', '#3B6B47')}>{t('pos.resolved_3')}</span> : null}
            </div>
          ))}</div>
        )}
        <div style={{ ...muted, marginTop: 4 }}>{t('pos.the_optimizer_never_cancels_or_moves_rdhv')}</div>
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t('pos.recommendations_from_this_run')}{recommendations.length})</div>
        {recommendations.map((r) => (
          <button key={r.id} style={{ ...btnGhost, marginRight: 6, marginBottom: 6 }} onClick={() => onSelectRec(r.id)}>{TYPE_LABEL[r.type] ?? pretty(r.type)} · {STATUS_LABEL[r.status] ?? pretty(r.status)}</button>
        ))}
      </div>
    </section>
  );
}

export function SchedHistoryCard({ tick, techName, onOpenRun }: Pick<SchedCardProps, 'tick' | 'techName'> & { onOpenRun: (id: string) => void }) {
  const [date, setDate] = useState('');
  const [runs, setRuns] = useState<SchedRun[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.runs({ date: date || null, limit: 50 }).then((r) => { setRuns(r); setErr(null); }).catch((e) => setErr(schedErrorText(e, 'ops.sched.err.history'))); }, [date, tick]);
  return (
    <section style={card} aria-label={t('pos.run_history')}>
      <div style={cardHead}>{t('pos.optimization_history')}{' '}<input type="date" aria-label={t('pos.history_date')} value={date} onChange={(e) => setDate(e.target.value)} style={{ ...input, marginLeft: 'auto' }} /></div>
      {err ? <div style={errText}>{err}</div> : !runs ? <div style={muted}>{t('pos.loading')}</div> : runs.length === 0 ? <div style={muted}>{t('pos.no_runs_yet')}</div> : (
        <table style={table}><thead><tr><th style={th}>{t('pos.started_2')}</th><th style={th}>{t('pos.scope')}</th><th style={th}>{t('pos.trigger')}</th><th style={th}>{t('pos.status')}</th><th style={th}>{t('pos.found')}</th><th style={th}>{t('pos.versions')}</th><th style={th} /></tr></thead>
          <tbody>{runs.map((r) => (
            <tr key={r.id} data-testid="sched-run">
              <td style={td}>{when(r.startedAt)}{r.latencyMs != null ? <div style={muted}>{r.latencyMs} {t('pos.ms')}</div> : null}</td>
              <td style={td}>{r.scope === 'branch_day' ? t('pos.location_day') : t('pos.technician_day_technicianid', { technicianId: String(techName(r.technicianId)) })}<div style={muted}>{r.date ?? ''}</div></td>
              <td style={td}>{r.trigger === 'manual' ? t('pos.staff') : r.trigger === 'job' ? t('pos.scheduled_scan_2') : t('pos.automation')}</td>
              <td style={td}>{pretty(r.status)}{r.errorCode ? <div style={errText}>{r.errorCode}</div> : null}</td>
              <td style={td}>{r.recommendationCount} {t('pos.rec')}{' '}{r.gapCount} {t('pos.gaps')}{' '}{r.conflictCount} {t('pos.conflicts')}</td>
              <td style={{ ...td, ...muted }}>{t('pos.engine_2')}{' '}{r.versions.engineVersion} {t('pos.rules_2')}{' '}{r.versions.ruleVersion} {t('pos.settings_v')}{r.versions.configVersion}</td>
              <td style={td}><button style={btnGhost} onClick={() => onOpenRun(r.id)}>{t('pos.open')}</button></td>
            </tr>
          ))}</tbody></table>
      )}
    </section>
  );
}
