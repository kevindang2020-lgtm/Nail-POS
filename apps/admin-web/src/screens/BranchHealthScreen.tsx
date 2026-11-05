// Super-Admin → System Operations → Branch health — BUILD_PLAN Phase 14 B (Constitution 11 §345).
//
// Every branch of every salon, its latest 15-minute snapshot (GET /super-admin/branch-health), worst first by default.
// A NULL fact is NOT MEASURED (no source, or its query failed — named), shown as "—" with the failed query listed; never 0.
import { useCallback, useEffect, useState } from 'react';
import type { SuperAdminBranchHealthList, SuperAdminBranchHealthRow } from '@aipowersalon/api-contracts/platform';
import type { BranchHealthStatus } from '@aipowersalon/api-contracts/tenant';
import { opsDashboardsApi } from '../api/opsDashboardsApi';

const STATES: BranchHealthStatus[] = ['OUTAGE', 'DEGRADED', 'UNKNOWN', 'HEALTHY'];
export const STATUS_COLOR: Record<BranchHealthStatus, string> = { HEALTHY: '#3E8F57', DEGRADED: '#A0711B', OUTAGE: '#B85B4D', UNKNOWN: '#6B6B6B' };
const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-US'));
const of = (a: number | null, b: number | null) => (a == null || b == null ? '—' : `${a}/${b}`);
const wait = (s: number | null) => (s == null ? '—' : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
const at = (s: string | null) => (s ? new Date(s).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');

function Row({ r }: { r: SuperAdminBranchHealthRow }) {
  return (
    <tr data-testid={`bh-${r.branchId}`}>
      <td>{r.tenantName ?? r.tenantId}</td><td>{r.branchName ?? r.branchId}</td>
      <td><span className="badge" style={{ color: STATUS_COLOR[r.overall] }}>{r.overall}</span></td>
      <td style={{ fontSize: 12 }}>{[...r.reasons, ...r.failedQueries.map((q) => `not measured: ${q}`)].join(', ') || '—'}</td>
      <td>{n(r.openTickets)}</td><td>{n(r.queueWaiting)} · {wait(r.queueLongestWaitSeconds)}</td><td>{n(r.techniciansOnShift)}</td>
      <td>{n(r.paymentsLastHour)} / {n(r.paymentsFailedLastHour)} failed</td>
      <td>{of(r.displaysOnline, r.displaysTotal)} · {of(r.kiosksOnline, r.kiosksTotal)} · {n(r.terminalsPaired)}</td>
      <td>{n(r.smsSentLastHour)} / {n(r.smsFailedLastHour)} failed</td>
      <td>{at(r.lastRealtimeEventAt)}</td><td>{at(r.observedAt)}</td>
    </tr>
  );
}

export function BranchHealthScreen() {
  const [sort, setSort] = useState<'worst' | 'name' | 'observed'>('worst');
  const [status, setStatus] = useState<BranchHealthStatus | ''>('');
  const [data, setData] = useState<SuperAdminBranchHealthList | 'error' | null>(null);
  const [more, setMore] = useState<SuperAdminBranchHealthRow[]>([]);
  const load = useCallback(() => {
    setData(null); setMore([]);
    opsDashboardsApi.branchHealth({ sort, status: status || undefined }).then(setData).catch(() => setData('error'));
  }, [sort, status]);
  useEffect(load, [load]);
  const [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => { setCursor(data && data !== 'error' ? data.nextCursor : null); }, [data]);
  const loadMore = () => {
    if (!cursor) return;
    opsDashboardsApi.branchHealth({ sort, status: status || undefined, cursor })
      .then((p) => { setMore((m) => [...m, ...p.rows]); setCursor(p.nextCursor); }).catch(() => setData('error'));
  };

  return (
    <div className="page">
      <div className="phead"><h1>Branch health</h1>
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={load}>Refresh</button></div>
      <p className="muted" style={{ fontSize: 13, maxWidth: 820 }}>
        Each branch is snapshotted every 15 minutes: open tickets, the walk-in queue, technicians on shift, payments and SMS in the last hour,
        devices online (displays · kiosks · paired terminals) and the last realtime event. “—” means not measured, never zero.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12 }}>Sort{' '}
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as any)}>
            <option value="worst">Worst first</option><option value="name">Salon / branch name</option><option value="observed">Most recently observed</option>
          </select></label>
        <label style={{ fontSize: 12 }}>Status{' '}
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="">All</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
      </div>
      {data === null ? <div className="state">Loading…</div> : data === 'error' ? <div className="state" role="alert">Branch health could not be read.</div> : (
        <div className="panel">
          <p style={{ fontSize: 13 }} data-testid="bh-counts">{data.total} branch(es) · {STATES.map((s) => `${data.counts[s] ?? 0} ${s.toLowerCase()}`).join(' · ')}</p>
          {data.rows.length === 0 ? <div className="state">No branch has been snapshotted yet — the first snapshot runs within 15 minutes of the worker starting.</div> : (
            <table className="table" data-testid="bh-table">
              <thead><tr><th>Salon</th><th>Branch</th><th>Status</th><th>Why</th><th>Open tickets</th><th>Queue · longest wait</th><th>On shift</th>
                <th>Payments (1 h)</th><th>Displays · kiosks · terminals</th><th>SMS (1 h)</th><th>Last realtime</th><th>Observed</th></tr></thead>
              <tbody>{[...data.rows, ...more].map((r) => <Row key={r.branchId} r={r} />)}</tbody>
            </table>
          )}
          {cursor ? <button className="btn ghost" onClick={loadMore}>Load more</button> : null}
        </div>
      )}
    </div>
  );
}
