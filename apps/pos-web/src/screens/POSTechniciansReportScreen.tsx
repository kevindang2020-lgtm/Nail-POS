// POSTechniciansReportScreen.tsx — Reports → Technicians. Wired to GET /pos/reports/technicians
// (permission-gated: financial or pos.reports.technician_view). Technician revenue leaderboard.
import { useEffect, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { useReportCadence } from './reportsCommon';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type TechRow = { technicianId: string; rank: number; name: string; roleLabel: string; revenueCents: number; completedServices: number };

export function POSTechniciansReportScreen() {
  const { reloadKey } = useReportCadence();
  const [period, setPeriod] = useState('month');
  const [rows, setRows] = useState<TechRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { open: openIPad } = useIPadView();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    posReportsApi.technicians({ period })
      .then((d: any) => { if (alive) setRows(Array.isArray(d) ? d : (d?.rows ?? d?.technicians ?? [])); })
      .catch((e: any) => { if (alive) setError(reportError(e, 'the technicians report')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, reloadKey]);

  if (loading && !rows) return <div className="work"><div className="state">{t('pos.loading_technicians_report')}</div></div>;
  if (error && !rows) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  const list = (rows || []).slice().sort((a, b) => (a.rank || 0) - (b.rank || 0));
  const totalRevenue = list.reduce((a, r) => a + (r.revenueCents || 0), 0);
  const totalCompleted = list.reduce((a, r) => a + (r.completedServices || 0), 0);
  const maxRev = Math.max(1, ...list.map((r) => r.revenueCents));

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.technicians_report')}</h1><div className="sub mb-3">{t('pos.revenue_and_services_completed_by_technician')}</div></div>
      <div className="flex flex-col md:flex-row flex-wrap whitespace-nowrap sm:items-center justify-between gap-2 mb-1"><PeriodTabs period={period} onChange={setPeriod} /><button className="btn ghost w-fit whitespace-nowrap"  title={t('pos.open_full_ipad_view')} onClick={() => openIPad(reportRequest(t('pos.technicians_report'), { kpis: [{ label: t('pos.total_revenue'), value: money(totalRevenue) }, { label: t('pos.technicians'), value: list.length }], columns: ['#', t('pos.technician'), t('pos.services'), t('pos.revenue')], rows: list.map((r) => [r.rank, r.name, r.completedServices, money(r.revenueCents)]), periodLabel: period }))}>{t('pos.full_view')}</button></div>
      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.technician_revenue')}</div><div className="v">{money(totalRevenue)}</div></div>
        <div className="kpi"><div className="l">{t('pos.services_completed')}</div><div className="v">{totalCompleted}</div></div>
        <div className="kpi"><div className="l">{t('pos.technicians')}</div><div className="v">{list.length}</div></div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_500px] gap-3 mb-3">
        <section className="panel">
          <div className="p-h">{t('pos.revenue_by_technician')}</div>
          {list.length === 0 ? <div className="state">{t('pos.no_technician_revenue_in_this_period')}</div> : (
            <div className="bars" role="img" aria-label={t('pos.revenue_by_technician_2')}>
              {list.slice(0, 10).map((r) => (
                <div className="bar-col" key={r.technicianId} title={`${r.name}: ${money(r.revenueCents)}`}>
                  <div className="bar" style={{ height: `${Math.max(2, Math.round((r.revenueCents / maxRev) * 140))}px` }} />
                  <div className="bar-l">{(r.name || '').split(' ')[0]}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="p-h">{t('pos.leaderboard')}</div>
          {list.length === 0 ? <div className="state">{t('pos.no_data')}</div> : (
            <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
              <thead><tr><th>#</th><th>{t('pos.technician')}</th><th style={{ textAlign: 'right' }}>{t('pos.done')}</th><th style={{ textAlign: 'right' }}>{t('pos.revenue')}</th></tr></thead>
              <tbody>{list.slice(0, 12).map((r) => (
                <tr key={r.technicianId}><td>{r.rank}</td><td>{r.name}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.roleLabel}</div></td><td style={{ textAlign: 'right' }}>{r.completedServices}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.revenueCents)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      </div>
    </div>
  );
}
