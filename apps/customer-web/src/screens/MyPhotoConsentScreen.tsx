// MyPhotoConsentScreen — the customer's own view of photos a salon published with their consent, with the ability to
// withdraw consent (which removes the photo from every public view). Server-authorized: the list and the withdrawal
// only ever touch this customer's own consents. Withdrawal uses a two-step inline confirm (no destructive one-tap).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerPhotoConsentApi, type MyConsentedPhoto } from '../api/customerPhotoConsentApi';

export function MyPhotoConsentScreen() {
  const nav = useNavigate();
  const [items, setItems] = useState<MyConsentedPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () => { setError(null); customerPhotoConsentApi.list().then((r) => setItems(r.photos)).catch((e: { message?: string }) => { setItems([]); setError(e?.message || 'Could not load your photos.'); }); };
  useEffect(() => { load(); }, []);

  const withdraw = async (photoId: string) => {
    setBusy(true); setError(null);
    try { await customerPhotoConsentApi.withdraw(photoId); setConfirmId(null); setNote('Consent withdrawn — this photo has been removed from public view.'); load(); }
    catch (e) { setError((e as { message?: string })?.message || 'Could not withdraw consent.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className='customer-back'
        
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>My Salon Photos</h1>
      </div>

      <div className="cust-sub" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Photos a salon published with your consent. You can withdraw consent at any time — the photo is removed from every public view, including your technician’s portfolio, before/after galleries, and search.
      </div>

      {note ? <div className="cust-card" style={{ padding: 12, color: 'var(--customer-primary)', background: 'var(--customer-purple-100)', border: 0, fontSize: 13 }}>{note}</div> : null}
      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div> : null}

        {!items ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2].map((i) => (
              <div key={i} className="cust-card" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="cust-skel" style={{ width: 64, height: 64, borderRadius: 12 }} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="cust-skel" style={{ width: 140, height: 16 }} />
                  <div className="cust-skel" style={{ width: 100, height: 14 }} />
                  <div className="cust-skel" style={{ width: 80, height: 14 }} />
                </div>
              </div>
            ))}
          </div>
        )
        : items.length === 0 ? (
          <div className="cust-card" style={{ padding: 24, textAlign: 'center' }}>
            <div aria-hidden style={{ fontSize: 32 }}>📸</div>
            <div className="cust-sub" style={{ marginTop: 8 }}>No published photos. When a salon publishes a photo of your nails with your consent, it’ll appear here.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map((ph) => (
              <div key={ph.photoId} className="cust-card" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
                <img src={ph.thumbnailUrl || ph.imageUrl} alt={ph.caption || 'Salon photo'} style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', flex: 'none', background: 'var(--customer-purple-100)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ph.caption || 'Nail photo'}</div>
                  <div className="cust-sub" style={{ fontSize: 12 }}>{ph.publicBlocked ? 'Not shown publicly' : 'Visible publicly'}</div>
                  {confirmId === ph.photoId ? (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button onClick={() => withdraw(ph.photoId)} disabled={busy} style={{ border: 0, borderRadius: 10, padding: '7px 12px', fontWeight: 800, fontSize: 12, background: 'var(--customer-red)', color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>Yes, withdraw</button>
                      <button onClick={() => setConfirmId(null)} disabled={busy} style={{ border: '1px solid var(--customer-border)', borderRadius: 10, padding: '7px 12px', fontWeight: 700, fontSize: 12, background: 'none', color: 'var(--customer-text)', cursor: 'pointer' }}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => { setConfirmId(ph.photoId); setNote(null); }} style={{ border: 0, background: 'none', color: 'var(--customer-red)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: 0, marginTop: 6 }}>Withdraw consent</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
