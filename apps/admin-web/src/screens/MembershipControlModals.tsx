import { useEffect, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { membershipControlsApi, type MPControls } from '../api/superAdminMembershipsApi';
import { money } from './_chartkit';

// MembershipControlModals — Unit 2 Platform Membership Controls: Enable/Disable by plan, reusable Templates,
// platform Limits, and allowed Rules. Server validates + audits every change; the client mirrors the guardrails.

function Overlay({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div role="dialog" aria-label={title} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '6vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: wide ? 640 : 480, maxHeight: '84vh', overflowY: 'auto', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <button className="btn ghost" style={{ height: 26 }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
const okMsg = (m: string) => <div style={{ padding: '6px 10px', background: '#E7F2EA', color: '#2F6B43', borderRadius: 8, fontSize: 12 }}>{m}</div>;
const errMsg = (m: string) => <div className="state" style={{ color: '#9B2C2C' }}>{m}</div>;

export function PlanGatingModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [c, setC] = useState<MPControls | null>(null);
  const [gating, setGating] = useState<Record<string, boolean>>({});
  const [enabled, setEnabled] = useState(true);
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { membershipControlsApi.controls().then((d) => { setC(d as MPControls); setGating((d as MPControls).planGating || {}); setEnabled((d as MPControls).enabledGlobally); }).catch((e: any) => setErr(e?.message)); }, []);
  const save = async () => {
    try { await membershipControlsApi.setEnabled(enabled); await membershipControlsApi.setGating(gating); setMsg('Membership availability updated.'); onChanged?.(); }
    catch (e: any) { setErr(e?.message || 'Save failed'); }
  };
  return (
    <Overlay title="Enable or Disable Memberships by Plan" onClose={onClose}>
      {err && errMsg(err)} {msg && okMsg(msg)}
      {!c ? <div className="state">Loading…</div> : (
        <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Memberships enabled platform-wide</label>
          <div className="muted" style={{ fontSize: 11 }}>Enable the membership capability per subscription plan tier:</div>
          {c.plans.map((p) => (
            <label key={p.code} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={!!gating[p.code]} onChange={(e) => setGating((g) => ({ ...g, [p.code]: e.target.checked }))} /> {p.name} <span className="muted">({p.code})</span>
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={save}>Save</button><button className="btn ghost" onClick={onClose}>Close</button></div>
        </div>
      )}
    </Overlay>
  );
}

export function PlatformLimitsModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [limits, setLimits] = useState<Record<string, number> | null>(null);
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { membershipControlsApi.controls().then((d) => setLimits((d as MPControls).limits || {})).catch((e: any) => setErr(e?.message)); }, []);
  const fields: [string, string][] = [['maxProgramsPerTenant', 'Max programs per tenant'], ['maxActiveMembersPerTenant', 'Max active members per tenant'], ['maxBenefitsPerProgram', 'Max benefits per program'], ['maxTrialDays', 'Max trial days']];
  const save = async () => { try { await membershipControlsApi.setLimits(limits ?? {}); setMsg('Platform limits saved.'); onChanged?.(); } catch (e: any) { setErr(e?.message || 'Save failed'); } };
  return (
    <Overlay title="Set Platform Membership Limits" onClose={onClose}>
      {err && errMsg(err)} {msg && okMsg(msg)}
      {!limits ? <div className="state">Loading…</div> : (
        <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
          {fields.map(([key, label]) => (
            <div key={key}><label className="flabel">{label}</label><input className="finput" inputMode="numeric" value={String(limits[key] ?? 0)} onChange={(e) => setLimits((l) => ({ ...(l ?? {}), [key]: Math.max(0, parseInt(e.target.value, 10) || 0) }))} /></div>
          ))}
          <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={save}>Save Limits</button><button className="btn ghost" onClick={onClose}>Close</button></div>
        </div>
      )}
    </Overlay>
  );
}

export function AllowedRulesModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [rules, setRules] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { membershipControlsApi.controls().then((d) => setRules((d as MPControls).rules || {})).catch((e: any) => setErr(e?.message)); }, []);
  const intervals = ['week', 'month', 'quarter', 'year'];
  const toggleInterval = (iv: string) => setRules((r: any) => { const set = new Set(r.allowedBillingIntervals ?? []); if (set.has(iv)) set.delete(iv); else set.add(iv); return { ...r, allowedBillingIntervals: [...set] }; });
  const save = async () => { try { await membershipControlsApi.setRules(rules); setMsg('Allowed membership rules saved.'); onChanged?.(); } catch (e: any) { setErr(e?.message || 'Save failed'); } };
  return (
    <Overlay title="Configure Allowed Membership Rules" onClose={onClose}>
      {err && errMsg(err)} {msg && okMsg(msg)}
      {!rules ? <div className="state">Loading…</div> : (
        <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
          <div><label className="flabel">Allowed billing intervals</label><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{intervals.map((iv) => <label key={iv} style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={(rules.allowedBillingIntervals ?? []).includes(iv)} onChange={() => toggleInterval(iv)} /> {iv}</label>)}</div></div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!rules.allowTrials} onChange={(e) => setRules((r: any) => ({ ...r, allowTrials: e.target.checked }))} /> Allow trials</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!rules.allowFamily} onChange={(e) => setRules((r: any) => ({ ...r, allowFamily: e.target.checked }))} /> Allow family memberships</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={!!rules.requireAutoRenewConsent} onChange={(e) => setRules((r: any) => ({ ...r, requireAutoRenewConsent: e.target.checked }))} /> Require auto-renew consent</label>
          <div><label className="flabel">Max discount percent</label><input className="finput" inputMode="numeric" value={String(rules.maxDiscountPercent ?? 0)} onChange={(e) => setRules((r: any) => ({ ...r, maxDiscountPercent: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) }))} /></div>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={save}>Save Rules</button><button className="btn ghost" onClick={onClose}>Close</button></div>
        </div>
      )}
    </Overlay>
  );
}

export function TemplatesModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [c, setC] = useState<MPControls | null>(null);
  const [name, setName] = useState(''); const [productType, setProductType] = useState('nail'); const [billingInterval, setBillingInterval] = useState('month');
  const [price, setPrice] = useState(''); const [trialDays, setTrialDays] = useState('0'); const [description, setDescription] = useState('');
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = () => membershipControlsApi.controls().then((d) => setC(d as MPControls)).catch((e: any) => setErr(e?.message));
  useEffect(() => { load(); }, []);
  const create = async (status: 'draft' | 'published') => {
    setErr(null);
    try {
      await membershipControlsApi.createTemplate({ name, description: description || undefined, productType, billingInterval, priceCents: (parseDollarsToCents(price || '0') ?? 0), trialDays: parseInt(trialDays, 10) || 0, status, benefits: [] });
      setMsg(`Template "${name}" created (${status}).`); setName(''); setPrice(''); setDescription(''); onChanged?.(); load();
    } catch (e: any) { setErr(e?.message || 'Create failed'); }
  };
  return (
    <Overlay title="Reusable Membership Templates" onClose={onClose} wide>
      {err && errMsg(err)} {msg && okMsg(msg)}
      {!c ? <div className="state">Loading…</div> : (
        <div style={{ display: 'grid', gap: 12, fontSize: 12 }}>
          <div>
            <strong style={{ fontSize: 12.5 }}>Existing templates ({c.templates.length})</strong>
            <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 6 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Name</th><th>Type</th><th>Price</th><th>Trial</th><th>Status</th></tr></thead>
              <tbody>{c.templates.map((t) => (<tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}><td>{t.name}</td><td>{t.productType}</td><td>{money(t.priceCents)}/{t.billingInterval}</td><td>{t.trialDays}d</td><td>{t.status}</td></tr>))}</tbody>
            </table>
          </div>
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'grid', gap: 8 }}>
            <strong style={{ fontSize: 12.5 }}>New template</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><label className="flabel">Name</label><input className="finput" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><label className="flabel">Type</label><select className="finput" value={productType} onChange={(e) => setProductType(e.target.value)}>{['nail', 'spa', 'premium', 'family', 'other'].map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
              <div><label className="flabel">Billing interval</label><select className="finput" value={billingInterval} onChange={(e) => setBillingInterval(e.target.value)}>{(c.rules?.allowedBillingIntervals ?? ['month']).map((iv: string) => <option key={iv} value={iv}>{iv}</option>)}</select></div>
              <div><label className="flabel">Price (USD)</label><input className="finput" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" /></div>
              <div><label className="flabel">Trial days (max {c.limits?.maxTrialDays ?? 0})</label><input className="finput" inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} /></div>
              <div><label className="flabel">Description</label><input className="finput" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={() => create('published')}>Create &amp; Publish</button><button className="btn ghost" onClick={() => create('draft')}>Save Draft</button><button className="btn ghost" onClick={onClose}>Close</button></div>
          </div>
        </div>
      )}
    </Overlay>
  );
}
