// SalonHealthPanel — Constitution 11 §156: every salon's operational health, from the hourly snapshots (§344).
// Explicit components, not an opaque score (§157). A salon the sweep has not reached yet is simply not listed — never
// shown as healthy — and "Not in use" (UNKNOWN) is its own state, sorted after every real problem.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HealthListSort, IntegrationState, TenantHealthList } from '@aipowersalon/api-contracts/platform';
import { superAdminApi } from '../api/superAdminApi';

const LABEL: Record<IntegrationState, string> = { HEALTHY: 'Healthy', DEGRADED: 'Degraded', MISCONFIGURED: 'Misconfigured', RATE_LIMITED: 'Rate limited', OUTAGE: 'Outage', UNKNOWN: 'Not in use' };
const COLOR: Record<IntegrationState, [string, string]> = { HEALTHY: ['#EAF5EE', '#3E8F57'], DEGRADED: ['#FFF6E5', '#D09A36'], MISCONFIGURED: ['#FFF6E5', '#D09A36'], RATE_LIMITED: ['#FFF6E5', '#D09A36'], OUTAGE: ['#FBEFE9', '#B85B4D'], UNKNOWN: ['#F2EEE8', '#8A8175'] };
const COMPONENTS = [['payments', 'Payments'], ['messaging', 'Messaging'], ['booking', 'Booking'], ['devices', 'Devices'], ['jobs', 'Jobs']] as const;
const STATES: IntegrationState[] = ['OUTAGE', 'MISCONFIGURED', 'DEGRADED', 'RATE_LIMITED', 'UNKNOWN', 'HEALTHY'];

function Badge({ s }: { s: IntegrationState }) {
  return <span className="badge" style={{ background: COLOR[s][0], color: COLOR[s][1] }}>{LABEL[s]}</span>;
}

export function SalonHealthPanel() {
  const nav = useNavigate();
  const [sort, setSort] = useState<HealthListSort>('worst');
  const [status, setStatus] = useState<IntegrationState | ''>('');
  const [data, setData] = useState<TenantHealthList | 'error' | null>(null);

  useEffect(() => {
    let alive = true; setData(null);
    superAdminApi.tenantHealthList(sort, status || undefined).then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setData('error'); });
    return () => { alive = false; };
  }, [sort, status]);
  // Constitution 7 §290: the server sends one page (100); more on request, never every salon at once
  const [moreBusy, setMoreBusy] = useState(false);
  const loadMore = async () => {
    if (!data || data === 'error' || !data.nextCursor) return;
    setMoreBusy(true);
    try { const next = await superAdminApi.tenantHealthList(sort, status || undefined, data.nextCursor); setData({ ...next, rows: [...data.rows, ...next.rows] }); }
    catch { /* keep what is shown */ } finally { setMoreBusy(false); }
  };

  const sel: React.CSSProperties = { height: 30, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5 };
  return (
    <div className="panel" data-testid="salon-health" style={{ marginBottom: 12 }}>
      <div className="phead">
        <h2>Salon Health</h2>
        <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>hourly snapshot per salon{data && data !== 'error' && typeof data.total === 'number' ? ` · showing ${data.rows.length} of ${data.total}` : ''}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <select aria-label="Sort salons" value={sort} onChange={(e) => setSort(e.target.value as HealthListSort)} style={sel}>
            <option value="worst">Worst first</option><option value="name">Name</option><option value="observed">Oldest snapshot</option>
          </select>
          <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as IntegrationState | '')} style={sel}>
            <option value="">All statuses</option>
            {STATES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
          </select>
        </div>
      </div>
      {data === null ? <div className="state">Loading salon health…</div>
        : data === 'error' ? <div className="state">Salon health could not be read right now.</div>
        : data.rows.length === 0 ? <div className="state">{status ? `No salon is ${LABEL[status as IntegrationState].toLowerCase()} in the latest snapshots.` : 'No snapshots yet — the hourly sweep has not run.'}</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Salon</th><th>Overall</th>{COMPONENTS.map(([, l]) => <th key={l}>{l}</th>)}<th>Snapshot</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.tenantId} onClick={() => nav(`/tenants?tenantId=${encodeURIComponent(r.tenantId)}`)} style={{ cursor: 'pointer' }} title="Open this salon">
                    <td>{r.tenantName || r.tenantId}{r.failedQueries.length ? <span className="muted" style={{ fontSize: 11 }}> · some checks could not run</span> : null}</td>
                    <td><Badge s={r.overall} /></td>
                    {COMPONENTS.map(([k]) => <td key={k}><Badge s={r.components[k]} /></td>)}
                    <td className="muted" style={{ fontSize: 12 }}>{new Date(r.observedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.nextCursor ? <button className="btn ghost" style={{ marginTop: 8 }} disabled={moreBusy} onClick={loadMore}>{moreBusy ? 'Loading…' : 'Load more'}</button> : null}
          </div>
        )}
    </div>
  );
}
