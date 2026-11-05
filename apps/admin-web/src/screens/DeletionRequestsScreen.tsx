// DeletionRequestsScreen.tsx — Super Admin › Customer Data Oversight › Deletion Requests.
// Dedicated full page for the permanent-deletion lifecycle: request → approval by a SECOND, distinct reviewer →
// execute (exact typed customer-ID confirmation + retention check + legal-hold guard, all server-enforced). The
// highest-risk action on the module, so the execute control is danger-styled and gated. Reuses the deletion
// endpoints; every step is audited. Cream/gold, Mac-fit, honest rendering.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { useNavigate } from 'react-router-dom';
import { superAdminApi, type DeletionRequest } from '../api/superAdminApi';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const TONE: Record<string, string> = { executed: 'bad', approved: 'warn', requested: 'ok', rejected: 'mut', cancelled: 'mut' };
const fld: React.CSSProperties = { display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 };

export function DeletionRequestsScreen() {
  const nav = useNavigate();
  const [reqs, setReqs] = useState<DeletionRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [tenantOptions, setTenantOptions] = useState<{ tenantId: string; label: string }[]>([]);
  const [form, setForm] = useState({ tenantId: '', customerId: '', reason: '' });
  const [execFor, setExecFor] = useState<null | { req: DeletionRequest; typed: string }>(null);

  const load = useCallback(() => {
    setErr(null); setReqs(null);
    superAdminApi.deletionRequests({ status: statusFilter || undefined }).then(setReqs).catch((e: any) => setErr(e?.message || 'Failed to load deletion requests.'));
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { superAdminApi.customerDataOversight().then((o) => setTenantOptions(o.customersByTenant.map((t) => ({ tenantId: t.tenantId, label: t.label })))).catch(() => setTenantOptions([])); }, []);

  const summary = useMemo(() => {
    const r = reqs || [];
    return {
      total: r.length,
      awaitingApproval: r.filter((x) => x.status === 'requested').length,
      approved: r.filter((x) => x.status === 'approved').length,
      executed: r.filter((x) => x.status === 'executed').length,
    };
  }, [reqs]);

  const submitRequest = async () => {
    if (!form.tenantId || !form.customerId.trim() || !form.reason.trim()) { setMsg('Tenant, customer ID, and reason are all required.'); return; }
    const res = await superAdminApi.requestDeletion({ tenantId: form.tenantId, customerId: form.customerId.trim(), reason: form.reason.trim() });
    if (!res.ok) { setMsg((res.errors || ['Request failed.']).join(' ')); return; }
    setMsg('Deletion requested. It now needs approval by a second, different reviewer before it can be executed.');
    setForm({ ...form, customerId: '', reason: '' }); load();
  };
  const { ask, askUi } = useInlineAsk();

  const finish = async (kind: string, p: Promise<any>) => {
    const res = await p;
    if (!res.ok) { setMsg((res.errors || ['Action failed.']).join(' ')); return; }
    setMsg(kind === 'approve' ? 'Deletion approved by second reviewer. It can now be executed with a typed confirmation.' : 'Deletion request rejected.');
    load();
  };
  const act = async (req: DeletionRequest, kind: 'approve' | 'reject') => {
    if (kind === 'reject') { ask('Reason for rejecting this deletion?', (reason) => { void finish(kind, superAdminApi.rejectDeletion(req.id, reason)); }); return; }
    await finish(kind, superAdminApi.approveDeletion(req.id));
  };

  const execute = async () => {
    if (!execFor) return;
    const res = await superAdminApi.executeDeletion(execFor.req.id, execFor.typed.trim());
    if (!res.ok) { setMsg((res.errors || ['Execution refused.']).join(' ')); return; }
    setExecFor(null); setMsg('Personal data permanently erased under approved process. This cannot be undone.'); load();
  };

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;

  return (
    <>
      {askUi}
      <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button className="self-start text-[#2C2118] px-1 py-2 border-b border-[var(--line)] text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]" onClick={() => nav('/customer-data-oversight')}>← Customer Data Oversight</button>
        <div className="vh" style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ color: 'var(--danger,#B85B4D)' }}>Deletion Requests</h1>
            <div className="sub">Permanent deletion under approved process — request, dual approval by a second reviewer, then a typed-confirmation execute gated by retention and legal holds.</div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {[['Requests', summary.total], ['Awaiting Approval', summary.awaitingApproval], ['Approved', summary.approved], ['Executed', summary.executed]].map(([label, val]) => (
            <div key={label as string} className="kpi" style={{ background: '#fff', border: '1px solid var(--line)' }}>
              <div className="l" style={{ fontSize: 11 }}>{label}</div><div className="v" style={{ fontSize: 20 }}>{(val as number).toLocaleString()}</div>
            </div>
          ))}
        </div>

        {msg ? <div className="state">{msg} <button className="linkbtn" onClick={() => setMsg(null)}>Dismiss</button></div> : null}

        <section className="panel" style={{ background: '#fff' }}>
          <div className="phead"><h2>Request a deletion</h2></div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Requires approval by a second, different reviewer and an exact typed customer-ID confirmation at execution; blocked while a legal hold covers the record.</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto] gap-2 items-end">
            <label style={{ fontSize: 12, fontWeight: 600 }}>Tenant<select className="inp" style={fld} value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}><option value="">Select…</option>{tenantOptions.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.label}</option>)}</select></label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Customer ID<input className="inp" style={fld} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} placeholder="CUS-…" /></label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Reason<input className="inp" style={fld} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. GDPR erasure request" /></label>
            <button className="btn" onClick={submitRequest}>Request deletion</button>
          </div>
        </section>

        <section className="panel ">
          <div className="phead">
            <h2>Deletion Requests <span className="muted">({reqs?.length ?? 0})</span></h2>
            <select className="inp" style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              <option value="">All Statuses</option>{['requested', 'approved', 'executed', 'rejected', 'cancelled'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}
            </select>
          </div>
          {reqs === null ? <div className="state">Loading deletion requests…</div> : reqs.length === 0 ? (
            <div className="state">No deletion requests{statusFilter ? ` with status “${cap(statusFilter)}”` : ''}.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tgrid" style={{ width: '100%', fontSize: 12.5, minWidth: 720 }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Customer</th><th>Reason</th><th>Status</th><th>Hold</th><th>Requested</th><th>Actions</th></tr></thead>
                <tbody>
                  {reqs.map((d) => (
                    <tr key={d.id}>
                      <td style={{ fontWeight: 600 }}>{d.customerId}</td>
                      <td className="muted">{d.reason}</td>
                      <td><span className={'pill ' + (TONE[d.status] || 'mut')}>{cap(d.status)}</span></td>
                      <td>{d.legalHoldBlocked ? <span className="pill bad">Held</span> : <span className="muted">—</span>}</td>
                      <td className="muted">{new Date(d.requestedAt).toLocaleDateString()}</td>
                      <td>
                        {d.status === 'requested' ? <><button className="linkbtn" onClick={() => act(d, 'approve')}>Approve</button> <button className="linkbtn" onClick={() => act(d, 'reject')}>Reject</button></> : null}
                        {d.status === 'approved' ? <><button className="linkbtn" style={{ color: 'var(--danger,#B85B4D)', fontWeight: 700 }} onClick={() => setExecFor({ req: d, typed: '' })}>Execute</button> <button className="linkbtn" onClick={() => act(d, 'reject')}>Reject</button></> : null}
                        {d.status === 'executed' || d.status === 'rejected' || d.status === 'cancelled' ? <span className="muted">—</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {execFor ? (
          <div role="dialog" aria-modal="true" aria-label="Confirm permanent deletion" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }} onClick={() => setExecFor(null)}>
            <div className="panel" style={{ width: 'min(520px, 94vw)', background: '#fff', borderTop: '4px solid var(--danger,#B85B4D)' }} onClick={(e) => e.stopPropagation()}>
              <div className="phead"><h2 style={{ color: 'var(--danger,#B85B4D)' }}>Confirm permanent erasure</h2></div>
              <div style={{ fontSize: 13, marginBottom: 10 }}>This will <b>irreversibly erase</b> the personal data of customer <b>{execFor.req.customerId}</b>. Transactional records keep referential integrity, but the person's identifying data cannot be recovered.</div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Type the customer ID <b>{execFor.req.customerId}</b> to confirm
                <input className="inp" style={fld} value={execFor.typed} onChange={(e) => setExecFor({ ...execFor, typed: e.target.value })} placeholder={execFor.req.customerId} />
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                <button className="btn ghost" onClick={() => setExecFor(null)}>Cancel</button>
                <button className="btn" style={{ background: 'var(--danger,#B85B4D)', borderColor: 'var(--danger,#B85B4D)', color: '#fff' }} disabled={execFor.typed.trim() !== execFor.req.customerId.trim()} onClick={execute}>Permanently erase</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
