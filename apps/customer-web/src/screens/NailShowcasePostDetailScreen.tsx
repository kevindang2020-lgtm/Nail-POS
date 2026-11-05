import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { customerNailShowcaseApi, type NSPost, type NSComment, type NSReactionType } from '../api/customerNailShowcaseApi';

// Post detail: full photo gallery, caption/tags, like–dislike, comments (add/delete-own/report), and the Book Similar +
// Report actions. Everything is server-truth; the author can always see their own post even while pending review.
const fmt = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

export function NailShowcasePostDetailScreen() {
  const nav = useNavigate();
  const { postId = '' } = useParams();
  const [post, setPost] = useState<NSPost | null>(null);
  const [comments, setComments] = useState<NSComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const loadPost = useCallback(() => { customerNailShowcaseApi.post(postId).then(setPost).catch((e: { message?: string }) => setError(e?.message || 'Could not load this design.')); }, [postId]);
  const loadComments = useCallback(() => { customerNailShowcaseApi.comments(postId).then((r) => setComments(Array.isArray(r) ? r : r.comments)).catch(() => setComments([])); }, [postId]);
  useEffect(() => { loadPost(); loadComments(); }, [loadPost, loadComments]);

  const react = async (reaction: NSReactionType) => { try { await customerNailShowcaseApi.react(postId, reaction); loadPost(); } catch { /* */ } };
  const submitComment = async () => {
    const text = draft.trim(); if (!text || busy) return; setBusy(true);
    try { await customerNailShowcaseApi.addComment(postId, text); setDraft(''); loadComments(); loadPost(); }
    catch (e) { setError((e as { message?: string })?.message || 'Could not post comment.'); }
    finally { setBusy(false); }
  };
  const deleteComment = async (id: string) => { try { await customerNailShowcaseApi.deleteComment(id); loadComments(); loadPost(); } catch { /* */ } };
  const reportComment = async (id: string) => { try { await customerNailShowcaseApi.reportComment(id, 'inappropriate'); } catch { /* */ } };
  const reportPost = async () => { try { await customerNailShowcaseApi.reportPost(postId, 'inappropriate'); } catch { /* */ } };
  const deletePost = async () => { try { await customerNailShowcaseApi.deletePost(postId); nav('/nail-showcase'); } catch { /* */ } };
  const bookSimilar = () => { const q = new URLSearchParams(); if (post?.serviceId) q.set('serviceId', post.serviceId); if (post?.technicianId) q.set('technicianId', post.technicianId); nav(`/book${q.toString() ? `?${q}` : ''}`); };

  if (error && !post) return <div style={{ padding: 18 }}><button onClick={() => nav(-1)} style={backBtn}>‹</button><div className="cust-card" style={{ padding: 14, marginTop: 12, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div></div>;
  if (!post) return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={backBtn}>‹</button>
        <div className="cust-skel" style={{ width: 100, height: 20 }} />
      </div>
      <div className="cust-skel" style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 16 }} />
      <div className="cust-skel" style={{ width: '80%', height: 18, marginTop: 8 }} />
      <div className="cust-skel" style={{ width: '40%', height: 14 }} />
      <div className="cust-skel" style={{ width: '100%', height: 80, borderRadius: 12 }} />
      <div style={{ display: 'flex', gap: 18 }}>
        <div className="cust-skel" style={{ width: 60, height: 24, borderRadius: 8 }} />
        <div className="cust-skel" style={{ width: 60, height: 24, borderRadius: 8 }} />
        <div className="cust-skel" style={{ width: 60, height: 24, borderRadius: 8 }} />
      </div>
      <div className="cust-skel" style={{ width: '100%', height: 44, borderRadius: 12 }} />
    </div>
  );

  const liked = post.myReaction === 'like', disliked = post.myReaction === 'dislike';
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={backBtn}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 18 }}>Nail Design</h1>
        {post.isVerifiedService ? <span style={{ marginLeft: 'auto', background: 'rgba(20,20,20,0.85)', color: '#fff', fontSize: 11, fontWeight: 800, padding: '4px 8px', borderRadius: 999 }}>✓ Verified Service</span> : null}
      </div>

      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', borderRadius: 16 }}>
        {post.photos.length ? post.photos.map((ph) => {
          const isVid = ph.imageUrl.toLowerCase().match(/\.(mp4|mov|webm)$/i) || (ph.thumbnailUrl && ph.thumbnailUrl.toLowerCase().match(/\.(mp4|mov|webm)$/i));
          const style = { width: post.photos.length > 1 ? '82%' : '100%', flexShrink: 0, aspectRatio: '1 / 1', objectFit: 'cover' as any, borderRadius: 16, background: 'var(--customer-purple-100, #f2eefc)' };
          return isVid
            ? <video key={ph.id} src={ph.imageUrl} style={style} controls playsInline />
            : <img key={ph.id} src={ph.imageUrl} alt={ph.caption || post.caption || 'Nail design'} style={style} />;
        }) : <div className="cust-card" style={{ width: '100%', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44 }} aria-hidden>💅</div>}
      </div>

      {post.caption ? <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.4 }}>{post.caption}</div> : null}
      <div className="cust-sub" style={{ fontSize: 13 }}>{post.displayName} · {fmt(post.createdAt)}</div>
      {(post.salonName || post.technicianName || post.serviceName) ? (
        <div className="cust-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {post.salonName ? <div style={{ fontSize: 13 }}>Done at <b style={{ fontWeight: 700 }}>{post.salonName}</b></div> : null}
          {post.technicianName ? <div className="cust-sub" style={{ fontSize: 13 }}>Tech: {post.technicianName}</div> : null}
          {post.serviceName ? <div className="cust-sub" style={{ fontSize: 13 }}>Service: {post.serviceName}</div> : null}
        </div>
      ) : null}
      {post.tags?.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{post.tags.map((t) => <span key={t} style={{ fontSize: 12, fontWeight: 600, color: 'var(--customer-primary)', background: 'var(--customer-purple-100, #f2eefc)', padding: '4px 10px', borderRadius: 8 }}>{t}</span>)}</div> : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '4px 0' }}>
        <button onClick={() => react('like')} aria-pressed={liked} style={rx(liked)}>❤️ {post.likeCount}</button>
        <button onClick={() => react('dislike')} aria-pressed={disliked} style={rx(disliked)}>👎 {post.dislikeCount}</button>
        <span style={{ ...rx(false), color: 'var(--customer-text-muted, #6b6b6b)' }}>💬 {post.commentCount}</span>
      </div>

      <button onClick={bookSimilar} style={{ border: 0, borderRadius: 12, background: 'var(--customer-primary)', color: '#fff', fontWeight: 800, fontSize: 14, padding: '12px', cursor: 'pointer' }}>Book This Look</button>

      <div style={{ height: 1, background: 'var(--customer-border, #ece8f3)', margin: '4px 0' }} />

      <h2 className="cust-h2" style={{ fontSize: 15 }}>Comments</h2>
      {post.allowComments ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a comment…" onKeyDown={(e) => { if (e.key === 'Enter') submitComment(); }}
            style={{ flex: 1, border: '1px solid var(--customer-border, #e6e1ef)', borderRadius: 12, padding: '10px 12px', fontSize: 14 }} />
          <button onClick={submitComment} disabled={busy || !draft.trim()} style={{ border: 0, borderRadius: 12, background: 'var(--customer-primary)', color: '#fff', fontWeight: 800, padding: '0 16px', cursor: 'pointer', opacity: busy || !draft.trim() ? 0.5 : 1 }}>Post</button>
        </div>
      ) : <div className="cust-sub" style={{ fontSize: 13 }}>Comments are turned off for this post.</div>}

      {!comments ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2].map(i => (
            <div key={i} className="cust-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div className="cust-skel" style={{ width: 100, height: 14 }} />
                <div className="cust-skel" style={{ width: 60, height: 12 }} />
              </div>
              <div className="cust-skel" style={{ width: '100%', height: 16 }} />
            </div>
          ))}
        </div>
      )
        : comments.length === 0 ? <div className="cust-sub" style={{ fontSize: 13 }}>No comments yet.</div>
        : comments.map((c) => (
            <div key={c.id} className="cust-card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{c.displayName}</span>
                <span className="cust-sub" style={{ fontSize: 11 }}>{fmt(c.createdAt)}</span>
              </div>
              <div style={{ fontSize: 14, marginTop: 4 }}>{c.commentText}</div>
              <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                {c.isMine
                  ? <button onClick={() => deleteComment(c.id)} style={linkBtn}>Delete</button>
                  : <button onClick={() => reportComment(c.id)} style={linkBtn}>Report</button>}
              </div>
            </div>
          ))}

      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        {post.isMine ? <button onClick={deletePost} style={linkBtn}>Delete post</button> : <button onClick={reportPost} style={linkBtn}>Report post</button>}
      </div>
    </div>
  );
}

const backBtn: React.CSSProperties = { border: 0, background: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--customer-text)' };
const linkBtn: React.CSSProperties = { border: 0, background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--customer-text-muted, #6b6b6b)', padding: 0 };
const rx = (active: boolean): React.CSSProperties => ({ border: 0, background: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 800, color: active ? 'var(--customer-primary)' : 'var(--customer-text, #1c1c1c)', padding: 0 });
