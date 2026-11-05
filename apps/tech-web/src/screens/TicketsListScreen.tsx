import { useCallback, useEffect, useMemo, useState } from 'react';
import { techApi, type TechTicketListItem } from '../api/techApi';
import { useTechNav } from '../shell/nav';
import { money2, clock, elapsed, statusLabel, statusKind, initials } from '../lib/tech';
import { useTechStream } from '../lib/useTechStream';
import { FiRefreshCw } from 'react-icons/fi';
// Tickets tab (1:1 with the reference) — the technician's own tickets as rich status cards with filter chips. New
// assignments show a live acceptance countdown + inline Accept/Decline (Accept forwards the record version, §14); active
// services show elapsed time. Reads GET /tech/tickets (server-scoped). Tap a card → Ticket Detail.
type Filter = 'All' | 'New' | 'Accepted' | 'In Service' | 'Done';
const FILTERS: Filter[] = ['All', 'New', 'Accepted', 'In Service', 'Done'];
const inFilter = (f: Filter, status: string): boolean => {
  if (f === 'All') return true;
  if (f === 'New') return status === 'assigned';
  if (f === 'Accepted') return status === 'accepted';
  if (f === 'In Service') return status === 'serving' || status === 'nearly_finished' || status === 'paused';
  return status === 'done';
};

export function TicketsListScreen() {
  const nav = useTechNav();
  const [rows, setRows] = useState<TechTicketListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
const [refreshing, setRefreshing] = useState(false);
  // const load = useCallback(() => {
  //   techApi.tickets().then((r) => { setRows(r); setError(null); }).catch((e: any) => setError(e?.message || 'Failed to load your tickets.'));
  // }, []);
  const load = useCallback(async () => {
    setRefreshing(true);
  
    try {
      const r = await techApi.tickets();
      setRows(r);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load your tickets.');
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useTechStream(load);
  const accept = async (t: TechTicketListItem) => {
    setNote(null); setBusy(t.ticketId);
    try { await techApi.accept(t.ticketId, t.version); setNote('Ticket accepted.'); load(); }
    catch (e: any) { setNote(e?.message || 'Could not accept.'); } finally { setBusy(null); }
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { All: 0, New: 0, Accepted: 0, 'In Service': 0, Done: 0 };
    for (const t of rows || []) for (const f of FILTERS) if (inFilter(f, t.status)) c[f]++;
    return c;
  }, [rows]);
  const shown = (rows || []).filter((t) => inFilter(filter, t.status));

  return (
    <div>
      <div className="tech-tab-header" style={{ marginBottom: 32 }}>
        <div className="tech-tab-header__inner">
          <div className="t-title">My Tickets</div>
          <button
            className="tech-iconbtn tickets-refresh-btn"
            style={{ marginLeft: 'auto' }}
            aria-label="Refresh tickets"
            onClick={load}
            disabled={refreshing}
          >
            <FiRefreshCw className={refreshing ? 'refreshing' : ''} />
          </button>
        </div>
      </div>
<div className="tech-main-2">
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 6 }}>
        {FILTERS.map((f) => (
          <button key={f} className={'tech-chip' + (filter === f ? ' active' : '')} style={{ border: filter === f ? 'none' : '1px solid var(--tech-border)', cursor: 'pointer', whiteSpace: 'nowrap' }}
            aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}{counts[f] ? ` ${counts[f]}` : ''}</button>
        ))}
      </div>

      {note ? <div className="tech-card" style={{ marginBottom: 12, padding: 12, fontSize: 13 }} role="status">{note}</div> : null}

      {error ? <div className="tech-state" role="alert" style={{ color: 'var(--tech-danger)' }}>{error}</div>
        : !rows ? (
          <div style={{ display: 'grid', gap: 12 }} aria-busy="true">
            <span role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>Loading your tickets…</span>
            {[1, 2, 3].map(i => (
              <div key={i} className="tech-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div className="tech-skel" style={{ width: 80, height: 14 }} />
                  <div className="tech-skel" style={{ width: 50, height: 14 }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="tech-skel" style={{ width: 44, height: 44, borderRadius: '50%' }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="tech-skel" style={{ width: '40%', height: 16 }} />
                    <div className="tech-skel" style={{ width: '70%', height: 14 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
        : rows.length === 0 ? (
          <div
            className="tech-card tech-state"
            style={{
              minHeight: 240,
              padding: '36px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              boxShadow: 'none',
            }}
          >
            <div
              aria-hidden
              style={{
                width: 58,
                height: 58,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #FBF3E4 0%, #EFE1C9 100%)',
                border: '1px solid #DBCAB0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 28,
                marginBottom: 12,
              }}
            >
              🎟️
            </div>
            <div style={{ fontSize: 14, color: 'var(--tech-text-muted, #7A6F62)', maxWidth: 280, lineHeight: 1.45 }}>
              No tickets assigned to you yet.
            </div>
          </div>
        )
        : shown.length === 0 ? (
          <div
            className="tech-card tech-state"
            style={{
              minHeight: 240,
              padding: '36px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              boxShadow: 'none',
            }}
          >
            <div
              aria-hidden
              style={{
                width: 58,
                height: 58,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #FBF3E4 0%, #EFE1C9 100%)',
                border: '1px solid #DBCAB0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 28,
                marginBottom: 12,
              }}
            >
              🎟️
            </div>
            <div style={{ fontSize: 14, color: 'var(--tech-text-muted, #7A6F62)', maxWidth: 280, lineHeight: 1.45 }}>
              No {filter.toLowerCase()} tickets.
            </div>
          </div>
        )
        : (
          <div style={{ display: 'grid', gap: 12 }}>
            {shown.map((t) => {
              const assigned = t.status === 'assigned';
              const serving = t.status === 'serving' || t.status === 'nearly_finished';
              const deadline = assigned && t.acceptanceDeadline ? new Date(t.acceptanceDeadline).getTime() : null;
              const secsLeft = deadline != null ? Math.max(0, Math.round((deadline - now) / 1000)) : null;
              return (
                <div key={t.ticketId} className={assigned ? 'tech-assign' : 'tech-card'}>
                  <button style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                    onClick={() => nav.openTicket(t.ticketId)} aria-label={`Ticket ${t.ticketNumber}, ${t.customerName || 'customer'}, ${statusLabel(t.status)}`}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span className={assigned ? 'tech-eyebrow' : 'tech-label'}>{assigned ? 'New Assignment' : statusLabel(t.status)}</span>
                      {assigned && secsLeft !== null ? <span className="tech-countpill" style={secsLeft > 60 ? { color: 'var(--tech-primary-dark)', background: 'var(--tech-primary-light)' } : {}}>Expires in {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, '0')}</span>
                        : <span style={{ fontWeight: 700 }}>{money2(t.totalCents)}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="tech-avatar">{initials(t.customerName)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {t.customerName || 'Customer'}
                          {t.vip ? <span className="tech-chip" style={{ background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)', padding: '1px 7px' }}>VIP</span> : null}
                        </div>
                        <div className="tech-label">{t.ticketNumber} · {t.serviceSummary}</div>
                        <div className="tech-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                          {serving && t.startedAt ? `Started ${clock(t.startedAt)} · ${elapsed(t.startedAt, now)} elapsed`
                            : t.status === 'accepted' && t.scheduledStart ? `Start ${clock(t.scheduledStart)}`
                            : assigned && t.scheduledStart ? `Due ${clock(t.scheduledStart)}`
                            : t.startedAt ? clock(t.startedAt) : ''}
                        </div>
                      </div>
                      {!assigned ? <span className={'tech-chip ' + statusKind(t.status)}>{serving ? <span className="live" /> : null}{statusLabel(t.status)}</span> : null}
                    </div>
                  </button>
                  {assigned ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                      <button className="tech-btn outline" disabled={busy !== null} onClick={() => nav.openTicket(t.ticketId)}>Decline</button>
                      <button className="tech-btn gold" disabled={busy !== null} onClick={() => accept(t)}>{busy === t.ticketId ? '…' : 'Accept'}</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
    </div>
    </div>
  );
}
