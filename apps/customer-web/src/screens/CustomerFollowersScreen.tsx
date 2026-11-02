// CustomerFollowersScreen.tsx — list of customers who follow this profile (GET /customer/social/profile/:id/followers).
// Exports the shared FollowList used by both the followers and following screens. Each row links to the public profile
// (private rows are shown but not tappable) and carries a Follow/Following button.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { customerFollowApi, type FollowEdge } from '../api/customerFollowApi';
import { SocialAvatar } from './NailShowcaseLeaderboardCard';
import { CustomerFollowButton } from './CustomerFollowButton';

export function FollowList({ title, kind }: { title: string; kind: 'followers' | 'following' }) {
  const nav = useNavigate();
  const { customerId } = useParams();
  const [list, setList] = useState<FollowEdge[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) return;
    let live = true;
    const req = kind === 'followers' ? customerFollowApi.followers(customerId) : customerFollowApi.following(customerId);
    req.then((r) => { if (live) setList(r.entries); })
      .catch((e: { message?: string }) => { if (live) setError(e?.message || 'Could not load this list.'); });
    return () => { live = false; };
  }, [customerId, kind]);

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>{title}</h1>
      </div>

      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !list ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="cust-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="cust-skel" style={{ width: 40, height: 40, borderRadius: '50%' }} />
                <div className="cust-skel" style={{ flex: 1, height: 16 }} />
                <div className="cust-skel" style={{ width: 80, height: 32, borderRadius: 999 }} />
              </div>
            ))}
          </>
        )
        : list.length === 0 ? <div className="cust-card cust-sub" style={{ padding: 24, textAlign: 'center' }}>{kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</div>
        : list.map((f) => (
          <div key={f.customerId} className="cust-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <SocialAvatar url={f.avatarUrl} name={f.displayName} size={40} />
            <button onClick={() => f.isPublic && nav(`/social/profile/${f.customerId}`)} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', cursor: f.isPublic ? 'pointer' : 'default', padding: 0, fontWeight: 700 }}>
              {f.displayName}{!f.isPublic ? <span className="cust-sub" style={{ fontWeight: 500 }}> · Private</span> : null}
            </button>
            {f.isPublic ? <CustomerFollowButton customerId={f.customerId} following={f.isFollowing} /> : null}
          </div>
        ))}
    </div>
  );
}

export function CustomerFollowersScreen() {
  return <FollowList title="Followers" kind="followers" />;
}
