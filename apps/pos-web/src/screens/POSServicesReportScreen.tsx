// POSServicesReportScreen.tsx — Reports → Services. Wired to GET /pos/reports/services
// (permission-gated pos.reports.view). Revenue and volume by service for the selected period.
import { useEffect, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { useReportCadence } from './reportsCommon';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type ServiceRow = { serviceId: string; serviceName: string; revenueCents: number; serviceCount: number; percentOfTop: number };

export function POSServicesReportScreen() {
  const { reloadKey } = useReportCadence();
  const [period, setPeriod] = useState('month');
  const [rows, setRows] = useState<ServiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { open: openIPad } = useIPadView();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    posReportsApi.services({ period })
      .then((d: any) => { if (alive) setRows(Array.isArray(d) ? d : (d?.rows ?? d?.services ?? [])); })
      .catch((e: any) => { if (alive) setError(reportError(e, 'the services report')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, reloadKey]);

  if (loading && !rows) return <div className="work"><div className="state">{t('pos.loading_services_report')}</div></div>;
  if (error && !rows) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  const list = rows || [];
  const totalRevenue = list.reduce((a, r) => a + (r.revenueCents || 0), 0);
  const totalCount = list.reduce((a, r) => a + (r.serviceCount || 0), 0);
  const maxRev = Math.max(1, ...list.map((r) => r.revenueCents));

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.services_report')}</h1><div className="sub mb-3">{t('pos.revenue_and_volume_by_service')}</div></div>
      <div className="flex flex-col md:flex-row flex-wrap whitespace-nowrap sm:items-center justify-between gap-2 mb-1"><PeriodTabs period={period} onChange={setPeriod} /><button className="btn ghost w-fit whitespace-nowrap"  title={t('pos.open_full_ipad_view')} onClick={() => openIPad(reportRequest(t('pos.services_report'), { kpis: [{ label: t('pos.total_revenue'), value: money(totalRevenue) }, { label: t('pos.services'), value: totalCount }], columns: [t('glossary.term.service'), t('pos.revenue'), t('pos.count')], rows: list.map((r) => [r.serviceName, money(r.revenueCents), r.serviceCount]), periodLabel: period }))}>{t('pos.full_view')}</button></div>
      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.service_revenue')}</div><div className="v">{money(totalRevenue)}</div></div>
        <div className="kpi"><div className="l">{t('pos.services_sold')}</div><div className="v">{totalCount}</div></div>
        <div className="kpi"><div className="l">{t('pos.unique_services')}</div><div className="v">{list.length}</div></div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_500px] gap-3 mb-3">
        <section className="panel">
          <div className="p-h">{t('pos.top_services_by_revenue')}</div>
          {list.length === 0 ? <div className="state">{t('pos.no_service_sales_in_this_period')}</div> : (
            <div className="bars" role="img" aria-label={t('pos.revenue_by_service_2')}>
              {list.slice(0, 10).map((r) => (
                <div className="bar-col" key={r.serviceId} title={`${r.serviceName}: ${money(r.revenueCents)}`}>
                  <div className="bar" style={{ height: `${Math.max(2, Math.round((r.revenueCents / maxRev) * 140))}px` }} />
                  <div className="bar-l">{r.serviceName.length > 10 ? r.serviceName.slice(0, 9) + '…' : r.serviceName}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="p-h">{t('pos.breakdown')}</div>
          {list.length === 0 ? <div className="state">{t('pos.no_data')}</div> : (
            <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
              <thead><tr><th>{t('pos.service_3')}</th><th style={{ textAlign: 'right' }}>{t('pos.count')}</th><th style={{ textAlign: 'right' }}>{t('pos.revenue')}</th></tr></thead>
              <tbody>{list.slice(0, 12).map((r) => (
                <tr key={r.serviceId}><td>{r.serviceName}</td><td style={{ textAlign: 'right' }}>{r.serviceCount}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.revenueCents)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </div>
  );
}
