// AiHandoffsScreen.tsx — Super Admin → Booking & Check-In Monitor → AI Handoffs (deep submodule). Read-only list of AI
// receptionist → human handoffs with server-side filtering + pagination and a detail drawer carrying only the minimum
// necessary detail — NO call transcripts or recordings (privacy safeguard). The Super Admin reviews handoff outcomes;
// no receptionist actions are performed here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminBookingCheckinApi, type SAHandoffDetail } from '../api/superAdminBookingCheckinApi';

const GOLD = 'var(--g7,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const STATUS_COLOR: Record<string, string> = { completed: '#3E8F57', connecting: '#3C7FB6', requested: '#D09A36', escalated: '#A96F22', returned_to_ai: '#8C7CC0', failed: '#B85B4D', abandoned: '#B85B4D', timed_out: '#B85B4D' };
const DEST = ['front_desk', 'stylist', 'receptionist', 'branch_queue', 'human_agent'];
const STATUSES = ['requested', 'connecting', 'completed', 'failed', 'abandoned', 'timed_out', 'escalated', 'returned_to_ai'];
const SELECT: React.CSSProperties = { height: 36, border: `1px solid ${LINE}`, borderRadius: 9, padding: '0 9px', background: 'var(--card,#fff)', fontSize: 12.5, color: '#3C3322' };
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmt = (s: string | null) => { if (!s) return '—'; const d = new Date(s); return isNaN(+d) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const dur = (sec: number | null) => { if (sec == null) return '—'; const m = Math.floor(sec / 60); return m > 0 ? `${m}m ${sec % 60}s` : `${sec}s`; };

function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLOR[status] || '#9B8B78';
  return <span style={{ fontSize: 11.5, fontWeight: 700, color: c, background: `${c}1A`, borderRadius: 999, padding: '1px 9px' }}>{titleCase(status)}</span>;
}
function DetailRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: `1px solid ${LINE}`, fontSize: 12.5 }}><span style={{ color: '#7A6C57' }}>{label}</span><span style={{ fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span></div>;
}
function Drawer({ row, onClose }: { row: SAHandoffDetail; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Handoff ${row.callCode}`} style={{ width: 'min(420px, 95vw)', height: '100vh', background: 'var(--card,#fff)', boxShadow: '-8px 0 28px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${LINE}` }}>
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>{row.callCode}</div><div style={{ fontSize: 11.5, color: '#9B8B78' }}>{row.branch} · → {titleCase(row.transferredTo)}</div></div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: '#9B8B78' }}>✕</button>
        </div>
        <div style={{ padding: '8px 16px', overflow: 'auto' }}>
          <div style={{ margin: '8px 0' }}><StatusPill status={row.status} /></div>
          <DetailRow label="Transferred To" value={titleCase(row.transferredTo)} />
          <DetailRow label="Reason" value={titleCase(row.reason)} />
          <DetailRow label="Requested" value={fmt(row.requestedAt)} />
          <DetailRow label="Connected" value={fmt(row.connectedAt)} />
          <DetailRow label="Wait" value={dur(row.waitSeconds)} />
          <DetailRow label="Booking Result" value={titleCase(row.bookingResult)} />
          <DetailRow label="Failure Reason" value={titleCase(row.failureReason)} />
          <div style={{ marginTop: 12, fontSize: 11, color: '#A99B86' }}>Minimal handoff detail only. Call transcripts and recordings are not exposed here.</div>
        </div>
      </div>
    </div>
  );
}

export default function AiHandoffsScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState<{ total: number; rows: SAHandoffDetail[]; page: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SAHandoffDetail | null>(null);

  const filters = useMemo(() => ({ status: sp.get('status') || '', transferredTo: sp.get('to') || '', search: sp.get('q') || '', page: Number(sp.get('page')) || 1 }), [sp]);
  const setF = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };

  const load = useCallback((signal: AbortSignal) => {
    setLoading(true); setError(null);
    superAdminBookingCheckinApi.aiHandoffs({ status: filters.status || undefined, transferredTo: filters.transferredTo || undefined, search: filters.search || undefined, page: filters.page, pageSize: 25 })
      .then((d) => { if (!signal.aborted) { setPage({ total: d.total, rows: d.rows, page: d.page, pageSize: d.pageSize }); setLoading(false); } })
      .catch((e: unknown) => { if (!signal.aborted) { setError(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); } });
  }, [filters]);
  useEffect(() => { const ac = new AbortController(); load(ac.signal); return () => ac.abort(); }, [load]);

  const totalPages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;

  return (
    <main className="content" style={{ padding: '16px 18px', overflow: 'auto' }}>
      <button onClick={() => nav('/booking-checkin')} className="text-[#2C2118] px-1 py-2 text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]">← Monitor</button>
      <div className=" flex flex-col xl:flex-row justify-between gap-1" >

        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0 }}>AI Receptionist Handoff Monitor</h1>
          <div style={{ color: '#7A6C57', fontSize: 12.5 }}>Review AI → human handoffs and outcomes. Minimal detail only — no transcripts or recordings.</div>
        </div>
      <div style={{ display: 'flex', gap: 9, marginTop: 14, flexWrap: 'wrap' }}>
        <select aria-label="Status" value={filters.status} onChange={(e) => setF('status', e.target.value)} style={SELECT}>
          <option value="">All Statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </select>
        <select aria-label="Transferred to" value={filters.transferredTo} onChange={(e) => setF('to', e.target.value)} style={SELECT}>
          <option value="">All Destinations</option>{DEST.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
        </select>
        <input aria-label="Search" placeholder="Search call / reason…" defaultValue={filters.search} onKeyDown={(e) => { if (e.key === 'Enter') setF('q', (e.target as HTMLInputElement).value.trim()); }} style={{ ...SELECT, minWidth: 220 }} />
        
        <div style={{ alignSelf: 'center', fontSize: 12, color: '#9B8B78' }}>{page ? `${page.total} handoff${page.total === 1 ? '' : 's'}` : ''}</div>
      </div>
      </div>


      {error ? (
        <div style={{ marginTop: 14, border: '1px solid #E3B9B1', background: '#FCF3F1', borderRadius: 12, padding: 14 }}>
          <div style={{ color: '#B85B4D', fontWeight: 700, fontSize: 13 }}>Couldn’t load handoffs.</div>
          <div style={{ color: '#8a6a62', fontSize: 12, marginTop: 3 }}>{error}</div>
          <button onClick={() => { const ac = new AbortController(); load(ac.signal); }} style={{ marginTop: 10, ...SELECT, cursor: 'pointer', color: GOLD, fontWeight: 700 }}>Retry</button>
        </div>
      ) : null}

      <div className="mt-3.5 w-full max-w-full overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card,#fff)]">
        <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
          <thead><tr style={{ color: '#9B8B78', textAlign: 'left', background: '#FBF6EC' }}>
            {['Call ID', 'Branch', 'Transferred To', 'Reason', 'Time', 'Status'].map((h) => <th key={h} style={{ fontWeight: 600, padding: '9px 12px' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loading && !page ? Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={6} style={{ padding: 0 }}><div style={{ height: 38, background: i % 2 ? '#FAF5EC' : '#fff' }} /></td></tr>) : null}
            {page && page.rows.length === 0 ? <tr><td colSpan={6} style={{ padding: '28px 12px', textAlign: 'center', color: '#A99B86' }}>No handoffs match these filters.</td></tr> : null}
            {page?.rows.map((r) => (
              <tr key={r.id} onClick={() => setActive(r)} style={{ borderTop: `1px solid ${LINE}`, cursor: 'pointer' }}>
                <td style={{ padding: '9px 12px', fontWeight: 700 }}>{r.callCode}</td>
                <td style={{ padding: '9px 12px', color: '#5C5040' }}>{r.branch}</td>
                <td style={{ padding: '9px 12px', textTransform: 'capitalize' }}>{r.transferredTo.replace(/_/g, ' ')}</td>
                <td style={{ padding: '9px 12px', textTransform: 'capitalize' }}>{r.reason.replace(/_/g, ' ')}</td>
                <td style={{ padding: '9px 12px', color: '#6D5F50' }}>{fmt(r.requestedAt)}</td>
                <td style={{ padding: '9px 12px' }}><StatusPill status={r.status} /></td>
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
