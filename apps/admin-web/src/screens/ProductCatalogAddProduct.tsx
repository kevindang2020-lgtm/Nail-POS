// AddProductModal — master-product creation workflow for the Product Catalog. Client-side validation mirrors the
// server engine (name/category required, SKU format, UPC/EAN checksum, non-negative money); money is entered in
// dollars and converted to integer cents. On duplicate SKU/barcode candidates the server returns
// requiresConfirmation and the user must explicitly "Create anyway". A master product is a platform definition
// (created as draft) — it is not tenant inventory and does not create branch stock.
import { useState } from 'react';
import { superAdminApi, type PcCreateInput, type PcDuplicateCandidate } from '../api/superAdminApi';

// UPC-A(12)/EAN-13(13) check-digit validation — mirrors product-master-core.isValidUpc.
export function isValidUpc(raw: string): boolean {
  const d = (raw || '').trim();
  if (!/^\d{12}$|^\d{13}$/.test(d)) return false;
  const digits = d.split('').map(Number);
  const check = digits.pop() as number;
  const body = digits.reverse();
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += body[i] * (i % 2 === 0 ? 3 : 1);
  return ((10 - (sum % 10)) % 10) === check;
}

const dollarsToCents = (s: string): number | null => {
  const t = (s || '').trim();
  if (!t) return null;
  const n = Number(t.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

const fld: React.CSSProperties = { display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 };
const lab: React.CSSProperties = { fontSize: 12, fontWeight: 600 };

const CATEGORY_OPTS = ['Nail Care', 'Gel Polish', 'Acrylic', 'Tools', 'Skin Care', 'Waxing', 'Lashes', 'Facial', 'Retail', 'Consumables', 'Liquids', 'Other'];
const UNIT_OPTS = ['each', 'set', 'bottle', 'bag', 'box', 'pack', 'case'];

export function AddProductModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, id: string) => void }) {
  const [f, setF] = useState({ name: '', categoryName: '', brandName: '', sku: '', upc: '', barcode: '', code: '', vendorName: '', inventoryUnit: 'each', cost: '', retail: '', description: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<PcDuplicateCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const clientValidate = (): string[] => {
    const errs: string[] = [];
    if (!f.name.trim()) errs.push('Product name is required.');
    if (!f.categoryName.trim()) errs.push('Category is required.');
    if (f.sku.trim() && !/^[A-Za-z0-9][A-Za-z0-9._-]{1,49}$/.test(f.sku.trim())) errs.push('SKU must be alphanumeric with . _ - separators (2–50 chars).');
    if (f.upc.trim() && !isValidUpc(f.upc)) errs.push('UPC/EAN check digit is invalid.');
    const c = dollarsToCents(f.cost); if (Number.isNaN(c)) errs.push('Cost is not a valid amount.'); else if (c != null && c < 0) errs.push('Cost cannot be negative.');
    const r = dollarsToCents(f.retail); if (Number.isNaN(r)) errs.push('Suggested retail is not a valid amount.'); else if (r != null && r < 0) errs.push('Suggested retail cannot be negative.');
    return errs;
  };

  const submit = async (confirmDuplicates = false) => {
    const errs = clientValidate();
    if (errs.length) { setErrors(errs); setCandidates(null); return; }
    setBusy(true); setErrors([]);
    const body: PcCreateInput = {
      name: f.name.trim(), categoryName: f.categoryName.trim(),
      brandName: f.brandName.trim() || undefined, sku: f.sku.trim() || undefined, upc: f.upc.trim() || undefined,
      barcode: f.barcode.trim() || undefined, code: f.code.trim() || undefined, vendorName: f.vendorName.trim() || undefined,
      inventoryUnit: f.inventoryUnit, description: f.description.trim() || undefined,
      costCents: dollarsToCents(f.cost), suggestedRetailCents: dollarsToCents(f.retail),
      confirmDuplicates,
    };
    try {
      const res = await superAdminApi.createMasterProduct(body);
      if (res.ok) { onCreated(res.product.name, res.product.id); return; }
      if (res.requiresConfirmation && res.candidates?.length) { setCandidates(res.candidates); setBusy(false); return; }
      setErrors(res.errors || ['Could not create the product.']); setCandidates(null); setBusy(false);
    } catch (e: any) { setErrors([e?.message || 'Request failed.']); setBusy(false); }
  };

  const reasonLabel = (r: string) => r === 'exact_sku' ? 'same SKU' : r === 'exact_barcode' ? 'same barcode' : 'same brand + name';

  return (
    <div role="dialog" aria-modal="true" aria-label="Add master product" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '4vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(640px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Add Master Product</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Creates a platform master definition (as <b>draft</b>). This is not tenant inventory and creates no branch stock; tenants receive it only through an explicit, audited distribution.</div>

        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}

        {candidates ? (
          <div className="state" style={{ borderLeft: '4px solid var(--g7,#A96F22)', marginBottom: 8 }}>
            <b>Possible duplicates found.</b> Review before creating a separate record:
            <ul style={{ margin: '6px 0 6px 16px' }}>{candidates.map((c) => <li key={c.id + c.reason}>{c.name} — {reasonLabel(c.reason)} ({Math.round(c.confidence * 100)}%)</li>)}</ul>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost" onClick={() => setCandidates(null)}>Go back</button>
              <button className="btn" disabled={busy} onClick={() => submit(true)}>Create anyway</button>
            </div>
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={lab}>Product name *<input className="inp" style={fld} value={f.name} onChange={set('name')} /></label>
          <label style={lab}>Category *<select className="inp" style={fld} value={f.categoryName} onChange={set('categoryName')}><option value="">Select…</option>{CATEGORY_OPTS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label style={lab}>Brand<input className="inp" style={fld} value={f.brandName} onChange={set('brandName')} /></label>
          <label style={lab}>Product code<input className="inp" style={fld} value={f.code} onChange={set('code')} placeholder="unique, optional" /></label>
          <label style={lab}>SKU<input className="inp" style={fld} value={f.sku} onChange={set('sku')} placeholder="e.g. CND-CO-15" /></label>
          <label style={lab}>UPC / EAN<input className="inp" style={fld} value={f.upc} onChange={set('upc')} placeholder="12 or 13 digits" /></label>
          <label style={lab}>Barcode<input className="inp" style={fld} value={f.barcode} onChange={set('barcode')} /></label>
          <label style={lab}>Vendor<input className="inp" style={fld} value={f.vendorName} onChange={set('vendorName')} /></label>
          <label style={lab}>Cost ($)<input className="inp" style={fld} value={f.cost} onChange={set('cost')} inputMode="decimal" placeholder="0.00" /></label>
          <label style={lab}>Suggested retail ($)<input className="inp" style={fld} value={f.retail} onChange={set('retail')} inputMode="decimal" placeholder="0.00" /></label>
          <label style={lab}>Inventory unit<select className="inp" style={fld} value={f.inventoryUnit} onChange={set('inventoryUnit')}>{UNIT_OPTS.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
        </div>
        <label style={{ ...lab, display: 'block', marginTop: 10 }}>Description<textarea className="inp" style={{ ...fld, height: 56, paddingTop: 8 }} value={f.description} onChange={set('description')} /></label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !!candidates} onClick={() => submit(false)}>{busy ? 'Creating…' : 'Create master product'}</button>
        </div>
      </div>
    </div>
  );
}
