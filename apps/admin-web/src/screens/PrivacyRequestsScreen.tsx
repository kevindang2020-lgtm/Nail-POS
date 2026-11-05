// PrivacyRequestsScreen.tsx — Super Admin › Customer Data Oversight › Privacy Requests.
// Dedicated full page for the customer privacy-request queue. REUSES the existing platform privacy-requests
// endpoint (/super-admin/platform/privacy-requests) which reads customer_privacy_requests and returns rows + kpis
// with status/overdue filtering — no duplicate backend. Read-only list (processing is permission-checked and
// audited server-side). Cream/gold, Mac-fit, honest rendering.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const statusTone = (s: string) => (s === 'completed' ? 'ok' : s === 'rejected' || s === 'cancelled' ? 'mut' : 'warn');
const typeLabel = (t: string) => ({ access: 'Access', correct: 'Correction', export: 'Export', delete: 'Deletion', anonymize: 'Anonymize', restrict: 'Restrict', withdraw_consent: 'Consent Withdrawal', opt_out_marketing: 'Marketing Opt-Out' } as Record<string, string>)[t] || cap(t);
const TERMINAL = new Set(['completed', 'rejected', 'cancelled']);
const isOverdue = (r: any) => !TERMINAL.has(r.status) && r.due_at && new Date(r.due_at).getTime() < Date.now();

const STATUS_FILTERS = ['new', 'identity_verification_required', 'verified', 'in_review', 'tenant_action_required', 'processing', 'completed', 'rejected', 'cancelled', 'overdue'];

export function PrivacyRequestsScreen() {
  const nav = useNavigate();
  const [data, setData] = useState<{ rows: any[]; total: number; kpis: any } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    setErr(null); setData(null);
    superAdminApi.privacyRequests({ status: status || undefined, pageSize: 200 }).then(setData).catch((e: any) => setErr(e?.message || 'Failed to load privacy requests.'));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;

  const rows = data?.rows ?? [];
  const kpis = data?.kpis ?? {};
  const total = data?.total ?? 0;
  const completed = (kpis.byStatus || []).find((s: any) => s.status === 'completed')?.n ?? 0;

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button className="self-start text-[#2C2118] px-1 py-2 border-b border-[var(--line)] text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]" onClick={() => nav('/customer-data-oversight')}>← Customer Data Oversight</button>
      <div className="vh" style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1>Privacy Requests</h1>
          <div className="sub">Customer privacy-request queue across all tenants — access, correction, export, deletion, restriction, and consent-withdrawal requests with due dates. Processing is permission-checked and audited server-side.</div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {[['Requests', kpis.total ?? total], ['Overdue', kpis.overdue ?? 0], ['Completed', completed], ['Shown', rows.length]].map(([label, val]) => (
          <div key={label as string} className="kpi" style={{ background: '#fff', border: '1px solid var(--line)' }}>
            <div className="l" style={{ fontSize: 11 }}>{label}</div><div className="v" style={{ fontSize: 20, color: label === 'Overdue' && (val as number) > 0 ? 'var(--danger,#B85B4D)' : undefined }}>{Number(val as number).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <section className="panel">
        <div className="phead">
          <h2>Privacy Requests <span className="muted">({rows.length})</span></h2>
          <select className="inp" style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All Statuses</option>{STATUS_FILTERS.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
          </select>
        </div>
        {data === null ? <div className="state">Loading privacy requests…</div> : rows.length === 0 ? (
          <div className="state">No privacy requests{status ? ` with status “${cap(status)}”` : ''}.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5, minWidth: 820 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Type</th><th>Customer</th><th>Requester</th><th>Tenant</th><th>Status</th><th>Due</th><th>Created</th></tr></thead>
              <tbody>
                {rows.map((p: any) => {
                  const overdue = isOverdue(p);
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{typeLabel(p.request_type)}</td>
                      <td className="muted">{p.customer_id || '—'}</td>
                      <td className="muted">{p.requester_name || '—'}</td>
                      <td className="muted">{p.tenant_name || p.tenant_id || '—'}</td>
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
