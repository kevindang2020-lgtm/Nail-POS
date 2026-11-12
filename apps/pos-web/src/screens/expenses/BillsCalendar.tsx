// Bill due calendar (Extras backlog · Receipt Expense OCR Accounting 06): open and partly paid bills due in the next
// 7 / 30 / 90 days (overdue first), grouped by due day, each opening the bill's own detail where the permissioned Record
// payment action lives. Reminders are the existing once-a-day due-soon / overdue sweep; this view changes nothing.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posExpensesApi, type FinExpense } from '../../api/posExpensesApi';
import { FitDialog, Empty } from '../../components/FitKit';
import { useLoad, StateBlock, fmtYmdSafe } from '../../components/FinanceKit';
import { money } from '../reportsCommon';

export function groupBills(items: FinExpense[], today: string) {
  const out: { key: string; label: 'overdue' | 'today' | 'day'; day: string; rows: FinExpense[]; openCents: number }[] = [];
  for (const b of items) {
    const due = String(b.dueDate ?? ''); if (!due) continue;
    const key = due < today ? 'overdue' : due;
    let g = out.find((x) => x.key === key);
    if (!g) { g = { key, label: due < today ? 'overdue' : due === today ? 'today' : 'day', day: due, rows: [], openCents: 0 }; out.push(g); }
    g.rows.push(b); g.openCents += b.openCents;
  }
  return out;
}

export function BillsCalendar({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const [days, setDays] = useState(30);
  const d = useLoad(() => posExpensesApi.billsDue(days), [days]);
  const groups = d.data ? groupBills(d.data.items, d.data.today) : [];
  return (
    <FitDialog wide title={tx('finance.bills.calTitle')} subtitle={d.data ? tx('finance.bills.calSub', { to: fmtYmdSafe(d.data.until) }) : undefined} onClose={onClose} testId="dlg-bills-calendar"
      footer={<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button>}>
      <div className="fk-seg" role="tablist" aria-label={tx('finance.bills.window')}>
        {[7, 30, 90].map((n) => <button key={n} type="button" role="tab" aria-selected={days === n} className={days === n ? 'on' : ''} onClick={() => setDays(n)} data-testid={`bills-days-${n}`}>{tx('finance.bills.days', { n })}</button>)}
      </div>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : groups.length === 0 ? <Empty title={tx('finance.bills.none')} /> : <>
        {d.data.capped ? <div className="fk-hint" data-testid="bills-capped">{tx('finance.bills.capped')}</div> : null}
        <ol className="fk-list dense" data-testid="bills-days">{groups.map((g) => (
          <li key={g.key} className="fk-li" data-testid="bills-day">
            <b className={'fk-li-t' + (g.label === 'overdue' ? ' bad' : '')}>{g.label === 'overdue' ? tx('finance.bills.overdue') : g.label === 'today' ? tx('finance.bills.today') : fmtYmdSafe(g.day)}</b>
            <span className="fk-li-s">{tx('finance.bills.openSum', { v: money(g.openCents) })}</span>
            <ul className="fk-list dense">{g.rows.map((b) => (
              <li key={b.id}><button type="button" className="fk-li-t link" onClick={() => onOpen(b.id)} data-testid="bills-open">{b.vendorDisplay || b.vendor || '—'}{b.invoiceNumber ? ` · ${b.invoiceNumber}` : ''}</button>
                <span className="fk-li-s">{g.label === 'overdue' ? `${tx('pos.due')} ${fmtYmdSafe(b.dueDate)} · ` : ''}{money(b.openCents)}</span></li>))}</ul>
          </li>))}</ol>
      </>}
    </FitDialog>
  );
}
