import { useCallback, useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { useOwnerStream } from '../api/useOwnerStream';
import { ownerLiveApi, type OwnerLiveOperationsResp } from '../api/ownerApi';
import { OwnerSkeletonList } from '../components/OwnerSkeleton';

// Live Operations — Module 2. Read-only owner view of the live floor for the selected branch (or all locations).
// Every number comes from the SAME canonical POS records (pos_queue_items / tickets / pos_tech_appointments), scoped
// server-side to this owner's tenant and branch access — the Owner App never re-derives or mutates the front-desk flow.
// Stays fresh via the existing owner SSE stream (refetch on any owner/branch event) with a controlled polling fallback.

const fmtMin = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const fmtTime = (iso: string): string => { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

export function LiveOperationsScreen() {
  const { effectiveBranchId } = useOwnerBranch();
  const [data, setData] = useState<OwnerLiveOperationsResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setError(null);
    ownerLiveApi.get(effectiveBranchId)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: any) => { setError(e?.message || 'Could not load live operations.'); setLoading(false); });
  }, [effectiveBranchId]);

  useEffect(() => { setLoading(true); setData(null); load(); }, [load]);
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
        <div className="owner-sechead"><div className="h">Tech Queue</div><div className="d">{data ? `${data.techQueue.length} active` : ''}</div></div>
        {loading && !data ? <OwnerSkeletonList count={2} />
          : data && data.techQueue.length === 0 ? (
            <div
              className="owner-state"
              style={{
                minHeight: 180,
                padding: '36px 16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #FBF3E4 0%, #EFE1C9 100%)',
                  border: '1px solid #DBCAB0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                  marginBottom: 10,
                }}
              >
                💅
              </div>
              <div style={{ fontSize: 14, color: 'var(--owner-text-muted)' }}>
                No services in progress.
              </div>
            </div>
          ) : (
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
            </div>
          )}
      </div>

      <div className="owner-chartcard">
        <div className="owner-sechead"><div className="h">Live Queue</div><div className="d">{data ? `${data.liveQueue.length} waiting` : ''}</div></div>
        {loading && !data ? <OwnerSkeletonList count={2} />
          : data && data.liveQueue.length === 0 ? (
            <div
              className="owner-state"
              style={{
                minHeight: 180,
                padding: '36px 16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
              }}
            >
              <div
                aria-hidden
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #FBF3E4 0%, #EFE1C9 100%)',
                  border: '1px solid #DBCAB0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 26,
                  marginBottom: 10,
                }}
              >
                🪑
              </div>
              <div style={{ fontSize: 14, color: 'var(--owner-text-muted)' }}>
                No one waiting.
              </div>
            </div>
          ) : (
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
