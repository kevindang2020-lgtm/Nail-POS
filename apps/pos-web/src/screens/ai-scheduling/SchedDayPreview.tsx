// SchedDayPreview.tsx — A5 AI Scheduling Optimizer (Nov 6 2026): the technician's full day around a recommendation, before and
// after the move, the bookings right next to the proposed slot, and the gaps / conflicts it opens or closes (read fresh).
import { useEffect, useState } from 'react';
import type { SchedDayContextResponse, SchedDayContextSide } from '@aipowersalon/api-contracts/tenant';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import { muted, errText, okText, table, td, schedErrorText } from './schedUi';

function Side({ s, title, testId }: { s: SchedDayContextSide; title: string; testId: string }) {
  return (
    <div data-testid={testId}>
      <div style={{ ...muted, fontWeight: 700 }}>{title}{s.technicianName ? ` — ${s.technicianName}` : ''}</div>
      <div style={muted}>{t('ops.sched.day.shift')}: {s.shifts.length ? s.shifts.map((x) => `${x.start}–${x.end}`).join(', ') : '—'}{s.breaks.length ? ` · ${t('ops.sched.day.breaks')}: ${s.breaks.map((x) => `${x.start}–${x.end}`).join(', ')}` : ''}</div>
      <table style={table}><tbody>{s.items.length === 0 ? <tr><td style={td}>{t('ops.sched.day.empty')}</td></tr> : s.items.map((i) => (
        <tr key={i.appointmentId} style={i.moving ? { background: '#FFF6E5' } : undefined}>
          <td style={td}>{i.start}–{i.end}</td><td style={td}>{i.services.join(', ')}</td>
          <td style={td}>{i.moving ? <b>{t('ops.sched.day.thisOne')}</b> : i.locked ? t('ops.sched.day.locked') : ''}</td></tr>))}</tbody></table>
      {s.gaps.length ? <div style={muted}>{t('ops.sched.day.gaps')}: {s.gaps.map((g) => `${g.start}–${g.end} (${g.minutes} ${t('ops.sched.day.min')})`).join(', ')}</div> : null}
      {s.conflicts.length ? <div style={errText}>{s.conflicts.map((c) => c.message).join(' · ')}</div> : null}
    </div>
  );
}

export function SchedDayPreview({ id, tick }: { id: string; tick: number }) {
  const [d, setD] = useState<SchedDayContextResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD(null); setErr(null); api.dayContext(id).then(setD).catch((e) => setErr(schedErrorText(e))); }, [id, tick]);
  if (err) return <div style={muted} data-testid="sched-day-err">{err}</div>;
  if (!d) return <div style={muted}>{t('pos.loading')}</div>;
  const n = d.neighbours;
  return (
    <section data-testid="sched-day" style={{ display: 'grid', gap: 8, fontSize: 13 }}>
      <div style={{ fontWeight: 700 }}>{t('ops.sched.day.title', { d: d.date })}</div>
      <div data-testid="sched-day-neighbours">
        {n.previous ? t('ops.sched.day.prev', { s: n.previous.start, e: n.previous.end, g: n.gapBeforeMin ?? 0 }) : t('ops.sched.day.noPrev')}
        {' · '}
        {n.next ? t('ops.sched.day.next', { s: n.next.start, e: n.next.end, g: n.gapAfterMin ?? 0 }) : t('ops.sched.day.noNext')}
      </div>
      <div style={d.change.newConflicts ? errText : okText} data-testid="sched-day-change">
        {t('ops.sched.day.change', { ng: d.change.newGaps, cg: d.change.closedGaps, nc: d.change.newConflicts, rc: d.change.resolvedConflicts })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        <Side s={d.before} title={t('pos.before')} testId="sched-day-before" />
        <Side s={d.after} title={t('pos.after')} testId="sched-day-after" />
      </div>
      <div style={muted}>{t('ops.sched.day.note')}</div>
    </section>
  );
}

