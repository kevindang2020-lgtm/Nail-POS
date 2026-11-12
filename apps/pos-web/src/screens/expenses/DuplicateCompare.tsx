// DuplicateCompare — Extras (Receipt / Expense OCR Accounting 04): the duplicate resolution workspace. When an expense is
// flagged as a possible / exact duplicate, View expense shows it side by side with the expense the server matched it to
// (the server's own match list and reason — nothing is re-detected here): amount, date, vendor, invoice / receipt number,
// method, status, receipt attached. Fields that are the same are marked. Read-only: the decision (Not a duplicate /
// Duplicate, each with a reason) stays on the existing buttons, which record it in the expense's history and the audit log.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posExpensesApi, type FinDetail, type FinExpense } from '../../api/posExpensesApi';
import { useLoad, fmtYmdSafe } from '../../components/FinanceKit';
import { money } from '../reportsCommon';
import { serverText } from '../../i18n/server-text';

type Row = { key: string; label: string; a: string; b: string; same: boolean };
/** the server's match reasons (expense-duplicates.ts) in the POS language; an unknown reason is shown as the server sent it */
const REASON_KEY: Record<string, string> = {
  'The same receipt file was already uploaded.': 'finance.dup.r.file', 'Same vendor and invoice number.': 'finance.dup.r.invoice',
  'Same vendor, receipt number and total.': 'finance.dup.r.receipt', 'Same vendor, date and total.': 'finance.dup.r.sameDay',
  'Same vendor and total, one day apart.': 'finance.dup.r.oneDay', 'Same total and date, and the receipt photo looks the same.': 'finance.dup.r.photo',
};
const reasonText = (r: string) => (REASON_KEY[r.trim()] ? tx(REASON_KEY[r.trim()]) : serverText(r));
const norm = (v: string | null | undefined) => String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

/** the compared fields — exported for the test; '—' when a value is not recorded (never guessed) */
export function compareRows(a: FinExpense, b: FinExpense, methodLabel: (m: string | null) => string): Row[] {
  const v = (s: string | null | undefined) => (s && String(s).trim() ? String(s) : '—');
  const both = (x: string | null | undefined, y: string | null | undefined) => !!norm(x) && norm(x) === norm(y);
  return [
    { key: 'amount', label: tx('finance.ex.col.amount'), a: money(a.amountCents), b: money(b.amountCents), same: a.amountCents === b.amountCents },
    { key: 'date', label: tx('finance.ex.col.date'), a: fmtYmdSafe(a.incurredOn), b: fmtYmdSafe(b.incurredOn), same: a.incurredOn === b.incurredOn },
    { key: 'vendor', label: tx('finance.ex.col.vendor'), a: v(a.vendorDisplay || a.vendor), b: v(b.vendorDisplay || b.vendor), same: (!!a.vendorId && a.vendorId === b.vendorId) || both(a.vendorDisplay || a.vendor, b.vendorDisplay || b.vendor) },
    { key: 'invoice', label: tx('pos.invoice'), a: v(a.invoiceNumber), b: v(b.invoiceNumber), same: both(a.invoiceNumber, b.invoiceNumber) },
    { key: 'receiptNo', label: tx('finance.dup.receiptNo'), a: v(a.receiptNumber), b: v(b.receiptNumber), same: both(a.receiptNumber, b.receiptNumber) },
    { key: 'method', label: tx('finance.ex.col.method'), a: methodLabel(a.paymentMethod), b: methodLabel(b.paymentMethod), same: !!a.paymentMethod && a.paymentMethod === b.paymentMethod },
    { key: 'receipt', label: tx('finance.ex.col.receipt'), a: a.receiptDocumentId ? tx('finance.ex.receiptAttached') : tx('finance.ex.noReceipt'), b: b.receiptDocumentId ? tx('finance.ex.receiptAttached') : tx('finance.ex.noReceipt'), same: false },
    { key: 'notes', label: tx('finance.ex.notes'), a: v(a.description), b: v(b.description), same: both(a.description, b.description) },
  ];
}

export function DuplicateCompare({ self, matches, methodLabel, statusLabel }: {
  self: FinExpense; matches: FinDetail['duplicates']['matches']; methodLabel: (m: string | null) => string; statusLabel: (s: string) => string;
}) {
  const [pick, setPick] = useState(0);
  const m = matches[pick] ?? null;
  const d = useLoad<FinDetail | null>(() => (m ? posExpensesApi.detail(m.id) : Promise.resolve(null)), [m?.id]);
  if (!matches.length) return <div className="fk-hint" data-testid="dup-compare-none">{tx('finance.dup.noMatch')}</div>;
  const other = d.data?.expense ?? null;
  const rows = other ? compareRows(self, other, methodLabel) : [];
  return (
    <section data-testid="dup-compare">
      <h3 className="fk-sub">{tx('finance.dup.title')}</h3>
      {matches.length > 1 ? <div className="cg-acts wrap" role="group" aria-label={tx('finance.dup.title')}>
        {matches.map((x, i) => <button key={x.id} type="button" className={'fk-btn ghost' + (i === pick ? ' on' : '')} aria-pressed={i === pick} onClick={() => setPick(i)} data-testid={`dup-pick-${i}`}>{tx('finance.dup.match', { n: i + 1 })}</button>)}
      </div> : null}
      {m ? <div className="fk-hint" data-testid="dup-reason">{m.status === 'exact' ? tx('finance.dup.exact') : tx('finance.dup.possible')} · {reasonText(m.reason)}</div> : null}
      {d.error ? <div className="fk-err" role="alert" data-testid="dup-compare-error">{tx('finance.dup.loadFailed')}</div>
        : !other ? <div className="fk-loading">{tx('pos.loading')}</div>
        : <table className="fk-table" data-testid="dup-compare-table">
          <thead><tr><th scope="col">{tx('finance.dup.field')}</th><th scope="col">{tx('finance.dup.thisOne')}</th><th scope="col">{tx('finance.dup.savedOne')} · {statusLabel(other.status)}</th><th scope="col" /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key} data-testid={`dup-row-${r.key}`}>
            <th scope="row">{r.label}</th><td>{r.a}</td><td>{r.b}</td>
            <td>{r.same ? <span className="fk-chip bad" data-testid={`dup-same-${r.key}`}>{tx('finance.dup.same')}</span> : null}</td>
          </tr>)}</tbody>
        </table>}
      <div className="fk-hint">{tx('finance.dup.decideHint')}</div>
    </section>
  );
}
