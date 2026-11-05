import { useEffect, useState } from 'react';
import { useInlineConfirm } from '../components/InlineConfirm';
import { ownerCompensationApi, type CompRulePolicy, type CompRuleScope, type CompRuleVersion } from '../api/ownerApi';

type ScopeType = 'tenant' | 'branch' | 'technician' | 'service' | 'service_category';

// Human label for a rule's scope, mirroring the resolver's precedence (§4).
function scopeLabel(s: CompRuleScope): string {
  if (s.ticketId) return 'Ticket override';
  if (s.technicianId && s.serviceId) return 'Technician + Service';
  if (s.technicianId && s.serviceCategory) return 'Technician + Category';
  if (s.technicianId) return 'Technician';
  if (s.branchId && s.serviceId) return 'Branch + Service';
  if (s.branchId) return 'Branch';
  if (s.serviceId) return 'Service';
  if (s.serviceCategory) return 'Category';
  return 'Salon default';
}
const rate = (v: CompRuleVersion) => (v.commissionType === 'percent' ? `${v.commissionValue}%` : `$${(v.commissionValue / 100).toFixed(2)}`);
const badgeColor = (status: string) => (status === 'active' ? 'var(--owner-success)' : status === 'scheduled' ? 'var(--owner-accent, #A96F22)' : status === 'replaced' || status === 'canceled' || status === 'expired' ? 'var(--owner-muted, #888)' : 'var(--owner-text, #333)');

/**
 * Commission Rules — author scoped, versioned commission rules (spec §5/§7/§25). Rules override the per-service default;
 * absent a rule, the salon's service default still applies. A rate change is a new version at a future effective date;
 * activating it supersedes the prior one and never rewrites history. Rendered inside the (reachable) Commission & Payroll
 * screen.
 */
export function CommissionRulesPanel() {
  const [policies, setPolicies] = useState<CompRulePolicy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scopeType, setScopeType] = useState<ScopeType>('tenant');
  const [scopeValue, setScopeValue] = useState('');
  const [label, setLabel] = useState('');
  const [commType, setCommType] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('60');
  const [supplyMethod, setSupplyMethod] = useState<'none' | 'fixed' | 'percent'>('none');
  const [supplyValue, setSupplyValue] = useState('0');
  const [effStart, setEffStart] = useState(() => new Date().toISOString().slice(0, 10));

  const load = () => { setError(null); ownerCompensationApi.listRules().then(setPolicies).catch((e) => { setPolicies([]); setError(e?.message || 'Failed to load rules'); }); };
  useEffect(() => { load(); }, []);

  const run = async (p: Promise<unknown>) => { setBusy(true); setError(null); try { await p; load(); } catch (e: any) { setError(e?.message || 'Action failed'); } finally { setBusy(false); } };

  // Builds a version payload from the form fields (shared by "create rule" and "add version to an existing rule").
  const versionPayload = () => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) { setError('Enter a valid rate'); return null; }
    const commissionValue = commType === 'percent' ? num : Math.round(num * 100); // fixed entered in dollars → cents
    const supplyValueNum = supplyMethod === 'none' ? 0 : supplyMethod === 'fixed' ? Math.round(Number(supplyValue || 0) * 100) : Math.round(Number(supplyValue || 0));
    return { commissionType: commType, commissionValue, effectiveStart: new Date(effStart).toISOString(), supplyMethod, supplyValue: supplyValueNum };
  };

  const create = async () => {
    const version = versionPayload();
    if (!version) return;
    const scope: Partial<CompRuleScope> = {};
    const idv = scopeValue.trim();
    if (scopeType === 'branch') scope.branchId = idv || null;
    else if (scopeType === 'technician') scope.technicianId = idv || null;
    else if (scopeType === 'service') scope.serviceId = idv || null;
    else if (scopeType === 'service_category') scope.serviceCategory = idv || null;
    await run(ownerCompensationApi.createRule({ scope, label: label.trim() || null, version }).then(() => { setLabel(''); setScopeValue(''); }));
  };

  // Adds a new version to an existing rule, using the version fields in the form above (revise the rule's terms).
  const addVersion = async (policyId: string) => { const version = versionPayload(); if (!version) return; await run(ownerCompensationApi.addRuleVersion(policyId, version)); };

  const needsId = scopeType !== 'tenant';
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const hasSalonDefaultActive = (policies || []).some((p) => !p.scope.branchId && !p.scope.technicianId && !p.scope.serviceId && !p.scope.serviceCategory && !p.scope.ticketId && p.versions.some((v) => v.status === 'active'));
  const seed = () => askConfirm('Set up the standard 60% technician / 40% salon split as your salon default? You can change it at any time.',
    () => { void run(ownerCompensationApi.seedDefault(60)); }, { confirmLabel: 'Set 60/40 default', destructive: false });

  return (
    <div className="owner-chartcard">
      {confirmUi}
      <div className="head"><div className="t">Commission Rules</div>{busy ? <div className="u">Working…</div> : null}</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Override the per-service default for a branch, technician, service, or category. A rate change is a new version with an effective date — activating it supersedes the prior one and never changes past tickets.</div>

      {error ? <div role="alert" style={{ fontSize: 13, color: 'var(--owner-danger)', marginBottom: 8 }}>{error}</div> : null}

      {policies !== null && !hasSalonDefaultActive ? (
        <div style={{ marginBottom: 12, padding: 12, border: '1px dashed var(--owner-border, #ddd)', borderRadius: 10, background: 'var(--owner-surface)' }}>
          <div style={{ fontSize: 13, marginBottom: 8, lineHeight: 1.45, color: 'var(--owner-text-secondary)' }}>No salon default is set. Start with the common 60/40 template — the technician earns the larger share and the salon keeps the rest — then adjust per branch, technician, or service.</div>
          <button className="owner-btn" disabled={busy} onClick={seed} style={{ minHeight: 44, height: 44, fontSize: 14, borderRadius: 10, padding: '0 18px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Set up the standard 60/40 split</button>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)', gridColumn: needsId ? 'span 1' : 'span 1' }}>
          <span>Applies to</span>
          <select aria-label="Scope" value={scopeType} onChange={(e) => setScopeType(e.target.value as ScopeType)} className="owner-input">
            <option value="tenant">Salon default</option><option value="branch">Branch</option><option value="technician">Technician</option><option value="service">Service</option><option value="service_category">Category</option>
          </select>
        </label>
        {needsId ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
            <span>ID / name</span>
            <input aria-label="Scope value" value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} className="owner-input" placeholder={scopeType === 'service_category' ? 'e.g. Nails' : 'id'} />
          </label>
        ) : null}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)', gridColumn: needsId ? 'span 2' : 'span 1' }}>
          <span>Label</span>
          <input aria-label="Label" value={label} onChange={(e) => setLabel(e.target.value)} className="owner-input" placeholder="optional" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>Type</span>
          <select aria-label="Commission type" value={commType} onChange={(e) => setCommType(e.target.value as any)} className="owner-input">
            <option value="percent">Percent</option>
            <option value="fixed">Fixed $</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
          <span>{commType === 'percent' ? 'Technician %' : 'Amount ($)'}</span>
          <input aria-label="Rate" value={value} onChange={(e) => setValue(e.target.value)} className="owner-input" inputMode="decimal" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)', gridColumn: 'span 2' }}>
          <span>Effective</span>
          <input aria-label="Effective date" type="date" value={effStart} onChange={(e) => setEffStart(e.target.value)} className="owner-input" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)', gridColumn: supplyMethod !== 'none' ? 'span 1' : 'span 2' }}>
          <span>Product cost</span>
          <select aria-label="Supply method" value={supplyMethod} onChange={(e) => setSupplyMethod(e.target.value as any)} className="owner-input">
            <option value="none">Tracked separately</option>
            <option value="fixed">Fixed $ before split</option>
            <option value="percent">Percent of price</option>
          </select>
        </label>
        {supplyMethod !== 'none' ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--owner-text-secondary)' }}>
            <span>{supplyMethod === 'fixed' ? 'Supply ($)' : 'Supply %'}</span>
            <input aria-label="Supply value" value={supplyValue} onChange={(e) => setSupplyValue(e.target.value)} className="owner-input" inputMode="decimal" />
          </label>
        ) : null}
        <button
          className="owner-btn"
          disabled={busy}
          onClick={create}
          style={{
            gridColumn: '1 / -1',
            minHeight: 46,
            height: 46,
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 10,
            marginTop: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          Add rule
        </button>
      </div>

      {supplyMethod !== 'none' ? <div role="note" style={{ fontSize: 12, color: 'var(--owner-danger)', marginBottom: 10 }}>⚠ A fixed or percent supply charge is subtracted from the service price before the technician's share is calculated, so it reduces technician commission. Confirm this matches your compensation agreements and local wage rules — "Tracked separately" keeps product cost out of the commission base.</div> : null}

      {policies === null ? <div className="muted" style={{ fontSize: 13 }}>Loading…</div>
        : policies.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>No commission rules yet — the per-service default applies to every ticket.</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {policies.map((p) => (
              <div key={p.id} style={{ border: '1px solid var(--owner-border, #eee)', borderRadius: 10, padding: 12, background: 'var(--owner-surface)' }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{scopeLabel(p.scope)}{p.label ? <span className="muted" style={{ fontWeight: 400 }}> — {p.label}</span> : null}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {p.versions.map((v) => (
                    <div key={v.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--owner-border, #f0f0f0)' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>{rate(v)}</span>
                        <span style={{ color: badgeColor(v.status) }}>· {v.status}</span>
                        <span className="muted">· v{v.version} · from {new Date(v.effectiveStart).toLocaleDateString()}</span>
                        {v.supplyMethod && v.supplyMethod !== 'none' ? <span className="muted">· supply {v.supplyMethod === 'fixed' ? `$${(v.supplyValue / 100).toFixed(2)}` : `${v.supplyValue}%`}</span> : null}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(v.status === 'draft' || v.status === 'pending_approval') ? <button className="owner-btn ghost" disabled={busy} onClick={() => run(ownerCompensationApi.approveVersion(v.id))} style={{ minHeight: 32, height: 32, padding: '0 12px', fontSize: 12, borderRadius: 8 }}>Approve</button> : null}
                        {(v.status === 'draft' || v.status === 'pending_approval' || v.status === 'scheduled') ? <button className="owner-btn ghost" disabled={busy} onClick={() => run(ownerCompensationApi.activateVersion(v.id))} style={{ minHeight: 32, height: 32, padding: '0 12px', fontSize: 12, borderRadius: 8 }}>Activate</button> : null}
                        {(v.status === 'draft' || v.status === 'pending_approval' || v.status === 'scheduled') ? <button className="owner-btn ghost" disabled={busy} onClick={() => run(ownerCompensationApi.cancelVersion(v.id))} style={{ minHeight: 32, height: 32, padding: '0 12px', fontSize: 12, borderRadius: 8 }}>Cancel</button> : null}
                      </div>
                    </div>
                  ))}
                </div>
                <button className="owner-btn ghost" disabled={busy} onClick={() => addVersion(p.id)} style={{ marginTop: 10, minHeight: 34, height: 34, padding: '0 14px', fontSize: 12.5, borderRadius: 8, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Add version (uses the rate/supply fields above)</button>
              </div>
            ))}
          </div>}
    </div>
  );
}
