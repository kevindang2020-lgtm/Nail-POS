import { useCallback, useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { useOwnerNav } from '../shell/nav';
import { ownerCustomersApi, type OwnerGiftCardReportResp, type OwnerPeriod } from '../api/ownerApi';
import { PeriodSelector, periodLabel as periodLabelOf } from '../components/PeriodSelector';
import { OwnerSkeletonBlocks, OwnerSkeletonCards, OwnerSkeletonList } from '../components/OwnerSkeleton';

// Gift Cards (owner, read-only) — liability & activity. Outstanding is the current unredeemed balance across all cards
// (the salon's liability); issued/redeemed are period value movements from the ledger. Scoped to the owner's branches.
const money0 = (c: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((c || 0) / 100);
const num = (v: number): string => new Intl.NumberFormat('en-US').format(v || 0);

export function GiftCardReportScreen() {
  const { back } = useOwnerNav();
  const { effectiveBranchId } = useOwnerBranch();
  const [period, setPeriod] = useState<OwnerPeriod>('month');
  const [data, setData] = useState<OwnerGiftCardReportResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    ownerCustomersApi.giftCardReport(period, effectiveBranchId)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: any) => { setError(e?.message || 'Could not load the gift-card report.'); setLoading(false); });
  }, [period, effectiveBranchId]);
  useEffect(() => { load(); }, [load]);

  const periodLabel = periodLabelOf(period);

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Gift Cards</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div style={{ padding: '0 16px' }}><PeriodSelector value={period} onChange={setPeriod} options={['week', 'month', 'quarter', 'year']} /></div>

      {error ? <div className="owner-state" role="alert">{error}</div> : (
        <div style={{ padding: '6px 16px 24px' }}>
          <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
            <div className="owner-kpi">
              <div className="label">Outstanding Liability</div>
              <div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : money0(data!.outstandingCents)}</div>
              <div className="sub owner-text-muted">unredeemed balance</div>
            </div>
            <div className="owner-kpi">
              <div className="label">Active Cards</div>
              <div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(data!.activeCount)}</div>
            </div>
            <div className="owner-kpi">
              <div className="label">Total Cards</div>
              <div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(data!.totalCards)}</div>
            </div>
          </div>

          <div className="owner-chartcard">
            <div className="owner-sechead"><div className="h">Activity</div><div className="d">{periodLabel.toLowerCase()}</div></div>
            <div className="owner-kpigrid">
              <div className="owner-kpi">
                <div className="label">Issued</div>
                <div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : money0(data!.issuedCents)}</div>
                <div className="sub owner-text-muted">{loading && !data ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : `${num(data!.issuedCount)} ${data!.issuedCount === 1 ? 'card' : 'cards'}`}</div>
              </div>
              <div className="owner-kpi">
                <div className="label">Redeemed</div>
                <div className="val">{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : money0(data!.redeemedCents)}</div>
                <div className="sub owner-text-muted">{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 12, margin: '4px auto 0' }} /> : `${num(data!.redeemedCount)} ${data!.redeemedCount === 1 ? 'redemption' : 'redemptions'}`}</div>
              </div>
            </div>
          </div>

          <p className="sub owner-text-muted" style={{ marginTop: 12 }}>Outstanding is the current unredeemed balance across all gift cards — your liability. Issued and redeemed cover the selected period.</p>
        </div>
      )}
    </>
  );
}
