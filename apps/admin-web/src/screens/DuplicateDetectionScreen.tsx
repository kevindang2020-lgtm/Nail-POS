// DuplicateDetectionScreen.tsx — Super Admin › Customer Data Oversight › Duplicate Detection.
// Dedicated full page reviewing within-tenant duplicate clusters. Detection runs single-tenant ONLY: records from
// different tenants are never candidates (a shared phone/email across tenants is a masked integrity alert, not a
// duplicate). Read-only review; executing a merge runs through the authorized support-session merge flow (reason +
// audit + recoverable merge log). Reuses the customer-duplicates endpoint. Cream/gold, Mac-fit, honest rendering.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const confTone = (c: string) => (c === 'exact' || c === 'high' ? 'bad' : c === 'medium' ? 'warn' : 'ok');

type DupCase = { id: string; kind?: string; keyMasked?: string; key?: string; confidence?: string; risk?: string; tenantId?: string; tenantName?: string; members?: { id: string; name?: string; phone?: string; email?: string; branch?: string; status?: string }[] };

export function DuplicateDetectionScreen() {
  const nav = useNavigate();
  const [cases, setCases] = useState<DupCase[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [tenantOptions, setTenantOptions] = useState<{ tenantId: string; label: string }[]>([]);

  const load = useCallback(() => {
    setErr(null); setCases(null);
    superAdminApi.customerDuplicates({ pageSize: 100, tenantId: tenantId || undefined })
      .then((r) => setCases((r.cases || []) as DupCase[])).catch((e: any) => setErr(e?.message || 'Failed to load duplicate clusters.'));
  }, [tenantId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { superAdminApi.customerDataOversight().then((o) => setTenantOptions(o.customersByTenant.map((t) => ({ tenantId: t.tenantId, label: t.label })))).catch(() => setTenantOptions([])); }, []);

  const summary = useMemo(() => {
    const c = cases || [];
    const level = (x: DupCase) => x.risk || x.confidence || '';
    return {
      total: c.length,
      high: c.filter((x) => { const l = level(x); return l === 'high' || l === 'exact'; }).length,
      medium: c.filter((x) => level(x) === 'medium').length,
      low: c.filter((x) => level(x) === 'low').length,
    };
  }, [cases]);

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button className="text-[#2C2118] px-1 py-2 border-b border-[var(--line)] text-xs font-extrabold cursor-pointer font-inherit transition-colors duration-200 hover:text-[#C28A34] self-start" onClick={() => nav('/customer-data-oversight')}>← Customer Data Oversight</button>
      <div className="vh flex flex-col lg:flex-row justify-between gap-3" style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1>Duplicate Detection</h1>
          <div className="sub">Within-tenant duplicate clusters. Detection runs per tenant only — a shared phone or email across tenants is a masked integrity alert, never a duplicate.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
        {[['Clusters', summary.total], ['High Risk', summary.high], ['Medium Risk', summary.medium], ['Low Risk', summary.low]].map(([label, val]) => (
          <div key={label as string} className="kpi" style={{ background: '#fff', border: '1px solid var(--line)' }}>
            <div className="l" style={{ fontSize: 11 }}>{label}</div><div className="v" style={{ fontSize: 20 }}>{(val as number).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <section className="panel" style={{ background: 'linear-gradient(90deg,#FBF3E6,#FFFDF8)', borderLeft: '4px solid var(--g7,#A96F22)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden="true">🛡</span>
        <div className="muted" style={{ fontSize: 12.5 }}>Executing a merge requires an active Customer Support session for the tenant (open one from Tenant Management). The merge then needs a reason and is fully audited and recoverable from the merge log.</div>
      </section>

      <section className="panel">
        <div className="phead">
          <h2>Duplicate Clusters <span className="muted">({cases?.length ?? 0})</span></h2>
          <select className="inp" style={{ height: 32, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8 }} value={tenantId} onChange={(e) => setTenantId(e.target.value)} aria-label="Filter by tenant">
            <option value="">All Tenants</option>{tenantOptions.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.label}</option>)}
          </select>
        </div>
        {cases === null ? <div className="state">Loading duplicate clusters…</div> : cases.length === 0 ? (
          <div className="state">No duplicate clusters detected{tenantId ? ' for this tenant' : ' in scope'}.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cases.map((c) => (
              <div key={c.id} className="panel" style={{ background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className={'pill ' + confTone(c.confidence || c.risk || '')}>{cap(c.kind || 'match')}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{c.tenantName || c.tenantId || '—'} · key {c.keyMasked || c.key || '—'}</span>
                  {c.confidence || c.risk ? <span className="muted" style={{ fontSize: 11 }}>· {cap(c.confidence || c.risk || '')} confidence</span> : null}
                </div>
                <table className="tgrid" style={{ width: '100%', fontSize: 12 }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Customer</th><th>Phone</th><th>Email</th><th>Branch</th><th>Status</th></tr></thead>
                  <tbody>
                    {(c.members || []).map((m) => (
                      <tr key={m.id}><td style={{ fontWeight: 600 }}>{m.name || m.id}</td><td className="muted">{m.phone || '—'}</td><td className="muted">{m.email || '—'}</td><td className="muted">{m.branch || '—'}</td><td><span className={'pill ' + (m.status === 'active' ? 'ok' : 'mut')}>{cap(m.status || '—')}</span></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
