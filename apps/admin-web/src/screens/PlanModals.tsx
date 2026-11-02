// PlanModals.tsx — Add Plan + Change Pricing dialogs for the All Plans page. Both call the audited backend endpoints;
// the backend enforces permission/validation/versioning, and these surface its errors honestly (no optimistic success).
// Money is entered in dollars and converted to integer cents at the boundary.
import { useState, useEffect, type CSSProperties } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { superAdminPlansApi, type PlanDirectoryRow, type CreatePlanBody, type TenantSubscription, type Strategy, type ChangePreview, type TenantEntitlements, type OverageRuleDetail, type GrandfatherRow, type PlanVersion, type PlanUtilization } from '../api/superAdminPlansApi';

const toCents = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
};
const fromCents = (c: number) => (c / 100).toFixed(2);

const LIMIT_FIELDS: { key: string; label: string }[] = [
  { key: 'branches', label: 'Branches' }, { key: 'users', label: 'Users' }, { key: 'technicians', label: 'Technicians' },
  { key: 'customers', label: 'Customers' }, { key: 'appointments_monthly', label: 'Appointments / mo' },
  { key: 'sms_monthly', label: 'SMS / mo' }, { key: 'email_monthly', label: 'Email / mo' },
  { key: 'ai_minutes_monthly', label: 'AI Minutes / mo' }, { key: 'ai_receptionist_calls_monthly', label: 'AI Recept. Calls / mo' },
  { key: 'storage_gb', label: 'Storage (GB)' }, { key: 'devices', label: 'Devices' }, { key: 'integrations', label: 'Integrations' },
  { key: 'report_retention_days', label: 'Report Retention (days)' },
];
const PLAN_TYPES = ['standard', 'trial', 'promotional', 'enterprise', 'unlimited', 'custom', 'grandfathered', 'legacy', 'internal'];
const PLAN_STATUSES = ['draft', 'scheduled', 'active', 'inactive', 'archived', 'grandfathered', 'deprecated'];

export function Overlay({ title, onClose, children, width = 640 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(44,33,24,0.38)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, width, maxWidth: '100%', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 18px 50px rgba(44,33,24,0.22)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--card)' }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={iconBtn()}>✕</button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

export function AddPlanModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: '', code: '', subtitle: '', planType: 'standard', status: 'draft', monthly: '', annual: '', isRecommended: false, isPublic: true });
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const monthlyPriceCents = toCents(f.monthly);
    if (!f.name.trim()) return setErr('Name is required.');
    if (!f.code.trim()) return setErr('Code is required.');
    if (monthlyPriceCents === null) return setErr('Monthly price must be a non-negative number.');
    const limitsBody: Record<string, number | null> = {};
    for (const { key } of LIMIT_FIELDS) {
      const raw = (limits[key] ?? '').trim();
      if (raw === '') continue;                       // omitted entirely
      if (raw.toLowerCase() === 'unlimited') { limitsBody[key] = null; continue; }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) return setErr(`${key} must be a whole number or "unlimited".`);
      limitsBody[key] = n;
    }
    const body: CreatePlanBody = {
      code: f.code.trim(), name: f.name.trim(), subtitle: f.subtitle.trim() || null,
      planType: f.planType, status: f.status,
      monthlyPriceCents, annualPriceCents: toCents(f.annual) ?? undefined,
      isRecommended: f.isRecommended, isPublic: f.isPublic,
      limits: Object.keys(limitsBody).length ? limitsBody : undefined,
    };
    setBusy(true);
    try { await superAdminPlansApi.create(body); onCreated(); }
    catch (e: any) { setErr(e?.message || 'Failed to create plan'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title="Create Subscription Plan" onClose={onClose}>
      <div style={grid2()}>
        <Field label="Plan name *"><input style={inp()} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Plan code *"><input style={inp()} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="e.g. growth" /></Field>
        <Field label="Subtitle / badge"><input style={inp()} value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} /></Field>
        <Field label="Plan type"><select style={inp()} value={f.planType} onChange={(e) => setF({ ...f, planType: e.target.value })}>{PLAN_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Status"><select style={inp()} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{PLAN_STATUSES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Monthly price ($) *"><input style={inp()} value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} inputMode="decimal" placeholder="0" /></Field>
        <Field label="Annual price ($)"><input style={inp()} value={f.annual} onChange={(e) => setF({ ...f, annual: e.target.value })} inputMode="decimal" placeholder="optional" /></Field>
      </div>
      <div style={{ display: 'flex', gap: 16, margin: '10px 2px' }}>
        <label style={chk()}><input type="checkbox" checked={f.isRecommended} onChange={(e) => setF({ ...f, isRecommended: e.target.checked })} /> Most Popular</label>
        <label style={chk()}><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> Public (offered to new tenants)</label>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--soft)', margin: '8px 2px 6px' }}>Limits <span className="muted" style={{ fontWeight: 400 }}>— blank = omit, "unlimited" = no cap</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
        {LIMIT_FIELDS.map((l) => (
          <Field key={l.key} label={l.label}>
            <input style={inp()} value={limits[l.key] ?? ''} onChange={(e) => setLimits({ ...limits, [l.key]: e.target.value })} placeholder="—" />
          </Field>
        ))}
      </div>
      {err && <div style={errBox()}>{err}</div>}
      <div style={actions()}>
        <button style={btn()} onClick={onClose} disabled={busy}>Cancel</button>
        <button style={btn(false, true)} onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create Plan'}</button>
      </div>
    </Overlay>
  );
}

export function ChangePricingModal({ plans, initialPlanId, onClose, onChanged }: { plans: PlanDirectoryRow[]; initialPlanId?: string; onClose: () => void; onChanged: () => void }) {
  const [planId, setPlanId] = useState(initialPlanId ?? plans[0]?.id ?? '');
  const plan = plans.find((p) => p.id === planId);
  const [monthly, setMonthly] = useState(plan ? fromCents(plan.monthlyPriceCents) : '');
  const [reason, setReason] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickPlan = (id: string) => { setPlanId(id); const p = plans.find((x) => x.id === id); setMonthly(p ? fromCents(p.monthlyPriceCents) : ''); };

  const submit = async () => {
    setErr(null);
    const monthlyPriceCents = toCents(monthly);
    if (!plan) return setErr('Select a plan.');
    if (monthlyPriceCents === null) return setErr('New monthly price must be a non-negative number.');
    if (!reason.trim()) return setErr('A reason is required for a pricing change.');
    if (!confirm) return setErr('Please confirm — pricing changes are audited and affect new billing.');
    setBusy(true);
    try {
      await superAdminPlansApi.changePricing(plan.id, {
        monthlyPriceCents, confirm: true, reason: reason.trim(),
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
      });
      onChanged();
    } catch (e: any) { setErr(e?.message || 'Failed to change pricing'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title="Change Pricing" onClose={onClose} width={520}>
      {!initialPlanId && (
        <Field label="Plan"><select style={inp()} value={planId} onChange={(e) => pickPlan(e.target.value)}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      )}
      <div className="muted" style={{ fontSize: 12, margin: '4px 2px 10px' }}>
        Current monthly price: <b>${plan ? Math.round(plan.monthlyPriceCents / 100).toLocaleString() : '—'}</b>
        {plan ? ` · ${plan.tenantCount} tenant(s) on this plan` : ''}. Completed invoices are not affected; a new plan version is recorded.
      </div>
      <div style={grid2()}>
        <Field label="New monthly price ($) *"><input style={inp()} value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Effective date"><input style={inp()} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></Field>
      </div>
      <Field label="Reason *"><input style={inp()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. market adjustment" /></Field>
      <label style={{ ...chk(), margin: '10px 2px' }}><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I confirm this audited pricing change.</label>
      {err && <div style={errBox()}>{err}</div>}
      <div style={actions()}>
        <button style={btn()} onClick={onClose} disabled={busy}>Cancel</button>
        <button style={btn(false, true)} onClick={submit} disabled={busy}>{busy ? 'Applying…' : 'Apply Pricing Change'}</button>
      </div>
    </Overlay>
  );
}

// Upgrade/Downgrade a tenant onto a catalog plan, with a live decimal-safe proration preview before applying.
export function ChangePlanModal({ tenants, plans, onClose, onChanged }: { tenants: TenantSubscription[]; plans: PlanDirectoryRow[]; onClose: () => void; onChanged: () => void }) {
  const [tenantId, setTenantId] = useState('');
  const [toPlanCode, setToPlanCode] = useState('');
  const [strategy, setStrategy] = useState<Strategy>('immediate');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const usd = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
  const tenant = tenants.find((t) => t.tenantId === tenantId);
  const clearPreview = () => setPreview(null);

  const runPreview = async () => {
    setErr(null);
    if (!tenantId || !toPlanCode) { setErr('Select a tenant and a target plan.'); return; }
    setBusy(true);
    try { setPreview(await superAdminPlansApi.previewChange(tenantId, toPlanCode, strategy)); }
    catch (e: any) { setErr(e?.message || 'Preview failed'); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    setErr(null);
    if (!tenantId || !toPlanCode) { setErr('Select a tenant and a target plan.'); return; }
    if (!reason.trim()) { setErr('A reason is required to apply a plan change.'); return; }
    setBusy(true);
    try { await superAdminPlansApi.commitChange(tenantId, toPlanCode, strategy, reason.trim()); onChanged(); onClose(); }
    catch (e: any) { setErr(e?.message || 'Change failed'); }
    finally { setBusy(false); }
  };

  const badge = (t: string): CSSProperties => {
    const map: Record<string, [string, string]> = { upgrade: ['#E7F2EA', '#2F6B43'], downgrade: ['#FBEFE0', '#8B5A18'], crossgrade: ['#EEF2F8', '#3A557E'], initial: ['#EEF2F8', '#3A557E'] };
    const [bg, fg] = map[t] ?? ['#EEF2F8', '#3A557E'];
    return { display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: bg, color: fg, fontSize: 11.5, fontWeight: 700, textTransform: 'capitalize' };
  };

  return (
    <Overlay title="Upgrade / Downgrade Tenant" onClose={onClose}>
      <div style={grid2()}>
        <Field label="Tenant *">
          <select style={inp()} value={tenantId} onChange={(e) => { setTenantId(e.target.value); clearPreview(); }}>
            <option value="">Select a tenant…</option>
            {tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name}{t.planText ? ` — ${t.planText}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Target plan *">
          <select style={inp()} value={toPlanCode} onChange={(e) => { setToPlanCode(e.target.value); clearPreview(); }}>
            <option value="">Select a plan…</option>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name} — ${(p.monthlyPriceCents / 100).toFixed(2)}/mo</option>)}
          </select>
        </Field>
        <Field label="When">
          <select style={inp()} value={strategy} onChange={(e) => { setStrategy(e.target.value as Strategy); clearPreview(); }}>
            <option value="immediate">Immediately (prorate now)</option>
            <option value="end_of_cycle">At end of current cycle</option>
          </select>
        </Field>
        <Field label="Reason *"><input style={inp()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer upgrade" /></Field>
      </div>

      {tenant && <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Current: {tenant.planText ?? '—'}{tenant.monthlyPriceCents != null ? ` (${usd(tenant.monthlyPriceCents)}/mo)` : ' (no catalog price on file)'}</div>}

      {preview && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: '#FFFCF6', border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={badge(preview.changeType)}>{preview.changeType}</span>
            <span className="muted" style={{ fontSize: 11.5 }}>{preview.strategy === 'end_of_cycle' ? `Scheduled for ${new Date(preview.effectiveAt).toLocaleDateString()}` : 'Effective immediately'}</span>
          </div>
          {preview.strategy === 'immediate' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, fontSize: 12.5 }}>
              <div><div className="muted" style={{ fontSize: 11 }}>Credit (unused)</div><strong>{usd(preview.proration.creditCents)}</strong></div>
              <div><div className="muted" style={{ fontSize: 11 }}>Prorated charge</div><strong>{usd(preview.proration.chargeCents)}</strong></div>
              <div><div className="muted" style={{ fontSize: 11 }}>Net due now</div><strong style={{ color: preview.proration.netCents < 0 ? '#2F6B43' : 'var(--text)' }}>{usd(preview.proration.netCents)}{preview.proration.netCents < 0 ? ' credit' : ''}</strong></div>
            </div>
          ) : <div className="muted" style={{ fontSize: 12 }}>No proration — the change applies next cycle.</div>}
        </div>
      )}

      {err && <div style={errBox()}>{err}</div>}
      <div style={actions()}>
        <button style={btn()} onClick={onClose} disabled={busy}>Cancel</button>
        <button style={btn(busy)} onClick={runPreview} disabled={busy}>{busy ? 'Working…' : 'Preview'}</button>
        <button style={btn(busy, true)} onClick={apply} disabled={busy}>{busy ? 'Applying…' : 'Apply Change'}</button>
      </div>
    </Overlay>
  );
}

// Assign an add-on, start a trial, or apply a promotion to a tenant. Backend enforces permission/limits; this surfaces
// results honestly and reloads the page so the Add-On Performance / Trial & Promotional panels reflect the change.
export function ManageOffersModal({ tenants, addOns, offers, initialTab = 'promo', onClose, onChanged }: {
  tenants: TenantSubscription[];
  addOns: { code: string; name: string; unitPriceCents: number }[];
  offers: { kind: 'trial' | 'promotion'; code: string; name: string }[];
  initialTab?: 'addon' | 'trial' | 'promo';
  onClose: () => void; onChanged: () => void;
}) {
  const [tab, setTab] = useState<'addon' | 'trial' | 'promo'>(initialTab);
  const [tenantId, setTenantId] = useState('');
  const [addOnCode, setAddOnCode] = useState('');
  const [qty, setQty] = useState('1');
  const [trialCode, setTrialCode] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const trials = offers.filter((o) => o.kind === 'trial');
  const promos = offers.filter((o) => o.kind === 'promotion');

  const run = async (fn: () => Promise<void>, successMsg: string) => {
    setErr(null); setOk(null);
    if (!tenantId) { setErr('Select a tenant first.'); return; }
    setBusy(true);
    try { await fn(); setOk(successMsg); onChanged(); }
    catch (e: any) { setErr(e?.message || 'Action failed'); }
    finally { setBusy(false); }
  };

  const tabBtn = (key: typeof tab, _label: string): CSSProperties => ({
    height: 32, padding: '0 12px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
    border: '1px solid ' + (tab === key ? 'var(--g7)' : 'var(--line)'), background: tab === key ? 'var(--g7)' : '#FFFDF8', color: tab === key ? '#fff' : 'var(--text)',
  });

  return (
    <Overlay title="Manage Tenant Offers" onClose={onClose}>
      <Field label="Tenant *">
        <select style={inp()} value={tenantId} onChange={(e) => { setTenantId(e.target.value); setOk(null); setErr(null); }}>
          <option value="">Select a tenant…</option>
          {tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name}{t.planText ? ` — ${t.planText}` : ''}</option>)}
        </select>
      </Field>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 4 }}>
        <button style={tabBtn('addon', 'Add-On')} onClick={() => setTab('addon')}>Add-On</button>
        <button style={tabBtn('trial', 'Trial')} onClick={() => setTab('trial')}>Trial</button>
        <button style={tabBtn('promo', 'Promotion')} onClick={() => setTab('promo')}>Promotion</button>
      </div>

      {tab === 'addon' && (
        <div style={grid2()}>
          <Field label="Add-on *">
            <select style={inp()} value={addOnCode} onChange={(e) => setAddOnCode(e.target.value)}>
              <option value="">Select an add-on…</option>
              {addOns.map((a) => <option key={a.code} value={a.code}>{a.name} — ${(a.unitPriceCents / 100).toFixed(2)}/mo</option>)}
            </select>
          </Field>
          <Field label="Quantity"><input style={inp()} value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" /></Field>
        </div>
      )}
      {tab === 'trial' && (
        <Field label="Trial *">
          <select style={inp()} value={trialCode} onChange={(e) => setTrialCode(e.target.value)}>
            <option value="">Select a trial…</option>
            {trials.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </Field>
      )}
      {tab === 'promo' && (
        <Field label="Promotion *">
          <select style={inp()} value={promoCode} onChange={(e) => setPromoCode(e.target.value)}>
            <option value="">Select a promotion…</option>
            {promos.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </Field>
      )}

      {ok && <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 9, background: '#E7F2EA', color: '#2F6B43', border: '1px solid #BFE0CB', fontSize: 12.5 }}>{ok}</div>}
      {err && <div style={errBox()}>{err}</div>}
      <div style={actions()}>
        <button style={btn()} onClick={onClose} disabled={busy}>Close</button>
        {tab === 'addon' && <button style={btn(busy, true)} disabled={busy} onClick={() => run(async () => { await superAdminPlansApi.assignAddOn(tenantId, addOnCode, Math.max(1, parseInt(qty, 10) || 1)); }, 'Add-on assigned.')}>{busy ? 'Assigning…' : 'Assign Add-On'}</button>}
        {tab === 'trial' && <button style={btn(busy, true)} disabled={busy} onClick={() => run(async () => { await superAdminPlansApi.startTrial(tenantId, trialCode); }, 'Trial started.')}>{busy ? 'Starting…' : 'Start Trial'}</button>}
        {tab === 'promo' && <button style={btn(busy, true)} disabled={busy} onClick={() => run(async () => { await superAdminPlansApi.applyPromotion(tenantId, promoCode); }, 'Promotion applied.')}>{busy ? 'Applying…' : 'Apply Promotion'}</button>}
      </div>
    </Overlay>
  );
}

// Per-tenant custom limits + feature toggles, backed by the entitlement override engine. Reads the resolved
// entitlements (plan default vs override vs used vs effective) and writes audited overrides; refreshes on each change.
export function EntitlementsModal({ tenants, initialTab = 'limits', onClose, onChanged }: {
  tenants: TenantSubscription[]; initialTab?: 'limits' | 'features'; onClose: () => void; onChanged: () => void;
}) {
  const [tab, setTab] = useState<'limits' | 'features'>(initialTab);
  const [tenantId, setTenantId] = useState('');
  const [ent, setEnt] = useState<TenantEntitlements | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // limits editor
  const [metric, setMetric] = useState('');
  const [value, setValue] = useState('');
  const [enforcement, setEnforcement] = useState<'hard' | 'soft'>('hard');
  const [limitReason, setLimitReason] = useState('');
  // features editor
  const [featureKey, setFeatureKey] = useState('');
  const [featureState, setFeatureState] = useState<'enabled' | 'disabled' | 'clear'>('enabled');
  const [featureReason, setFeatureReason] = useState('');

  const load = async (tid: string) => {
    setErr(null); setOk(null); setEnt(null); setMetric(''); setFeatureKey('');
    if (!tid) return;
    setLoading(true);
    try { setEnt(await superAdminPlansApi.getEntitlements(tid)); }
    catch (e: any) { setErr(e?.message || 'Failed to load entitlements'); }
    finally { setLoading(false); }
  };

  const fmtLimit = (v: number | null, configured = true) => (!configured ? '—' : v === null ? 'Unlimited' : v.toLocaleString());
  const curLimit = ent?.limits.find((l) => l.metric === metric) || null;
  const curFeature = ent?.features.find((f) => f.featureKey === featureKey) || null;

  const saveLimit = async (clear: boolean) => {
    setErr(null); setOk(null);
    if (!tenantId || !metric) { setErr('Select a tenant and a metric.'); return; }
    if (!clear && !limitReason.trim()) { setErr('A reason is required.'); return; }
    setBusy(true);
    try {
      const body = clear ? { metric, clear: true }
        : { metric, limitValue: value.trim() === '' ? null : value.trim().toLowerCase() === 'unlimited' ? 'unlimited' as const : parseInt(value, 10), enforcement, reason: limitReason.trim() };
      const updated = await superAdminPlansApi.setLimit(tenantId, body);
      setEnt(updated); setOk(clear ? 'Override cleared.' : 'Custom limit saved.'); onChanged();
    } catch (e: any) { setErr(e?.message || 'Save failed'); }
    finally { setBusy(false); }
  };

  const saveFeature = async () => {
    setErr(null); setOk(null);
    if (!tenantId || !featureKey) { setErr('Select a tenant and a feature.'); return; }
    setBusy(true);
    try {
      const updated = await superAdminPlansApi.setFeature(tenantId, { featureKey, state: featureState, reason: featureReason.trim() || undefined });
      setEnt(updated); setOk(featureState === 'clear' ? 'Feature override cleared.' : `Feature ${featureState}.`); onChanged();
    } catch (e: any) { setErr(e?.message || 'Save failed'); }
    finally { setBusy(false); }
  };

  const tabBtn = (key: typeof tab, _label: string): CSSProperties => ({
    height: 32, padding: '0 12px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
    border: '1px solid ' + (tab === key ? 'var(--g7)' : 'var(--line)'), background: tab === key ? 'var(--g7)' : '#FFFDF8', color: tab === key ? '#fff' : 'var(--text)',
  });

  return (
    <Overlay title="Custom Limits & Features" onClose={onClose}>
      <Field label="Tenant *">
        <select style={inp()} value={tenantId} onChange={(e) => { setTenantId(e.target.value); load(e.target.value); }}>
          <option value="">Select a tenant…</option>
          {tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name}{t.planText ? ` — ${t.planText}` : ''}</option>)}
        </select>
      </Field>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 4 }}>
        <button style={tabBtn('limits', 'Limits')} onClick={() => setTab('limits')}>Custom Limits</button>
        <button style={tabBtn('features', 'Features')} onClick={() => setTab('features')}>Features</button>
      </div>

      {loading && <div className="muted" style={{ fontSize: 12.5, padding: '8px 2px' }}>Loading entitlements…</div>}

      {ent && tab === 'limits' && (
        <>
          <Field label="Metric *">
            <select style={inp()} value={metric} onChange={(e) => { const m = e.target.value; setMetric(m); const l = ent.limits.find((x) => x.metric === m); setValue(l?.override?.value === null ? 'unlimited' : l?.override?.value != null ? String(l.override.value) : ''); setEnforcement((l?.override?.enforcement as any) === 'soft' ? 'soft' : 'hard'); setLimitReason(''); setOk(null); }}>
              <option value="">Select a metric…</option>
              {ent.limits.map((l) => <option key={l.metric} value={l.metric}>{l.metric}</option>)}
            </select>
          </Field>
          {curLimit && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
              <div>Plan default: <strong>{fmtLimit(curLimit.planDefault, curLimit.planConfigured)}</strong></div>
              <div>Used: <strong>{curLimit.used === null ? '—' : curLimit.used.toLocaleString()}</strong></div>
              <div>Effective: <strong>{fmtLimit(curLimit.effectiveValue)}</strong> ({curLimit.effectiveSource})</div>
            </div>
          )}
          <div style={{ ...grid2(), marginTop: 8 }}>
            <Field label="Override value (blank = inherit, or 'unlimited')"><input style={inp()} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 2500 or unlimited" /></Field>
            <Field label="Enforcement">
              <select style={inp()} value={enforcement} onChange={(e) => setEnforcement(e.target.value as any)}>
                <option value="hard">Hard (block at limit)</option>
                <option value="soft">Soft (allow + overage)</option>
              </select>
            </Field>
          </div>
          <Field label="Reason *"><input style={inp()} value={limitReason} onChange={(e) => setLimitReason(e.target.value)} placeholder="Why this override" /></Field>
        </>
      )}

      {ent && tab === 'features' && (
        <>
          <Field label="Feature *">
            <select style={inp()} value={featureKey} onChange={(e) => { const k = e.target.value; setFeatureKey(k); const f = ent.features.find((x) => x.featureKey === k); setFeatureState((f?.override as any) === 'disabled' ? 'disabled' : 'enabled'); setFeatureReason(''); setOk(null); }}>
              <option value="">Select a feature…</option>
              {ent.features.map((f) => <option key={f.featureKey} value={f.featureKey}>{f.featureKey}</option>)}
            </select>
          </Field>
          {curFeature && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Plan state: <strong>{curFeature.planState}</strong> · Override: <strong>{curFeature.override ?? 'none'}</strong> · Effective: <strong>{curFeature.enabled ? 'enabled' : 'disabled'}</strong> ({curFeature.source})</div>
          )}
          <div style={{ ...grid2(), marginTop: 8 }}>
            <Field label="Set state">
              <select style={inp()} value={featureState} onChange={(e) => setFeatureState(e.target.value as any)}>
                <option value="enabled">Enable</option>
                <option value="disabled">Disable</option>
                <option value="clear">Clear override</option>
              </select>
            </Field>
            <Field label="Reason"><input style={inp()} value={featureReason} onChange={(e) => setFeatureReason(e.target.value)} placeholder="Optional" /></Field>
          </div>
        </>
      )}

      {ok && <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 9, background: '#E7F2EA', color: '#2F6B43', border: '1px solid #BFE0CB', fontSize: 12.5 }}>{ok}</div>}
      {err && <div style={errBox()}>{err}</div>}
      <div style={actions()}>
        <button style={btn()} onClick={onClose} disabled={busy}>Close</button>
        {tab === 'limits' && ent && <button style={btn(busy)} disabled={busy || !curLimit?.override} onClick={() => saveLimit(true)}>Clear</button>}
        {tab === 'limits' && ent && <button style={btn(busy, true)} disabled={busy} onClick={() => saveLimit(false)}>{busy ? 'Saving…' : 'Save Limit'}</button>}
        {tab === 'features' && ent && <button style={btn(busy, true)} disabled={busy} onClick={saveFeature}>{busy ? 'Saving…' : 'Save Feature'}</button>}
      </div>
    </Overlay>
  );
}

// Edit a plan's default limits (the plan_limits catalog defaults, distinct from per-tenant overrides). Prefills from
// the plan's current limits; sends only changed metrics; backend validates + audits.
export function ConfigureDefaultLimitsModal({ plans, initialPlanId, onClose, onChanged }: {
  plans: PlanDirectoryRow[]; initialPlanId?: string; onClose: () => void; onChanged: () => void;
}) {
  const [planId, setPlanId] = useState(initialPlanId || (plans[0]?.id ?? ''));
  const plan = plans.find((p) => p.id === planId) || null;
  const asText = (v: number | null | undefined) => (v === null ? 'unlimited' : v === undefined ? '' : String(v));
  const initialValues = () => {
    const m: Record<string, string> = {};
    if (plan) for (const metric of Object.keys(plan.limits)) m[metric] = asText(plan.limits[metric]);
    return m;
  };
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const onPlan = (id: string) => {
    setPlanId(id); setOk(null); setErr(null);
    const p = plans.find((x) => x.id === id);
    const m: Record<string, string> = {};
    if (p) for (const metric of Object.keys(p.limits)) m[metric] = asText(p.limits[metric]);
    setValues(m);
  };

  const parse = (s: string): number | null | 'unlimited' | undefined => {
    const t = s.trim().toLowerCase();
    if (t === '' ) return undefined;            // treat blank as no value provided -> skip
    if (t === 'unlimited') return 'unlimited';
    const n = parseInt(t, 10);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  };

  const save = async () => {
    setErr(null); setOk(null);
    if (!plan) { setErr('Select a plan.'); return; }
    if (!reason.trim()) { setErr('A reason is required.'); return; }
    const changes: { metric: string; limitValue: number | null | 'unlimited' }[] = [];
    for (const metric of Object.keys(values)) {
      const orig = asText(plan.limits[metric]);
      if (values[metric].trim() === orig) continue;         // unchanged
      const parsed = parse(values[metric]);
      if (parsed === undefined) { setErr(`Invalid value for ${metric} (use a number or "unlimited").`); return; }
      changes.push({ metric, limitValue: parsed });
    }
    if (changes.length === 0) { setErr('No changes to save.'); return; }
    setBusy(true);
    try { await superAdminPlansApi.updatePlanLimits(planId, { reason: reason.trim(), changes }); setOk(`Saved ${changes.length} limit change(s).`); onChanged(); }
    catch (e: any) { setErr(e?.message || 'Save failed'); }
    finally { setBusy(false); }
  };

  const metrics = plan ? Object.keys(plan.limits).sort() : [];

  return (
    <Overlay title="Configure Default Limits" onClose={onClose}>
      <Field label="Plan *">
        <select style={inp()} value={planId} onChange={(e) => onPlan(e.target.value)}>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Enter a number or "unlimited". These are plan-wide defaults; per-tenant overrides are separate.</div>
      <div style={{ marginTop: 8, maxHeight: 260, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 8 }}>
        {metrics.map((metric) => (
          <label key={metric} style={{ display: 'block', fontSize: 11.5, color: 'var(--soft)', fontWeight: 600 }}>{metric}
            <input style={{ ...inp(), marginTop: 3 }} value={values[metric] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [metric]: e.target.value }))} />
          </label>
        ))}
      </div>
      <div style={{ marginTop: 10 }}><Field label="Reason *"><input style={inp()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this change" /></Field></div>
      {ok && <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 9, background: '#E7F2EA', color: '#2F6B43', border: '1px solid #BFE0CB', fontSize: 12.5 }}>{ok}</div>}
      {err && <div style={errBox()}>{err}</div>}
      <div style={actions()}>
        <button style={btn()} onClick={onClose} disabled={busy}>Close</button>
        <button style={btn(busy, true)} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Limits'}</button>
      </div>
    </Overlay>
  );
}

// Edit platform overage-rule unit prices + grace, and trigger a recompute of metered charges for the current period.
export function ConfigureOveragePricingModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rules, setRules] = useState<OverageRuleDetail[] | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [grace, setGrace] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    superAdminPlansApi.getOverageRules().then((rs) => {
      if (!live) return;
      setRules(rs);
      setPrices(Object.fromEntries(rs.map((r) => [r.metric, (r.unitPriceCents / 100).toFixed(2)])));
      setGrace(Object.fromEntries(rs.map((r) => [r.metric, String(r.graceAmount)])));
    }).catch((e) => setErr(e?.message || 'Failed to load rules')).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  const save = async () => {
    setErr(null); setOk(null);
    if (!rules) return;
    if (!reason.trim()) { setErr('A reason is required.'); return; }
    const changes: { metric: string; unitPriceCents: number; graceAmount?: number }[] = [];
    for (const r of rules) {
      const cents = parseDollarsToCents(prices[r.metric]) ?? NaN;   // NaN keeps the existing invalid-guard behavior below
      const g = parseInt(grace[r.metric], 10);
      if (!Number.isInteger(cents) || cents < 0) { setErr(`Invalid price for ${r.metric}.`); return; }
      if (!Number.isInteger(g) || g < 0) { setErr(`Invalid grace for ${r.metric}.`); return; }
      if (cents !== r.unitPriceCents || g !== r.graceAmount) changes.push({ metric: r.metric, unitPriceCents: cents, graceAmount: g });
    }
    if (changes.length === 0) { setErr('No changes to save.'); return; }
    setBusy(true);
    try { const updated = await superAdminPlansApi.updateOverageRules({ reason: reason.trim(), changes }); setRules(updated); setOk(`Saved ${changes.length} rule change(s).`); onChanged(); }
    catch (e: any) { setErr(e?.message || 'Save failed'); }
    finally { setBusy(false); }
  };

  const recompute = async () => {
    setErr(null); setOk(null); setBusy(true);
    try { const r = await superAdminPlansApi.recomputeOverage(); setOk(`Recomputed ${r.period}: ${r.chargesWritten} charge(s), $${(r.totalRevenueCents / 100).toFixed(2)} total.`); onChanged(); }
    catch (e: any) { setErr(e?.message || 'Recompute failed'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title="Configure Overage Pricing" onClose={onClose}>
      {loading && <div className="muted" style={{ fontSize: 12.5, padding: '8px 2px' }}>Loading rules…</div>}
      {rules && (
        <>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Platform overage rates (per unit over the effective limit). Grace = units allowed before charging.</div>
          <div style={{ maxHeight: 260, overflow: 'auto', display: 'grid', gap: 8 }}>
            {rules.map((r) => (
              <div key={r.metric} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 8, alignItems: 'end' }}>
                <div style={{ fontSize: 12, fontWeight: 600, alignSelf: 'center' }}>{r.metric}</div>
                <label style={{ fontSize: 11, color: 'var(--soft)', fontWeight: 600 }}>Unit price ($)
                  <input style={{ ...inp(), marginTop: 3 }} value={prices[r.metric] ?? ''} onChange={(e) => setPrices((v) => ({ ...v, [r.metric]: e.target.value }))} inputMode="decimal" />
                </label>
                <label style={{ fontSize: 11, color: 'var(--soft)', fontWeight: 600 }}>Grace
                  <input style={{ ...inp(), marginTop: 3 }} value={grace[r.metric] ?? ''} onChange={(e) => setGrace((v) => ({ ...v, [r.metric]: e.target.value }))} inputMode="numeric" />
                </label>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}><Field label="Reason *"><input style={inp()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this change" /></Field></div>
        </>
      )}
      {ok && <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 9, background: '#E7F2EA', color: '#2F6B43', border: '1px solid #BFE0CB', fontSize: 12.5 }}>{ok}</div>}
      {err && <div style={errBox()}>{err}</div>}
      <div style={actions()}>
        <button style={btn()} onClick={onClose} disabled={busy}>Close</button>
        <button style={btn(busy)} onClick={recompute} disabled={busy}>{busy ? 'Working…' : 'Recompute Now'}</button>
        <button style={btn(busy, true)} onClick={save} disabled={busy || !rules}>{busy ? 'Saving…' : 'Save Rates'}</button>
      </div>
    </Overlay>
  );
}

// Lock a tenant to a specific plan version + price (grandfathering), with an optional migration target and dates.
export function GrandfatherModal({ tenants, plans, onClose, onChanged }: {
  tenants: TenantSubscription[]; plans: PlanDirectoryRow[]; onClose: () => void; onChanged: () => void;
}) {
  const [existing, setExisting] = useState<GrandfatherRow[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [planId, setPlanId] = useState('');
  const [versions, setVersions] = useState<PlanVersion[] | null>(null);
  const [planVersionId, setPlanVersionId] = useState('');
  const [lockedPrice, setLockedPrice] = useState('');
  const [migrationTarget, setMigrationTarget] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const refreshExisting = () => superAdminPlansApi.listGrandfathered().then(setExisting).catch(() => {});
  useEffect(() => { refreshExisting(); }, []);

  const onPlan = async (id: string) => {
    setPlanId(id); setVersions(null); setPlanVersionId(''); setOk(null); setErr(null);
    if (!id) return;
    try {
      const vs = await superAdminPlansApi.versions(id);
      setVersions(vs);
      const active = vs.find((v) => v.status === 'active') || vs[0];
      if (active) { setPlanVersionId(active.id); setLockedPrice((active.monthlyPriceCents / 100).toFixed(2)); }
    } catch (e: any) { setErr(e?.message || 'Failed to load versions'); }
  };

  const onVersion = (vid: string) => {
    setPlanVersionId(vid);
    const v = versions?.find((x) => x.id === vid);
    if (v) setLockedPrice((v.monthlyPriceCents / 100).toFixed(2));
  };

  const create = async () => {
    setErr(null); setOk(null);
    if (!tenantId || !planVersionId) { setErr('Select a tenant and a plan version.'); return; }
    if (!reason.trim()) { setErr('A reason is required.'); return; }
    const cents = lockedPrice.trim() === '' ? null : (parseDollarsToCents(lockedPrice) ?? NaN);   // NaN → 'Invalid locked price.'
    if (cents !== null && (!Number.isInteger(cents) || cents < 0)) { setErr('Invalid locked price.'); return; }
    setBusy(true);
    try {
      await superAdminPlansApi.createGrandfathered({
        tenantId, planVersionId, lockedMonthlyPriceCents: cents,
        migrationTargetPlanCode: migrationTarget || null,
        effectiveFrom: effectiveFrom || null, endDate: endDate || null, reason: reason.trim(),
      });
      setOk('Grandfathered assignment saved.'); await refreshExisting(); onChanged();
    } catch (e: any) { setErr(e?.message || 'Create failed'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title="Create Grandfathered Plan" onClose={onClose}>
      {existing.length > 0 && (
        <div style={{ marginBottom: 10, padding: 8, borderRadius: 9, background: '#FFFCF6', border: '1px solid var(--line)' }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Existing grandfathered tenants</div>
          {existing.map((g) => (
            <div key={g.tenantId} style={{ fontSize: 12 }}>{g.tenantName} — {g.planCode ?? '—'} v{g.versionNumber ?? '—'} @ ${((g.lockedMonthlyPriceCents ?? 0) / 100).toFixed(2)}/mo{g.migrationTargetPlanCode ? ` → ${g.migrationTargetPlanCode}` : ''}</div>
          ))}
        </div>
      )}
      <div style={grid2()}>
        <Field label="Tenant *">
          <select style={inp()} value={tenantId} onChange={(e) => { setTenantId(e.target.value); setOk(null); }}>
            <option value="">Select a tenant…</option>
            {tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.name}{t.planText ? ` — ${t.planText}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Plan *">
          <select style={inp()} value={planId} onChange={(e) => onPlan(e.target.value)}>
            <option value="">Select a plan…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Version *">
          <select style={inp()} value={planVersionId} onChange={(e) => onVersion(e.target.value)} disabled={!versions}>
            <option value="">{versions ? 'Select a version…' : 'Pick a plan first'}</option>
            {(versions ?? []).map((v) => <option key={v.id} value={v.id}>v{v.versionNumber} — ${(v.monthlyPriceCents / 100).toFixed(2)}/mo ({v.status})</option>)}
          </select>
        </Field>
        <Field label="Locked price ($/mo)"><input style={inp()} value={lockedPrice} onChange={(e) => setLockedPrice(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Migration target (optional)">
          <select style={inp()} value={migrationTarget} onChange={(e) => setMigrationTarget(e.target.value)}>
            <option value="">None</option>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Effective from (optional)"><input style={inp()} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></Field>
        <Field label="End date (optional)"><input style={inp()} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        <Field label="Reason *"><input style={inp()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this is grandfathered" /></Field>
      </div>
      {ok && <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 9, background: '#E7F2EA', color: '#2F6B43', border: '1px solid #BFE0CB', fontSize: 12.5 }}>{ok}</div>}
      {err && <div style={errBox()}>{err}</div>}
      <div style={actions()}>
        <button style={btn()} onClick={onClose} disabled={busy}>Close</button>
        <button style={btn(busy, true)} onClick={create} disabled={busy}>{busy ? 'Saving…' : 'Create Assignment'}</button>
      </div>
    </Overlay>
  );
}

// Read-only plan utilization across tenants: per-metric used vs effective limit, worst status, and a platform summary.
export function PlanUtilizationModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<PlanUtilization | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    superAdminPlansApi.planUtilization().then((d) => live && setData(d)).catch((e) => live && setErr(e?.message || 'Failed to load')).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  const statusColor = (s: string): [string, string] => s === 'over' || s === 'blocked' || s === 'overage' ? ['#FBEAEA', '#9B2C2C']
    : s === 'near' || s === 'warning' ? ['#FBEFE0', '#8B5A18']
    : s === 'advisory' ? ['#EEF2F8', '#3A557E'] : ['#E7F2EA', '#2F6B43'];
  const badge = (s: string, _label?: string): CSSProperties => { const [bg, fg] = statusColor(s); return { display: 'inline-block', padding: '1px 7px', borderRadius: 999, background: bg, color: fg, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }; };
  const bar = (pct: number) => { const [, fg] = statusColor(pct >= 100 ? 'over' : pct >= 90 ? 'near' : 'ok'); return (
    <div style={{ height: 6, borderRadius: 4, background: 'var(--cream2)', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: fg }} /></div>
  ); };

  return (
    <Overlay title="Plan Utilization" onClose={onClose}>
      {loading && <div className="muted" style={{ fontSize: 12.5, padding: '8px 2px' }}>Loading utilization…</div>}
      {err && <div style={errBox()}>{err}</div>}
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, marginBottom: 12 }}>
            {[['Tenants', String(data.summary.tenants)], ['Near limit', String(data.summary.tenantsNearLimit)], ['Over limit', String(data.summary.tenantsOverLimit)], ['Avg peak', `${data.summary.avgMaxUtilizationPct}%`]].map(([k, v]) => (
              <div key={k} style={{ padding: 8, borderRadius: 9, background: '#FFFCF6', border: '1px solid var(--line)' }}>
                <div className="muted" style={{ fontSize: 10.5 }}>{k}</div><div style={{ fontSize: 16, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ maxHeight: 320, overflow: 'auto', display: 'grid', gap: 10 }}>
            {data.tenants.map((t) => (
              <div key={t.tenantId} style={{ padding: 10, borderRadius: 9, background: '#FFFCF6', border: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t.name} <span className="muted" style={{ fontWeight: 400 }}>— {t.planText ?? '—'}</span></div>
                  <span style={badge(t.worstStatus)}>{t.worstStatus === 'over' ? 'Over limit' : t.worstStatus === 'near' ? 'Near limit' : 'Healthy'} · {t.maxPct}%</span>
                </div>
                {t.metrics.length === 0 ? <div className="muted" style={{ fontSize: 11.5 }}>No metered limits (tenant not on a catalog plan or no finite limits).</div> : (
                  <div style={{ display: 'grid', gap: 5 }}>
                    {t.metrics.slice().sort((a, b) => b.pct - a.pct).map((m) => (
                      <div key={m.metric} style={{ display: 'grid', gridTemplateColumns: '1.3fr 2fr 0.7fr', gap: 8, alignItems: 'center', fontSize: 11.5 }}>
                        <div>{m.metric}</div>
                        <div>{bar(m.pct)}</div>
                        <div style={{ textAlign: 'right' }}>{m.used}/{m.effective} <span className="muted">({m.pct}%)</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Utilization covers metrics with authoritative usage and a finite effective limit; usage-based metrics without live meters are omitted.</div>
        </>
      )}
      <div style={actions()}><button style={btn(false, true)} onClick={onClose}>Close</button></div>
    </Overlay>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 11.5, color: 'var(--soft)', fontWeight: 600 }}>{label}<div style={{ marginTop: 3 }}>{children}</div></label>;
}

const grid2 = (): CSSProperties => ({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 });
const inp = (): CSSProperties => ({ width: '100%', height: 34, border: '1px solid var(--line)', borderRadius: 9, background: '#FFFDF8', padding: '0 10px', fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box' });
const chk = (): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text)' });
const actions = (): CSSProperties => ({ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 });
const errBox = (): CSSProperties => ({ marginTop: 12, padding: '8px 10px', borderRadius: 9, background: '#FBEAE7', color: '#B23B2E', border: '1px solid #F0C9C2', fontSize: 12.5 });
const iconBtn = (): CSSProperties => ({ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--line)', background: '#FFFDF8', cursor: 'pointer', fontSize: 13 });
function btn(disabled = false, primary = false): CSSProperties {
  return { height: 36, padding: '0 14px', borderRadius: 9, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', border: '1px solid ' + (primary ? 'var(--g7)' : 'var(--line)'), background: disabled ? '#F3EDE3' : primary ? 'var(--g7)' : '#FFFDF8', color: disabled ? 'var(--muted)' : primary ? '#fff' : 'var(--text)', opacity: disabled ? 0.85 : 1 };
}
