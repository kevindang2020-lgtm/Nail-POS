// NailShowcaseMyRankCard.tsx — the signed-in customer's own NailShowcase standing (GET /customer/nail-showcase/me/rank).
// Three honest states: private (not ranked, prompt to go public), public-but-unranked (no eligible posts yet), and ranked
// (rank + tier + score + engagement breakdown). No fabricated numbers — everything comes from the server.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { customerNailShowcaseLeaderboardApi, type MyRank } from '../api/customerNailShowcaseLeaderboardApi';
import { rankTier } from './NailShowcaseRankBadge';

export function NailShowcaseMyRankCard() {
  const [rank, setRank] = useState<MyRank | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    customerNailShowcaseLeaderboardApi.myRank()
      .then((r) => { if (live) setRank(r); })
      .catch((e: { message?: string }) => { if (live) setError(e?.message || 'Could not load your rank.'); });
    return () => { live = false; };
  }, []);

  if (error) return <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>;
  if (!rank) return (
    <div className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 66, gap: 6 }}>
        <div className="cust-skel" style={{ width: 44, height: 30 }} />
        <div className="cust-skel" style={{ width: 50, height: 16, borderRadius: 999 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="cust-skel" style={{ width: 120, height: 14 }} />
        <div className="cust-skel" style={{ width: 100, height: 20 }} />
        <div className="cust-skel" style={{ width: 180, height: 14 }} />
        <div className="cust-skel" style={{ width: 100, height: 14, marginTop: 4 }} />
      </div>
    </div>
  );

  if (!rank.isPublic) {
    return (
      <div className="cust-card" style={{ padding: 16 }}>
        <div className="cust-label">My NailShowcase Rank</div>
        <div style={{ marginTop: 6, fontWeight: 800 }}>Your profile is private</div>
        <div className="cust-sub" style={{ fontSize: 13, marginTop: 2 }}>Make it public to appear in NailShowcase rankings.</div>
        <Link to="/social/edit" style={{ color: 'var(--customer-primary)', fontWeight: 700, textDecoration: 'none', display: 'inline-block', marginTop: 10 }}>Profile Visibility →</Link>
      </div>
    );
  }

  if (!rank.ranked || rank.rank == null) {
    return (
      <div className="cust-card" style={{ padding: 16 }}>
        <div className="cust-label">My NailShowcase Rank</div>
        <div style={{ marginTop: 6, fontWeight: 800 }}>Not ranked yet</div>
        <div className="cust-sub" style={{ fontSize: 13, marginTop: 2 }}>{rank.reason || 'Share nail posts and earn likes and comments to climb the rankings.'}</div>
        <div style={{ fontSize: 12, marginTop: 8 }}>Score: {rank.score.toLocaleString()} · ❤️ {rank.likesCount} · 💬 {rank.commentsCount} · 👎 {rank.dislikesCount}</div>
      </div>
    );
  }

  const tier = rankTier(rank.rank);
  return (
    <div className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ textAlign: 'center', minWidth: 66 }}>
        <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--customer-primary)', lineHeight: 1 }}>#{rank.rank}</div>
        {tier ? <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--customer-primary)', borderRadius: 999, padding: '2px 8px' }}>{tier}</span> : null}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="cust-label">My NailShowcase Rank</div>
        <div style={{ fontWeight: 800, fontSize: 18, marginTop: 2 }}>Score: {rank.score.toLocaleString()}</div>
        <div style={{ fontSize: 13, marginTop: 2 }}>❤️ {rank.likesCount}   💬 {rank.commentsCount}   👎 {rank.dislikesCount}   · {rank.postsCount} posts</div>
        <Link to="/social/me" style={{ color: 'var(--customer-primary)', fontWeight: 700, textDecoration: 'none', display: 'inline-block', marginTop: 8, fontSize: 13 }}>View my profile →</Link>
      </div>
    </div>
  );
}
