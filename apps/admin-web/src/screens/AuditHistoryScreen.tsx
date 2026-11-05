// AuditHistoryScreen.tsx — Super Admin › Customer Data Oversight › Audit History.
// Dedicated full page for the customer-data audit feed (audit_logs, filtered to customer-data action/entity types:
// merges, legal holds, imports, deletions, corrections). Append-only trail; read-only. Tenant-scoped, honest
// rendering. Cream/gold, Mac-fit.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi, type ActivityRow } from '../api/superAdminApi';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const tone = (a: string) => (a.includes('deletion') ? 'bad' : a.includes('legal_hold') ? 'warn' : a.includes('merge') ? 'mut' : 'ok');

export function AuditHistoryScreen() {
  const nav = useNavigate();
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [tenantOptions, setTenantOptions] = useState<{ tenantId: string; label: string }[]>([]);

  const load = useCallback(() => {
    setErr(null); setRows(null);
    superAdminApi.auditHistory({ tenantId: tenantId || undefined }).then(setRows).catch((e: any) => setErr(e?.message || 'Failed to load audit history.'));
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { superAdminApi.customerDataOversight().then((o) => setTenantOptions(o.customersByTenant.map((t) => ({ tenantId: t.tenantId, label: t.label })))).catch(() => setTenantOptions([])); }, []);

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button className="self-start text-[#2C2118] px-1 py-2 border-b border-[var(--line)] text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]" onClick={() => nav('/customer-data-oversight')}>← Customer Data Oversight</button>
      <div className="vh" style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1>Audit History</h1>
          <div className="sub">Append-only record of customer-data governance actions — merges, legal holds, imports, corrections, and permanent deletions — across all tenants.</div>
        </div>
      </div>

      <section className="panel">
        <div className="phead">
          <h2>Customer Data Audit Trail <span className="muted">({rows?.length ?? 0})</span></h2>
          <select className="inp" style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8 }} value={tenantId} onChange={(e) => setTenantId(e.target.value)} aria-label="Filter by tenant">
            <option value="">All Tenants</option>{tenantOptions.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.label}</option>)}
          </select>
        </div>
        {rows === null ? <div className="state">Loading audit history…</div> : rows.length === 0 ? (
          <div className="state">No customer-data audit events{tenantId ? ' for this tenant' : ''} yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5, minWidth: 680 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Action</th><th>Entity</th><th>Reference</th><th>Actor</th><th>Time</th></tr></thead>
              <tbody>
                {rows.map((a, i) => (
                  <tr key={i}>
                    <td><span className={'pill ' + tone(a.action)}>{cap(a.action)}</span></td>
                    <td className="muted">{cap(a.entityType || '—')}</td>
                    <td className="muted">{a.entityId || '—'}</td>
                    <td className="muted">{a.actorUserId || '—'}</td>
                    <td className="muted">{new Date(a.at).toLocaleString()}</td>
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
