// ImportProductsModal — stages a product import through the pipeline. Rows are parsed client-side from pasted CSV,
// then sent to the staging endpoint which validates them server-side BEFORE anything is written to the master
// catalog. The response reports valid/invalid counts; invalid rows land in the Import Error Queue. Honest: this
// stages and validates only — nothing is imported until the job is approved from the Import Queue.
import { useState } from 'react';
import { superAdminApi, type PcImportJob } from '../api/superAdminApi';

// Parse "name,category,sku,price" lines (an optional header row is skipped). Price is dollars → integer cents.
export function parseCsv(text: string): { name: string; categoryName: string; sku?: string; priceCents: number | null }[] {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  if (/name/i.test(lines[0]) && /categor/i.test(lines[0])) lines.shift();
  return lines.map((line) => {
    const [name = '', categoryName = '', sku = '', price = ''] = line.split(',').map((c) => c.trim());
    const cents = price ? Math.round(Number(price.replace(/[$,]/g, '')) * 100) : null;
    return { name, categoryName, sku: sku || undefined, priceCents: Number.isFinite(cents as number) ? cents : null };
  });
}

export function ImportProductsModal({ onClose, onStaged }: { onClose: () => void; onStaged: (job: PcImportJob, deduped: boolean) => void }) {
  const [filename, setFilename] = useState('');
  const [csv, setCsv] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const rows = parseCsv(csv);
    if (!rows.length) { setErrors(['Add at least one row (format: name, category, sku, price).']); return; }
    setBusy(true); setErrors([]);
    try {
      const res = await superAdminApi.createProductImport({ source: 'csv', filename: filename.trim() || 'pasted.csv', rows });
      if (!res.ok || !res.job) { setErrors(res.errors || ['Import could not be staged.']); setBusy(false); return; }
      onStaged(res.job, !!res.deduped);
    } catch (e: any) { setErrors([e?.message || 'Request failed.']); setBusy(false); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Import products" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '4vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(600px, 94vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Import Products</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Rows are validated server-side before anything is written. Invalid rows go to the Import Error Queue; nothing is imported until you approve the job in the Import Queue. Tenant/branch IDs inside files are ignored.</div>
        {errors.length ? <div className="state" style={{ color: 'var(--danger,#B85B4D)', marginBottom: 8 }}>{errors.map((e, i) => <div key={i}>• {e}</div>)}</div> : null}
        <label style={{ fontSize: 12, fontWeight: 600 }}>File name<input className="inp" style={{ display: 'block', width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, marginTop: 4 }} value={filename} onChange={(e) => setFilename(e.target.value)} placeholder="vendor_catalog.csv" /></label>
        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginTop: 10 }}>Rows (CSV: name, category, sku, price)
          <textarea className="inp" style={{ display: 'block', width: '100%', height: 120, padding: 8, border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, fontFamily: 'monospace', fontSize: 12 }} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'Cuticle Oil, Nail Care, CND-CO-15, 8.99\nGel Polish, Gel Polish, OPI-GP-RR, 14.99'} />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Staging…' : 'Stage & validate'}</button>
        </div>
      </div>
    </div>
  );
}
