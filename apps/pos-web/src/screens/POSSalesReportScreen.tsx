// POSSalesReportScreen.tsx — Reports → Sales (SUNMI batch 9 guide 4, Nov 10 2026). Read-only; GET /pos/reports/state
// (pos.reports.view). Preserved: title, the nine KPI cards, Revenue Trend, Top Services, Full View, Refresh, Export CSV.
// Upgraded:
//  · the period = presets + Custom From–To calendar (salon days), kept in the URL; "refreshed at" shown
//  · the nine cards say how each is calculated (one shared dictionary with Daily Summary); Avg Ticket is N/A with no ticket
//  · the trend is the shared Revenue & Appointments Trend (every bucket of the period — a lone October bar can no longer
//    appear under "This Month"); Top Services is the shared line-level Revenue by Service and opens the Services Report
//  · a Ticket Explorer: one row per paid ticket, newest first, searchable, 10/25/50/100, each money part its own column
//  · Export CSV exports the SALES report for the chosen period (it sent `kind`, which the API ignores, so it exported the
//    transactions list) and says when it fails
import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { posReportsApi } from '../api/posReportsApi';
import { api } from '../api/client';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { useReportCadence, RefreshButton, svcCategoryLabel, servicesReportHref, reportError } from './reportsCommon';
import { fmtMoney, fmtInTz } from '../i18n/format';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { PeriodBar, periodQuery, type PeriodState } from '../components/FinanceKit';
import { Pager } from '../components/FitKit';
import { SystemCheckButton } from '../components/SystemCheck';
import { useCan } from '../components/usePermissions';
import { statusLabel } from '../i18n/status-label';
import { TrendPanel, HowCalculated, ChargeReconcile, type RevenueTrend } from './POSReportsScreen';
import type { ReportTicketPage } from '@aipowersalon/api-contracts/tenant';

const money = (c: number) => fmtMoney(c || 0);

type SalesKpis = {
  grossSalesCents: number; netSalesCents: number; serviceSalesCents: number; productSalesCents: number;
  tipsCents: number; taxCollectedCents: number; cardSurchargeCents: number; discountsCents: number;
  refundsCents: number; ticketsCount: number; customersCount: number; averageTicketCents: number;
};
type ServiceRow = { serviceId: string; serviceName: string; revenueCents: number; serviceCount: number; percentOfTop: number };
type ReportState = {
  salesKpis: SalesKpis; revenueByService?: ServiceRow[]; trend?: RevenueTrend;
  payments?: { cardCents: number; cashCents: number; giftCardCents: number; collectedCents?: number };
  dateRange?: { from: string; to: string; timezone?: string };
};
const PRESETS = ['today', 'week', 'month', 'year', 'custom'];
export const SALES_CALC_KEYS = ['totalRevenue', 'netSales', 'serviceSales', 'productSales', 'tips', 'tax', 'avgTicket', 'tickets', 'customers', 'charged'] as const;

export function POSSalesReportScreen() {
  const [sp, setSp] = useSearchParams();
  const preset = PRESETS.includes(sp.get('preset') || '') ? (sp.get('preset') as PeriodState['preset']) : 'month';
  const period: PeriodState = preset === 'custom' ? { preset, from: sp.get('from') || undefined, to: sp.get('to') || undefined } : { preset };
  const setPeriod = (v: PeriodState) => { const p = new URLSearchParams(); p.set('preset', v.preset); if (v.preset === 'custom') { if (v.from) p.set('from', v.from); if (v.to) p.set('to', v.to); } setSp(p); };
  const [s, setS] = useState<ReportState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [showCalc, setShowCalc] = useState(false);
  const [groupBy, setGroupBy] = useState<string | undefined>(undefined);
  const [compare, setCompare] = useState(false);
  const [bucket, setBucket] = useState<{ from: string; to: string; label: string } | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const { open: openIPad } = useIPadView();
  const { reloadKey, refresh } = useReportCadence();
  const nav = useNavigate();
  const can = useCan();
  const pq = periodQuery(period);
  const key = JSON.stringify(pq);
  useEffect(() => { setGroupBy(undefined); setBucket(null); }, [key]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    posReportsApi.state({ ...pq, ...(groupBy ? { groupBy } : {}), ...(compare ? { compare: '1' } : {}) })
      .then((d: any) => { if (alive) { setS(d); setRefreshedAt(new Date().toISOString()); } })
      .catch((e: any) => {
        if (!alive) return;
        // an error never leaves the last period's figures on screen as if they were this one's
        setS(null);
        setError(e?.status === 403 ? t('pos.you_do_not_have_permission_to_ynwv') : (e?.message || t('pos.could_not_load_the_sales_report')));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, groupBy, compare, reloadKey]);

  const doExport = async () => {
    setBusy(true); setNote(null);
    try {
      const r: any = await posReportsApi.exportReport({ type: 'sales', format: 'csv', ...pq });
      if (r?.disabledReason) setNote(r.disabledReason);
      else if (r?.csv) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8;' }));
        link.download = r.filename || 'sales-export.csv'; link.style.visibility = 'hidden';
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
        setNote(t('rpt.sales.exported'));
      } else setNote(t('rpt.sales.exportEmpty'));
    } catch (e: any) { setNote(reportError(e, t('pos.sales_report'))); } finally { setBusy(false); }
  };

  const k = s?.salesKpis;
  const services = s?.revenueByService || [];
  const tz = s?.dateRange?.timezone ?? null;
  const server = s?.dateRange ? { preset, from: s.dateRange.from, to: s.dateRange.to, tz: tz ?? '', today: s.dateRange.to } : null;
  const avg = k && k.ticketsCount > 0 ? money(k.averageTicketCents) : t('rpt.na');
  const cards: [string, string, string][] = k ? [
    [t('pos.gross_sales'), money(k.grossSalesCents), 'totalRevenue'],
    [t('pos.net_sales'), money(k.netSalesCents), 'netSales'],
    [t('pos.service_sales_2'), money(k.serviceSalesCents), 'serviceSales'],
    [t('pos.product_sales'), money(k.productSalesCents), 'productSales'],
    [t('pos.tips'), money(k.tipsCents), 'tips'],
    [t('pos.tax_collected_2'), money(k.taxCollectedCents), 'tax'],
    [t('pos.avg_ticket'), avg, 'avgTicket'],
    [t('pos.tickets'), String(k.ticketsCount ?? 0), 'tickets'],
    [t('glossary.nav.customers'), String(k.customersCount ?? 0), 'customers'],
  ] : [];

  return (
    <div className="work">
      <div className="vh ">
        <h1>{t('pos.sales_report')}</h1>
        <div className="sub mb-3">{s?.dateRange ? t('rpt.sales.sub', { from: s.dateRange.from, to: s.dateRange.to }) : t('pos.revenue_performance_over_the_selected_period')}</div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="flex flex-wrap items-center gap-2"><SystemCheckButton domain="reports" />
          <button className="btn ghost" data-testid="sales-how" aria-expanded={showCalc} onClick={() => setShowCalc((v) => !v)}>{t('rpt.how')}</button></div>
        <div className="flex flex-wrap items-center gap-1">
          <button className="btn ghost w-fit whitespace-nowrap" disabled={!s} title={t('pos.open_full_ipad_view')} onClick={() => s && openIPad(reportRequest(t('pos.sales_report'), { kpis: cards.map(([label, value]) => ({ label, value })), columns: [t('glossary.term.service'), t('pos.revenue'), t('pos.count'), t('admin.reports.percentOfTop')], rows: services.map((sv) => [svcCategoryLabel(sv.serviceId, sv.serviceName), money(sv.revenueCents), sv.serviceCount, Math.round(sv.percentOfTop) + '%']), periodLabel: s.dateRange ? `${s.dateRange.from} – ${s.dateRange.to}` : undefined }))}>{t('pos.full_view')}</button>
          <RefreshButton onClick={refresh} busy={loading} />
          {can('pos.reports.export') ? <button className="btn ghost w-fit whitespace-nowrap" data-testid="sales-export" disabled={busy || !s} onClick={doExport}>{busy ? t('pos.exporting') : t('pos.export_csv_2')}</button> : null}
        </div>
      </div>
      <PeriodBar value={period} onChange={setPeriod} server={server} basis="paid" basisOptions={[{ value: 'paid', label: t('rpt.basisPaid') }]} />
      {refreshedAt && s ? <div className="s mb-2" data-testid="sales-refreshed">{t('rpt.sales.refreshed', { at: fmtInTz(refreshedAt, tz, { hour: 'numeric', minute: '2-digit', second: '2-digit' }) })}</div> : null}
      {note ? <div className="note mb-2" role="status">{note}</div> : null}
      {showCalc ? <HowCalculated keys={SALES_CALC_KEYS} /> : null}
      {loading && !s ? <div className="state">{t('pos.loading_sales_report')}</div> : null}
      {error ? <div className="err" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}

      {s && k ? (<>
        <div className="kpis">{cards.map(([l, v, ck]) => (<div className="kpi" key={l} title={t(`rpt.calc.${ck}.d`)}><div className="l">{l}</div><div className="v">{v}</div></div>))}</div>
        {s.payments ? <ChargeReconcile sk={k} collectedCents={s.payments.collectedCents ?? s.payments.cardCents + s.payments.cashCents + s.payments.giftCardCents} money={money} /> : null}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3 mb-3">
          <section className="panel" style={{ minWidth: 0 }}>
            <div className="p-h">{t('pos.revenue_trend')}</div>
            <TrendPanel trend={s.trend ?? null} money={money} kpiRevenue={k.grossSalesCents} kpiTickets={k.ticketsCount} compare={compare} onCompare={setCompare} onGroupBy={setGroupBy}
              onBucket={(b) => { setBucket(b); setTimeout(() => document.getElementById('sales-tickets')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 0); }} />
          </section>
          <section className="panel" style={{ minWidth: 0 }}>
            <div className="flex items-center justify-between gap-2"><div className="p-h">{t('pos.top_services')}</div>
              {services.length ? <button className="btn ghost sm" onClick={() => nav(servicesReportHref(pq))}>{t('rpt.svc.viewAll', { n: String(services.length) })}</button> : null}</div>
            <div className="s mb-1">{t('rpt.svc.basis')}</div>
            {services.length === 0 ? <div className="state">{t('rpt.svc.empty', { from: s.dateRange?.from ?? '', to: s.dateRange?.to ?? '' })}</div> : (
              <div className="overflow-x-auto w-full"><table className="tbl w-full">
                <thead><tr><th>{t('pos.service_3')}</th><th style={{ textAlign: 'right' }}>{t('pos.count')}</th><th style={{ textAlign: 'right' }}>{t('pos.revenue')}</th></tr></thead>
                <tbody>{services.slice(0, 10).map((r) => (
                  <tr key={r.serviceId}><td><button className="btn ghost sm" style={{ minHeight: 36 }} onClick={() => nav(servicesReportHref(pq, r.serviceId))}>{svcCategoryLabel(r.serviceId, r.serviceName)}</button></td><td style={{ textAlign: 'right' }}>{r.serviceCount}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.revenueCents)}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </div>

        <section className="panel mb-3" id="sales-tickets">
          <div className="p-h">{t('rpt.sales.tickets')}</div>
          {bucket ? <div className="flex items-center gap-2 mb-2" data-testid="sales-bucket-chip"><span className="chip">{t('rpt.trend.showing', { label: bucket.label })}</span><button className="btn ghost sm" onClick={() => setBucket(null)}>{t('rpt.tx.clear')}</button></div> : null}
          {can('pos.reports.financial_view') ? <TicketExplorer period={bucket ? { preset: 'custom', from: bucket.from, to: bucket.to } : pq} /> : <div className="s">{t('rpt.sales.ticketsRestricted')}</div>}
        </section>
      </>) : null}
    </div>
  );
}

/** guide 4 §15: one row per paid ticket — newest first, searchable, paged; every money part its own column; read-only. */
export function TicketExplorer({ period }: { period: Record<string, unknown> }) {
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [d, setD] = useState<ReportTicketPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const key = JSON.stringify(period);
  const first = useRef(true);
  useEffect(() => { setPage(1); }, [key, q, size]);
  useEffect(() => { if (first.current) { first.current = false; return; } const h = setTimeout(() => setQ(draft.trim()), 300); return () => clearTimeout(h); }, [draft]);
  useEffect(() => {
    let alive = true; setErr(null);
    (api.get('/pos/reports/tickets/page', { ...period, q: q || undefined, page, pageSize: size }) as Promise<ReportTicketPage>)
      .then((r) => { if (!alive) return; if (Array.isArray(r?.items)) setD(r); else { setD(null); setErr(t('rpt.sales.ticketsFailed')); } })
      .catch((e: any) => { if (alive) { setD(null); setErr(reportError(e, t('rpt.sales.tickets'))); } });
    return () => { alive = false; };
  }, [key, q, page, size]);   // eslint-disable-line react-hooks/exhaustive-deps -- period keyed by its JSON
  const m = money;
  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <input className="input" style={{ minWidth: 300, minHeight: 44 }} data-testid="sales-search" maxLength={80} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('rpt.sales.search')} aria-label={t('rpt.sales.search')} />
        {draft ? <button className="btn ghost sm" onClick={() => { setDraft(''); setQ(''); }}>{t('rpt.tx.clear')}</button> : null}
        <label className="s">{t('rpt.tx.perPage')}{' '}<select className="input" style={{ minHeight: 44 }} value={size} onChange={(e) => setSize(Number(e.target.value))}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        {d ? <span className="s" data-testid="sales-count">{t('rpt.sales.count', { n: String(d.total) })}</span> : null}
      </div>
      {err ? <div className="err" role="alert">{err}</div> : !d ? <div className="muted">{t('pos.loading_reports')}</div> : d.items.length === 0 ? (
        <div className="muted" data-testid="sales-nomatch">{q ? t('rpt.tx.noMatch') : t('rpt.sales.noTickets')}</div>
      ) : (
        <div className="overflow-x-auto w-full"><table className="tbl w-full" data-testid="sales-tickets-tbl">
          <thead><tr><th>{t('rpt.svc.paidAt')}</th><th>{t('rpt.svc.ticket')}</th><th>{t('rpt.svc.customer')}</th><th>{t('rpt.sales.servicesTechs')}</th>
            <th style={{ textAlign: 'right' }}>{t('rpt.sales.col.net')}</th><th style={{ textAlign: 'right' }}>{t('pos.tax_collected_2')}</th><th style={{ textAlign: 'right' }}>{t('pos.tips')}</th><th style={{ textAlign: 'right' }}>{t('rpt.tx.charged')}</th><th>{t('rpt.sales.tender')}</th><th>{t('rpt.sales.status')}</th></tr></thead>
          <tbody>{d.items.map((r) => (<Fragment key={r.ticketId}>
            <tr onClick={() => setOpen(open === r.ticketId ? null : r.ticketId)} style={{ cursor: 'pointer' }} aria-expanded={open === r.ticketId}>
              <td className="whitespace-nowrap">{fmtInTz(r.occurredAt, d.timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
              <td>{r.ticketNumber ? `#${r.ticketNumber}` : '—'}</td>
              <td>{r.customer || t('rpt.tx.walkIn')}</td>
              <td style={{ minWidth: 180 }}>{r.services.join(', ') || '—'}<div className="s">{r.technicians.join(', ')}</div></td>
              <td className="num" style={{ textAlign: 'right' }}>{m(r.netCents)}</td><td className="num" style={{ textAlign: 'right' }}>{m(r.taxCents)}</td><td className="num" style={{ textAlign: 'right' }}>{m(r.tipCents)}</td>
              <td className="num" style={{ textAlign: 'right', fontWeight: 700 }}>{m(r.chargedCents)}</td>
              <td>{r.methods.map((x) => statusLabel('paymentMethod', x)).join(' + ')}</td>
              <td>{t('rpt.sales.st.' + r.status)}{r.refundedCents > 0 ? <div className="s">{t('rpt.sales.refunded', { amount: m(r.refundedCents) })}</div> : null}</td>
            </tr>
            {open === r.ticketId ? (
              <tr data-testid="sales-ticket-detail"><td colSpan={10} className="s">
                {t('rpt.sales.breakdown', { sales: m(r.salesCents), disc: m(r.discountCents), net: m(r.netCents), tax: m(r.taxCents), tips: m(r.tipCents), sur: m(r.surchargeCents), charged: m(r.chargedCents) })}
              </td></tr>
            ) : null}
          </Fragment>))}</tbody>
        </table></div>
      )}
      {d ? <Pager info={{ page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: Math.max(1, Math.ceil(d.total / d.pageSize)) }} onPage={setPage} label={t('rpt.sales.pager')} /> : null}
    </div>
  );
}
