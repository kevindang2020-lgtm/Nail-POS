import { useCallback, useState } from 'react';
import { useScopedQuery, useStreamInvalidation, OfflineStatus, PendingMutations } from '@aipowersalon/mobile-sdk';
import { techApi, type TechQueueState, type TechQueueEntry, type TechSharedVisit } from '../api/techApi';
import { useTechNav } from '../shell/nav';
import { clock, statusLabel, statusKind, initials } from '../lib/tech';
import { useTechStream } from '../lib/useTechStream';
import { QUEUE_FILTER } from '../lib/techRelevance';
import { AssignmentOriginBadges } from '../components/AssignmentOriginBadges';
import { assignmentOrigin } from '../lib/assignmentOrigin';
import { TurnRotationCard } from '../components/TurnRotationCard';

// Module 5 — Tech Queue (1:1 with the reference). My Queue = customers waiting for THIS technician; All = the branch's
// active queue (this technician's branch only, read-only). Reads GET /tech/queue/state (server-scoped). Break actions
// call the real /tech/status endpoints; starting a break is blocked server-side during an active service.
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
type Tab = 'My Queue' | 'All';

// multi-technician routing: a queue entry for one technician's PART of a shared visit. The contract (§6) puts
// `sharedVisit` on the ticket detail only; the chip here shows when the queue list carries it too (optional, never invented).
type QueueEntryWithShare = TechQueueEntry & { sharedVisit?: TechSharedVisit | null };
function QueueRow({ e, onOpen }: { e: QueueEntryWithShare; onOpen: () => void }) {
  const shared = e.sharedVisit && e.sharedVisit.partCount > 1 ? e.sharedVisit : null;
  // BUILD_PLAN Phase 6: the origin chips are part of the row's accessible name too (the button's aria-label replaces its text)
  const origin = e.mine ? assignmentOrigin(e).map((b) => b.label) : [];
  return (
    <button className="tech-row" style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
      onClick={onOpen} aria-label={`Ticket ${e.ticketNumber}, ${e.name || 'customer'}, ${statusLabel(e.status)}${origin.length ? `, ${origin.join(', ')}` : ''}`}>
      <div className="tech-avatar">{initials(e.name)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {e.name || 'Customer'}
          {e.vip ? <span className="tech-chip" style={{ background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)', padding: '1px 7px' }}>VIP</span> : null}
          {shared ? <span className="tech-chip" style={{ background: '#EFEAFA', color: '#6E59C7', padding: '1px 7px' }}>Shared visit · Part {shared.visitPart} of {shared.partCount}</span> : null}
        </div>
        {shared && shared.others.length ? <div className="tech-muted" style={{ fontSize: 11.5 }}>With {shared.others.map((o) => `${o.technicianName || 'another technician'}${o.serviceNames.length ? ` (${o.serviceNames.join(', ')})` : ''}`).join('; ')}</div> : null}
        {/* BUILD_PLAN Phase 6: how this guest came to you (AI suggestion / auto-assign / lock) — only on YOUR guests */}
        {e.mine ? <AssignmentOriginBadges entry={e} /> : null}
        <div className="tech-label">{e.ticketNumber} · {e.serviceSummary}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {e.scheduledTime ? <div className="tech-muted" style={{ fontSize: 11.5 }}>{clock(e.scheduledTime)}</div> : null}
        <span className={'tech-chip ' + statusKind(e.status)} style={{ marginTop: 3 }}>{statusLabel(e.status)}</span>
      </div>
    </button>
  );
}

export function QueueScreen() {
  const nav = useTechNav();
  // BUILD_PLAN Phase 13: server state through the query layer — keyed by realm + salon + branch, kept in the offline read
  // cache, refetched on every stream event. Offline with a cached queue: the queue shows with "last updated".
  const qq = useScopedQuery<TechQueueState>({ key: ['tech', 'queue'], fn: () => techApi.queue(), persist: true });
  const q = qq.data ?? null;
  const [tab, setTab] = useState<Tab>('My Queue');
  const error = !q && qq.isError ? ((qq.error as any)?.message || 'Failed to load the queue.') : null;
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refetch = qq.refetch;
  const load = useCallback(async () => { await refetch(); }, [refetch]);
  useTechStream(useStreamInvalidation([['tech', 'queue']]), undefined, QUEUE_FILTER);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setNote(null); setBusy(key);
    try { await fn(); setNote(ok); await load(); } catch (e: any) { setNote(e?.message || 'Action failed.'); } finally { setBusy(null); }
  };

  const header = (
    <div className="tech-topbar" style={{ marginBottom: 16 }}>
      <button className="tech-iconbtn" aria-label="Back" onClick={() => nav.back()}><Back /></button>
      <div className="t-title">Tech Queue</div>
      <button className="tech-iconbtn" aria-label="Refresh" onClick={() => { void load(); }}>⟳</button>
    </div>
  );

  if (error) return <div style={{ paddingBottom: 90 }}>{header}<div className="tech-main-2"><div className="tech-state" role="alert" style={{ color: 'var(--tech-danger)' }}>{error}</div></div></div>;
  if (!q) return (
    <div style={{ paddingBottom: 90 }}>
      {header}
      <div className="tech-main-2">
        <div className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div className="tech-skel" style={{ width: 44, height: 44, borderRadius: '50%' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="tech-skel" style={{ width: 100, height: 16 }} />
            <div className="tech-skel" style={{ width: 180, height: 14 }} />
          </div>
        </div>
        <div className="tech-seg" style={{ marginBottom: 12 }} aria-hidden="true">
          {/* loading placeholder — not controls (the real tabs render once the queue loads) */}
          <span className="sel">My Queue</span>
          <span>All</span>
        </div>
        <div className="tech-card" style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="tech-skel" style={{ width: 38, height: 38, borderRadius: '50%' }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div className="tech-skel" style={{ width: '40%', height: 16 }} />
                <div className="tech-skel" style={{ width: '70%', height: 14 }} />
              </div>
              <div className="tech-skel" style={{ width: 60, height: 24, borderRadius: 12 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const list = tab === 'My Queue' ? (q.myQueue || []) : (q.branchQueue || []);

  return (
    <div style={{ paddingBottom: 90 }}>
      {header}
      <div className="tech-main-2">
        <OfflineStatus updatedAt={qq.dataUpdatedAt || undefined} failed={qq.isError} />
        <PendingMutations />
        {note ? <div className="tech-card" style={{ marginBottom: 12, padding: 12, fontSize: 13 }} role="status">{note}</div> : null}

      {/* compact turn indicator */}
      <div className="tech-card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div className="tech-avatar" style={{ background: 'var(--tech-primary-light)', color: 'var(--tech-primary-dark)', fontWeight: 800 }}>{q.turnPosition != null ? `#${q.turnPosition}` : '—'}</div>
        <div>
          <div className="tech-label" style={{ color: 'var(--tech-primary-dark)' }}>Your Turn</div>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{q.turnPosition == null ? 'Your queue turn is not active.' : q.turnPosition === 1 ? 'You’re up next' : `${q.turnPosition} customers waiting for you`}</div>
        </div>
        {q.onBreak ? <span className="tech-chip warn" style={{ marginLeft: 'auto' }}>On Break</span> : null}
      </div>

      {/* Fair Turn §94–96: my place in the walk-in rotation (salon visibility setting applies server-side) */}
      <TurnRotationCard />

      <div className="tech-seg" style={{ marginBottom: 12 }}>
        {(['My Queue', 'All'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'sel' : ''} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}{(() => { const n = t === 'My Queue' ? (q.myQueue?.length || 0) : (q.branchQueueTotal ?? q.branchQueue?.length ?? 0); return n ? ` ${n}` : ''; })()}</button>
        ))}
      </div>

      {tab === 'All' && (q.branchQueueTotal ?? 0) > (q.branchQueue?.length ?? 0) ? (
        <div className="tech-card" role="note" style={{ marginBottom: 8, padding: 10, fontSize: 12.5 }}>Showing the next {q.branchQueue?.length ?? 0} of {q.branchQueueTotal} guests in the branch queue.</div>
      ) : null}
      {list.length === 0 ? (
        <div className="tech-card tech-state" style={{ boxShadow: 'none' }}>{tab === 'My Queue' ? 'No one is up next for you.' : 'The branch queue is empty.'}</div>
      ) : (
        <div className="tech-card" style={{ padding: '4px 16px' }}>
          {list.map((e) => <QueueRow key={e.ticketId + e.status} e={e} onOpen={() => nav.openTicket(e.ticketId)} />)}
        </div>
      )}

      {/* break controls (real /tech/status endpoints) */}
      <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
        {q.onBreak ? (
          <button className="tech-btn gold" disabled={busy !== null} onClick={() => act('end', () => techApi.endBreak(), 'Break ended — you’re available.')}>{busy === 'end' ? '…' : 'End Break'}</button>
        ) : (<>
          <button className="tech-btn outline" disabled={busy !== null} onClick={() => act('lunch', () => techApi.startBreak(), 'Lunch break started.')}>🍴 Take Lunch Break</button>
          <button className="tech-btn outline" disabled={busy !== null} onClick={() => act('short', () => techApi.startBreak(), 'Short break started.')}>☕ Take Short Break</button>
        </>)}
      </div>
      </div>
    </div>
  );
}
