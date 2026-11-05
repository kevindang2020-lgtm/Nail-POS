import { useCallback, useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { useOwnerNav } from '../shell/nav';
import { ownerMembershipsApi, type OwnerMembershipOverview } from '../api/ownerApi';
import { OwnerSkeletonList } from '../components/OwnerSkeleton';

// Memberships (Owner rollup) — reuses the tenant-scoped membership overview aggregation, respecting the owner's branch
// selector (all branches when none selected). Read surface: member counts, recognized membership revenue, expiring/
// canceled, plan distribution, and member-status breakdown. Money is recognized membership revenue (business analytics).

const money0 = (c: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((c || 0) / 100);
const num = (v: number): string => new Intl.NumberFormat('en-US').format(v || 0);
const delta = (p: number | null): string | null => (p == null ? null : `${p > 0 ? '+' : ''}${p}% vs prior`);

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', trial: 'Trial', active: 'Active', grace: 'Grace', past_due: 'Past due', paused: 'Paused',
  canceling: 'Canceling', canceled: 'Canceled', expired: 'Expired', suspended: 'Suspended', comped: 'Comped', completed: 'Completed',
};

export function OwnerMembershipsScreen() {
  const { back } = useOwnerNav();
  const { effectiveBranchId } = useOwnerBranch();
  const [data, setData] = useState<OwnerMembershipOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    ownerMembershipsApi.overview(effectiveBranchId)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: any) => { setError(e?.message || 'Could not load memberships.'); setLoading(false); });
  }, [effectiveBranchId]);
  useEffect(() => { load(); }, [load]);

  const k = data?.kpis;

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Memberships</div></div>
        <div style={{ width: 20 }} />
      </header>

      {error ? (
        <div className="owner-state" role="alert">{error}</div>
      ) : (
        <div style={{ padding: '0 16px 24px' }}>
          <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
            <div className="owner-kpi"><div className="label">Active Members</div><div className="val">{loading && !k ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(k!.activeMembers)}</div><div className="sub owner-text-muted">{loading && !k ? <div className="owner-skel" style={{ width: 60, height: 12, margin: '4px auto 0' }} /> : `${k!.activePctOfTotal}% of ${num(k!.totalMembers)}`}</div></div>
            <div className="owner-kpi"><div className="label">Membership Revenue</div><div className="val">{loading && !k ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : money0(k!.membershipRevenueCents)}</div>{loading && !k ? <div className="owner-skel" style={{ width: 60, height: 12, margin: '4px auto 0' }} /> : delta(k!.revenueDeltaPct) ? <div className="sub owner-text-muted">{delta(k!.revenueDeltaPct)}</div> : null}</div>
            <div className="owner-kpi"><div className="label">Expiring Soon</div><div className="val">{loading && !k ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(k!.expiringSoon)}</div><div className="sub owner-text-muted">{loading && !k ? <div className="owner-skel" style={{ width: 60, height: 12, margin: '4px auto 0' }} /> : `next ${k!.expiringWindowDays}d`}</div></div>
          </div>

          <div className="owner-kpigrid three" style={{ marginBottom: 14 }}>
            <div className="owner-kpi"><div className="label">Total Members</div><div className="val">{loading && !k ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(k!.totalMembers)}</div></div>
            <div className="owner-kpi"><div className="label">New This Month</div><div className="val">{loading && !k ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(k!.newMembersThisMonth)}</div></div>
            <div className="owner-kpi"><div className="label">Canceled This Month</div><div className="val">{loading && !k ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : num(k!.canceledThisMonth)}</div>{loading && !k ? <div className="owner-skel" style={{ width: 60, height: 12, margin: '4px auto 0' }} /> : delta(k!.canceledDeltaPct) ? <div className="sub owner-text-muted">{delta(k!.canceledDeltaPct)}</div> : null}</div>
          </div>

          <div className="owner-chartcard" style={{ marginBottom: 12 }}>
            <div className="owner-sechead"><div className="h">Plans</div><div className="d">{loading && !data ? <div className="owner-skel" style={{ width: 60, height: 14, display: 'inline-block' }} /> : `${num(data!.planDistribution.length)} active`}</div></div>
            {loading && !data ? (
              <div className="owner-drill" style={{ marginTop: 10 }}>
                <OwnerSkeletonList count={3} />
              </div>
            ) : data!.planDistribution.length === 0 ? <div className="owner-text-muted" style={{ padding: '8px 2px' }}>No members enrolled yet.</div> : (
              <div className="owner-drill" style={{ marginTop: 10 }}>
                {data!.planDistribution.map((p) => (
                  <div className="owner-drillrow" key={p.planName}>
                    <div style={{ fontWeight: 600 }}>{p.planName}</div>
                    <div className="owner-text-muted">{num(p.count)} member{p.count === 1 ? '' : 's'} · {p.pct}%</div>
                    <div style={{ fontWeight: 700 }}>{money0(p.revenueCents)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="owner-chartcard">
            <div className="owner-sechead"><div className="h">Member status</div><div className="d">{loading && !k ? <div className="owner-skel" style={{ width: 60, height: 14, display: 'inline-block' }} /> : `${num(k!.totalMembers)} total`}</div></div>
            {loading && !data ? (
              <div className="owner-drill" style={{ marginTop: 10 }}>
                <OwnerSkeletonList count={3} />
              </div>
            ) : data!.statusBreakdown.length === 0 ? <div className="owner-text-muted" style={{ padding: '8px 2px' }}>No members yet.</div> : (
              <div className="owner-drill" style={{ marginTop: 10 }}>
                {data!.statusBreakdown.map((s) => (
                  <div className="owner-drillrow" key={s.status}>
                    <div style={{ fontWeight: 600 }}>{STATUS_LABEL[s.status] || s.status}</div>
                    <div className="owner-text-muted">{num(s.count)} · {s.pct}%</div>
                    <div />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
