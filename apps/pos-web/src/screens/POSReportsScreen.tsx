import { AiAssistantPanel } from '../components/AiAssistantPanel';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { posReportsApi } from '../api/posReportsApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/codeLabel';
import { statusLabel } from '../i18n/status-label';

// POS Reports — converted from aipowersalon-pos-reports.html. Reads the REAL /pos/reports/state (POSReportsFullState +
// restrictedSections) via the shared `api` client (the domain posReportsApi only exposes exportReport). Renders sales
// KPIs, a sales-trend bar chart, payments/tips/tax/discount-surcharge panels, revenue-by-service + top-technician
// breakdowns, customer insights, queue summary, and a transactions table. Financial sections (salesKpis, salesTrend,
// payments, tips, tax, discountSurcharge, transactions) honor `restrictedSections` from the server — when the role
// lacks financial permission those panels show a "restricted" note instead of figures. Export CSV calls the real
// /pos/reports/export and surfaces whatever the endpoint returns (no fabricated download).
type Trend = { points: { label: string; grossSalesCents: number; netSalesCents: number }[] };
type ReportsState = {
  dateRange: { from: string; to: string; granularity?: string; timezone?: string };
  kpis: { totalRevenueCents: number; revenueTrendPercent: number; totalBookings: number; completedServices: number; newCustomers: number; averageRating: number; noShowRatePercent: number };
  salesKpis: { grossSalesCents: number; netSalesCents: number; serviceSalesCents: number; productSalesCents: number; tipsCents: number; taxCollectedCents: number; cardSurchargeCents: number; discountsCents: number; refundsCents: number; ticketsCount: number; customersCount: number; averageTicketCents: number };
  salesTrend: Trend;
  payments: { cardCents: number; cashCents: number; giftCardCents: number; splitCount: number; refundsCents: number; cardSurchargeCents: number; processorStatus: string };
  tips: { totalCents: number; cardTipsCents: number; cashTipsCents: number; tipPercentAvg: number; noTipCount: number; managerApprovalCount: number; byTechnician: { technicianId: string; name: string; tipsCents: number }[] };
  tax: { taxableSalesCents: number; exemptSalesCents: number; taxCollectedCents: number; taxRatePercent: number; byCategory: { category: string; taxCents: number }[]; adjustmentsCents: number };
  discountSurcharge: { discountCents: number; discountCount: number; topReason: string; cardSurchargeCents: number; surchargePercent: number; cashDiscountCents: number };
  queue: { averageWaitMinutes: number; longestWaitMinutes: number; walkIns: number; skipped: number; peakWindow: string; byTechnician: { technicianId: string; name: string; avgWaitMinutes: number }[] };
  transactions: { id: string; at: string; customer: string; technician: string; service: string; paymentMethod: string; grossCents: number; tipCents: number; taxCents: number; netCents: number; status: string }[];
  revenueByService: { serviceId: string; serviceName: string; revenueCents: number; serviceCount: number; percentOfTop: number }[];
  topTechnicians: { technicianId: string; rank: number; name: string; roleLabel: string; revenueCents: number; completedServices: number }[];
  customerInsights: { newCustomers: number; newCustomersTrendPercent: number; returningCustomers: number; returningCustomersTrendPercent: number; retentionRatePercent: number; retentionRateTrendPercent: number };
  bookingsOverview?: { trend?: { points: { label: string; date: string; bookings: number; completed: number }[] } };
  restrictedSections?: string[];
};

const money = (c: number) => fmtMoney(c || 0);
const fmtAt = (iso: string) => { try { return fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
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

  const load = useCallback(() => (api.get('/pos/reports/state') as Promise<ReportsState>)
    .then((d) => setS(d))
    .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_reports'))), []);

  useEffect(() => { load(); }, [load]);

  const doExport = async (type = 'transactions', format = 'csv') => {
    if (!s) return;
    setNote(null); setExporting(true);
    try {
      const r: any = await posReportsApi.exportReport({ type, format, from: s.dateRange.from, to: s.dateRange.to });
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
    { l: tx('pos.avg_ticket'), v: money(sk.averageTicketCents) },
  ];
  const trendMax = Math.max(1, ...s.salesTrend.points.map((p) => p.grossSalesCents));
  const svcMax = Math.max(1, ...s.revenueByService.map((r) => r.revenueCents));
  // Payment Mix donut (real, from the payments breakdown)
  const paymentMix = isR('payments') ? [] : ([
    { label: tx('pos.card'), count: s.payments.cardCents },
    { label: tx('pos.cash'), count: s.payments.cashCents },
    { label: tx('pos.gift_card_3'), count: s.payments.giftCardCents },
  ] as { label: string; count: number }[]).filter((x) => x.count > 0);

  const insights: { id: string; text: string; severity: 'info' | 'warn' }[] = [];
  const topSvc = s.revenueByService[0];
  if (!isR('revenueByService') && topSvc) insights.push({ id: 'svc', text: tx('pos.top_service_by_revenue_servicename_revenuecents_1rp0', { serviceName: String(topSvc.serviceName), revenueCents: String(money(topSvc.revenueCents)) }), severity: 'info' });
  if (!isR('payments')) {
    const pm = ([[tx('glossary.checkout.card'), s.payments.cardCents], [tx('glossary.checkout.cash'), s.payments.cashCents], [tx('pos.gift_card_3'), s.payments.giftCardCents]] as [string, number][]).sort((a, b) => b[1] - a[1])[0];
    if (pm && pm[1] > 0) insights.push({ id: 'pay', text: tx('pos.most_revenue_collected_via_v0_v1', { v0: String(pm[0]), v1: String(money(pm[1])) }), severity: 'info' });
  }
  const topTech = s.topTechnicians[0];
  if (!isR('topTechnicians') && topTech) insights.push({ id: 'tech', text: tx('pos.top_technician_name_revenuecents_across_completedservices_xv1q', { name: String(topTech.name), revenueCents: String(money(topTech.revenueCents)), completedServices: String(topTech.completedServices) }), severity: 'info' });
  if (!isR('customerInsights')) insights.push({ id: 'ret', text: tx('pos.customer_retention_retentionratepercent_returningcustomers_returning_newcustomers_1uen', { retentionRatePercent: String(s.customerInsights.retentionRatePercent), returningCustomers: String(s.customerInsights.returningCustomers), newCustomers: String(s.customerInsights.newCustomers) }), severity: 'info' });
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
        <button className="btn w-fit whitespace-nowrap"  disabled={exporting} onClick={() => doExport()}>{exporting ? tx('pos.exporting') : tx('pos.export_csv')}</button>
      </div>

      {note ? <div className="err" style={{ marginBottom: 12 }}>{note}</div> : null}
      {s.restrictedSections?.length ? <div className="err" style={{ marginBottom: 12 }}>{tx('pos.some_financial_sections_are_hidden_for_kw3h')}</div> : null}

      {/* Hero KPI strip — headline business metrics (real; rating/no-show/net-sales stand in for util/rebooking/profit, which aren't tracked) */}
      <div className="kpis" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="l">{tx('pos.total_revenue')}</div><div className="v">{money(s.kpis.totalRevenueCents)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.appointments_completed')}</div><div className="v">{s.kpis.completedServices}</div></div>
        <div className="kpi"><div className="l">{tx('pos.average_ticket')}</div><div className="v">{money(sk.averageTicketCents)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.customer_retention')}</div><div className="v">{isR('customerInsights') ? '—' : `${s.customerInsights.retentionRatePercent}%`}</div></div>
        <div className="kpi"><div className="l">{tx('pos.total_tips')}</div><div className="v">{isR('salesKpis') ? '—' : money(sk.tipsCents)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.average_rating_2')}</div><div className="v">{s.kpis.averageRating ? s.kpis.averageRating.toFixed(1) : '—'}</div></div>
        <div className="kpi"><div className="l">{tx('pos.no_show_rate')}</div><div className="v">{s.kpis.noShowRatePercent}%</div></div>
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
      </section>

      {insights.length > 0 ? (
        <section className="panel mb-3">
          <h2>{tx('pos.ai_insights')}</h2>
          <div className="list">
            {insights.map((ins) => (
              <div className="row" key={ins.id}>
                <span className={'pill ' + (ins.severity === 'warn' ? 'warn' : '')} style={{ flex: 'none' }}>{ins.severity === 'warn' ? '!' : 'i'}</span>
                <div className="t" style={{ marginLeft: 8 }}>{ins.text}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel mb-3">
        <h2>{tx('pos.revenue_appointments_trend')}</h2>
        {isR('salesTrend') ? <Restricted /> : s.salesTrend.points.length === 0 ? <div className="muted">{tx('pos.no_data_for_this_range')}</div> : (() => {
          const apptPts = s.bookingsOverview?.trend?.points || [];
          const apptAligned = apptPts.length === s.salesTrend.points.length;
          const apptMax = Math.max(1, ...apptPts.map((p) => p.completed));
          return (
            <div>
              {apptAligned ? (
                <div style={{ display: 'flex', gap: 14, fontSize: 11.5, color: 'var(--muted,#8A7A66)', marginBottom: 4 }}>
                  <span><span style={{ display: 'inline-block', width: 9, height: 9, background: 'var(--gold)', borderRadius: 2, marginRight: 4 }} />{tx('pos.revenue')}</span>
                  <span><span style={{ display: 'inline-block', width: 9, height: 9, background: '#7B9FD4', borderRadius: 2, marginRight: 4 }} />{tx('pos.appointments_completed_2')}</span>
                </div>
              ) : null}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 6, height: 140, padding: '8px 0' }}>
                {s.salesTrend.points.map((p, i) => (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0, position: 'relative' }}>
                    <div title={money(p.grossSalesCents)} style={{ width: '70%', maxWidth: 40, height: `${Math.round((p.grossSalesCents / trendMax) * 110)}px`, background: 'linear-gradient(180deg, var(--gold), var(--gold2,#caa45a))', borderRadius: '6px 6px 0 0', minHeight: 2 }} />
                    {apptAligned ? <div title={tx('pos.completed_appointments_2', { completed: String(apptPts[i].completed) })} style={{ position: 'absolute', bottom: `${18 + Math.round((apptPts[i].completed / apptMax) * 110)}px`, width: 8, height: 8, borderRadius: '50%', background: '#7B9FD4', border: '2px solid #fff' }} /> : null}
                    <div className="s" style={{ fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{p.label}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
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
        <section className="panel">
          <h2>{tx('pos.revenue_by_service')}</h2>
          <div className="list" style={{ maxHeight: 240 }}>
            {s.revenueByService.length === 0 ? <div className="muted">{tx('pos.no_data')}</div> : null}
            {s.revenueByService.map((r) => (
              <div key={r.serviceId} style={{ padding: '6px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{r.serviceName} <span className="s">· {r.serviceCount}</span></span><span>{money(r.revenueCents)}</span></div>
                <div style={{ height: 6, background: 'var(--line)', borderRadius: 4, marginTop: 3 }}><div style={{ height: 6, width: `${Math.round((r.revenueCents / svcMax) * 100)}%`, background: 'var(--gold)', borderRadius: 4 }} /></div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel" id="rc-technicians">
          <h2>{tx('pos.top_technicians')}</h2>
          <div className="list" style={{ maxHeight: 240 }}>
            {s.topTechnicians.length === 0 ? <div className="muted">{tx('pos.no_data')}</div> : null}
            {s.topTechnicians.map((t) => (
              <div className="row" key={t.technicianId}>
                <div style={{ minWidth: 24 }} className="s">#{t.rank}</div>
                <div><div className="t">{t.name}</div><div className="s">{t.roleLabel} · {t.completedServices} {tx('pos.services_5')}</div></div>
                <div className="r" style={{ marginLeft: 'auto' }}>{money(t.revenueCents)}</div>
              </div>
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
<section className="panel mb-3">
  <h2>{tx('pos.transactions')}</h2>

  {isR('transactions') ? <Restricted /> : (
    <div className="overflow-x-auto">
      <div className="list min-w-[770px]" style={{ maxHeight: 320 }}>
        {s.transactions.length === 0 ? (
          <div className="muted">{tx('pos.no_transactions_in_this_range')}</div>
        ) : null}

        {s.transactions.map((t) => (
          <div className="row" key={t.id}>
            <div className="s" style={{ minWidth: 116 }}>
              {fmtAt(t.at)}
            </div>

            <div style={{ minWidth: 150 }}>
              <div className="t">{t.customer}</div>
              <div className="s">{t.service} · {t.technician}</div>
            </div>

            <span className="pill">{statusLabel('paymentMethod', t.paymentMethod)}</span>

            <span
              className={
                'pill ' +
                (/paid|complete|settled/i.test(t.status)
                  ? 'ok'
                  : /refund|void|fail/i.test(t.status)
                  ? 'warn'
                  : '')
              }
            >
              {statusLabel(['checkoutTicket', 'payment'], t.status)}
            </span>

            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div className="r">{money(t.netCents)}</div>
              <div className="s">
                {tx('pos.tip')}{' '}{money(t.tipCents)} {tx('pos.tax_5')}{' '}{money(t.taxCents)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )}
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
