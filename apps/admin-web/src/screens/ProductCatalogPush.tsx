// PushToTenantsModal — optional distribution of a MASTER product to tenants. Creates/links tenant-owned products
// (idempotent, skip-existing), never branch stock, never overwrites tenant customizations. Master products come from
// the catalog's master list; tenants from the current cross-tenant view. Shows per-tenant results.
import { useEffect, useState } from 'react';
import { superAdminApi, type PcMasterProduct } from '../api/superAdminApi';

type Result = { tenantId: string; action: string; tenantProductId?: string | null };

export function PushToTenantsModal({ tenantOptions, onClose, onDone }: { tenantOptions: { id: string; name: string }[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [masters, setMasters] = useState<PcMasterProduct[] | null>(null);
  const [masterId, setMasterId] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [skipExisting, setSkipExisting] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [results, setResults] = useState<{ summary: any; rows: Result[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { superAdminApi.listMasterProducts().then((m) => { setMasters(m); if (m[0]) setMasterId(m[0].id); }).catch(() => setMasters([])); }, []);

  const toggle = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const chosen = tenantOptions.filter((t) => selected[t.id]).map((t) => t.id);

  const submit = async () => {
    const errs: string[] = [];
    if (!masterId) errs.push('Select a master product.');
    if (!chosen.length) errs.push('Select at least one tenant.');
    if (errs.length) { setErrors(errs); return; }
    setBusy(true); setErrors([]);
    try {
      const res = await superAdminApi.distributeProduct({ masterProductId: masterId, tenantIds: chosen, reason: reason.trim() || undefined, skipExisting });
      if (!res.ok) { setErrors(res.errors || ['Distribution failed.']); setBusy(false); return; }
      setResults({ summary: res.summary, rows: res.results || [] }); setBusy(false);
    } catch (e: any) { setErrors([e?.message || 'Request failed.']); setBusy(false); }
  };

  const actionLabel = (a: string) => a === 'create' ? 'Created' : a === 'skip_existing' ? 'Skipped (already carries)' : 'Already distributed';
  const done = () => { const s = results?.summary; onDone(s ? `Distribution complete — ${s.created} created, ${s.skippedExisting} skipped, ${s.alreadyDistributed} already distributed.` : 'Distribution complete.'); };

  return (
    <div role="dialog" aria-modal="true" aria-label="Push products to tenants" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '4vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(560px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Push Optional Products to Tenants</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Creates or links a tenant-owned product from the master. It is idempotent, skips tenants that already carry it, never overwrites tenant customizations, and never creates branch inventory.</div>

        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}

        {results ? (
          <div className="state" style={{ borderLeft: '4px solid var(--g7,#A96F22)' }}>
            <b>Result:</b> {results.summary.created} created · {results.summary.skippedExisting} skipped · {results.summary.alreadyDistributed} already distributed
            <table className="tgrid" style={{ width: '100%', fontSize: 12, marginTop: 8 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Tenant</th><th>Outcome</th></tr></thead>
              <tbody>{results.rows.map((r) => <tr key={r.tenantId}><td>{tenantOptions.find((t) => t.id === r.tenantId)?.name || r.tenantId}</td><td>{actionLabel(r.action)}</td></tr>)}</tbody></table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button className="btn" onClick={done}>Done</button></div>
          </div>
        ) : (
          <>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Master product
              {masters === null ? <div className="muted" style={{ marginTop: 4 }}>Loading…</div>
                : masters.length === 0 ? <div className="state" style={{ marginTop: 4 }}>No master products yet — create one with <b>Add Product</b> first.</div>
                : <select className="inp" style={{ display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 }} value={masterId} onChange={(e) => setMasterId(e.target.value)}>{masters.map((m) => <option key={m.id} value={m.id}>{m.name}{m.sku ? ` (${m.sku})` : ''} — {m.status}</option>)}</select>}
            </label>

            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 10 }}>Tenants</div>
            <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: 8, marginTop: 4 }}>
              {tenantOptions.length === 0 ? <div className="muted">No tenants available.</div> : tenantOptions.map((t) => (
                <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '2px 0' }}>
                  <input type="checkbox" checked={!!selected[t.id]} onChange={() => toggle(t.id)} /> {t.name}
                </label>
              ))}
            </div>

            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginTop: 10 }}>Reason<input className="inp" style={{ display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. seasonal launch" /></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginTop: 10 }}><input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} /> Skip tenants that already carry this product</label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn" disabled={busy || !masters?.length} onClick={submit}>{busy ? 'Distributing…' : 'Distribute'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
