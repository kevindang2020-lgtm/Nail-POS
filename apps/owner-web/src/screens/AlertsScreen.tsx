import { useEffect, useState } from 'react';
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
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function AlertsScreen() {
  const { back } = useOwnerNav();
  const [filter, setFilter] = useState<OwnerAlertStatus | 'all'>('all');
  const [alerts, setAlerts] = useState<OwnerAlert[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = (f: OwnerAlertStatus | 'all') => {
    setLoading(true); setErr(null);
    ownerMoreApi.alerts(f === 'all' ? undefined : { status: f })
      .then(setAlerts)
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to alerts.' : e?.message || 'Unable to load alerts.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(filter); }, [filter]);
  useOwnerStream((e) => { if (e === 'owner_alert_updated' || e === 'owner_alert_created') load(filter); });

  const act = async (id: string, action: 'acknowledge' | 'resolve' | 'dismiss') => {
    setBusyId(id);
    try {
      const updated = await ownerMoreApi[action](id);
      setAlerts((prev) => prev ? prev.map((a) => (a.id === id ? updated : a)).filter((a) => filter === 'all' || a.status === filter) : prev);
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
