import { useCallback, useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { useOwnerNav } from '../shell/nav';
import { ownerMarketingApi, type OwnerMarketingOverviewResp } from '../api/ownerApi';
import { OwnerSkeletonBlocks, OwnerSkeletonCards, OwnerSkeletonList } from '../components/OwnerSkeleton';

// Marketing & Growth — Module 9 (read surface). Campaign performance + channel mix + referrals, aggregated over the
// canonical campaigns (reusing the campaigns module's KPI math), scoped to the owner's branches plus tenant-wide
// campaigns. Referrals are a count only — no conversion figure is shown because there is no conversion schema.

const money0 = (c: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((c || 0) / 100);
const num = (v: number): string => new Intl.NumberFormat('en-US').format(v || 0);
const CHANNEL_LABEL: Record<string, string> = { sms: 'SMS', email: 'Email', push: 'Push' };
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
function statusColor(s: string): string {
  if (s === 'in_progress') return 'var(--owner-success)';
  if (s === 'scheduled') return 'var(--owner-primary)';
  if (s === 'cancelled') return 'var(--owner-danger)';
  return 'var(--owner-text-secondary)';
}

export function MarketingGrowthScreen() {
  const { back } = useOwnerNav();
  const { effectiveBranchId } = useOwnerBranch();
  const [data, setData] = useState<OwnerMarketingOverviewResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    ownerMarketingApi.overview(effectiveBranchId)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: any) => { setError(e?.message || 'Could not load marketing.'); setLoading(false); });
  }, [effectiveBranchId]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Marketing &amp; Growth</div></div>
        <div style={{ width: 40 }} />
      </header>

      {error && <div className="owner-state" role="alert">{error}</div>}
      {loading && <OwnerSkeletonCards count={3} />}

      {data && (
        <div style={{ padding: '6px 16px 24px' }}>
          <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
            <div className="owner-kpi"><div className="label">Active Campaigns</div><div className="val">{num(data.kpis.activeCampaigns)}</div><div className="sub owner-text-muted">{num(data.kpis.totalCampaigns)} total</div></div>
            <div className="owner-kpi"><div className="label">Revenue</div><div className="val">{money0(data.kpis.campaignRevenueCents)}</div><div className="sub owner-text-muted">cost {money0(data.kpis.campaignCostCents)}</div></div>
            <div className="owner-kpi"><div className="label">ROI</div><div className="val">{data.kpis.roi.toFixed(1)}×</div></div>
          </div>

          <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
            <div className="owner-kpi"><div className="label">Open Rate</div><div className="val">{data.kpis.openRatePercent}%</div></div>
            <div className="owner-kpi"><div className="label">Click Rate</div><div className="val">{data.kpis.clickRatePercent}%</div></div>
            <div className="owner-kpi"><div className="label">Conversion</div><div className="val">{data.kpis.conversionRatePercent}%</div></div>
          </div>

          <div className="owner-kpigrid" style={{ marginBottom: 14 }}>
            <div className="owner-kpi"><div className="label">Messages Sent</div><div className="val">{num(data.kpis.totalSent)}</div></div>
            <div className="owner-kpi"><div className="label">Referral Codes</div><div className="val">{num(data.kpis.referrals)}</div></div>
          </div>

          {data.channels.length > 0 && (
            <>
              <div className="owner-sechead"><div className="h">By Channel</div><div className="d">revenue</div></div>
              <div className="owner-drill" style={{ marginBottom: 12 }}>
                {data.channels.map((c) => (
                  <div className="owner-drillrow" key={c.channel}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{CHANNEL_LABEL[c.channel] ?? c.channel}</div>
                      <div className="owner-text-muted" style={{ fontSize: 12 }}>{num(c.campaigns)} campaign{c.campaigns === 1 ? '' : 's'} · {num(c.sent)} sent</div>
                    </div>
                    <div style={{ fontWeight: 700, marginLeft: 10 }}>{money0(c.revenueCents)}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="owner-sechead"><div className="h">Top Campaigns</div><div className="d">by revenue</div></div>
          {data.topCampaigns.length === 0 ? <div className="owner-state">No campaigns yet.</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.topCampaigns.map((c) => (
                  <div className="owner-chartcard" key={c.id} style={{ padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>{c.name}</div>
                        <div className="owner-text-muted" style={{ fontSize: 12 }}>{CHANNEL_LABEL[c.channel] ?? c.channel}{c.audienceLabel ? ` · ${c.audienceLabel}` : ''} · {num(c.sent)} sent</div>
                      </div>
                      <div className="owner-pill" style={{ color: statusColor(c.status), borderColor: statusColor(c.status), fontSize: 11, whiteSpace: 'nowrap' }}>{STATUS_LABEL[c.status] ?? c.status}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12 }}>
                      <span><span className="owner-text-muted">Open</span> <b>{c.openRate}%</b></span>
                      <span><span className="owner-text-muted">Click</span> <b>{c.clickRate}%</b></span>
                      <span><span className="owner-text-muted">Conv</span> <b>{c.bookingRate}%</b></span>
                      <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{money0(c.revenueCents)} · {c.roi.toFixed(1)}×</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </>
  );
}
