import type { NSPost, NSReactionType } from '../api/customerNailShowcaseApi';

// One nail-design card: large photo, caption, design tags, reaction + comment counts, and a Book Similar CTA. Reactions
// and navigation are delegated to the parent so the card stays presentational. Salon/tech/service currently surface as
// a "Verified Service" badge (the feed returns linkage IDs; human-name hydration is a backend follow-up).
export function NailShowcasePostCard({ post, onOpen, onReact, onBookSimilar }: {
  post: NSPost;
  onOpen: (id: string) => void;
  onReact: (id: string, reaction: NSReactionType) => void;
  onBookSimilar: (post: NSPost) => void;
}) {
  const cover = post.photos[0];
  const liked = post.myReaction === 'like';
  const disliked = post.myReaction === 'dislike';
  return (
    <div className="cust-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <button onClick={() => onOpen(post.id)} aria-label="Open nail design" style={{ border: 0, background: 'var(--customer-purple-100, #f2eefc)', padding: 0, cursor: 'pointer', position: 'relative', aspectRatio: '1 / 1', overflow: 'hidden' }}>
        {cover
          ? (cover.imageUrl.toLowerCase().match(/\.(mp4|mov|webm)$/i) || (cover.thumbnailUrl && cover.thumbnailUrl.toLowerCase().match(/\.(mp4|mov|webm)$/i)))
             ? <video src={cover.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} muted playsInline loop autoPlay />
             : <img src={cover.thumbnailUrl || cover.imageUrl} alt={post.caption || 'Nail design'} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 40 }} aria-hidden>💅</div>}
        {post.isVerifiedService
          ? <span style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(20,20,20,0.78)', color: '#fff', fontSize: 11, fontWeight: 800, padding: '4px 8px', borderRadius: 999, letterSpacing: 0.3 }}>✓ Verified Service</span>
          : null}
      </button>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {post.caption ? <div role="button" tabIndex={0} onClick={() => onOpen(post.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(post.id); } }} style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.35, cursor: 'pointer' }}>{post.caption}</div> : null}
        <div className="cust-sub" style={{ fontSize: 12 }}>{post.displayName}</div>
        {(post.salonName || post.technicianName || post.serviceName) ? (
          <div className="cust-sub" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
            {post.salonName ? <span>Done at <b style={{ fontWeight: 700, color: 'var(--customer-text, #1c1c1c)' }}>{post.salonName}</b></span> : null}
            {post.technicianName ? <span>{post.salonName ? ' · ' : ''}Tech: {post.technicianName}</span> : null}
            {post.serviceName ? <span style={{ display: 'block' }}>{post.serviceName}</span> : null}
          </div>
        ) : null}
        {post.tags?.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {post.tags.slice(0, 4).map((t) => <span key={t} style={{ fontSize: 11, fontWeight: 600, color: 'var(--customer-primary)', background: 'var(--customer-purple-100, #f2eefc)', padding: '3px 8px', borderRadius: 8 }}>{t}</span>)}
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 2 }}>
          <button onClick={() => onReact(post.id, 'like')} aria-pressed={liked} aria-label="Like" style={rxStyle(liked)}>❤️ {post.likeCount}</button>
          <button onClick={() => onReact(post.id, 'dislike')} aria-pressed={disliked} aria-label="Dislike" style={rxStyle(disliked)}>👎 {post.dislikeCount}</button>
          <button onClick={() => onOpen(post.id)} aria-label="Comments" style={rxStyle(false)}>💬 {post.commentCount}</button>
        </div>

        <button onClick={() => onBookSimilar(post)} style={{ marginTop: 4, border: 0, borderRadius: 12, background: 'var(--customer-primary)', color: '#fff', fontWeight: 800, fontSize: 13, padding: '10px 12px', cursor: 'pointer' }}>Book This Look</button>
      </div>
    </div>
  );
}

const rxStyle = (active: boolean): React.CSSProperties => ({
  border: 0, background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
  color: active ? 'var(--customer-primary)' : 'var(--customer-text-muted, #6b6b6b)', padding: 0,
});
