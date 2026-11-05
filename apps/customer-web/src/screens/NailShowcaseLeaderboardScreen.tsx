// NailShowcaseLeaderboardScreen.tsx — NailShowcase Rankings. Top Creators board with tier (Top 10…500), scope
// (All AIPowerSalon / This Salon), and period (All Time / This Week / This Month) filters. The signed-in customer's own
// standing sits at the top. Private profiles never appear — the server excludes them. Empty/loading/error are honest.
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  customerNailShowcaseLeaderboardApi, LEADERBOARD_LIMITS,
  type LeaderboardEntry, type LeaderboardPeriod, type LeaderboardScope,
} from '../api/customerNailShowcaseLeaderboardApi';
import { NailShowcaseLeaderboardCard } from './NailShowcaseLeaderboardCard';
import { NailShowcaseMyRankCard } from './NailShowcaseMyRankCard';

const SCOPES: { key: LeaderboardScope; label: string }[] = [
  { key: 'platform', label: 'All AIPowerSalon' }, { key: 'salon', label: 'This Salon' }, { key: 'nearby', label: 'Nearby' },
];
const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: 'all_time', label: 'All Time' }, { key: 'weekly', label: 'This Week' }, { key: 'monthly', label: 'This Month' },
];

export function NailShowcaseLeaderboardScreen() {
  const nav = useNavigate();
  const [limit, setLimit] = useState<number>(10);
  const [scope, setScope] = useState<LeaderboardScope>('platform');
  const [period, setPeriod] = useState<LeaderboardPeriod>('all_time');
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setEntries(null); setError(null);
    let live = true;
    customerNailShowcaseLeaderboardApi.leaderboard({ limit, scope, period })
      .then((r) => { if (live) setEntries(r.entries); })
      .catch((e: { message?: string }) => { if (live) setError(e?.message || 'Could not load the rankings.'); });
    return () => { live = false; };
  }, [limit, scope, period]);
  useEffect(() => load(), [load]);

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 'calc(100vh - 120px)', flex: 1, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>NailShowcase Rankings</h1>
      </div>

      <NailShowcaseMyRankCard />

      <div className="cust-label">Top NailShowcase Creators</div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {LEADERBOARD_LIMITS.map((n) => <Chip key={n} active={limit === n} label={`Top ${n}`} onClick={() => setLimit(n)} />)}
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {SCOPES.map((s) => <Chip key={s.key} active={scope === s.key} label={s.label} subtle onClick={() => setScope(s.key)} />)}
        {PERIODS.map((p) => <Chip key={p.key} active={period === p.key} label={p.label} subtle onClick={() => setPeriod(p.key)} />)}
      </div>

      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !entries ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="cust-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="cust-skel" style={{ width: 44, height: 44, borderRadius: '50%' }} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="cust-skel" style={{ width: 120, height: 16 }} />
                  <div className="cust-skel" style={{ width: 80, height: 12 }} />
                </div>
                <div className="cust-skel" style={{ width: 24, height: 24, borderRadius: 12 }} />
              </div>
            ))}
          </div>
        )
        : entries.length === 0 ? (
          <div className="cust-card" style={{ flex: 1, minHeight: 280, padding: 28, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div aria-hidden style={{ fontSize: 54 }}>🏆</div>
            <h2 className="cust-h2" style={{ marginTop: 8 }}>No ranked creators yet</h2>
            <div className="cust-sub" style={{ marginTop: 4 }}>Be the first — share your nails and earn likes to climb the board.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {entries.map((e) => <NailShowcaseLeaderboardCard key={e.customerId} entry={e} onOpen={(id) => nav(`/social/profile/${id}`)} />)}
          </div>
        )}
    </div>
  );
}

function Chip({ active, label, onClick, subtle }: { active: boolean; label: string; onClick: () => void; subtle?: boolean }) {
  return (
    <button onClick={onClick} style={{
      border: active ? 0 : '1px solid var(--customer-border, #e6e1ef)', borderRadius: 999, whiteSpace: 'nowrap', cursor: 'pointer',
      fontSize: 13, fontWeight: 700, padding: '7px 14px',
      background: active ? (subtle ? 'var(--customer-text, #1c1c1c)' : 'var(--customer-primary)') : 'transparent',
      color: active ? '#fff' : 'var(--customer-text-muted, #6b6b6b)',
    }}>{label}</button>
  );
}
