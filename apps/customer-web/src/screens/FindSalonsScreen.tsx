import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNavigate } from 'react-router-dom';
import { customerApi, NearbyResponse, SalonResult } from '../api/customerApi';



import { useEscapeKey } from '@aipowersalon/ui';
import { useAuth } from '../auth/AuthContext';
import { centsToUsdFixed } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

export function FindSalonsScreen() {
  const nav = useNavigate();
  const [view, setView] = useState<'list' | 'map'>('list');
  // Build doc §15 (customer app): the screen opens with the VERBATIM location prompt and two buttons; nothing is searched
  // until the guest chooses. The developer's redesign auto-searched a 30-mile radius on mount — restored in the Sep 2026 merge.
  const [phase, setPhase] = useState<'ask' | 'ready'>('ask');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<NearbyResponse | null>(null);
  const [sheet, setSheet] = useState<SalonResult | null>(null);
  useEscapeKey(!!sheet, () => setSheet(null));
  const [sheetServices, setSheetServices] = useState<{ name: string; priceCents: number }[] | null>(null);
  const [, setSheetTechs] = useState<any[] | null>(null);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const { principal } = useAuth() as any;
  // In-app booking works only for a partner salon the guest can book from THIS account: the same tenant (any of its
  // branches — the developer's multi-salon booking) or, when the result carries no tenant, the signed-in branch itself.
  // Google-listed salons are NEVER bookable in the app. Restored in the Sep 2026 merge (the redesign showed Book Now on every card).
  const canBookHere = (r: SalonResult) => r.is_aipowersalon_partner && r.is_bookable_in_app
    && (r.tenant_id ? r.tenant_id === principal?.tenantId : principal?.branchId != null && r.salon_id === principal.branchId);
  const [favSalons, setFavSalons] = useState<SalonResult[]>([]);

  const loadFavs = () =>
    customerApi
      .favoriteSalons()
      .then((f) => {
        setFavIds(new Set(f.salonIds));
        setFavSalons(f.salons);
      })
      .catch(() => {});

  // Load initial partner salons & favorites on mount
  useEffect(() => { loadFavs(); }, []);   // favorites show before any search (§17/§21); results wait for the guest's choice (§15)

  const toggleFav = async (r: SalonResult) => {
    try {
      if (favIds.has(r.salon_id)) await customerApi.removeFavoriteSalon(r.salon_id);
      else await customerApi.addFavoriteSalon(r.salon_id);
      await loadFavs();
    } catch {
      /* favorites are best-effort */
    }
  };

  const [lastQuery, setLastQuery] = useState<Parameters<typeof customerApi.salonsNearby>[0] | null>(null);
  const search = async (q: Parameters<typeof customerApi.salonsNearby>[0]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await customerApi.salonsNearby(q);
      setData(res);
      setLastQuery(q);
    } catch (e: any) {
      setError(e?.message || 'Search failed — try again.');
    } finally {
      setBusy(false);
    }
  };
  // B-28: the browse (no location) is paged — "Show more" appends the next page under the same filters
  const showMore = async () => {
    if (!data?.nextCursor || !lastQuery) return;
    setBusy(true);
    try {
      const res = await customerApi.salonsNearby({ ...lastQuery, cursor: data.nextCursor });
      setData({ ...res, results: [...data.results, ...res.results] });
    } catch (e: any) {
      setError(e?.message || 'Could not load more — try again.');
    } finally {
      setBusy(false);
    }
  };

  const useMyLocation = () => {
    setPhase('ready');
    if (!('geolocation' in navigator)) {
      manualSearch();
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => search({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setBusy(false);
        setError('Location permission denied. Search by city or ZIP below.');
      },
      { timeout: 10_000 }
    );
  };

  const manualSearch = () => {
    const q = query.trim();
    if (!q) {
      void search({ radiusMiles: 30 });
      return;
    }
    void search(/^\d{5}$/.test(q) ? { zip: q } : { searchText: q });
  };

  const openSheet = (r: SalonResult) => {
    setSheet(r);
    setSheetServices(null);
    setSheetTechs(null);
    if (r.is_aipowersalon_partner) {
      customerApi
        .salonServices(r.salon_id)
        .then(setSheetServices)
        .catch(() => setSheetServices([]));
      customerApi
        .salonTechnicians(r.salon_id)
        .then((x) => setSheetTechs(x.technicians))
        .catch(() => setSheetTechs([]));
    }
  };

  const mapsHref = (r: SalonResult) =>
    r.latitude != null && r.longitude != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${r.latitude},${r.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address || ''}`)}`;

  const money = (c: number) => centsToUsdFixed(c);

  // Map View
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!data || !mapDiv.current) return;
    const pts = data.results.filter((r) => r.latitude != null && r.longitude != null);
    if (!mapRef.current) {
      mapRef.current = L.map(mapDiv.current, { zoomControl: true, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(mapRef.current);
    }
    const map = mapRef.current;
    map.eachLayer((l) => {
      if (l instanceof L.Marker) map.removeLayer(l);
    });
    const pin = (gold: boolean) =>
      L.divIcon({
        className: '',
        html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${
          gold ? 'linear-gradient(135deg,#C9962E,#A96F22)' : '#9A9287'
        };border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 22],
      });
    for (const r of pts) {
      L.marker([r.latitude as number, r.longitude as number], { icon: pin(r.is_aipowersalon_partner), title: r.name })
        .addTo(map)
        .on('click', () => openSheet(r));
    }
    if (pts.length)
      map.fitBounds(
        L.latLngBounds(pts.map((r) => [r.latitude as number, r.longitude as number] as [number, number])),
        { padding: [28, 28], maxZoom: 14 }
      );
  }, [data]);   // pins follow the DATA; switching tabs only needs a resize (below), not a rebuild of every marker

  useEffect(() => {
    if (view === 'map' && mapRef.current) { const map = mapRef.current; const t = setTimeout(() => map.invalidateSize(), 60); return () => clearTimeout(t); }
    return undefined;
  }, [view]);

  useEffect(() => () => {
    mapRef.current?.remove();
    mapRef.current = null;
  }, []);

  const card = (r: SalonResult) => (
    <div
      key={r.salon_id}
      className="cust-card"
      onClick={() => openSheet(r)}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        cursor: 'pointer',
        background: '#FFFFFF',
        borderRadius: 16,
        boxShadow: '0 4px 16px rgba(120, 90, 30, 0.06)',
        border: '1px solid var(--customer-border)',
      }}
    >
      {/* Header: Name, Partner Badge, Favorite */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--customer-text)' }}>
              {r.name}
            </span>
            {r.is_aipowersalon_partner && (
              <span className="cust-pill cust-pill-purple" style={{ padding: '2px 8px', fontSize: 10.5 }}>
                Partner
              </span>
            )}
          </div>
          <div className="cust-sub" style={{ marginTop: 2, fontSize: 12.5 }}>
            {r.address ? `${r.address}${r.city ? `, ${r.city}` : ''}` : 'Partner location'}
          </div>
        </div>

        {r.is_aipowersalon_partner && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void toggleFav(r);
            }}
            type="button"
            aria-label={favIds.has(r.salon_id) ? `Unfavorite ${r.name}` : `Favorite ${r.name}`}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: favIds.has(r.salon_id) ? '#C9962E' : '#C9C2B6',
              padding: '0 4px',
            }}
          >
            {favIds.has(r.salon_id) ? '♥' : '♡'}
          </button>
        )}
      </div>

      {/* Metrics Row: Rating, Distance, Open status */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--customer-text-secondary)' }}>
        {r.rating != null && (
          <span style={{ fontWeight: 700, color: 'var(--customer-primary)' }}>
            ★ {r.rating.toFixed(1)} {r.review_count ? `(${r.review_count})` : ''}
          </span>
        )}
        {r.distance_miles != null && <span>🚗 {r.distance_miles.toFixed(1)} mi away</span>}
        {r.open_now != null && (
          <span style={{ color: r.open_now ? '#0E8A63' : '#F04444', fontWeight: 600 }}>
            {r.open_now ? 'Open now' : 'Closed'}
          </span>
        )}
      </div>

      {/* Services Preview */}
      {r.services_preview.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          {r.services_preview.slice(0, 3).map((s) => (
            <span
              key={s}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 999,
                background: 'var(--customer-purple-100)',
                color: 'var(--customer-text-secondary)',
                fontWeight: 600,
              }}
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {/* 2 Buttons in 1 Row: Half-Half (50% each) with Centered Icon + Text */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginTop: 8,
          width: '100%',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {r.phone ? (
        <a
          href={`tel:${r.phone}`}
          style={{
            height: 42,
            borderRadius: 12,
            border: '1.5px solid var(--customer-border)',
            background: '#FFFFFF',
            color: 'var(--customer-text)',
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ fontSize: 14 }}>📞</span>
          <span>Call</span>
        </a>
        ) : null}
        <a
          href={mapsHref(r)}
          target="_blank"
          rel="noreferrer"
          style={{
            height: 42,
            borderRadius: 12,
            border: '1.5px solid var(--customer-border)',
            background: '#FFFFFF',
            color: 'var(--customer-text)',
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ fontSize: 14 }}>📍</span>
          <span>Directions</span>
        </a>

        {canBookHere(r) ? (
        <button
          type="button"
          onClick={() => nav('/book', { state: { preSalon: r } })}
          style={{
            height: 42,
            borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(135deg, #C9971B 0%, #A96F22 100%)',
            color: '#FFFFFF',
            fontWeight: 700,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            cursor: 'pointer',
            boxShadow: '0 3px 10px rgba(169, 111, 34, 0.25)',
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ fontSize: 14 }}>📅</span>
          <span>Book Now</span>
        </button>
        ) : r.is_aipowersalon_partner && r.is_bookable_in_app ? (
          <div className="cust-sub" style={{ fontSize: 12, lineHeight: 1.45, alignSelf: 'center' }}>Takes in-app bookings — you're signed in with a different salon. Call to book.</div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div style={{ padding: '18px 18px 120px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Top Header with Back Button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className="customer-back"
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
        <h1 className="cust-h1" style={{ fontSize: 22 }}>
          Find Salons
        </h1>
      </div>

      {phase === 'ask' ? (
        <div className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5, lineHeight: 1.5 }}>Allow location access to find nail salons near you.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="cust-btn" disabled={busy} onClick={useMyLocation}>{busy ? 'Locating…' : 'Allow Location'}</button>
            <button className="cust-btn ghost" onClick={() => setPhase('ready')}>Search by City or ZIP</button>
          </div>
          {error ? <div className="cust-error" role="alert">{error}</div> : null}
        </div>
      ) : null}

      {/* Modern Search & Location Bar */}
      {phase === 'ready' ? <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{
            flex: 1,
            height: 46,
            borderRadius: 12,
            border: '1px solid var(--customer-border)',
            padding: '0 14px',
            font: 'inherit',
            background: '#fff',
            fontSize: 14,
          }}
          placeholder="City, ZIP, or salon name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && manualSearch()}
          aria-label="Search city or ZIP"
        />
        <button
          className="cust-btn"
          style={{ width: 'auto', padding: '0 18px', height: 46, fontSize: 13 }}
          disabled={busy}
          onClick={manualSearch}
        >
          {busy ? '…' : 'Search'}
        </button>
      </div> : null}

      {/* Quick Filter Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={busy}
          style={{
            background: 'var(--customer-primary-light)',
            color: 'var(--customer-primary)',
            border: 'none',
            borderRadius: 10,
            padding: '8px 14px',
            fontWeight: 700,
            fontSize: 12.5,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          📍 Near Me
        </button>

        <div role="tablist" aria-label="Results view" style={{ display: 'flex', gap: 4, background: '#FFFFFF', padding: 3, borderRadius: 10, border: '1px solid var(--customer-border)' }}>
          <button
            type="button"
            role="tab" aria-selected={view === 'list'}
            onClick={() => setView('list')}
            style={{
              border: 'none',
              borderRadius: 8,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              background: view === 'list' ? 'var(--customer-primary)' : 'transparent',
              color: view === 'list' ? '#fff' : 'var(--customer-text)',
            }}
          >
            List
          </button>
          <button
            type="button"
            role="tab" aria-selected={view === 'map'}
            onClick={() => setView('map')}
            style={{
              border: 'none',
              borderRadius: 8,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              background: view === 'map' ? 'var(--customer-primary)' : 'transparent',
              color: view === 'map' ? '#fff' : 'var(--customer-text)',
            }}
          >
            Map
          </button>
        </div>
      </div>

      {error ? (
        <div className="cust-card" style={{ padding: 12, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>
          {error}
        </div>
      ) : null}

      {/* Favorite Salons if any */}
      {favSalons.length > 0 && !query && (
        <div style={{ marginTop: 6 }}>
          <div className="cust-label" style={{ fontSize: 13, color: 'var(--customer-text-secondary)', marginBottom: 8 }}>
            YOUR FAVORITE SALONS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {favSalons.map(card)}
          </div>
        </div>
      )}

      {/* Main Results List or Map View */}
      {data ? (
        <div style={{ marginTop: 4 }}>
          <div
            ref={mapDiv}
            data-testid="salon-map"
            style={{
              height: '54vh',
              borderRadius: 16,
              overflow: 'hidden',
              border: '1px solid var(--customer-border)',
              display: view === 'map' ? 'block' : 'none',
            }}
          />

          <div
            style={{
              display: view === 'list' ? 'flex' : 'none',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {data.googleMessage ? <div className="cust-card" style={{ padding: 12, fontSize: 12.5 }} role="status">{data.googleMessage}</div> : null}
            <div className="cust-label" style={{ fontSize: 13, color: 'var(--customer-text-secondary)' }}>
              SALONS ({data.results.length})
            </div>
            {data.results.length === 0 ? (
              <div className="cust-card" style={{ padding: 20, textAlign: 'center' }}>
                <div className="cust-sub">No salons found — try another search.</div>
              </div>
            ) : (
              data.results.map(card)
            )}
            {data.nextCursor ? (
              <button type="button" className="cust-btn-ghost" onClick={showMore} disabled={busy} style={{ alignSelf: 'center' }}>
                {busy ? 'Loading…' : 'Show more salons'}
              </button>
            ) : null}
            {data.attribution ? <div className="cust-sub" style={{ textAlign: 'center', fontSize: 11, marginTop: 4 }}>{data.attribution}</div> : null}
          </div>
        </div>
      ) : busy ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="cust-skel" style={{ height: 110, borderRadius: 16 }} />
          ))}
        </div>
      ) : null}

      {/* Bottom Sheet Modal for Salon Details */}
      {sheet && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSheet(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20,12,30,0.45)',
            display: 'grid',
            placeItems: 'end center',
            zIndex: 30,
          }}
        >
          <div
            className="cust-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 540,
              borderRadius: '22px 22px 0 0',
              padding: 20,
              maxHeight: '75vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{sheet.name}</div>
                <div className="cust-sub" style={{ marginTop: 2, fontSize: 12.5 }}>
                  {sheet.address ? `${sheet.address}, ${sheet.city || ''}` : 'Partner Salon'}
                </div>
              </div>
              {sheet.is_aipowersalon_partner && (
                <span className="cust-pill cust-pill-purple" style={{ padding: '3px 10px', fontSize: 11 }}>
                  Partner
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, fontSize: 12.5, color: 'var(--customer-text-secondary)' }}>
              {sheet.rating != null && (
                <span style={{ fontWeight: 700, color: 'var(--customer-primary)' }}>
                  ★ {sheet.rating.toFixed(1)} {sheet.review_count ? `(${sheet.review_count} reviews)` : ''}
                </span>
              )}
              {sheet.distance_miles != null && <span>🚗 {sheet.distance_miles.toFixed(1)} mi</span>}
              {sheet.phone && <span>📞 {sheet.phone}</span>}
            </div>

            {sheet.is_aipowersalon_partner && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Services Menu</div>
                {sheetServices === null ? (
                  <div className="cust-sub" style={{ fontSize: 12.5 }}>Loading services…</div>
                ) : sheetServices.length === 0 ? (
                  <div className="cust-sub" style={{ fontSize: 12.5 }}>Service list available at salon.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sheetServices.slice(0, 6).map((s) => (
                      <div
                        key={s.name}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 13,
                          padding: '6px 0',
                          borderBottom: '1px solid rgba(233, 218, 196, 0.5)',
                        }}
                      >
                        <span>{s.name}</span>
                        <span style={{ fontWeight: 700, color: 'var(--customer-primary-dark)' }}>
                          {money(s.priceCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2 Buttons in 1 Row: Half-Half (50% each) with Centered Icon + Text */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              {sheet.phone ? (
              <a
                href={`tel:${sheet.phone}`}
                style={{
                  height: 46,
                  borderRadius: 12,
                  border: '1.5px solid var(--customer-border)',
                  background: '#FFFFFF',
                  color: 'var(--customer-text)',
                  fontSize: 13.5,
                  fontWeight: 700,
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 14 }}>📞</span>
                <span>Call</span>
              </a>
              ) : null}
              <a
                href={mapsHref(sheet)}
                target="_blank"
                rel="noreferrer"
                style={{
                  height: 46,
                  borderRadius: 12,
                  border: '1.5px solid var(--customer-border)',
                  background: '#FFFFFF',
                  color: 'var(--customer-text)',
                  fontSize: 13.5,
                  fontWeight: 700,
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 14 }}>📍</span>
                <span>Directions</span>
              </a>

              {canBookHere(sheet) ? (
              <button
                type="button"
                style={{
                  height: 46,
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #C9971B 0%, #A96F22 100%)',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: 13.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  boxShadow: '0 3px 10px rgba(169, 111, 34, 0.25)',
                }}
                onClick={() => {
                  setSheet(null);
                  nav('/book', { state: { preSalon: sheet } });
                }}
              >
                <span style={{ fontSize: 14 }}>📅</span>
                <span>Book Now</span>
              </button>
              ) : sheet.is_aipowersalon_partner && sheet.is_bookable_in_app ? (
                <div className="cust-sub" style={{ fontSize: 12, lineHeight: 1.45 }}>This partner salon takes in-app bookings. You're signed in with a different salon — call to book, or sign in with an account for this salon.</div>
              ) : sheet.source === 'google' ? (
                <div className="cust-sub" style={{ fontSize: 12 }}>This salon isn't an AIPowerSalon partner yet — call or get directions.</div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
