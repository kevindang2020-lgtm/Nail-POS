import { useState } from 'react';
import { useScopedQuery, useScopedSetter, useStreamInvalidation, OfflineStatus, fmtDateTime } from '@aipowersalon/mobile-sdk';
import { ownerMoreApi, type OwnerAlert, type OwnerAlertStatus } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';
import { useOwnerStream } from '../api/useOwnerStream';


// AlertsScreen — Module 6. Lists owner_alerts with a status filter; each actionable alert exposes acknowledge / resolve /
// dismiss, which POST to the API and update the row in place. Real data; honest loading/error/empty.

const SEV_COLOR: Record<string, string> = { info: 'var(--owner-info)', warning: 'var(--owner-warning)', high: '#D97706', critical: 'var(--owner-danger)' };
const SEV_BG: Record<string, string> = { info: 'var(--owner-info-wash, #E8F0FE)', warning: 'var(--owner-gold-wash)', high: '#FEF0E1', critical: '#FDECEC' };
const FILTERS: { label: string; value: OwnerAlertStatus | 'all' }[] = [
  { label: 'All', value: 'all' }, { label: 'New', value: 'new' }, { label: 'Acknowledged', value: 'acknowledged' }, { label: 'Resolved', value: 'resolved' },
];
const fmtDate = (iso: string) => fmtDateTime(iso);

export function AlertsScreen() {
  const { back } = useOwnerNav();
  const [filter, setFilter] = useState<OwnerAlertStatus | 'all'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  // BUILD_PLAN Phase 13: alerts through the query layer (scoped key per filter, offline read cache, stream-invalidated);
  // the previous filter's list stays on screen while the next one loads, as before.
  const aq = useScopedQuery<OwnerAlert[]>({ key: ['owner', 'alerts', filter], fn: () => ownerMoreApi.alerts(filter === 'all' ? undefined : { status: filter }), persist: true, keepPrevious: true });
  // An action's returned row paints at once (local state), and is written to the cache too.
  const [patched, setPatched] = useState<{ base: OwnerAlert[] | undefined; list: OwnerAlert[] } | null>(null);
  const alerts = (patched && patched.base === aq.data ? patched.list : aq.data) ?? null;
  const loading = aq.isFetching;
  const e0 = aq.error as any;
  const err = aq.isError && !aq.data ? (e0?.status === 403 ? 'You do not have access to alerts.' : e0?.message || 'Unable to load alerts.') : null;
  const setAlerts = useScopedSetter();
  const load = (_f: OwnerAlertStatus | 'all') => { void aq.refetch(); };
  const onStream = useStreamInvalidation([['owner', 'alerts']], ['owner_alert_updated', 'owner_alert_created']);
  useOwnerStream((e) => { if (e === 'owner_alert_updated' || e === 'owner_alert_created') onStream(e); });

  const act = async (id: string, action: 'acknowledge' | 'resolve' | 'dismiss') => {
    setBusyId(id);
    try {
      const updated = await ownerMoreApi[action](id);
      const patch = (prev: OwnerAlert[] | undefined | null) => prev ? prev.map((a) => (a.id === id ? updated : a)).filter((a) => filter === 'all' || a.status === filter) : prev ?? undefined;
      const next = patch(alerts);
      if (next) setPatched({ base: aq.data, list: next });
      setAlerts<OwnerAlert[]>(['owner', 'alerts', filter], patch);
    } catch { /* leave as-is */ } finally { setBusyId(null); }
  };

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Business Alerts</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div className="owner-tabs">
        {FILTERS.map((f) => (<button key={f.value} className={`owner-tab ${filter === f.value ? 'active' : ''}`} onClick={() => setFilter(f.value)}>{f.label}</button>))}
      </div>

      <OfflineStatus updatedAt={aq.dataUpdatedAt || undefined} failed={aq.isError} />
      {loading && !alerts ? (
        <div>
          {[1, 2, 3].map((i) => (
            <div className="owner-alertcard" key={i} style={{ borderLeftColor: 'var(--owner-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div className="owner-skel" style={{ width: 140, height: 16 }} />
                <div className="owner-skel" style={{ width: 60, height: 22, borderRadius: 12 }} />
              </div>
              <div className="owner-skel" style={{ width: '80%', height: 14, marginTop: 8 }} />
              <div className="af">
                <div className="owner-skel" style={{ width: 100, height: 14 }} />
                <div className="owner-skel" style={{ width: 120, height: 24, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      ) : err ? (
        <div className="owner-state"><div className="big owner-serif">Couldn’t load alerts</div><div className="muted" style={{ marginBottom: 16 }}>{err}</div><button className="owner-btn" onClick={() => load(filter)}>Retry</button></div>
      ) : alerts && alerts.length === 0 ? (
        <div className="owner-state"><div className="big owner-serif">No alerts</div><div className="muted">Nothing matches this filter.</div></div>
      ) : alerts ? (
        <div>
          {alerts.map((a) => {
            const actionable = a.status === 'new' || a.status === 'acknowledged' || a.status === 'in_progress';
            return (
              <div className="owner-alertcard" key={a.id} style={{ borderLeftColor: SEV_COLOR[a.severity] }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div className="at">{a.title}</div>
                  <span className="owner-sevbadge" style={{ color: SEV_COLOR[a.severity], background: SEV_BG[a.severity] }}>{a.severity}</span>
                </div>
                {a.body && <div className="ab">{a.body}</div>}
                <div className="af">
                  <span className="meta">{fmtDate(a.createdAt)}</span>
                  {actionable ? (
                    <div className="owner-alertactions">
                      {a.status === 'new' && <button className="owner-actbtn" disabled={busyId === a.id} onClick={() => act(a.id, 'acknowledge')}>Ack</button>}
                      <button className="owner-actbtn primary" disabled={busyId === a.id} onClick={() => act(a.id, 'resolve')}>Resolve</button>
                      <button className="owner-actbtn" disabled={busyId === a.id} onClick={() => act(a.id, 'dismiss')}>Dismiss</button>
                    </div>
                  ) : (
                    <span className="owner-statuspill">{a.status}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
