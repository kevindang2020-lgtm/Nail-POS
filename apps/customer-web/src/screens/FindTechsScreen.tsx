// FindTechsScreen.tsx — P4 marketplace discovery: techs near the customer across ALL listed AIPowerSalon salons.
// Public+marketplace-enabled profiles only; balanced ranking comes from the backend (never rating alone).
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type NearbyTechCard, type NSNextAvailable } from '../api/customerApi';
import { businessDate, formatHhmm12 } from '@aipowersalon/date-time';
import { effectiveTimeZone, fmtYmd } from '@aipowersalon/mobile-sdk';

type Phase = 'ask' | 'loading' | 'results' | 'denied';

export function FindTechsScreen() {
  const nav = useNavigate();
  const [phase, setPhase] = useState<Phase>('ask');
  const [data, setData] = useState<{ radiusMiles: number; results: NearbyTechCard[] } | null>(null);
  const [q, setQ] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(15);
  const [minRating, setMinRating] = useState<number | undefined>(undefined);
  const [sort, setSort] = useState<'best' | 'rating' | 'reviews' | 'nearest' | 'soonest' | 'featured'>('best');
  const SORTS: { key: typeof sort; label: string }[] = [
    { key: 'best', label: 'Best Match' }, { key: 'rating', label: 'Highest Rated' }, { key: 'reviews', label: 'Most Reviews' },
    { key: 'nearest', label: 'Nearest' }, { key: 'soonest', label: 'Soonest Available' }, { key: 'featured', label: 'Featured' },
  ];
  const nextKey = (t: NearbyTechCard) => (t.nextAvailable ? `${t.nextAvailable.date}T${t.nextAvailable.startTime}` : '9999');
  const sortResults = (rows: NearbyTechCard[]) => {
    const r = [...rows];
    switch (sort) {
      case 'rating': r.sort((a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount); break;
      case 'reviews': r.sort((a, b) => b.reviewCount - a.reviewCount || b.averageRating - a.averageRating); break;
      case 'nearest': r.sort((a, b) => (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9)); break;
      case 'soonest': r.sort((a, b) => nextKey(a).localeCompare(nextKey(b))); break;
      case 'featured': r.sort((a, b) => Number(!!b.isFeatured) - Number(!!a.isFeatured) || b.averageRating - a.averageRating); break;
      default: break; // 'best' = server rank order (balanced techRankingScore)
    }
    return r;
  };
  const [error, setError] = useState<string | null>(null);
  const [aiInput, setAiInput] = useState('');
  const [aiQuery, setAiQuery] = useState('');

  const search = (lat: number, lng: number, query?: string, r = radius, mr = minRating) => {
    setPhase('loading');
    customerApi.techsNearby({ lat, lng, radiusMiles: r, q: query || undefined, minRating: mr })
      .then((d) => { setData(d); setPhase('results'); setError(null); })
      .catch((e: any) => { setError(e?.message || 'Search failed — try again.'); setPhase('results'); setData({ radiusMiles: r, results: [] }); });
  };
  const chip = (active: boolean): React.CSSProperties => ({ fontSize: 11.5, fontWeight: active ? 800 : 600, color: active ? '#fff' : '#A96F22', background: active ? '#A96F22' : '#F7EFE3', border: '1px solid #E6D3B3', borderRadius: 99, padding: '5px 11px', cursor: 'pointer' });
  const fmtNext = (n: NSNextAvailable | null) => { if (!n) return null; const isToday = n.date === businessDate(effectiveTimeZone()); return `${isToday ? 'Today' : fmtYmd(n.date, { weekday: 'short' })} ${formatHhmm12(n.startTime)}`; };

  const askLocation = () => {
    if (!navigator.geolocation) { setPhase('denied'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }; setCoords(c); search(c.lat, c.lng); },
      () => setPhase('denied'),
    );
  };
  useEffect(() => { /* wait for the explicit tap — same consent pattern as Find Salons */ }, []);

  const stars = (r: number) => '★'.repeat(Math.round(r)) || '☆';

  // "AI Match Me" = transparent relevance ranking over real tech data (specialties, badges, title, name). The typed
  // description is also sent to the server search; client-side we score keyword overlap and surface *why* each matched.
  const matchTerms = (s: string) => Array.from(new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)));
  const matchInfo = (t: NearbyTechCard, terms: string[]) => {
    const hay = [t.displayName, t.title || '', ...(t.specialties || []), ...(t.styleTags || []), ...(t.badges || [])].join(' ').toLowerCase();
    const hits = terms.filter((w) => hay.includes(w));
    return { score: hits.length, hits };
  };
  const rankByMatch = (rows: NearbyTechCard[], query: string) => {
    const terms = matchTerms(query);
    return rows.map((t, i) => ({ t, i, score: matchInfo(t, terms).score })).sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.t);
  };
  const runAiMatch = () => { const v = aiInput.trim(); setAiQuery(v); if (coords) search(coords.lat, coords.lng, v || q); };

  return (
    <div style={{ padding: 16, paddingBottom: 90 }}>
      <h1 style={{ margin: '4px 0 2px', fontSize: 21 }}>Find Techs Near Me</h1>
      <div className="cust-sub" style={{ marginBottom: 12 }}>Browse nail artists across every salon on AIPowerSalon.</div>

      {phase === 'ask' || phase === 'denied' ? (
        <div className="cust-card" style={{ padding: 16 }}>
          {phase === 'denied' ? <div className="cust-sub" style={{ marginBottom: 10 }}>Location is off — you can still find techs near your salon from its page, or allow location to search around you.</div>
            : <div className="cust-sub" style={{ marginBottom: 10 }}>Allow location access to find nail techs near you.</div>}
          <button className="cust-btn" style={{ width: '100%' }} onClick={askLocation}>Allow Location</button>
        </div>
      ) : null}

      {phase === 'loading' ? <div className="cust-sub">Finding techs near you…</div> : null}

      {phase === 'results' && data ? (
        <>
          <div className="cust-card" style={{ padding: 14, marginBottom: 12, border: '1px solid #E6D3B3', background: 'linear-gradient(135deg, #FBF6EC, #F7E8C8)' }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>✨ AI Match Me</div>
            <div className="cust-sub" style={{ fontSize: 12, marginTop: 2 }}>Describe your ideal look or tech — we’ll rank the best matches from their specialties.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input aria-label="Describe your ideal look" placeholder="e.g. gold chrome almond nail art" value={aiInput}
                onChange={(e) => setAiInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runAiMatch(); }}
                style={{ flex: 1, border: '1px solid var(--customer-border)', borderRadius: 12, padding: '10px 12px', fontSize: 14, background: '#fff' }} />
              <button className="cust-btn" style={{ padding: '0 16px' }} onClick={runAiMatch}>Match Me</button>
            </div>
            {aiQuery ? <button onClick={() => { setAiQuery(''); setAiInput(''); if (coords) search(coords.lat, coords.lng, q); }} style={{ marginTop: 8, border: 0, background: 'none', color: '#A96F22', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: 0 }}>✕ Clear AI match</button> : null}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input aria-label="Search techs" placeholder="Search name or specialty (e.g. Gel X)" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ flex: 1, border: '1px solid var(--customer-border)', borderRadius: 12, padding: '10px 12px', fontSize: 14, background: '#fff' }} />
            <button className="cust-btn" style={{ padding: '0 16px' }} onClick={() => coords && search(coords.lat, coords.lng, q)}>Search</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }} aria-label="Filters">
            {[5, 15, 25].map((r) => <button key={r} style={chip(radius === r)} onClick={() => { setRadius(r); if (coords) search(coords.lat, coords.lng, q, r, minRating); }}>{r} mi</button>)}
            <span style={{ width: 8 }} />
            {[undefined, 4, 4.5].map((mr) => <button key={String(mr)} style={chip(minRating === mr)} onClick={() => { setMinRating(mr); if (coords) search(coords.lat, coords.lng, q, radius, mr); }}>{mr == null ? 'Any rating' : `${mr}★+`}</button>)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }} aria-label="Sort" data-testid="tech-sort-bar">
            {SORTS.map((o) => <button key={o.key} style={chip(sort === o.key)} onClick={() => setSort(o.key)}>{o.label}</button>)}
          </div>
          {error ? <div className="cust-card" style={{ padding: 12, marginBottom: 10 }} role="status">{error}</div> : null}
          {data.results.length === 0 ? (
            <div className="cust-card" style={{ padding: 16 }}><div className="cust-sub">No techs found within {data.radiusMiles} miles — try widening your search.</div></div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {(aiQuery ? rankByMatch(sortResults(data.results), aiQuery) : sortResults(data.results)).map((t) => {
                const reason = aiQuery ? matchInfo(t, matchTerms(aiQuery)) : null;
                return (
                <button key={t.publicSlug} className="cust-card" onClick={() => nav(`/techs/${t.publicSlug}`)}
                  style={{ textAlign: 'left', padding: 14, cursor: 'pointer', border: '1px solid var(--customer-border)' }}>
                  {reason && reason.score > 0 ? <div style={{ fontSize: 11, fontWeight: 800, color: '#A96F22', marginBottom: 8 }}>✨ Matched on {reason.hits.slice(0, 3).join(', ')}</div> : null}
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ width: 52, height: 52, borderRadius: 99, overflow: 'hidden', border: '2px solid #C9962E', background: '#F2E7D5', flex: '0 0 auto', display: 'grid', placeItems: 'center', fontSize: 20 }}>
                      {t.avatarUrl ? <img src={t.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '💅'}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{t.displayName}{t.title ? <span className="cust-sub" style={{ fontWeight: 500 }}> · {t.title}</span> : null}</div>
                      <div style={{ fontSize: 12.5, color: '#A96F22', fontWeight: 700 }}>{stars(t.averageRating)} {t.averageRating > 0 ? t.averageRating.toFixed(1) : 'New'} <span className="cust-sub" style={{ fontWeight: 500 }}>({t.reviewCount} review{t.reviewCount === 1 ? '' : 's'})</span></div>
                      <div className="cust-sub" style={{ fontSize: 12 }}>{t.salonName} · {t.distanceMiles} mi{t.isFeatured ? ' · Featured' : ''}</div>
                      {t.nextAvailable ? <div style={{ fontSize: 11.5, color: '#2E7D32', fontWeight: 700 }}>Next: {fmtNext(t.nextAvailable)}</div> : null}
                      {t.badges?.length ? <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>{t.badges.map((b: string) => <span key={b} style={{ fontSize: 9.5, fontWeight: 800, color: '#A96F22', background: '#F7EFE3', border: '1px solid #E6D3B3', borderRadius: 99, padding: '2px 7px' }}>{b}</span>)}</div> : null}
                      {t.specialties?.length ? <div className="cust-sub" style={{ fontSize: 11.5, marginTop: 2 }}>{t.specialties.slice(0, 4).join(' · ')}</div> : null}
                      {t.styleTags?.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{t.styleTags.slice(0, 5).map((sg: string) => { const on = aiQuery && matchTerms(aiQuery).some((w) => sg.toLowerCase().includes(w)); return <span key={sg} style={{ fontSize: 9.5, fontWeight: 700, color: on ? '#fff' : '#5A4A2F', background: on ? '#C9962E' : '#F1EADC', borderRadius: 99, padding: '2px 7px' }}>{sg}</span>; })}</div> : null}
                    </div>
                  </div>
                  {t.featuredPortfolioPhotos?.length ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginTop: 10 }}>
                      {t.featuredPortfolioPhotos.slice(0, 3).map((u: string, i: number) => (
                        <img key={i} src={u} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10 }} />
                      ))}
                    </div>
                  ) : null}
                </button>
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
