// CheckinPerformanceScreen.tsx — Super Admin → Booking & Check-In Monitor → Check-In Performance (deep submodule).
// Read-only per-method check-in throughput and timing from real go_checkin_sessions: completion rate, expiries, and
// average check-in duration (from completed_at − started_at). No receptionist actions are performed here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminBookingCheckinApi, type SACheckinPerformanceResponse } from '../api/superAdminBookingCheckinApi';

const GOLD = 'var(--g7,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const SELECT: React.CSSProperties = { height: 36, border: `1px solid ${LINE}`, borderRadius: 9, padding: '0 9px', background: 'var(--card,#fff)', fontSize: 12.5, color: '#3C3322' };
const METHOD_COLOR: Record<string, string> = { kiosk: '#5B9AA0', ipad: '#3C7FB6', tablet: '#3E8F57', front_desk: '#A96F22', display: '#8C7CC0', qr_code: '#C98A3B', unknown: '#9B8B78' };
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const RANGES = [{ k: '7', label: 'Last 7 days', days: 6 }, { k: '30', label: 'Last 30 days', days: 29 }, { k: '90', label: 'Last 90 days', days: 89 }];

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px', background: 'var(--card,#fff)' }}>
      <div style={{ fontSize: 11.5, color: '#9B8B78', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: tone || '#3C3322' }}>{value}</div>
      {sub ? <div style={{ fontSize: 11.5, color: '#9B8B78', marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}
function RateCell({ rate }: { rate: number }) {
  const c = rate >= 85 ? '#3E8F57' : rate >= 65 ? '#A96F22' : '#B85B4D';
  return <span style={{ fontWeight: 700, color: c }}>{rate}%</span>;
}

export default function CheckinPerformanceScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<SACheckinPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = sp.get('range') || '7';
  const range = useMemo(() => RANGES.find((r) => r.k === rangeKey) || RANGES[0], [rangeKey]);
  const setRange = (k: string) => { const n = new URLSearchParams(sp); n.set('range', k); setSp(n, { replace: true }); };

  const load = useCallback((signal: AbortSignal) => {
    setLoading(true); setError(null);
    superAdminBookingCheckinApi.checkinPerformance({ startDate: isoDaysAgo(range.days), endDate: isoDaysAgo(0) })
      .then((d) => { if (!signal.aborted) { setData(d); setLoading(false); } })
      .catch((e: unknown) => { if (!signal.aborted) { setError(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); } });
  }, [range]);
  useEffect(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);

  const maxSessions = data ? Math.max(1, ...data.methods.map((m) => m.sessions)) : 1;

  return (
    <main className="content" style={{ padding: '16px 18px', overflow: 'auto' }}>
      <button onClick={() => nav('/booking-checkin')} className="text-[#2C2118] px-1 py-2 text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]">← Monitor</button>
      <div className=" flex flex-col sm:flex-row justify-between gap-3" >
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0 }}>Check-In Performance</h1>
          <div style={{ color: '#7A6C57', fontSize: 12.5 }}>Throughput, completion and timing by check-in method, from device session data.</div>
        </div>
        <div style={{ flex: 1 }} />
        <select className="max-w-[170px]" aria-label="Date range" value={rangeKey} onChange={(e) => setRange(e.target.value)} style={SELECT}>
          {RANGES.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
        </select>
      </div>

      {error ? (
        <div style={{ marginTop: 14, border: '1px solid #E3B9B1', background: '#FCF3F1', borderRadius: 12, padding: 14 }}>
          <div style={{ color: '#B85B4D', fontWeight: 700, fontSize: 13 }}>Couldn’t load check-in performance.</div>
          <div style={{ color: '#8a6a62', fontSize: 12, marginTop: 3 }}>{error}</div>
          <button onClick={() => { const ac = new AbortController(); load(ac.signal); }} style={{ marginTop: 10, ...SELECT, cursor: 'pointer', color: GOLD, fontWeight: 700 }}>Retry</button>
        </div>
      ) : null}

      {loading && !data ? <div style={{ marginTop: 16, color: '#A99B86', fontSize: 13 }}>Loading check-in performance…</div> : null}

      {data && !data.summary.available && !loading ? (
        <div style={{ marginTop: 16, border: `1px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center', color: '#A99B86' }}>No check-in sessions in this period.</div>
      ) : null}

      {data && data.summary.available ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginTop: 14 }}>
            <Stat label="Sessions" value={String(data.summary.totalSessions)} />
            <Stat label="Completed" value={String(data.summary.completed)} tone="#3E8F57" />
            <Stat label="Completion" value={`${data.summary.completionRate}%`} tone={data.summary.completionRate >= 85 ? '#3E8F57' : data.summary.completionRate >= 65 ? '#A96F22' : '#B85B4D'} />
            <Stat label="Expired" value={String(data.summary.expired)} tone={data.summary.expired > 0 ? '#B85B4D' : '#3C3322'} />
            <Stat label="Avg Check-In" value={data.summary.avgDurationDisplay} sub="completed sessions" />
          </div>

          <div style={{ marginTop: 16, background: 'var(--card,#fff)', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ color: '#9B8B78', textAlign: 'left', background: '#FBF6EC' }}>
                {['Method', 'Sessions', 'Completed', 'Expired', 'Failed', 'Completion', 'Avg Check-In', 'Share'].map((h) => <th key={h} style={{ fontWeight: 600, padding: '9px 12px' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.methods.map((m) => (
                  <tr key={m.key} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td style={{ padding: '9px 12px', fontWeight: 700 }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: METHOD_COLOR[m.key] || '#9B8B78', marginRight: 7 }} />{m.label}</td>
                    <td style={{ padding: '9px 12px', fontWeight: 700 }}>{m.sessions}</td>
                    <td style={{ padding: '9px 12px' }}>{m.completed}</td>
                    <td style={{ padding: '9px 12px', color: m.expired > 0 ? '#B85B4D' : '#6D5F50' }}>{m.expired}</td>
                    <td style={{ padding: '9px 12px', color: m.failed > 0 ? '#B85B4D' : '#6D5F50' }}>{m.failed}</td>
                    <td style={{ padding: '9px 12px' }}><RateCell rate={m.completionRate} /></td>
                    <td style={{ padding: '9px 12px', color: '#5C5040' }}>{m.avgDurationDisplay}</td>
                    <td style={{ padding: '9px 12px', minWidth: 120 }}>
                      <div style={{ height: 8, background: '#F0E7D6', borderRadius: 5, overflow: 'hidden' }}><div style={{ width: `${Math.round((m.sessions / maxSessions) * 100)}%`, height: '100%', background: METHOD_COLOR[m.key] || '#9B8B78' }} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </main>
  );
}
