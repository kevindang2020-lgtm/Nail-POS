import { bookThisLookTarget } from '../lib/bookThisLook';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerNailShowcaseApi, type NSPostView, type NSReactionType, type NSFeedSort, type NSFeedScope } from '../api/customerNailShowcaseApi';
import { NailShowcasePostCard } from './NailShowcasePostCard';

// NailShowcase — Fresh Nail Designs feed. Real posts from /customer/nail-showcase/feed (server-scoped by visibility +
// tenant). Sort + scope filters map straight to the backend query. Empty/error/loading states are honest — no mock posts.
const SCOPES: { key: NSFeedScope; label: string }[] = [
  { key: 'for_you', label: 'For You' }, { key: 'salon', label: 'My Salon' }, { key: 'public', label: 'Public' }, { key: 'mine', label: 'My Posts' },
];
const SORTS: { key: NSFeedSort; label: string }[] = [
  { key: 'newest', label: 'Newest' }, { key: 'most_liked', label: 'Most Liked' }, { key: 'most_commented', label: 'Most Commented' }, { key: 'trending', label: 'Trending' },
];

export function NailShowcaseFeedScreen() {
  const nav = useNavigate();
  const [scope, setScope] = useState<NSFeedScope>('for_you');
  const [sort, setSort] = useState<NSFeedSort>('newest');
  const [posts, setPosts] = useState<NSPostView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setPosts(null); setError(null);
    let live = true;
    customerNailShowcaseApi.feed({ scope, sort, limit: 30 })
      .then((r) => { if (live) setPosts(r.posts); })
      .catch((e: { message?: string }) => { if (live) setError(e?.message || 'Could not load the feed.'); });
    return () => { live = false; };
  }, [scope, sort]);
  useEffect(() => load(), [load]);

  const react = async (id: string, reaction: NSReactionType) => {
    try {
      await customerNailShowcaseApi.react(id, reaction);
      const updated = await customerNailShowcaseApi.post(id);
      setPosts((ps) => (ps ? ps.map((p) => (p.id === id ? updated : p)) : ps));
    } catch { /* keep prior state on failure */ }
  };
  const bookSimilar = (post: NSPostView) => { const t = bookThisLookTarget(post); nav(t.path, { state: t.state }); };   // §47

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <h1 className="cust-h1" style={{ fontSize: 22 }}>Fresh Nail Designs</h1>
        <button onClick={() => nav('/nail-showcase/create')} style={{ border: 0, borderRadius: 999, background: 'var(--customer-primary)', color: '#fff', fontWeight: 800, fontSize: 13, padding: '9px 14px', cursor: 'pointer' }}>+ Share</button>
      </div>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        <Chip active={false} label="🏆 Rankings" onClick={() => nav('/nail-showcase/leaderboard')} />
        <Chip active={false} label="My Profile" onClick={() => nav('/social/me')} />
        <Chip active={false} label="Following" onClick={() => nav('/social/following-feed')} />
      </div>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {SCOPES.map((s) => <Chip key={s.key} active={scope === s.key} label={s.label} onClick={() => setScope(s.key)} />)}
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {SORTS.map((s) => <Chip key={s.key} active={sort === s.key} label={s.label} subtle onClick={() => setSort(s.key)} />)}
      </div>

      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !posts ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="cust-skel" style={{ aspectRatio: '1 / 1.1', borderRadius: 16 }} />
                <div className="cust-skel" style={{ width: '80%', height: 14, borderRadius: 4 }} />
                <div className="cust-skel" style={{ width: '50%', height: 12, borderRadius: 4 }} />
              </div>
            ))}
          </div>
        )
        : posts.length === 0 ? (
          <div className="cust-card" style={{ padding: 28, textAlign: 'center' }}>
            <div aria-hidden style={{ fontSize: 34 }}>💅</div>
            <h2 className="cust-h2" style={{ marginTop: 8 }}>No designs here yet</h2>
            <div className="cust-sub" style={{ marginTop: 4 }}>Be the first to share your nails after your next visit.</div>
            <button onClick={() => nav('/nail-showcase/create')} style={{ marginTop: 14, border: 0, borderRadius: 12, background: 'var(--customer-primary)', color: '#fff', fontWeight: 800, padding: '10px 18px', cursor: 'pointer' }}>Share Your Nails</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {posts.map((p) => <NailShowcasePostCard key={p.id} post={p} onOpen={(id) => nav(`/nail-showcase/${id}`)} onReact={react} onBookSimilar={bookSimilar} />)}
          </div>
        )}
    </div>
  );
}

function Chip({ active, label, onClick, subtle }: { active: boolean; label: string; onClick: () => void; subtle?: boolean }) {
  return (
    <button onClick={onClick} style={{
      border: active ? 0 : '1px solid var(--customer-border, #e6e1ef)', borderRadius: 999, whiteSpace: 'nowrap', cursor: 'pointer',
      fontSize: 13, fontWeight: 700, padding: '7px 14px',
      background: active ? (subtle ? 'var(--customer-text, #1c1c1c)' : 'var(--customer-primary)') : 'transparent',
      color: active ? '#fff' : 'var(--customer-text-muted, #6b6b6b)',
    }}>{label}</button>
  );
}
