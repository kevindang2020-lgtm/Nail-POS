// DeviceStatusScreen.tsx — Super Admin → Booking & Check-In Monitor → Device Status (deep submodule). Read-only list of
// real check-in devices with heartbeat-derived state (online = seen <5 min AND not disabled; offline = stale; disabled
// = surfaced honestly), server-side filtered + paginated, with a detail drawer. The Super Admin reviews connectivity but
// does not perform receptionist actions or remote check-ins; device lifecycle actions (reconnect/maintenance/revoke)
// are separate permissioned operations (next unit).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminBookingCheckinApi, type SADeviceDetail } from '../api/superAdminBookingCheckinApi';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const GOLD = 'var(--g7,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const STATE_COLOR: Record<string, string> = { online: '#3E8F57', offline: '#B85B4D', disabled: '#9B8B78' };
const SELECT: React.CSSProperties = { height: 36, border: `1px solid ${LINE}`, borderRadius: 9, padding: '0 9px', background: 'var(--card,#fff)', fontSize: 12.5, color: '#3C3322' };
const DEVICE_REFRESH_MS = 15_000; // heartbeat state changes often → refresh more frequently than the Overview
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmt = (s: string | null) => { if (!s) return 'Never'; const d = new Date(s); return isNaN(+d) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const ago = (s: string | null) => { if (!s) return 'never'; const ms = Date.now() - new Date(s).getTime(); if (ms < 0 || isNaN(ms)) return '—'; const m = Math.floor(ms / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`; };

function StatePill({ state }: { state: string }) {
  const c = STATE_COLOR[state] || '#9B8B78';
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: c }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />{titleCase(state)}</span>;
}
function DetailRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: `1px solid ${LINE}`, fontSize: 12.5 }}><span style={{ color: '#7A6C57' }}>{label}</span><span style={{ fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span></div>;
}
function Drawer({ row, onClose }: { row: SADeviceDetail; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Device ${row.deviceName}`} style={{ width: 'min(420px, 95vw)', height: '100vh', background: 'var(--card,#fff)', boxShadow: '-8px 0 28px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${LINE}` }}>
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>{row.deviceName}</div><div style={{ fontSize: 11.5, color: '#9B8B78' }}>{titleCase(row.deviceType)} · {row.branch}</div></div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: '#9B8B78' }}>✕</button>
        </div>
        <div style={{ padding: '8px 16px', overflow: 'auto' }}>
          <div style={{ margin: '8px 0' }}><StatePill state={row.state} /></div>
          <DetailRow label="Device Type" value={titleCase(row.deviceType)} />
          <DetailRow label="Branch" value={row.branch} />
          <DetailRow label="Registered Status" value={titleCase(row.registeredStatus)} />
          <DetailRow label="Last Heartbeat" value={`${fmt(row.lastSeenAt)} (${ago(row.lastSeenAt)})`} />
          <DetailRow label="Disabled At" value={row.disabledAt ? fmt(row.disabledAt) : '—'} />
          <DetailRow label="Registered" value={fmt(row.registeredAt)} />
          <div style={{ marginTop: 12, fontSize: 11, color: '#A99B86' }}>Read-only. Reconnect / maintenance / revoke are separate, permissioned device actions.</div>
        </div>
      </div>
    </div>
  );
}

export default function DeviceStatusScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState<{ total: number; rows: SADeviceDetail[]; page: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SADeviceDetail | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);

  const filters = useMemo(() => ({ status: sp.get('status') || '', deviceType: sp.get('deviceType') || '', search: sp.get('q') || '', page: Number(sp.get('page')) || 1 }), [sp]);
  const setF = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };

  const load = useCallback((signal: AbortSignal, background = false) => {
    if (background && inFlight.current) return;
    inFlight.current = true;
    if (!background) { setLoading(true); setError(null); }
    superAdminBookingCheckinApi.devices({ status: filters.status || undefined, deviceType: filters.deviceType || undefined, search: filters.search || undefined, page: filters.page, pageSize: 25 })
      .then((d) => { if (!signal.aborted) { setPage({ total: d.total, rows: d.rows, page: d.page, pageSize: d.pageSize }); setError(null); setLastUpdated(new Date()); setStale(false); if (!background) setLoading(false); } })
      .catch((e: unknown) => { if (signal.aborted) return; if (background) setStale(true); else { setError(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); } })
      .finally(() => { inFlight.current = false; });
  }, [filters]);
  useEffect(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);
  // Device heartbeat state changes live (§42: refresh device status frequently) — poll in the background, tab-aware.
  useAutoRefresh((signal) => load(signal, true), DEVICE_REFRESH_MS);

  const totalPages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;

  return (
    <main className="content" style={{ padding: '16px 18px', overflow: 'auto' }}>
      <button onClick={() => nav('/booking-checkin')} className="text-[#2C2118] px-1 py-2 text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]">← Monitor</button>
      <div className=" flex flex-col xl:flex-row justify-between gap-1" >
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0 }}>Check-In Device Status</h1>
          <div style={{ color: '#7A6C57', fontSize: 12.5 }}>Real-time connectivity from device heartbeats. Read-only — device actions are separate, permissioned operations.</div>
          <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5, fontSize: 11.5, color: stale ? '#B8860B' : '#7A9E86' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: stale ? '#D09A36' : '#3E8F57', display: 'inline-block' }} />
            {stale
              ? <span>Reconnecting — showing last known state{lastUpdated ? ` from ${lastUpdated.toLocaleTimeString()}` : ''}.</span>
              : <span>{lastUpdated ? `Live · updated ${lastUpdated.toLocaleTimeString()}` : 'Live'} · auto-refresh {DEVICE_REFRESH_MS / 1000}s</span>}
          </div>
        </div>
      <div style={{ display: 'flex', gap: 9, marginTop: 14, flexWrap: 'wrap' }}>
        <select aria-label="State" value={filters.status} onChange={(e) => setF('status', e.target.value)} style={SELECT}>
          <option value="">All States</option>{['online', 'offline', 'disabled'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </select>
        <select aria-label="Device type" value={filters.deviceType} onChange={(e) => setF('deviceType', e.target.value)} style={SELECT}>
          <option value="">All Types</option>{['kiosk', 'tablet', 'ipad', 'front_desk', 'qr_code'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
        <input aria-label="Search" placeholder="Search device name / slug…" defaultValue={filters.search} onKeyDown={(e) => { if (e.key === 'Enter') setF('q', (e.target as HTMLInputElement).value.trim()); }} style={{ ...SELECT, minWidth: 220 }} />
        <div style={{ alignSelf: 'center', fontSize: 12, color: '#9B8B78' }}>{page ? `${page.total} device${page.total === 1 ? '' : 's'}` : ''}</div>
      </div>
      </div>


      {error ? (
        <div style={{ marginTop: 14, border: '1px solid #E3B9B1', background: '#FCF3F1', borderRadius: 12, padding: 14 }}>
          <div style={{ color: '#B85B4D', fontWeight: 700, fontSize: 13 }}>Couldn’t load devices.</div>
          <div style={{ color: '#8a6a62', fontSize: 12, marginTop: 3 }}>{error}</div>
          <button onClick={() => { const ac = new AbortController(); load(ac.signal); }} style={{ marginTop: 10, ...SELECT, cursor: 'pointer', color: GOLD, fontWeight: 700 }}>Retry</button>
        </div>
      ) : null}

      <div className="mt-3.5 w-full max-w-full overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card,#fff)]">
        <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
          <thead><tr style={{ color: '#9B8B78', textAlign: 'left', background: '#FBF6EC' }}>
            {['Device', 'Type', 'Branch', 'State', 'Last Heartbeat'].map((h) => <th key={h} style={{ fontWeight: 600, padding: '9px 12px' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loading && !page ? Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={5} style={{ padding: 0 }}><div style={{ height: 38, background: i % 2 ? '#FAF5EC' : '#fff' }} /></td></tr>) : null}
            {page && page.rows.length === 0 ? <tr><td colSpan={5} style={{ padding: '28px 12px', textAlign: 'center', color: '#A99B86' }}>No devices match these filters.</td></tr> : null}
            {page?.rows.map((r) => (
              <tr key={r.id} onClick={() => setActive(r)} style={{ borderTop: `1px solid ${LINE}`, cursor: 'pointer' }}>
                <td style={{ padding: '9px 12px', fontWeight: 700 }}>{r.deviceName}</td>
                <td style={{ padding: '9px 12px', textTransform: 'capitalize' }}>{r.deviceType.replace(/_/g, ' ')}</td>
                <td style={{ padding: '9px 12px', color: '#5C5040' }}>{r.branch}</td>
                <td style={{ padding: '9px 12px' }}><StatePill state={r.state} /></td>
                <td style={{ padding: '9px 12px', color: '#6D5F50' }}>{ago(r.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {page && page.total > page.pageSize ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12, fontSize: 12.5 }}>
          <button disabled={filters.page <= 1} onClick={() => setF('page', String(filters.page - 1))} style={{ ...SELECT, cursor: filters.page <= 1 ? 'default' : 'pointer', opacity: filters.page <= 1 ? 0.5 : 1 }}>‹ Prev</button>
          <span style={{ color: '#6D5F50' }}>Page {page.page} of {totalPages}</span>
          <button disabled={filters.page >= totalPages} onClick={() => setF('page', String(filters.page + 1))} style={{ ...SELECT, cursor: filters.page >= totalPages ? 'default' : 'pointer', opacity: filters.page >= totalPages ? 0.5 : 1 }}>Next ›</button>
        </div>
      ) : null}

      {active ? <Drawer row={active} onClose={() => setActive(null)} /> : null}
    </main>
  );
}
