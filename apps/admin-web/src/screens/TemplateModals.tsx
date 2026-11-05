import { useState, type CSSProperties, type ReactNode } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { superAdminApi, type CatalogTemplateDetail } from '../api/superAdminApi';

// TemplateModals.tsx — create/edit and retire flows for the service-template catalog. Money entered in dollars, sent as
// integer cents. All writes go through the permission-gated + audited catalog endpoints.

const inp = (): CSSProperties => ({ height: 34, width: '100%', borderRadius: 9, border: '1px solid var(--line)', background: '#fff', padding: '0 10px', fontSize: 13, color: 'var(--text)', boxSizing: 'border-box' });
const lbl: CSSProperties = { fontSize: 11, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 3 };

function Overlay({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,24,16,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, padding: '40px 16px', overflow: 'auto' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--line)', width: wide ? 640 : 480, maxWidth: '100%', padding: 18, boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          <button className="btn ghost" style={{ height: 28 }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Cat = { code: string; name: string };

export function TemplateFormModal({ categories, existing, onClose, onSaved }: {
  categories: Cat[]; existing?: CatalogTemplateDetail | null; onClose: () => void; onSaved: () => void;
}) {
  const editing = !!existing;
  const [name, setName] = useState(existing?.name ?? '');
  const [categoryCode, setCategoryCode] = useState(existing?.categoryCode ?? (categories[0]?.code ?? ''));
  const [description, setDescription] = useState(existing?.description ?? '');
  const [duration, setDuration] = useState(String(existing?.durationMinutes ?? 30));
  const [priceMin, setPriceMin] = useState(existing ? (existing.priceMinCents / 100).toFixed(2) : '');
  const [priceMax, setPriceMax] = useState(existing ? (existing.priceMaxCents / 100).toFixed(2) : '');
  const [taxSetting, setTaxSetting] = useState(existing?.taxSetting ?? 'taxable');
  const [commissionEligible, setCommissionEligible] = useState(existing?.commissionEligible ?? true);
  const [isCustomizable, setIsCustomizable] = useState(existing?.isCustomizable ?? true);
  const [resources, setResources] = useState<{ label: string; quantity: string }[]>(existing?.resources.map((r) => ({ label: r.label, quantity: String(r.quantity) })) ?? [{ label: '', quantity: '1' }]);
  const [addons, setAddons] = useState<{ name: string; price: string }[]>(existing?.addons.map((a) => ({ name: a.name, price: (a.priceCents / 100).toFixed(2) })) ?? []);
  const [changeNote, setChangeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    const dm = parseInt(duration, 10);
    const minC = parseDollarsToCents(priceMin || '0') ?? NaN;   // NaN → the range guard below rejects junk text
    const maxC = parseDollarsToCents(priceMax || '0') ?? NaN;
    if (!name.trim()) { setErr('Name is required.'); return; }
    if (!categoryCode) { setErr('Category is required.'); return; }
    if (!Number.isInteger(dm) || dm < 0) { setErr('Duration must be a whole number of minutes.'); return; }
    if (!Number.isInteger(minC) || !Number.isInteger(maxC) || minC < 0 || maxC < minC) { setErr('Enter a valid price range (max ≥ min).'); return; }
    const cleanRes = resources.filter((r) => r.label.trim()).map((r) => ({ label: r.label.trim(), quantity: Math.max(1, parseInt(r.quantity, 10) || 1) }));
    const cleanAdd = addons.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), priceCents: (parseDollarsToCents(a.price || '0') ?? 0) }));
    const body: Record<string, unknown> = {
      name: name.trim(), categoryCode, description: description.trim() || null, durationMinutes: dm,
      priceMinCents: minC, priceMaxCents: maxC, taxSetting, commissionEligible, isCustomizable,
      resources: cleanRes, addons: cleanAdd,
    };
    if (editing && changeNote.trim()) body.changeNote = changeNote.trim();
    setBusy(true);
    try {
      if (editing) await superAdminApi.catalogUpdate(existing!.id, body);
      else await superAdminApi.catalogCreate(body);
      onSaved();
    } catch (e: any) { setErr(e?.message || 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay title={editing ? `Edit Template — ${existing!.name}` : 'Create Service Template'} onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Service name *</label><input style={inp()} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label style={lbl}>Category *</label><select style={inp()} value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)}>{categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
        <div><label style={lbl}>Suggested duration (min) *</label><input style={inp()} value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" /></div>
        <div><label style={lbl}>Suggested price min ($) *</label><input style={inp()} value={priceMin} onChange={(e) => setPriceMin(e.target.value)} inputMode="decimal" /></div>
        <div><label style={lbl}>Suggested price max ($) *</label><input style={inp()} value={priceMax} onChange={(e) => setPriceMax(e.target.value)} inputMode="decimal" /></div>
        <div><label style={lbl}>Tax setting</label><select style={inp()} value={taxSetting} onChange={(e) => setTaxSetting(e.target.value)}><option value="taxable">Taxable</option><option value="non_taxable">Non-Taxable</option></select></div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', paddingTop: 18 }}>
          <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={commissionEligible} onChange={(e) => setCommissionEligible(e.target.checked)} />Commission eligible</label>
          <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={isCustomizable} onChange={(e) => setIsCustomizable(e.target.checked)} />Tenants can customize</label>
        </div>
        <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Description</label><textarea style={{ ...inp(), height: 56, padding: 8 }} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>

      <EditableList label="Required resources" items={resources} onChange={setResources}
        render={(it, set) => (<>
          <input style={{ ...inp(), flex: 2 }} placeholder="Resource (e.g. Nail Tech)" value={it.label} onChange={(e) => set({ ...it, label: e.target.value })} />
          <input style={{ ...inp(), width: 70 }} placeholder="Qty" value={it.quantity} onChange={(e) => set({ ...it, quantity: e.target.value })} inputMode="numeric" />
        </>)} blank={{ label: '', quantity: '1' }} />

      <EditableList label="Optional add-ons" items={addons} onChange={setAddons}
        render={(it, set) => (<>
          <input style={{ ...inp(), flex: 2 }} placeholder="Add-on name" value={it.name} onChange={(e) => set({ ...it, name: e.target.value })} />
          <input style={{ ...inp(), width: 90 }} placeholder="$ price" value={it.price} onChange={(e) => set({ ...it, price: e.target.value })} inputMode="decimal" />
        </>)} blank={{ name: '', price: '0.00' }} />

      {editing && <div style={{ marginTop: 10 }}><label style={lbl}>Change note (recorded in version history)</label><input style={inp()} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="What changed?" /></div>}

      {err && <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 9, background: '#FBEAEA', color: '#9B2C2C', border: '1px solid #F0C9C9', fontSize: 12.5 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save Changes' : 'Create Template'}</button>
      </div>
    </Overlay>
  );
}

function EditableList<T>({ label, items, onChange, render, blank }: {
  label: string; items: T[]; onChange: (v: T[]) => void; render: (it: T, set: (v: T) => void) => ReactNode; blank: T;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <label style={lbl}>{label}</label>
      <div style={{ display: 'grid', gap: 6 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}
            <button className="btn ghost" style={{ height: 34, width: 34 }} onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn ghost" style={{ height: 30, justifySelf: 'start' }} onClick={() => onChange([...items, { ...blank }])}>+ Add</button>
      </div>
    </div>
  );
}

export function RetireModal({ template, onClose, onDone }: { template: { id: string; name: string; deploymentCount: number }; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const retire = async () => {
    if (!reason.trim()) { setErr('A retirement reason is required.'); return; }
    setBusy(true); setErr(null);
    try { await superAdminApi.catalogRetire(template.id, reason.trim()); onDone(); }
    catch (e: any) { setErr(e?.message || 'Retire failed'); }
    finally { setBusy(false); }
  };
  return (
    <Overlay title={`Retire — ${template.name}`} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>Retiring preserves version history and existing tenant deployments; it only prevents new deployments.{template.deploymentCount > 0 && ` This template is currently deployed to ${template.deploymentCount} tenant(s) — their copies are unaffected.`}</div>
      <label style={lbl}>Reason *</label>
      <textarea style={{ ...inp(), height: 64, padding: 8 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this template being retired?" />
      {err && <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 9, background: '#FBEAEA', color: '#9B2C2C', border: '1px solid #F0C9C9', fontSize: 12.5 }}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn" onClick={retire} disabled={busy}>{busy ? 'Retiring…' : 'Retire Template'}</button>
      </div>
    </Overlay>
  );
}
