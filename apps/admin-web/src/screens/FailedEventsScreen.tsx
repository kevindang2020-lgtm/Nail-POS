// FailedEventsScreen.tsx — Super Admin → Booking & Check-In Monitor → Failed Events (deep submodule). Read-only table
// of recorded booking/check-in failures with server-side filtering + pagination and a safe detail drawer (correlation
// id + retry context for diagnosis; never secrets/tokens/payment data). The Super Admin reviews and diagnoses here but
// does not perform receptionist actions; the retry workflow is a separate, permissioned action (next unit).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { superAdminBookingCheckinApi, type SAFailedEventDetail } from '../api/superAdminBookingCheckinApi';

const GOLD = 'var(--g7,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const RETRY_COLOR: Record<string, string> = { failed: '#B85B4D', retrying: '#D09A36', retry_available: '#3C7FB6', resolved: '#3E8F57', not_retryable: '#9B8B78' };
const CAT_LABEL: Record<string, string> = { check_in: 'Check-In', booking: 'Booking', api: 'API', integration: 'Integration' };
const SELECT: React.CSSProperties = { height: 36, border: `1px solid ${LINE}`, borderRadius: 9, padding: '0 9px', background: 'var(--card,#fff)', fontSize: 12.5, color: '#3C3322' };
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmt = (s: string | null) => { if (!s) return '—'; const d = new Date(s); return isNaN(+d) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: `1px solid ${LINE}`, fontSize: 12.5 }}><span style={{ color: '#7A6C57' }}>{label}</span><span style={{ fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span></div>;
}

function Drawer({ row, onClose, onRetried }: { row: SAFailedEventDetail; onClose: () => void; onRetried: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const eligible = row.retryStatus === 'retry_available';

  const doRetry = () => {
    if (busy) return;
    setBusy(true); setResult(null);
    superAdminBookingCheckinApi.retryFailedEvent(row.id, { reason: 'Super Admin controlled retry' })
      .then((r) => {
        if (r.idempotentReplay) setResult({ tone: 'ok', text: 'Retry already requested (idempotent — no duplicate created).' });
        else if (r.escalated) setResult({ tone: 'warn', text: 'Retry cap reached — event escalated for manual review.' });
        else setResult({ tone: 'ok', text: `Retry #${r.attempt?.attemptNumber ?? ''} queued. Reprocessing on backoff; business records change only on confirmed success.` });
        onRetried();
      })
      .catch((e: unknown) => setResult({ tone: 'err', text: e instanceof Error ? e.message : 'Retry could not be requested.' }))
      .finally(() => setBusy(false));
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Failed event ${row.eventCode}`} style={{ width: 'min(440px, 95vw)', height: '100vh', background: 'var(--card,#fff)', boxShadow: '-8px 0 28px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${LINE}` }}>
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>{row.eventCode}</div><div style={{ fontSize: 11.5, color: '#9B8B78' }}>{CAT_LABEL[row.category] || row.category} · {titleCase(row.failureType)}</div></div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', color: '#9B8B78' }}>✕</button>
        </div>
        <div style={{ padding: '8px 16px', overflow: 'auto' }}>
          <div style={{ display: 'inline-block', margin: '8px 0', fontSize: 11.5, fontWeight: 700, color: RETRY_COLOR[row.retryStatus] || '#9B8B78', background: `${RETRY_COLOR[row.retryStatus] || '#9B8B78'}1A`, borderRadius: 999, padding: '2px 10px' }}>{titleCase(row.retryStatus)}</div>
          <DetailRow label="Branch" value={row.branch} />
          <DetailRow label="Source" value={titleCase(row.source)} />
          <DetailRow label="Check-In Method" value={titleCase(row.checkInMethod)} />
          <DetailRow label="Failure Type" value={titleCase(row.failureType)} />
          <DetailRow label="Error Code" value={row.errorCode} />
          <DetailRow label="Safe Message" value={row.errorMessage} />
          <DetailRow label="Correlation ID" value={row.correlationId} />
          <DetailRow label="Attempts" value={row.attemptCount} />
          <DetailRow label="Retry Count" value={row.retryCount} />
          <DetailRow label="Escalation" value={titleCase(row.escalationState)} />
          <DetailRow label="Resolution" value={row.resolution} />
          <DetailRow label="Occurred" value={fmt(row.occurredAt)} />
          <DetailRow label="Last Attempt" value={fmt(row.lastAttemptAt)} />
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
            {eligible ? (
              <button onClick={doRetry} disabled={busy} aria-label="Retry event" style={{ width: '100%', height: 38, border: 'none', borderRadius: 9, background: busy ? '#D8C39A' : GOLD, color: '#fff', fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer' }}>{busy ? 'Requesting…' : 'Retry This Event'}</button>
            ) : (
              <div style={{ fontSize: 11.5, color: '#A99B86' }}>Retry is available only for events in the <b>Retry Available</b> state. This event is <b>{titleCase(row.retryStatus)}</b>.</div>
            )}
            {result ? (
              <div role="status" style={{ marginTop: 10, fontSize: 12, borderRadius: 8, padding: '8px 10px', border: `1px solid ${result.tone === 'err' ? '#E3B9B1' : result.tone === 'warn' ? '#E6CF97' : '#B7DBC3'}`, background: result.tone === 'err' ? '#FCF3F1' : result.tone === 'warn' ? '#FBF3DD' : '#EFF7F1', color: result.tone === 'err' ? '#B85B4D' : result.tone === 'warn' ? '#8A6D2E' : '#3E8F57' }}>{result.text}</div>
            ) : null}
            <div style={{ marginTop: 10, fontSize: 11, color: '#A99B86' }}>Controlled technical reprocess — idempotent and audited. It never creates a booking or check-in and cannot act as the receptionist.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FailedEventsScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState<{ total: number; rows: SAFailedEventDetail[]; page: number; pageSize: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SAFailedEventDetail | null>(null);

  const filters = useMemo(() => ({
    category: sp.get('type') || sp.get('category') || '',
    retryStatus: sp.get('retry') || '',
    search: sp.get('q') || '',
    page: Number(sp.get('page')) || 1,
  }), [sp]);

  const setF = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };

  const load = useCallback((signal: AbortSignal) => {
    setLoading(true); setError(null);
    superAdminBookingCheckinApi.failedEvents({ category: filters.category || undefined, retryStatus: filters.retryStatus || undefined, search: filters.search || undefined, page: filters.page, pageSize: 25 })
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
          <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0 }}>Failed Booking &amp; Check-In Events</h1>
          <div style={{ color: '#7A6C57', fontSize: 12.5 }}>Review and diagnose recorded failures. Read-only — retry is a separate, permissioned action.</div>
        </div>
      <div style={{ display: 'flex', gap: 9, marginTop: 14, flexWrap: 'wrap' }}>
        <select aria-label="Category" value={filters.category} onChange={(e) => setF('type', e.target.value)} style={SELECT}>
          <option value="">All Categories</option>{['check_in', 'booking', 'api', 'integration'].map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
        </select>
        <select aria-label="Retry status" value={filters.retryStatus} onChange={(e) => setF('retry', e.target.value)} style={SELECT}>
          <option value="">All Retry Statuses</option>{['failed', 'retrying', 'retry_available', 'resolved', 'not_retryable'].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
        </select>
        <input aria-label="Search" placeholder="Search event / failure / source…" defaultValue={filters.search} onKeyDown={(e) => { if (e.key === 'Enter') setF('q', (e.target as HTMLInputElement).value.trim()); }} style={{ ...SELECT, minWidth: 230 }} />
        
        <div style={{ alignSelf: 'center', fontSize: 12, color: '#9B8B78' }}>{page ? `${page.total} event${page.total === 1 ? '' : 's'}` : ''}</div>
      </div>
      </div>


      {error ? (
        <div style={{ marginTop: 14, border: '1px solid #E3B9B1', background: '#FCF3F1', borderRadius: 12, padding: 14 }}>
          <div style={{ color: '#B85B4D', fontWeight: 700, fontSize: 13 }}>Couldn’t load failed events.</div>
          <div style={{ color: '#8a6a62', fontSize: 12, marginTop: 3 }}>{error}</div>
          <button onClick={() => { const ac = new AbortController(); load(ac.signal); }} style={{ marginTop: 10, ...SELECT, cursor: 'pointer', color: GOLD, fontWeight: 700 }}>Retry</button>
        </div>
      ) : null}

      <div className="mt-3.5 w-full max-w-full overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card,#fff)]">
        <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
          <thead><tr style={{ color: '#9B8B78', textAlign: 'left', background: '#FBF6EC' }}>
            {['Event ID', 'Branch', 'Category', 'Source', 'Failure Type', 'Time', 'Retry'].map((h) => <th key={h} style={{ fontWeight: 600, padding: '9px 12px' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {loading && !page ? Array.from({ length: 6 }).map((_, i) => <tr key={i}><td colSpan={7} style={{ padding: 0 }}><div style={{ height: 38, background: i % 2 ? '#FAF5EC' : '#fff' }} /></td></tr>) : null}
            {page && page.rows.length === 0 ? <tr><td colSpan={7} style={{ padding: '28px 12px', textAlign: 'center', color: '#A99B86' }}>No failed events match these filters.</td></tr> : null}
            {page?.rows.map((r) => (
              <tr key={r.id} onClick={() => setActive(r)} style={{ borderTop: `1px solid ${LINE}`, cursor: 'pointer' }}>
                <td style={{ padding: '9px 12px', fontWeight: 700 }}>{r.eventCode}</td>
                <td style={{ padding: '9px 12px', color: '#5C5040' }}>{r.branch}</td>
                <td style={{ padding: '9px 12px' }}>{CAT_LABEL[r.category] || r.category}</td>
                <td style={{ padding: '9px 12px', textTransform: 'capitalize' }}>{r.source.replace(/_/g, ' ')}</td>
                <td style={{ padding: '9px 12px', textTransform: 'capitalize' }}>{r.failureType.replace(/_/g, ' ')}</td>
                <td style={{ padding: '9px 12px', color: '#6D5F50' }}>{fmt(r.occurredAt)}</td>
                <td style={{ padding: '9px 12px' }}><span style={{ color: RETRY_COLOR[r.retryStatus] || '#9B8B78', fontWeight: 700 }}>{titleCase(r.retryStatus)}</span></td>
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

      {active ? <Drawer row={active} onClose={() => setActive(null)} onRetried={() => { const ac = new AbortController(); load(ac.signal); }} /> : null}
    </main>
  );
}
