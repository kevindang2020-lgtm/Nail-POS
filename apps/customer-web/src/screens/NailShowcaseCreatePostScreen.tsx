import { useState, useRef, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerNailShowcaseApi, type NSVisibility } from '../api/customerNailShowcaseApi';
 
// Share Your Nails — create a manual NailShowcase post then upload the photos. Two steps server-side (create post →
// multipart upload), one flow here. Photos are validated client-side for type/size/count before upload; the backend
// re-validates. Visibility defaults to the salon-only community per the spec.
const TAGS = ['French Tips', 'Gel X', 'Acrylic', 'Chrome', 'Ombre', '3D Nail Art', 'Short Nails', 'Long Nails', 'Wedding', 'Natural Look', 'Cat Eye', 'Builder Gel', 'Dip Powder', 'Pedicure', 'Simple Design', 'Luxury Design', 'Holiday Nails'];
const VIS: { key: NSVisibility; label: string; hint: string }[] = [
  { key: 'salon_only', label: 'My salon’s community', hint: 'Visible to this salon’s customers' },
  { key: 'public_platform', label: 'Public on AIPowerSalon', hint: 'Visible across the community' },
  { key: 'private', label: 'Only me', hint: 'Just for you' },
];
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'];
const MAX_BYTES = 50 * 1024 * 1024, MAX_PHOTOS = 10;
 
export function NailShowcaseCreatePostScreen() {
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<NSVisibility>('salon_only');
  const [anonymous, setAnonymous] = useState(false);
  const [allowComments, setAllowComments] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Object URLs are created once per file set and revoked on change/unmount (creating them inline in render leaks).
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => { previews.forEach((u) => URL.revokeObjectURL(u)); }, [previews]);
 
  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= 8 ? cur : [...cur, t]));
  const pick = (list: FileList | null) => {
    if (!list) return; setError(null);
    const next: File[] = [...files];
    for (const f of Array.from(list)) {
      if (!ALLOWED.includes(f.type)) { setError(`${f.name}: use JPG, PNG, WEBP, MP4, or MOV.`); continue; }
      if (f.size > MAX_BYTES) { setError(`${f.name}: exceeds 50MB.`); continue; }
      if (next.length >= MAX_PHOTOS) { setError(`Up to ${MAX_PHOTOS} media files per post.`); break; }
      next.push(f);
    }
    setFiles(next);
  };
  const removeAt = (i: number) => setFiles((cur) => cur.filter((_, idx) => idx !== i));
 
  const submit = async () => {
    if (busy) return;
    if (!files.length) { setError('Add at least one photo or video of your nails.'); return; }
    setBusy(true); setError(null);
    try {
      const post = await customerNailShowcaseApi.createPost({ caption: caption.trim() || undefined, tags, visibility, allowComments, isAnonymous: anonymous });
      await customerNailShowcaseApi.uploadPhotos(post.id, files);
      nav(`/nail-showcase/${post.id}`);
    } catch (e) {
      setError((e as { message?: string })?.message || 'Could not share your post.');
      setBusy(false);
    }
  };
 
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Share Your Nails</h1>
      </div>
 
      <div>
        <label className="cust-h2" style={{ fontSize: 14 }}>Media <span className="cust-sub" style={{ fontWeight: 400 }}>({files.length}/{MAX_PHOTOS})</span></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
          {files.map((f, i) => {
            const isVid = f.type.startsWith('video/');
            return (
              <div key={i} style={{ position: 'relative', width: 84, height: 84 }}>
                {isVid ? (
                  <video src={previews[i]} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 12 }} muted playsInline />
                ) : (
                  <img src={previews[i]} alt={f.name} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 12 }} />
                )}
                <button onClick={() => removeAt(i)} aria-label="Remove" style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 999, border: 0, background: 'rgba(20,20,20,0.85)', color: '#fff', fontSize: 13, cursor: 'pointer', lineHeight: '22px' }}>×</button>
              </div>
            );
          })}
          {files.length < MAX_PHOTOS ? (
            <button onClick={() => fileRef.current?.click()} style={{ width: 84, height: 84, borderRadius: 12, border: '2px dashed var(--customer-border, #d9d2e6)', background: 'var(--customer-purple-100, #f7f4fd)', color: 'var(--customer-primary)', fontSize: 28, cursor: 'pointer' }}>+</button>
          ) : null}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" multiple onChange={(e) => pick(e.target.files)} style={{ display: 'none' }} />
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
 
      <div>
        <label className="cust-h2" style={{ fontSize: 14 }}>Who can see this</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {VIS.map((v) => (
            <button key={v.key} onClick={() => setVisibility(v.key)} className="cust-card" style={{ textAlign: 'left', padding: 12, cursor: 'pointer', border: visibility === v.key ? '2px solid var(--customer-primary)' : '1px solid var(--customer-border, #ece8f3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><span style={{ fontWeight: 700, fontSize: 14 }}>{v.label}</span><br /><span className="cust-sub" style={{ fontSize: 12 }}>{v.hint}</span></span>
              <span style={{ color: 'var(--customer-primary)', fontWeight: 800 }}>{visibility === v.key ? '●' : '○'}</span>
            </button>
          ))}
        </div>
      </div>
 
      <Toggle label="Post anonymously" sub="Hides your name as “Anonymous Customer”" value={anonymous} onChange={setAnonymous} />
      <Toggle label="Allow comments" sub="Let others comment on your design" value={allowComments} onChange={setAllowComments} />
 
      {error ? <div className="cust-card" style={{ padding: 12, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div> : null}
 
      <button onClick={submit} disabled={busy} style={{ border: 0, borderRadius: 14, background: 'var(--customer-primary)', color: '#fff', fontWeight: 800, fontSize: 15, padding: '14px', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Sharing…' : 'Share Post'}</button>
    </div>
  );
}
 
function Toggle({ label, sub, value, onChange }: { label: string; sub: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, textAlign: 'left' }}>
      <span><span style={{ fontWeight: 700, fontSize: 14 }}>{label}</span><br /><span className="cust-sub" style={{ fontSize: 12 }}>{sub}</span></span>
      <span style={{ width: 46, height: 28, borderRadius: 999, background: value ? 'var(--customer-primary)' : 'var(--customer-border, #d9d2e6)', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 3, left: value ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: 'left .15s' }} />
      </span>
    </button>
  );
}