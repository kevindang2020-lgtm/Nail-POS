// POSCommissionReportScreen.tsx — Reports → Commission. Wired to /pos/commission-report (pos.reports.view).
// Per-technician commission + tips over a selectable period, from the commission SNAPSHOTS captured at
// service time. Read-only.
import { useCallback, useEffect, useState } from 'react';
import { posCommissionReportApi } from '../api/posCommissionReportApi';
import { useReportCadence } from './reportsCommon';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Row = { technicianId: string; technicianName: string | null; serviceCount: number; serviceRevenueCents: number; commissionCents: number; tipsCents: number; payoutCents: number; effectiveRatePercent: number };
type Kpis = { technicianCount: number; totalServiceRevenueCents: number; totalCommissionCents: number; totalTipsCents: number; totalPayoutCents: number; averageRatePercent: number };
type State = { preset: string; from: string; to: string; kpis: Kpis; rows: Row[] };

export function POSCommissionReportScreen() {
  const { reloadKey } = useReportCadence();
  const [period, setPeriod] = useState('month');
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { open: openIPad } = useIPadView();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true); setError(null);
    try { setS(await posCommissionReportApi.state(p) as State); }
    catch (e: any) { setError(reportError(e, t('admin.reports.noun.commission'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(period); }, [load, period, reloadKey]);   // the report cadence's reloadKey re-runs the load

  const k = s?.kpis;
  const rows = s?.rows || [];
  const maxPayout = Math.max(1, ...rows.map((r) => r.payoutCents));

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.commission_report')}</h1><div className="sub mb-3">{t('pos.per_technician_commission_and_tips_from_os3g')}</div></div>
         <div className="mb-6 flex flex-col sm:flex-row gap-3 justify-between ">
      <PeriodTabs period={period} onChange={setPeriod} />{s && (<button className="btn ghost w-fit whitespace-nowrap"  title={t('pos.open_full_ipad_view')} onClick={() => openIPad(reportRequest(t('pos.commission_report'), { kpis: [{ label: t('pos.technicians'), value: s.kpis.technicianCount }, { label: t('pos.revenue'), value: money(s.kpis.totalServiceRevenueCents) }, { label: t('pos.commission'), value: money(s.kpis.totalCommissionCents) }, { label: t('pos.payout'), value: money(s.kpis.totalPayoutCents) }], columns: [t('glossary.people.technician'), t('pos.services'), t('pos.revenue'), t('pos.commission'), t('pos.tips'), t('pos.payout'), t('pos.rate')], rows: s.rows.map((r) => [r.technicianName || '—', r.serviceCount, money(r.serviceRevenueCents), money(r.commissionCents), money(r.tipsCents), money(r.payoutCents), r.effectiveRatePercent + '%']), periodLabel: period }))}>{t('pos.full_view')}</button>)}</div>

      {loading && !s ? <div className="state">{t('pos.loading_commission_report')}</div>
        : error && !s ? <div className="err" style={{ marginTop: 12 }}>{error}</div>
        : !s ? <div className="state">{t('pos.no_data')}</div>
        : (
        <>
          <div className="kpis" style={{ marginTop: 12 }}>
            <div className="kpi"><div className="l">{t('pos.technicians')}</div><div className="v">{k!.technicianCount}</div></div>
            <div className="kpi"><div className="l">{t('pos.service_revenue')}</div><div className="v">{money(k!.totalServiceRevenueCents)}</div></div>
            <div className="kpi"><div className="l">{t('pos.commission')}</div><div className="v">{money(k!.totalCommissionCents)}</div></div>
            <div className="kpi"><div className="l">{t('pos.tips')}</div><div className="v">{money(k!.totalTipsCents)}</div></div>
            <div className="kpi"><div className="l">{t('pos.total_payout')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{money(k!.totalPayoutCents)}</div><div className="d">{t('pos.avg_rate')}{' '}{k!.averageRatePercent}%</div></div>
          </div>

          <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
            <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.payout_by_technician')}</div>
            {rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_commissionable_activity_in_this_period')}</div> : (
             <div className="w-full overflow-x-auto md:overflow-x-visible">
  <table className="tbl min-w-[800px] md:min-w-0">
                <thead><tr><th>{t('pos.technician')}</th><th style={{ textAlign: 'right' }}>{t('pos.services')}</th><th style={{ textAlign: 'right' }}>{t('pos.service_revenue')}</th><th style={{ textAlign: 'right' }}>{t('pos.commission')}</th><th style={{ textAlign: 'right' }}>{t('pos.rate')}</th><th style={{ textAlign: 'right' }}>{t('pos.tips')}</th><th style={{ textAlign: 'right' }}>{t('pos.payout')}</th><th style={{ width: 120 }}></th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.technicianId}>
                    <td>{r.technicianName || <span style={{ color: 'var(--muted)' }}>{t('pos.unknown')}</span>}</td>
                    <td style={{ textAlign: 'right' }}>{r.serviceCount}</td>
                    <td style={{ textAlign: 'right' }}>{money(r.serviceRevenueCents)}</td>
                    <td style={{ textAlign: 'right' }}>{money(r.commissionCents)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{r.effectiveRatePercent}%</td>
                    <td style={{ textAlign: 'right' }}>{money(r.tipsCents)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.payoutCents)}</td>
                    <td><div style={{ background: 'var(--line)', borderRadius: 5, height: 10, overflow: 'hidden' }}><div style={{ width: `${Math.round((r.payoutCents / maxPayout) * 100)}%`, height: '100%', background: 'var(--aps-orange)' }} /></div></td>
                  </tr>
                ))}</tbody>
              </table>
              </div>
            )}
          </section>
          <div className="sub mb-3" style={{ marginTop: 8, fontSize: 12 }}>{t('pos.commission_uses_the_rate_captured_on_1d9v')}</div>
        </>
      )}
    </div>
  );
}
