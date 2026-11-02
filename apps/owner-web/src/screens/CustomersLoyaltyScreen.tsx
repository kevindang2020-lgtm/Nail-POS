import { useCallback, useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { useOwnerNav } from '../shell/nav';
import { ownerCustomersApi, type OwnerCustomersOverviewResp, type OwnerPeriod } from '../api/ownerApi';
import { PeriodSelector, periodLabel as periodLabelOf } from '../components/PeriodSelector';
import { OwnerSkeletonList } from '../components/OwnerSkeleton';
import { formatCurrency } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// Customers & Loyalty — Module 15 (read surface). Aggregate analytics over the canonical customer tables, scoped to the
// owner's branches + selected period. Spend figures are lifetime paid totals (business analytics) — no payment-instrument
// data is shown, per the privacy requirement.

const money0 = (c: number): string => formatCurrency(c, { fractionDigits: 0 });
const num = (v: number): string => new Intl.NumberFormat('en-US').format(v || 0);

export function CustomersLoyaltyScreen() {
  const { back } = useOwnerNav();
  const { effectiveBranchId } = useOwnerBranch();
  const [period, setPeriod] = useState<OwnerPeriod>('month');
  const [data, setData] = useState<OwnerCustomersOverviewResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    ownerCustomersApi.overview(period, effectiveBranchId)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: any) => { setError(e?.message || 'Could not load customers.'); setLoading(false); });
  }, [period, effectiveBranchId]);

  useEffect(() => { load(); }, [load]);

  const periodLabel = periodLabelOf(period);

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Customers &amp; Loyalty</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div style={{ padding: '0 16px' }}><PeriodSelector value={period} onChange={setPeriod} options={['week', 'month', 'quarter', 'year']} /></div>

      {error ? (
        <div className="owner-state" role="alert">{error}</div>
      ) : (
        <div style={{ padding: '6px 16px 24px' }}>
          <div className="owner-kpigrid" style={{ marginBottom: 8 }}>
            <div className="owner-kpi"><div className="label">Retention Rate</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : `${data!.kpis.retentionRatePercent}%`}</div></div>
            <div className="owner-kpi"><div className="label">Repeat Rate</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : `${data!.kpis.repeatRatePercent}%`}</div></div>
          </div>

          <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
            <div className="owner-kpi"><div className="label">VIP Customers</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(data!.kpis.vipCustomers)}</div></div>
            <div className="owner-kpi"><div className="label">Loyalty Members</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(data!.kpis.loyaltyMembers)}</div></div>
            <div className="owner-kpi"><div className="label">Gift Cards</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : money0(data!.kpis.giftCardOutstandingCents)}</div><div className="sub owner-text-muted">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : `${num(data!.kpis.giftCardCount)} active`}</div></div>
          </div>

          <div className="owner-kpigrid three" style={{ marginBottom: 14 }}>
            <div className="owner-kpi"><div className="label">Total Customers</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(data!.kpis.totalCustomers)}</div></div>
            <div className="owner-kpi"><div className="label">New · {periodLabel}</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(data!.kpis.newCustomers)}</div></div>
            <div className="owner-kpi"><div className="label">Review Score</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : (data!.kpis.reviewCount > 0 ? data!.kpis.reviewAverage.toFixed(1) : '—')}</div><div className="sub owner-text-muted">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : `${num(data!.kpis.reviewCount)} reviews`}</div></div>
          </div>

          <div className="owner-chartcard" style={{ marginBottom: 12 }}>
            <div className="owner-sechead"><div className="h">Loyalty</div><div className="d">{loading && !data ? <div className="owner-skel" style={{ width: 120, height: 14, display: 'inline-block' }} /> : `${num(data!.loyalty.rewardRedemptionCount)} redemptions · ${periodLabel.toLowerCase()}`}</div></div>
            <div className="owner-kpigrid three">
              <div className="owner-kpi"><div className="label">Points Issued</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(data!.loyalty.pointsIssued)}</div></div>
              <div className="owner-kpi"><div className="label">Redeemed</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(data!.loyalty.pointsRedeemed)}</div></div>
              <div className="owner-kpi"><div className="label">Outstanding</div><div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(data!.loyalty.pointsOutstanding)}</div></div>
            </div>
            {loading && !data ? (
              <div className="owner-drill" style={{ marginTop: 10 }}>
                <OwnerSkeletonList count={2} />
              </div>
            ) : data!.loyalty.tiers.length > 0 ? (
              <div className="owner-drill" style={{ marginTop: 10 }}>
                {data!.loyalty.tiers.map((t) => (
                  <div className="owner-drillrow" key={t.tier}>
                    <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{t.tier}</div>
                    <div className="owner-text-muted">{num(t.customers)} member{t.customers === 1 ? '' : 's'}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="owner-sechead"><div className="h">Top Spenders</div><div className="d">lifetime</div></div>
          {loading && !data ? (
            <div className="owner-drill">
              <OwnerSkeletonList count={3} />
            </div>
          ) : data!.topSpenders.length === 0 ? <div className="owner-state">No spend data yet.</div> : (
            <div className="owner-drill">
              {data!.topSpenders.map((s, i) => (
                <div className="owner-drillrow" key={s.customerId}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}><span className="owner-text-muted">{i + 1}.</span> {s.name}</div>
                    <div className="owner-text-muted" style={{ fontSize: 12 }}>{num(s.visits)} visit{s.visits === 1 ? '' : 's'}</div>
                  </div>
                  <div style={{ fontWeight: 700, marginLeft: 10 }}>{money0(s.lifetimeSpendCents)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
