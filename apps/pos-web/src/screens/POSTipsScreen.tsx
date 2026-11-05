// POSTipsScreen.tsx — Payments → Tips. Wired to GET /pos/reports/tips (permission-gated: financial).
// Tip totals, method split, average, and by-technician distribution for the selected period.
import { useEffect, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

type TipsSummary = {
  totalCents: number; cardTipsCents: number; cashTipsCents: number; tipPercentAvg: number;
  noTipCount: number; managerApprovalCount: number; byTechnician: { technicianId: string; name: string; tipsCents: number }[];
};

export function POSTipsScreen() {
  const [period, setPeriod] = useState('month');
  const [t, setT] = useState<TipsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    posReportsApi.tips({ period })
      .then((d: any) => { if (alive) setT(d as TipsSummary); })
      .catch((e: any) => { if (alive) setError(reportError(e, 'tips')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_tips')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!t) return <div className="work"><div className="state">{tx('pos.no_tip_data')}</div></div>;

  const byTech = (t.byTechnician || []).slice().sort((a, b) => b.tipsCents - a.tipsCents);
  const maxTip = Math.max(1, ...byTech.map((r) => r.tipsCents));

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{tx('pos.tips')}</h1><div className="sub">{tx('pos.tip_totals_method_split_and_distribution')}</div></div>
     <div className="overflow-x-auto">
  <div className="min-w-[350px] flex flex-col sm:flex-row justify-between items-stretch whitespace-nowrap sm:items-center mt-3 gap-2"><PeriodTabs period={period} onChange={setPeriod} /></div>
    </div>  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3.5 mt-2.5">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.total_tips')}</div><div className="v">{money(t.totalCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.card_tips')}</div><div className="v">{money(t.cardTipsCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.cash_tips')}</div><div className="v">{money(t.cashTipsCents)}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.avg_tip_2')}</div><div className="v">{(t.tipPercentAvg ?? 0).toFixed(1)}%</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.no_tip_count')}</div><div className="v">{t.noTipCount ?? 0}</div></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <section className="panel">
          <div className="p-h">{tx('pos.tips_by_technician')}</div>
          {byTech.length === 0 ? <div className="state">{tx('pos.no_tips_in_this_period')}</div> : (
            <div className="bars" role="img" aria-label={tx('pos.tips_by_technician_2')}>
              {byTech.slice(0, 10).map((r) => (
                <div className="bar-col" key={r.technicianId} title={`${r.name}: ${money(r.tipsCents)}`}>
                  <div className="bar" style={{ height: `${Math.max(2, Math.round((r.tipsCents / maxTip) * 140))}px` }} />
                  <div className="bar-l">{(r.name || '').split(' ')[0]}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="p-h">{tx('pos.distribution')}</div>
          {byTech.length === 0 ? <div className="state">{tx('pos.no_data')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[400px]">
              <table className="tbl">
                <thead><tr><th>{tx('pos.technician')}</th><th style={{ textAlign: 'right' }}>{tx('pos.tips')}</th></tr></thead>
                <tbody>{byTech.slice(0, 12).map((r) => (
                  <tr key={r.technicianId}><td>{r.name}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.tipsCents)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          )}
        </section>
      </div>
    </div>
  );
}
