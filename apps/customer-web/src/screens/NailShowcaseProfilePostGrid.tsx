// NailShowcaseProfilePostGrid.tsx — a public profile's NailShowcase posts as a 3-up thumbnail grid
// (GET /customer/social/profile/:id/posts). The server only returns posts that are visible to the viewer, so nothing
// private leaks here. Tapping a tile opens the existing post detail screen.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerSocialApi, type ProfilePostCard } from '../api/customerSocialApi';

export function NailShowcaseProfilePostGrid({ customerId }: { customerId: string }) {
  const nav = useNavigate();
  const [posts, setPosts] = useState<ProfilePostCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    customerSocialApi.profilePosts(customerId)
      .then((r) => { if (live) setPosts(r.posts); })
      .catch((e: { message?: string }) => { if (live) setError(e?.message || 'Could not load posts.'); });
    return () => { live = false; };
  }, [customerId]);

  if (error) return <div className="cust-sub" style={{ fontSize: 13 }}>{error}</div>;
  if (!posts) return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>{[0, 1, 2].map((i) => <div key={i} className="cust-skel" style={{ aspectRatio: '1 / 1', borderRadius: 12 }} />)}</div>;
  if (posts.length === 0) return <div className="cust-sub" style={{ fontSize: 13, padding: '8px 0' }}>No public posts yet.</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {posts.map((p) => (
        <button key={p.postId} onClick={() => nav(`/nail-showcase/${p.postId}`)} title={p.caption || undefined}
          style={{ border: 0, padding: 0, borderRadius: 12, overflow: 'hidden', cursor: 'pointer', background: 'var(--customer-primary-light, #efeaf6)', aspectRatio: '1 / 1' }}>
          {p.thumbnailUrl
            ? (
              p.thumbnailUrl.toLowerCase().match(/\.(mp4|mov|webm)$/i)
                ? <video src={p.thumbnailUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline loop autoPlay />
                : <img src={p.thumbnailUrl} alt={p.caption || 'nail post'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )
            : <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 24 }}>💅</div>}
        </button>
      ))}
    </div>
  );
}
