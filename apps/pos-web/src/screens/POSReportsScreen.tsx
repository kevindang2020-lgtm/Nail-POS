import { AiAssistantPanel } from '../components/AiAssistantPanel';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { posReportsApi } from '../api/posReportsApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney, fmtInZone, fmtInTz } from '../i18n/format';
import { codeLabel } from '../components/codeLabel';
import { statusLabel } from '../i18n/status-label';
import { PeriodBar, periodQuery, type PeriodState } from '../components/FinanceKit';
import { Pager } from '../components/FitKit';
import { SystemCheckButton } from '../components/SystemCheck';
import type { RevenueTrend, TrendBucket } from '@aipowersalon/api-contracts/tenant';
import { svcCategoryLabel, servicesReportHref } from './reportsCommon';

// POS Reports — converted from aipowersalon-pos-reports.html. Reads the REAL /pos/reports/state (POSReportsFullState +
// restrictedSections) via the shared `api` client (the domain posReportsApi only exposes exportReport). Renders sales
// KPIs, a sales-trend bar chart, payments/tips/tax/discount-surcharge panels, revenue-by-service + top-technician
// breakdowns, customer insights, queue summary, and a transactions table. Financial sections (salesKpis, salesTrend,
// payments, tips, tax, discountSurcharge, transactions) honor `restrictedSections` from the server — when the role
// lacks financial permission those panels show a "restricted" note instead of figures. Export CSV calls the real
// /pos/reports/export and surfaces whatever the endpoint returns (no fabricated download).
type Trend = { points: { label: string; grossSalesCents: number; netSalesCents: number }[] };
export type { RevenueTrend };
type ReportsState = {
  dateRange: { from: string; to: string; granularity?: string; timezone?: string };
  kpis: { totalRevenueCents: number; revenueTrendPercent: number; totalBookings: number; completedServices: number; newCustomers: number; averageRating: number | null; noShowRatePercent: number };
  salesKpis: { grossSalesCents: number; netSalesCents: number; serviceSalesCents: number; productSalesCents: number; tipsCents: number; taxCollectedCents: number; cardSurchargeCents: number; discountsCents: number; refundsCents: number; ticketsCount: number; customersCount: number; averageTicketCents: number };
  salesTrend: Trend;
  trend?: RevenueTrend;
  payments: { cardCents: number; cashCents: number; giftCardCents: number; splitCount: number; refundsCents: number; cardSurchargeCents: number; processorStatus: string };
  tips: { totalCents: number; cardTipsCents: number; cashTipsCents: number; tipPercentAvg: number; noTipCount: number; managerApprovalCount: number; byTechnician: { technicianId: string; name: string; tipsCents: number }[] };
  tax: { taxableSalesCents: number; exemptSalesCents: number; taxCollectedCents: number; taxRatePercent: number; byCategory: { category: string; taxCents: number }[]; adjustmentsCents: number };
  discountSurcharge: { discountCents: number; discountCount: number; topReason: string; cardSurchargeCents: number; surchargePercent: number; cashDiscountCents: number };
  queue: { averageWaitMinutes: number; longestWaitMinutes: number; walkIns: number; skipped: number; peakWindow: string; byTechnician: { technicianId: string; name: string; avgWaitMinutes: number }[] };
  transactions: { id: string; at: string; customer: string; technician: string; service: string; paymentMethod: string; grossCents: number; tipCents: number; taxCents: number; netCents: number; status: string }[];
  revenueByService: { serviceId: string; serviceName: string; revenueCents: number; serviceCount: number; percentOfTop: number }[];
  topTechnicians: { technicianId: string; rank: number; name: string; roleLabel: string; revenueCents: number; completedServices: number; unattributed?: boolean }[];
  customerInsights: { newCustomers: number; newCustomersTrendPercent: number; returningCustomers: number; returningCustomersTrendPercent: number; retentionRatePercent: number | null; retentionReturned?: number; retentionCohort?: number; retentionRateTrendPercent: number };
  bookingsOverview?: { trend?: { points: { label: string; date: string; bookings: number; completed: number }[] } };
  restrictedSections?: string[];
};

const money = (c: number) => fmtMoney(c || 0);
const PALETTE = ['#A96F22', '#6BAF92', '#7B9FD4', '#D08C8C', '#C89B5A', '#B0A0C8'];
const Donut = ({ items }: { items: { label: string; count: number }[] }) => {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <div className="muted">{tx('pos.no_payment_data_in_range')}</div>;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 100, height: 100, flex: 'none' }}>
        {items.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="16" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
      </svg>
      <div style={{ flex: 1 }}>{items.map((it, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '1px 0' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length] }} /><span>{it.label}</span><span style={{ marginLeft: 'auto', color: '#8A7A66' }}>{Math.round((it.count / total) * 100)}% · {money(it.count)}</span></div>))}</div>
    </div>
  );
};

function Restricted() {
  return <div className="muted" style={{ padding: '8px 2px' }}>{tx('pos.financial_figures_are_restricted_for_your_1hur')}</div>;
}

export function POSReportsScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<ReportsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Daily Summary guide §7 (Nov 10 2026): the period is chosen here (presets + Custom From–To calendar) and every KPI, tab,
  // insight, transaction page and export uses the same one. The server resolves presets in the branch's time zone.
  const [period, setPeriod] = useState<PeriodState>({ preset: 'week' });
  const [showCalc, setShowCalc] = useState(false);
  // batch 9 guide 3: trend grouping + previous-period comparison (server-side), and the bucket a click drills into
  const [groupBy, setGroupBy] = useState<string | undefined>(undefined);
  const [compare, setCompare] = useState(false);
  const [bucket, setBucket] = useState<{ from: string; to: string; label: string } | null>(null);
  useEffect(() => { setGroupBy(undefined); setBucket(null); }, [period]);
  const load = useCallback(() => (api.get('/pos/reports/state', { ...periodQuery(period), groupBy, compare: compare ? '1' : undefined }) as Promise<ReportsState>)
    .then((d) => { setS(d); setError(null); })
    .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_reports'))), [period, groupBy, compare]);

  useEffect(() => { load(); }, [load]);

  const doExport = async (type = 'transactions', format = 'csv') => {
    if (!s) return;
    setNote(null); setExporting(true);
    try {
      const r: any = await posReportsApi.exportReport({ type, format, from: s.dateRange.from, to: s.dateRange.to, preset: 'custom' });
      const url = r?.downloadUrl || r?.url;
      if (r?.disabledReason) setNote(r.disabledReason); // backend refused (e.g. PDF/Excel not configured) — say so honestly
      else if (url) setNote(tx('pos.export_ready_url', { url: String(url) }));
      else if (typeof r === 'string') setNote(r.length > 160 ? tx('pos.export_generated') : r);
      else if (r?.csv != null || r?.filename) {
        if (r.csv) {
          const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8;' });
          const link = document.createElement('a');
          const dlUrl = URL.createObjectURL(blob);
          link.setAttribute('href', dlUrl);
          link.setAttribute('download', r.filename || 'export.csv');
          link.style.visibility = 'hidden';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
        setNote(tx('pos.export_generated_v0', { v0: String(r?.rowCount != null ? tx('pos.rowcount_rows', { rowCount: String(r.rowCount) }) : '') }));
      }
      else setNote(r?.message || tx('pos.export_generated'));
    } catch (e: any) { setNote(e?.message || tx('pos.export_failed')); }
    finally { setExporting(false); }
  };

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_reports')}</div></div>;

  const isR = (name: string) => !!s.restrictedSections?.includes(name);
  const sk = s.salesKpis;
  const kpis: { l: string; v: string }[] = [
    { l: tx('pos.gross_sales'), v: money(sk.grossSalesCents) },
    { l: tx('pos.net_sales'), v: money(sk.netSalesCents) },
    { l: tx('pos.service_sales_2'), v: money(sk.serviceSalesCents) },
    { l: tx('pos.product_sales'), v: money(sk.productSalesCents) },
    { l: tx('pos.tips'), v: money(sk.tipsCents) },
    { l: tx('pos.tax_4'), v: money(sk.taxCollectedCents) },
    { l: tx('pos.surcharge_2'), v: money(sk.cardSurchargeCents) },
    { l: tx('pos.discounts'), v: money(sk.discountsCents) },
    { l: tx('pos.refunds'), v: money(sk.refundsCents) },
    { l: tx('pos.tickets'), v: String(sk.ticketsCount) },
    { l: tx('pos.customers'), v: String(sk.customersCount) },
    { l: tx('pos.avg_ticket'), v: sk.ticketsCount ? money(sk.averageTicketCents) : tx('rpt.na') },
  ];
  const svcMax = Math.max(1, ...s.revenueByService.map((r) => r.revenueCents));
  // Payment Mix donut (real, from the payments breakdown)
  const paymentMix = isR('payments') ? [] : ([
    { label: tx('pos.card'), count: s.payments.cardCents },
    { label: tx('pos.cash'), count: s.payments.cashCents },
    { label: tx('pos.gift_card_3'), count: s.payments.giftCardCents },
  ] as { label: string; count: number }[]).filter((x) => x.count > 0);

  const insights: { id: string; text: string; severity: 'info' | 'warn'; link?: string }[] = [];
  const topSvc = s.revenueByService[0];
  if (!isR('revenueByService') && topSvc) insights.push({ id: 'svc', text: tx('rpt.ins.topService', { name: svcCategoryLabel(topSvc.serviceId, topSvc.serviceName), amount: String(money(topSvc.revenueCents)) }), severity: 'info', link: '/tenant/reports/services' });
  if (!isR('payments')) {
    const pm = ([[tx('glossary.checkout.card'), s.payments.cardCents], [tx('glossary.checkout.cash'), s.payments.cashCents], [tx('pos.gift_card_3'), s.payments.giftCardCents]] as [string, number][]).sort((a, b) => b[1] - a[1])[0];
    if (pm && pm[1] > 0) insights.push({ id: 'pay', text: tx('rpt.ins.topMethod', { method: String(pm[0]), amount: String(money(pm[1])) }), severity: 'info', link: '/tenant/reports/payments' });
  }
  const topTech = s.topTechnicians.find((x) => !x.unattributed);   // never call a bucket of unassigned lines the top technician
  if (!isR('topTechnicians') && topTech) insights.push({ id: 'tech', text: tx('pos.top_technician_name_revenuecents_across_completedservices_xv1q', { name: String(topTech.name), revenueCents: String(money(topTech.revenueCents)), completedServices: String(topTech.completedServices) }), severity: 'info' });
  if (!isR('customerInsights') && s.customerInsights.retentionRatePercent != null) insights.push({ id: 'ret', text: tx('pos.customer_retention_retentionratepercent_returningcustomers_returning_newcustomers_1uen', { retentionRatePercent: String(s.customerInsights.retentionRatePercent), returningCustomers: String(s.customerInsights.returningCustomers), newCustomers: String(s.customerInsights.newCustomers) }), severity: 'info' });
  if (!isR('queue') && s.queue.peakWindow) insights.push({ id: 'peak', text: tx('pos.busiest_window_peakwindow_avg_wait_averagewaitminutes_1ptp', { peakWindow: String(s.queue.peakWindow), averageWaitMinutes: String(s.queue.averageWaitMinutes) }), severity: 'info' });
  if (!isR('tips') && s.tips.noTipCount > 0) insights.push({ id: 'tip', text: tx('pos.notipcount_ticket_plural_left_no_tip_1x4q', { noTipCount: String(s.tips.noTipCount), plural: String(s.tips.noTipCount === 1 ? '' : 's'), tipPercentAvg: String(s.tips.tipPercentAvg) }), severity: 'info' });
  if (!isR('salesKpis') && s.salesKpis.refundsCents > 0) insights.push({ id: 'ref', text: tx('pos.refundscents_in_refunds_this_period_review_j0k6', { refundsCents: String(money(s.salesKpis.refundsCents)) }), severity: 'warn' });

  return (
    <div className="work">
      <AiAssistantPanel packageCode="ai_analytics_forecasting" cta={tx('pos.forecast')} action="forecast" buildPrompt={() => tx('admin.reports.ai.forecastPrompt')} />
      <AiAssistantPanel packageCode="ai_business_assistant" cta={tx('pos.explain_performance')} action="summarize" buildPrompt={() => tx('pos.explain_this_nail_salon_s_recent_4932', { from: String(s.dateRange.from), to: String(s.dateRange.to) })} />
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
          <h1>{tx('pos.reports')}</h1>
          <div className="sub ">{s.dateRange.from} – {s.dateRange.to}{s.dateRange.timezone ? ` · ${s.dateRange.timezone}` : ''}</div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <SystemCheckButton domain="reports" />
          <button className="btn w-fit whitespace-nowrap" style={{ minHeight: 44 }} onClick={() => setShowCalc((v) => !v)} aria-expanded={showCalc} data-testid="rpt-how">{tx('rpt.how')}</button>
          <button className="btn w-fit whitespace-nowrap"  disabled={exporting} onClick={() => doExport()}>{exporting ? tx('pos.exporting') : tx('pos.export_csv')}</button>
        </div>
      </div>
      <div className="mb-2"><PeriodBar value={period} onChange={setPeriod}
        server={{ preset: period.preset, from: s.dateRange.from, to: s.dateRange.to, tz: s.dateRange.timezone ?? '', today: s.dateRange.to }}
        basisOptions={[{ value: 'paid', label: tx('rpt.basisPaid') }]} /></div>
      {showCalc ? <HowCalculated /> : null}

      {note ? <div className="err" style={{ marginBottom: 12 }}>{note}</div> : null}
      {s.restrictedSections?.length ? <div className="err" style={{ marginBottom: 12 }}>{tx('pos.some_financial_sections_are_hidden_for_kw3h')}</div> : null}

      {/* Hero KPI strip — headline business metrics (real; rating/no-show/net-sales stand in for util/rebooking/profit, which aren't tracked) */}
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="l">{tx('pos.total_revenue')}</div><div className="v">{money(s.kpis.totalRevenueCents)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.appointments_completed')}</div><div className="v">{s.kpis.completedServices}</div></div>
        <div className="kpi"><div className="l">{tx('pos.average_ticket')}</div><div className="v">{isR('salesKpis') ? '—' : sk.ticketsCount ? money(sk.averageTicketCents) : tx('rpt.na')}</div></div>
        <div className="kpi"><div className="l">{tx('pos.customer_retention')}</div><div className="v">{isR('customerInsights') ? '—' : s.customerInsights.retentionRatePercent == null ? tx('rpt.na') : `${s.customerInsights.retentionRatePercent}%`}</div>{!isR('customerInsights') && s.customerInsights.retentionCohort ? <div className="s" data-testid="rpt-retention-basis">{tx('rpt.retBasis', { n: s.customerInsights.retentionReturned ?? 0, d: s.customerInsights.retentionCohort })}</div> : null}</div>
        <div className="kpi"><div className="l">{tx('pos.total_tips')}</div><div className="v">{isR('salesKpis') ? '—' : money(sk.tipsCents)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.average_rating_2')}</div><div className="v">{s.kpis.averageRating == null ? tx('rpt.na') : s.kpis.averageRating.toFixed(1)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.no_show_rate')}</div><div className="v">{s.kpis.noShowRatePercent == null ? tx('rpt.na') : `${s.kpis.noShowRatePercent}%`}</div></div>
        <div className="kpi"><div className="l">{tx('pos.net_sales')}</div><div className="v">{isR('salesKpis') ? '—' : money(sk.netSalesCents)}</div></div>
      </div>

      {/* Report Categories — jump to a section */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {([
          { l: tx('pos.revenue'), id: 'rc-revenue' }, { l: tx('pos.operations'), id: 'rc-operations' }, { l: tx('pos.technicians'), id: 'rc-technicians' },
          { l: tx('pos.customers'), id: 'rc-customers' }, { l: tx('pos.payments'), id: 'rc-payments' },
        ] as const).map((c) => (
          <button key={c.l} className="btn ghost" style={{ padding: '5px 12px', fontSize: 12.5 }} onClick={() => document.getElementById(c.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{c.l}</button>
        ))}
        <button className="btn ghost w-fit whitespace-nowrap" style={{ padding: '5px 12px', fontSize: 12.5 }} onClick={() => nav("/tenant/inventory")}>{tx('pos.inventory')}</button>
      </div>

      <section className="panel mb-3" id="rc-revenue">
        <h2>{tx('pos.sales')}</h2>
        {isR('salesKpis') ? <Restricted /> : (
          <div className="kpis">{kpis.map((c) => (<div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="v">{c.v}</div></div>))}</div>
        )}
        {!isR('salesKpis') && !isR('payments') ? <ChargeReconcile sk={sk} collectedCents={s.payments.cardCents + s.payments.cashCents + s.payments.giftCardCents} money={money} /> : null}
      </section>

      {insights.length > 0 ? (
        <section className="panel mb-3">
          <h2>{tx('pos.ai_insights')}</h2>
          <div className="s" style={{ marginBottom: 6 }}>{tx('rpt.ins.source')}</div>
          <div className="list">
            {insights.map((ins) => (
              <div className="row" key={ins.id}>
                <span className={'pill ' + (ins.severity === 'warn' ? 'warn' : '')} style={{ flex: 'none' }}>{ins.severity === 'warn' ? '!' : 'i'}</span>
                <div className="t" style={{ marginLeft: 8 }}>{ins.text}</div>
                {ins.link ? <button type="button" className="btn ghost" style={{ marginLeft: 'auto', minHeight: 44 }} onClick={() => nav(ins.link!)}>{tx('rpt.viewDetails')}</button> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel mb-3" data-testid="rpt-trend">
        <h2>{tx('pos.revenue_appointments_trend')}</h2>
        {isR('salesTrend') ? <Restricted /> : (
          <TrendPanel trend={s.trend ?? null} money={money} kpiRevenue={s.salesKpis.grossSalesCents} kpiTickets={s.salesKpis.ticketsCount}
            compare={compare} onCompare={setCompare} onGroupBy={setGroupBy}
            onBucket={(b) => { setBucket(b); setTimeout(() => document.getElementById('rpt-transactions')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 0); }} />
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_500px] gap-3 mb-3">
        <section className="panel" id="rc-payments">
          <h2>{tx('pos.payments')}</h2>
          {isR('payments') ? <Restricted /> : (
            <div style={{ fontSize: 13 }}>
              {([[tx('glossary.checkout.card'), s.payments.cardCents], [tx('glossary.checkout.cash'), s.payments.cashCents], [tx('pos.gift_card_3'), s.payments.giftCardCents], [tx('payment.totals.cardSurcharge'), s.payments.cardSurchargeCents], [tx('pos.refunds'), s.payments.refundsCents]] as [string, number][])
                .map(([l, v]) => (<div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{l}</span><span>{money(v)}</span></div>))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.split_payments_2')}</span><span>{s.payments.splitCount}</span></div>
              <div className="s" style={{ marginTop: 6 }}>{tx('pos.processor')}{' '}<span className={'pill ' + (s.payments.processorStatus === 'live' ? 'ok' : 'warn')}>{codeLabel('admin.reports.processor', s.payments.processorStatus, 'gateway')}</span></div>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>{tx('pos.tips')}</h2>
          {isR('tips') ? <Restricted /> : (
            <div style={{ fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.total')}</span><span>{money(s.tips.totalCents)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.card_cash')}</span><span>{money(s.tips.cardTipsCents)} / {money(s.tips.cashTipsCents)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.avg_tip')}</span><span>{s.tips.tipPercentAvg}%</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.no_tip_tickets')}</span><span>{s.tips.noTipCount}</span></div>
            </div>
          )}
        </section>
      </div>

     <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_500px] gap-3 mb-3">
        <section className="panel">
          <h2>{tx('pos.tax_4')}</h2>
          {isR('tax') ? <Restricted /> : (
            <div style={{ fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.taxable_sales')}</span><span>{money(s.tax.taxableSalesCents)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.exempt_sales')}</span><span>{money(s.tax.exemptSalesCents)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.tax_collected')}{s.tax.taxRatePercent}%)</span><span>{money(s.tax.taxCollectedCents)}</span></div>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>{tx('pos.discounts_surcharge')}</h2>
          {isR('discountSurcharge') ? <Restricted /> : (
            <div style={{ fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.discounts_2')}{s.discountSurcharge.discountCount})</span><span>{money(s.discountSurcharge.discountCents)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.card_surcharge_2')}{s.discountSurcharge.surchargePercent}%)</span><span>{money(s.discountSurcharge.cardSurchargeCents)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.cash_discount')}</span><span>{money(s.discountSurcharge.cashDiscountCents)}</span></div>
              {s.discountSurcharge.topReason ? <div className="s" style={{ marginTop: 6 }}>{tx('pos.top_reason')}{' '}{s.discountSurcharge.topReason}</div> : null}
            </div>
          )}
        </section>
      </div>

     <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_500px] gap-3 mb-3">
        <section className="panel" data-testid="rpt-rbs">
          <div className="flex items-center justify-between gap-2"><h2>{tx('pos.revenue_by_service')}</h2>
            {s.revenueByService.length ? <button className="btn ghost sm" data-testid="rpt-rbs-all" onClick={() => nav(servicesReportHref(periodQuery(period)))}>{tx('rpt.svc.viewAll', { n: String(s.revenueByService.length) })}</button> : null}</div>
          <div className="s mb-1">{tx('rpt.svc.basis')}</div>
          <div className="list">
            {s.revenueByService.length === 0 ? <div className="muted" data-testid="rpt-rbs-empty">{tx('rpt.svc.empty', { from: s.dateRange.from, to: s.dateRange.to })}</div> : null}
            {s.revenueByService.slice(0, 6).map((r) => {
              const label = svcCategoryLabel(r.serviceId, r.serviceName);
              const tip = tx('rpt.svc.tip', { name: label, units: String(r.serviceCount), amount: money(r.revenueCents) });
              return (
                <button key={r.serviceId} type="button" className="w-full text-left" style={{ padding: '6px 0', background: 'none', border: 0, minHeight: 44, cursor: 'pointer' }} title={tip} aria-label={tip}
                  onClick={() => nav(servicesReportHref(periodQuery(period), r.serviceId))}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label} <span className="s">· {r.serviceCount}</span></span><span className="num">{money(r.revenueCents)}</span></div>
                  <div style={{ height: 6, background: 'var(--line)', borderRadius: 4, marginTop: 3 }}><div style={{ height: 6, width: `${Math.round((r.revenueCents / svcMax) * 100)}%`, background: 'var(--gold)', borderRadius: 4 }} /></div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel" id="rc-technicians">
          <h2>{tx('pos.top_technicians')}</h2>
          <div className="list" style={{ maxHeight: 240 }}>
            {s.topTechnicians.length === 0 ? <div className="muted">{tx('pos.no_data')}</div> : null}
            {s.topTechnicians.map((t) => (
              <button type="button" className="row w-full text-left" key={t.technicianId} style={{ background: 'none', border: 0, cursor: 'pointer', minHeight: 44 }}
                onClick={() => nav('/tenant/reports/technicians?' + new URLSearchParams({ ...Object.fromEntries(Object.entries(periodQuery(period)).map(([k, v]) => [k, String(v)])), tech: t.technicianId }).toString())}>
                <div style={{ minWidth: 24 }} className="s">{t.unattributed ? '—' : `#${t.rank}`}</div>
                <div><div className="t">{t.technicianId === '__no_lines__' ? tx('rpt.svc.noLines') : t.technicianId === '__unassigned__' ? tx('rpt.tech.unassigned') : t.name}</div><div className="s">{t.unattributed ? '' : tx('pos.technician') + ' · '}{t.completedServices} {tx('pos.services_5')}</div></div>
                <div className="r" style={{ marginLeft: 'auto' }}>{money(t.revenueCents)}</div>
              </button>
            ))}
          </div>
        </section>
      </div>

     <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_500px] gap-3 mb-3">
        <section className="panel" id="rc-customers">
          <h2>{tx('pos.customer_insights')}</h2>
          <div className="kpis">
            <div className="kpi"><div className="l">{tx('pos.new')}</div><div className="v">{s.customerInsights.newCustomers}</div></div>
            <div className="kpi"><div className="l">{tx('pos.returning')}</div><div className="v">{s.customerInsights.returningCustomers}</div></div>
            <div className="kpi"><div className="l">{tx('pos.retention')}</div><div className="v">{s.customerInsights.retentionRatePercent}%</div></div>
          </div>
        </section>

        <section className="panel" id="rc-operations">
          <h2>{tx('pos.queue')}</h2>
          <div style={{ fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.avg_longest_wait')}</span><span>{s.queue.averageWaitMinutes}m / {s.queue.longestWaitMinutes}m</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span className="muted">{tx('pos.walk_ins_skipped')}</span><span>{s.queue.walkIns} / {s.queue.skipped}</span></div>
            {s.queue.peakWindow ? <div className="s" style={{ marginTop: 6 }}>{tx('pos.peak')}{' '}{s.queue.peakWindow}</div> : null}
          </div>
        </section>
      </div>
<section className="panel mb-3" id="rpt-transactions">
  <h2>{tx('pos.transactions')}</h2>

  {bucket ? <div className="flex items-center gap-2 mb-2" data-testid="rpt-bucket-chip"><span className="chip">{tx('rpt.trend.showing', { label: bucket.label })}</span><button className="btn ghost sm" onClick={() => setBucket(null)}>{tx('rpt.tx.clear')}</button></div> : null}
          {isR('transactions') ? <Restricted /> : <TransactionsPage period={bucket ? { preset: 'custom', from: bucket.from, to: bucket.to } : periodQuery(period)} money={money} />}
</section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_500px] gap-3 mb-3">
        <section className="panel">
          <h2>{tx('pos.payment_mix')}</h2>
          {isR('payments') ? <Restricted /> : <Donut items={paymentMix} />}
        </section>
        <section className="panel">
          <h2>{tx('pos.quick_export_scheduled_reports')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="btn ghost w-fit whitespace-nowrap" disabled={exporting} onClick={() => doExport('transactions', 'csv')}>{tx('pos.export_csv')}</button>
            <button className="btn ghost w-fit whitespace-nowrap" disabled={exporting} onClick={() => doExport('transactions', 'pdf')}>{tx('pos.export_pdf')}</button>
            <button className="btn ghost w-fit whitespace-nowrap" onClick={() => setNote(tx('pos.emailed_scheduled_delivery_isn_t_connected_8q0c'))}>{tx('pos.email_report')}</button>
            <button className="btn ghost w-fit whitespace-nowrap" onClick={() => setNote(tx('pos.scheduled_report_delivery_isn_t_connected_123o'))}>{tx('pos.schedule_report')}</button>
          </div>
          <div className="s" style={{ marginTop: 6, color: '#8A7A66' }}>{tx('pos.csv_pdf_use_the_live_export_15b3')}</div>
        </section>
      </div>

      <section className="panel">
        <h2>{tx('pos.quick_reports')}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {[
            { l: tx('pos.daily_report'), fn: () => doExport('sales', 'pdf') },
            { l: tx('pos.weekly_report'), fn: () => doExport('sales', 'csv') },
            { l: tx('pos.payroll_report'), fn: () => nav('/tenant/team/payroll') },
            { l: tx('pos.tax_summary'), fn: () => doExport('tax', 'csv') },
            { l: tx('pos.customer_report'), fn: () => doExport('customers', 'csv') },
            { l: tx('pos.technician_report'), fn: () => doExport('technicians', 'csv') },
          ].map((q) => <button key={q.l} className="btn ghost" disabled={exporting} onClick={q.fn}>{q.l}</button>)}
        </div>
      </section>
    </div>
  );
}

// ── Daily Summary guide (Nov 10 2026) ───────────────────────────────────────────────────────────────────────────────
/** §24 P0 "How calculated?": each headline figure's definition, money basis and date basis — what the server computes. */
const CALC_KEYS = ['totalRevenue', 'appointments', 'avgTicket', 'retention', 'tips', 'rating', 'noShow', 'netSales', 'charged', 'topService'] as const;
export function HowCalculated({ keys = CALC_KEYS }: { keys?: readonly string[] } = {}) {
  return (
    <section className="panel mb-3" data-testid="rpt-how-panel">
      <h2>{tx('rpt.how')}</h2>
      <div className="s" style={{ marginBottom: 6 }}>{tx('rpt.calc.basis')}</div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 220px) minmax(0, 1fr)', gap: '4px 12px', margin: 0 }}>
        {keys.map((k) => <div key={k} style={{ display: 'contents' }}><dt style={{ fontWeight: 700 }}>{tx(`rpt.calc.${k}.t`)}</dt><dd style={{ margin: 0 }}>{tx(`rpt.calc.${k}.d`)}</dd></div>)}
      </dl>
    </section>
  );
}

/** §12 / §24 P0: sales and the amount CHARGED are different figures — show how one becomes the other, and say so when the
 *  money collected does not match (a reconciliation question for a person, never adjusted here). */
export function ChargeReconcile({ sk, collectedCents, money: m }: { sk: { netSalesCents: number; taxCollectedCents: number; tipsCents: number; cardSurchargeCents: number }; collectedCents: number; money: (c: number) => string }) {
  const charged = sk.netSalesCents + sk.taxCollectedCents + sk.tipsCents + sk.cardSurchargeCents;
  const diff = collectedCents - charged;
  return (
    <div className="s" data-testid="rpt-reconcile" style={{ marginTop: 8 }}>
      {tx('rpt.rec.line', { net: m(sk.netSalesCents), tax: m(sk.taxCollectedCents), tips: m(sk.tipsCents), sur: m(sk.cardSurchargeCents), charged: m(charged) })}
      {' · '}{tx('rpt.rec.collected', { amount: m(collectedCents) })}
      {diff !== 0 ? <div className="err" role="status" data-testid="rpt-reconcile-diff" style={{ marginTop: 4 }}>{tx('rpt.rec.diff', { amount: m(Math.abs(diff)) })}</div> : null}
    </div>
  );
}

type TxRow = { id: string; ticketId?: string | null; at: string; occurredAt?: string; customer: string; technician: string; service: string; paymentMethod: string; grossCents: number; tipCents: number; taxCents: number; netCents: number; status: string };
/** §8–§9: the period's payment rows one server page at a time, newest first, with a scoped search. */
export function TransactionsPage({ period, money: m }: { period: Record<string, unknown>; money: (c: number) => string }) {
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [d, setD] = useState<{ items: TxRow[]; total: number; page: number; pageSize: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(period);
  useEffect(() => { setPage(1); }, [key, q, size]);
  useEffect(() => {
    let alive = true; setErr(null);
    (api.get('/pos/reports/transactions/page', { ...period, q: q || undefined, page, pageSize: size }) as Promise<any>)
      .then((r) => { if (!alive) return; if (Array.isArray(r?.items)) setD(r); else { setD(null); setErr(tx('rpt.tx.failed')); } })
      .catch((e: any) => { if (alive) { setD(null); setErr(e?.message || tx('rpt.tx.failed')); } });
    return () => { alive = false; };
  }, [key, q, page, size]);   // eslint-disable-line react-hooks/exhaustive-deps -- period is keyed by its JSON
  useEffect(() => { const h = setTimeout(() => setQ(draft.trim()), 300); return () => clearTimeout(h); }, [draft]);
  const info = d ? { page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: Math.max(1, Math.ceil(d.total / d.pageSize)) } : null;
  return (
    <div data-testid="rpt-tx">
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tx('rpt.tx.search')} aria-label={tx('rpt.tx.search')} style={{ minHeight: 44, minWidth: 260 }} data-testid="rpt-tx-search" />
        {draft ? <button type="button" className="btn ghost" style={{ minHeight: 44 }} onClick={() => setDraft('')}>{tx('rpt.tx.clear')}</button> : null}
        <span className="s">{tx('rpt.tx.scope')}</span>
        <label className="s" style={{ marginLeft: 'auto' }}>{tx('rpt.tx.perPage')}{' '}
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ minHeight: 44 }} data-testid="rpt-tx-size">{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
      </div>
      {err ? <div className="err" role="alert">{err}</div> : !d ? <div className="muted">{tx('pos.loading_reports')}</div> : d.items.length === 0 ? (
        <div className="muted" data-testid="rpt-tx-empty">{q ? tx('rpt.tx.noMatch') : tx('pos.no_transactions_in_this_range')}</div>
      ) : (
        <div className="overflow-x-auto"><div className="list min-w-[770px]">
          {d.items.map((t) => (
            <div className="row" key={t.id} data-testid="rpt-tx-row">
              <div className="s" style={{ minWidth: 150 }}>{t.occurredAt ? fmtInZone(t.occurredAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : t.at}</div>
              <div style={{ minWidth: 150 }}><div className="t">{t.customer || tx('rpt.tx.walkIn')}</div><div className="s">{t.service} · {t.technician}</div></div>
              <span className="pill">{statusLabel('paymentMethod', t.paymentMethod)}</span>
              <span className={'pill ' + (/paid|complete|settled/i.test(t.status) ? 'ok' : /refund|void|fail/i.test(t.status) ? 'warn' : '')}>{statusLabel(['checkoutTicket', 'payment'], t.status)}</span>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div className="r">{m(t.grossCents)}</div>
                <div className="s">{tx('rpt.tx.charged')} · {tx('pos.tip')}{' '}{m(t.tipCents)} · {tx('pos.tax_5')}{' '}{m(t.taxCents)}</div>
              </div>
            </div>
          ))}
        </div></div>
      )}
      <Pager info={info} onPage={setPage} label={tx('rpt.tx.pager')} />
    </div>
  );
}

/** batch 9 guide 3 label of one bucket, in the salon's words */
export function bucketLabel(b: { key: string; from: string; to: string }, groupBy: string, long = false): string {
  const d = (ymd: string, o: Intl.DateTimeFormatOptions) => fmtInTz(ymd + 'T12:00:00Z', 'UTC', o);   // a salon DAY, not an instant
  if (groupBy === 'hour') { const h = Number(b.key.slice(-2)); return fmtInTz(`2026-01-01T${String(h).padStart(2, '0')}:00:00Z`, 'UTC', { hour: 'numeric' }) + (long ? ' · ' + d(b.from, { month: 'short', day: 'numeric' }) : ''); }
  if (groupBy === 'week') return tx('rpt.trend.weekOf', { date: d(b.from, { month: 'short', day: 'numeric' }) }) + (long ? ` – ${d(b.to, { month: 'short', day: 'numeric' })}` : '');
  if (groupBy === 'month') return d(b.from, { month: 'short', year: 'numeric' });
  return d(b.from, long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
}

const pctText = (v: number | null) => (v == null ? tx('rpt.trend.insufficient') : `${v > 0 ? '+' : ''}${v}%`);

/** §8 Revenue & Appointments Trend (batch 9 guide 3, Nov 10 2026): every bucket of the period, revenue (sales basis, gold bars,
 *  left scale) and paid tickets (blue line + dots, right scale), oldest → newest; a bucket opens its transactions; a table view;
 *  an honest previous-period comparison; and a line saying whether the buckets add up to the cards above. */
export function TrendPanel({ trend, money: m, kpiRevenue, kpiTickets, compare, onCompare, onGroupBy, onBucket }: {
  trend: RevenueTrend | null; money: (c: number) => string; kpiRevenue: number; kpiTickets: number;
  compare: boolean; onCompare: (v: boolean) => void; onGroupBy: (g: string) => void; onBucket: (b: { from: string; to: string; label: string }) => void;
}) {
  const [asTable, setAsTable] = useState(false);
  if (!trend) return <div className="muted">{tx('rpt.trend.unavailable')}</div>;
  const bs = trend.buckets;
  const revMax = Math.max(1, ...bs.map((b) => b.revenueCents));
  const tkMax = Math.max(1, ...bs.map((b) => b.tickets));
  const any = bs.some((b) => b.revenueCents > 0 || b.tickets > 0);
  const every = Math.max(1, Math.ceil(bs.length / 14));                       // never more than ~14 axis labels
  const H = 150;
  const reconciled = trend.totalRevenueCents === kpiRevenue && trend.totalTickets === kpiTickets;
  const tip = (b: TrendBucket) => tx('rpt.trend.tip', { label: bucketLabel(b, trend.groupBy, true), amount: m(b.revenueCents), n: String(b.tickets) });
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-3" style={{ fontSize: 12 }}>
          <span><span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--gold)', borderRadius: 2, marginRight: 4 }} />{tx('rpt.trend.revenue')}</span>
          <span><span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, background: '#3E6FB0', borderRadius: '50%', marginRight: 4 }} />{tx('rpt.trend.tickets')}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="s">{tx('rpt.trend.groupBy')}{' '}
            <select className="input" style={{ minHeight: 44 }} data-testid="rpt-trend-group" value={trend.groupBy} onChange={(e) => onGroupBy(e.target.value)}>
              {trend.groupByOptions.map((g) => <option key={g} value={g}>{tx('rpt.trend.g.' + g)}</option>)}
            </select></label>
          <label className="s flex items-center gap-1" style={{ minHeight: 44 }}><input type="checkbox" data-testid="rpt-trend-compare" checked={compare} onChange={(e) => onCompare(e.target.checked)} />{tx('rpt.trend.compare')}</label>
          <button className="btn ghost sm" style={{ minHeight: 44 }} data-testid="rpt-trend-table" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>{asTable ? tx('rpt.trend.asChart') : tx('rpt.trend.asTable')}</button>
        </div>
      </div>
      {!any ? <div className="muted" data-testid="rpt-trend-empty">{tx('rpt.trend.none')}</div> : asTable ? (
        <div className="overflow-x-auto"><table className="tbl w-full" data-testid="rpt-trend-tbl">
          <thead><tr><th>{tx('rpt.trend.period')}</th><th style={{ textAlign: 'right' }}>{tx('rpt.trend.revenue')}</th><th style={{ textAlign: 'right' }}>{tx('rpt.trend.tickets')}</th></tr></thead>
          <tbody>{bs.map((b) => <tr key={b.key}><td><button className="btn ghost sm" onClick={() => onBucket({ from: b.from, to: b.to, label: bucketLabel(b, trend.groupBy, true) })}>{bucketLabel(b, trend.groupBy, true)}</button></td><td className="num" style={{ textAlign: 'right' }}>{m(b.revenueCents)}</td><td className="num" style={{ textAlign: 'right' }}>{b.tickets}</td></tr>)}</tbody>
        </table></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: 6, alignItems: 'stretch' }}>
          <div className="s" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', textAlign: 'right', fontSize: 10.5, height: H }} aria-hidden><span>{m(revMax)}</span><span>{m(0)}</span></div>
          <div style={{ position: 'relative', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: H, borderBottom: '1px solid var(--line)' }}>
              {bs.map((b) => (
                <button key={b.key} type="button" title={tip(b)} aria-label={tip(b)} data-testid={`rpt-bucket-${b.key}`}
                  onClick={() => onBucket({ from: b.from, to: b.to, label: bucketLabel(b, trend.groupBy, true) })}
                  style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                  <span style={{ width: '70%', maxWidth: 44, height: `${Math.round((b.revenueCents / revMax) * (H - 10))}px`, minHeight: b.revenueCents > 0 ? 2 : 0, background: 'linear-gradient(180deg, var(--gold), var(--gold2,#caa45a))', borderRadius: '5px 5px 0 0' }} />
                </button>
              ))}
            </div>
            <svg aria-hidden viewBox={`0 0 ${bs.length * 10} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: H, pointerEvents: 'none' }}>
              <polyline fill="none" stroke="#3E6FB0" strokeWidth={2} vectorEffect="non-scaling-stroke" points={bs.map((b, i) => `${i * 10 + 5},${H - 4 - (b.tickets / tkMax) * (H - 14)}`).join(' ')} />
            </svg>
            {bs.map((b, i) => b.tickets > 0 ? <span key={'d' + b.key} aria-hidden style={{ position: 'absolute', left: `calc(${((i + 0.5) / bs.length) * 100}% - 4px)`, top: H - 8 - (b.tickets / tkMax) * (H - 14), width: 8, height: 8, borderRadius: '50%', background: '#3E6FB0', border: '2px solid #fff', pointerEvents: 'none' }} /> : null)}
            <div style={{ display: 'flex', gap: 3, marginTop: 3 }} aria-hidden>
              {bs.map((b, i) => <span key={'l' + b.key} className="s" style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden' }}>{i % every === 0 ? bucketLabel(b, trend.groupBy) : ''}</span>)}
            </div>
          </div>
          <div className="s" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 10.5, height: H, color: '#3E6FB0' }} aria-hidden><span>{tkMax}</span><span>0</span></div>
        </div>
      )}
      <div className="s mt-2" data-testid="rpt-trend-basis">{tx('rpt.trend.basis', { tz: trend.timezone })}</div>
      {any ? <div className="s mt-1" data-testid={reconciled ? 'rpt-trend-ok' : 'rpt-trend-diff'} style={reconciled ? undefined : { color: 'var(--danger,#B3261E)', fontWeight: 600 }}>
        {reconciled ? tx('rpt.trend.reconciled') : tx('rpt.trend.notReconciled', { trend: m(trend.totalRevenueCents), kpi: m(kpiRevenue) })}</div> : null}
      {compare && trend.compare ? (
        <div className="s mt-1" data-testid="rpt-trend-cmp">{tx('rpt.trend.cmp', { from: trend.compare.from, to: trend.compare.to, amount: m(trend.compare.revenueCents), rpct: pctText(trend.compare.revenueChangePercent), n: String(trend.compare.tickets), tpct: pctText(trend.compare.ticketsChangePercent) })}</div>
      ) : null}
    </div>
  );
}

