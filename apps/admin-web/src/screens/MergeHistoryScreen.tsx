// MergeHistoryScreen.tsx — Super Admin › Customer Data Oversight › Merge History.
// Dedicated full page for the customer merge audit trail (customer_merge_logs). Read-only: merges are executed
// through the authorized support-session flow and are recoverable from this log. Tenant-scoped, honest rendering
// (no fabricated merges). Cream/gold, Mac-fit.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi, type MergeLogRow } from '../api/superAdminApi';

export function MergeHistoryScreen() {
  const nav = useNavigate();
  const [rows, setRows] = useState<MergeLogRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [tenantOptions, setTenantOptions] = useState<{ tenantId: string; label: string }[]>([]);

  const load = useCallback(() => {
    setErr(null); setRows(null);
    superAdminApi.mergeHistory({ tenantId: tenantId || undefined }).then(setRows).catch((e: any) => setErr(e?.message || 'Failed to load merge history.'));
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { superAdminApi.customerDataOversight().then((o) => setTenantOptions(o.customersByTenant.map((t) => ({ tenantId: t.tenantId, label: t.label })))).catch(() => setTenantOptions([])); }, []);

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button className="self-start text-[#2C2118] px-1 py-2 border-b border-[var(--line)] text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]" onClick={() => nav('/customer-data-oversight')}>← Customer Data Oversight</button>
      <div className="vh" style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1>Merge History</h1>
          <div className="sub">Immutable audit trail of authorized customer merges. Every merge is within a single tenant, reason-logged, and recoverable from this log.</div>
        </div>
      </div>

      <section className="panel">
        <div className="phead">
          <h2>Merges <span className="muted">({rows?.length ?? 0})</span></h2>
          <select className="inp" style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8 }} value={tenantId} onChange={(e) => setTenantId(e.target.value)} aria-label="Filter by tenant">
            <option value="">All Tenants</option>{tenantOptions.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.label}</option>)}
          </select>
        </div>
        {rows === null ? <div className="state">Loading merge history…</div> : rows.length === 0 ? (
          <div className="state">No merges recorded{tenantId ? ' for this tenant' : ''} yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5, minWidth: 640 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>From Record</th><th>To Record</th><th>Authorized By</th><th>Time</th></tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="muted">{m.sourceCustomerId}</td>
                    <td style={{ fontWeight: 600 }}>{m.targetCustomerId}</td>
                    <td className="muted">{m.mergedByUserId || '—'}</td>
                    <td className="muted">{new Date(m.mergedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
