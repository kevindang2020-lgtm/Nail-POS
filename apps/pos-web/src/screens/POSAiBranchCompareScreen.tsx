// POSAiBranchCompareScreen.tsx — AI Center → AI Branch Comparison (/tenant/ai/business/branches). AI Branch Comparison guide (Nov 3 2026).
// Keeps the photographed page — the period tabs, the 7-column branch table and the Sales Report link — and finishes it:
//   • a KPI strip of whole-salon totals over every branch that matched (not just this page), with the time it was read and Refresh;
//   • presets (today … this year) plus a custom From / To month calendar;
//   • every authorized branch (the 20-branch cap is gone): search by name, inactive branches hidden unless asked, pages of 10 / 25 / 50;
//   • N/A where a ratio has no denominator (it showed 0 % and $0.00), and an average ticket that is net ÷ tickets like Net Sales;
//   • a row opens that branch's full figures.
// Every number comes from GET /pos/ai-business/branches/compare (the canonical Sales Report, one authorized branch at a time).
import { useCallback, useEffect, useState } from 'react';
import { SavedViews, vStr, vNum, vBool, periodToView, periodFromView } from '../components/SavedViews';
import { Link } from 'react-router-dom';
import { posAiBusinessApi } from '../api/posAiBusinessApi';
import { KpiCard, Pager, Empty, ErrorRetry, FitDialog } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { bt, bzWhen, bzNum, bzValue, bzDays, BzHealthButton } from '../components/BusinessKit';
import { BranchInsightsPanel } from './ai-business/BranchInsights';
import { BranchSnapshotsPanel } from './ai-business/BranchSnapshots';
import { reportError } from './reportsCommon';
import { deviceToday } from '../lib/deviceToday';

type Row = {
  branchId: string; branchName: string; status: string;
  netSalesCents: number | null; averageTicketCents: number | null; ticketsCount: number | null;
  totalBookings: number; completed: number; cancelledPercent: number; noShowPercent: number;
  revenuePerCompletedAppointmentCents: number | null; completionRate: number | null;
};
type Comparison = {
  preset: string; range: { from: string; to: string } | null; asOf: string; partialCurrentPeriod: boolean; financialsIncluded: boolean;
  totals: { netSalesCents: number | null; ticketsCount: number | null; averageTicketCents: number | null; totalBookings: number; completed: number; completionRate: number | null; branches: number };
  branches: Row[]; page: number; pageSize: number; totalItems: number; totalPages: number; inactiveHidden: number; drilldownRoute: string; notes: string[];
  readiness?: Readiness;
  comparison?: { basis: string; preset: string; range: { from: string; to: string } | null; priorRange: { from: string; to: string } | null; totals: PriorFigures; byBranch: Record<string, PriorFigures> };
};
/** AI BRANCH COMPARISON 01: how far the numbers can be trusted for comparing (server-computed over every matched branch) */
type Readiness = { level: 'ready' | 'limited' | 'not_ready'; coveragePercent: number | null; branches: number; withActivity: number; noActivity: number; smallSample: number; financialCoverage: boolean; partialPeriod: boolean; asOf: string; reasons: string[] };
function ReadinessLine({ r }: { r?: Readiness }) {
  if (!r) return null;   // an older server: nothing claimed
  const tone = r.level === 'ready' ? 'ok' : r.level === 'limited' ? 'warn' : 'bad';
  return (
    <div className={'fk-note' + (r.level === 'ready' ? '' : ' warn')} role="status" data-testid="bcx-ready" data-level={r.level} style={{ marginTop: 8 }}>
      <span className={'chip ' + tone}>{bt('bcx.ready.' + r.level)}</span>{' '}
      <span data-testid="bcx-ready-cov">{bt('bcx.ready.coverage', { n: bzNum(r.withActivity), of: bzNum(r.branches), p: r.coveragePercent == null ? '—' : String(r.coveragePercent) })}</span>
      {' · '}<span>{bt('bcx.ready.fresh', { at: bzWhen(r.asOf) })}</span>
      {r.reasons.length ? <div className="sub" data-testid="bcx-ready-why">{r.reasons.map((x) => bt('bcx.ready.r.' + x, { n: x === 'small_sample' ? bzNum(r.smallSample) : bzNum(r.noActivity) })).join(' · ')}</div> : null}
    </div>
  );
}
type PriorFigures = { netSalesCents: number | null; ticketsCount: number | null; totalBookings: number; completed: number; completionRate: number | null };
/** AI BRANCH COMPARISON 08: the change against the previous equal period — money as ± cents, rates as ± points; '—' when either side is unknown */
const dMoney = (cur: number | null | undefined, prev: number | null | undefined) => (cur == null || prev == null ? '—' : (cur - prev >= 0 ? '+' : '−') + money(Math.abs(cur - prev)));
const dNum = (cur: number | null | undefined, prev: number | null | undefined) => (cur == null || prev == null ? '—' : (cur - prev >= 0 ? '+' : '−') + bzNum(Math.abs(cur - prev)));
const dPts = (cur: number | null | undefined, prev: number | null | undefined) => (cur == null || prev == null ? '—' : bt('bcx.cmp.pts', { n: (cur - prev >= 0 ? '+' : '−') + String(Math.abs(cur - prev)) }));
const PRESETS = ['today', 'yesterday', 'week', 'month', 'quarter', 'year'] as const;
const money = (c: number | null | undefined) => bzValue(c ?? null, 'cents');
const pct = (n: number | null | undefined) => (n == null ? bt('bcx.na') : `${n}%`);
const na = (v: string | null) => v ?? bt('bcx.na');

/** fewer bookings than this in the period: rates are shown, but marked as a small sample (no ranking conclusion) */
const SMALL_N = 5;
const small = (r: { totalBookings?: number | null }) => (r.totalBookings ?? 0) > 0 && (r.totalBookings ?? 0) < SMALL_N;
/** AI Business Assistant 09 (fairness): a branch's part of the salon total over every matched branch, with its denominator — null (N/A) when either side is unknown or the total is 0 */
function branchShare(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part == null || whole == null || !Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function POSAiBranchCompareScreen() {
  const [period, setPeriod] = useState<{ preset?: string; from?: string; to?: string }>({ preset: 'month' });
  const [cal, setCal] = useState(false);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [inactive, setInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [s, setS] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Row | null>(null);
  const [tick, setTick] = useState(0);
  const [cmp, setCmp] = useState(false);

  const load = useCallback(() => {
    setError(null);
    const p = period.preset === 'custom' ? { from: period.from, to: period.to } : { preset: period.preset };
    posAiBusinessApi.compareBranches({ ...p, q: q || undefined, includeInactive: inactive ? 'true' : undefined, page, pageSize, compare: cmp ? 'prior' : undefined })
      .then((x) => setS(x as Comparison)).catch((e) => setError(reportError(e, bt('growth.noun.theBranchComparison'))));
  }, [period, q, inactive, page, pageSize, cmp]);
  useEffect(() => { load(); }, [load, tick]);
  const pick = (p: typeof period) => { setPeriod(p); setPage(1); };

  const rows = s?.branches ?? [];
  const fin = s?.financialsIncluded !== false;
  const T = s?.totals;
  const C = cmp ? s?.comparison : undefined; const PT = C?.totals;
  const priorLabel = C ? (C.priorRange ? bzDays(C.priorRange) : bt('bcx.cmp.prior.' + C.preset)) : '';
  const vs = (d: string) => (PT ? bt('bcx.cmp.vs', { d }) : undefined);
  return (
    <div className="work rvw" data-testid="bcx">
      <div className="rvw-head">
        <div className="vh"><h1>{bt('pos.ai_branch_comparison')}</h1><div className="sub">{bt('pos.your_authorized_branches_side_by_side_1h3w')}</div></div>
        <div className="rvw-actions">
          {s ? <span className="sub" data-testid="bcx-asof">{bt('bcx.asOf', { at: bzWhen(s.asOf) })}</span> : null}
          <BzHealthButton area="branches" run={() => posAiBusinessApi.center.branchCheck()} />
          <button type="button" className="btn ghost" data-testid="bcx-refresh" onClick={() => setTick((n) => n + 1)}>{bt('bzx.refresh')}</button>
        </div>
      </div>

      <div className="rvw-dates" data-testid="bcx-period" style={{ position: 'relative' }}>
        {PRESETS.map((x) => <button key={x} type="button" className={'btn ghost' + (period.preset === x ? ' on' : '')} data-testid={`bcx-preset-${x}`} onClick={() => pick({ preset: x })}>{bt('bzx.period.' + x)}</button>)}
        <button type="button" className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} data-testid="bcx-custom" onClick={() => setCal(true)}>
          {period.preset === 'custom' ? bzDays({ from: period.from, to: period.to }) : bt('bzx.preset.custom')}</button>
        {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={deviceToday()}
          onApply={(r) => { pick({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { pick({ preset: 'month' }); setCal(false); }} /></div> : null}
      </div>

      {error ? <ErrorRetry message={error} onRetry={load} /> : null}
      <div className="rvw-kpis" data-testid="bcx-kpis">
        <KpiCard testId="bcx-k-net" label={bt('bcx.k.net')} value={T ? (fin ? money(T.netSalesCents) : '—') : '—'} sub={PT && T && fin ? vs(dMoney(T.netSalesCents, PT.netSalesCents)) : undefined} loading={!s && !error} />
        <KpiCard testId="bcx-k-avg" label={bt('bcx.k.avg')} value={T ? (fin ? na(T.averageTicketCents == null ? null : money(T.averageTicketCents)) : '—') : '—'} loading={!s && !error} />
        <KpiCard testId="bcx-k-bookings" label={bt('bcx.k.bookings')} value={T ? bzNum(T.totalBookings) : '—'} sub={PT && T ? vs(dNum(T.totalBookings, PT.totalBookings)) : undefined} loading={!s && !error} />
        <KpiCard testId="bcx-k-completed" label={bt('bcx.k.completed')} value={T ? bzNum(T.completed) : '—'} sub={PT && T ? vs(dNum(T.completed, PT.completed)) : undefined} loading={!s && !error} />
        <KpiCard testId="bcx-k-completion" label={bt('bcx.k.completion')} value={T ? pct(T.completionRate) : '—'} sub={PT && T ? vs(dPts(T.completionRate, PT.completionRate)) : undefined} loading={!s && !error} />
        <KpiCard testId="bcx-k-branches" label={bt('bcx.k.branches')} value={T ? bzNum(T.branches) : '—'} sub={s?.inactiveHidden ? bt('bcx.inactiveHidden', { n: s.inactiveHidden }) : undefined} loading={!s && !error} />
      </div>
      <div className="rvw-filters" style={{ marginTop: 8 }}>
        <label className="rvw-f" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" data-testid="bcx-compare" checked={cmp} onChange={(e) => setCmp(e.target.checked)} /><span>{bt('bcx.cmp.toggle')}</span></label>
        {C ? <span className="sub" data-testid="bcx-compare-basis">{bt('bcx.cmp.basis', { cur: C.range ? bzDays(C.range) : bt('bzx.period.' + C.preset), prior: priorLabel })}</span> : null}
      </div>
      {s?.partialCurrentPeriod ? <div className="sub">{bt('pos.today_is_partial_figures_are_still_1a7b')}</div> : null}
      <ReadinessLine r={s?.readiness} />

      <section className="panel rvw-feed" style={{ padding: 12, marginTop: 12 }}>
        <div className="p-h">{bt('pos.branches')}</div>
        <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); setPage(1); }}>
          <input className="rvw-search" type="search" data-testid="bcx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={bt('bcx.searchPh')} aria-label={bt('bcx.searchPh')} />
          <button className="btn" type="submit">{bt('bzx.search')}</button>
          <label className="rvw-f" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" data-testid="bcx-inactive" checked={inactive} onChange={(e) => { setInactive(e.target.checked); setPage(1); }} /><span>{bt('bcx.showInactive')}</span></label>
          <SavedViews surface="ai.branch-comparison" testId="bcx-views" current={{ q, inactive, pageSize, ...periodToView(period) }}
            onApply={(v) => { setDraft(vStr(v, 'q')); setQ(vStr(v, 'q')); setInactive(vBool(v, 'inactive')); setPageSize(vNum(v, 'pageSize', 25)); setPeriod(periodFromView(v, { preset: 'month' })); setPage(1); }} />
          {q ? <button className="btn ghost" type="button" onClick={() => { setDraft(''); setQ(''); setPage(1); }}>{bt('bzx.clear')}</button> : null}
        </form>
        {!s && !error ? <div className="state">{bt('pos.loading_branch_comparison')}</div> : rows.length === 0 ? <Empty title={q ? bt('bzx.noMatch') : bt('pos.no_authorized_branches_to_compare')} /> : (
          <div className="rvw-table-wrap"><table className="tbl rvw-table" data-testid="bcx-table"><thead><tr>
            <th>{bt('pos.branch')}</th><th className="num">{bt('pos.net_sales')}</th><th className="num">{bt('pos.avg_ticket')}</th><th className="num">{bt('pos.bookings_2')}</th>
            <th className="num">{bt('pos.completed_2')}</th><th className="num">{bt('pos.completion')}</th><th className="num">{bt('pos.rev_completed')}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.branchId} data-testid="bcx-row" tabIndex={0} role="button" style={{ cursor: 'pointer' }} onClick={() => setOpen(r)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r); }}>
                <td><b>{r.branchName}</b>{r.status !== 'active' ? <span className="chip" style={{ marginLeft: 6 }}>{bt('bcx.inactive')}</span> : null}</td>
                <td className="num">{fin && r.netSalesCents != null ? money(r.netSalesCents) : '—'}{C && fin ? <span className="sub" style={{ display: 'block' }} data-testid="bcx-d-net">{dMoney(r.netSalesCents, C.byBranch[r.branchId]?.netSalesCents)}</span> : null}</td>
                <td className="num">{!fin ? '—' : r.averageTicketCents == null ? bt('bcx.na') : money(r.averageTicketCents)}</td>
                <td className="num">{bzNum(r.totalBookings)}{C ? <span className="sub" style={{ display: 'block' }} data-testid="bcx-d-bookings">{dNum(r.totalBookings, C.byBranch[r.branchId]?.totalBookings)}</span> : null}</td>
                <td className="num">{bzNum(r.completed)}</td>
                <td className="num" data-testid="bcx-completion">{pct(r.completionRate)}{small(r) ? <span className="chip" style={{ marginLeft: 4 }} title={bt('bcx.smallTip', { n: String(r.totalBookings ?? 0) })} data-testid="bcx-small">{bt('bcx.small')}</span> : null}</td>
                <td className="num">{!fin ? '—' : r.revenuePerCompletedAppointmentCents == null ? bt('bcx.na') : money(r.revenuePerCompletedAppointmentCents)}</td>
              </tr>))}</tbody></table></div>)}
        {/* extras (Nov 11 2026) — metric definitions (denominator, exclusions, time basis, why N/A) and the small-sample rule */}
        {rows.length ? <details style={{ marginTop: 8 }} data-testid="bcx-defs"><summary className="sub" style={{ cursor: 'pointer', minHeight: 32 }}>{bt('bcx.defs')}</summary>
          <ul className="sub" style={{ paddingLeft: 18, margin: '6px 0' }}>{['net', 'avg', 'bookings', 'completed', 'completion', 'revCompleted', 'small', 'fair'].map((k) => <li key={k}>{bt('bcx.def.' + k, { n: String(SMALL_N) })}</li>)}</ul></details> : null}
        <div className="rvw-pager">
          <Pager info={s ? { page: s.page, pageSize: s.pageSize, totalItems: s.totalItems, totalPages: s.totalPages } : null} onPage={setPage} />
          <label className="rvw-f"><span>{bt('bzx.rows')}</span><select data-testid="bcx-size" value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>{['10', '25', '50'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
      </section>

      <BranchInsightsPanel period={period} tick={tick} />
      {/* AI BRANCH COMPARISON 14: save this comparison (frozen by the server) and sign off on it */}
      <BranchSnapshotsPanel period={period} tick={tick} />
      {s ? <div className="sub" style={{ marginTop: 10 }}><Link className="link-44" to={s.drilldownRoute} style={{ color: 'var(--aps-orange)' }}>{bt('pos.open_the_sales_report')}</Link></div> : null}
      {s?.notes.length ? <ul className="sub" style={{ marginTop: 10, paddingLeft: 18 }}>{s.notes.map((n, i) => <li key={i} style={{ marginBottom: 4 }}>{n}</li>)}</ul> : null}

      {open ? <FitDialog testId="bcx-detail" title={open.branchName} onClose={() => setOpen(null)} footer={<><Link className="btn ghost" to={s?.drilldownRoute ?? '/tenant/reports/sales'}>{bt('pos.open_the_sales_report')}</Link><button className="btn ghost" onClick={() => setOpen(null)}>{bt('bzx.close')}</button></>}>
        <p className="sub">{s?.range ? bzDays(s.range) : bt('bzx.period.' + (s?.preset ?? 'month'))}</p>
        <table className="tbl"><tbody>
          <tr><td>{bt('pos.net_sales')}</td><td className="num">{fin && open.netSalesCents != null ? money(open.netSalesCents) : '—'}</td></tr>
          <tr><td>{bt('bcx.d.tickets')}</td><td className="num">{fin ? bzNum(open.ticketsCount) : '—'}</td></tr>
          <tr><td>{bt('pos.avg_ticket')}</td><td className="num">{!fin ? '—' : open.averageTicketCents == null ? bt('bcx.na') : money(open.averageTicketCents)}</td></tr>
          <tr><td>{bt('pos.bookings_2')}</td><td className="num">{bzNum(open.totalBookings)}</td></tr>
          <tr><td>{bt('pos.completed_2')}</td><td className="num">{bzNum(open.completed)}</td></tr>
          <tr><td>{bt('pos.completion')}</td><td className="num">{pct(open.completionRate)}</td></tr>
          <tr><td>{bt('bcx.d.cancelled')}</td><td className="num">{open.totalBookings ? `${open.cancelledPercent}%` : bt('bcx.na')}</td></tr>
          <tr><td>{bt('bcx.d.noShow')}</td><td className="num">{open.totalBookings ? `${open.noShowPercent}%` : bt('bcx.na')}</td></tr>
          <tr><td>{bt('pos.rev_completed')}</td><td className="num">{!fin ? '—' : open.revenuePerCompletedAppointmentCents == null ? bt('bcx.na') : money(open.revenuePerCompletedAppointmentCents)}</td></tr>
          {/* AI Business Assistant 09: share of the salon totals with the denominators shown — a bigger branch naturally has bigger totals */}
          <tr data-testid="bcx-share-net"><td>{bt('bcx.fair.shareNet')}</td><td className="num">{!fin ? '—' : (() => { const v = branchShare(open.netSalesCents, T?.netSalesCents); return v == null ? bt('bcx.na') : bt('bcx.fair.ofTotal', { pct: String(v), total: money(T?.netSalesCents) }); })()}</td></tr>
          <tr data-testid="bcx-share-bookings"><td>{bt('bcx.fair.shareBookings')}</td><td className="num">{(() => { const v = branchShare(open.totalBookings, T?.totalBookings); return v == null ? bt('bcx.na') : bt('bcx.fair.ofCount', { pct: String(v), n: bzNum(open.totalBookings), total: bzNum(T?.totalBookings ?? 0) }); })()}</td></tr>
        </tbody></table>
        <p className="sub" data-testid="bcx-fair-note">{bt('bcx.fair.note', { n: bzNum(T?.branches ?? 0) })}</p>
        <p className="sub">{bt('bcx.d.note')}</p>
      </FitDialog> : null}
    </div>
  );
}
