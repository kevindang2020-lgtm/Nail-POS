// ImportHistoryScreen.tsx — Super Admin › Customer Data Oversight › Import History.
// Dedicated full page for the customer-import lifecycle: staging → approval → idempotent retry. Reuses the import
// endpoints (list/approve/retry/reject) already backing the imports drawer. Tenant-scoped, permission-guarded and
// audited server-side; honest rendering (no fabricated jobs). Cream/gold, Mac-fit.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { useNavigate } from 'react-router-dom';
import { superAdminApi, type ImportJob } from '../api/superAdminApi';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const STATUS_TONE: Record<string, string> = { completed: 'ok', failed: 'bad', rejected: 'mut', pending: 'warn', approved: 'warn', processing: 'warn' };
const STATUSES = ['pending', 'approved', 'processing', 'completed', 'failed', 'rejected'];

export function ImportHistoryScreen() {
  const nav = useNavigate();
  const [jobs, setJobs] = useState<ImportJob[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    setErr(null); setJobs(null);
    superAdminApi.importJobs({ status: status || undefined }).then(setJobs).catch((e: any) => setErr(e?.message || 'Failed to load import jobs.'));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const j = jobs || [];
    return {
      total: j.length,
      pending: j.filter((x) => x.status === 'pending').length,
      failed: j.filter((x) => x.status === 'failed').length,
      imported: j.reduce((a, x) => a + x.importedRows, 0),
    };
  }, [jobs]);
  const { ask, askUi } = useInlineAsk();

  const finish = async (kind: string, p: Promise<any>) => {
    const res = await p;
    if (!res.ok) { setMsg((res.errors || ['Action failed.']).join(' ')); return; }
    setMsg(`Import ${kind} succeeded${res.job ? ` — ${res.job.importedRows} imported, ${res.job.failedRows} failed.` : '.'}`);
    load();
  };
  const act = async (id: string, kind: 'approve' | 'retry' | 'reject') => {
    if (kind === 'reject') { ask('Reason for rejecting this import?', (reason) => { void finish(kind, superAdminApi.rejectImport(id, reason)); }); return; }
    await finish(kind, kind === 'approve' ? superAdminApi.approveImport(id) : superAdminApi.retryImport(id));
  };

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;

  return (
    <>
      {askUi}
      <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button className="self-start text-[#2C2118] px-1 py-2 border-b border-[var(--line)] text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]" onClick={() => nav('/customer-data-oversight')}>← Customer Data Oversight</button>
        <div className="vh" style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h1>Import History</h1>
            <div className="sub">Customer bulk imports across all tenants — staged and validated before any record is written, with idempotent retry.</div>
          </div>
        </div>

        {/* summary strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {[['Import Jobs', summary.total], ['Pending Approval', summary.pending], ['Failed', summary.failed], ['Rows Imported', summary.imported]].map(([label, val]) => (
            <div key={label as string} className="kpi" style={{ background: '#fff', border: '1px solid var(--line)' }}>
              <div className="l" style={{ fontSize: 11 }}>{label}</div>
              <div className="v" style={{ fontSize: 20 }}>{(val as number).toLocaleString()}</div>
            </div>
          ))}
        </div>

        {msg ? <div className="state">{msg} <button className="linkbtn" onClick={() => setMsg(null)}>Dismiss</button></div> : null}

        <section className="panel">
          <div className="phead">
            <h2>Import Jobs <span className="muted">({jobs?.length ?? 0})</span></h2>
            <select className="inp" style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="">All Statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
            </select>
          </div>
          {jobs === null ? <div className="state">Loading import jobs…</div> : jobs.length === 0 ? (
            <div className="state">No import jobs{status ? ` with status “${cap(status)}”` : ''}. Imports created via CSV upload or the API appear here for review.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tgrid" style={{ width: '100%', fontSize: 12.5, minWidth: 820 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>
                  <th>Job</th><th>Source</th><th>Status</th><th>Total</th><th>Valid</th><th>Invalid</th><th>Imported</th><th>Failed</th><th>Created</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td style={{ fontWeight: 600 }}>{j.filename || j.id}</td>
                      <td className="muted">{cap(j.source)}</td>
                      <td><span className={'pill ' + (STATUS_TONE[j.status] || 'mut')}>{cap(j.status)}</span></td>
                      <td>{j.totalRows}</td><td>{j.validRows}</td><td>{j.invalidRows}</td><td>{j.importedRows}</td><td>{j.failedRows}</td>
                      <td className="muted">{new Date(j.createdAt).toLocaleDateString()}</td>
                      <td>
                        {j.status === 'pending' ? <><button className="linkbtn" onClick={() => act(j.id, 'approve')}>Approve</button> <button className="linkbtn" onClick={() => act(j.id, 'reject')}>Reject</button></> : null}
                        {j.status === 'completed' || j.status === 'failed' ? <button className="linkbtn" onClick={() => act(j.id, 'retry')}>Retry</button> : null}
                        {j.status === 'rejected' || j.status === 'processing' || j.status === 'approved' ? <span className="muted">—</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
