// POSTeamPerformanceScreen.tsx — Team → Performance. Wired to GET /pos/team/state
// (permission-gated settings.view). Overall performance, distribution, and top performers.
import { useEffect, useState } from 'react';
import { posTeamApi } from '../api/posTeamApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type TeamState = {
  kpis: { avgPerformance: number; totalServices: number };
  performance: { overall: number; distribution: { label: string; count: number }[] };
  topPerformers: { employeeId: string; name: string; score: number }[];
};

export function POSTeamPerformanceScreen() {
  const [s, setS] = useState<TeamState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posTeamApi.getState(); if (alive) setS(d as any); }
      catch (e: any) { if (alive) setError(reportError(e, 'team performance')); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_performance')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_performance_data')}</div></div>;

  const perf = s.performance || { overall: 0, distribution: [] };
  const top = (s.topPerformers || []).slice().sort((a, b) => b.score - a.score);
  const dist = perf.distribution || [];
  const maxDist = Math.max(1, ...dist.map((d) => d.count));

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.team_performance')}</h1><div className="sub">{t('pos.overall_performance_and_top_performers')}</div></div>
     <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-3">
        <div className="kpi"><div className="l">{t('pos.overall_score')}</div><div className="v">{perf.overall != null ? `${perf.overall}%` : '—'}</div></div>
        <div className="kpi"><div className="l">{t('pos.avg_performance')}</div><div className="v">{s.kpis?.avgPerformance != null ? `${s.kpis.avgPerformance}%` : '—'}</div></div>
        <div className="kpi"><div className="l">{t('pos.total_services')}</div><div className="v">{s.kpis?.totalServices ?? 0}</div></div>
      </div>
   <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
  <section className="panel">
    <div className="p-h">{t('pos.performance_distribution')}</div>

    {dist.length === 0 ? (
      <div className="state">{t('pos.no_distribution_data')}</div>
    ) : (
      <div className="bars" role="img" aria-label={t('pos.performance_distribution_2')}>
        {dist.map((d, i) => (
          <div className="bar-col" key={i} title={`${d.label}: ${d.count}`}>
            <div
              className="bar"
              style={{
                height: `${Math.max(
                  2,
                  Math.round((d.count / maxDist) * 140)
                )}px`,
              }}
            />
            <div className="bar-l">{d.label}</div>
          </div>
        ))}
      </div>
    )}
  </section>

  <section className="panel min-w-0">
    <div className="p-h">{t('pos.top_performers')}</div>

    {top.length === 0 ? (
      <div className="state">{t('pos.no_performers_yet')}</div>
    ) : (
      <div className="w-full overflow-x-auto">
        <table className="tbl min-w-[700px]">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('pos.name')}</th>
              <th className="text-right">{t('pos.score')}</th>
            </tr>
          </thead>

          <tbody>
            {top.slice(0, 12).map((p, i) => (
              <tr key={p.employeeId}>
                <td>{i + 1}</td>
                <td>{p.name}</td>
                <td className="text-right font-bold">{p.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
</div>
    </div>
  );
}
