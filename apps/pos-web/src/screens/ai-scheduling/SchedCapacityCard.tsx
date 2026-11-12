// SchedCapacityCard.tsx — Extras "Capacity Risk Heatmap" (AI Scheduling Optimizer 07). OPTIONAL and read-only: nothing loads
// until staff press "Show capacity"; then one strip of hours coloured by the SERVER's risk word (ok / tight / over / unstaffed /
// closed) and, per hour, staffed vs booked minutes and each skill's demand vs the qualified technicians on shift. Every number
// comes from GET calendar?capacity=1 (the optimizer's own day model + the workforce skill rule); the booking board stays the
// place where appointments are made or moved.
import { useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posAiSchedulingOptimizerApi as api, type CapacityHeatmapView } from '../../api/posAiSchedulingOptimizerApi';
import { card, cardHead, muted, errText, btnGhost, schedErrorText, pctNum, table, th, td } from './schedUi';
import { clockOfHHMM } from '../opsClock';

const TONE: Record<string, { bg: string; fg: string }> = {
  ok: { bg: '#E6F2EA', fg: '#2E6B45' }, tight: { bg: '#FBF0D9', fg: '#8A5A00' }, over: { bg: '#F8E1DA', fg: '#B4451E' },
  unstaffed: { bg: '#F8E1DA', fg: '#B4451E' }, closed: { bg: '#F1EEE8', fg: '#8A857E' },
};

export function SchedCapacityCard({ date, tick }: { date: string; tick: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CapacityHeatmapView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hour, setHour] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api.capacity(date).then((r) => { if (!live) return; setData(r?.capacity ?? null); setErr(r?.capacity ? null : tx('sox.cap.none')); })
      .catch((e) => { if (live) setErr(schedErrorText(e, 'sox.cap.failed')); });
    return () => { live = false; };
  }, [open, date, tick]);
  const sel = data?.hours.find((h) => h.hour === hour) ?? null;
  return (
    <section style={card} aria-label={tx('sox.cap.title')} data-testid="sched-capacity">
      <div style={{ ...cardHead, display: 'flex', alignItems: 'center', gap: 8 }}>{tx('sox.cap.title')}
        <button style={{ ...btnGhost, marginLeft: 'auto' }} data-testid="sched-capacity-toggle" onClick={() => setOpen((o) => !o)}>{open ? tx('sox.cap.hide') : tx('sox.cap.show')}</button></div>
      {!open ? <div style={muted}>{tx('sox.cap.intro')}</div> : err ? <div style={errText} role="alert">{err}</div> : !data ? <div style={muted}>{tx('sox.cap.loading')}</div> : <>
        <div style={muted} data-testid="sched-capacity-totals">{tx('sox.cap.totals', { over: data.totals.overHours, tight: data.totals.tightHours, unstaffed: data.totals.unstaffedHours, skill: data.totals.skillShortHours })}</div>
        <div role="list" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '8px 0' }}>
          {data.hours.map((h) => (
            <button key={h.hour} role="listitem" data-testid={`sched-cap-h-${h.hour}`} data-risk={h.risk} aria-pressed={hour === h.hour} onClick={() => setHour(hour === h.hour ? null : h.hour)}
              style={{ minWidth: 64, minHeight: 44, border: hour === h.hour ? '2px solid #3A3631' : '1px solid var(--line)', borderRadius: 8, background: TONE[h.risk].bg, color: TONE[h.risk].fg, fontSize: 12, padding: '4px 6px', cursor: 'pointer' }}>
              <div style={{ fontWeight: 700 }}>{clockOfHHMM(h.hour)}</div>
              <div>{tx('sox.cap.risk.' + h.risk)}{h.skillShort ? ' · ' + tx('sox.cap.skillShortShort') : ''}</div>
            </button>))}
        </div>
        {sel ? <div data-testid="sched-capacity-detail">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{tx('sox.cap.detail', { hour: clockOfHHMM(sel.hour), techs: sel.techsOnShift, staffed: sel.staffedMin, booked: sel.bookedMin, held: sel.heldMin, use: pctNum(sel.utilizationPct) })}</div>
          {sel.unassignedMin ? <div style={muted}>{tx('sox.cap.unassigned', { n: sel.unassignedMin })}</div> : null}
          {sel.skills.length ? <table style={table}><thead><tr><th style={th}>{tx('sox.cap.col.skill')}</th><th style={th}>{tx('sox.cap.col.demand')}</th><th style={th}>{tx('sox.cap.col.needed')}</th><th style={th}>{tx('sox.cap.col.qualified')}</th></tr></thead>
            <tbody>{sel.skills.map((s) => <tr key={s.category} data-testid={`sched-cap-skill-${s.category}`}><td style={td}>{s.category}</td><td style={td}>{tx('sox.cap.min', { n: s.demandMin })}</td><td style={td}>{s.techsNeeded}</td>
              <td style={{ ...td, color: s.short ? '#B4451E' : undefined, fontWeight: s.short ? 700 : undefined }}>{s.qualifiedOnShift}{s.short ? ' — ' + tx('sox.cap.short') : ''}</td></tr>)}</tbody></table>
            : <div style={muted}>{tx('sox.cap.noDemand')}</div>}
        </div> : <div style={muted}>{tx('sox.cap.pick')}</div>}
        <div style={{ ...muted, marginTop: 8 }}>{tx('sox.cap.basis', { pct: data.tightAtPct })}</div>
      </>}
    </section>
  );
}
