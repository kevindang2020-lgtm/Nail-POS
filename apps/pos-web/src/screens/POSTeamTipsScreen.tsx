// POSTeamTipsScreen.tsx — Team → Tips. Reuses the existing reports tips endpoint (/pos/reports/tips,
// pos.reports.view), presented team-first: tips by technician + card/cash split over a period. Read-only.
import { useCallback, useEffect, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

type TechTip = { technicianId: string; name: string; tipsCents: number };
type Tips = { totalCents: number; cardTipsCents: number; cashTipsCents: number; tipPercentAvg: number; noTipCount: number; managerApprovalCount: number; byTechnician: TechTip[] };

const presetOf = (p: string) => ({ today: 'today', week: 'week', month: 'month', year: 'year' } as Record<string, string>)[p] || 'month';

export function POSTeamTipsScreen() {
  const [period, setPeriod] = useState('month');
  const [t, setT] = useState<Tips | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true); setError(null);
    try { setT(await posReportsApi.tips({ preset: presetOf(p) }) as Tips); }
    catch (e: any) { setError(reportError(e, 'team tips')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(period); }, [load, period]);

  // extras (Nov 11 2026): find a technician in the full list the server returned (every technician with tips in the period)
  const [q, setQ] = useState('');
  const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const all = (t?.byTechnician || []).slice().sort((a, b) => b.tipsCents - a.tipsCents);
  const techs = q.trim() ? all.filter((x) => fold(x.name || '').includes(fold(q.trim()))) : all;
  const maxTip = Math.max(1, ...techs.map((x) => x.tipsCents));

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{tx('pos.team_tips')}</h1><div className="sub">{tx('pos.tips_earned_by_technician_over_the_1xt1')}</div></div>
      <PeriodTabs period={period} onChange={setPeriod} />
      {/* extras (Nov 11 2026) — time basis: tips count on the day the payment was taken (the salon's day), not allocation / payout day */}
      <div className="sub" style={{ marginTop: 6 }} data-testid="tips-basis">{tx('tips.basis')}</div>

      {loading ? <div className="state">{tx('pos.loading_team_tips')}</div>
        : error ? <div className="err" style={{ marginTop: 12 }}>{error}</div>
        : !t ? <div className="state">{tx('pos.no_data')}</div>
        : (
        <>
          <div className="kpis" style={{ marginTop: 12 }}>
            <div className="kpi"><div className="l">{tx('pos.total_tips')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{money(t.totalCents)}</div></div>
            <div className="kpi"><div className="l">{tx('pos.card_tips')}</div><div className="v">{money(t.cardTipsCents)}</div></div>
            <div className="kpi"><div className="l">{tx('pos.cash_tips')}</div><div className="v">{money(t.cashTipsCents)}</div></div>
            <div className="kpi"><div className="l">{tx('pos.avg_tip_2')}</div><div className="v">{t.tipPercentAvg || 0}%</div></div>
          </div>

          <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
            <div className="p-h" style={{ padding: '14px 14px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{tx('pos.tips_by_technician')}
              {all.length > 1 ? <input className="input" style={{ minHeight: 40, marginLeft: 'auto', maxWidth: 260 }} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('tips.search')} aria-label={tx('tips.search')} data-testid="tips-search" /> : null}</div>
            {techs.length === 0 ? <div className="state" style={{ padding: 16 }} data-testid="tips-empty">{all.length && q.trim() ? tx('tips.noMatch', { q: q.trim() }) : tx('pos.no_tips_recorded_in_this_period')}</div> : (
             <div className="w-full overflow-x-auto md:overflow-x-visible">
  <table className="tbl min-w-[700px] md:min-w-0">
                <thead><tr><th>{tx('pos.technician')}</th><th style={{ textAlign: 'right' }}>{tx('pos.tips')}</th><th style={{ width: 160 }}></th></tr></thead>
                <tbody>{techs.map((x) => (
                  <tr key={x.technicianId || x.name}>
                    <td>{x.name || <span style={{ color: 'var(--muted)' }}>{tx('pos.unknown')}</span>}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(x.tipsCents)}</td>
                    <td><div style={{ background: 'var(--line)', borderRadius: 5, height: 10, overflow: 'hidden' }}><div style={{ width: `${Math.round((x.tipsCents / maxTip) * 100)}%`, height: '100%', background: 'var(--aps-orange)' }} /></div></td>
                  </tr>
                ))}</tbody>
              </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
