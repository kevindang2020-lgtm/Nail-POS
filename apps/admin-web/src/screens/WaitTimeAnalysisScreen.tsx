// WaitTimeAnalysisScreen.tsx — Super Admin → Booking & Check-In Monitor → Wait-Time Analysis (deep submodule).
// Read-only wait-time reporting from real queue data: wait = started_at − checked_in_at (queue processing begins −
// check-in completed). Shows distribution stats (avg/median/p90/longest), branch ranking (worst first), by-source and
// by-hour analysis, and abandonment. Reporting only — the Super Admin cannot reorder a live branch queue here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminBookingCheckinApi, type SAWaitTimeResponse } from '../api/superAdminBookingCheckinApi';

const GOLD = 'var(--g7,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const SELECT: React.CSSProperties = { height: 36, border: `1px solid ${LINE}`, borderRadius: 9, padding: '0 9px', background: 'var(--card,#fff)', fontSize: 12.5, color: '#3C3322' };
const STATUS_COLOR: Record<string, string> = { good: '#3E8F57', acceptable: '#3E8F57', at_risk: '#D09A36', poor: '#C86B3C', critical: '#B85B4D' };
const SOURCE_COLOR: Record<string, string> = { online: '#3C7FB6', ai_receptionist: '#8C7CC0', mobile_app: '#3E8F57', staff_created: '#A96F22', walk_in: '#C98A3B', kiosk: '#5B9AA0', other: '#9B8B78' };
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const RANGES = [{ k: '7', label: 'Last 7 days', days: 6 }, { k: '30', label: 'Last 30 days', days: 29 }, { k: '90', label: 'Last 90 days', days: 89 }];
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const hourLabel = (h: number) => { const am = h < 12; const hr = h % 12 === 0 ? 12 : h % 12; return `${hr}${am ? 'a' : 'p'}`; };

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px', background: 'var(--card,#fff)' }}>
      <div style={{ fontSize: 11.5, color: '#9B8B78', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: tone || '#3C3322' }}>{value}</div>
      {sub ? <div style={{ fontSize: 11.5, color: '#9B8B78', marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLOR[status] || '#9B8B78';
  return <span style={{ fontSize: 11.5, fontWeight: 700, color: c, background: `${c}1A`, borderRadius: 999, padding: '1px 9px' }}>{titleCase(status)}</span>;
}

export default function WaitTimeAnalysisScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<SAWaitTimeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = sp.get('range') || '7';
  const range = useMemo(() => RANGES.find((r) => r.k === rangeKey) || RANGES[0], [rangeKey]);
  const setRange = (k: string) => { const n = new URLSearchParams(sp); n.set('range', k); setSp(n, { replace: true }); };

  const load = useCallback((signal: AbortSignal) => {
    setLoading(true); setError(null);
    superAdminBookingCheckinApi.waitTimeAnalysis({ startDate: isoDaysAgo(range.days), endDate: isoDaysAgo(0) })
      .then((d) => { if (!signal.aborted) { setData(d); setLoading(false); } })
      .catch((e: unknown) => { if (!signal.aborted) { setError(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); } });
  }, [range]);
  useEffect(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);

  const maxBranch = data ? Math.max(1, ...data.branches.map((b) => b.avgWaitSec)) : 1;
  const maxHour = data ? Math.max(1, ...data.hours.map((h) => h.avgWaitSec)) : 1;

  return (
    <main className="content" style={{ padding: '16px 18px', overflow: 'auto' }}>
      <button onClick={() => nav('/booking-checkin')} className="text-[#2C2118] px-1 py-2 text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]">← Monitor</button>
      <div className=" flex flex-col sm:flex-row justify-between gap-3" >
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0 }}>Wait-Time Analysis</h1>
          <div style={{ color: '#7A6C57', fontSize: 12.5 }}>Wait = queue start − check-in complete. Reporting only — live queue order is managed in the branch POS.</div>
        </div>
        <div style={{ flex: 1 }} />
        <select className="max-w-[170px]" aria-label="Date range" value={rangeKey} onChange={(e) => setRange(e.target.value)} style={SELECT}>
          {RANGES.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
        </select>
      </div>

      {error ? (
        <div style={{ marginTop: 14, border: '1px solid #E3B9B1', background: '#FCF3F1', borderRadius: 12, padding: 14 }}>
          <div style={{ color: '#B85B4D', fontWeight: 700, fontSize: 13 }}>Couldn’t load wait-time analysis.</div>
          <div style={{ color: '#8a6a62', fontSize: 12, marginTop: 3 }}>{error}</div>
          <button onClick={() => { const ac = new AbortController(); load(ac.signal); }} style={{ marginTop: 10, ...SELECT, cursor: 'pointer', color: GOLD, fontWeight: 700 }}>Retry</button>
        </div>
      ) : null}

      {loading && !data ? <div style={{ marginTop: 16, color: '#A99B86', fontSize: 13 }}>Loading wait-time analysis…</div> : null}

      {data && !data.summary.available && !loading ? (
        <div style={{ marginTop: 16, border: `1px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center', color: '#A99B86' }}>No completed waits in this period.</div>
      ) : null}

      {data && data.summary.available ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginTop: 14 }}>
            <Stat label="Avg Wait" value={data.summary.avgWaitDisplay} sub={`${data.summary.sampled} samples`} />
            <Stat label="Median" value={data.summary.medianWaitDisplay} />
            <Stat label="90th %ile" value={data.summary.p90WaitDisplay} tone="#A96F22" />
            <Stat label="Longest" value={data.summary.longestWaitDisplay} tone="#B85B4D" />
            <Stat label="Abandonment" value={`${data.summary.abandonmentRate}%`} sub={`${data.summary.abandoned} of ${data.summary.entered}`} tone={data.summary.abandonmentRate > 5 ? '#B85B4D' : '#3C3322'} />
          </div>

          <div style={{ marginTop: 16, fontWeight: 800, fontSize: 13.5 }}>Branch Ranking <span style={{ color: '#9B8B78', fontWeight: 400 }}>(worst first)</span></div>
          <div style={{ marginTop: 8, background: 'var(--card,#fff)', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ color: '#9B8B78', textAlign: 'left', background: '#FBF6EC' }}>
                {['#', 'Branch', 'Avg Wait', 'Median', '90th %ile', 'Longest', 'Check-Ins', 'Status', 'Relative'].map((h) => <th key={h} style={{ fontWeight: 600, padding: '9px 12px' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.branches.map((b, i) => (
                  <tr key={b.branchId} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td style={{ padding: '9px 12px', color: '#9B8B78' }}>{i + 1}</td>
                    <td style={{ padding: '9px 12px', fontWeight: 700 }}>{b.branch}</td>
                    <td style={{ padding: '9px 12px', fontWeight: 700 }}>{b.avgWaitDisplay}</td>
                    <td style={{ padding: '9px 12px' }}>{Math.floor(b.medianWaitSec / 60)}m {String(b.medianWaitSec % 60).padStart(2, '0')}s</td>
                    <td style={{ padding: '9px 12px' }}>{Math.floor(b.p90WaitSec / 60)}m {String(b.p90WaitSec % 60).padStart(2, '0')}s</td>
                    <td style={{ padding: '9px 12px', color: '#6D5F50' }}>{b.longestWaitDisplay}</td>
                    <td style={{ padding: '9px 12px' }}>{b.checkins}</td>
                    <td style={{ padding: '9px 12px' }}><StatusPill status={b.status} /></td>
                    <td style={{ padding: '9px 12px', minWidth: 110 }}><div style={{ height: 8, background: '#F0E7D6', borderRadius: 5, overflow: 'hidden' }}><div style={{ width: `${Math.round((b.avgWaitSec / maxBranch) * 100)}%`, height: '100%', background: STATUS_COLOR[b.status] || '#9B8B78' }} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
            <div style={{ background: 'var(--card,#fff)', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 10 }}>Avg Wait by Source</div>
              {data.sources.length === 0 ? <div style={{ color: '#A99B86', fontSize: 12.5 }}>No source data.</div> : data.sources.map((s) => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '7px 0', fontSize: 12.5 }}>
                  <span style={{ width: 96, color: '#5C5040' }}>{s.label}</span>
                  <div style={{ flex: 1, height: 8, background: '#F0E7D6', borderRadius: 5, overflow: 'hidden' }}><div style={{ width: `${Math.round((s.avgWaitSec / Math.max(1, ...data.sources.map((x) => x.avgWaitSec))) * 100)}%`, height: '100%', background: SOURCE_COLOR[s.key] || '#9B8B78' }} /></div>
                  <span style={{ width: 64, textAlign: 'right', fontWeight: 700 }}>{s.avgWaitDisplay}</span>
                </div>
              ))}
            </div>
            <div style={{ background: 'var(--card,#fff)', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 10 }}>Avg Wait by Hour</div>
              {data.hours.length === 0 ? <div style={{ color: '#A99B86', fontSize: 12.5 }}>No hourly data.</div> : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
                  {data.hours.map((h) => (
                    <div key={h.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={`${hourLabel(h.hour)} · ${Math.round(h.avgWaitSec / 60)}m · ${h.waits} waits`}>
                      <div style={{ width: '100%', height: `${Math.round((h.avgWaitSec / maxHour) * 100)}%`, minHeight: 3, background: GOLD, borderRadius: '3px 3px 0 0' }} />
                      <span style={{ fontSize: 9.5, color: '#9B8B78' }}>{hourLabel(h.hour)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
