import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerDeal, type NearbyDealCard } from '../api/customerApi';

// Deals (Home → Deals) — real active promotions from /customer/deals (salon-created, tenant scoped). No fabricated
// offers; if the salon hasn't published any, an honest empty state is shown.
const fmt = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const money = (c: number | null) => c == null ? '—' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Nearby marketplace deals from participating salons (GET /customer/deals/nearby). Distance uses branch coordinates and
// the canonical haversine; when location is denied we still show the feed with no distance (never fabricated).
function NearbyDeals() {
  const nav = useNavigate();
  const [cards, setCards] = useState<NearbyDealCard[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    const load = (q: { lat?: number; lng?: number }) => customerApi.dealsNearby({ ...q, radiusMiles: 25, sort: 'nearest' })
      .then((d) => { if (live) setCards(d); }).catch((e: any) => live && setError(e?.message || 'Could not load nearby deals.'));
    // Best-effort: the signed-in shopper's saved set (guests get nothing, which is fine).
    customerApi.savedDeals().then((s) => { if (live) setSaved(new Set(s.map((x) => x.id))); }).catch(() => {});
    if (!('geolocation' in navigator)) { setDenied(true); load({}); return () => { live = false; }; }
    navigator.geolocation.getCurrentPosition(
      (pos) => load({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { if (live) { setDenied(true); load({}); } },
      { timeout: 8000 },
    );
    return () => { live = false; };
  }, []);

  const toggleSave = async (id: string) => {
    const wasSaved = saved.has(id);
    setSaved((prev) => { const n = new Set(prev); wasSaved ? n.delete(id) : n.add(id); return n; }); // optimistic
    try { await (wasSaved ? customerApi.unsaveDeal(id) : customerApi.saveDeal(id)); }
    catch { setSaved((prev) => { const n = new Set(prev); wasSaved ? n.add(id) : n.delete(id); return n; }); } // revert on failure
  };

  if (error) return null;
  if (cards && cards.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 className="cust-h2" style={{ fontSize: 16 }}>Nearby Deals</h2>
        {denied && <span className="cust-sub" style={{ fontSize: 11 }}>Enable location for distances</span>}
      </div>
      {!cards ? <div className="cust-skel" style={{ height: 84, borderRadius: 16 }} />
        : cards.slice(0, 12).map((c) => (
          <div key={c.id + c.branchName} className="cust-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 12, marginBottom: 6 }} /> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 15 }}>{c.title}</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: c.ownerType === 'technician' ? '#8A5A9E' : 'var(--customer-gold, #A96F22)' }}>
                  {c.ownerType === 'technician' ? 'Tech Deal' : 'Salon Deal'}
                </span>
                <button onClick={() => toggleSave(c.id)} aria-label={saved.has(c.id) ? 'Unsave' : 'Save'} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, color: saved.has(c.id) ? '#C9971B' : '#bbb' }}>
                  {saved.has(c.id) ? '♥' : '♡'}
                </button>
              </div>
            </div>
            <div className="cust-sub" style={{ fontSize: 12.5 }}>
              {c.salonName}{c.branchName ? ` · ${c.branchName}` : ''}
              {c.ownerType === 'technician' && c.technicianName ? ` · with ${c.technicianName}` : ''}
              {c.distanceMiles != null ? ` · ${c.distanceMiles} mi` : ''}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              {c.originalPriceCents != null && <span style={{ textDecoration: 'line-through', color: '#999', fontSize: 13 }}>{money(c.originalPriceCents)}</span>}
              <strong style={{ fontSize: 16, color: 'var(--customer-gold, #A96F22)' }}>{money(c.finalPriceCents)}</strong>
              {c.savingsCents ? <span style={{ fontSize: 11, background: 'var(--customer-gold-light, #f4ead6)', color: '#84561A', padding: '2px 8px', borderRadius: 999 }}>Save {money(c.savingsCents)}</span> : null}
            </div>
            {c.ownerType === 'technician' && <div style={{ fontSize: 11, color: '#8A5A9E', marginTop: 2 }}>Valid only with {c.technicianName || 'this technician'}.</div>}
            <button onClick={() => nav('/book', { state: { deal: { id: c.id, title: c.title } } })} style={{ marginTop: 8, alignSelf: 'flex-start', padding: '8px 16px', background: 'var(--customer-gold, #A96F22)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, cursor: 'pointer' }}>Book this deal</button>
          </div>
        ))}
    </div>
  );
}

export function DealsScreen() {
  const nav = useNavigate();
  const [items, setItems] = useState<CustomerDeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let live = true; customerApi.deals().then((d) => { if (live) setItems(d); }).catch((e: any) => live && setError(e?.message || 'Could not load deals.')); return () => { live = false; }; }, []);

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Deals</h1>
      </div>

      <NearbyDeals />

      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !items ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="cust-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="cust-skel" style={{ width: 100, height: 14 }} />
              <div className="cust-skel" style={{ width: 180, height: 20 }} />
              <div className="cust-skel" style={{ width: 140, height: 14 }} />
              <div className="cust-skel" style={{ width: '100%', height: 42, borderRadius: 10, marginTop: 12 }} />
            </div>
            {[1, 2].map(i => (
              <div key={i} className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="cust-skel" style={{ width: 44, height: 44, borderRadius: 12 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="cust-skel" style={{ width: 140, height: 16 }} />
                    <div className="cust-skel" style={{ width: 100, height: 14 }} />
                  </div>
                </div>
                <div className="cust-skel" style={{ width: '100%', height: 42, borderRadius: 10 }} />
              </div>
            ))}
          </div>
        )
        : items.length === 0 ? <div className="cust-card" style={{ padding: 24, textAlign: 'center' }}><div aria-hidden style={{ fontSize: 32 }}>🏷️</div><h2 className="cust-h2" style={{ marginTop: 8 }}>No active deals right now</h2><div className="cust-sub" style={{ marginTop: 4 }}>Check back soon for new offers.</div></div>
        : items.map((d, i) => i === 0 ? (
            <div key={d.id} className="cust-card" style={{ padding: 18, background: 'linear-gradient(135deg, #C9971B, #A96F22 60%, #84561A)', color: '#fff', border: 0 }}>
              <span style={{ fontWeight: 800, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.92 }}>🏷️ Featured Deal</span>
              <div style={{ fontWeight: 800, fontSize: 20, marginTop: 6 }}>{d.title}</div>
              {d.description ? <div style={{ opacity: 0.92, fontSize: 13.5, marginTop: 4 }}>{d.description}</div> : null}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                {d.code ? <span style={{ fontWeight: 800, background: 'rgba(255,255,255,0.22)', padding: '4px 10px', borderRadius: 8, letterSpacing: 0.5 }}>Code: {d.code}</span> : null}
                {d.endsAt ? <span style={{ fontSize: 12, opacity: 0.92 }}>Valid until {fmt(d.endsAt)}</span> : null}
              </div>
              <button onClick={() => nav('/book')} className="cust-btn" style={{ marginTop: 14, background: '#fff', color: 'var(--customer-primary)' }}>Book Now</button>
            </div>
          ) : (
            <div key={d.id} className="cust-card" style={{ padding: 16, borderLeft: '3px solid var(--customer-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--customer-purple-100)', display: 'grid', placeItems: 'center', fontSize: 20, flex: '0 0 auto' }} aria-hidden>🏷️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{d.title}</div>
                  {d.description ? <div className="cust-sub" style={{ marginTop: 2 }}>{d.description}</div> : null}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                    {d.code ? <span style={{ fontWeight: 800, color: 'var(--customer-primary)', background: 'var(--customer-purple-100)', padding: '4px 10px', borderRadius: 8, letterSpacing: 0.5 }}>Code: {d.code}</span> : null}
                    {d.endsAt ? <span className="cust-sub" style={{ fontSize: 12 }}>Valid until {fmt(d.endsAt)}</span> : null}
                  </div>
                </div>
              </div>
              <button onClick={() => nav('/book')} className="cust-btn cust-btn-ghost" style={{ marginTop: 12, height: 42 }}>Book Now</button>
            </div>
          ))}
    </div>
  );
}
