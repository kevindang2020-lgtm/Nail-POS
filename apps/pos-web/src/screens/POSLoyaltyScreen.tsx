// POSLoyaltyScreen.tsx — Customers → Loyalty & Rewards. Wired to GET /pos/loyalty/state
// (permission-gated pos.customers.view). Program-wide member points, tiers, rewards, redemptions.
// Rewards catalog editing (Oct 2 2026): components/RewardsCatalogPanel, owners / managers only.
import { useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posLoyaltyApi } from '../api/posLoyaltyApi';
import { reportError } from './reportsCommon';
import { RewardsCatalogPanel } from '../components/RewardsCatalogPanel';
import { useCan } from '../components/usePermissions';
import type { LoyaltyRewardRow } from '../api/posLoyaltyApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

type Summary = { memberCount: number; pointsOutstanding: number; totalEarnedPoints: number; totalRedeemedPoints: number; activeRewards: number; redemptionCount: number; pointsRedeemed: number };
type Tier = { tier: string; members: number; points: number };
type Reward = LoyaltyRewardRow;
type Redemption = { id: string; customerId: string; rewardTitle: string; pointsSpent: number; createdAt: string };
type State = { kpis: Summary; tiers: Tier[]; rewards: Reward[]; recentRedemptions: Redemption[] };

const pts = (n: number) => (n || 0).toLocaleString('en-US');
const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };

export function POSLoyaltyScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const canManage = useCan()('settings.edit');   // Decision 15: owners / managers manage the rewards catalog

  useEffect(() => {
    let alive = true; if (reload === 0) setLoading(true); setError(null);   // a reload after a save keeps the screen
    (async () => {
      try { const d = await posLoyaltyApi.state() as State; if (alive) setS(d); }
      catch (e: any) { if (alive) setError(reportError(e, tx('admin.loyalty.noun'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [reload]);

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_loyalty_program')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.no_loyalty_data')}</div></div>;

  const k = s.kpis;
  const tiers = s.tiers || [];
  const rewards = s.rewards || [];
  const redemptions = s.recentRedemptions || [];
  const maxTier = Math.max(1, ...tiers.map((t) => t.members));

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{tx('pos.loyalty_rewards')}</h1><div className="sub">{tx('pos.program_members_points_outstanding_and_rewards')}</div></div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{tx('pos.members')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{pts(k.memberCount)}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{tx('pos.points_outstanding')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{pts(k.pointsOutstanding)}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{tx('pos.active_rewards')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{pts(k.activeRewards)}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{tx('pos.redemptions')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{pts(k.redemptionCount)}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{tx('pos.points_redeemed')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{pts(k.pointsRedeemed)}</div></div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <section className="panel">
          <div className="p-h">{tx('pos.members_by_tier')}</div>
          {tiers.length === 0 ? <div className="state">{tx('pos.no_members_enrolled_yet')}</div> : (
            <div className="bars" role="img" aria-label={tx('pos.members_by_tier_2')}>
              {tiers.map((t) => (
                <div className="bar-col" key={t.tier} title={tx('pos.tier_members_members_points_pts', { tier: String(t.tier), members: String(t.members), points: String(pts(t.points)) })}>
                  <div className="bar" style={{ height: `${Math.max(2, Math.round((t.members / maxTier) * 140))}px` }} />
                  <div className="bar-l">{t.tier}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        <RewardsCatalogPanel rewards={rewards} canManage={canManage} onChanged={() => setReload((n) => n + 1)} />
      </div>
      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{tx('pos.recent_redemptions')}</div>
        {redemptions.length === 0 ? <div className="state" style={{ padding: 16 }}>{tx('pos.no_redemptions_yet')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[500px]">
              <table className="tbl">
                <thead><tr><th>{tx('pos.reward')}</th><th style={{ textAlign: 'right' }}>{tx('pos.points_spent')}</th><th>{tx('pos.date')}</th></tr></thead>
                <tbody>{redemptions.map((r) => (
                  <tr key={r.id}><td>{r.rewardTitle || '—'}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{pts(r.pointsSpent)}</td><td>{fmtDate(r.createdAt)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
