import { useCallback, useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { useOwnerStream } from '../api/useOwnerStream';
import { ownerLiveApi, type OwnerLiveOperationsResp } from '../api/ownerApi';
import { OwnerSkeletonList } from '../components/OwnerSkeleton';
import { fmtTime as fmtBranchTime } from '@aipowersalon/mobile-sdk';
import { formatCentsPlain } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// Live Operations — Module 2. Read-only owner view of the live floor for the selected branch (or all locations).
// Every number comes from the SAME canonical POS records (pos_queue_items / tickets / pos_tech_appointments), scoped
// server-side to this owner's tenant and branch access — the Owner App never re-derives or mutates the front-desk flow.
// Stays fresh via the existing owner SSE stream (refetch on any owner/branch event) with a controlled polling fallback.

// workforce vocabulary (technician_workforce_state, migration 579) → plain words
const QUEUE: Record<string, string> = { AVAILABLE: 'Available', ASSIGNED: 'Assigned', SERVING: 'Serving', BREAK: 'On break', UNAVAILABLE: 'Not taking customers', OFF_SHIFT: 'Off shift' };
const clockWords = (c: string | null): string => (c === 'CLOCKED_OUT' ? 'Clocked out' : c === 'ON_BREAK' ? 'On break' : c === 'CLOCKED_IN' ? 'Clocked in' : 'No clock record today');
const fmtMin = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const fmtTime = (iso: string): string => fmtBranchTime(iso);
/** 200-technician mandate §62/§71 (Oct 23 2026): the Team list is searched and paged — never 200 cards in one column.
 *  §2 (Oct 27 2026): searched / filtered / paged ON THE SERVER (it used to download up to 1,000 technicians and page them
 *  here); the in-service list is a server page too. teamView stays for a server that sends the whole team. */
export const TEAM_PAGE_SIZE = 25;
export const TECH_QUEUE_PAGE_SIZE = 25;
export function teamView<T extends { technicianName: string; queueStatus: string | null }>(team: T[], q: string, status: string, page: number): { rows: T[]; total: number; pages: number; page: number } {
  const term = q.trim().toLowerCase();
  const list = team.filter((t) => (!term || t.technicianName.toLowerCase().includes(term)) && (!status || (t.queueStatus ?? '') === status));
  const pages = Math.max(1, Math.ceil(list.length / TEAM_PAGE_SIZE)); const p = Math.min(Math.max(1, page), pages);
  return { rows: list.slice((p - 1) * TEAM_PAGE_SIZE, p * TEAM_PAGE_SIZE), total: list.length, pages, page: p };
}

export function LiveOperationsScreen() {
  const { effectiveBranchId } = useOwnerBranch();
  const [data, setData] = useState<OwnerLiveOperationsResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamQ, setTeamQ] = useState(''); const [teamStatus, setTeamStatus] = useState(''); const [teamPage, setTeamPage] = useState(1);
  const [teamSearch, setTeamSearch] = useState(''); const [tqPage, setTqPage] = useState(1);
  useEffect(() => { const h = setTimeout(() => { setTeamSearch(teamQ.trim()); setTeamPage(1); }, 250); return () => clearTimeout(h); }, [teamQ]);

  const load = useCallback(() => {
    setError(null);
    ownerLiveApi.get(effectiveBranchId, { teamPage, teamPageSize: TEAM_PAGE_SIZE, teamSearch: teamSearch || undefined, teamStatus: teamStatus || undefined, techQueuePage: tqPage, techQueuePageSize: TECH_QUEUE_PAGE_SIZE })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: any) => { setError(e?.message || 'Could not load live operations.'); setLoading(false); });
  }, [effectiveBranchId, teamPage, teamSearch, teamStatus, tqPage]);

  useEffect(() => { setLoading(true); setData(null); }, [effectiveBranchId]);
  useEffect(() => { load(); }, [load]);
  // real-time: the owner stream only forwards events already scoped to this owner's tenant/branch, so any of them
  // can mean the floor changed — refetch our own server-scoped snapshot. (Payload is never sent; nothing leaks.)
  useOwnerStream(() => load());
  // controlled polling fallback when the socket is unavailable (spec §27–28)
  useEffect(() => { const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  const delayed = data?.signals.delayedAppointments ?? 0;

  return (
    <div style={{ paddingBlock: '12px ' }}>
      <div className="owner-sechead">
        <div className="h owner-serif">Live Operations</div>
        <div className="d">{data ? `Updated ${fmtTime(data.generatedAt)}` : 'Live floor'}</div>
      </div>

      {error ? <div className="owner-state" role="alert">{error}</div> : null}

      <div className="owner-kpigrid three" style={{ marginBottom: 12 }}>
        <div className="owner-kpi"><div className="label">Waiting</div><div className="val">{data ? data.counts.waiting : (loading ? <div className="owner-skel" style={{ width: 24, height: 24, display: 'inline-block', borderRadius: 4 }} /> : '—')}</div></div>
        <div className="owner-kpi"><div className="label">Serving</div><div className="val">{data ? data.counts.serving : (loading ? <div className="owner-skel" style={{ width: 24, height: 24, display: 'inline-block', borderRadius: 4 }} /> : '—')}</div></div>
        <div className="owner-kpi"><div className="label">Completed</div><div className="val">{data ? data.counts.completedToday : (loading ? <div className="owner-skel" style={{ width: 24, height: 24, display: 'inline-block', borderRadius: 4 }} /> : '—')}</div></div>
      </div>

      <div className="owner-kpigrid three" style={{ marginBottom: 14 }}>
        <div className="owner-kpi"><div className="label">Ready to Checkout</div><div className="val">{data ? data.signals.readyForCheckout : (loading ? <div className="owner-skel" style={{ width: 24, height: 24, display: 'inline-block', borderRadius: 4 }} /> : '—')}</div></div>
        <div className="owner-kpi"><div className="label">Delayed Appts</div><div className="val" style={delayed > 0 ? { color: 'var(--owner-danger)' } : undefined}>{data ? delayed : (loading ? <div className="owner-skel" style={{ width: 24, height: 24, display: 'inline-block', borderRadius: 4 }} /> : '—')}</div></div>
        <div className="owner-kpi"><div className="label">Walk-ins Today</div><div className="val">{data ? data.todaySoFar.walkIns : (loading ? <div className="owner-skel" style={{ width: 24, height: 24, display: 'inline-block', borderRadius: 4 }} /> : '—')}</div></div>
      </div>

      <div className="owner-chartcard" style={{ marginBottom: 12 }}>
        <div className="owner-sechead"><div className="h">Tech Queue</div><div className="d">{data ? `${data.totals?.techQueue ?? data.techQueue.length} active` : ''}</div></div>
        {loading && !data ? <OwnerSkeletonList count={2} />
          : data && data.techQueue.length === 0 ? <div className="owner-state">No services in progress.</div>
          : (
            <div className="owner-drill">
              {(data?.techQueue ?? []).map((t, i) => (
                <div className="owner-drillrow" key={`${t.technicianId}-${i}`}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{t.technicianName}{t.paused ? <span className="owner-pill" style={{ marginLeft: 6 }}>Paused</span> : null}</div>
                    <div className="owner-text-muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.serviceLabel || 'In service'}{t.customerName ? ` · ${t.customerName}` : ''}</div>
                  </div>
                  <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginLeft: 10 }}>{fmtMin(t.elapsedMinutes)}</div>
                </div>
              ))}
              {data?.techQueuePage && data.techQueuePage.totalPages > 1 ? (
                <div data-testid="tq-pager" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, fontSize: 12.5 }}>
                  <button type="button" className="owner-btn" disabled={data.techQueuePage.page <= 1} onClick={() => setTqPage(Math.max(1, data.techQueuePage!.page - 1))}>‹ Previous</button>
                  <span>Page {data.techQueuePage.page} of {data.techQueuePage.totalPages}</span>
                  <button type="button" className="owner-btn" disabled={data.techQueuePage.page >= data.techQueuePage.totalPages} onClick={() => setTqPage(Math.min(data.techQueuePage!.totalPages, data.techQueuePage!.page + 1))}>Next ›</button>
                </div>
              ) : null}
            </div>
          )}
      </div>

      <div className="owner-chartcard" style={{ marginBottom: 12 }}>
        <div className="owner-sechead"><div className="h">Team</div><div className="d">{data?.team ? `${data.totals?.team ?? data.team.length} technicians` : ''}</div></div>
        {data?.team && (data.teamPage ? (data.totals?.team ?? 0) > TEAM_PAGE_SIZE || !!teamSearch || !!teamStatus : data.team.length > TEAM_PAGE_SIZE) ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <input type="search" aria-label="Search technicians" placeholder="Search technicians" value={teamQ} onChange={(e) => { setTeamQ(e.target.value); setTeamPage(1); }} style={{ flex: 1, minWidth: 140, height: 34, borderRadius: 8, border: '1px solid var(--owner-line, #ddd)', padding: '0 10px', font: 'inherit' }} />
            <select aria-label="Filter by status" value={teamStatus} onChange={(e) => { setTeamStatus(e.target.value); setTeamPage(1); }} style={{ height: 34, borderRadius: 8, font: 'inherit' }}>
              <option value="">All statuses</option>{Object.entries(QUEUE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        ) : null}
        {loading && !data ? <OwnerSkeletonList count={3} />
          : !data?.team || (data.team.length === 0 && !teamSearch && !teamStatus) ? <div className="owner-state">No technicians in this view.</div>
          : (() => { const v = data.teamPage ? { rows: data.team, total: data.teamPage.total, pages: data.teamPage.totalPages, page: data.teamPage.page } : teamView(data.team, teamQ, teamStatus, teamPage); return (
            <>
            <div className="owner-drill">
              {v.rows.length === 0 ? <div className="owner-state">No technician matches.</div> : null}
              {v.rows.map((t) => (
                <div className="owner-drillrow" key={t.technicianId}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{t.technicianName} <span className="owner-pill" style={{ marginLeft: 6 }}>{t.queueStatus ? (QUEUE[t.queueStatus] ?? t.queueStatus) : 'No status yet'}</span></div>
                    <div className="owner-text-muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.currentCustomerName ? `With ${t.currentCustomerName}` : clockWords(t.clockStatus)}</div>
                  </div>
                  <div style={{ textAlign: 'right', marginLeft: 10 }}>
                    <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatCentsPlain(t.salesTodayCents)}</div>
                    <div className="owner-text-muted" style={{ fontSize: 11 }}>tips {formatCentsPlain(t.tipsTodayCents)}</div>
                  </div>
                </div>
              ))}
            </div>
            {v.pages > 1 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, fontSize: 12.5 }}>
                <button type="button" className="owner-btn" disabled={v.page <= 1} onClick={() => setTeamPage(v.page - 1)}>‹ Previous</button>
                <span>Page {v.page} of {v.pages} · {v.total} technicians</span>
                <button type="button" className="owner-btn" disabled={v.page >= v.pages} onClick={() => setTeamPage(v.page + 1)}>Next ›</button>
              </div>
            ) : null}
            </>
          ); })()}
      </div>

      <div className="owner-chartcard">
        <div className="owner-sechead"><div className="h">Live Queue</div><div className="d">{data ? `${data.totals?.liveQueue ?? data.liveQueue.length} waiting${(data.totals?.liveQueue ?? 0) > data.liveQueue.length ? ` · showing the first ${data.liveQueue.length}` : ''}` : ''}</div></div>
        {loading && !data ? <OwnerSkeletonList count={2} />
          : data && data.liveQueue.length === 0 ? <div className="owner-state">No one waiting.</div>
          : (
            <div className="owner-drill">
              {(data?.liveQueue ?? []).map((q) => (
                <div className="owner-drillrow" key={q.queueItemId}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{q.customerName}{q.isVip ? <span className="owner-pill" style={{ marginLeft: 6 }}>VIP</span> : null}</div>
                    <div className="owner-text-muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.serviceLabel || 'Service'}{q.requestedTechnicianName ? ` · req. ${q.requestedTechnicianName}` : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right', marginLeft: 10 }}>
                    <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtMin(q.waitMinutes)}</div>
                    <div className="owner-text-muted" style={{ fontSize: 11, textTransform: 'capitalize' }}>{q.status}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
