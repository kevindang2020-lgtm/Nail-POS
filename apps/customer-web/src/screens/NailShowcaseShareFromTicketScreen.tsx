import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { customerNailShowcaseApi, type NSEligibility } from '../api/customerNailShowcaseApi';

// Share My Nails (verified) — create a Verified Service post tied to a completed ticket. Checks eligibility first
// (paid + owned + not already shared); the salon/technician/service are derived from the ticket server-side, so this
// form only collects caption, tags, anonymity, and photos. On success the post carries the "Verified Service" badge.
const TAGS = ['French Tips', 'Gel X', 'Acrylic', 'Chrome', 'Ombre', '3D Nail Art', 'Short Nails', 'Long Nails', 'Wedding', 'Natural Look', 'Cat Eye', 'Builder Gel', 'Dip Powder', 'Pedicure', 'Simple Design', 'Luxury Design', 'Holiday Nails'];
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024, MAX_PHOTOS = 10;

export function NailShowcaseShareFromTicketScreen() {
  const nav = useNavigate();
  const { ticketId = '' } = useParams();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [elig, setElig] = useState<NSEligibility | null>(null);
  const [eligError, setEligError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [anonymous, setAnonymous] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => { previews.forEach((u) => URL.revokeObjectURL(u)); }, [previews]);

  const check = useCallback(() => {
    customerNailShowcaseApi.eligibility(ticketId)
      .then(setElig)
      .catch((e: { message?: string }) => setEligError(e?.message || 'Could not check eligibility.'));
  }, [ticketId]);
  useEffect(() => check(), [check]);

  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= 8 ? cur : [...cur, t]));
  const pick = (list: FileList | null) => {
    if (!list) return; setError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!ALLOWED.includes(f.type)) { setError(`${f.name}: use JPG, PNG, or WEBP.`); continue; }
      if (f.size > MAX_BYTES) { setError(`${f.name}: exceeds 10MB.`); continue; }
      if (next.length >= MAX_PHOTOS) { setError(`Up to ${MAX_PHOTOS} photos.`); break; }
      next.push(f);
    }
    setFiles(next);
  };
  const removeAt = (i: number) => setFiles((cur) => cur.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (busy) return;
    if (!files.length) { setError('Add at least one photo of your nails.'); return; }
    setBusy(true); setError(null);
    try {
      const post = await customerNailShowcaseApi.createVerifiedPost(ticketId, { caption: caption.trim() || undefined, tags, visibility: 'salon_only', allowComments: true, isAnonymous: anonymous });
      await customerNailShowcaseApi.uploadPhotos(post.id, files);
      nav(`/nail-showcase/${post.id}`);
    } catch (e) { setError((e as { message?: string })?.message || 'Could not share your post.'); setBusy(false); }
  };

  const back = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
      <h1 className="cust-h1" style={{ fontSize: 20 }}>Share My Nails</h1>
      <span style={{ marginLeft: 'auto', background: 'rgba(20,20,20,0.85)', color: '#fff', fontSize: 11, fontWeight: 800, padding: '4px 8px', borderRadius: 999 }}>✓ Verified Service</span>
    </div>
  );

  if (eligError) return <div style={{ padding: 18 }}>{back}<div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{eligError}</div></div>;
  if (!elig) return <div style={{ padding: 18 }}>{back}<div className="cust-skel" style={{ height: 120, borderRadius: 16 }} /></div>;

  if (!elig.eligible) {
    const msg = elig.alreadyPosted ? 'You’ve already shared a post from this visit.' : (elig.reason || 'This visit isn’t eligible for a verified post yet.');
    return (
      <div style={{ padding: 18 }}>{back}
        <div className="cust-card" style={{ padding: 24, textAlign: 'center' }}>
          <div aria-hidden style={{ fontSize: 32 }}>💅</div>
          <h2 className="cust-h2" style={{ marginTop: 8 }}>{msg}</h2>
          <button onClick={() => nav('/nail-showcase/create')} style={{ marginTop: 14, border: 0, borderRadius: 12, background: 'var(--customer-primary)', color: '#fff', fontWeight: 800, padding: '10px 18px', cursor: 'pointer' }}>Share a manual post instead</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 32 }}>
      {back}
      <div className="cust-sub" style={{ fontSize: 13 }}>Your salon, technician and service are linked automatically from this visit.</div>

      <div>
        <label className="cust-h2" style={{ fontSize: 14 }}>Photos <span className="cust-sub" style={{ fontWeight: 400 }}>({files.length}/{MAX_PHOTOS})</span></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
          {files.map((f, i) => (
            <div key={i} style={{ position: 'relative', width: 84, height: 84 }}>
              <img src={previews[i]} alt={f.name} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 12 }} />
              <button onClick={() => removeAt(i)} aria-label="Remove" style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 999, border: 0, background: 'rgba(20,20,20,0.85)', color: '#fff', fontSize: 13, cursor: 'pointer', lineHeight: '22px' }}>×</button>
            </div>
          ))}
          {files.length < MAX_PHOTOS ? <button onClick={() => fileRef.current?.click()} style={{ width: 84, height: 84, borderRadius: 12, border: '2px dashed var(--customer-border, #d9d2e6)', background: 'var(--customer-purple-100, #f7f4fd)', color: 'var(--customer-primary)', fontSize: 28, cursor: 'pointer' }}>+</button> : null}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => pick(e.target.files)} style={{ display: 'none' }} />
      </div>

      <div>
        <label className="cust-h2" style={{ fontSize: 14 }}>Caption</label>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value.slice(0, 280))} placeholder="French chrome tips with a soft pink base ✨" rows={3}
          style={{ width: '100%', marginTop: 8, border: '1px solid var(--customer-border, #e6e1ef)', borderRadius: 12, padding: '10px 12px', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
      </div>

      <div>
        <label className="cust-h2" style={{ fontSize: 14 }}>Style tags</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {TAGS.map((t) => {
            const on = tags.includes(t);
            return <button key={t} onClick={() => toggleTag(t)} style={{ border: on ? 0 : '1px solid var(--customer-border, #e6e1ef)', borderRadius: 999, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: on ? 'var(--customer-primary)' : 'transparent', color: on ? '#fff' : 'var(--customer-text-muted, #6b6b6b)' }}>{t}</button>;
          })}
        </div>
      </div>

      <button onClick={() => setAnonymous((v) => !v)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, textAlign: 'left' }}>
        <span><span style={{ fontWeight: 700, fontSize: 14 }}>Post anonymously</span><br /><span className="cust-sub" style={{ fontSize: 12 }}>Hides your name as “Anonymous Customer”</span></span>
        <span style={{ width: 46, height: 28, borderRadius: 999, background: anonymous ? 'var(--customer-primary)' : 'var(--customer-border, #d9d2e6)', position: 'relative', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 3, left: anonymous ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff' }} />
        </span>
      </button>

      {error ? <div className="cust-card" style={{ padding: 12, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div> : null}

      <button onClick={submit} disabled={busy} style={{ border: 0, borderRadius: 14, background: 'var(--customer-primary)', color: '#fff', fontWeight: 800, fontSize: 15, padding: '14px', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Sharing…' : 'Share Verified Post'}</button>
    </div>
  );
}
