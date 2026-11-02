// SalonPicker.tsx — choose a salon: search by name, city or ZIP, or "Use my location" for salons nearby (Kevin, Oct 3
// 2026). Used at sign-up (the salon becomes the customer's default) and on Profile → My salon (change it later).
// Only AIPowerSalon salons can be chosen — they are the ones a customer account can belong to; other places from the map
// search are not shown here.
import { useState } from 'react';
import { customerApi } from '../api/customerApi';
import type { SalonResult } from '@aipowersalon/api-contracts/customer';

const field: React.CSSProperties = { height: 40, border: '1px solid var(--line)', borderRadius: 10, padding: '0 12px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', width: '100%' };
export interface PickedSalon { salonId: string; name: string; city: string | null; distanceMiles: number | null }

export function SalonPicker({ onPick, geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : undefined }: { onPick: (s: PickedSalon) => void; geolocation?: Geolocation }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SalonResult[] | null>(null);
  const [busy, setBusy] = useState<'search' | 'near' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const show = (r: { results: SalonResult[] }) => {
    const mine = (r.results || []).filter((s) => s.is_aipowersalon_partner && s.source === 'aipowersalon');
    setResults(mine);
    setMsg(mine.length ? null : 'No AIPowerSalon salons found there yet — try another name, city or ZIP.');
  };
  const search = async () => {
    const text = q.trim(); if (!text) { setMsg('Type a salon name, city or ZIP.'); return; }
    setBusy('search'); setMsg(null);
    try { show(await customerApi.salonsNearby(/^\d{5}$/.test(text) ? { zip: text } : { searchText: text })); }
    catch (e: any) { setMsg(e?.message || 'Could not search salons right now.'); }
    finally { setBusy(null); }
  };
  const nearMe = () => {
    if (!geolocation) { setMsg('This device cannot share its location — search by name, city or ZIP instead.'); return; }
    setBusy('near'); setMsg(null);
    geolocation.getCurrentPosition(
      async (pos) => {
        try { show(await customerApi.salonsNearby({ lat: pos.coords.latitude, lng: pos.coords.longitude, radiusMiles: 25 })); }
        catch (e: any) { setMsg(e?.message || 'Could not find salons near you right now.'); }
        finally { setBusy(null); }
      },
      () => { setBusy(null); setMsg('Location was not shared — search by name, city or ZIP instead.'); },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={field} aria-label="Search salons" placeholder="Salon name, city or ZIP" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} />
        <button className="btn" type="button" onClick={search} disabled={busy !== null}>{busy === 'search' ? 'Searching…' : 'Search'}</button>
      </div>
      <button className="btn ghost" type="button" onClick={nearMe} disabled={busy !== null}>{busy === 'near' ? 'Finding salons near you…' : 'Use my location'}</button>
      {msg && <div className="muted" style={{ fontSize: 13 }}>{msg}</div>}
      {results && results.length > 0 && (
        <ul role="list" aria-label="Salons" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
          {results.map((s) => (
            <li key={s.salon_id}>
              <button type="button" className="btn ghost" style={{ width: '100%', justifyContent: 'space-between', display: 'flex', textAlign: 'left' }}
                onClick={() => onPick({ salonId: s.salon_id, name: s.name, city: s.city, distanceMiles: s.distance_miles })}>
                <span><b>{s.name}</b>{s.city ? ` · ${s.city}` : ''}</span>
                {s.distance_miles != null && <span className="muted" style={{ fontSize: 12 }}>{s.distance_miles.toFixed(1)} mi</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
