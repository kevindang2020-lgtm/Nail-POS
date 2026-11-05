// RateTechScreen.tsx — P4 rating-after-service: 1–5 stars, whitelist tags, optional text, verified server-side
// against the paid ticket. Doc-exact prompt + thank-you copy.
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { customerApi, type MyTechRating } from '../api/customerApi';

const TAGS = ['Clean Work', 'Friendly', 'Fast', 'Beautiful Design', 'Great Shape', 'Good Color Match', 'On Time', 'Would Book Again'];

export function RateTechScreen() {
  const { ticketId, technicianId } = useParams();
  const [sp] = useSearchParams();
  const techName = sp.get('name') || 'your technician';
  const nav = useNavigate();
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Extract<MyTechRating, { exists: true }> | null>(null); // 7-day edit window (doc rule)
  const [faved, setFaved] = useState(false);

  useEffect(() => {
    if (!ticketId || !technicianId) return;
    customerApi.myTechRating(ticketId, technicianId).then((r) => {
      if (r.exists) { setExisting(r); setStars(r.rating); setTags(r.tags || []); setText(r.reviewText || ''); }
    }).catch(() => { /* fresh rating */ });
  }, [ticketId, technicianId]);

  const toggle = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const submit = async () => {
    if (!ticketId || !technicianId || stars < 1) return;
    setBusy(true); setError(null);
    try {
      const r = existing
        ? await customerApi.updateTechRating(ticketId, existing.ratingId, { rating: stars, reviewText: text.trim() || undefined, tags })
        : await customerApi.submitTechRating(ticketId, { technicianId, rating: stars, reviewText: text.trim() || undefined, tags, isPublic: true });
      setDone(r.message);
    } catch (e: any) { setError(e?.message || 'Could not submit your rating.'); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div style={{ padding: 16 }}>
        <div className="cust-card" style={{ padding: 22, textAlign: 'center' }}>
          <div style={{ fontSize: 34 }}>💛</div>
          <div style={{ fontWeight: 800, fontSize: 16, margin: '8px 0' }}>{done}</div>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <button className="cust-btn" onClick={() => nav(`/book?techId=${technicianId}`)}>Book again with {techName}</button>
            {ticketId ? <button className="cust-btn ghost" onClick={() => nav(`/nail-showcase/share/${ticketId}`)}>✨ Share your nails</button> : null}
            <button className="cust-btn ghost" disabled={faved} onClick={async () => { try { await customerApi.addTechFavorite({ technicianId: technicianId! }); setFaved(true); } catch { /* ignore */ } }}>{faved ? '♥ Favorited' : '♡ Favorite this tech'}</button>
            <button className="cust-btn ghost" onClick={() => nav('/')}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, paddingBottom: 90 }}>
      <h1 style={{ margin: '4px 0 12px', fontSize: 19 }}>How was your service with {techName}?</h1>
      {existing ? <div className="cust-sub" style={{ fontSize: 12.5, marginBottom: 10 }} role="status">{existing.editable ? 'You already rated this visit — you can update it within 7 days.' : 'This rating can no longer be edited (7-day window).'}</div> : null}
      <div className="cust-card" style={{ padding: 16 }}>
        <div role="radiogroup" aria-label="Rating" style={{ display: 'flex', justifyContent: 'center', gap: 8, fontSize: 34, marginBottom: 12 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setStars(n)}
              style={{ border: 0, background: 'none', cursor: 'pointer', color: n <= stars ? '#C9962E' : '#E2D7C2', fontSize: 34, padding: 2 }}>★</button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {TAGS.map((t) => (
            <button key={t} onClick={() => toggle(t)} aria-pressed={tags.includes(t)}
              style={{ fontSize: 12, fontWeight: tags.includes(t) ? 800 : 500, color: tags.includes(t) ? '#fff' : '#A96F22', background: tags.includes(t) ? '#A96F22' : '#F7EFE3', border: '1px solid #E6D3B3', borderRadius: 99, padding: '6px 12px', cursor: 'pointer' }}>{t}</button>
          ))}
        </div>
        <textarea placeholder="Write a review (optional)" rows={4} value={text} onChange={(e) => setText(e.target.value)}
          style={{ width: '100%', border: '1px solid var(--customer-border)', borderRadius: 12, padding: 10, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
        {error ? <div className="cust-sub" style={{ color: 'var(--customer-red)', fontSize: 12.5, marginTop: 8 }} role="alert">{error}</div> : null}
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <button className="cust-btn" disabled={busy || stars < 1 || (!!existing && !existing.editable)} onClick={submit}>{busy ? '…' : existing ? 'Update Rating' : 'Submit Rating'}</button>
          <button className="cust-btn ghost" onClick={() => nav('/')}>Skip</button>
        </div>
      </div>
    </div>
  );
}
