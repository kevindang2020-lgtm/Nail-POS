// POSCustomersReportScreen.tsx — Reports → Customers (SUNMI batch 9 guide 7, Nov 10 2026). GET /pos/reports/customers
// (financial or pos.reports.customer_view). Preserved: title, Full View, the three cards with their change line, Mix chart.
// Fixed: the period tabs did nothing (`period` sent, `preset` read); the change arrows were a constant "0%" — now the change
// against the previous period of the same length, N/A when there is no base (retention's change is not computed → hidden);
// counts are on the payment day (the same population as every money figure).
// Added: custom dates (URL), "How calculated?", retention's cohort shown, the Mix chart with counts + shares, and the
// period's customer list (GET /pos/reports/customers/page): new / returning chips, search incl. formatted phone (only the
// last 4 digits come back), most recent visit first, 10/25/50/100; net sales only with the financial permission.
import { useRealtime } from '../realtime/useRealtime';
import { useEffect, useRef, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { api } from '../api/client';
import { useReportCadence, reportError, useUrlPeriod, money } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { PeriodBar } from '../components/FinanceKit';
import { Pager } from '../components/FitKit';
import { fmtInTz } from '../i18n/format';
import { HowCalculated } from './POSReportsScreen';
import type { ReportCustomerPage } from '@aipowersalon/api-contracts/tenant';

type CustomerInsights = {
  newCustomers: number; newCustomersTrendPercent: number | null;
  returningCustomers: number; returningCustomersTrendPercent: number | null;
  retentionRatePercent: number | null; retentionRateTrendPercent: number | null;
  retentionReturned?: number; retentionCohort?: number;
};
const pct = (n: number) => `${(n ?? 0).toFixed(1)}%`;
const Delta = ({ t, testId }: { t: number | null | undefined; testId?: string }) => (t == null
  ? <div className="d flat" data-testid={testId}>{tx('rpt.cust.noBase')}</div>
  : <div className={`d ${t < 0 ? 'flat' : ''}`} data-testid={testId}>{t >= 0 ? '▲' : '▼'} {Math.abs(t)}% {tx('rpt.cust.vsPrev')}</div>);
export const CUSTOMER_CALC_KEYS = ['newCustomers', 'returningCustomers', 'retention', 'customers'] as const;

export function POSCustomersReportScreen() {
  const { reloadKey } = useReportCadence();
  // Constitution 9: ticket_paid / customer_profile_updated / loyalty_points_added route to the 'customers' screen.
  const [liveKey, setLiveKey] = useState(0);
  useRealtime('customers', () => setLiveKey((k) => k + 1));
  const { period, setPeriod, query } = useUrlPeriod('month');
  const [c, setC] = useState<CustomerInsights | null>(null);
  const [range, setRange] = useState<{ from: string; to: string; timezone?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCalc, setShowCalc] = useState(false);
  const [type, setType] = useState<'all' | 'new' | 'returning'>('all');
  const { open: openIPad } = useIPadView();
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(query);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    Promise.all([posReportsApi.customers(query), Promise.resolve(posReportsApi.state(query)).catch(() => null)])
      .then(([d, st]: any[]) => { if (alive) { setC(d as CustomerInsights); setRange(st?.dateRange ?? null); } })
      .catch((e: any) => { if (alive) { setC(null); setError(reportError(e, tx('pos.customers_report'))); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadKey, liveKey]);

  const server = range ? { preset: period.preset, from: range.from, to: range.to, tz: range.timezone ?? '', today: range.to } : null;
  const total = c ? (c.newCustomers || 0) + (c.returningCustomers || 0) : 0;
  const share = (n: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : tx('rpt.na'));
  const mix: ['new' | 'returning', string, number][] = c ? [['new', tx('pos.new'), c.newCustomers || 0], ['returning', tx('pos.returning'), c.returningCustomers || 0]] : [];
  const max = Math.max(1, ...mix.map(([, , v]) => v));

  return (
    <div className="work">
      <div className="vh "><h1>{tx('pos.customers_report')}</h1><div className="sub mb-3">{tx('pos.new_vs_returning_customers_and_retention')}</div></div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <PeriodBar value={period} onChange={setPeriod} server={server} basis="paid" basisOptions={[{ value: 'paid', label: tx('rpt.basisPaid') }]} />
        <div className="flex gap-2">
          <button className="btn ghost" data-testid="cust-how" aria-expanded={showCalc} onClick={() => setShowCalc((v) => !v)}>{tx('rpt.how')}</button>
          <button className="btn ghost w-fit whitespace-nowrap" disabled={!c} title={tx('pos.open_full_ipad_view')} onClick={() => c && openIPad(reportRequest(tx('pos.customers_report'), { kpis: [{ label: tx('pos.new_customers'), value: c.newCustomers }, { label: tx('pos.returning'), value: c.returningCustomers }, { label: tx('pos.retention'), value: c.retentionRatePercent == null ? tx('rpt.na') : c.retentionRatePercent + '%' }], periodLabel: range ? `${range.from} – ${range.to}` : undefined }))}>{tx('pos.full_view')}</button>
        </div>
      </div>
      {showCalc ? <HowCalculated keys={CUSTOMER_CALC_KEYS} /> : null}
      {loading && !c ? <div className="state">{tx('pos.loading_customers_report')}</div> : null}
      {error ? <div className="err" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}
      {c ? (<>
        <div className="kpis">
          <div className="kpi"><div className="l">{tx('pos.new_customers')}</div><div className="v">{c.newCustomers ?? 0}</div><Delta t={c.newCustomersTrendPercent} testId="cust-delta-new" /></div>
          <div className="kpi"><div className="l">{tx('pos.returning_customers_2')}</div><div className="v">{c.returningCustomers ?? 0}</div><Delta t={c.returningCustomersTrendPercent} testId="cust-delta-ret" /></div>
          <div className="kpi"><div className="l">{tx('pos.retention_rate')}</div><div className="v">{c.retentionRatePercent == null ? tx('rpt.na') : pct(c.retentionRatePercent)}</div>
            {c.retentionCohort ? <div className="d flat" data-testid="cust-retention-basis">{tx('rpt.retBasis', { n: String(c.retentionReturned ?? 0), d: String(c.retentionCohort) })}</div> : null}</div>
        </div>
        <section className="panel mb-3">
          <div className="p-h">{tx('pos.mix')}</div>
          {total === 0 ? <div className="state" data-testid="cust-empty">{tx('rpt.cust.empty', { from: range?.from ?? '', to: range?.to ?? '' })}</div> : (
            <div role="list" aria-label={tx('pos.new_vs_returning')}>
              {mix.map(([k, label, v]) => {
                const tip = tx('rpt.cust.tip', { label, n: String(v), share: share(v) });
                return (
                  <button key={k} type="button" role="listitem" title={tip} aria-label={tip} aria-pressed={type === k} data-testid={`cust-bar-${k}`} className="w-full text-left"
                    style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 160px) minmax(0, 1fr) auto', gap: 10, alignItems: 'center', minHeight: 44, background: 'none', border: 0, cursor: 'pointer' }}
                    onClick={() => setType(type === k ? 'all' : k)}>
                    <span style={{ fontWeight: type === k ? 700 : 400 }}>{label}</span>
                    <span style={{ height: 14, background: 'var(--line)', borderRadius: 6 }}><span style={{ display: 'block', height: 14, width: `${Math.round((v / max) * 100)}%`, minWidth: v ? 3 : 0, background: k === 'new' ? 'var(--gold)' : '#3E6FB0', borderRadius: 6 }} /></span>
                    <span className="num">{v} · {share(v)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <section className="panel mb-3">
          <div className="p-h">{tx('rpt.cust.list')}</div>
          <CustomerList period={query} type={type} onType={setType} />
        </section>
      </>) : null}
    </div>
  );
}

export function CustomerList({ period, type, onType }: { period: Record<string, unknown>; type: 'all' | 'new' | 'returning'; onType: (t: 'all' | 'new' | 'returning') => void }) {
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [d, setD] = useState<ReportCustomerPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(period);
  const first = useRef(true);
  useEffect(() => { setPage(1); }, [key, q, size, type]);
  useEffect(() => { if (first.current) { first.current = false; return; } const h = setTimeout(() => setQ(draft.trim()), 300); return () => clearTimeout(h); }, [draft]);
  useEffect(() => {
    let alive = true; setErr(null);
    (api.get('/pos/reports/customers/page', { ...period, type, q: q || undefined, page, pageSize: size }) as Promise<ReportCustomerPage>)
      .then((r) => { if (!alive) return; if (Array.isArray(r?.items)) setD(r); else { setD(null); setErr(tx('rpt.cust.listFailed')); } })
      .catch((e: any) => { if (alive) { setD(null); setErr(reportError(e, tx('rpt.cust.list'))); } });
    return () => { alive = false; };
  }, [key, q, page, size, type]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <div className="fk-seg" role="group" aria-label={tx('rpt.cust.type')}>
          {(['all', 'new', 'returning'] as const).map((k) => <button key={k} type="button" className={type === k ? 'on' : ''} aria-pressed={type === k} style={{ minHeight: 44 }} data-testid={`cust-type-${k}`} onClick={() => onType(k)}>{tx('rpt.cust.t.' + k)}</button>)}
        </div>
        <input className="input" style={{ minWidth: 280, minHeight: 44 }} data-testid="cust-search" maxLength={80} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tx('rpt.cust.search')} aria-label={tx('rpt.cust.search')} />
        {draft ? <button className="btn ghost sm" onClick={() => { setDraft(''); setQ(''); }}>{tx('rpt.tx.clear')}</button> : null}
        <label className="s">{tx('rpt.tx.perPage')}{' '}<select className="input" style={{ minHeight: 44 }} value={size} onChange={(e) => setSize(Number(e.target.value))}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        {d ? <span className="s" data-testid="cust-count">{tx('rpt.cust.count', { n: String(d.total) })}</span> : null}
      </div>
      {err ? <div className="err" role="alert">{err}</div> : !d ? <div className="muted">{tx('pos.loading_reports')}</div> : d.items.length === 0 ? (
        <div className="muted" data-testid="cust-nomatch">{q || type !== 'all' ? tx('rpt.tx.noMatch') : tx('rpt.cust.none')}</div>
      ) : (
        <div className="overflow-x-auto w-full"><table className="tbl w-full" data-testid="cust-table">
          <thead><tr><th>{tx('rpt.svc.customer')}</th><th>{tx('rpt.cust.phone')}</th><th>{tx('rpt.cust.typeCol')}</th><th style={{ textAlign: 'right' }}>{tx('rpt.cust.visits')}</th><th>{tx('rpt.cust.last')}</th>{d.moneyVisible ? <th style={{ textAlign: 'right' }}>{tx('rpt.sales.col.net')}</th> : null}</tr></thead>
          <tbody>{d.items.map((r) => (
            <tr key={r.customerId}>
              <td>{r.customer || '—'}</td><td>{r.phoneLast4 ? `•••-${r.phoneLast4}` : '—'}</td><td>{tx('rpt.cust.t.' + r.type)}</td>
              <td style={{ textAlign: 'right' }}>{r.visits}</td>
              <td className="whitespace-nowrap">{fmtInTz(r.lastVisitAt, d.timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
              {d.moneyVisible ? <td className="num" style={{ textAlign: 'right' }}>{money(r.netSalesCents ?? 0)}</td> : null}
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {d ? <Pager info={{ page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: Math.max(1, Math.ceil(d.total / d.pageSize)) }} onPage={setPage} label={tx('rpt.cust.pager')} /> : null}
    </div>
  );
}
