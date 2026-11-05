// MasterRecordsModal — lists the platform MASTER product records (product_master) created via Add Product / Import,
// with their status, and supports controlled retirement (reason required). Retiring preserves the record and never
// touches tenant-owned products or branch inventory — it only prevents new optional distribution.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { superAdminApi, type PcMasterProduct } from '../api/superAdminApi';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const tone = (s: string) => (s === 'active' ? 'ok' : s === 'retired' || s === 'discontinued' || s === 'archived' ? 'mut' : 'warn');

export function MasterRecordsModal({ onClose, onChanged }: { onClose: () => void; onChanged: (msg: string) => void }) {
  const [rows, setRows] = useState<PcMasterProduct[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const { ask, askUi } = useInlineAsk();

  const load = useCallback(() => {
    setErr(null); setRows(null);
    superAdminApi.listMasterProducts({ status: status || undefined }).then(setRows).catch((e: any) => setErr(e?.message || 'Failed to load master records.'));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const retire = async (m: PcMasterProduct) => {
    ask(`Retire master product “${m.name}”?\nThis preserves the record and all tenant products; it only blocks new distribution.\nEnter a reason:`, (reason) => { void doRetire(m, reason); });
  };
  const doRetire = async (m: PcMasterProduct, reason: string) => {
    const res = await superAdminApi.retireMasterProduct(m.id, reason);
    if (!res.ok) { onChanged((res.errors || ['Retire failed.']).join(' ')); return; }
    onChanged(`Master product “${m.name}” retired. Existing tenant products remain available; new distribution is blocked.`);
    load();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Master product records" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 60, overflow: 'auto', padding: '4vh 0' }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(700px, 95vw)', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div className="phead">
          <h2>Master Product Records <span className="muted">({rows?.length ?? 0})</span></h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="inp" style={{ height: 30, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="">All Statuses</option>{['draft', 'active', 'pending_review', 'retired', 'discontinued', 'archived'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}
            </select>
            <button className="linkbtn" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Platform definitions created via Add Product / Import. Retirement is controlled and preserves tenant products, branch inventory, sales, and history.</div>

        {err ? <div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div>
          : rows === null ? <div className="state">Loading master records…</div>
          : rows.length === 0 ? <div className="state">No master records{status ? ` with status “${cap(status)}”` : ''} yet. Use <b>Add Product</b> to create one.</div>
          : (
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Product</th><th>Brand</th><th>SKU</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{rows.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>{m.name}</td><td className="muted">{m.brandName || '—'}</td><td className="muted">{m.sku || '—'}</td><td className="muted">{m.categoryName || '—'}</td>
                  <td><span className={'pill ' + tone(m.status)}>{cap(m.status)}</span></td>
                  <td>{(m.status === 'retired' || m.status === 'discontinued' || m.status === 'archived') ? <span className="muted">—</span> : <button className="linkbtn" onClick={() => retire(m)}>Retire</button>}</td>
                </tr>))}</tbody></table>
          )}
      </div>
      {askUi}
    </div>
  );
}
