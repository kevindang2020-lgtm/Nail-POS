// NailShowcaseFollowingFeedScreen.tsx — recent NailShowcase posts from the creators the customer follows
// (GET /customer/social/me/following-feed). Empty state nudges them to follow creators from the rankings.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerFollowApi, type FollowingFeedItem } from '../api/customerFollowApi';
import { SocialAvatar } from './NailShowcaseLeaderboardCard';

export function NailShowcaseFollowingFeedScreen() {
  const nav = useNavigate();
  const [items, setItems] = useState<FollowingFeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    customerFollowApi.followingFeed()
      .then((r) => { if (live) setItems(r.items); })
      .catch((e: { message?: string }) => { if (live) setError(e?.message || 'Could not load your following feed.'); });
    return () => { live = false; };
  }, []);

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Following</h1>
      </div>

      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !items ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2].map((i) => (
              <div key={i} className="cust-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="cust-skel" style={{ width: 34, height: 34, borderRadius: '50%' }} />
                  <div className="cust-skel" style={{ width: 100, height: 16 }} />
                </div>
                <div className="cust-skel" style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 12 }} />
                <div className="cust-skel" style={{ width: '60%', height: 14 }} />
                <div className="cust-skel" style={{ width: 80, height: 12 }} />
              </div>
            ))}
          </div>
        )
        : items.length === 0 ? (
          <div className="cust-card" style={{ padding: 28, textAlign: 'center' }}>
            <div aria-hidden style={{ fontSize: 34 }}>👀</div>
            <h2 className="cust-h2" style={{ marginTop: 8 }}>Nothing here yet</h2>
            <div className="cust-sub" style={{ marginTop: 4 }}>Follow creators from the rankings to see their latest nail posts here.</div>
            <button onClick={() => nav('/nail-showcase/leaderboard')} style={{ marginTop: 14, border: 0, borderRadius: 12, background: 'var(--customer-primary)', color: '#fff', fontWeight: 800, padding: '10px 18px', cursor: 'pointer' }}>See Top Creators</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((it) => (
              <div key={it.postId} className="cust-card" style={{ padding: 12 }}>
                <button onClick={() => nav(`/social/profile/${it.customerId}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, border: 0, background: 'none', cursor: 'pointer', padding: 0, marginBottom: 10 }}>
                  <SocialAvatar url={it.avatarUrl} name={it.displayName} size={34} />
                  <span style={{ fontWeight: 700 }}>{it.displayName}</span>
                </button>
                <button onClick={() => nav(`/nail-showcase/${it.postId}`)} style={{ border: 0, padding: 0, background: 'none', cursor: 'pointer', display: 'block', width: '100%' }}>
                  {it.thumbnailUrl ? (
                    it.thumbnailUrl.toLowerCase().match(/\.(mp4|mov|webm)$/i)
                      ? <video src={it.thumbnailUrl} style={{ width: '100%', borderRadius: 12, objectFit: 'cover', aspectRatio: '1 / 1' }} muted playsInline loop autoPlay />
                      : <img src={it.thumbnailUrl} alt={it.caption || 'nail post'} style={{ width: '100%', borderRadius: 12, objectFit: 'cover', aspectRatio: '1 / 1' }} />
                  ) : <div style={{ aspectRatio: '1 / 1', borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--customer-primary-light, #efeaf6)', fontSize: 30 }}>💅</div>}
                  {it.caption ? <div style={{ textAlign: 'left', fontSize: 13, marginTop: 6 }}>{it.caption}</div> : null}
                </button>
                <div style={{ fontSize: 12, marginTop: 6 }}>❤️ {it.likeCount}   💬 {it.commentCount}</div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
