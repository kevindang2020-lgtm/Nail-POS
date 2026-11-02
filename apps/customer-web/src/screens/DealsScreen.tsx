import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerDeal, type NearbyDealCard, type WalletCoupon, type SavedDeal } from '../api/customerApi';
import { qrPath, parseDollarsToCents } from '@aipowersalon/ui';
import { useAuth } from '../auth/AuthContext';
import { fmtDate } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display
import { formatCentsOrDash } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// Deals (Home → Deals) — real active promotions from /customer/deals (salon-created, tenant scoped). No fabricated
// offers; if the salon hasn't published any, an honest empty state is shown.
const fmt = (iso: string | null) => (iso ? fmtDate(iso) : '');
const money = (c: number | null) => formatCentsOrDash(c);

// Nearby marketplace deals from participating salons (GET /customer/deals/nearby). Distance uses branch coordinates and
// the canonical haversine; when location is denied we still show the feed with no distance (never fabricated).
function NearbyDeals() {
  const nav = useNavigate();
  const [cards, setCards] = useState<NearbyDealCard[] | null>(null);
  const [origin, setOrigin] = useState<{ lat?: number; lng?: number } | null>(null);
  const [filters, setFilters] = useState({ q: '', sort: 'nearest', ownerType: '', maxPrice: '' });
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    const load = (q: { lat?: number; lng?: number }) => { if (live) setOrigin(q); };
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

  // BUILD_PLAN Phase 5: the feed is filtered on the server (bug 16 — it loaded the 500 newest deals platform-wide)
  useEffect(() => {
    if (!origin) return;
    let live = true;
    const max = parseDollarsToCents(filters.maxPrice) ?? 0;
    customerApi.dealsNearby({ ...origin, radiusMiles: 25, sort: filters.sort, ...(filters.q.trim() ? { q: filters.q.trim() } : {}), ...(filters.ownerType ? { ownerType: filters.ownerType } : {}), ...(max > 0 ? { maxPriceCents: max } : {}) })
      .then((d) => { if (live) setCards(d); }).catch((e: any) => live && setError(e?.message || 'Could not load nearby deals.'));
    return () => { live = false; };
  }, [origin, filters]);

  const toggleSave = async (id: string) => {
    const wasSaved = saved.has(id);
    setSaved((prev) => { const n = new Set(prev); if (wasSaved) n.delete(id); else n.add(id); return n; }); // optimistic
    try { await (wasSaved ? customerApi.unsaveDeal(id) : customerApi.saveDeal(id)); }
    catch { setSaved((prev) => { const n = new Set(prev); if (wasSaved) n.add(id); else n.delete(id); return n; }); } // revert on failure
  };

  if (error) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 className="cust-h2" style={{ fontSize: 16 }}>Nearby Deals</h2>
        {denied && <span className="cust-sub" style={{ fontSize: 11 }}>Enable location for distances</span>}
      </div>
      <div data-testid="deal-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input aria-label="Search deals" placeholder="Search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} style={{ flex: 1, minWidth: 120 }} />
        <select aria-label="Sort deals" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}><option value="nearest">Nearest</option><option value="best_value">Best value</option><option value="ending_soon">Ending soon</option><option value="newest">Newest</option></select>
        <select aria-label="Deal type" value={filters.ownerType} onChange={(e) => setFilters({ ...filters, ownerType: e.target.value })}><option value="">Salon &amp; tech</option><option value="salon">Salon deals</option><option value="technician">Tech deals</option></select>
        <input aria-label="Max price" placeholder="Max $" inputMode="decimal" value={filters.maxPrice} onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })} style={{ width: 70 }} />
      </div>
      {cards && cards.length === 0 ? <div className="cust-sub">No deals match near you.</div> : null}
      {!cards ? <div className="cust-skel" style={{ height: 84, borderRadius: 16 }} />
        : cards.slice(0, 12).map((c) => (
          <div key={c.id + c.branchName} className="cust-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 12, marginBottom: 6 }} /> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button onClick={() => nav('/deals/' + c.id)} style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}><strong style={{ fontSize: 15 }}>{c.title}</strong></button>
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

/** BUILD_PLAN Phase 5 — My coupons: the coupons the salon issued to this customer, each with a QR the register scans. */
function CouponWallet() {
  const [items, setItems] = useState<WalletCoupon[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { customerApi.couponWallet().then(setItems).catch(() => setItems([])); }, []);
  if (!items) return <div className="cust-skel" style={{ height: 84, borderRadius: 16 }} />;
  if (!items.length) return <div className="cust-card" style={{ padding: 16 }} data-testid="wallet-empty">No coupons yet — when your salon sends you one, it shows up here.</div>;
  return (
    <div data-testid="coupon-wallet" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((c) => {
        const qr = open === c.id ? qrPath(c.qr) : null;
        return (
          <div key={c.id} className="cust-card" style={{ padding: 14, opacity: c.usable ? 1 : 0.55 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{c.title}</strong><span className="cust-sub">…{c.codeHint}</span></div>
            <div className="cust-sub" style={{ fontSize: 12.5 }}>{c.discountType === 'percent' ? `${c.discountPercent}% off` : `$${((c.discountCents ?? 0) / 100).toFixed(2)} off`}{c.expiresAt ? ` · until ${new Date(c.expiresAt).toLocaleDateString()}` : ''} · {c.usable ? 'Ready to use' : c.status === 'exhausted' ? 'Used' : c.status}</div>
            {c.terms ? <div className="cust-sub" style={{ fontSize: 12 }}>{c.terms}</div> : null}
            {c.usable && <button className="cust-btn cust-btn-ghost" style={{ marginTop: 8, height: 38 }} onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Hide' : 'Show at checkout'}</button>}
            {qr && <svg data-testid={'qr-' + c.id} viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="Coupon QR code" style={{ width: 180, height: 180, background: '#fff', alignSelf: 'center', marginTop: 8 }} shapeRendering="crispEdges"><path d={qr.d} fill="#000" /></svg>}
          </div>
        );
      })}
    </div>
  );
}

/** Saved deals (signed in): the shopper's own list across salons. */
function SavedDeals() {
  const nav = useNavigate();
  const [items, setItems] = useState<SavedDeal[] | null>(null);
  useEffect(() => { customerApi.savedDeals().then(setItems).catch(() => setItems([])); }, []);
  if (!items) return <div className="cust-skel" style={{ height: 84, borderRadius: 16 }} />;
  if (!items.length) return <div className="cust-card" style={{ padding: 16 }}>Nothing saved yet — tap ♡ on a deal.</div>;
  return <div data-testid="saved-deals" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{items.map((d) => (
    <button key={d.id} className="cust-card" onClick={() => nav('/deals/' + d.id)} style={{ padding: 14, textAlign: 'left', cursor: 'pointer', opacity: d.status === 'active' ? 1 : 0.55 }}>
      <strong>{d.title}</strong><div className="cust-sub" style={{ fontSize: 12.5 }}>{d.salonName}{d.status !== 'active' ? ' · no longer available' : ''}</div>
    </button>))}</div>;
}

export function DealsScreen() {
  const nav = useNavigate();
  const { principal } = (useAuth() as any) ?? {};
  const [tab, setTab] = useState<'nearby' | 'salon' | 'saved' | 'coupons'>('salon');
  const [items, setItems] = useState<CustomerDeal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let live = true; customerApi.deals().then((d) => { if (live) setItems(d); }).catch((e: any) => live && setError(e?.message || 'Could not load deals.')); return () => { live = false; }; }, []);

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Deals</h1>
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 6 }}>
        {([['salon', 'My salon'], ['nearby', 'Nearby'], ...(principal ? [['saved', 'Saved'], ['coupons', 'My coupons']] : [])] as [string, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k as any)} className={tab === k ? 'cust-btn' : 'cust-btn cust-btn-ghost'} style={{ height: 34, padding: '0 12px', width: 'auto' }}>{l}</button>
        ))}
      </div>

      {tab === 'nearby' && <NearbyDeals />}
      {tab === 'saved' && <SavedDeals />}
      {tab === 'coupons' && <CouponWallet />}

      {tab !== 'salon' ? null : error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
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
                {d.requiresCode ? <span style={{ fontSize: 12, opacity: 0.92 }}>Coupon — use your code at checkout</span> : null}
                {d.endsAt ? <span style={{ fontSize: 12, opacity: 0.92 }}>Valid until {fmt(d.endsAt)}</span> : null}
              </div>
              <button onClick={() => nav('/deals/' + d.id)} className="cust-btn" style={{ marginTop: 14, background: '#fff', color: 'var(--customer-primary)' }}>See details</button>
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
              <button onClick={() => nav('/deals/' + d.id)} className="cust-btn cust-btn-ghost" style={{ marginTop: 12, height: 42 }}>See details</button>
            </div>
          ))}
    </div>
  );
}
