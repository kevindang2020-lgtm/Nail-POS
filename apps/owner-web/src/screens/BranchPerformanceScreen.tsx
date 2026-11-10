import { useEffect, useState } from 'react';
import { ownerBranchesApi, type OwnerBranchPerformanceState, type OwnerPeriod } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';
import { PeriodSelector, periodLabel } from '../components/PeriodSelector';
import { OwnerSkeletonList } from '../components/OwnerSkeleton';
import { OwnerAiQueueCard } from './OwnerAiQueueCard';
import { OwnerAiSchedulingCard } from './OwnerAiSchedulingCard';
import { formatCurrency } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// BranchPerformanceScreen — Module 2. Real data from GET /owner/branches/performance (+ /comparison). Overview shows
// the 3 KPI cards + ranked Revenue-by-Branch; Comparison shows the quick-comparison cards + the same ranked list.
// No mock numbers; honest loading/error/empty states. Period chips refetch.

const money = (c: number) => formatCurrency(c, { fractionDigits: 0 });
const money2 = (c: number) => formatCurrency(c);
function trend(p: number) { if (p > 0) return { cls: 'up', arrow: '▲', text: `${p.toFixed(1)}%` }; if (p < 0) return { cls: 'down', arrow: '▼', text: `${Math.abs(p).toFixed(1)}%` }; return { cls: 'flat', arrow: '•', text: '0.0%' }; }

// Nov 10 2026: no revenue in the comparison period → no trend (the server sends null); it used to read "+100%"
function Trend({ p }: { p: number | null }) { if (p == null) return <span className="t flat" data-testid="trend-na">N/A</span>; const t = trend(p); return <span className={`t ${t.cls}`}>{t.arrow} {t.text}</span>; }

export function BranchPerformanceScreen() {
  const { go } = useOwnerNav();   // developer merge (Oct 6 2026): a back arrow to More, as every pushed screen has
  const [tab, setTab] = useState<'overview' | 'comparison'>('overview');
  const [period, setPeriod] = useState<OwnerPeriod>('month');
  const [data, setData] = useState<OwnerBranchPerformanceState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = (p: OwnerPeriod, t: 'overview' | 'comparison') => {
    setLoading(true); setErr(null);
    (t === 'comparison' ? ownerBranchesApi.comparison(p) : ownerBranchesApi.performance(p))
      .then(setData)
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to branch reports.' : e?.message || 'Unable to load branch performance.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(period, tab); }, [period, tab]);

  const maxRev = data ? Math.max(1, ...data.branches.map((b) => b.revenueCents)) : 1;
  const qc = data?.quickComparison;

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={() => go('more')}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Branch Performance</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div className="owner-tabs">
        <button className={`owner-tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`owner-tab ${tab === 'comparison' ? 'active' : ''}`} onClick={() => setTab('comparison')}>Comparison</button>
      </div>

      <PeriodSelector value={period} onChange={setPeriod} />

      {err ? (
        <div className="owner-state"><div className="big owner-serif">Couldn’t load branches</div><div className="muted" style={{ marginBottom: 16 }}>{err}</div><button className="owner-btn" onClick={() => load(period, tab)}>Retry</button></div>
      ) : loading && data && data.branches.length === 0 ? (
        <>
          {tab === 'overview' ? (
            <div className="owner-kpigrid three">
              <div className="owner-kpi"><div className="label">Total Revenue</div><div className="val"><div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /></div></div>
              <div className="owner-kpi"><div className="label">Top Performing</div><div className="val"><div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /></div></div>
              <div className="owner-kpi"><div className="label">Total Branches</div><div className="val"><div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /></div></div>
            </div>
          ) : (
            <div className="owner-kpigrid three">
              <div className="owner-kpi"><div className="label">Best Growth</div><div className="val"><div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /></div></div>
              <div className="owner-kpi"><div className="label">Highest ATV</div><div className="val"><div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /></div></div>
              <div className="owner-kpi"><div className="label">Top Bookings</div><div className="val"><div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /></div></div>
            </div>
          )}
          <div className="owner-chartcard">
            <div className="head"><div className="t">Revenue by Branch</div><div className="u">{periodLabel(period)}</div></div>
            <div className="owner-branchlist">
              <OwnerSkeletonList count={3} />
            </div>
          </div>
        </>
      ) : data && data.branches.length === 0 ? (
        <div className="owner-state"><div className="big owner-serif">No active branches found</div><div className="muted">No branch revenue for this period.</div></div>
      ) : (
        <>
          {tab === 'overview' ? (
            <div className="owner-kpigrid three">
              <div className="owner-kpi"><div className="label">Total Revenue</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : money(data!.totalRevenueCents)}</div><div className="sub">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : <Trend p={data!.totalRevenueTrendPercent} />}</div></div>
              <div className="owner-kpi"><div className="label">Top Performing</div><div className="val" style={{ fontSize: 14 }}>{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : (data!.topBranch?.branchName ?? '—')}</div><div className="sub">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : data!.topBranch ? <Trend p={data!.topBranch.trendPercent} /> : null}</div></div>
              <div className="owner-kpi"><div className="label">Total Branches</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : data!.activeBranches}</div><div className="sub flat">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : 'Active'}</div></div>
            </div>
          ) : (
            <div className="owner-kpigrid three">
              <div className="owner-kpi"><div className="label">Best Growth</div><div className="val" style={{ fontSize: 13 }}>{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : (qc?.bestGrowth?.branchName ?? '—')}</div><div className="sub">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : qc?.bestGrowth ? <Trend p={qc.bestGrowth.valuePercent} /> : null}</div></div>
              <div className="owner-kpi"><div className="label">Highest ATV</div><div className="val" style={{ fontSize: 13 }}>{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : (qc?.highestAverageTicket?.branchName ?? '—')}</div><div className="sub flat">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : qc?.highestAverageTicket ? money2(qc.highestAverageTicket.valueCents) : '—'}</div></div>
              <div className="owner-kpi"><div className="label">Top Bookings</div><div className="val" style={{ fontSize: 13 }}>{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : (qc?.topBookings?.branchName ?? '—')}</div><div className="sub flat">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : (qc?.topBookings?.value ?? 0)}</div></div>
            </div>
          )}

          <div className="owner-chartcard">
            <div className="head"><div className="t">Revenue by Branch</div><div className="u">{periodLabel(period)}</div></div>
            <div className="owner-branchlist">
              {loading && !data ? <OwnerSkeletonList count={3} /> : data!.branches.map((b) => (
                <div className="owner-branchrow" key={b.branchId}>
                  <div className="owner-rankbubble">{b.rank}</div>
                  <div>
                    <div className="nm">{b.branchName}</div>
                    <div className="owner-bar"><span style={{ width: `${Math.max(4, Math.round((b.revenueCents / maxRev) * 100))}%` }} /></div>
                  </div>
                  <div className="rt"><div className="v">{money(b.revenueCents)}</div><div className="t"><Trend p={b.trendPercent} /></div></div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* BUILD_PLAN Phase 6 (ai_queue_assignment): the AI queue branch comparison — its own period, independent of revenue */}
      <OwnerAiQueueCard />
      {/* BUILD_PLAN Phase 7 (ai_scheduling_optimizer): the scheduling optimizer branch comparison — its own period too */}
      <OwnerAiSchedulingCard />
    </>
  );
}
