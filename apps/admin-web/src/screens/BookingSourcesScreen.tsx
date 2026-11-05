// BookingSourcesScreen.tsx — Super Admin → Booking & Check-In Monitor → Booking Sources (deep submodule). Read-only
// per-source performance: how each channel (online, AI receptionist, mobile app, staff-created, walk-in, kiosk)
// performs on confirmation, completion, cancellation and failure. Aggregated (≤6 source rows), reconciles with the
// Overview source breakdown. No receptionist actions are performed here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminBookingCheckinApi, type SABookingSourcesResponse, type SABookingSourceRow } from '../api/superAdminBookingCheckinApi';

const GOLD = 'var(--g7,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const SELECT: React.CSSProperties = { height: 36, border: `1px solid ${LINE}`, borderRadius: 9, padding: '0 9px', background: 'var(--card,#fff)', fontSize: 12.5, color: '#3C3322' };
const SOURCE_COLOR: Record<string, string> = { online: '#3C7FB6', ai_receptionist: '#8C7CC0', mobile_app: '#3E8F57', staff_created: '#A96F22', walk_in: '#C98A3B', kiosk: '#5B9AA0', other: '#9B8B78' };
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const RANGES = [{ k: '7', label: 'Last 7 days', days: 6 }, { k: '30', label: 'Last 30 days', days: 29 }, { k: '90', label: 'Last 90 days', days: 89 }];

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return <div style={{ height: 8, background: '#F0E7D6', borderRadius: 5, overflow: 'hidden' }}><div style={{ width: `${w}%`, height: '100%', background: color }} /></div>;
}
function RateCell({ rate }: { rate: number }) {
  const c = rate >= 80 ? '#3E8F57' : rate >= 60 ? '#A96F22' : '#B85B4D';
  return <span style={{ fontWeight: 700, color: c }}>{rate}%</span>;
}

function SourceCard({ row, max }: { row: SABookingSourceRow; max: number }) {
  const color = SOURCE_COLOR[row.key] || '#9B8B78';
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, background: 'var(--card,#fff)', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
        <div style={{ fontWeight: 800, fontSize: 13.5 }}>{row.label}</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 20, fontWeight: 800 }}>{row.total}</div>
      </div>
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', fontSize: 12 }}>
        <div><div style={{ color: '#9B8B78' }}>Confirmation</div><RateCell rate={row.confirmationRate} /></div>
        <div><div style={{ color: '#9B8B78' }}>Completion</div><RateCell rate={row.completionRate} /></div>
        <div><div style={{ color: '#9B8B78' }}>Cancellation</div><span style={{ fontWeight: 700, color: row.cancellationRate > 15 ? '#B85B4D' : '#6D5F50' }}>{row.cancellationRate}%</span></div>
        <div><div style={{ color: '#9B8B78' }}>Failed</div><span style={{ fontWeight: 700, color: row.failed > 0 ? '#B85B4D' : '#6D5F50' }}>{row.failed}</span></div>
      </div>
      <div style={{ marginTop: 10 }}><Bar value={row.total} max={max} color={color} /></div>
    </div>
  );
}

export default function BookingSourcesScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<SABookingSourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = sp.get('range') || '7';
  const range = useMemo(() => RANGES.find((r) => r.k === rangeKey) || RANGES[0], [rangeKey]);
  const setRange = (k: string) => { const n = new URLSearchParams(sp); n.set('range', k); setSp(n, { replace: true }); };

  const load = useCallback((signal: AbortSignal) => {
    setLoading(true); setError(null);
    superAdminBookingCheckinApi.bookingSources({ startDate: isoDaysAgo(range.days), endDate: isoDaysAgo(0) })
      .then((d) => { if (!signal.aborted) { setData(d); setLoading(false); } })
      .catch((e: unknown) => { if (!signal.aborted) { setError(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); } });
  }, [range]);
  useEffect(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);

  const maxTotal = data ? Math.max(1, ...data.rows.map((r) => r.total)) : 1;
  const hasData = data && data.rows.some((r) => r.total > 0 || r.failed > 0);

  return (
    <main className="content" style={{ padding: '16px 18px', overflow: 'auto' }}>
      <button
        className="text-[#2C2118] px-1 py-2 text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]"
        onClick={() => nav('/booking-checkin')}
      >
        ← Monitor
      </button>
      <div className=" flex flex-col lg:flex-row justify-between gap-3" >
        <div className="vh">
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0 }}>Booking Source Performance</h1>
          <div style={{ color: '#7A6C57', fontSize: 12.5 }}>How each booking channel performs on confirmation, completion, cancellation and failure.</div>
        </div>
        <div style={{ flex: 1 }} />
        <select aria-label="Date range" value={rangeKey} onChange={(e) => setRange(e.target.value)} style={SELECT}>
          {RANGES.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
        </select>
      </div>

      {error ? (
        <div style={{ marginTop: 14, border: '1px solid #E3B9B1', background: '#FCF3F1', borderRadius: 12, padding: 14 }}>
          <div style={{ color: '#B85B4D', fontWeight: 700, fontSize: 13 }}>Couldn’t load booking sources.</div>
          <div style={{ color: '#8a6a62', fontSize: 12, marginTop: 3 }}>{error}</div>
          <button onClick={() => { const ac = new AbortController(); load(ac.signal); }} style={{ marginTop: 10, ...SELECT, cursor: 'pointer', color: GOLD, fontWeight: 700 }}>Retry</button>
        </div>
      ) : null}

      {loading && !data ? <div style={{ marginTop: 16, color: '#A99B86', fontSize: 13 }}>Loading source performance…</div> : null}

      {data && !hasData && !loading ? (
        <div style={{ marginTop: 16, border: `1px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center', color: '#A99B86' }}>No bookings in this period.</div>
      ) : null}

      {data && hasData ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12, marginTop: 14 }}>
            {data.rows.filter((r) => r.total > 0 || r.failed > 0).map((r) => <SourceCard key={r.key} row={r} max={maxTotal} />)}
          </div>

          <div className="mt-4 w-full max-w-full overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card,#fff)]">
            <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
              <thead><tr style={{ color: '#9B8B78', textAlign: 'left', background: '#FBF6EC' }}>
                {['Source', 'Total', 'Confirmed', 'Completed', 'Cancelled', 'No-Show', 'Failed', 'Confirm %', 'Cancel %'].map((h) => <th key={h} style={{ fontWeight: 600, padding: '9px 12px' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.rows.filter((r) => r.total > 0 || r.failed > 0).map((r) => (
                  <tr key={r.key} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td style={{ padding: '9px 12px', fontWeight: 700 }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: SOURCE_COLOR[r.key] || '#9B8B78', marginRight: 7 }} />{r.label}</td>
                    <td style={{ padding: '9px 12px', fontWeight: 700 }}>{r.total}</td>
                    <td style={{ padding: '9px 12px' }}>{r.confirmed}</td>
                    <td style={{ padding: '9px 12px' }}>{r.completed}</td>
                    <td style={{ padding: '9px 12px' }}>{r.cancelled}</td>
                    <td style={{ padding: '9px 12px' }}>{r.noShow}</td>
                    <td style={{ padding: '9px 12px', color: r.failed > 0 ? '#B85B4D' : '#6D5F50', fontWeight: r.failed > 0 ? 700 : 400 }}>{r.failed}</td>
                    <td style={{ padding: '9px 12px' }}><RateCell rate={r.confirmationRate} /></td>
                    <td style={{ padding: '9px 12px', color: r.cancellationRate > 15 ? '#B85B4D' : '#6D5F50' }}>{r.cancellationRate}%</td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${LINE}`, background: '#FBF6EC', fontWeight: 700 }}>
                  <td style={{ padding: '9px 12px' }}>All Sources</td>
                  <td style={{ padding: '9px 12px' }}>{data.totals.total}</td>
                  <td style={{ padding: '9px 12px' }}>{data.totals.confirmed}</td>
                  <td style={{ padding: '9px 12px' }}>{data.totals.completed}</td>
                  <td style={{ padding: '9px 12px' }}>{data.totals.cancelled}</td>
                  <td style={{ padding: '9px 12px' }}>{data.totals.noShow}</td>
                  <td style={{ padding: '9px 12px', color: data.totals.failed > 0 ? '#B85B4D' : '#6D5F50' }}>{data.totals.failed}</td>
                  <td style={{ padding: '9px 12px' }} colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </main>
  );
}
