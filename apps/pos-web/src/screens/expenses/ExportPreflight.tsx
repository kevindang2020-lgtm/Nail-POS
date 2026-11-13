// Accountant export preflight (Extras backlog · Receipt Expense OCR Accounting 09): before the file is made, the export's
// own rows (same period, branch scope and filters) are checked — duplicates, missing categories, missing receipts,
// unapproved records left out, and whether they reconcile to the counted total. Warnings never block: the owner decides.
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posExpensesApi } from '../../api/posExpensesApi';
import { FitDialog } from '../../components/FitKit';
import { useLoad, StateBlock, fmtYmdSafe } from '../../components/FinanceKit';
import { fmtNumber } from '../../i18n/format';
import { money } from '../reportsCommon';

/** extras Expenses 09: a column code of the export file, in the cashier's language (an unknown code shows as sent) */
const colLabel = (c: string) => { const k = 'finance.pf.col.' + c; const v = tx(k); return v === k ? c : v; };
type Q = { period: string; from?: string; to?: string; category?: string; paymentMethod?: string; q?: string };
export function ExportPreflightDialog({ format, query, busy, onConfirm, onClose }: { format: string; query: Q; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const { period, ...filters } = query;
  const d = useLoad(() => posExpensesApi.exportPreflight(period, filters), [JSON.stringify(query)]);
  const p = d.data;
  const row = (id: string, n: number, ok: string, warn: string) => <li key={id} className={n ? 'warn' : 'ok'} data-testid={'pf-' + id}>{n ? tx(warn, { n: fmtNumber(n) }) : tx(ok)}</li>;
  return (
    <FitDialog title={tx('finance.pf.title', { f: format.toUpperCase() })} onClose={onClose} busy={busy} testId="dlg-export-preflight"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" disabled={!p || busy} onClick={onConfirm} data-testid="pf-confirm">{busy ? tx('pos.loading') : tx('finance.pf.export')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !p ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <dl className="fk-dl">
          <dt>{tx('finance.pf.period')}</dt><dd>{fmtYmdSafe(p.period.from)} – {fmtYmdSafe(p.period.to)}</dd>
          <dt>{tx('finance.pf.scope')}</dt><dd data-testid="pf-scope">{p.branchScope === 'branch' ? (p.branchName ?? tx('finance.pf.oneBranch')) : tx('finance.pf.allBranches')}</dd>
          <dt>{tx('finance.pf.rows')}</dt><dd><b>{fmtNumber(p.rows)}</b> · {money(p.totalCents)}{p.filtered ? <span className="fk-li-s">{tx('finance.pf.filtered')}</span> : null}</dd>
        </dl>
        <ul className="fk-checks" data-testid="pf-checks">
          {row('dups', p.duplicates, 'finance.pf.noDups', 'finance.pf.dups')}
          {row('uncat', p.uncategorized, 'finance.pf.noUncat', 'finance.pf.uncat')}
          {row('receipts', p.missingReceipts, 'finance.pf.allReceipts', 'finance.pf.receipts')}
          {row('unapproved', p.unapprovedLeftOut, 'finance.pf.noUnapproved', 'finance.pf.unapproved')}
          <li className={p.reconciles === false ? 'bad' : p.reconciles ? 'ok' : ''} data-testid="pf-reconcile">{p.reconciles == null ? tx('finance.pf.reconNa') : p.reconciles ? tx('finance.pf.recon', { v: money(p.countedTotalCents) }) : tx('finance.pf.reconOff', { a: money(p.totalCents), b: money(p.countedTotalCents) })}</li>
        </ul>
        {p.columns && p.columns.length ? (
          <div data-testid="pf-columns" style={{ margin: '6px 0', fontSize: 12 }}>
            <b>{tx('finance.pf.columns', { n: fmtNumber(p.columns.length) })}</b>{' '}{p.columns.map((c) => colLabel(c)).join(' · ')}
            {p.formulaSafeColumns && p.formulaSafeColumns.length ? <div className="fk-li-s" data-testid="pf-formula-safe">{tx('finance.pf.formulaSafe', { cols: p.formulaSafeColumns.map((c) => colLabel(c)).join(', ') })}</div> : null}
            {p.customerContactColumns && p.customerContactColumns.length === 0 ? <div className="fk-li-s" data-testid="pf-no-contact">{tx('finance.pf.noContact')}</div> : null}
          </div>) : null}
        <div className="fk-hint">{tx('finance.pf.note')}</div>
      </>}
    </FitDialog>
  );
}
