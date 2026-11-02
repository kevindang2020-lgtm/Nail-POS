// POSSalesReportScreen.tsx — Reports → Sales. Wired to the real reports backend
// (GET /pos/reports/state, permission-gated pos.reports.view). Renders sales KPIs, a revenue
// trend, and top services for the selected period, with CSV export via the existing endpoint.
import { useEffect, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { useReportCadence, RefreshButton, reportPeriods, periodText } from './reportsCommon';
import { serverText } from '../i18n/server-text';
import { fmtMoney } from '../i18n/format';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const money = (c: number) => fmtMoney(c || 0);

type SalesKpis = {
  grossSalesCents: number; netSalesCents: number; serviceSalesCents: number; productSalesCents: number;
  tipsCents: number; taxCollectedCents: number; cardSurchargeCents: number; discountsCents: number;
  refundsCents: number; ticketsCount: number; customersCount: number; averageTicketCents: number;
};
type TrendPoint = { label: string; grossSalesCents: number; netSalesCents: number };
type ServiceRow = { serviceId: string; serviceName: string; revenueCents: number; serviceCount: number; percentOfTop: number };
type ReportState = { salesKpis: SalesKpis; salesTrend?: { points: TrendPoint[] }; revenueByService?: ServiceRow[]; periodLabel?: string; dateRangeLabel?: string };

// the periods and their labels are reportsCommon's (read at render)

export function POSSalesReportScreen() {
  const [period, setPeriod] = useState<string>('month');
  const [s, setS] = useState<ReportState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { open: openIPad } = useIPadView();
  const { reloadKey, refresh } = useReportCadence();

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    posReportsApi.state({ period })
      .then((d: any) => { if (alive) setS(d); })
      .catch((e: any) => {
        if (!alive) return;
        setError(e?.status === 403
          ? t('pos.you_do_not_have_permission_to_ynwv')
          : (e?.message || t('pos.could_not_load_the_sales_report')));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, reloadKey]);

  const doExport = async () => {
    setBusy(true);
    try {
      const r: any = await posReportsApi.exportReport({ kind: 'sales', period });
      if (r?.csv) {
        const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = r.filename || 'sales-export.csv';
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch { /* surfaced by the download flow */ } finally { setBusy(false); }
  };

  if (loading && !s) return <div className="work"><div className="state">{t('pos.loading_sales_report')}</div></div>;
  if (error && !s) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_report_data')}</div></div>;

  const k = s.salesKpis;
  const points = s.salesTrend?.points || [];
  const maxRev = Math.max(1, ...points.map((p) => p.grossSalesCents));
  const services = s.revenueByService || [];

  const cards: [string, string][] = [
    [t('pos.gross_sales'), money(k.grossSalesCents)],
    [t('pos.net_sales'), money(k.netSalesCents)],
    [t('pos.service_sales_2'), money(k.serviceSalesCents)],
    [t('pos.product_sales'), money(k.productSalesCents)],
    [t('pos.tips'), money(k.tipsCents)],
    [t('pos.tax_collected_2'), money(k.taxCollectedCents)],
    [t('pos.avg_ticket'), money(k.averageTicketCents)],
    [t('pos.tickets'), String(k.ticketsCount ?? 0)],
    [t('glossary.nav.customers'), String(k.customersCount ?? 0)],
  ];

  return (
    <div className="work">
      <div className="vh ">
        <h1>{t('pos.sales_report')}</h1>
        <div className="sub mb-3">{s.dateRangeLabel ? serverText(s.dateRangeLabel) : s.periodLabel ? periodText(s.periodLabel) : t('pos.revenue_performance_over_the_selected_period')}</div>
      </div>

     <div className="flex flex-col md:flex-row flex-wrap whitespace-nowrap sm:items-center justify-between gap-2 mb-1">
        <div className="seg" role="tablist" aria-label={t('pos.report_period')}>
          {reportPeriods().map(([val, label]) => (
            <button key={val} role="tab" aria-selected={period === val} className={`seg-btn whitespace-nowrap ${period === val ? 'on' : ''}`} onClick={() => setPeriod(val)}>{label}</button>
          ))}
        </div>
        <div className="">
        <button className="btn ghost w-fit whitespace-nowrap"  title={t('pos.open_full_ipad_view')} onClick={() => openIPad(reportRequest(t('pos.sales_report'), { kpis: cards.map(([label, value]) => ({ label, value })), columns: [t('glossary.term.service'), t('pos.revenue'), t('pos.count'), t('admin.reports.percentOfTop')], rows: services.map((sv) => [sv.serviceName, money(sv.revenueCents), sv.serviceCount, Math.round(sv.percentOfTop) + '%']), periodLabel: s.dateRangeLabel || s.periodLabel }))}>{t('pos.full_view')}</button> <span style={{ marginLeft: 4 }}><RefreshButton onClick={refresh} busy={loading} /></span> <button className="btn ghost w-fit whitespace-nowrap" style={{ marginLeft: 4 }} disabled={busy} onClick={doExport}>{busy ? t('pos.exporting') : t('pos.export_csv_2')}</button>
      </div></div>

      <div className="kpis">{cards.map(([l, v]) => (<div className="kpi" key={l}><div className="l">{l}</div><div className="v">{v}</div></div>))}</div>

       <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_500px] gap-3 mb-3">
        <section className="panel">
          <div className="p-h">{t('pos.revenue_trend')}</div>
          {points.length === 0 ? <div className="state">{t('pos.no_sales_in_this_period')}</div> : (
            <div className="bars" role="img" aria-label={t('pos.gross_revenue_by_period')}>
              {points.map((p, i) => (
                <div className="bar-col" key={i} title={`${p.label}: ${money(p.grossSalesCents)}`}>
                  <div className="bar" style={{ height: `${Math.max(2, Math.round((p.grossSalesCents / maxRev) * 140))}px` }} />
                  <div className="bar-l">{p.label}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="p-h">{t('pos.top_services')}</div>
          {services.length === 0 ? <div className="state">{t('pos.no_service_sales_in_this_period')}</div> : (
            <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
              <thead><tr><th>{t('pos.service_3')}</th><th style={{ textAlign: 'right' }}>{t('pos.count')}</th><th style={{ textAlign: 'right' }}>{t('pos.revenue')}</th></tr></thead>
              <tbody>{services.slice(0, 8).map((r) => (
                <tr key={r.serviceId}><td>{r.serviceName}</td><td style={{ textAlign: 'right' }}>{r.serviceCount}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.revenueCents)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </div>
  );
}
