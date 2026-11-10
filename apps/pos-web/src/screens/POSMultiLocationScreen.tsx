// POSMultiLocationScreen.tsx — Reports → Multi-Location (OWNER-only). Cross-branch performance comparison
// reusing the owner branch-comparison endpoint (/owner/branches/comparison). Tenant-scoped and
// branch-access-aware server-side. Read-only.
import { useCallback, useEffect, useState } from 'react';
import { posMultiLocationApi } from '../api/posMultiLocationApi';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type BranchRow = { rank: number; branchId: string; branchName: string; revenueCents: number; trendPercent: number | null; bookingCount: number; averageTicketCents: number };
type Highlight = { branchId: string; branchName: string; valuePercent?: number | null; valueCents?: number; value?: number };
type State = {
  period: { from: string; to: string; comparisonFrom: string; comparisonTo: string };
  totalRevenueCents: number; totalRevenueTrendPercent: number | null;
  topBranch?: { branchId: string; branchName: string; trendPercent: number | null };
  totalBranches: number; activeBranches: number;
  branches: BranchRow[];
  quickComparison: { bestGrowth?: Highlight; highestAverageTicket?: Highlight; topBookings?: Highlight };
};

// batch 9 guide 16 (Nov 10 2026): null = no prior revenue → N/A (it read +100%)
const trend = (p: number | null | undefined) => { if (p == null) return <span style={{ color: 'var(--muted)', fontWeight: 700 }} data-testid="ml-trend-na">{t('rpt.na')}</span>; const s = p > 0 ? '+' : ''; const c = p > 0 ? '#2E9E54' : p < 0 ? '#C0392B' : 'var(--muted)'; return <span style={{ color: c, fontWeight: 700 }}>{s}{p}%</span>; };

export function POSMultiLocationScreen() {
  const [period, setPeriod] = useState('month');
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true); setError(null);
    try { setS(await posMultiLocationApi.state(p) as State); }
    catch (e: any) { setError(reportError(e, t('admin.noun.multiLocation'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(period); }, [load, period]);

  const rows = s?.branches || [];
  const maxRev = Math.max(1, ...rows.map((r) => r.revenueCents));
  const q = s?.quickComparison;

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.multi_location_reports')}</h1><div className="sub mb-3">{t('pos.cross_branch_performance_for_your_salon')}</div></div>
      <div className="flex flex-col md:flex-row flex-wrap whitespace-nowrap sm:items-center justify-between gap-2 mb-1">
        <PeriodTabs period={period} onChange={setPeriod} />
      </div>

      {loading ? <div className="state">{t('pos.loading_multi_location_report')}</div>
        : error ? <div className="err" style={{ marginTop: 12 }}>{error}</div>
        : !s ? <div className="state">{t('pos.no_data')}</div>
        : (
        <>
          <div className="kpis" style={{ marginTop: 12 }}>
            <div className="kpi"><div className="l">{t('pos.total_revenue')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{money(s.totalRevenueCents)}</div><div className="d">{trend(s.totalRevenueTrendPercent)} {t('pos.vs_prev')}</div></div>
            <div className="kpi"><div className="l">{t('pos.branches')}</div><div className="v">{s.totalBranches}</div><div className="d">{s.activeBranches} {t('pos.active')}</div></div>
            <div className="kpi"><div className="l">{t('pos.top_branch')}</div><div className="v" style={{ fontSize: 18 }}>{s.topBranch?.branchName || '—'}</div>{s.topBranch ? <div className="d">{trend(s.topBranch.trendPercent)}</div> : null}</div>
            <div className="kpi"><div className="l">{t('pos.best_growth')}</div><div className="v" style={{ fontSize: 18 }}>{q?.bestGrowth?.branchName || '—'}</div>{q?.bestGrowth ? <div className="d">{trend(q.bestGrowth.valuePercent)}</div> : null}</div>
          </div>

          {rows.length === 0 ? <div className="state" style={{ marginTop: 12 }}>{t('pos.no_branch_activity_in_this_period')}</div> : (
            <section className="panel mb-3">
              <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.branch_performance')}</div>
              <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
                <thead><tr><th style={{ width: 40 }}>#</th><th>{t('pos.branch')}</th><th style={{ textAlign: 'right' }}>{t('pos.revenue')}</th><th style={{ textAlign: 'right' }}>{t('pos.trend')}</th><th style={{ textAlign: 'right' }}>{t('pos.bookings_2')}</th><th style={{ textAlign: 'right' }}>{t('pos.avg_ticket')}</th><th style={{ width: 140 }}></th></tr></thead>
                <tbody>{rows.map((b) => (
                  <tr key={b.branchId}>
                    <td style={{ color: 'var(--muted)' }}>{b.rank}</td>
                    <td style={{ fontWeight: 700 }}>{b.branchName}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(b.revenueCents)}</td>
                    <td style={{ textAlign: 'right' }}>{trend(b.trendPercent)}</td>
                    <td style={{ textAlign: 'right' }}>{b.bookingCount}</td>
                    <td style={{ textAlign: 'right' }}>{money(b.averageTicketCents)}</td>
                    <td><div style={{ background: 'var(--line)', borderRadius: 5, height: 10, overflow: 'hidden' }}><div style={{ width: `${Math.round((b.revenueCents / maxRev) * 100)}%`, height: '100%', background: 'var(--aps-orange)' }} /></div></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </section>
          )}

          {q && (q.highestAverageTicket || q.topBookings || q.bestGrowth) ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-3">
              <section className="panel"><div className="p-h">{t('pos.highest_average_ticket')}</div><div style={{ fontSize: 15 }}>{q.highestAverageTicket ? <>{q.highestAverageTicket.branchName} · <b>{money(q.highestAverageTicket.valueCents ?? 0)}</b></> : '—'}</div></section>
              <section className="panel"><div className="p-h">{t('pos.most_bookings')}</div><div style={{ fontSize: 15 }}>{q.topBookings ? <>{q.topBookings.branchName} · <b>{q.topBookings.value ?? 0}</b></> : '—'}</div></section>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
