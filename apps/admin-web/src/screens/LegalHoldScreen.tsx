// LegalHoldScreen.tsx — Super Admin › Customer Data Oversight › Legal Hold.
// Dedicated full page for placing and releasing legal holds. A hold preserves a record (or branch/tenant scope)
// against permanent deletion and destructive merge until released through an approved process. Reuses the
// legal-hold endpoints (list/apply/release); every apply/release is permission-checked and audited server-side.
// Tenant-scoped, honest rendering, cream/gold, Mac-fit.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { useNavigate } from 'react-router-dom';
import { superAdminApi, type LegalHold } from '../api/superAdminApi';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fld: React.CSSProperties = { display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 };

export function LegalHoldScreen() {
  const nav = useNavigate();
  const [holds, setHolds] = useState<LegalHold[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();
  const [statusFilter, setStatusFilter] = useState('active');
  const [tenantOptions, setTenantOptions] = useState<{ tenantId: string; label: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ tenantId: '', scope: 'customer' as 'customer' | 'branch' | 'tenant', customerId: '', matterRef: '', reason: '', confirm: false });
  const [formErrs, setFormErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr(null); setHolds(null);
    superAdminApi.legalHolds({ status: statusFilter || undefined }).then(setHolds).catch((e: any) => setErr(e?.message || 'Failed to load legal holds.'));
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { superAdminApi.customerDataOversight().then((o) => setTenantOptions(o.customersByTenant.map((t) => ({ tenantId: t.tenantId, label: t.label })))).catch(() => setTenantOptions([])); }, []);

  const summary = useMemo(() => {
    const h = holds || [];
    return { count: h.length, tenants: new Set(h.map((x) => x.tenantId)).size, customerScoped: h.filter((x) => x.scope === 'customer').length };
  }, [holds]);

  const submit = async () => {
    const errs: string[] = [];
    if (!form.tenantId) errs.push('Select a tenant.');
    if (!form.matterRef.trim()) errs.push('Matter / case reference is required.');
    if (!form.reason.trim()) errs.push('A reason is required.');
    if (form.scope === 'customer' && !form.customerId.trim()) errs.push('A customer is required for a customer-scoped hold.');
    if (!form.confirm) errs.push('You must confirm this hold is authorized.');
    if (errs.length) { setFormErrs(errs); return; }
    setBusy(true); setFormErrs([]);
    try {
      const res = await superAdminApi.applyLegalHold({ tenantId: form.tenantId, customerId: form.scope === 'customer' ? form.customerId.trim() : null, matterRef: form.matterRef.trim(), reason: form.reason.trim(), scope: form.scope });
      if (!res.ok) { setFormErrs(res.errors || ['Could not place the hold.']); setBusy(false); return; }
      setShowForm(false); setForm({ tenantId: '', scope: 'customer', customerId: '', matterRef: '', reason: '', confirm: false });
      setMsg('Legal hold placed and audited. The record is protected from permanent deletion and destructive merge until released.');
      if (statusFilter && statusFilter !== 'active') setStatusFilter('active'); else load();
    } catch (e: any) { setFormErrs([e?.message || 'Request failed.']); }
    setBusy(false);
  };

  const release = async (h: LegalHold) => {
    ask(`Release the legal hold on ${h.customerId || h.tenantId} (matter ${h.matterRef})?\nEnter a release reason:`, (reason) => { void doRelease(h, reason); });
  };
  const doRelease = async (h: LegalHold, reason: string) => {
    const res = await superAdminApi.releaseLegalHold(h.id, reason);
    if (!res.ok) { setMsg((res.errors || ['Could not release the hold.']).join(' ')); return; }
    setMsg('Legal hold released and audited.'); load();
  };

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button className="self-start text-[#2C2118] px-1 py-2 border-b border-[var(--line)] text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34]" onClick={() => nav('/customer-data-oversight')}>← Customer Data Oversight</button>
      <div className="vh flex flex-col lg:flex-row justify-between gap-3" style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1>Legal Hold</h1>
          <div className="sub">Preserve customer records against permanent deletion and destructive merge until released through an approved process.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => { setFormErrs([]); setShowForm((v) => !v); }}>{showForm ? 'Cancel' : '+ Place hold'}</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
        {[['Holds Shown', summary.count], ['Tenants Covered', summary.tenants], ['Customer-Scoped', summary.customerScoped]].map(([label, val]) => (
          <div key={label as string} className="kpi" style={{ background: '#fff', border: '1px solid var(--line)' }}>
            <div className="l" style={{ fontSize: 11 }}>{label}</div><div className="v" style={{ fontSize: 20 }}>{(val as number).toLocaleString()}</div>
          </div>
        ))}
      </div>

      {msg ? <div className="state">{msg} <button className="linkbtn" onClick={() => setMsg(null)}>Dismiss</button></div> : null}

      {showForm ? (
        <section className="panel" style={{ background: '#fff' }}>
          <div className="phead"><h2>🔒 Place records under legal hold</h2></div>
          {formErrs.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{formErrs.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Tenant *
              <select className="inp" style={fld} value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}><option value="">Select tenant…</option>{tenantOptions.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.label}</option>)}</select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Scope *
              <select className="inp" style={fld} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as any })}><option value="customer">Single customer</option><option value="branch">Entire branch</option><option value="tenant">Entire tenant</option></select>
            </label>
            {form.scope === 'customer' ? (
              <label style={{ fontSize: 12, fontWeight: 600 }}>Customer ID *<input className="inp" style={fld} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} placeholder="CUS-…" /></label>
            ) : <div />}
            <label style={{ fontSize: 12, fontWeight: 600 }}>Matter / case reference *<input className="inp" style={fld} value={form.matterRef} onChange={(e) => setForm({ ...form, matterRef: e.target.value })} placeholder="e.g. LIT-2026-0042" /></label>
          </div>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginTop: 10 }}>Reason *<textarea className="inp" style={{ ...fld, height: 60, paddingTop: 8 }} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Why this hold is being placed" /></label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, margin: '10px 0' }}>
            <input type="checkbox" checked={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.checked })} />
            <span>I confirm this legal hold is authorized and the matter reference is accurate. This action is audited.</span>
          </label>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Placing…' : 'Place legal hold'}</button>
        </section>
      ) : null}

      <section className="panel">
        <div className="phead">
          <h2>Legal Holds <span className="muted">({holds?.length ?? 0})</span></h2>
          <select className="inp" style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="active">Active</option><option value="released">Released</option><option value="">All</option>
          </select>
        </div>
        {holds === null ? <div className="state">Loading legal holds…</div> : holds.length === 0 ? (
          <div className="state">No {statusFilter || ''} legal holds. Records are deletable through the normal approved process.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5, minWidth: 760 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Subject</th><th>Scope</th><th>Matter</th><th>Reason</th><th>Status</th><th>Applied</th><th>Actions</th></tr></thead>
              <tbody>
                {holds.map((h) => (
                  <tr key={h.id}>
                    <td style={{ fontWeight: 600 }}>{h.scope === 'customer' ? h.customerId : `${cap(h.scope)} scope`}</td>
                    <td className="muted">{cap(h.scope)}</td>
                    <td>{h.matterRef}</td>
                    <td className="muted">{h.reason}</td>
                    <td><span className={'pill ' + (h.status === 'active' ? 'warn' : 'mut')}>{cap(h.status)}</span></td>
                    <td className="muted">{new Date(h.appliedAt).toLocaleDateString()}</td>
                    <td>{h.status === 'active' ? <button className="linkbtn" onClick={() => release(h)}>Release</button> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {askUi}
    </div>
  );
}
