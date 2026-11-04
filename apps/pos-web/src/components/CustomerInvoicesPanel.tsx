// CustomerInvoicesPanel — Invoices guide (Nov 4 2026) §14 "Customer Profiles integration": a customer's invoices and balance
// on their profile, read from the same server-paged /pos/invoices list and summary (filtered by this customer id — never by
// a name), newest first. A role without invoice access (pos.checkout.view) sees a plain note instead of an error. Each row
// opens the invoice on the Invoices screen with this customer's filter on.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posInvoicesApi } from '../api/posInvoicesApi';
import { fmtMoney } from '../i18n/format';
import { fmtYmdSafe } from './FinanceKit';
import { Pager } from './FitKit';

type Row = { id: string; invoiceNumber: string; displayStatus: string; issueDate: string | null; totalCents: number; balanceCents: number };
const TONE: Record<string, string> = { draft: 'mut', sent: 'info', overdue: 'bad', partially_paid: 'warn', paid: 'ok', credited: 'mut', void: 'mut' };

export function CustomerInvoicesPanel({ customerId, customerName }: { customerId: string; customerName: string }) {
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ items: Row[]; page: number; pageSize: number; total: number; pageCount: number } | null>(null);
  const [kpis, setKpis] = useState<{ outstandingCents: number; outstandingInvoices: number; overdueInvoices: number; total: number } | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'denied' | 'error'>('loading');
  const [tick, setTick] = useState(0);
  useEffect(() => { setPage(1); }, [customerId]);
  useEffect(() => {
    let alive = true; setState('loading');
    const q = { preset: 'all', customerId, sort: 'created_desc' };
    Promise.all([posInvoicesApi.list({ ...q, page, pageSize: 5 }), posInvoicesApi.summary(q)])
      .then(([l, s]: any[]) => { if (!alive) return; setList(l); setKpis(s?.kpis ?? null); setState('ok'); })
      .catch((e: any) => { if (alive) setState(e?.status === 403 ? 'denied' : 'error'); });
    return () => { alive = false; };
  }, [customerId, page, tick]);
  const open = (id?: string) => nav(`/tenant/payments/invoices?customerId=${encodeURIComponent(customerId)}&customerName=${encodeURIComponent(customerName)}${id ? `&invoiceId=${encodeURIComponent(id)}` : ''}`);
  return (
    <section className="panel cust-invoices" data-testid="customer-invoices" style={{ background: '#FFFFFF', padding: 32, borderRadius: 24, border: '1px solid #F1ECE4', boxShadow: '0 8px 24px rgba(0,0,0,0.02)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <div style={{ fontFamily: '"Playfair Display", serif', fontSize: 24, color: '#2C2A29' }}>{tx('finance.iv.profileTitle')}</div>
        {state === 'ok' && list && list.total > 0 ? <button type="button" className="fk-link" onClick={() => open()} data-testid="customer-invoices-all">{tx('finance.iv.profileAll')}</button> : null}
      </div>
      {state === 'loading' ? <div className="fk-loading">{tx('pos.loading')}</div>
        : state === 'denied' ? <div className="fk-hint">{tx('finance.iv.profileNoAccess')}</div>
        : state === 'error' ? <div className="fk-err" role="alert">{tx('finance.state.loadFailed')} <button type="button" className="fk-link" onClick={() => setTick((t) => t + 1)}>{tx('pos.retry')}</button></div>
        : !list || list.total === 0 ? <div style={{ color: '#A09388', padding: '12px 0', fontSize: 15 }}>{tx('finance.iv.profileNone')}</div> : <>
          {kpis ? <div className="fk-hint" data-testid="customer-invoices-balance" style={{ marginBottom: 12 }}>{tx('finance.iv.profileBalance', { b: fmtMoney(kpis.outstandingCents), n: String(kpis.outstandingInvoices) })}{kpis.overdueInvoices ? ` · ${tx('finance.iv.profileOverdue', { n: String(kpis.overdueInvoices) })}` : ''}</div> : null}
          <table className="fk-table"><thead><tr><th>{tx('finance.iv.col.number')}</th><th>{tx('finance.iv.col.issued')}</th><th>{tx('finance.status')}</th><th className="num">{tx('finance.iv.col.total')}</th><th className="num">{tx('finance.iv.balanceDue')}</th></tr></thead>
            <tbody>{list.items.map((r) => (
              <tr key={r.id}><td><button type="button" className="fk-link" onClick={() => open(r.id)} data-testid={`customer-invoice-${r.invoiceNumber}`}>{r.invoiceNumber}</button></td><td>{fmtYmdSafe(r.issueDate)}</td>
                <td><span className={'fk-chip ' + (TONE[r.displayStatus] ?? 'mut')}>{tx('finance.iv.status.' + r.displayStatus)}</span></td><td className="num">{fmtMoney(r.totalCents)}</td><td className="num">{r.displayStatus === 'void' ? '—' : fmtMoney(r.balanceCents)}</td></tr>
            ))}</tbody></table>
          {list.pageCount > 1 ? <Pager compact info={{ page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.pageCount }} onPage={setPage} /> : null}
        </>}
    </section>
  );
}
