// POSInvoicesScreen.tsx — Payments & Money → Invoices (/tenant/payments/invoices). Invoices mandate (Oct 29 2026): ONE
// full-screen page at 100 % zoom — header (New Invoice · Export) · four KPIs with their scope written on them · one universal
// search (invoice #, customer name, phone, email) · status / period (presets + Custom Range calendar + date basis) / amount /
// sort filters with active-filter chips · the invoice table (numbered server pages, newest created first) that fills the rest.
// Root causes fixed: "Invalid Date" (the API sent a Date string; dates are now 'YYYY-MM-DD' and formatted by one helper that
// shows "Not set"), the "—" customer (the form never linked one; a customer of this salon is now required, the bill-to
// snapshot kept, an unlinked invoice says so and a manager can link it), "Mark Paid" (a status toggle — now Record Payment:
// an immutable entry ≤ balance, partial → Partially Paid → Paid), void (now a reason, refused once money was received).
// Customer-facing invoices (the PDF) are English only. No print dialog: Print opens the PDF in the browser's viewer.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posInvoicesApi as api } from '../api/posInvoicesApi';
import { useCan } from '../components/usePermissions';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced, requestId } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, fmtYmdSafe, DateField, centsFromText, textFromCents, type PeriodState } from '../components/FinanceKit';
import { financeDownload as download } from './POSSettlementsScreen';
import { deviceToday } from '../lib/deviceToday';

type DisplayStatus = 'draft' | 'sent' | 'overdue' | 'partially_paid' | 'paid' | 'credited' | 'void';
type Customer = { id: string | null; state: 'linked' | 'archived' | 'missing' | 'snapshot_only' | 'unlinked'; name: string | null; profileName: string | null; phone: string | null; email: string | null };
type Row = { id: string; invoiceNumber: string; status: string; displayStatus: DisplayStatus; issueDate: string | null; dueDate: string | null; createdAt: string | null; sentAt: string | null; paidAt: string | null; voidedAt: string | null; voidReason: string | null;
  subtotalCents: number; discountCents: number; taxCents: number; totalCents: number; paidCents: number; balanceCents: number; payments: number; customer: Customer; notes: string | null;
  creditedCents?: number; refundedCents?: number; credits?: number;
  actions: { edit: boolean; send: boolean; recordPayment: boolean; void: boolean; linkCustomer: boolean; credit?: boolean } };
type Detail = { invoice: Row; lines: Array<{ id: string; description: string; quantity: number; unitPriceCents: number; lineTotalCents: number }>; payments: Array<{ id: string; amountCents: number; paidOn: string | null; method: string; reference: string | null; note: string | null; createdAt: string | null; recordedBy: string | null }>;
  credits?: Array<{ id: string; creditNumber: string; creditCents: number; refundCents: number; refundMethod: string | null; refundReference: string | null; reason: string; issuedOn: string | null; issuedBy: string | null }>;
  delivery: { note: string }; permissions: { recordPayment: boolean; send: boolean; manage: boolean } };
const money = (c: number | null | undefined) => fmtMoney(c ?? 0);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const lbl = (k: string, fb: string) => codeLabel(k, fb);
const TONE: Record<string, string> = { draft: 'mut', sent: 'info', overdue: 'bad', partially_paid: 'warn', paid: 'ok', credited: 'mut', void: 'mut' };
const STATUSES: DisplayStatus[] = ['draft', 'sent', 'overdue', 'partially_paid', 'paid', 'credited', 'void'];
const SORTS = ['created_desc', 'created_asc', 'issue_desc', 'issue_asc', 'due_asc', 'due_desc', 'amount_desc', 'amount_asc', 'customer_asc'];
const METHODS = ['cash', 'check', 'card_external', 'bank_transfer', 'other'];
const errMsg = (e: unknown) => (e as Error)?.message || tx('finance.state.loadFailed');
const errDetails = (e: any): Record<string, any> => e?.details?.error?.details ?? e?.details?.details ?? e?.details ?? {};
const customerText = (c: Customer) => (c.name ? c.name : c.state === 'missing' ? tx('finance.iv.customerMissing') : tx('finance.iv.unlinked'));

export function POSInvoicesScreen() {
  const can = useCan();
  const nav = useNavigate();
  // Invoices guide (Nov 4 2026) §07 "Customer" filter + §14 Customer Profiles: ?customerId=&customerName= arrives from a profile;
  // ?invoiceId= opens that invoice
  const [params] = useSearchParams();
  const [cust, setCust] = useState<{ id: string; name: string } | null>(() => { const id = params.get('customerId'); return id ? { id, name: params.get('customerName') || '' } : null; });
  const [custPick, setCustPick] = useState(false);
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState<PeriodState>({ preset: 'all' });
  const [basis, setBasis] = useState('issued');
  const [amin, setAmin] = useState(''); const [amax, setAmax] = useState('');
  const [sort, setSort] = useState('created_desc');
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string; actions?: { label: string; run: () => void }[] } | null>(null);
  const [dlg, setDlg] = useState<null | { kind: 'detail'; id: string } | { kind: 'new'; edit?: Detail } | { kind: 'pay'; d: Detail } | { kind: 'void'; d: Detail } | { kind: 'credit'; d: Detail } | { kind: 'link'; d: Detail } | { kind: 'preview'; id: string; number: string }>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => { const iid = params.get('invoiceId'); if (iid) setDlg({ kind: 'detail', id: iid }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const fit = useFitRows<HTMLDivElement>(45, { min: 3, max: 16, reserve: 34 });
  const amountMin = centsFromText(amin), amountMax = centsFromText(amax);
  const amountBad = (!!amin && amountMin == null) || (!!amax && amountMax == null) || (amountMin != null && amountMax != null && amountMin > amountMax);
  const scope = { ...periodQuery(period), dateField: basis, search: q || undefined, customerId: cust?.id, amountMin: amountBad ? undefined : amountMin ?? undefined, amountMax: amountBad ? undefined : amountMax ?? undefined };
  const key = JSON.stringify([scope, status, sort]);
  const firstRun = useRef(true);
  useEffect(() => { if (firstRun.current) { firstRun.current = false; return; } setPage(1); }, [key]);
  const summary = useLoad(() => api.summary(scope), [JSON.stringify(scope), tick]);
  // each answer carries the reload it answers, so a save is judged only against a list read after it
  const list = useLoad(() => api.list({ ...scope, status: status || undefined, sort, page, pageSize: fit.rows }).then((d: any) => ({ ...d, forTick: tick })), [key, page, fit.rows, tick]);
  useEffect(() => { if (list.data && list.data.page !== page) setPage(list.data.page); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const perms = summary.data?.permissions ?? { create: can('checkout.process_payment'), recordPayment: can('checkout.process_payment'), manage: can('checkout.manage_overrides') };
  const k = summary.data?.kpis;
  const chips: Array<{ k: string; label: string; clear: () => void }> = [];
  if (cust) chips.push({ k: 'c', label: `${tx('finance.iv.customerChip')}: ${cust.name || '—'}`, clear: () => setCust(null) });
  if (q) chips.push({ k: 'q', label: `“${q}”`, clear: () => setSearch('') });
  if (status) chips.push({ k: 's', label: lbl('finance.iv.status.' + status, status), clear: () => setStatus('') });
  if (period.preset !== 'all') chips.push({ k: 'p', label: `${tx('finance.basisIv.' + basis)}: ${period.preset === 'custom' ? `${fmtYmdSafe(period.from)} – ${fmtYmdSafe(period.to)}` : tx('finance.period.' + period.preset)}`, clear: () => setPeriod({ preset: 'all' }) });
  if (amountMin != null || amountMax != null) chips.push({ k: 'a', label: `${amountMin != null ? money(amountMin) : '…'} – ${amountMax != null ? money(amountMax) : '…'}`, clear: () => { setAmin(''); setAmax(''); } });
  const clearAll = () => { setCust(null); setSearch(''); setStatus(''); setPeriod({ preset: 'all' }); setBasis('issued'); setAmin(''); setAmax(''); setSort('created_desc'); };
  const rows: Row[] = list.data?.items ?? [];
  const info = list.data ? { page: list.data.page, pageSize: list.data.pageSize, totalItems: list.data.total, totalPages: list.data.pageCount } : null;
  const scopeLabel = summary.data ? (summary.data.period?.from ? `${tx('finance.basisIv.' + summary.data.dateBasis)} · ${fmtYmdSafe(summary.data.period.from)} – ${fmtYmdSafe(summary.data.period.to)}` : tx('finance.iv.scopeAll')) + (summary.data.scope === 'period_and_filters' ? ' · ' + tx('finance.iv.scopeFiltered') : '') : '';
  // Invoices guide audit (Nov 4 2026): whether a saved invoice is in view is decided by the list the SERVER returns after the save —
  // the guess said "hidden by your filters" for any period but All time, even This Month with today's invoice in it
  const pendingSave = useRef<{ id: string; number: string; verb: string; after: number } | null>(null);
  const afterSave = (d: Detail, verb: string) => {
    setDlg({ kind: 'detail', id: d.invoice.id });
    pendingSave.current = { id: d.invoice.id, number: d.invoice.invoiceNumber, verb, after: tick + 1 };
    if (sort === 'created_desc') setPage(1);
    setTick((t) => t + 1);
  };
  useEffect(() => {
    const p = pendingSave.current; const data: any = list.data;
    if (!p || !data || list.loading || (data.forTick ?? 0) < p.after) return;
    pendingSave.current = null;
    if ((data.items ?? []).some((x: Row) => x.id === p.id)) { setHighlight(p.id); setTimeout(() => setHighlight(null), 4000); setNote({ tone: 'ok', text: tx(p.verb, { n: p.number }) }); }
    else setNote({ tone: 'ok', text: tx(p.verb, { n: p.number }) + ' ' + tx('finance.iv.outsideFilters'), actions: [{ label: tx('finance.iv.viewInvoice'), run: () => setDlg({ kind: 'detail', id: p.id }) }, { label: tx('finance.clearFilters'), run: clearAll }] });
  }, [list.data, list.loading]);   // eslint-disable-line react-hooks/exhaustive-deps
  const exportCsv = async () => { try { download('invoices.csv', await api.exportCsv({ ...scope, status: status || undefined, sort }), 'text/csv;charset=utf-8'); setNote({ tone: 'ok', text: tx('finance.exported') }); } catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } };

  return (
    <div className="work fit iv" data-testid="invoices-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.invoices')}</h1><div className="sub">{tx('finance.iv.subtitle')}</div></div>
        <div className="fk-head-actions">
          {perms.manage ? <button type="button" className="fk-btn" onClick={exportCsv} data-testid="export">{tx('finance.exportCsv')}</button> : null}
          {perms.create ? <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'new' })} data-testid="new-invoice">+ {tx('finance.iv.new')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><span className="fn-note-acts">{note.actions?.map((a) => <button key={a.label} type="button" className="fk-link" onClick={() => { a.run(); setNote(null); }}>{a.label}</button>)}<button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></span></div> : null}

      <div className="fk-kpis" data-testid="kpis">
        {summary.error ? <StateBlock error={summary.error} onRetry={summary.reload} /> : <>
          <KpiCard testId="kpi-outstanding" label={tx('finance.iv.kpi.outstanding')} tone="gold" loading={!k} value={k ? money(k.outstandingCents) : ''} sub={k ? tx('finance.iv.kpi.outstandingSub', { n: fmtNumber(k.outstandingInvoices), o: fmtNumber(k.overdueInvoices) }) : ''} onClick={() => setStatus(k && k.overdueInvoices > 0 ? 'overdue' : 'sent')} />
          <KpiCard testId="kpi-paid" label={tx('finance.iv.kpi.paid')} tone="ok" loading={!k} value={k ? money(k.cashCollectedCents) : ''} sub={k ? tx('finance.iv.kpi.paidSub', { n: fmtNumber(k.paidInvoices), p: fmtNumber(k.partiallyPaidInvoices) }) : ''} onClick={() => setStatus('paid')} />
          <KpiCard testId="kpi-drafts" label={tx('finance.iv.kpi.drafts')} loading={!k} value={k ? fmtNumber(k.drafts) : ''} sub={k ? tx('finance.iv.kpi.draftsSub', { a: money(k.draftCents) }) : ''} onClick={() => setStatus('draft')} />
          <KpiCard testId="kpi-total" label={tx('finance.iv.kpi.total')} loading={!k} value={k ? fmtNumber(k.total) : ''} sub={k ? tx('finance.iv.kpi.totalSub', { v: fmtNumber(k.voided) }) : ''} onClick={() => setStatus('')} />
        </>}
      </div>
      <div className="fn-scope" data-testid="kpi-scope">{tx('finance.iv.kpiScope')}: {scopeLabel}</div>

      <div className="fn-toolbar iv-toolbar" role="toolbar" aria-label={tx('finance.filters')}>
        <div className="fn-search wide">
          <input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && rows[0] && q) setDlg({ kind: 'detail', id: rows[0].id }); }}
            placeholder={tx('finance.iv.searchPh')} aria-label={tx('finance.iv.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}
        </div>
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="status">
          <option value="">{tx('finance.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{tx('finance.iv.status.' + s)}</option>)}</select>
        <PeriodBar value={period} onChange={setPeriod} server={summary.data?.period ?? list.data?.period} allowAll compact basis={basis} onBasis={setBasis}
          basisOptions={['issued', 'due', 'created', 'paid'].map((b) => ({ value: b, label: tx('finance.basisIv.' + b) }))} />
        <span className="fn-amount"><input className="fk-search xs" inputMode="decimal" value={amin} onChange={(e) => setAmin(e.target.value)} placeholder={tx('finance.iv.min')} aria-label={tx('finance.iv.minAmount')} data-testid="amount-min" />
          –<input className="fk-search xs" inputMode="decimal" value={amax} onChange={(e) => setAmax(e.target.value)} placeholder={tx('finance.iv.max')} aria-label={tx('finance.iv.maxAmount')} data-testid="amount-max" /></span>
        <span className="fn-cust">{custPick ? <CustomerFilter onPick={(c) => { setCust(c); setCustPick(false); }} onCancel={() => setCustPick(false)} />
          : <button type="button" className="fk-btn ghost sm" onClick={() => setCustPick(true)} data-testid="customer-filter">{cust ? cust.name || tx('finance.iv.customerChip') : tx('finance.iv.anyCustomer')}</button>}</span>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')} data-testid="sort">{SORTS.map((s) => <option key={s} value={s}>{tx('finance.ivSort.' + s)}</option>)}</select>
        {amountBad ? <span className="fk-err fn-inline-err" role="alert">{tx('finance.iv.amountRangeBad')}</span> : null}
      </div>

      <FitPanel testId="invoices" bodyRef={fit.ref} className="fn-records"
        title={<span className="fn-chips">{tx('finance.iv.list')}{list.data ? <span className="fk-muted"> · {fmtNumber(list.data.total)}</span> : null}
          {chips.map((c) => <span key={c.k} className="fk-chip mut">{c.label}<button type="button" className="fk-chip-x" aria-label={tx('finance.removeFilter', { f: c.label })} onClick={c.clear}>✕</button></span>)}
          {chips.length ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-filters">{tx('finance.clearFilters')}</button> : null}</span>}
        footer={<Pager info={info} onPage={setPage} label={tx('finance.iv.list')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} />
          : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : rows.length === 0 ? (chips.length ? <Empty title={tx('finance.iv.noMatches')}><button type="button" className="fk-btn" onClick={() => setSearch('')}>{tx('finance.clearSearch')}</button><button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button></Empty>
            : <Empty title={tx('finance.iv.none')}>{perms.create ? <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'new' })}>+ {tx('finance.iv.new')}</button> : null}</Empty>)
          : <table className="fk-table fn-table iv-table" data-testid="invoices-table">
            <thead><tr><th>{tx('finance.iv.col.number')}</th><th>{tx('finance.iv.col.customer')}</th><th>{tx('finance.iv.col.issued')}</th><th>{tx('finance.iv.col.due')}</th><th>{tx('finance.status')}</th><th className="num">{tx('finance.iv.col.total')}</th><th className="num">{tx('finance.iv.col.balance')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={highlight === r.id ? 'fn-new' : ''} data-testid="invoice-row">
                <td className="fn-id"><button type="button" className="fk-li-t link" onClick={() => setDlg({ kind: 'detail', id: r.id })}>{r.invoiceNumber}</button></td>
                <td className="iv-cust"><span className={r.customer.name ? '' : 'fk-muted'}>{customerText(r.customer)}</span>{r.customer.phone ? <span className="fk-li-s">{r.customer.phone}</span> : null}</td>
                <td>{fmtYmdSafe(r.issueDate)}</td>
                <td>{fmtYmdSafe(r.dueDate)}</td>
                <td><span className={'fk-chip ' + (TONE[r.displayStatus] ?? 'mut')}>{lbl('finance.iv.status.' + r.displayStatus, r.displayStatus)}</span></td>
                <td className="num">{money(r.totalCents)}</td>
                <td className="num"><b>{r.displayStatus === 'void' ? '—' : money(r.balanceCents)}</b></td>
                <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => setDlg({ kind: 'detail', id: r.id })}>{tx('finance.view')}</button>
                  {r.actions.recordPayment && perms.recordPayment ? <button type="button" className="fk-btn ghost sm t-opt" onClick={async () => { try { setDlg({ kind: 'pay', d: await api.detail(r.id) }); } catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } }} data-testid="row-pay">{tx('finance.iv.recordPayment')}</button> : null}</td>
              </tr>))}</tbody>
          </table>}
      </FitPanel>

      {dlg?.kind === 'detail' ? <InvoiceDetail id={dlg.id} onClose={() => setDlg(null)} onAction={(a, d) => setDlg(a === 'preview' ? { kind: 'preview', id: d.invoice.id, number: d.invoice.invoiceNumber } : a === 'edit' ? { kind: 'new', edit: d } : { kind: a, d })}
        onChanged={(t) => { setTick((x) => x + 1); setNote({ tone: 'ok', text: t }); }} onError={(t) => setNote({ tone: 'bad', text: t })} onProfile={(cid) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(cid)}`)} /> : null}
      {dlg?.kind === 'new' ? <InvoiceForm edit={dlg.edit} today={summary.data?.period?.today ?? deviceToday()} onClose={() => setDlg(dlg.edit ? { kind: 'detail', id: dlg.edit.invoice.id } : null)}
        onSaved={(d, sent, preview) => { if (preview) { setTick((t) => t + 1); setDlg({ kind: 'preview', id: d.invoice.id, number: d.invoice.invoiceNumber }); } else afterSave(d, dlg.edit ? 'finance.iv.saved' : sent ? 'finance.iv.createdSent' : 'finance.iv.createdDraft'); }} /> : null}
      {dlg?.kind === 'pay' ? <PaymentDialog d={dlg.d} today={summary.data?.period?.today ?? deviceToday()} onClose={() => setDlg({ kind: 'detail', id: dlg.d.invoice.id })} onDone={(d, cents) => { setTick((t) => t + 1); setDlg({ kind: 'detail', id: d.invoice.id }); setNote({ tone: 'ok', text: tx(d.invoice.status === 'paid' ? 'finance.iv.paidInFull' : 'finance.iv.paymentRecorded', { a: money(cents), n: d.invoice.invoiceNumber, b: money(d.invoice.balanceCents) }) }); }} /> : null}
      {dlg?.kind === 'void' ? <VoidDialog d={dlg.d} onClose={() => setDlg({ kind: 'detail', id: dlg.d.invoice.id })} onDone={(d) => { setTick((t) => t + 1); setDlg({ kind: 'detail', id: d.invoice.id }); setNote({ tone: 'ok', text: tx('finance.iv.voided', { n: d.invoice.invoiceNumber }) }); }} /> : null}
      {dlg?.kind === 'credit' ? <CreditDialog d={dlg.d} onClose={() => setDlg({ kind: 'detail', id: dlg.d.invoice.id })} onDone={(d, num, refund) => { setTick((t) => t + 1); setDlg({ kind: 'detail', id: d.invoice.id }); setNote({ tone: 'ok', text: tx(refund ? 'finance.iv.creditIssuedRefund' : 'finance.iv.creditIssued', { c: num, n: d.invoice.invoiceNumber, r: money(refund), b: money(d.invoice.balanceCents) }) }); }} /> : null}
      {dlg?.kind === 'link' ? <LinkCustomerDialog d={dlg.d} onClose={() => setDlg({ kind: 'detail', id: dlg.d.invoice.id })} onDone={(d) => { setTick((t) => t + 1); setDlg({ kind: 'detail', id: d.invoice.id }); setNote({ tone: 'ok', text: tx('finance.iv.linked', { n: d.invoice.invoiceNumber }) }); }} /> : null}
      {dlg?.kind === 'preview' ? <PdfPreview id={dlg.id} number={dlg.number} onClose={() => setDlg({ kind: 'detail', id: dlg.id })} /> : null}
    </div>
  );
}

function CustomerFilter({ onPick, onCancel }: { onPick: (c: { id: string; name: string }) => void; onCancel: () => void }) {
  const [find, setFind] = useState(''); const fq = useDebounced(find.trim(), 250);
  const found = useLoad(() => (fq.length >= 2 ? api.lookupCustomers(fq) : Promise.resolve({ items: [] })), [fq]);
  return (
    <span className="fn-cust-pick" onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <input className="fk-search" type="search" autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder={tx('finance.iv.findCustomer')} aria-label={tx('finance.iv.findCustomer')} data-testid="customer-filter-find" />
      <button type="button" className="fk-x" aria-label={tx('pos.cancel')} onClick={onCancel}>✕</button>
      {fq.length >= 2 && found.data?.items?.length ? <ul className="fk-pick fn-cust-list">{found.data.items.map((c: any) => <li key={c.id}><button type="button" onClick={() => onPick({ id: c.id, name: c.name })} data-testid="customer-filter-option"><b>{c.name}</b><span>{c.phone ?? '—'} · {tx('finance.iv.invoicesN', { n: fmtNumber(c.invoices) })}</span></button></li>)}</ul>
        : fq.length >= 2 && found.data ? <span className="fk-hint">{tx('finance.iv.noCustomerFound')}</span> : null}
    </span>
  );
}

function InvoiceDetail({ id, onClose, onAction, onChanged, onError, onProfile }: { id: string; onClose: () => void; onAction: (a: 'pay' | 'void' | 'link' | 'edit' | 'preview' | 'credit', d: Detail) => void; onChanged: (t: string) => void; onError: (t: string) => void; onProfile: (customerId: string) => void }) {
  const d = useLoad<Detail>(() => api.detail(id), [id]);
  const [busy, setBusy] = useState(false);
  const inv = d.data?.invoice; const p = d.data?.permissions;
  const pdf = async (disp: 'inline' | 'attachment') => {
    setBusy(true);
    try {
      const blob = await api.pdf(id, disp);
      if (disp === 'attachment') download(`${inv?.invoiceNumber ?? 'invoice'}.pdf`, blob, 'application/pdf');
      else { const url = URL.createObjectURL(blob); const w = window.open(url, '_blank', 'noopener'); if (!w) onError(tx('finance.iv.popupBlocked')); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  };
  const send = async () => { setBusy(true); try { await api.send(id); d.reload(); onChanged(tx('finance.iv.sentNote', { n: inv?.invoiceNumber ?? '' })); } catch (e) { onError(errMsg(e)); } finally { setBusy(false); } };
  return (
    <FitDialog wide title={inv ? tx('finance.iv.detailTitle', { n: inv.invoiceNumber }) : tx('finance.iv.detail')} subtitle={inv ? `${customerText(inv.customer)} · ${tx('finance.iv.col.issued')} ${fmtYmdSafe(inv.issueDate)} · ${tx('finance.iv.col.due')} ${fmtYmdSafe(inv.dueDate)}` : undefined} onClose={onClose} busy={busy} testId="invoice-detail"
      footer={inv && p ? <>
        {inv.actions.edit && p.manage ? <button type="button" className="fk-btn" onClick={() => onAction('edit', d.data!)} data-testid="edit">{tx('finance.iv.edit')}</button> : null}
        <button type="button" className="fk-btn" disabled={busy} onClick={() => onAction('preview', d.data!)} data-testid="preview">{tx('finance.iv.preview')}</button>
        <button type="button" className="fk-btn" disabled={busy} onClick={() => pdf('inline')} data-testid="print">{tx('finance.iv.print')}</button>
        <button type="button" className="fk-btn" disabled={busy} onClick={() => pdf('attachment')} data-testid="download-pdf">{tx('finance.iv.pdf')}</button>
        {inv.actions.send && p.send ? <button type="button" className="fk-btn" disabled={busy} onClick={send} data-testid="send">{tx('finance.iv.send')}</button> : null}
        {inv.actions.linkCustomer && p.manage ? <button type="button" className="fk-btn" onClick={() => onAction('link', d.data!)} data-testid="link-customer">{tx('finance.iv.linkCustomer')}</button> : null}
        {inv.actions.credit && p.manage ? <button type="button" className="fk-btn" onClick={() => onAction('credit', d.data!)} data-testid="credit">{tx('finance.iv.credit')}</button> : null}
        {inv.actions.void && p.manage ? <button type="button" className="fk-btn danger" onClick={() => onAction('void', d.data!)} data-testid="void">{tx('finance.iv.void')}</button> : null}
        {inv.actions.recordPayment && p.recordPayment ? <button type="button" className="fk-btn primary" onClick={() => onAction('pay', d.data!)} data-testid="record-payment">{tx('finance.iv.recordPayment')}</button> : null}
        <button type="button" className="fk-btn" onClick={onClose}>{tx('finance.iv.back')}</button></> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !inv ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fn-statusline"><span className={'fk-chip ' + (TONE[inv.displayStatus] ?? 'mut')}>{lbl('finance.iv.status.' + inv.displayStatus, inv.displayStatus)}</span>
          {inv.sentAt ? <span className="fk-hint">{tx('finance.iv.issuedAt', { w: when(inv.sentAt) })}</span> : null}
          {inv.displayStatus === 'void' && inv.voidReason ? <span className="fk-hint">{tx('finance.iv.voidReasonShown', { r: inv.voidReason })}</span> : null}</div>
        <div className="fn-cols2">
          <dl className="fk-dl">
            <dt>{tx('finance.iv.billTo')}</dt><dd>{inv.customer.name ?? <span className="fk-muted">{customerText(inv.customer)}</span>}{inv.customer.id ? <> · <button type="button" className="fk-link" onClick={() => onProfile(inv.customer.id!)} data-testid="open-profile">{tx('finance.openCustomer')}</button></> : null}</dd>
            {inv.customer.profileName && inv.customer.profileName !== inv.customer.name ? <><dt>{tx('finance.iv.profileNow')}</dt><dd>{inv.customer.profileName}</dd></> : null}
            <dt>{tx('finance.iv.phone')}</dt><dd>{inv.customer.phone ?? '—'}</dd>
            <dt>{tx('finance.iv.email')}</dt><dd>{inv.customer.email ?? '—'}</dd>
            <dt>{tx('finance.iv.col.issued')}</dt><dd>{fmtYmdSafe(inv.issueDate)}</dd>
            <dt>{tx('finance.iv.col.due')}</dt><dd>{fmtYmdSafe(inv.dueDate)}</dd>
            {inv.customer.state === 'unlinked' || inv.customer.state === 'missing' ? <><dt /><dd className="fk-hint">{tx('finance.iv.unlinkedHelp')}</dd></> : null}
          </dl>
          <table className="fk-table fn-amounts"><tbody>
            <tr><td>{tx('finance.iv.subtotal')}</td><td className="num">{money(inv.subtotalCents)}</td></tr>
            {inv.discountCents ? <tr><td>{tx('finance.iv.discount')}</td><td className="num">− {money(inv.discountCents)}</td></tr> : null}
            {inv.taxCents ? <tr><td>{tx('finance.iv.tax')}</td><td className="num">{money(inv.taxCents)}</td></tr> : null}
            <tr className="strong"><td>{tx('finance.iv.col.total')}</td><td className="num">{money(inv.totalCents)}</td></tr>
            {inv.creditedCents ? <tr><td>{tx('finance.iv.creditNotes')}</td><td className="num" data-testid="credited">− {money(inv.creditedCents)}</td></tr> : null}
            <tr><td>{tx('finance.iv.paidSoFar')}</td><td className="num">− {money(inv.paidCents)}</td></tr>
            {inv.refundedCents ? <tr><td>{tx('finance.iv.refunded')}</td><td className="num" data-testid="refunded">{money(inv.refundedCents)}</td></tr> : null}
            <tr className="strong"><td>{tx('finance.iv.balanceDue')}</td><td className="num" data-testid="balance">{inv.displayStatus === 'void' ? '—' : money(inv.balanceCents)}</td></tr>
          </tbody></table>
        </div>
        <h3 className="fk-h3">{tx('finance.iv.lines')}</h3>
        <table className="fk-table"><thead><tr><th>{tx('finance.iv.description')}</th><th className="num">{tx('finance.iv.qty')}</th><th className="num">{tx('finance.iv.unitPrice')}</th><th className="num">{tx('finance.iv.amount')}</th></tr></thead>
          <tbody>{d.data!.lines.map((l) => <tr key={l.id}><td className="fn-wrap">{l.description}</td><td className="num">{fmtNumber(l.quantity)}</td><td className="num">{money(l.unitPriceCents)}</td><td className="num">{money(l.lineTotalCents)}</td></tr>)}</tbody></table>
        <h3 className="fk-h3" id="payment-history">{tx('finance.iv.paymentHistory')}</h3>
        {d.data!.payments.length === 0 ? <div className="fk-hint">{tx('finance.iv.noPayments')}</div> : <table className="fk-table" data-testid="payments"><tbody>{d.data!.payments.map((pm) => <tr key={pm.id}><td>{fmtYmdSafe(pm.paidOn)}</td><td>{tx('finance.payMethod.' + pm.method)}</td><td>{pm.reference ?? '—'}</td><td>{pm.recordedBy ?? '—'}</td><td className="num">{money(pm.amountCents)}</td></tr>)}</tbody></table>}
        {d.data!.credits?.length ? <><h3 className="fk-h3">{tx('finance.iv.creditNotes')}</h3><table className="fk-table" data-testid="credits"><tbody>{d.data!.credits.map((c) => <tr key={c.id}><td>{c.creditNumber}</td><td>{fmtYmdSafe(c.issuedOn)}</td><td className="fn-wrap">{c.reason}</td><td>{c.refundCents ? tx('finance.iv.refundShown', { a: money(c.refundCents), m: tx('finance.payMethod.' + (c.refundMethod ?? 'other')) }) : '—'}</td><td>{c.issuedBy ?? '—'}</td><td className="num">− {money(c.creditCents)}</td></tr>)}</tbody></table></> : null}
        {inv.notes ? <><h3 className="fk-h3">{tx('finance.iv.notes')}</h3><div className="fn-wrap">{inv.notes}</div></> : null}
        <div className="fk-hint">{tx('finance.iv.deliveryNote')}</div>
      </>}
    </FitDialog>
  );
}

type Line = { description: string; quantity: string; unit: string };
function InvoiceForm({ edit, today, onClose, onSaved }: { edit?: Detail; today: string; onClose: () => void; onSaved: (d: Detail, sent: boolean, preview: boolean) => void }) {
  const [customer, setCustomer] = useState<{ id: string; name: string; phone: string | null; email: string | null } | null>(edit?.invoice.customer.id ? { id: edit.invoice.customer.id, name: edit.invoice.customer.name ?? '', phone: edit.invoice.customer.phone, email: edit.invoice.customer.email } : null);
  const [find, setFind] = useState(''); const fq = useDebounced(find.trim(), 300);
  const found = useLoad(() => (fq.length >= 2 ? api.lookupCustomers(fq) : Promise.resolve({ items: [] })), [fq]);
  const [issue, setIssue] = useState(edit?.invoice.issueDate ?? today);
  const [due, setDue] = useState(edit?.invoice.dueDate ?? '');
  const [lines, setLines] = useState<Line[]>(edit ? edit.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unit: textFromCents(l.unitPriceCents) })) : [{ description: '', quantity: '1', unit: '' }]);
  const [tax, setTax] = useState(edit?.invoice.taxCents ? textFromCents(edit.invoice.taxCents) : '');
  const [discount, setDiscount] = useState(edit?.invoice.discountCents ? textFromCents(edit.invoice.discountCents) : '');
  const [notes, setNotes] = useState(edit?.invoice.notes ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const key = useRef(requestId());
  const parsed = lines.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unitPriceCents: centsFromText(l.unit) }));
  const okLines = parsed.filter((l) => l.description && Number.isInteger(l.quantity) && l.quantity > 0 && l.unitPriceCents != null);
  const badLine = parsed.some((l) => (l.description || l.unitPriceCents != null) && !(l.description && Number.isInteger(l.quantity) && l.quantity > 0 && l.unitPriceCents != null));
  const subtotal = okLines.reduce((a, l) => a + l.quantity * (l.unitPriceCents ?? 0), 0);
  const taxC = tax ? centsFromText(tax) : 0, discC = discount ? centsFromText(discount) : 0;
  const total = subtotal - (discC ?? 0) + (taxC ?? 0);
  const datesBad = !!due && due < issue;
  const valid = !!customer && okLines.length > 0 && !badLine && taxC != null && discC != null && (discC ?? 0) <= subtotal && total > 0 && !datesBad;
  const save = async (send: boolean, preview = false) => {
    if (!valid || !customer) return; setBusy(true); setErr(null);
    const body = { customerId: customer.id, issueDate: issue, dueDate: due || undefined, notes: notes.trim() || undefined, taxCents: taxC ?? 0, discountCents: discC ?? 0, lines: okLines.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents })) };
    try {
      let d: Detail;
      if (edit) { d = await api.edit(edit.invoice.id, body); if (send) d = await api.send(edit.invoice.id); }
      else d = await api.createInvoice({ ...body, idempotencyKey: key.current, send });
      onSaved(d, send, preview);
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <FitDialog wide title={edit ? tx('finance.iv.editTitle', { n: edit.invoice.invoiceNumber }) : tx('finance.iv.new')} subtitle={tx('finance.iv.formSub')} onClose={onClose} busy={busy} testId="invoice-form"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn" disabled={!valid || busy} onClick={() => save(false, true)} data-testid="form-preview">{tx('finance.iv.saveAndPreview')}</button>
        <button type="button" className="fk-btn" disabled={!valid || busy} onClick={() => save(false)} data-testid="save-draft">{tx('finance.iv.saveDraft')}</button>
        <button type="button" className="fk-btn primary" disabled={!valid || busy} onClick={() => save(true)} data-testid="send-invoice">{busy ? tx('pos.saving') : tx('finance.iv.sendInvoice')}</button></>}>
      <div className="fn-cols2">
        <div className="fn-side">
          <h3 className="fk-h3">{tx('finance.iv.customer')} *</h3>
          {customer ? <div className="fk-preview" data-testid="picked-customer"><b>{customer.name}</b><br />{customer.phone ?? tx('finance.iv.noPhone')} · {customer.email ?? tx('finance.iv.noEmail')}
            <button type="button" className="fk-link" onClick={() => setCustomer(null)}>{tx('finance.change')}</button></div> : <>
            <input className="fk-search wide" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={tx('finance.iv.findCustomer')} aria-label={tx('finance.iv.findCustomer')} data-autofocus data-testid="customer-find" />
            {fq.length >= 2 ? (found.error ? <StateBlock error={found.error} onRetry={found.reload} /> : !found.data ? <div className="fk-loading">{tx('pos.loading')}</div> : found.data.items.length === 0 ? <div className="fk-hint">{tx('finance.iv.noCustomerFound')}</div> :
              <ul className="fk-pick">{found.data.items.map((c: any) => <li key={c.id}><button type="button" onClick={() => setCustomer({ id: c.id, name: c.name, phone: c.phone, email: c.email })} data-testid="customer-option"><b>{c.name}</b><span>{c.phone ?? '—'} · {c.email ?? '—'} · {tx('finance.iv.invoicesN', { n: fmtNumber(c.invoices) })}</span></button></li>)}</ul>)
              : <div className="fk-hint">{tx('finance.iv.findHint')}</div>}
          </>}
          <div className="fk-grid2">
            <DateField label={tx('finance.iv.col.issued')} value={issue} onChange={setIssue} today={today} required testId="issue-date" />
            <DateField label={tx('finance.iv.col.due')} value={due} onChange={setDue} today={today} testId="due-date" />
          </div>
          {datesBad ? <div className="fk-err">{tx('finance.iv.dueBeforeIssue')}</div> : null}
          <label className="fk-field"><span>{tx('finance.iv.notes')}</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} /></label>
        </div>
        <div className="fn-side">
          <h3 className="fk-h3">{tx('finance.iv.lines')} *</h3>
          <table className="fk-table iv-lines"><thead><tr><th>{tx('finance.iv.description')}</th><th className="num">{tx('finance.iv.qty')}</th><th className="num">{tx('finance.iv.unitPrice')}</th><th className="num">{tx('finance.iv.amount')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{lines.map((l, i) => { const p = parsed[i]; const amt = p.unitPriceCents != null && Number.isInteger(p.quantity) ? p.quantity * p.unitPriceCents : null; return (
              <tr key={i}><td><input value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} maxLength={500} aria-label={tx('finance.iv.description')} data-testid="line-desc" /></td>
                <td><input className="xs" inputMode="numeric" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/\D/g, '') } : x)))} aria-label={tx('finance.iv.qty')} /></td>
                <td><input className="sm" inputMode="decimal" value={l.unit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} placeholder="0.00" aria-label={tx('finance.iv.unitPrice')} data-testid="line-price" /></td>
                <td className="num">{amt == null ? '—' : money(amt)}</td>
                <td>{lines.length > 1 ? <button type="button" className="fk-x" aria-label={tx('finance.iv.removeLine')} onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button> : null}</td></tr>); })}</tbody></table>
          <button type="button" className="fk-btn sm" onClick={() => setLines([...lines, { description: '', quantity: '1', unit: '' }])} disabled={lines.length >= 200}>+ {tx('finance.iv.addLine')}</button>
          <div className="fk-grid2">
            <label className="fk-field"><span>{tx('finance.iv.discount')}</span><input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" /></label>
            <label className="fk-field"><span>{tx('finance.iv.tax')}</span><input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" /></label>
          </div>
          <dl className="fk-dl"><dt>{tx('finance.iv.subtotal')}</dt><dd>{money(subtotal)}</dd><dt>{tx('finance.iv.col.total')}</dt><dd><b data-testid="form-total">{money(total)}</b></dd></dl>
          {badLine ? <div className="fk-err">{tx('finance.iv.lineInvalid')}</div> : null}
          {(discC ?? 0) > subtotal ? <div className="fk-err">{tx('finance.iv.discountTooBig')}</div> : null}
          <div className="fk-hint">{tx('finance.iv.serverComputes')}</div>
        </div>
      </div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function PaymentDialog({ d, today, onClose, onDone }: { d: Detail; today: string; onClose: () => void; onDone: (d: Detail, cents: number) => void }) {
  const inv = d.invoice;
  const [amount, setAmount] = useState(textFromCents(inv.balanceCents)); const [date, setDate] = useState(today); const [method, setMethod] = useState('cash'); const [reference, setReference] = useState(''); const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const key = useRef(requestId());
  const cents = centsFromText(amount);
  const valid = cents != null && cents > 0 && cents <= inv.balanceCents && !!date && date <= today;
  const submit = async () => {
    if (!valid || cents == null) return; setBusy(true); setErr(null);
    try { const r = await api.recordPayment(inv.id, { amountCents: cents, paidOn: date, method, reference: reference.trim() || undefined, note: noteText.trim() || undefined, idempotencyKey: key.current }); onDone(r, cents); }
    catch (e) { const det = errDetails(e); setErr(errMsg(e) + (det.balanceCents != null ? ` (${tx('finance.iv.balanceNow', { b: money(det.balanceCents) })})` : '')); setBusy(false); }
  };
  return (
    <FitDialog title={tx('finance.iv.recordPaymentTitle', { n: inv.invoiceNumber })} subtitle={customerText(inv.customer)} onClose={onClose} busy={busy} testId="payment-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" disabled={!valid || busy} onClick={submit} data-testid="confirm-payment">{busy ? tx('pos.saving') : tx('finance.iv.confirmPayment', { a: cents != null ? money(cents) : '' })}</button></>}>
      <dl className="fk-dl"><dt>{tx('finance.iv.col.total')}</dt><dd>{money(inv.totalCents)}</dd><dt>{tx('finance.iv.paidSoFar')}</dt><dd>{money(inv.paidCents)}</dd><dt>{tx('finance.iv.balanceDue')}</dt><dd><b>{money(inv.balanceCents)}</b></dd></dl>
      <div className="fk-grid2">
        <label className="fk-field"><span>{tx('finance.iv.paymentAmount')} *</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-autofocus data-testid="pay-amount" /></label>
        <DateField label={tx('finance.iv.paymentDate')} value={date} onChange={setDate} today={today} max={today} required testId="pay-date" />
        <label className="fk-field"><span>{tx('finance.iv.method')} *</span><select value={method} onChange={(e) => setMethod(e.target.value)} data-testid="pay-method">{METHODS.map((m) => <option key={m} value={m}>{tx('finance.payMethod.' + m)}</option>)}</select></label>
        <label className="fk-field"><span>{tx('finance.iv.reference')}</span><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></label>
        <label className="fk-field span2"><span>{tx('finance.iv.note')}</span><input value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={1000} /></label>
      </div>
      {cents != null && cents > inv.balanceCents ? <div className="fk-err">{tx('finance.iv.overBalance')}</div> : null}
      {cents != null && cents > 0 && cents < inv.balanceCents ? <div className="fk-preview">{tx('finance.iv.partialPreview', { b: money(inv.balanceCents - cents) })}</div> : null}
      <div className="fk-hint">{tx('finance.iv.notACharge')}</div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

// Invoices guide (Nov 4 2026) §13: a credit note lowers what the invoice asks for; the part beyond the balance is money the
// customer already paid, so it is refunded (recorded — not a card charge) and the method is required
function CreditDialog({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: (d: Detail, creditNumber: string, refundCents: number) => void }) {
  const inv = d.invoice; const creditable = inv.totalCents - (inv.creditedCents ?? 0);
  const [amount, setAmount] = useState(textFromCents(inv.balanceCents > 0 ? inv.balanceCents : creditable)); const [reason, setReason] = useState('');
  const [method, setMethod] = useState(''); const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const key = useRef(requestId());
  const cents = centsFromText(amount);
  const refund = cents != null ? Math.max(0, cents - inv.balanceCents) : 0;
  const valid = cents != null && cents > 0 && cents <= creditable && reason.trim().length >= 3 && (refund === 0 || !!method);
  const submit = async () => {
    if (!valid || cents == null) return; setBusy(true); setErr(null);
    try { const r = await api.credit(inv.id, { amountCents: cents, reason: reason.trim(), refundMethod: refund ? method : undefined, refundReference: refund && reference.trim() ? reference.trim() : undefined, idempotencyKey: key.current }); onDone(r, r.creditNumber, refund); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <FitDialog title={tx('finance.iv.creditTitle', { n: inv.invoiceNumber })} subtitle={customerText(inv.customer)} onClose={onClose} busy={busy} testId="credit-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" disabled={!valid || busy} onClick={submit} data-testid="confirm-credit">{busy ? tx('pos.saving') : tx('finance.iv.confirmCredit', { a: cents != null ? money(cents) : '' })}</button></>}>
      <dl className="fk-dl"><dt>{tx('finance.iv.col.total')}</dt><dd>{money(inv.totalCents)}</dd>{inv.creditedCents ? <><dt>{tx('finance.iv.creditNotes')}</dt><dd>− {money(inv.creditedCents)}</dd></> : null}
        <dt>{tx('finance.iv.paidSoFar')}</dt><dd>{money(inv.paidCents - (inv.refundedCents ?? 0))}</dd><dt>{tx('finance.iv.balanceDue')}</dt><dd><b>{money(inv.balanceCents)}</b></dd><dt>{tx('finance.iv.creditable')}</dt><dd>{money(creditable)}</dd></dl>
      <div className="fk-grid2">
        <label className="fk-field"><span>{tx('finance.iv.creditAmount')} *</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-autofocus data-testid="credit-amount" /></label>
        <label className="fk-field"><span>{tx('finance.iv.creditReason')} *</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="credit-reason" /></label>
        {refund > 0 ? <>
          <label className="fk-field"><span>{tx('finance.iv.refundMethod')} *</span><select value={method} onChange={(e) => setMethod(e.target.value)} data-testid="credit-refund-method"><option value="">—</option>{METHODS.map((m) => <option key={m} value={m}>{tx('finance.payMethod.' + m)}</option>)}</select></label>
          <label className="fk-field"><span>{tx('finance.iv.reference')}</span><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></label>
        </> : null}
      </div>
      {cents != null && cents > creditable ? <div className="fk-err">{tx('finance.iv.overCreditable')}</div> : null}
      {refund > 0 && cents != null && cents <= creditable ? <div className="fk-preview warn" data-testid="credit-refund-preview">{tx('finance.iv.refundPreview', { r: money(refund) })}</div> : null}
      <div className="fk-hint">{tx('finance.iv.creditNote')}</div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function VoidDialog({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: (d: Detail) => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <FitDialog title={tx('finance.iv.voidTitle', { n: d.invoice.invoiceNumber })} subtitle={`${customerText(d.invoice.customer)} · ${money(d.invoice.totalCents)}`} onClose={onClose} busy={busy} testId="void-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn danger" disabled={busy || reason.trim().length < 3} onClick={async () => { setBusy(true); setErr(null); try { onDone(await api.void(d.invoice.id, reason.trim())); } catch (e) { setErr(errMsg(e)); setBusy(false); } }} data-testid="confirm-void">{tx('finance.iv.confirmVoid')}</button></>}>
      <div className="fk-preview bad">{tx('finance.iv.voidImpact')}</div>
      <label className="fk-field"><span>{tx('finance.iv.voidReason')} *</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus data-testid="void-reason" /></label>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function LinkCustomerDialog({ d, onClose, onDone }: { d: Detail; onClose: () => void; onDone: (d: Detail) => void }) {
  const [find, setFind] = useState(''); const fq = useDebounced(find.trim(), 300);
  const found = useLoad(() => (fq.length >= 2 ? api.lookupCustomers(fq) : Promise.resolve({ items: [] })), [fq]);
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null); const [updateBillTo, setUpdate] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <FitDialog title={tx('finance.iv.linkTitle', { n: d.invoice.invoiceNumber })} subtitle={tx('finance.iv.linkSub')} onClose={onClose} busy={busy} testId="link-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" disabled={!pick || busy} onClick={async () => { if (!pick) return; setBusy(true); setErr(null); try { onDone(await api.linkCustomer(d.invoice.id, pick.id, updateBillTo)); } catch (e) { setErr(errMsg(e)); setBusy(false); } }} data-testid="confirm-link">{tx('finance.iv.linkCustomer')}</button></>}>
      <input className="fk-search wide" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={tx('finance.iv.findCustomer')} aria-label={tx('finance.iv.findCustomer')} data-autofocus data-testid="link-find" />
      {fq.length >= 2 ? (found.error ? <StateBlock error={found.error} onRetry={found.reload} /> : !found.data ? <div className="fk-loading">{tx('pos.loading')}</div> : found.data.items.length === 0 ? <div className="fk-hint">{tx('finance.iv.noCustomerFound')}</div> :
        <ul className="fk-pick">{found.data.items.map((c: any) => <li key={c.id}><button type="button" className={pick?.id === c.id ? 'on' : ''} onClick={() => setPick({ id: c.id, name: c.name })} data-testid="link-option"><b>{c.name}</b><span>{c.phone ?? '—'} · {c.email ?? '—'}</span></button></li>)}</ul>) : null}
      {d.invoice.customer.name ? <label className="fk-check"><input type="checkbox" checked={updateBillTo} onChange={(e) => setUpdate(e.target.checked)} />{tx('finance.iv.updateBillTo')}</label> : null}
      <div className="fk-hint">{tx('finance.iv.neverGuess')}</div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function PdfPreview({ id, number, onClose }: { id: string; number: string; onClose: () => void }) {
  const d = useLoad(() => api.pdf(id, 'inline'), [id]);
  const url = useMemo(() => (d.data ? URL.createObjectURL(d.data) : null), [d.data]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <FitDialog wide title={tx('finance.iv.previewTitle', { n: number })} subtitle={tx('finance.iv.englishOnly')} onClose={onClose} testId="pdf-preview"
      footer={<>{url ? <a className="fk-btn" href={url} target="_blank" rel="noopener noreferrer">{tx('finance.iv.openToPrint')}</a> : null}<button type="button" className="fk-btn primary" onClick={onClose}>{tx('finance.iv.back')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !url ? <div className="fk-loading">{tx('pos.loading')}</div> : <iframe className="fn-pdf" src={url} title={tx('finance.iv.previewTitle', { n: number })} />}
    </FitDialog>
  );
}
