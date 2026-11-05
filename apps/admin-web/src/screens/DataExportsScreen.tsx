// DataExportsScreen.tsx — Super Admin › Customer Data Oversight › Data Exports.
// Dedicated full page for customer DATA-EXPORT requests. These live in customer_privacy_requests as request_type
// 'export', so this REUSES the existing platform privacy-requests endpoint and narrows to export-type rows — no
// duplicate backend. Read-only (export generation is tenant-scoped, field-permission-checked, and audited
// server-side). Cream/gold, Mac-fit, honest rendering.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const TERMINAL = new Set(['completed', 'rejected', 'cancelled']);
const statusTone = (s: string) => (s === 'completed' ? 'ok' : s === 'rejected' || s === 'cancelled' ? 'mut' : 'warn');
const isOverdue = (r: any) => !TERMINAL.has(r.status) && r.due_at && new Date(r.due_at).getTime() < Date.now();

export function DataExportsScreen() {
  const nav = useNavigate();
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    setErr(null); setRows(null);
    superAdminApi.privacyRequests({ status: status || undefined, pageSize: 300 })
      .then((d: any) => setRows((d?.rows ?? []).filter((r: any) => r.request_type === 'export')))
      .catch((e: any) => setErr(e?.message || 'Failed to load data-export requests.'));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const r = rows || [];
    return {
      total: r.length,
      pending: r.filter((x) => !TERMINAL.has(x.status)).length,
      overdue: r.filter(isOverdue).length,
      completed: r.filter((x) => x.status === 'completed').length,
    };
  }, [rows]);

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button className="self-start text-[#2C2118] px-1 py-2 border-b border-[var(--line)] text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]" onClick={() => nav('/customer-data-oversight')}>← Customer Data Oversight</button>
      <div className="vh" style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1>Data Exports</h1>
          <div className="sub">Customer data-export requests across all tenants. Export generation is tenant-scoped, field-permission-checked, and audited server-side — no secrets, tokens, payment credentials, or other tenants' data are ever included.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">

        {[['Export Requests', summary.total], ['Pending', summary.pending], ['Overdue', summary.overdue], ['Completed', summary.completed]].map(([label, val]) => (
          <div key={label as string} className="kpi" style={{ background: '#fff', border: '1px solid var(--line)' }}>
            <div className="l" style={{ fontSize: 11 }}>{label}</div><div className="v" style={{ fontSize: 20, color: label === 'Overdue' && (val as number) > 0 ? 'var(--danger,#B85B4D)' : undefined }}>{(val as number).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="phead">
          <h2>Data Export Requests <span className="muted">({rows?.length ?? 0})</span></h2>
          <select className="inp" style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All Statuses</option>{['new', 'in_review', 'processing', 'completed', 'rejected', 'cancelled', 'overdue'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}
          </select>
        </div>
        {rows === null ? <div className="state">Loading data-export requests…</div> : rows.length === 0 ? (
          <div className="state">No data-export requests{status ? ` with status “${cap(status)}”` : ''}.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5, minWidth: 780 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Customer</th><th>Requester</th><th>Tenant</th><th>Scope</th><th>Status</th><th>Due</th><th>Created</th></tr></thead>
              <tbody>
                {rows.map((p: any) => {
                  const overdue = isOverdue(p);
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.customer_id || '—'}</td>
                      <td className="muted">{p.requester_name || '—'}</td>
                      <td className="muted">{p.tenant_name || p.tenant_id || '—'}</td>
                      <td className="muted">{p.scope ? cap(p.scope) : '—'}</td>
                      <td><span className={'pill ' + statusTone(p.status)}>{cap(p.status)}</span></td>
                      <td>{p.due_at ? <span style={{ color: overdue ? 'var(--danger,#B85B4D)' : undefined, fontWeight: overdue ? 700 : undefined }}>{new Date(p.due_at).toLocaleDateString()}{overdue ? ' · Overdue' : ''}</span> : <span className="muted">—</span>}</td>
                      <td className="muted">{p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
