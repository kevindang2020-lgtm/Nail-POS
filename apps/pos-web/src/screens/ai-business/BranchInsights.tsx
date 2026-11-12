// BranchInsights.tsx — A3 AI Branch Comparison (Nov 6 2026): the fair scorecard (per technician hour, per operating hour,
// returning customers, with ranks), the growth advisor and "Explain the difference" between two branches.
// Server: modules/analytics/src/ai-business/branch-insights.ts.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { posAiBusinessApi } from '../../api/posAiBusinessApi';
import { Empty, ErrorRetry, FitDialog } from '../../components/FitKit';
import { bt, bzErr, bzNum, bzValue, bzWhen } from '../../components/BusinessKit';

const money = (c: number | null | undefined) => (c == null ? bt('bcx.na') : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const hrs = (h: number | null | undefined) => (h == null ? bt('bcx.na') : bt('bcx.s.hours', { n: h }));
const rank = (n: number | null | undefined) => (n == null ? '' : ` · #${n}`);
const num1 = (n: unknown) => (n == null ? '—' : String(Math.round(Number(n) * 10) / 10));

/** advice in the screen language, from the numbers the server based it on */
export function adviceText(a: any): string {
  const b = a.basis ?? {};
  if (a.kind === 'low_yield_per_tech_hour') return bt('bcx.a.m.low_yield_per_tech_hour', { b: a.branchName, v: money(b.netPerTechnicianHourCents), m: money(b.medianCents) });
  if (a.kind === 'high_no_shows') return bt('bcx.a.m.high_no_shows', { b: a.branchName, v: num1(b.noShowPercent), m: num1(b.medianPercent) });
  if (a.kind === 'low_return_rate') return bt('bcx.a.m.low_return_rate', { b: a.branchName, v: num1(b.returningRate), m: num1(b.medianPercent) });
  if (a.kind === 'no_opening_hours') return bt('bcx.a.m.no_opening_hours', { b: a.branchName });
  return a.message;
}
/** the measured bridge in the screen language (the server's bridge + the two scorecard rows) */
export function explainLines(r: any, A: any, B: any): string[] {
  if (!A || !B) return [];
  const out: string[] = [];
  if (r.bridge && A.ticketsCount != null && B.ticketsCount != null) {
    const avgA = A.ticketsCount ? Math.round(A.netSalesCents / A.ticketsCount) : 0, avgB = B.ticketsCount ? Math.round(B.netSalesCents / B.ticketsCount) : 0;
    out.push(bt(r.bridge.totalCents >= 0 ? 'bcx.e.l.more' : 'bcx.e.l.less', { a: A.branchName, b: B.branchName, v: money(Math.abs(r.bridge.totalCents)) }));
    out.push(bt(A.ticketsCount >= B.ticketsCount ? 'bcx.e.l.volumeMore' : 'bcx.e.l.volumeFewer', { v: money(Math.abs(r.bridge.volumeCents)), n: Math.abs(A.ticketsCount - B.ticketsCount), x: A.ticketsCount, y: B.ticketsCount, b: B.branchName }));
    out.push(bt('bcx.e.l.price', { v: money(Math.abs(r.bridge.priceCents)), x: money(avgA), y: money(avgB) }));
  } else out.push(bt('bcx.e.l.hidden'));
  if (A.completionRate != null && B.completionRate != null && A.completionRate !== B.completionRate) out.push(bt('bcx.e.l.completion', { x: A.completionRate, y: B.completionRate }));
  if (A.noShowPercent !== B.noShowPercent) out.push(bt('bcx.e.l.noShow', { x: A.noShowPercent, y: B.noShowPercent }));
  if (A.technicianHours != null && B.technicianHours != null) out.push(bt('bcx.e.l.hours', { x: A.technicianHours, y: B.technicianHours }));
  if (A.returningRate != null && B.returningRate != null) out.push(bt('bcx.e.l.returning', { x: A.returningRate, y: B.returningRate }));
  out.push(bt('bcx.e.l.notCause'));
  return out;
}

export function BranchInsightsPanel({ period, tick }: { period: { preset?: string; from?: string; to?: string }; tick: number }) {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [explain, setExplain] = useState(false);
  const p = period.preset === 'custom' ? { from: period.from, to: period.to } : { preset: period.preset };
  const load = () => { setErr(null); setS(null); posAiBusinessApi.center.branchScorecard(p).then(setS).catch((e) => setErr(bzErr(e))); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [period.preset, period.from, period.to, tick]);
  const rows: any[] = s?.rows ?? [];
  return (
    <section className="panel rvw-feed" style={{ padding: 12, marginTop: 12 }} data-testid="bcx-scorecard">
      <div className="p-h">{bt('bcx.s.title')}</div>
      <div className="sub">{bt('bcx.s.sub')}</div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !s ? <div className="state">{bt('bzx.loading')}</div> : rows.length === 0 ? <Empty title={bt('pos.no_authorized_branches_to_compare')} /> : (<>
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>
          <th>{bt('pos.branch')}</th><th className="num">{bt('bcx.s.techHours')}</th><th className="num">{bt('bcx.s.perTechHour')}</th>
          <th className="num">{bt('bcx.s.openHours')}</th><th className="num">{bt('bcx.s.perOpenHour')}</th><th className="num">{bt('bcx.s.returning')}</th><th>{bt('bcx.l.col')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.branchId} data-testid="bcx-s-row">
              <td><b>{r.branchName}</b></td>
              <td className="num">{hrs(r.technicianHours)}</td>
              <td className="num" data-testid="bcx-s-pth">{s.financialsIncluded ? money(r.netPerTechnicianHourCents) : '—'}{rank(r.rank.perTechnicianHour)}</td>
              <td className="num">{hrs(r.operatingHours)}</td>
              <td className="num">{s.financialsIncluded ? money(r.netPerOperatingHourCents) : '—'}{rank(r.rank.perOperatingHour)}</td>
              <td className="num">{r.returningRate == null ? bt('bcx.na') : `${r.returningRate}% (${bzNum(r.returningCustomers)}/${bzNum(r.customers)})`}{rank(r.rank.returningRate)}</td>
              <td data-testid="bcx-s-like"><LikeCell l={r.likeForLike} fin={s.financialsIncluded} /></td>
            </tr>))}</tbody></table></div>
        {rows.length > 1 ? <button type="button" className="btn ghost" data-testid="bcx-explain" onClick={() => setExplain(true)}>{bt('bcx.e.open')}</button> : null}
        <div className="p-h" style={{ marginTop: 12 }}>{bt('bcx.a.title')}</div>
        {s.advice.length === 0 ? <div className="sub" data-testid="bcx-advice-none">{bt('bcx.a.none')}</div> : (
          <ul className="rvw-list" data-testid="bcx-advice">{s.advice.map((a: any, i: number) => (
            <li key={i}><span className={'chip ' + (a.severity === 'warning' ? 'warn' : '')}>{bt('bcx.a.k.' + a.kind)}</span> {adviceText(a)} <Link to={a.route} style={{ color: 'var(--aps-orange)' }}>{bt('bcx.a.go')}</Link></li>))}</ul>)}
        <TrendFlags rows={rows} />
        <ul className="sub" style={{ marginTop: 8, paddingLeft: 18 }}><li>{bt('bcx.s.note1')}</li><li>{bt('bcx.s.note2')}</li>{!s.financialsIncluded ? <li>{bt('bcx.s.note3')}</li> : null}</ul>
      </>)}
      {explain ? <ExplainDialog rows={rows} period={p} onClose={() => setExplain(false)} /> : null}
    </section>
  );
}

function ExplainDialog({ rows, period, onClose }: { rows: any[]; period: Record<string, string | undefined>; onClose: () => void }) {
  const [a, setA] = useState<string>(rows[0]?.branchId ?? '');
  const [b, setB] = useState<string>(rows[1]?.branchId ?? '');
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => { setBusy(true); setErr(null); posAiBusinessApi.center.branchExplain({ ...period, a, b }).then(setR).catch((e) => setErr(bzErr(e))).finally(() => setBusy(false)); };
  return (
    <FitDialog testId="bcx-explain-dlg" wide title={bt('bcx.e.title')} onClose={onClose} busy={busy}
      footer={<><button className="btn" data-testid="bcx-e-run" disabled={busy || !a || !b || a === b} onClick={run}>{bt('bcx.e.run')}</button><button className="btn ghost" onClick={onClose}>{bt('bzx.close')}</button></>}>
      <div className="rvw-filters">
        <label className="rvw-f"><span>{bt('bcx.e.a')}</span><select data-testid="bcx-e-a" value={a} onChange={(e) => setA(e.target.value)}>{rows.map((x) => <option key={x.branchId} value={x.branchId}>{x.branchName}</option>)}</select></label>
        <label className="rvw-f"><span>{bt('bcx.e.b')}</span><select data-testid="bcx-e-b" value={b} onChange={(e) => setB(e.target.value)}>{rows.map((x) => <option key={x.branchId} value={x.branchId}>{x.branchName}</option>)}</select></label>
      </div>
      {err ? <div className="err" role="alert">{err}</div> : null}
      {r ? <ul data-testid="bcx-e-lines" style={{ paddingLeft: 18 }}>{explainLines(r, rows.find((x) => x.branchId === a), rows.find((x) => x.branchId === b)).map((l, i) => <li key={i} style={{ marginBottom: 4 }}>{l}</li>)}</ul> : <p className="sub">{bt('bcx.e.hint')}</p>}
      {r?.evidence ? <ExplainEvidence ev={r.evidence} /> : null}
    </FitDialog>
  );
}

/** AI BRANCH COMPARISON 04 — like-for-like group (server: branch-insights likeForLikeGroups — similar technician hours, opening
 *  hours and service mix). Shows the rank among those branches only, or why the branch has no group; never a size ranking. */
type LikeView = { peers: Array<{ branchId: string; branchName: string; mixOverlapPercent: number }>; rankPerTechnicianHour: number | null; of: number; mix: Array<{ category: string; sharePercent: number }>; reason: string | null };
export function LikeCell({ l, fin }: { l?: LikeView; fin: boolean }) {
  if (!l) return <>—</>;
  const mix = l.mix.slice(0, 3).map((m) => `${m.category} ${m.sharePercent}%`).join(', ');
  if (!l.peers.length) return <span className="sub" title={mix || undefined}>{bt('bcx.l.r.' + (l.reason ?? 'no_peers'))}</span>;
  return <span title={mix || undefined}>
    {fin && l.rankPerTechnicianHour != null ? bt('bcx.l.rank', { n: l.rankPerTechnicianHour, of: l.of }) + ' · ' : ''}
    {bt('bcx.l.with', { names: l.peers.map((p) => p.branchName).join(', ') })}
  </span>;
}

/** AI BRANCH COMPARISON 06 — Source-to-Answer: every figure the explanation rests on, for both branches, with the report or
 *  record it was read from, the salon days and the time it was read (server: branch-insights explainEvidence). Nothing is
 *  recomputed here; a figure the server did not send stays '—'. */
type EvidenceFigure = { key: string; unit: 'cents' | 'count' | 'percent' | 'hours'; a: number | null; b: number | null; source: string; hidden: boolean };
type EvidenceSide = { branchId: string; branchName: string; timeZone: string; range: { from: string; to: string } | null };
type ExplainEvidenceView = { asOf: string; preset: string; a: EvidenceSide; b: EvidenceSide; financialsIncluded: boolean; figures: EvidenceFigure[]; sources: Array<{ source: string; route: string }> };
const evValue = (f: EvidenceFigure, v: number | null) => (f.hidden ? '—' : v == null ? bt('bcx.na') : f.unit === 'cents' ? money(v) : f.unit === 'percent' ? `${v}%` : f.unit === 'hours' ? hrs(v) : bzNum(v));
const evDays = (s: EvidenceSide) => (s.range ? bt('bcx.ev.days', { from: s.range.from, to: s.range.to, tz: s.timeZone }) : '—');
export function ExplainEvidence({ ev }: { ev: ExplainEvidenceView }) {
  return (
    <details data-testid="bcx-e-evidence" style={{ marginTop: 8 }}>
      <summary className="sub" style={{ cursor: 'pointer', minHeight: 32 }}>{bt('bcx.ev.title')}</summary>
      <div className="sub" data-testid="bcx-ev-asof">{bt('bcx.ev.asOf', { at: bzWhen(ev.asOf) })}</div>
      <div className="sub" data-testid="bcx-ev-days">{ev.a.branchName}: {evDays(ev.a)} · {ev.b.branchName}: {evDays(ev.b)}</div>
      <div className="rvw-table-wrap"><table className="tbl" data-testid="bcx-ev-table"><thead><tr>
        <th>{bt('bcx.ev.figure')}</th><th className="num">{ev.a.branchName}</th><th className="num">{ev.b.branchName}</th><th>{bt('bcx.ev.source')}</th></tr></thead>
        <tbody>{ev.figures.map((f) => (
          <tr key={f.key} data-testid="bcx-ev-row" data-key={f.key}>
            <td>{bt('bcx.ev.f.' + f.key)}</td><td className="num">{evValue(f, f.a)}</td><td className="num">{evValue(f, f.b)}</td><td className="sub">{bt('bcx.ev.s.' + f.source)}</td>
          </tr>))}</tbody></table></div>
      {!ev.financialsIncluded ? <div className="sub">{bt('bcx.e.l.hidden')}</div> : null}
      <div className="sub" data-testid="bcx-ev-links">{ev.sources.map((x, i) => <span key={x.source}>{i ? ' · ' : ''}<Link to={x.route} style={{ color: 'var(--aps-orange)' }}>{bt('bcx.ev.s.' + x.source)}</Link></span>)}</div>
    </details>
  );
}

/** AI BRANCH COMPARISON 09: what the salon's existing alert rules flagged per branch in the period (server: scorecard
 *  trendFlags from ai_business_alert_events) — no second detector; each line links to AI Business Alerts. */
type BranchTrendFlag = { family: string; metricId: string; unit: string; triggered: number; openIncidents: number; latestValue: number | null; threshold: number | null; operator: string; latestAt: string | null; route: string };
export function TrendFlags({ rows }: { rows: Array<{ branchId: string; branchName: string; trendFlags?: BranchTrendFlag[] }> }) {
  const items = rows.flatMap((r) => (r.trendFlags ?? []).map((f) => ({ r, f })));
  return <>
    <div className="p-h" style={{ marginTop: 12 }}>{bt('bcx.t.title')}</div>
    {items.length === 0 ? <div className="sub" data-testid="bcx-trend-none">{bt('bcx.t.none')}</div> : (
      <ul className="rvw-list" data-testid="bcx-trends">{items.map(({ r, f }) => (
        <li key={r.branchId + f.metricId} data-testid="bcx-trend">
          <span className={'chip ' + (f.openIncidents ? 'warn' : '')}>{bt('bcx.t.f.' + f.family)}</span>{' '}
          {bt('bcx.t.line', { b: r.branchName, m: bt('bzx.metric.' + f.metricId), n: bzNum(f.triggered), v: bzValue(f.latestValue, f.unit), t: bzValue(f.threshold, f.unit), at: bzWhen(f.latestAt) })}
          {f.openIncidents ? ' ' + bt('bcx.t.open', { n: bzNum(f.openIncidents) }) : ''}{' '}
          <Link to={f.route} style={{ color: 'var(--aps-orange)' }}>{bt('bcx.t.go')}</Link>
        </li>))}</ul>)}
    <div className="sub">{bt('bcx.t.note')}</div>
  </>;
}
