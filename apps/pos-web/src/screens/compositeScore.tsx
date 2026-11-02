// compositeScore.tsx — F5 (Finish the Five, 30 Oct 2026): the Overall Technician Performance Score (0–100, model
// composite-v1, 40 / 30 / 20 / 10) — a SEPARATE, separately labelled field beside the verified customer rating (0–5),
// which is never changed. Shown only when every component has enough evidence; otherwise "Insufficient Data – Composite
// Score Not Available" with each valid component still visible. COMPARISON MODE: Top Performers stays ranked by the
// rating until the owner approves switching; nothing here touches pay, commission, scheduling or employment.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posTeamPerformanceScreenApi } from '../api/posTeamScreensApi';
import { FitDialog, FitPanel, Pager, Empty } from '../components/FitKit';
import { useLoad, StateBlock } from '../components/FinanceKit';
import { pageOf, whenTime } from './technicianScreenParts';
import { nf } from './teamShared';

const pts = (v: number | null | undefined) => (v == null ? '—' : tx('cs.pts', { v: v.toFixed(1) }));

/** the comparison panel: rating rank beside the composite, one row per technician, its own pages */
export function CompositeComparison({ pq, onOpen }: { pq: Record<string, unknown>; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const c = useLoad(() => posTeamPerformanceScreenApi.comparison({ ...pq, page, pageSize: 6 }), [JSON.stringify(pq), page]);
  const d: any = c.data;
  return (
    <FitPanel testId="composite-comparison" title={<>{tx('cs.title')}<span className="fk-chip info">{tx('cs.mode')}</span>{d ? <span className="fk-muted"> · {tx('cs.availableN', { n: nf(d.available), t: nf(d.totalItems) })}</span> : null}</>}
      footer={<Pager info={pageOf(d)} onPage={setPage} label={tx('cs.title')} />}>
      {c.error ? <StateBlock error={c.error} onRetry={c.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : !d.items.length ? <Empty title={tx('tp.noTechs')} />
        : <table className="fk-table fn-table cg-table" data-testid="composite-table"><thead><tr><th>{tx('cs.ratingRank')}</th><th>{tx('pos.technician')}</th><th className="num">{tx('tp.col.rating')}</th><th className="num">{tx('cs.score')}</th><th>{tx('cs.components')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{d.items.map((r: any) => <tr key={r.technicianId} className="inv2-click" onClick={() => onOpen(r.technicianId)} data-testid="composite-row">
            <td className="fk-muted">{r.ratingRank}</td><td><b>{r.name}</b></td><td className="num">{r.rating == null ? tx('tp.notRated') : tx('tp.of5', { v: r.rating.toFixed(1) })}</td>
            <td className="num">{r.available ? <b>{pts(r.composite)}</b> : <span className="fk-chip mut" data-testid="composite-na">{tx('cs.naShort')}</span>}</td>
            <td><span className="cs-dots">{r.components.map((x: any) => <span key={x.key} className={'cs-dot ' + (x.status === 'OK' ? 'ok' : x.status === 'UNSUPPORTED' ? 'mut' : 'warn')} title={`${tx('cs.c.' + x.key)}: ${x.status === 'OK' ? pts(x.value) : tx('cs.s.' + x.status, { n: nf(x.sample), m: nf(x.threshold) })}`}>{tx('cs.ab.' + x.key)}</span>)}</span></td>
            <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={(e) => { e.stopPropagation(); onOpen(r.technicianId); }} data-testid="composite-open">{tx('cs.details')}</button></td></tr>)}</tbody></table>}
      <p className="fk-hint">{tx('cs.rule')}</p>
    </FitPanel>
  );
}

/** the Details overlay: four weighted components, evidence counts, period, model version, exclusions, last computed */
export function CompositeDetails({ id, pq, onClose }: { id: string; pq: Record<string, unknown>; onClose: () => void }) {
  const [tick, setTick] = useState(0); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const c = useLoad(() => posTeamPerformanceScreenApi.composite(id, pq), [id, JSON.stringify(pq), tick]);
  const x: any = c.data;
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await posTeamPerformanceScreenApi.snapshot({ technicianId: id, ...pq }); setMsg(tx('cs.saved')); setTick((n) => n + 1); }
    catch (e) { setMsg((e as { status?: number })?.status === 403 ? tx('cs.noPermission') : tx('cr.err.generic')); }
    finally { setBusy(false); }
  };
  return (
    <FitDialog wide title={tx('cs.title')} busy={busy} onClose={onClose} testId="dlg-composite"
      subtitle={x ? <>{tx('cs.model', { v: x.modelVersion })} · {tx('cs.mode')} · {x.period?.from ?? '—'} – {x.period?.to ?? '—'} · {tx('cs.computed', { t: whenTime(x.computedAt) })}</> : null}
      footer={<><button type="button" className="fk-btn ghost" onClick={save} disabled={busy || !x} data-testid="composite-snapshot">{tx('cs.saveSnapshot')}</button>
        <button type="button" className="fk-btn primary" onClick={onClose} disabled={busy} data-testid="composite-close">{tx('pos.close')}</button></>}>
      {c.error ? <StateBlock error={c.error} onRetry={c.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="cs-head">
          <div className="cs-big" data-testid="composite-value">{x.available ? <><b>{x.score.toFixed(1)}</b><span>/ 100</span></> : <span className="cs-na">{tx('cs.na')}</span>}</div>
          <div className="cs-rating"><span className="fk-muted">{tx('cs.ratingSeparate')}</span><b>{x.rating.average == null ? tx('tp.notRated') : tx('tp.of5', { v: x.rating.average.toFixed(1) })}</b><span className="fk-li-s">{x.rating.reviews === 1 ? tx('tp.review1') : tx('tp.reviewsN', { n: nf(x.rating.reviews) })}</span></div>
        </div>
        {msg ? <div className="fk-note info" role="status"><span>{msg}</span></div> : null}
        <table className="fk-table fn-table cg-table" data-testid="composite-components"><thead><tr><th>{tx('cs.component')}</th><th className="num">{tx('cs.weight')}</th><th className="num">{tx('cs.value')}</th><th className="num">{tx('cs.evidence')}</th><th>{tx('pos.status')}</th></tr></thead>
          <tbody>{x.components.map((k: any) => <tr key={k.key} data-testid="component-row"><td><b>{tx('cs.c.' + k.key)}</b><span className="fk-li-s">{tx('cs.r.' + k.key)}</span></td><td className="num">{Math.round(k.weight * 100)}%</td>
            <td className="num">{pts(k.value)}</td><td className="num">{tx('cs.sample', { n: nf(k.sample), m: nf(k.threshold) })}{k.excluded ? <span className="fk-li-s">{tx('cs.excluded', { n: nf(k.excluded) })}</span> : null}</td>
            <td><span className={'fk-chip ' + (k.status === 'OK' ? 'ok' : k.status === 'UNSUPPORTED' ? 'mut' : 'warn')}>{tx('cs.st.' + k.status)}</span></td></tr>)}</tbody></table>
        <p className="fk-hint">{tx('cs.formula')}</p>
        <p className="fk-hint">{tx('cs.fairness')}</p>
        <h3 className="cr-h">{tx('cs.snapshots')}</h3>
        {!x.snapshots.length ? <Empty title={tx('cs.noSnapshots')} /> : <ul className="fk-list" data-testid="composite-snapshots">{x.snapshots.map((s: any) => <li key={s.id} className="fk-li"><span className="fk-li-t">{s.score == null ? tx('cs.naShort') : pts(s.score)} · {s.modelVersion}<span className="fk-li-s">{s.from} – {s.to} · {whenTime(s.computedAt)}</span></span></li>)}</ul>}
      </>}
    </FitDialog>
  );
}
