// POSAiBranchCompareScreen.tsx — AI Center → AI Branch Comparison (/tenant/ai/business/branches). AI Branch Comparison guide (Nov 3 2026).
// Keeps the photographed page — the period tabs, the 7-column branch table and the Sales Report link — and finishes it:
//   • a KPI strip of whole-salon totals over every branch that matched (not just this page), with the time it was read and Refresh;
//   • presets (today … this year) plus a custom From / To month calendar;
//   • every authorized branch (the 20-branch cap is gone): search by name, inactive branches hidden unless asked, pages of 10 / 25 / 50;
//   • N/A where a ratio has no denominator (it showed 0 % and $0.00), and an average ticket that is net ÷ tickets like Net Sales;
//   • a row opens that branch's full figures.
// Every number comes from GET /pos/ai-business/branches/compare (the canonical Sales Report, one authorized branch at a time).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { posAiBusinessApi } from '../api/posAiBusinessApi';
import { KpiCard, Pager, Empty, ErrorRetry, FitDialog } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { bt, bzWhen, bzNum, bzValue, bzDays } from '../components/BusinessKit';
import { reportError } from './reportsCommon';

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
};
const PRESETS = ['today', 'yesterday', 'week', 'month', 'quarter', 'year'] as const;
const money = (c: number | null | undefined) => bzValue(c ?? null, 'cents');
const pct = (n: number | null | undefined) => (n == null ? bt('bcx.na') : `${n}%`);
const na = (v: string | null) => v ?? bt('bcx.na');

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

  const load = useCallback(() => {
    setError(null);
    const p = period.preset === 'custom' ? { from: period.from, to: period.to } : { preset: period.preset };
    posAiBusinessApi.compareBranches({ ...p, q: q || undefined, includeInactive: inactive ? 'true' : undefined, page, pageSize })
      .then((x) => setS(x as Comparison)).catch((e) => setError(reportError(e, bt('growth.noun.theBranchComparison'))));
  }, [period, q, inactive, page, pageSize]);
  useEffect(() => { load(); }, [load, tick]);
  const pick = (p: typeof period) => { setPeriod(p); setPage(1); };

  const rows = s?.branches ?? [];
  const fin = s?.financialsIncluded !== false;
  const T = s?.totals;
  return (
    <div className="work rvw" data-testid="bcx">
      <div className="rvw-head">
        <div className="vh"><h1>{bt('pos.ai_branch_comparison')}</h1><div className="sub">{bt('pos.your_authorized_branches_side_by_side_1h3w')}</div></div>
        <div className="rvw-actions">
          {s ? <span className="sub" data-testid="bcx-asof">{bt('bcx.asOf', { at: bzWhen(s.asOf) })}</span> : null}
          <button type="button" className="btn ghost" data-testid="bcx-refresh" onClick={() => setTick((n) => n + 1)}>{bt('bzx.refresh')}</button>
        </div>
      </div>

      <div className="rvw-dates" data-testid="bcx-period" style={{ position: 'relative' }}>
        {PRESETS.map((x) => <button key={x} type="button" className={'btn ghost' + (period.preset === x ? ' on' : '')} data-testid={`bcx-preset-${x}`} onClick={() => pick({ preset: x })}>{bt('bzx.period.' + x)}</button>)}
        <button type="button" className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} data-testid="bcx-custom" onClick={() => setCal(true)}>
          {period.preset === 'custom' ? bzDays({ from: period.from, to: period.to }) : bt('bzx.preset.custom')}</button>
        {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={new Date().toISOString().slice(0, 10)}
          onApply={(r) => { pick({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { pick({ preset: 'month' }); setCal(false); }} /></div> : null}
      </div>

      {error ? <ErrorRetry message={error} onRetry={load} /> : null}
      <div className="rvw-kpis" data-testid="bcx-kpis">
        <KpiCard testId="bcx-k-net" label={bt('bcx.k.net')} value={T ? (fin ? money(T.netSalesCents) : '—') : '—'} loading={!s && !error} />
        <KpiCard testId="bcx-k-avg" label={bt('bcx.k.avg')} value={T ? (fin ? na(T.averageTicketCents == null ? null : money(T.averageTicketCents)) : '—') : '—'} loading={!s && !error} />
        <KpiCard testId="bcx-k-bookings" label={bt('bcx.k.bookings')} value={T ? bzNum(T.totalBookings) : '—'} loading={!s && !error} />
        <KpiCard testId="bcx-k-completion" label={bt('bcx.k.completion')} value={T ? pct(T.completionRate) : '—'} loading={!s && !error} />
        <KpiCard testId="bcx-k-branches" label={bt('bcx.k.branches')} value={T ? bzNum(T.branches) : '—'} sub={s?.inactiveHidden ? bt('bcx.inactiveHidden', { n: s.inactiveHidden }) : undefined} loading={!s && !error} />
      </div>
      {s?.partialCurrentPeriod ? <div className="sub">{bt('pos.today_is_partial_figures_are_still_1a7b')}</div> : null}

      <section className="panel rvw-feed" style={{ padding: 12, marginTop: 12 }}>
        <div className="p-h">{bt('pos.branches')}</div>
        <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); setPage(1); }}>
          <input className="rvw-search" type="search" data-testid="bcx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={bt('bcx.searchPh')} aria-label={bt('bcx.searchPh')} />
          <button className="btn" type="submit">{bt('bzx.search')}</button>
          <label className="rvw-f" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" data-testid="bcx-inactive" checked={inactive} onChange={(e) => { setInactive(e.target.checked); setPage(1); }} /><span>{bt('bcx.showInactive')}</span></label>
          {q ? <button className="btn ghost" type="button" onClick={() => { setDraft(''); setQ(''); setPage(1); }}>{bt('bzx.clear')}</button> : null}
        </form>
        {!s && !error ? <div className="state">{bt('pos.loading_branch_comparison')}</div> : rows.length === 0 ? <Empty title={q ? bt('bzx.noMatch') : bt('pos.no_authorized_branches_to_compare')} /> : (
          <div className="rvw-table-wrap"><table className="tbl rvw-table" data-testid="bcx-table"><thead><tr>
            <th>{bt('pos.branch')}</th><th className="num">{bt('pos.net_sales')}</th><th className="num">{bt('pos.avg_ticket')}</th><th className="num">{bt('pos.bookings_2')}</th>
            <th className="num">{bt('pos.completed_2')}</th><th className="num">{bt('pos.completion')}</th><th className="num">{bt('pos.rev_completed')}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.branchId} data-testid="bcx-row" tabIndex={0} role="button" style={{ cursor: 'pointer' }} onClick={() => setOpen(r)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r); }}>
                <td><b>{r.branchName}</b>{r.status !== 'active' ? <span className="chip" style={{ marginLeft: 6 }}>{bt('bcx.inactive')}</span> : null}</td>
                <td className="num">{fin && r.netSalesCents != null ? money(r.netSalesCents) : '—'}</td>
                <td className="num">{!fin ? '—' : r.averageTicketCents == null ? bt('bcx.na') : money(r.averageTicketCents)}</td>
                <td className="num">{bzNum(r.totalBookings)}</td>
                <td className="num">{bzNum(r.completed)}</td>
                <td className="num" data-testid="bcx-completion">{pct(r.completionRate)}</td>
                <td className="num">{!fin ? '—' : r.revenuePerCompletedAppointmentCents == null ? bt('bcx.na') : money(r.revenuePerCompletedAppointmentCents)}</td>
              </tr>))}</tbody></table></div>)}
        <div className="rvw-pager">
          <Pager info={s ? { page: s.page, pageSize: s.pageSize, totalItems: s.totalItems, totalPages: s.totalPages } : null} onPage={setPage} />
          <label className="rvw-f"><span>{bt('bzx.rows')}</span><select data-testid="bcx-size" value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>{['10', '25', '50'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
      </section>

      {s ? <div className="sub" style={{ marginTop: 10 }}><Link to={s.drilldownRoute} style={{ color: 'var(--aps-orange)' }}>{bt('pos.open_the_sales_report')}</Link></div> : null}
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
        </tbody></table>
        <p className="sub">{bt('bcx.d.note')}</p>
      </FitDialog> : null}
    </div>
  );
}
