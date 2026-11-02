// TechnicianImportPanel.tsx — Technician Profile mandate §112 technician import (pos.technicians.import).
// A CSV (header: First Name, Last Name, Phone, Email, Role) pasted or chosen from a file → PREVIEW (nothing written:
// each row says create / invite an existing AIPowerSalon account / already here / invalid) → COMMIT. Every committed
// row goes through the same "Add Technician" path as a hand-typed hire (identity by phone/email ONLY — §113 never by
// name — invitation, employment, this branch, role). Rows are independent; the result table says exactly what happened.
import { useState } from 'react';
import { posTechniciansApi, type TechnicianImportResult, type TechnicianImportRow } from '../api/posTechniciansApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const OUTCOME: Record<TechnicianImportRow['outcome'], { label: string; tone: string }> = {
  will_create: { get label() { return tx('pos.will_create'); }, tone: '#2E7D32' }, will_invite_existing: { get label() { return tx('pos.will_invite_existing_account'); }, tone: '#B5821F' },
  already_here: { get label() { return tx('pos.already_at_this_salon'); }, tone: '#8A7A6D' }, created: { get label() { return tx('pos.created'); }, tone: '#2E7D32' },
  invited_existing: { get label() { return tx('pos.invited_existing_account'); }, tone: '#B5821F' }, refused: { get label() { return tx('pos.refused'); }, tone: '#C0392B' }, invalid: { get label() { return tx('pos.invalid_row'); }, tone: '#C0392B' },
};
const TEMPLATE = 'First Name,Last Name,Phone,Email,Role\nMia,Pham,856-555-0101,mia@example.com,Technician\n';

export function TechnicianImportPanel({ onImported, onClose }: { onImported?: () => void; onClose?: () => void }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<TechnicianImportResult | null>(null);
  const [result, setResult] = useState<TechnicianImportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? 'preview' : 'commit'); setError(null);
    try {
      const r = await posTechniciansApi.importTechnicians(csv, dryRun);
      if (dryRun) { setPreview(r); setResult(null); } else { setResult(r); setPreview(null); onImported?.(); }
    } catch (e: any) { setError(e?.message || tx('pos.import_failed')); } finally { setBusy(null); }
  };
  const onFile = (f: File | null) => { if (!f) return; f.text().then((t) => { setCsv(t); setPreview(null); setResult(null); }).catch(() => setError(tx('pos.could_not_read_that_file'))); };
  const creatable = preview ? (preview.counts.will_create ?? 0) + (preview.counts.will_invite_existing ?? 0) : 0;
  const rows = result ?? preview;

  return (
    <section className="panel" style={{ marginBottom: 12, display: 'grid', gap: 8 }} aria-label={tx('pos.import_technicians')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 13.5 }}>{tx('pos.import_technicians')}</div>
        <span className="muted" style={{ fontSize: 11.5 }}>{tx('pos.csv_with_first_name_last_name_xmbe')}</span>
        {onClose ? <button className="btn ghost" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={onClose}>{tx('pos.close')}</button> : null}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".csv,text/csv" aria-label={tx('pos.csv_file')} onChange={(e) => onFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} />
        <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => { setCsv(TEMPLATE); setPreview(null); setResult(null); }}>{tx('pos.paste_a_template')}</button>
      </div>
      <textarea aria-label={tx('pos.csv_text')} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); setResult(null); }} rows={5} placeholder={TEMPLATE} style={{ border: '1px solid #EFEAE1', borderRadius: 8, padding: 8, fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
      {error ? <div className="err">{error}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn ghost" disabled={!csv.trim() || busy != null} onClick={() => run(true)}>{busy === 'preview' ? tx('pos.checking') : tx('pos.preview')}</button>
        <button className="btn" disabled={!preview || creatable === 0 || busy != null} onClick={() => run(false)} title={!preview ? tx('pos.preview_first') : creatable === 0 ? tx('pos.nothing_to_add') : undefined}>{busy === 'commit' ? tx('pos.importing') : tx('pos.import_v0_technician_plural', { v0: String(creatable || ''), plural: String(creatable === 1 ? '' : 's') })}</button>
      </div>
      {rows ? (
        <div role="status" aria-label={result ? tx('pos.import_result') : tx('pos.import_preview')}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
            {result ? tx('pos.done_3') : tx('pos.preview_2')}
            {Object.entries(rows.counts).map(([k, n]) => `${OUTCOME[k as TechnicianImportRow['outcome']]?.label ?? k}: ${n}`).join(' · ')}
          </div>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>{tx('pos.line')}</th><th>{tx('pos.name')}</th><th>{tx('pos.outcome')}</th><th>{tx('pos.note')}</th></tr></thead>
            <tbody>{rows.results.map((r) => (
              <tr key={r.line}><td>{r.line}</td><td>{r.name || '—'}</td><td style={{ fontWeight: 700, color: OUTCOME[r.outcome]?.tone }}>{OUTCOME[r.outcome]?.label ?? r.outcome}{r.techCode ? ` · ${r.techCode}` : ''}</td><td className="muted">{r.message ?? ''}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
