import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useNavigate } from 'react-router-dom';
import { customerApi, NearbyResponse, SalonResult } from '../api/customerApi';
import { useEscapeKey } from '@aipowersalon/ui';

export function FindSalonsScreen() {
  const nav = useNavigate();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<NearbyResponse | null>(null);
  const [sheet, setSheet] = useState<SalonResult | null>(null);
  useEscapeKey(!!sheet, () => setSheet(null));
  const [sheetServices, setSheetServices] = useState<{ name: string; priceCents: number }[] | null>(null);
  const [sheetTechs, setSheetTechs] = useState<any[] | null>(null);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
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
  useEffect(() => {
    loadFavs();
    setBusy(true);
    customerApi
      .salonsNearby({ radiusMiles: 30 })
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);

  const toggleFav = async (r: SalonResult) => {
    try {
      if (favIds.has(r.salon_id)) await customerApi.removeFavoriteSalon(r.salon_id);
      else await customerApi.addFavoriteSalon(r.salon_id);
      await loadFavs();
    } catch {
      /* favorites are best-effort */
    }
  };

  const search = async (q: Parameters<typeof customerApi.salonsNearby>[0]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await customerApi.salonsNearby(q);
      setData(res);
    } catch (e: any) {
      setError(e?.message || 'Search failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  const useMyLocation = () => {
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

  const openTechProfileForSalon = async (salonId: string) => {
    try {
      setBusy(true);
      const res = await customerApi.salonTechnicians(salonId);
      if (res.technicians && res.technicians.length > 0) {
        nav(`/techs/${res.technicians[0].publicSlug}`);
        return;
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
    nav(`/salons/${salonId}/techs`);
  };

  const mapsHref = (r: SalonResult) =>
    r.latitude != null && r.longitude != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${r.latitude},${r.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address || ''}`)}`;

  const money = (c: number) => '$' + (c / 100).toFixed(2);

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
    if (view === 'map') {
      setTimeout(() => map.invalidateSize(), 60);
    }
  }, [view, data]);

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

      {/* Action Buttons */}
      {r.is_aipowersalon_partner && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void openTechProfileForSalon(r.salon_id);
          }}
          style={{
            width: '100%',
            height: 40,
            marginTop: 6,
            borderRadius: 12,
            border: '1.5px solid #E7DCC9',
            background: 'linear-gradient(135deg, #FFFDF8 0%, #F9F1E2 100%)',
            color: '#7A5414',
            fontSize: 13,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ fontSize: 14 }}>💅</span>
          <span>View Technicians &amp; Work</span>
        </button>
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

        {r.is_bookable_in_app && (
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
        )}
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

      {/* Modern Search & Location Bar */}
      <div style={{ display: 'flex', gap: 8 }}>
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
      </div>

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

        <div style={{ display: 'flex', gap: 4, background: '#FFFFFF', padding: 3, borderRadius: 10, border: '1px solid var(--customer-border)' }}>
          <button
            type="button"
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
            <div className="cust-label" style={{ fontSize: 13, color: 'var(--customer-text-secondary)' }}>
              SALONS ({data.results.length})
            </div>
            {data.googleMessage ? <div className="cust-sub" role="status" style={{ fontSize: 12.5 }}>{data.googleMessage}</div> : null}
            {data.results.length === 0 ? (
              <div className="cust-card" style={{ padding: 20, textAlign: 'center' }}>
                <div className="cust-sub">No salons found — try another search.</div>
              </div>
            ) : (
              data.results.map(card)
            )}
            {data.attribution && data.results.some((r) => r.source === 'google') ? (
              <div className="cust-sub" style={{ fontSize: 11, textAlign: 'right' }}>{data.attribution}</div>
            ) : null}
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

            {sheet.is_aipowersalon_partner && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Technicians &amp; Work</div>
                  <button
                    type="button"
                    onClick={() => {
                      setSheet(null);
                      if (sheetTechs && sheetTechs.length > 0) {
                        nav(`/techs/${sheetTechs[0].publicSlug}`);
                      } else {
                        void openTechProfileForSalon(sheet.salon_id);
                      }
                    }}
                    style={{
                      border: 0,
                      background: 'none',
                      color: 'var(--customer-primary)',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    View All →
                  </button>
                </div>
                {sheetTechs === null ? (
                  <div className="cust-sub" style={{ fontSize: 12.5 }}>Loading technicians…</div>
                ) : sheetTechs.length === 0 ? (
                  <div className="cust-sub" style={{ fontSize: 12.5 }}>No public technician profiles yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sheetTechs.slice(0, 3).map((t) => (
                      <div
                        key={t.publicSlug || t.technicianId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderRadius: 10,
                          background: '#FFFDF8',
                          border: '1px solid var(--customer-border)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: '50%',
                              background: '#EFE6D6',
                              overflow: 'hidden',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 16,
                              flexShrink: 0,
                            }}
                          >
                            {t.avatarUrl ? (
                              <img src={t.avatarUrl} alt={t.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              '💅'
                            )}
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {t.displayName}
                            </div>
                            <div className="cust-sub" style={{ fontSize: 11.5 }}>
                              ★ {Number(t.averageRating || 5).toFixed(1)} {t.reviewCount ? `(${t.reviewCount})` : ''}
                              {t.title ? ` · ${t.title}` : ''}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSheet(null);
                            nav(`/techs/${t.publicSlug}`);
                          }}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '1px solid var(--customer-border)',
                            background: '#FFFFFF',
                            color: 'var(--customer-primary-dark)',
                            fontWeight: 700,
                            fontSize: 12,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          View Work ↗
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {sheet.is_aipowersalon_partner && (
              <button
                type="button"
                onClick={() => {
                  setSheet(null);
                  if (sheetTechs && sheetTechs.length > 0) {
                    nav(`/techs/${sheetTechs[0].publicSlug}`);
                  } else {
                    void openTechProfileForSalon(sheet.salon_id);
                  }
                }}
                style={{
                  width: '100%',
                  height: 42,
                  marginTop: 6,
                  borderRadius: 12,
                  border: '1.5px solid #E7DCC9',
                  background: 'linear-gradient(135deg, #FFFDF8 0%, #F9F1E2 100%)',
                  color: '#7A5414',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
              >
                <span>💅</span>
                <span>View All Technicians &amp; Work</span>
              </button>
            )}

            {/* 2 Buttons in 1 Row: Half-Half (50% each) with Centered Icon + Text */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 6 }}>
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

              {sheet.is_bookable_in_app && (
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
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
