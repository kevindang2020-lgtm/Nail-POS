// CompletedMergesDialog.tsx — extras Customer 08 (Nov 13 2026): the salon's completed customer merges with a SAFE undo. "Check
// undo" asks the server whether the merge can still be undone (read-only); "Undo merge" needs a reason and puts back exactly what
// the merge moved — the server refuses (CUSTOMER_UNMERGE_*) when anything changed since, and nothing is changed then. Only a user
// with the merge permission sees the undo controls; every undo is audited on the server.
import { useCallback, useEffect, useState } from 'react';
import type { CustomerMergeRecord, CustomerMergeRecordPage, CustomerUnmergeCheck } from '@aipowersalon/api-contracts/tenant';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posDuplicateReviewApi } from '../api/posDuplicateReviewApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtInZone } from '../i18n/format';
import { FitDialog, Pager, Empty, ErrorRetry } from './FitKit';
import { codeLabel } from './codeLabel';
import { useCan } from './usePermissions';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const nm = (p: { id: string; name: string | null }) => p.name || t('dup.um.unnamed');
const errOf = (e: any) => { const code = e?.body?.code ?? e?.code; return typeof code === 'string' && code.startsWith('CUSTOMER_UNMERGE_') ? codeLabel('dup.um.code', code) : errorTextOf(e, t('dup.um.failed')); };

export function CompletedMergesDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const can = useCan(); const canUndo = can('pos.customers.merge');
  const [page, setPage] = useState(1); const [data, setData] = useState<CustomerMergeRecordPage | null>(null); const [err, setErr] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, CustomerUnmergeCheck | 'loading'>>({});
  const [undoing, setUndoing] = useState<CustomerMergeRecord | null>(null); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null); const [undoErr, setUndoErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); posDuplicateReviewApi.merges({ page, pageSize: 10 }).then(setData).catch((e) => setErr(errOf(e))); }, [page]);
  useEffect(load, [load]);

  const check = (m: CustomerMergeRecord) => {
    setChecks((c) => ({ ...c, [m.id]: 'loading' }));
    posDuplicateReviewApi.unmergeCheck(m.id).then((r) => setChecks((c) => ({ ...c, [m.id]: r })), (e) => setChecks((c) => ({ ...c, [m.id]: { ok: false, code: null, message: errOf(e), details: {} } })));
  };
  async function undo() {
    if (!undoing) return;
    setBusy(true); setUndoErr(null);
    try {
      const r = await posDuplicateReviewApi.unmerge(undoing.id, reason.trim());
      setNotice(t('dup.um.done', { n: r.restoredCustomerIds.length, points: r.pointsRestored }));
      setUndoing(null); setReason(''); load(); onChanged?.();
    } catch (e) { setUndoErr(errOf(e)); }
    finally { setBusy(false); }
  }

  return (
    <FitDialog wide testId="dup-merges" title={t('dup.um.title')} subtitle={t('dup.um.sub')} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('dup.um.close')}</button>}>
      {notice ? <div className="state" role="status" data-testid="dup-um-notice">{notice}</div> : null}
      {err ? <ErrorRetry message={err} onRetry={load} /> : !data ? <div className="state">{t('dup.um.loading')}</div> : data.items.length === 0 ? <Empty title={t('dup.um.empty')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table">
          <thead><tr><th>{t('dup.um.col.when')}</th><th>{t('dup.um.col.kept')}</th><th>{t('dup.um.col.merged')}</th><th>{t('dup.um.col.by')}</th><th>{t('dup.um.col.status')}</th><th /></tr></thead>
          <tbody>{data.items.map((m) => {
            const c = checks[m.id];
            return (
              <tr key={m.id} data-testid={`dup-um-${m.id}`}>
                <td className="nowrap">{when(m.mergedAt)}</td><td>{nm(m.survivor)}</td><td>{m.sources.map(nm).join(', ')}</td><td>{m.mergedBy ?? '—'}</td>
                <td>{m.status === 'undone' ? <span data-testid="dup-um-undone">{t('dup.um.undone', { at: when(m.undoneAt), by: m.undoneBy ?? '—' })}{m.undoReason ? <div className="sub">{m.undoReason}</div> : null}</span> : t('dup.um.active')}
                  {c && c !== 'loading' ? <div className={c.ok ? 'sub' : 'err'} data-testid="dup-um-check">{c.ok ? t('dup.um.canUndo') : c.code ? codeLabel('dup.um.code', c.code) : c.message}</div> : null}</td>
                <td>{m.status === 'active' && canUndo ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn ghost sm" data-testid="dup-um-check-btn" disabled={c === 'loading'} onClick={() => check(m)}>{t('dup.um.check')}</button>
                  <button className="btn ghost sm" data-testid="dup-um-undo-btn" disabled={!!c && c !== 'loading' && !c.ok} onClick={() => { setUndoing(m); setReason(''); setUndoErr(null); }}>{t('dup.um.undo')}</button>
                </div> : null}</td>
              </tr>);
          })}</tbody></table></div>)}
      {data && data.totalPages > 1 ? <div className="rvw-pager"><Pager info={{ page: data.page, pageSize: data.pageSize, totalItems: data.total, totalPages: data.totalPages }} onPage={setPage} /></div> : null}
      {!canUndo ? <div className="sub" data-testid="dup-um-readonly">{t('dup.um.readOnly')}</div> : null}
      {undoing ? (
        <div className="rvw-confirm" data-testid="dup-um-confirm" style={{ marginTop: 12 }}>
          <strong>{t('dup.um.confirmTitle', { kept: nm(undoing.survivor), merged: undoing.sources.map(nm).join(', ') })}</strong>
          <div className="sub">{t('dup.um.confirmBody')}</div>
          <label className="rvw-f" style={{ display: 'block', marginTop: 6 }}><span>{t('dup.um.reason')}</span>
            <textarea data-testid="dup-um-reason" rows={2} maxLength={500} style={{ width: '100%' }} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          {undoErr ? <div className="err" role="alert" data-testid="dup-um-error">{undoErr}</div> : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button className="btn" data-testid="dup-um-go" disabled={busy || reason.trim().length < 3} onClick={() => void undo()}>{busy ? t('dup.um.working') : t('dup.um.go')}</button>
            <button className="btn ghost" onClick={() => setUndoing(null)}>{t('dup.um.cancel')}</button>
          </div>
        </div>) : null}
    </FitDialog>
  );
}
