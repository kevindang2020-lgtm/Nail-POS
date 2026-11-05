import { useEffect, useState, type CSSProperties } from 'react';
import { superAdminApi, type CatalogDeployPreview, type CatalogComparison, type CatalogTemplateRow } from '../api/superAdminApi';
import { money } from './_chartkit';

// DeployModals.tsx — deploy a published master template to selected tenants (with the no-overwrite safeguard surfaced
// in the UI) and compare/allow-customize tenant copies. All writes go through permission-gated + audited endpoints.

function Overlay({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,24,16,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: '40px 16px', overflow: 'auto' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--line)', width: wide ? 680 : 540, maxWidth: '100%', padding: 18, boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          <button className="btn ghost" style={{ height: 28 }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const reasonLabel: Record<string, string> = { ok: '', already_deployed: 'already deployed', name_conflict: 'tenant has a custom service with this name', no_branch: 'no branch', no_category: 'no service category' };

export function DeployModal({ template, onClose, onDone }: { template: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<CatalogDeployPreview | null>(null);
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [customizable, setCustomizable] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ deploy: number; overwrite: number; skipped: number } | null>(null);

  const loadPreview = (ao: boolean) => {
    setLoading(true);
    superAdminApi.catalogDeployPreview(template.id, ao).then((d) => {
      const p = d as CatalogDeployPreview; setPreview(p);
      // default-select tenants that would deploy or overwrite
      setSelected(Object.fromEntries(p.plan.filter((x) => x.action !== 'skip').map((x) => [x.tenantId, true])));
    }).catch((e: any) => setErr(e?.message || 'Failed to load')).finally(() => setLoading(false));
  };
  useEffect(() => { loadPreview(false); }, []);
  const toggleOverwrite = (v: boolean) => { setAllowOverwrite(v); loadPreview(v); };

  const deploy = async () => {
    setErr(null); setResult(null);
    const tenantIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (tenantIds.length === 0) { setErr('Select at least one tenant.'); return; }
    setBusy(true);
    try {
      const r = await superAdminApi.catalogDeploy(template.id, { tenantIds, allowOverwrite, customizable });
      setResult(r.summary); onDone();
    } catch (e: any) { setErr(e?.message || 'Deploy failed'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title={`Deploy — ${template.name}`} onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={allowOverwrite} onChange={(e) => toggleOverwrite(e.target.checked)} />Allow overwriting tenant custom services</label>
        <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={customizable} onChange={(e) => setCustomizable(e.target.checked)} />Tenants may customize copies</label>
      </div>
      {!allowOverwrite && <div style={{ fontSize: 11.5, color: 'var(--gold,#A96F22)', marginBottom: 8 }}>⚠ Tenants with a custom service of the same name are protected and will be skipped.</div>}
      {loading ? <div className="state">Loading tenants…</div> : preview && (
        <div style={{ display: 'grid', gap: 4, maxHeight: 320, overflow: 'auto' }}>
          {preview.plan.map((p) => {
            const skip = p.action === 'skip';
            return (
              <label key={p.tenantId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 9, border: '1px solid var(--line)', background: skip ? '#F7F3EC' : '#fff', fontSize: 12.5, opacity: skip ? 0.75 : 1 }}>
                <input type="checkbox" disabled={skip} checked={!!selected[p.tenantId]} onChange={(e) => setSelected((s) => ({ ...s, [p.tenantId]: e.target.checked }))} />
                <span style={{ flex: 1, fontWeight: 600 }}>{p.tenantName}</span>
                <span style={{ fontSize: 11, color: p.action === 'overwrite' ? '#9B2C2C' : p.action === 'deploy' ? '#2F6B43' : 'var(--muted)' }}>
                  {p.action === 'deploy' ? 'will deploy' : p.action === 'overwrite' ? 'will OVERWRITE' : `skip — ${reasonLabel[p.reason] || p.reason}`}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {result && <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 9, background: '#E7F2EA', color: '#2F6B43', border: '1px solid #BFE0CB', fontSize: 12.5 }}>Deployed {result.deploy}, overwrote {result.overwrite}, skipped {result.skipped}.</div>}
      {err && <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 9, background: '#FBEAEA', color: '#9B2C2C', border: '1px solid #F0C9C9', fontSize: 12.5 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="btn ghost" onClick={onClose} disabled={busy}>{result ? 'Close' : 'Cancel'}</button>
        {!result && <button className="btn" onClick={deploy} disabled={busy}>{busy ? 'Deploying…' : 'Deploy to Selected'}</button>}
      </div>
    </Overlay>
  );
}

export function CompareModal({ template, onClose, onChanged }: { template: { id: string; name: string }; onClose: () => void; onChanged: () => void }) {
  const [cmp, setCmp] = useState<CatalogComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const load = () => superAdminApi.catalogComparison(template.id).then((d) => setCmp(d as CatalogComparison)).catch((e: any) => setErr(e?.message || 'Failed to load')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const toggle = async (deploymentId: string, customizable: boolean) => {
    try { await superAdminApi.catalogSetCustomizable(deploymentId, customizable); load(); onChanged(); }
    catch (e: any) { setErr(e?.message || 'Update failed'); }
  };

  const td: CSSProperties = { padding: '6px 8px', fontSize: 12 };
  return (
    <Overlay title={`Compare Tenant Configurations — ${template.name}`} onClose={onClose} wide>
      {loading ? <div className="state">Loading…</div> : !cmp || cmp.rows.length === 0 ? <div className="state">This template hasn’t been deployed to any tenant yet.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}>
              <th style={td}>Tenant</th><th style={td}>Copied Service</th><th style={td}>Template Min</th><th style={td}>Tenant Price</th><th style={td}>Duration (tpl/tenant)</th><th style={td}>Customized</th><th style={td}>Customizable</th>
            </tr></thead>
            <tbody>
              {cmp.rows.map((r) => (
                <tr key={r.deploymentId} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.tenantName}</td>
                  <td style={td}>{r.serviceName ?? <span className="muted">— (removed)</span>}</td>
                  <td style={td}>{money(r.templatePriceMinCents)}</td>
                  <td style={td}>{r.servicePriceCents == null ? '—' : money(r.servicePriceCents)}</td>
                  <td style={td}>{r.templateDuration} / {r.serviceDuration ?? '—'} min</td>
                  <td style={td}>{r.customized ? <span style={{ color: '#9B2C2C', fontWeight: 700 }}>Yes</span> : <span className="muted">No</span>}</td>
                  <td style={td}><label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11.5 }}><input type="checkbox" checked={r.customizable} onChange={(e) => toggle(r.deploymentId, e.target.checked)} />allow</label></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 9, background: '#FBEAEA', color: '#9B2C2C', border: '1px solid #F0C9C9', fontSize: 12.5 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" onClick={onClose}>Done</button></div>
    </Overlay>
  );
}

// Picker limited to published templates (only those are deployable / comparable in a meaningful way).
export function PublishedTemplatePickerModal({ title, hint, onPick, onClose }: { title: string; hint: string; onPick: (t: { id: string; name: string }) => void; onClose: () => void }) {
  const [rows, setRows] = useState<CatalogTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  useEffect(() => { superAdminApi.catalogTemplates({ pageSize: 100, status: 'published' }).then((d: any) => setRows(d.rows)).catch(() => {}).finally(() => setLoading(false)); }, []);
  const filtered = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Overlay title={title} onClose={onClose}>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>{hint}</div>
      <input style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid var(--line)', padding: '0 10px', fontSize: 12.5, marginBottom: 10, boxSizing: 'border-box' }} placeholder="Search published templates…" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading ? <div className="state">Loading…</div> : filtered.length === 0 ? <div className="state">No published templates.</div> : (
        <div style={{ display: 'grid', gap: 4, maxHeight: 340, overflow: 'auto' }}>
          {filtered.map((r) => (
            <button key={r.id} className="btn ghost" style={{ height: 34, justifyContent: 'space-between', fontSize: 12.5 }} onClick={() => onPick({ id: r.id, name: r.name })}>
              <span>{r.name}</span><span className="muted">{r.activeTenantUsage} tenant{r.activeTenantUsage === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button className="btn ghost" onClick={onClose}>Cancel</button></div>
    </Overlay>
  );
}
