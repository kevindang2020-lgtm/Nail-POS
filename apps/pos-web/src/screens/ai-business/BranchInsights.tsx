// BranchInsights.tsx — A3 AI Branch Comparison (Nov 6 2026): the fair scorecard (per technician hour, per operating hour,
// returning customers, with ranks), the growth advisor and "Explain the difference" between two branches.
// Server: modules/analytics/src/ai-business/branch-insights.ts.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { posAiBusinessApi } from '../../api/posAiBusinessApi';
import { Empty, ErrorRetry, FitDialog } from '../../components/FitKit';
import { bt, bzErr, bzNum } from '../../components/BusinessKit';

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
          <th className="num">{bt('bcx.s.openHours')}</th><th className="num">{bt('bcx.s.perOpenHour')}</th><th className="num">{bt('bcx.s.returning')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.branchId} data-testid="bcx-s-row">
              <td><b>{r.branchName}</b></td>
              <td className="num">{hrs(r.technicianHours)}</td>
              <td className="num" data-testid="bcx-s-pth">{s.financialsIncluded ? money(r.netPerTechnicianHourCents) : '—'}{rank(r.rank.perTechnicianHour)}</td>
              <td className="num">{hrs(r.operatingHours)}</td>
              <td className="num">{s.financialsIncluded ? money(r.netPerOperatingHourCents) : '—'}{rank(r.rank.perOperatingHour)}</td>
              <td className="num">{r.returningRate == null ? bt('bcx.na') : `${r.returningRate}% (${bzNum(r.returningCustomers)}/${bzNum(r.customers)})`}{rank(r.rank.returningRate)}</td>
            </tr>))}</tbody></table></div>
        {rows.length > 1 ? <button type="button" className="btn ghost" data-testid="bcx-explain" onClick={() => setExplain(true)}>{bt('bcx.e.open')}</button> : null}
        <div className="p-h" style={{ marginTop: 12 }}>{bt('bcx.a.title')}</div>
        {s.advice.length === 0 ? <div className="sub" data-testid="bcx-advice-none">{bt('bcx.a.none')}</div> : (
          <ul className="rvw-list" data-testid="bcx-advice">{s.advice.map((a: any, i: number) => (
            <li key={i}><span className={'chip ' + (a.severity === 'warning' ? 'warn' : '')}>{bt('bcx.a.k.' + a.kind)}</span> {adviceText(a)} <Link to={a.route} style={{ color: 'var(--aps-orange)' }}>{bt('bcx.a.go')}</Link></li>))}</ul>)}
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
    </FitDialog>
  );
}
