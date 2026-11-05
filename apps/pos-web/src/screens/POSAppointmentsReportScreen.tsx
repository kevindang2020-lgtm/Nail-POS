// POSAppointmentsReportScreen.tsx — Reports → Appointments. Wired to GET /pos/reports/booking
// (permission-gated pos.reports.view). Bookings completed / cancelled / no-show for the period.
import { useEffect, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { useReportCadence } from './reportsCommon';
import { PeriodTabs, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type BookingsOverview = {
  totalBookings: number;
  completed: number; completedPercent: number;
  cancelled: number; cancelledPercent: number;
  noShow: number; noShowPercent: number;
};
const pct = (n: number) => `${(n ?? 0).toFixed(1)}%`;

export function POSAppointmentsReportScreen() {
  const { reloadKey } = useReportCadence();
  const [period, setPeriod] = useState('month');
  const [b, setB] = useState<BookingsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    posReportsApi.booking({ period })
      .then((d: any) => { if (alive) setB(d as BookingsOverview); })
      .catch((e: any) => { if (alive) setError(reportError(e, t('admin.reports.noun.appointments'))); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, reloadKey]);

  if (loading && !b) return <div className="work"><div className="state">{t('pos.loading_appointments_report')}</div></div>;
  if (error && !b) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!b) return <div className="work"><div className="state">{t('pos.no_appointment_data')}</div></div>;

  const outcomes: [string, number, number][] = [
    [t('pos.completed_2'), b.completed || 0, b.completedPercent || 0],
    [t('pos.cancelled'), b.cancelled || 0, b.cancelledPercent || 0],
    [t('pos.no_show'), b.noShow || 0, b.noShowPercent || 0],
  ];
  const max = Math.max(1, ...outcomes.map(([, v]) => v));

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.appointments_report')}</h1><div className="sub mb-3">{t('pos.booking_outcomes_for_the_selected_period')}</div></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}><PeriodTabs period={period} onChange={setPeriod} /></div>
      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.total_bookings')}</div><div className="v">{b.totalBookings ?? 0}</div></div>
        <div className="kpi"><div className="l">{t('pos.completed_2')}</div><div className="v">{b.completed ?? 0}</div><div className="d">{pct(b.completedPercent)}</div></div>
        <div className="kpi"><div className="l">{t('pos.cancelled')}</div><div className="v">{b.cancelled ?? 0}</div><div className="d flat">{pct(b.cancelledPercent)}</div></div>
        <div className="kpi"><div className="l">{t('pos.no_show')}</div><div className="v">{b.noShow ?? 0}</div><div className="d flat">{pct(b.noShowPercent)}</div></div>
      </div>
<div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_500px] gap-3 mb-3">
        <section className="panel">
          <div className="p-h">{t('pos.outcomes')}</div>
          {b.totalBookings === 0 ? <div className="state">{t('pos.no_bookings_in_this_period')}</div> : (
            <div className="bars" role="img" aria-label={t('pos.booking_outcomes')}>
              {outcomes.map(([label, v]) => (
                <div className="bar-col" key={label} title={`${label}: ${v}`}>
                  <div className="bar" style={{ height: `${Math.max(2, Math.round((v / max) * 140))}px` }} />
                  <div className="bar-l">{label}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="p-h">{t('pos.breakdown')}</div>
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{t('pos.outcome')}</th><th style={{ textAlign: 'right' }}>{t('pos.count')}</th><th style={{ textAlign: 'right' }}>{t('pos.share')}</th></tr></thead>
            <tbody>{outcomes.map(([label, v, p]) => (
              <tr key={label}><td>{label}</td><td style={{ textAlign: 'right' }}>{v}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{pct(p)}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      </div>
    </div>
  );
}
