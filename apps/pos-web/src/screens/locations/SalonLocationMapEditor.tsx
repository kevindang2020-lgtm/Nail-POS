// SalonLocationMapEditor.tsx — address search + interactive Google map + draggable pin + confirm.
// The browser map uses VITE_GOOGLE_MAPS_BROWSER_API_KEY (restricted by domain). When no browser key is
// configured the component degrades to a clean fallback: address search (server-side geocode) + manual
// lat/long still work, so a manager can set & confirm a pin without the visual map (§20 fallback states).
import { useEffect, useRef, useState } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { posLocationsApi, type SalonLocation, type GeocodeHit } from '../../api/posLocationsApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../../components/ImeSafeInput';

import { statusLabel } from '../../i18n/status-label';
const BROWSER_KEY = ((import.meta as any).env?.VITE_GOOGLE_MAPS_BROWSER_API_KEY as string) || '';
const MAP_ID = ((import.meta as any).env?.VITE_GOOGLE_MAPS_MAP_ID as string) || '';
const DEFAULT_CENTER = { lat: 39.9489, lng: -75.0496 }; // Merchantville, NJ

let gmapsPromise: Promise<any> | null = null;
function loadGoogleMaps(): Promise<any> {
  if (!BROWSER_KEY) return Promise.reject(new Error('no-key'));
  if ((window as any).google?.maps) return Promise.resolve((window as any).google);
  if (gmapsPromise) return gmapsPromise;
  gmapsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${BROWSER_KEY}&v=weekly`;
    s.async = true; s.defer = true;
    s.onload = () => resolve((window as any).google);
    s.onerror = () => reject(new Error('maps-load-failed'));
    document.head.appendChild(s);
  });
  return gmapsPromise;
}

export function SalonLocationMapEditor({ location, onSaved }: { location: SalonLocation; onSaved: (l: SalonLocation) => void }) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<GeocodeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [, setGeocoderConfigured] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [mapState, setMapState] = useState<'init' | 'ready' | 'nokey' | 'error'>('init');

  const mapDiv = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const leafletDiv = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<any>(null);
  const leafletMarkerRef = useRef<any>(null);

  // init the visual map (best-effort)
  const initGoogleMap = useEventCallback(() => {
    let cancelled = false;
    loadGoogleMaps().then((google) => {
      if (cancelled || !mapDiv.current) return;
      const center = location.latitude != null && location.longitude != null ? { lat: Number(location.latitude), lng: Number(location.longitude) } : DEFAULT_CENTER;
      const map = new google.maps.Map(mapDiv.current, { center, zoom: location.latitude != null ? 17 : 12, mapId: MAP_ID || undefined, disableDefaultUI: false, streetViewControl: false, mapTypeControl: false });
      const marker = new google.maps.Marker({ position: center, map, draggable: true });
      marker.addListener('dragend', () => { const p = marker.getPosition(); if (p) void onPinMove(p.lat(), p.lng()); });
      map.addListener('click', (e: any) => { if (e.latLng) { marker.setPosition(e.latLng); void onPinMove(e.latLng.lat(), e.latLng.lng()); } });
      mapRef.current = map; markerRef.current = marker; setMapState('ready');
    }).catch((e) => { setMapState(e?.message === 'no-key' ? 'nokey' : 'error'); });
    return () => { cancelled = true; };
     
  });
  useEffect(() => initGoogleMap(), [initGoogleMap]);

  // fallback to leaflet
  const initLeaflet = useEventCallback(() => {
    if ((mapState === 'nokey' || mapState === 'error') && leafletDiv.current && !leafletMapRef.current) {
      const center: [number, number] = location.latitude != null && location.longitude != null ? [Number(location.latitude), Number(location.longitude)] : [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng];
      const map = L.map(leafletDiv.current).setView(center, location.latitude != null ? 17 : 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      
      const icon = L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
      });

      const marker = L.marker(center, { draggable: true, icon }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); void onPinMove(p.lat, p.lng); });
      map.on('click', (e: any) => { marker.setLatLng(e.latlng); void onPinMove(e.latlng.lat, e.latlng.lng); });
      
      leafletMapRef.current = map;
      leafletMarkerRef.current = marker;
    }
     
  });
  useEffect(() => initLeaflet(), [mapState, initLeaflet]);

  const recenter = (lat: number, lng: number, zoom = 17) => {
    if (mapRef.current && markerRef.current) { const pos = { lat, lng }; mapRef.current.setCenter(pos); mapRef.current.setZoom(zoom); markerRef.current.setPosition(pos); }
    if (leafletMapRef.current && leafletMarkerRef.current) { const pos: [number, number] = [lat, lng]; leafletMapRef.current.setView(pos, zoom); leafletMarkerRef.current.setLatLng(pos); }
  };

  const runSearch = async () => {
    const term = query.trim();
    if (term.length < 3) { setMsg(t('pos.type_at_least_3_characters_of_3lpm')); return; }
    setSearching(true); setMsg(null); setCandidates([]);
    try {
      const r = await posLocationsApi.geocode(term);
      setGeocoderConfigured(r.configured);
      if (!r.configured) setMsg(t('pos.address_lookup_needs_a_google_maps_jsoe'));
      else if (r.candidates.length === 0) setMsg(t('pos.no_matching_address_found_refine_the_35hi'));
      setCandidates(r.candidates);
    } catch (e: any) { setMsg(e?.message || t('pos.address_search_failed')); }
    finally { setSearching(false); }
  };

  const applyHit = async (hit: GeocodeHit) => {
    setMsg(null); setWarn(null);
    try {
      const r = await posLocationsApi.applyAddress(location.id, hit);
      setCandidates([]); setQuery(hit.formattedAddress);
      if (r.location.latitude != null && r.location.longitude != null) recenter(Number(r.location.latitude), Number(r.location.longitude));
      onSaved(r.location);
    } catch (e: any) { setMsg(e?.message || t('pos.could_not_apply_that_address')); }
  };

  const onPinMove = async (lat: number, lng: number) => {
    setWarn(null);
    try {
      const r = await posLocationsApi.setMapPin(location.id, lat, lng, 'manual_drag');
      if (r.warning) setWarn(r.warning);
      onSaved(r.location);
    } catch (e: any) { setMsg(e?.message || t('pos.could_not_update_the_pin')); }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setMsg(t('pos.this_device_has_no_location_service')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { recenter(pos.coords.latitude, pos.coords.longitude); void onPinMove(pos.coords.latitude, pos.coords.longitude); },
      () => setMsg(t('pos.location_permission_denied_search_the_address_1scz')),
    );
  };

  const confirm = async () => {
    setMsg(null);
    try { const r = await posLocationsApi.confirmPin(location.id); onSaved(r.location); setMsg(t('pos.pin_confirmed_2')); }
    catch (e: any) { setMsg(e?.message || t('pos.could_not_confirm_the_pin')); }
  };

  const manualPin = async (latStr: string, lngStr: string) => {
    const lat = Number(latStr), lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setMsg(t('pos.enter_valid_numbers')); return; }
    recenter(lat, lng); await onPinMove(lat, lng);
  };

  const confirmed = !!location.map_pin_confirmed_at;
  const hasPin = location.latitude != null && location.longitude != null;

  return (
    <div className="mapedit">
      <div className="mapedit-search">
        <ImeSafeInput value={query} onValue={setQuery} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
          type="search" enterKeyHint="search" placeholder={t('pos.search_address_salon_name_or_zip')} aria-label={t('pos.search_address')} />
        <button className="btn" onClick={runSearch} disabled={searching}>{searching ? t('pos.searching_2') : t('pos.search')}</button>
        <button className="btn ghost" onClick={useMyLocation} type="button">{t('pos.use_current_location')}</button>
      </div>
      {candidates.length > 0 && (
        <div className="mapedit-cands">
          {candidates.map((c, i) => (
            <button key={i} className="mapedit-cand" onClick={() => applyHit(c)}>
              <span className="mc-addr">{c.formattedAddress}</span>
              <span className="mc-acc">{c.accuracy || ''}</span>
            </button>
          ))}
        </div>
      )}
      {msg && <div className="mapedit-msg">{msg}</div>}
      {warn && <div className="mapedit-warn">⚠ {warn}</div>}

      {mapState === 'ready' && <div className="mapedit-map" ref={mapDiv} />}
      {mapState === 'init' && <div className="mapedit-map placeholder" ref={mapDiv}>{t('pos.loading_map')}</div>}
      {(mapState === 'nokey' || mapState === 'error') && (
        <div className="mapedit-map" ref={leafletDiv} style={{ zIndex: 0 }} />
      )}

      <div className="mapedit-pin">
        <div className="mapedit-coords">
          <div><span className="mc-l">{t('pos.latitude')}</span><b>{hasPin ? Number(location.latitude).toFixed(6) : '—'}</b></div>
          <div><span className="mc-l">{t('pos.longitude')}</span><b>{hasPin ? Number(location.longitude).toFixed(6) : '—'}</b></div>
          <div><span className="mc-l">{t('pos.accuracy')}</span><b className="cap">{location.map_accuracy ? statusLabel('location', location.map_accuracy) : t('pos.not_set_2')}</b></div>
          <div><span className="mc-l">{t('pos.status')}</span><b className={confirmed ? 'ok' : 'pend'}>{confirmed ? t('pos.confirmed') : t('pos.needs_confirmation')}</b></div>
        </div>
        <ManualCoords onSet={manualPin} />
        <button className="btn primary" onClick={confirm} disabled={!hasPin || confirmed}>{confirmed ? t('pos.pin_confirmed_3') : t('pos.confirm_map_pin')}</button>
      </div>
    </div>
  );
}

function ManualCoords({ onSet }: { onSet: (lat: string, lng: string) => void }) {
  const [lat, setLat] = useState(''); const [lng, setLng] = useState('');
  return (
    <div className="mapedit-manual">
      <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder={t('pos.lat_e_g_39_9489')} inputMode="decimal" />
      <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder={t('pos.lng_e_g_75_0496')} inputMode="decimal" />
      <button className="btn ghost" onClick={() => onSet(lat, lng)} type="button">{t('pos.set_pin')}</button>
    </div>
  );
}
