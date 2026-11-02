import { useMemo, useState } from 'react';
import { useOwnerSalon } from './OwnerSalonContext';
import type { OwnerPortfolioSalonView } from '@aipowersalon/api-contracts/tenant';

// SalonSwitcher — the control that makes one owner account work across many salons.
//
// It shows every salon the SERVER said this owner may enter, plus an "All Salons" portfolio view. Picking one asks
// the server to switch; the server re-verifies the membership and re-issues the session. Nothing here grants
// access — it only asks.
//
// An INACTIVE salon is still listed (the owner should be able to see that it exists and that it is suspended) but
// cannot be selected. Hiding it entirely would make a suspended salon look deleted.

const GOLD = 'var(--owner-primary, #A96F22)';
const LINE = 'var(--line, #E4DACA)';
const TEXT = 'var(--text, #2A2118)';
const MUTED = '#8A7A66';

const LEVEL_LABEL: Record<OwnerPortfolioSalonView['accessLevel'], string> = {
  owner: 'Owner',
  manager: 'Manager',
  viewer: 'Viewer',
  report_only: 'Reports only',
};

export function SalonSwitcher() {
  const { salons, activeSalon, viewingAllSalons, switchSalon, showAllSalons, loading, error, favorites, toggleFavorite, recentSalons } = useOwnerSalon();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Pinned salons first — that is the whole point of pinning one.
    const byFavorite = (a: OwnerPortfolioSalonView, b: OwnerPortfolioSalonView) =>
      Number(favorites.includes(b.salonId)) - Number(favorites.includes(a.salonId));

    if (!needle) return [...salons].sort(byFavorite);
    return salons.filter((s) =>
      s.salonName.toLowerCase().includes(needle) ||
      s.storeCode.toLowerCase().includes(needle) ||
      s.branches.some((b) => `${b.name} ${b.city ?? ''} ${b.state ?? ''}`.toLowerCase().includes(needle)),
    ).sort(byFavorite);
  }, [salons, q, favorites]);

  const pick = async (salonId: string, branchId?: string | null) => {
    setBusy(salonId);
    setSwitchError(null);
    try {
      await switchSalon(salonId, branchId ?? null);
      setOpen(false);
      setQ('');
    } catch (e: any) {
      // The switch was refused. The owner stays exactly where they were — we never move them optimistically.
      setSwitchError(e?.message || 'That salon is not available for your account.');
    } finally {
      setBusy(null);
    }
  };

  const label = loading ? 'Loading…' : viewingAllSalons ? 'All Salons' : (activeSalon?.salonName ?? 'Select a salon');

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active salon: ${label}. Change salon.`}
        style={{
         width:"100%", display:  'flex', alignItems: 'center', gap: 15, minHeight: 60, padding: '8px 12px',
          border: `none`,  background: '#fff', cursor: 'pointer', font: 'inherit',
        }}
      >
        <span style={{ width: 40, height: 40, borderRadius: 8, background: '#F5EEE2', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M4 10V20h16V10" /><path d="M3 10l2-5h14l2 5" /><path d="M9 20v-5h6v5" />
          </svg>
        </span>
        <span style={{ textAlign: 'left', lineHeight: 1.2 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: TEXT }}>{label}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: MUTED }}>
            {viewingAllSalons ? `${salons.length} salon${salons.length === 1 ? '' : 's'}` : (activeSalon ? LEVEL_LABEL[activeSalon.accessLevel] : '')}
          </span>
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" aria-hidden style={{ marginLeft: 4 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Your salons"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 40, width: 340, maxHeight: 460,
            overflowY: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12,
            boxShadow: '0 18px 46px rgba(42,33,24,.16)', padding: 8,
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search salons, locations, store code"
            aria-label="Search your salons"
            style={{ width: '100%', height: 38, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 10px', fontSize: 14, marginBottom: 6, fontFamily: 'inherit' }}
          />

          {(error || switchError) ? (
            <div role="alert" style={{ margin: '4px 2px 8px', padding: '8px 10px', borderRadius: 8, fontSize: 13, background: '#FBEDE9', border: '1px solid #F0D2C9', color: '#8F3226' }}>
              {switchError || error}
            </div>
          ) : null}

          <button
            type="button"
            role="option"
            aria-selected={viewingAllSalons}
            onClick={() => { showAllSalons(); setOpen(false); }}
            style={{
              width: '100%', textAlign: 'left', minHeight: 44, padding: '9px 10px', borderRadius: 8,
              border: 0, cursor: 'pointer', font: 'inherit',
              background: viewingAllSalons ? '#F5EEE2' : 'transparent', color: TEXT, fontWeight: 700, fontSize: 14,
            }}
          >
            All Salons
            <span style={{ display: 'block', fontSize: 11.5, color: MUTED, fontWeight: 400 }}>Portfolio overview</span>
          </button>

          <div style={{ height: 1, background: LINE, margin: '6px 2px' }} />

          {filtered.length === 0 ? (
            <p style={{ padding: '12px 10px', color: MUTED, fontSize: 13, margin: 0 }}>
              {salons.length === 0 ? 'No salons are assigned to your account yet.' : 'No salons match that search.'}
            </p>
          ) : filtered.map((s) => (
            <div key={s.salonId} style={{ position: 'relative' }}>
              <button
                type="button"
                role="option"
                aria-selected={s.salonId === activeSalon?.salonId && !viewingAllSalons}
                disabled={!s.selectable || busy === s.salonId}
                onClick={() => pick(s.salonId)}
                title={s.selectable ? undefined : 'This salon is not currently active'}
                style={{
                  width: '100%', textAlign: 'left', minHeight: 44, padding: '9px 10px', borderRadius: 8,
                  border: 0, font: 'inherit', cursor: s.selectable ? 'pointer' : 'not-allowed',
                  opacity: s.selectable ? 1 : 0.5,
                  background: (!viewingAllSalons && s.salonId === activeSalon?.salonId) ? '#F5EEE2' : 'transparent',
                }}
              >
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>
                    {busy === s.salonId ? 'Switching…' : s.salonName}
                  </span>
                  <span style={{ fontSize: 10.5, color: GOLD, fontWeight: 700, letterSpacing: '.04em' }}>
                    {LEVEL_LABEL[s.accessLevel].toUpperCase()}
                  </span>
                </span>
                <span style={{ display: 'block', fontSize: 11.5, color: MUTED }}>
                  {s.storeCode}
                  {!s.selectable ? ' · Inactive' : ''}
                </span>
              </button>

              {/* Pin. A device-local convenience — it can never widen what the server authorized. */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleFavorite(s.salonId); }}
                aria-label={favorites.includes(s.salonId) ? `Unpin ${s.salonName}` : `Pin ${s.salonName}`}
                aria-pressed={favorites.includes(s.salonId)}
                style={{
                  position: 'absolute', right: 8, top: 8, width: 32, height: 32, display: 'grid', placeItems: 'center',
                  border: 0, borderRadius: 8, background: 'transparent', cursor: 'pointer',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24"
                  fill={favorites.includes(s.salonId) ? GOLD : 'none'}
                  stroke={favorites.includes(s.salonId) ? GOLD : '#C9BCA4'} strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9Z" />
                </svg>
              </button>

              {/* Locations, when the salon has more than one. */}
              {s.branches.length > 1 && s.selectable ? (
                <div style={{ paddingLeft: 12 }}>
                  {s.branches.map((b) => (
                    <button
                      key={b.branchId}
                      type="button"
                      disabled={!b.isActive}
                      onClick={() => pick(s.salonId, b.branchId)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', minHeight: 36, padding: '6px 10px',
                        borderRadius: 6, border: 0, background: 'transparent', font: 'inherit',
                        cursor: b.isActive ? 'pointer' : 'not-allowed', opacity: b.isActive ? 1 : 0.5,
                        fontSize: 12.5, color: MUTED,
                      }}
                    >
                      {b.name}{b.city ? ` — ${b.city}` : ''}{b.state ? `, ${b.state}` : ''}
                      {!b.isActive ? ' · Closed' : ''}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}

          {recentSalons.length > 0 && !q.trim() ? (
            <>
              <div style={{ height: 1, background: LINE, margin: '8px 2px 6px' }} />
              <div style={{ fontSize: 10.5, color: MUTED, fontWeight: 700, letterSpacing: '.06em', padding: '0 10px 4px' }}>
                RECENTLY VIEWED
              </div>
              <div style={{ display: 'flex', gap: 8, padding: '0 4px 4px', overflowX: 'auto' }}>
                {recentSalons.map((s) => (
                  <button
                    key={`recent-${s.salonId}`}
                    type="button"
                    disabled={!s.selectable}
                    onClick={() => pick(s.salonId)}
                    style={{
                      flex: '0 0 auto', minWidth: 132, minHeight: 44, textAlign: 'left', padding: '7px 10px',
                      border: `1px solid ${LINE}`, borderRadius: 9, background: '#FFFDF8', font: 'inherit',
                      cursor: s.selectable ? 'pointer' : 'not-allowed', opacity: s.selectable ? 1 : 0.5,
                    }}
                  >
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: TEXT }}>{s.salonName}</span>
                    <span style={{ display: 'block', fontSize: 11, color: MUTED }}>
                      {s.branches[0]?.city ?? s.storeCode}{s.branches[0]?.state ? `, ${s.branches[0].state}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
