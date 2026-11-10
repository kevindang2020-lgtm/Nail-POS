// POSExpensesScreen.tsx — Payments → Expenses (/tenant/payments/expenses). Rebuilt to the Expenses guide (Nov 4 2026) on the
// one-screen FitKit shell (`.work.fit.ex`: one bounded grid, no page scroll at 100 % zoom on the POS sizes):
//   header      Expenses · Upload Receipt · Receipt AI · Export CSV / Excel · gold Add Expense
//   period      Today · This Week · This Month · This Year · Custom Range (From / To month calendars, Apply / Cancel / Clear);
//               the presets are resolved by the SERVER in the salon's time zone and shown as dates
//   KPIs        Total Expenses · Expense Entries · Top Category (by AMOUNT; tap → every category) · Categories Used — one
//               server aggregate over the WHOLE filtered set (approved expenses, by expense date), never the visible page
//   toolbar     the inbox tabs (All · Inbox · Needs Review · Approved · Bills · Duplicates · Archived), search (vendor /
//               description / invoice / amount), category, payment method, sort, Clear filters — all applied on the server
//   records     Date · Expense · Category · Vendor · Amount · Method · Receipt · Status · View / Edit, numbered pages
//               (Page 1 = newest added); a page past the end is served as the last page; filters reset to Page 1
// Add Expense saves once (one idempotency key per open form), refetches, goes to Page 1 and highlights the new row; a
// saved expense the filters hide is said so, with View expense / Clear filters. Every workflow action the screen had
// (send, approve, reject, duplicate decisions, bill payment, void, payment match / link, delete draft, archive / restore)
// lives in View expense. Only APPROVED expenses are counted; duplicates are flagged and decided by a person.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SystemCheckButton } from '../components/SystemCheck';
import { Link } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import type { FinanceExpenseCreateRequest } from '@aipowersalon/api-contracts/tenant';
import { posExpensesApi, saveExportFile, type ExpenseTab, type FinCategory, type FinExpense, type FinReport, type FinDetail } from '../api/posExpensesApi';
import { posAiOcrReceiptApi } from '../api/posAiOcrReceiptApi';
import { useCan } from '../components/usePermissions';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced, requestId } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, fmtYmdSafe, DateField, centsFromText, textFromCents, type PeriodState } from '../components/FinanceKit';
import { money } from './reportsCommon';
import { serverText } from '../i18n/server-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { deviceToday } from '../lib/deviceToday';

type Tab = ExpenseTab | 'all';
const TABS: Tab[] = ['all', 'inbox', 'needs_review', 'approved', 'bills', 'duplicates', 'archived'];
const TAB_LABEL: Record<string, string> = { all: 'finance.ex.tab.all', inbox: 'pos.inbox', needs_review: 'pos.needs_review_2', approved: 'pos.approved', bills: 'pos.bills', duplicates: 'pos.duplicates', archived: 'pos.archived_2' };
const METHODS: Array<{ value: string; key: string }> = [{ value: 'business_card', key: 'pos.business_card' }, { value: 'cash', key: 'pos.cash' }, { value: 'check', key: 'pos.check' }, { value: 'ach', key: '' },
  { value: 'bank_transfer', key: 'pos.bank_transfer' }, { value: 'personal_card', key: 'pos.personal_card_reimburse' }, { value: 'other', key: 'pos.other' }];
const methodLabel = (v: string | null | undefined) => { if (!v) return '—'; const m = METHODS.find((x) => x.value === v); return m ? (m.key ? tx(m.key) : 'ACH') : v; };
const STATUS_KEY: Record<string, string> = { draft: 'pos.draft_2', pending_review: 'pos.needs_review_3', approved: 'pos.approved', rejected: 'pos.rejected_2', voided: 'pos.voided_2' };
const STATUS_TONE: Record<string, string> = { draft: 'mut', pending_review: 'warn', approved: 'ok', rejected: 'bad', voided: 'mut' };
const SORTS = ['created', 'date', 'amount'] as const;
type Sort = typeof SORTS[number];
const errCode = (e: unknown): string => String((e as { code?: string; apiCode?: string })?.code ?? (e as { apiCode?: string })?.apiCode ?? '');
const errMsg = (e: unknown, fallback: string): string => String((e as { message?: string })?.message || fallback);

type Ask = { id: string; version: number; action: 'reject' | 'void' | 'not_duplicate' | 'duplicate' | 'pay' | 'link_payment'; label: string };
type FormState = { id?: string; version?: number; status?: string; kind: 'expense' | 'bill'; category: string; amount: string; vendor: string; description: string; incurredOn: string; paymentMethod: string; dueDate: string; invoiceNumber: string; reason: string };
type Note = { tone: 'ok' | 'warn' | 'bad'; text: string; actions?: Array<{ label: string; run: () => void }> };

export function POSExpensesScreen() {
  const can = useCan();
  const canManage = can('owner.expenses.manage'), canApprove = can('owner.expenses.approve'), canExport = can('owner.expenses.export');
  const [tab, setTab] = useState<Tab>('all');
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' });
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [category, setCategory] = useState(''); const [method, setMethod] = useState(''); const [sort, setSort] = useState<Sort>('created');
  const [page, setPage] = useState(1); const [tick, setTick] = useState(0);
  const [note, setNote] = useState<Note | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [cats, setCats] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fit = useFitRows<HTMLDivElement>(46, { min: 4, max: 15, reserve: 34 });

  const pq = periodQuery(period);
  const dates = pq.preset === 'custom' ? { period: 'custom', from: pq.from, to: pq.to } : pq.preset === 'all' ? {} : { period: pq.preset };
  const filters = { q: q || undefined, category: category || undefined, paymentMethod: method || undefined };
  const scopeKey = JSON.stringify([tab, dates, filters, sort]);
  useEffect(() => setPage(1), [scopeKey]);   // a new period / search / filter / sort / tab starts at Page 1
  // each answer carries the reload it answers, so a save is judged only against a list read AFTER it
  const list = useLoad(() => posExpensesApi.expenses({ tab, ...dates, ...filters, sort, page, pageSize: fit.rows }).then((d) => ({ ...d, forTick: tick })), [scopeKey, page, fit.rows, tick]);
  const summary = useLoad(() => posExpensesApi.kpis({ ...dates, ...filters }), [JSON.stringify([dates, filters]), tick]);
  const catList = useLoad(() => posExpensesApi.categories(), [tick]);
  const categories: FinCategory[] = (catList.data?.categories ?? []).filter((c) => c.active);
  const catLabel = (key: string | null | undefined, label?: string | null) => (label ? serverText(label) : key ? serverText(categories.find((c) => c.key === key)?.label ?? key) : '—');
  useEffect(() => { if (list.data && list.data.page !== page) setPage(list.data.page); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((n) => n + 1);
  const filtered = !!(q || category || method || tab !== 'all');
  const clearFilters = () => { setSearch(''); setCategory(''); setMethod(''); setTab('all'); setSort('created'); };

  // after a save: the authoritative list decides whether the new / edited row is in view
  const pendingRow = useRef<{ id: string; kind: 'create' | 'edit'; after: number } | null>(null);
  useEffect(() => {
    const p = pendingRow.current; if (!p || !list.data || list.loading || list.data.forTick < p.after) return;
    pendingRow.current = null;
    const shown = list.data.items.some((x) => x.id === p.id);
    if (shown) { setHighlight(p.id); setNote({ tone: 'ok', text: tx(p.kind === 'create' ? 'finance.ex.savedHere' : 'finance.ex.updated') }); window.setTimeout(() => setHighlight((h) => (h === p.id ? null : h)), 4000); }
    else setNote({ tone: 'warn', text: tx(p.kind === 'create' ? 'finance.ex.savedHidden' : 'finance.ex.movedOut'),
      actions: [{ label: tx('finance.ex.view'), run: () => setViewId(p.id) }, ...(filtered || period.preset !== 'month' ? [{ label: tx('finance.clearFilters'), run: () => { clearFilters(); setPeriod({ preset: 'month' }); } }] : [])] });
  }, [list.data, list.loading]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onSaved = (id: string, kind: 'create' | 'edit') => { setForm(null); pendingRow.current = { id, kind, after: tick + 1 }; if (kind === 'create') setPage(1); reload(); };

  // ── receipt upload → the existing Receipt AI pipeline (scan, read, review — nothing posts without a person) ────────────
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('upload'); setNote(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      await posAiOcrReceiptApi.upload({ filename: file.name, mimeType: file.type, sizeBytes: file.size, bytes: Array.from(buf), headerBytes: Array.from(buf.slice(0, 16)) });
      setNote({ tone: 'ok', text: tx('people.expenses.receiptUploaded') }); reload();
    } catch (e) { setNote({ tone: 'bad', text: errMsg(e, tx('people.expenses.err.upload')) }); }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = ''; }
  };
  const exportAs = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setBusy('export-' + format); setNote(null);
    try { const f = await posExpensesApi.exportFile(format, (dates as { period?: string }).period ?? 'month', { from: (dates as { from?: string }).from, to: (dates as { to?: string }).to, ...filters }); saveExportFile(f); setNote({ tone: 'ok', text: tx('people.expenses.exported') }); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e, tx('people.expenses.err.export')) }); }
    finally { setBusy(null); }
  };

  const k = summary.data;
  const info = list.data ? { page: list.data.page, pageSize: list.data.pageSize, totalItems: list.data.total, totalPages: Math.max(1, Math.ceil(list.data.total / Math.max(1, list.data.pageSize))) } : null;
  const rows: FinExpense[] = list.data?.items ?? [];
  const today = k?.period.today ?? deviceToday();

  return (
    <div className="work fit ex" data-testid="expenses-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('finance.ex.title')}</h1><div className="sub">{tx('finance.ex.subtitle')}</div></div>
        <div className="fk-head-actions">
          <SystemCheckButton domain="expenses" />
          {canManage ? <>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" style={{ display: 'none' }} aria-label={tx('pos.receipt_file')} onChange={(e) => void onFile(e.target.files?.[0])} />
            <button type="button" className="fk-btn" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()} data-testid="upload-receipt">{busy === 'upload' ? tx('pos.uploading') : tx('pos.upload_receipt')}</button>
          </> : null}
          <Link className="fk-btn ghost" to="/tenant/ai/ocr-receipt">{tx('pos.receipt_ai_review')}</Link>
          {canExport ? <>
            <button type="button" className="fk-btn" disabled={busy === 'export-csv'} onClick={() => void exportAs('csv')} title={tx('finance.ex.exportScope')} data-testid="export-csv">{tx('pos.export_csv')}</button>
            <button type="button" className="fk-btn" disabled={busy === 'export-xlsx'} onClick={() => void exportAs('xlsx')} title={tx('finance.ex.exportScope')} data-testid="export-xlsx">{tx('pos.export_excel')}</button>
            <button type="button" className="fk-btn" disabled={busy === 'export-pdf'} onClick={() => void exportAs('pdf')} title={tx('finance.ex.exportScope')} data-testid="export-pdf">{tx('pos.export_pdf')}</button>
          </> : null}
          {canManage ? <button type="button" className="fk-btn primary" onClick={() => { setNote(null); setForm(emptyForm(today)); }} data-testid="add-expense">{tx('pos.add_expense')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span>
        <span className="fn-note-acts">{note.actions?.map((a) => <button key={a.label} type="button" className="fk-link" onClick={() => { a.run(); setNote(null); }}>{a.label}</button>)}
          <button type="button" className="fk-x" aria-label={tx('pos.close')} onClick={() => setNote(null)}>✕</button></span></div> : null}

      <PeriodBar value={period} onChange={setPeriod} server={k?.period ?? null} allowAll />

      <div className="fk-kpis" data-testid="kpis">
        {summary.error ? <StateBlock error={summary.error} onRetry={summary.reload} /> : <>
          <KpiCard testId="kpi-total" label={tx('finance.ex.kpi.total')} tone="gold" loading={!k} value={k ? money(k.totalCents) : ''} sub={tx('finance.ex.kpi.totalSub')} />
          <KpiCard testId="kpi-entries" label={tx('finance.ex.kpi.entries')} loading={!k} value={k ? fmtNumber(k.entries) : ''} sub={tx('finance.ex.kpi.entriesSub')} />
          <KpiCard testId="kpi-top" label={tx('finance.ex.kpi.top')} loading={!k} value={k ? (k.topCategory ? serverText(k.topCategory.label) : '—') : ''}
            sub={k ? (k.topCategory ? tx('finance.ex.kpi.topSub', { a: money(k.topCategory.totalCents) }) : tx('finance.ex.kpi.topNone')) : ''} onClick={k && k.topCategory && period.preset !== 'all' ? () => setCats(true) : undefined} />
          <KpiCard testId="kpi-cats" label={tx('finance.ex.kpi.cats')} loading={!k} value={k ? fmtNumber(k.categoriesUsed) : ''} sub={tx('finance.ex.kpi.catsSub')} />
        </>}
      </div>
      <div className="fn-scope" data-testid="kpi-scope">{tx('finance.ex.scope')}</div>

      <div className="fn-toolbar ex-toolbar" role="toolbar" aria-label={tx('finance.filters')}>
        <div className="fk-seg ex-tabs" role="tablist">
          {TABS.map((x) => <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)} data-testid={'tab-' + x}>{tx(TAB_LABEL[x])}</button>)}
        </div>
        <div className="fn-search wide">
          <input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('finance.ex.searchPh')} aria-label={tx('finance.ex.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}
        </div>
        <select className="fk-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label={tx('finance.ex.col.category')} data-testid="category">
          <option value="">{tx('finance.ex.allCategories')}</option>{categories.map((c) => <option key={c.key} value={c.key}>{serverText(c.label)}</option>)}</select>
        <select className="fk-select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label={tx('finance.ex.col.method')} data-testid="method">
          <option value="">{tx('finance.ex.allMethods')}</option>{METHODS.map((m) => <option key={m.value} value={m.value}>{methodLabel(m.value)}</option>)}</select>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={tx('finance.sort')} data-testid="sort">
          {SORTS.map((s) => <option key={s} value={s}>{tx('finance.ex.sort.' + s)}</option>)}</select>
        {filtered || sort !== 'created' ? <button type="button" className="fk-link" onClick={clearFilters} data-testid="clear-filters">{tx('finance.clearFilters')}</button> : null}
      </div>

      <FitPanel testId="expenses" bodyRef={fit.ref} className="fn-records"
        title={<>{tx('finance.ex.list')}{list.data ? <span className="fk-muted"> · {fmtNumber(list.data.total)}</span> : null}</>}
        footer={<Pager info={info} onPage={setPage} label={tx('finance.ex.list')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} />
          : !list.data ? <div className="fk-loading">{tx('pos.loading_expenses')}</div>
          : rows.length === 0 ? (
            <Empty title={tx(filtered ? 'finance.ex.emptyFiltered' : 'finance.ex.empty')}>
              {canManage ? <button type="button" className="fk-btn primary" onClick={() => setForm(emptyForm(today))}>{tx('pos.add_expense')}</button> : null}
              {filtered ? <button type="button" className="fk-btn" onClick={clearFilters} data-testid="empty-clear">{tx('finance.clearFilters')}</button>
                : <button type="button" className="fk-btn" onClick={() => setPeriod({ preset: 'year' })}>{tx('finance.ex.tryAnother')}</button>}
            </Empty>
          ) : (
            <table className="fk-table fn-table ex-table" data-testid="expenses-table">
              <thead><tr>
                <th>{tx('finance.ex.col.date')}</th><th>{tx('finance.ex.col.expense')}</th><th>{tx('finance.ex.col.category')}</th><th className="t-opt">{tx('finance.ex.col.vendor')}</th>
                <th className="num">{tx('finance.ex.col.amount')}</th><th className="t-opt">{tx('finance.ex.col.method')}</th><th className="t-opt">{tx('finance.ex.col.receipt')}</th>
                <th>{tx('finance.ex.col.status')}</th><th aria-label={tx('finance.actions')} />
              </tr></thead>
              <tbody>{rows.map((x) => (
                <tr key={x.id} data-testid="expense-row" className={'inv2-click' + (highlight === x.id ? ' ex-new' : '')} onClick={() => setViewId(x.id)}>
                  <td className="nowrap">{fmtYmdSafe(x.incurredOn)}{x.kind === 'bill' && x.dueDate ? <span className={'fk-li-s' + (x.billDue === 'overdue' ? ' bad' : '')}>{tx('pos.due')} {fmtYmdSafe(x.dueDate)}</span> : null}</td>
                  <td className="ex-desc"><span className="fk-li-t">{x.description || x.vendorDisplay || x.vendor || '—'}</span>
                    {x.duplicateStatus === 'possible' || x.duplicateStatus === 'exact' ? <span className="fk-li-s bad">{tx('pos.possible_duplicate')}</span> : null}</td>
                  <td><span className="fk-chip mut">{catLabel(x.category, x.categoryLabel)}</span></td>
                  <td className="t-opt">{x.vendorDisplay || x.vendor || '—'}</td>
                  <td className="num"><b>{money(x.amountCents)}</b>{x.kind === 'bill' && x.openCents ? <span className="fk-li-s">{money(x.openCents)} {tx('pos.open_4')}</span> : null}</td>
                  <td className="t-opt">{methodLabel(x.paymentMethod)}</td>
                  <td className="t-opt">{x.receiptDocumentId ? <span title={tx('finance.ex.receiptAttached')} aria-label={tx('finance.ex.receiptAttached')}>📎</span> : '—'}</td>
                  <td><span className={'fk-chip ' + (STATUS_TONE[x.status] ?? 'mut')}>{STATUS_KEY[x.status] ? tx(STATUS_KEY[x.status]) : x.status}</span></td>
                  <td className="fn-acts" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="fk-btn ghost sm" onClick={() => setViewId(x.id)} data-testid="row-view">{tx('pos.details')}</button>
                    {canManage && x.status !== 'voided' && (x.status !== 'approved' || canApprove) ? <button type="button" className="fk-btn ghost sm" onClick={() => setForm(formOf(x))} data-testid="row-edit">{tx('finance.ex.edit')}</button> : null}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
      </FitPanel>

      {form ? <ExpenseForm initial={form} today={today} categories={categories} canApprove={canApprove} onClose={() => setForm(null)} onSaved={onSaved} /> : null}
      {viewId ? <ExpenseView id={viewId} canManage={canManage} canApprove={canApprove} can={can} catLabel={catLabel} onClose={() => setViewId(null)}
        onEdit={(x) => { setViewId(null); setForm(formOf(x)); }} onAsk={(a) => setAsk(a)} onChanged={(msg) => { setNote({ tone: 'ok', text: msg }); reload(); }} busy={busy} setBusy={setBusy} tick={tick} /> : null}
      {ask ? <AskDialog ask={ask} onClose={() => setAsk(null)} onDone={(msg) => { setAsk(null); setNote({ tone: 'ok', text: msg }); reload(); }} /> : null}
      {cats ? <CategoryBreakdown dates={dates} onClose={() => setCats(false)} /> : null}
    </div>
  );
}

const emptyForm = (today: string): FormState => ({ kind: 'expense', category: '', amount: '', vendor: '', description: '', incurredOn: today, paymentMethod: '', dueDate: '', invoiceNumber: '', reason: '' });
const formOf = (x: FinExpense): FormState => ({ id: x.id, version: x.version, status: x.status, kind: x.kind === 'bill' ? 'bill' : 'expense', category: x.category ?? '', amount: textFromCents(x.amountCents),
  vendor: x.vendor ?? x.vendorDisplay ?? '', description: x.description ?? '', incurredOn: x.incurredOn ?? '', paymentMethod: x.paymentMethod ?? '', dueDate: x.dueDate ?? '', invoiceNumber: x.invoiceNumber ?? '', reason: '' });

/** Add / Edit: one idempotency key per open form (a double tap or a retry never makes a second expense). */
function ExpenseForm({ initial, today, categories, canApprove, onClose, onSaved }: { initial: FormState; today: string; categories: FinCategory[]; canApprove: boolean; onClose: () => void; onSaved: (id: string, kind: 'create' | 'edit') => void }) {
  const [f, setF] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [dupReason, setDupReason] = useState<string | null>(null);
  const key = useRef(requestId());
  const edit = !!f.id; const correction = edit && f.status === 'approved';
  const set = (p: Partial<FormState>) => setF((x) => ({ ...x, ...p }));
  const cents = centsFromText(f.amount);
  const suggest = async () => {
    if (edit || !f.vendor.trim() || f.category) return;
    try { const r = await posExpensesApi.recommend(f.vendor.trim()); if (r?.key && r.source !== 'fallback') { setSuggested(r.key); setF((x) => (x.category ? x : { ...x, category: r.key })); } } catch { /* a suggestion is optional */ }
  };
  const save = async (intent: 'draft' | 'submit' | 'approve', override?: string) => {
    if (busy) return; setErr(null);
    if (!cents || cents <= 0) { setErr(tx('pos.enter_a_positive_amount_and_a_13pr')); return; }
    if (!f.incurredOn) { setErr(tx('finance.ex.dateRequired')); return; }
    if (f.kind === 'bill' && !f.dueDate) { setErr(tx('pos.a_bill_needs_a_due_date')); return; }
    if (correction && !f.reason.trim()) { setErr(tx('finance.ex.correctionReason')); return; }
    setBusy(true);
    const fields = { kind: f.kind, category: f.category || null, amountCents: cents, vendor: f.vendor.trim() || null, description: f.description.trim() || null, incurredOn: f.incurredOn,
      paymentMethod: (f.paymentMethod || null) as FinanceExpenseCreateRequest['paymentMethod'], dueDate: f.kind === 'bill' ? f.dueDate : null, invoiceNumber: f.kind === 'bill' ? f.invoiceNumber.trim() || null : null };
    try {
      if (edit) { const r = await posExpensesApi.update(f.id!, { ...fields, version: f.version!, reason: correction ? f.reason.trim() : null }); onSaved(r.expense.id, 'edit'); }
      else {
        const r = await posExpensesApi.createExpense({ ...fields, reimburse: f.paymentMethod === 'personal_card' ? true : null, intent, duplicateOverrideReason: override ?? null, idempotencyKey: key.current });
        onSaved(r.expense.id, 'create');
      }
    } catch (e) {
      const c = errCode(e);
      if (c === 'RECEIPT_POSSIBLE_DUPLICATE' || c === 'RECEIPT_DUPLICATE') { setDupReason(''); key.current = requestId(); }
      setErr(c === 'EXPENSE_VERSION_CONFLICT' ? tx('pos.someone_else_changed_this_expense_the_1ed3') : errMsg(e, tx('people.expenses.err.add')));
    } finally { setBusy(false); }
  };
  return (
    <FitDialog title={edit ? tx('finance.ex.editTitle') : tx('pos.add_expense_2')} onClose={onClose} busy={busy} testId="dlg-expense"
      footer={<>
        <button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        {edit ? <button type="button" className="fk-btn primary" disabled={busy} onClick={() => void save('draft')} data-testid="form-save">{tx('pos.save')}</button> : <>
          <button type="button" className="fk-btn" disabled={busy} onClick={() => void save('draft')} data-testid="form-draft">{tx('pos.save_draft_2')}</button>
          {canApprove ? <button type="button" className="fk-btn primary" disabled={busy} onClick={() => void save('approve')} data-testid="form-save">{busy ? tx('pos.adding') : tx('pos.add_expense_2')}</button>
            : <button type="button" className="fk-btn primary" disabled={busy} onClick={() => void save('submit')} data-testid="form-save">{busy ? tx('pos.adding') : tx('pos.send_for_approval')}</button>}
        </>}
      </>}>
      <div className="cg-form two">
        <label className="fk-field"><span>{tx('pos.type')}</span><select value={f.kind} onChange={(e) => set({ kind: e.target.value === 'bill' ? 'bill' : 'expense' })} data-testid="f-kind">
          <option value="expense">{tx('pos.expense_already_paid')}</option><option value="bill">{tx('pos.bill_to_pay_later')}</option></select></label>
        <label className="fk-field"><span>{tx('pos.amount_2')} *</span><input inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0.00" data-testid="f-amount" /></label>
        <DateField label={tx('pos.date')} value={f.incurredOn} onChange={(d) => set({ incurredOn: d })} today={today} required testId="f-date" />
        <label className="fk-field"><span>{tx('pos.vendor')}</span><input value={f.vendor} maxLength={200} onChange={(e) => set({ vendor: e.target.value })} onBlur={() => void suggest()} placeholder={tx('pos.e_g_sally_beauty')} data-testid="f-vendor" /></label>
        <label className="fk-field"><span>{tx('pos.category')}</span>
          <select value={f.category} onChange={(e) => set({ category: e.target.value })} data-testid="f-category"><option value="">{tx('pos.choose_for_me')}</option>{categories.map((c) => <option key={c.key} value={c.key}>{serverText(c.label)}</option>)}</select>
          {suggested && f.category === suggested ? <small className="fk-hint">{tx('pos.suggested_from_the_vendor')}</small> : null}</label>
        <label className="fk-field"><span>{tx('pos.paid_with')}</span><select value={f.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })} data-testid="f-method">
          <option value="">{tx('pos.not_set')}</option>{METHODS.map((m) => <option key={m.value} value={m.value}>{methodLabel(m.value)}</option>)}</select></label>
        {f.kind === 'bill' ? <>
          <DateField label={tx('pos.due_date')} value={f.dueDate} onChange={(d) => set({ dueDate: d })} today={today} required testId="f-due" />
          <label className="fk-field"><span>{tx('pos.invoice')}</span><input value={f.invoiceNumber} maxLength={80} onChange={(e) => set({ invoiceNumber: e.target.value })} /></label>
        </> : null}
        <label className="fk-field span2"><span>{tx('finance.ex.notes')}</span><input value={f.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} placeholder={tx('pos.brief_description_of_the_expense')} data-testid="f-desc" /></label>
        {correction ? <label className="fk-field span2"><span>{tx('finance.ex.correctionReason')} *</span><input value={f.reason} maxLength={500} onChange={(e) => set({ reason: e.target.value })} data-testid="f-reason" /></label> : null}
      </div>
      {dupReason !== null ? (
        <div className="fk-note warn" data-testid="dup-box"><span><b>{tx('pos.this_looks_like_an_expense_already_1fow')}</b>
          <input className="fk-search wide" value={dupReason} onChange={(e) => setDupReason(e.target.value)} placeholder={tx('pos.e_g_two_separate_deliveries_the_e5gr')} aria-label={tx('pos.why_is_it_not_a_duplicate')} /></span>
          <button type="button" className="fk-btn primary sm" disabled={busy || !dupReason.trim()} onClick={() => void save(canApprove ? 'approve' : 'submit', dupReason.trim())}>{tx('pos.save_anyway')}</button></div>
      ) : null}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

/** View expense: every field, the receipt (private, expiring preview when Receipt AI can show it), and the workflow actions. */
function ExpenseView({ id, canManage, canApprove, can, catLabel, onClose, onEdit, onAsk, onChanged, busy, setBusy, tick }: {
  id: string; canManage: boolean; canApprove: boolean; can: (k: string) => boolean; catLabel: (k: string | null | undefined, l?: string | null) => string; onClose: () => void; onEdit: (x: FinExpense) => void;
  onAsk: (a: Ask) => void; onChanged: (msg: string) => void; busy: string | null; setBusy: (b: string | null) => void; tick: number;
}) {
  const d = useLoad<FinDetail>(() => posExpensesApi.detail(id), [id, tick]);
  const [err, setErr] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ url: string | null; failed: boolean } | null>(null);
  const x = d.data?.expense;
  const act = async (fn: () => Promise<unknown>, ok: string | ((r: unknown) => string)) => {
    setBusy(id); setErr(null);
    try { const r = await fn(); onChanged(typeof ok === 'function' ? ok(r) : ok); d.reload(); }
    catch (e) { setErr(errCode(e) === 'EXPENSE_VERSION_CONFLICT' ? tx('pos.someone_else_changed_this_expense_the_1ed3') : errMsg(e, tx('people.common.tryAgain'))); d.reload(); }
    finally { setBusy(null); }
  };
  const openReceipt = async () => {
    if (!x?.receiptDocumentId) return;
    try { const doc = await posAiOcrReceiptApi.detail(x.receiptDocumentId); const r = doc?.storageKey ? await posAiOcrReceiptApi.previewUrl(doc.id, doc.storageKey) : null; const u = r?.url && !String(r.url).startsWith('notconnected:') ? String(r.url) : null; setReceipt({ url: u, failed: !u }); }
    catch { setReceipt({ url: null, failed: true }); }
  };
  const dup = x && (x.duplicateStatus === 'possible' || x.duplicateStatus === 'exact');
  const b = busy === id;
  return (
    <FitDialog title={tx('finance.ex.details')} onClose={onClose} side testId="dlg-view"
      footer={x ? <>
        {canManage && x.status !== 'voided' && (x.status !== 'approved' || canApprove) ? <button type="button" className="fk-btn" onClick={() => onEdit(x)} data-testid="view-edit">{tx('finance.ex.edit')}</button> : null}
        <span style={{ flex: 1 }} />
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button>
      </> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <dl className="fk-dl" data-testid="view-fields">
          <dt>{tx('finance.ex.col.amount')}</dt><dd><b>{money(x.amountCents)}</b>{x.kind === 'bill' && x.openCents ? ` · ${money(x.openCents)} ${tx('pos.open_4')}` : ''}</dd>
          <dt>{tx('finance.ex.col.date')}</dt><dd>{fmtYmdSafe(x.incurredOn)}</dd>
          <dt>{tx('finance.ex.col.category')}</dt><dd>{catLabel(x.category, x.categoryLabel)}</dd>
          <dt>{tx('finance.ex.col.vendor')}</dt><dd>{x.vendorDisplay || x.vendor || '—'}</dd>
          <dt>{tx('finance.ex.col.method')}</dt><dd>{methodLabel(x.paymentMethod)}</dd>
          <dt>{tx('finance.ex.col.status')}</dt><dd><span className={'fk-chip ' + (STATUS_TONE[x.status] ?? 'mut')}>{STATUS_KEY[x.status] ? tx(STATUS_KEY[x.status]) : x.status}</span>{dup ? <span className="fk-chip bad">{tx('pos.possible_duplicate')}</span> : null}</dd>
          {x.kind === 'bill' && x.dueDate ? <><dt>{tx('pos.due_date')}</dt><dd>{fmtYmdSafe(x.dueDate)}</dd></> : null}
          {x.invoiceNumber ? <><dt>{tx('pos.invoice')}</dt><dd>{x.invoiceNumber}</dd></> : null}
          <dt>{tx('finance.ex.notes')}</dt><dd>{x.description || '—'}</dd>
          <dt>{tx('finance.ex.col.receipt')}</dt><dd>{x.receiptDocumentId
            ? <>{tx('finance.ex.receiptAttached')} <button type="button" className="fk-link" onClick={() => void openReceipt()} data-testid="open-receipt">{tx('finance.ex.openReceipt')}</button></>
            : tx('finance.ex.noReceipt')}</dd>
          {x.voidReason ? <><dt>{tx('pos.void')}</dt><dd>{x.voidReason}</dd></> : null}
          {x.rejectedReason ? <><dt>{tx('pos.reject')}</dt><dd>{x.rejectedReason}</dd></> : null}
          <dt>{tx('finance.ex.created', { d: '' }).trim()}</dt><dd>{x.createdAt ? fmtInZone(x.createdAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</dd>
        </dl>
        {receipt ? (receipt.url ? <a className="fk-btn" href={receipt.url} target="_blank" rel="noreferrer noopener" data-testid="receipt-link">{tx('finance.ex.openReceipt')} ↗</a>
          : <div className="fk-hint">{tx('finance.ex.receiptPreviewOff')} <Link to="/tenant/ai/ocr-receipt">{tx('pos.receipt_ai_review')}</Link></div>) : null}
        <h3 className="fk-sub">{tx('finance.ex.workflow')}</h3>
        <div className="cg-acts wrap" data-testid="view-actions">
          {canManage && x.status === 'draft' ? <button type="button" className="fk-btn" disabled={b} onClick={() => void act(() => posExpensesApi.submit(x.id, x.version), tx('people.expenses.sentForReview'))}>{tx('pos.send')}</button> : null}
          {canApprove && (x.status === 'pending_review' || x.status === 'draft') && !dup ? <button type="button" className="fk-btn primary" disabled={b} onClick={() => void act(() => posExpensesApi.approve(x.id, x.version), tx('people.expenses.approved'))} data-testid="act-approve">{tx('pos.approve')}</button> : null}
          {canApprove && dup ? <>
            <button type="button" className="fk-btn" disabled={b} onClick={() => onAsk({ id: x.id, version: x.version, action: 'not_duplicate', label: tx('pos.keep_it_why_is_it_not_xhae') })}>{tx('pos.not_a_duplicate')}</button>
            <button type="button" className="fk-btn" disabled={b} onClick={() => onAsk({ id: x.id, version: x.version, action: 'duplicate', label: tx('pos.mark_as_duplicate_why') })}>{tx('pos.duplicate')}</button>
          </> : null}
          {canApprove && x.status === 'pending_review' ? <button type="button" className="fk-btn" disabled={b} onClick={() => onAsk({ id: x.id, version: x.version, action: 'reject', label: tx('pos.reject_this_expense_why') })}>{tx('pos.reject')}</button> : null}
          {can('owner.expenses.bills.manage') && x.kind === 'bill' && x.status === 'approved' && x.openCents > 0 ? <button type="button" className="fk-btn" disabled={b} onClick={() => onAsk({ id: x.id, version: x.version, action: 'pay', label: tx('pos.record_a_bill_payment') })}>{tx('pos.pay_2')}</button> : null}
          {canApprove && x.status === 'approved' ? <button type="button" className="fk-btn" disabled={b} onClick={() => onAsk({ id: x.id, version: x.version, action: 'void', label: tx('pos.void_this_expense_why') })} data-testid="act-void">{tx('pos.void')}</button> : null}
          {canManage && x.status === 'approved' && x.paymentMatchStatus !== 'matched' ? <>
            <button type="button" className="fk-btn ghost" disabled={b} onClick={() => void act(() => posExpensesApi.paymentMatch(x.id), (r) => { const v = (r as { verdict?: string })?.verdict; return v === 'matched' ? tx('people.expenses.payment.found') : v === 'possible_match' ? tx('people.expenses.payment.possible') : tx('people.expenses.payment.none'); })}>{tx('people.expenses.payment.find')}</button>
            <button type="button" className="fk-btn ghost" disabled={b} onClick={() => onAsk({ id: x.id, version: x.version, action: 'link_payment', label: tx('people.expenses.payment.linkWhich') })}>{tx('people.expenses.payment.link')}</button>
          </> : null}
          {x.paymentMatchStatus ? <span className={'fk-chip ' + (x.paymentMatchStatus === 'matched' ? 'ok' : 'mut')}>{x.paymentMatchStatus === 'matched' ? tx('people.expenses.payment.matched', { ref: x.matchedPaymentRef ?? '' }) : x.paymentMatchStatus === 'possible_match' ? tx('people.expenses.payment.possible') : tx('people.expenses.payment.unmatched')}</span> : null}
          {can('owner.expenses.delete_draft') && x.status === 'draft' ? <button type="button" className="fk-btn ghost" disabled={b} onClick={() => void act(() => posExpensesApi.deleteDraft(x.id), tx('people.expenses.draftDeleted')).then(onClose)}>{tx('pos.delete')}</button> : null}
          {can('owner.expenses.archive') && x.status !== 'draft' && !x.archivedAt ? <button type="button" className="fk-btn ghost" disabled={b} onClick={() => void act(() => posExpensesApi.archive(x.id), tx('people.common.archived'))}>{tx('pos.archive')}</button> : null}
          {can('owner.expenses.archive') && x.archivedAt ? <button type="button" className="fk-btn ghost" disabled={b} onClick={() => void act(() => posExpensesApi.restore(x.id), tx('people.common.restored'))}>{tx('pos.restore')}</button> : null}
        </div>
        {err ? <div className="fk-err" role="alert">{err}</div> : null}
      </>}
    </FitDialog>
  );
}

/** a reason (reject / void / duplicate decisions), a statement reference (link payment) or an amount (bill payment) */
function AskDialog({ ask, onClose, onDone }: { ask: Ask; onClose: () => void; onDone: (msg: string) => void }) {
  const [answer, setAnswer] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const key = useRef(requestId());
  const confirm = async () => {
    const text = answer.trim(); setErr(null);
    let run: () => Promise<unknown>; let ok: string;
    if (ask.action === 'pay') { const c = centsFromText(text); if (!c || c <= 0) { setErr(tx('pos.enter_the_amount_paid')); return; } run = () => posExpensesApi.billPayment(ask.id, c, key.current); ok = tx('people.expenses.paymentRecorded'); }
    else if (ask.action === 'link_payment') { if (!text) { setErr(tx('people.expenses.payment.needRef')); return; } run = () => posExpensesApi.paymentLink(ask.id, { decision: 'confirm', paymentRef: text, version: ask.version }); ok = tx('people.expenses.payment.linked'); }
    else {
      if (!text) { setErr(tx('pos.say_why_it_is_kept_in_7xdg')); return; }
      if (ask.action === 'reject') { run = () => posExpensesApi.reject(ask.id, text, ask.version); ok = tx('people.expenses.rejected'); }
      else if (ask.action === 'void') { run = () => posExpensesApi.voidExpense(ask.id, text, ask.version); ok = tx('people.expenses.voided'); }
      else { run = () => posExpensesApi.duplicateDecision(ask.id, ask.action === 'duplicate' ? 'duplicate' : 'not_duplicate', text); ok = ask.action === 'duplicate' ? tx('pos.marked_as_a_duplicate_it_will_19nj') : tx('pos.kept_marked_as_not_a_duplicate'); }
    }
    setBusy(true);
    try { await run(); onDone(ok); }
    catch (e) { setErr(errCode(e) === 'EXPENSE_VERSION_CONFLICT' ? tx('pos.someone_else_changed_this_expense_the_1ed3') : errMsg(e, tx('people.common.tryAgain'))); }
    finally { setBusy(false); }
  };
  return (
    <FitDialog title={ask.label} onClose={onClose} busy={busy} testId="dlg-ask"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" disabled={busy} onClick={() => void confirm()} data-testid="ask-confirm">{tx('pos.confirm')}</button></>}>
      <label className="fk-field"><span>{ask.action === 'pay' ? tx('pos.amount_paid') : ask.action === 'link_payment' ? tx('people.expenses.payment.link') : tx('pos.reason_2')}</span>
        <input value={answer} onChange={(e) => setAnswer(e.target.value)} inputMode={ask.action === 'pay' ? 'decimal' : undefined} maxLength={500} autoFocus data-testid="ask-input" /></label>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

/** every category of the period (approved expenses), from the finance report — opened from the Top Category card */
function CategoryBreakdown({ dates, onClose }: { dates: { period?: string; from?: string; to?: string }; onClose: () => void }) {
  const r = useLoad<FinReport>(() => (dates.period === 'custom' ? posExpensesApi.reportRange(dates.from ?? '', dates.to ?? '') : posExpensesApi.report(dates.period ?? 'month')), [JSON.stringify(dates)]);
  const items = useMemo(() => (r.data?.byCategory ?? []).filter((c) => c.totalCents > 0), [r.data]);
  const max = Math.max(1, ...items.map((c) => c.totalCents));
  return (
    <FitDialog title={tx('finance.ex.byCategory')} subtitle={tx('finance.ex.byCategorySub')} onClose={onClose} testId="dlg-categories">
      {r.error ? <StateBlock error={r.error} onRetry={r.reload} /> : !r.data ? <div className="fk-loading">{tx('pos.loading')}</div>
        : items.length === 0 ? <Empty title={tx('pos.no_approved_expenses_in_this_period')} />
        : <ul className="fk-list ex-bars">{items.map((c) => <li key={c.key} className="fk-li"><span className="ex-bar-l">{serverText(c.label)}</span>
            <span className="ex-bar"><span style={{ width: `${Math.round((c.totalCents / max) * 100)}%` }} /></span><b className="num">{money(c.totalCents)}</b></li>)}</ul>}
      {r.data ? <div className="fk-hint"><b>{money(r.data.totalCents)}</b> · {tx('pos.only_approved_expenses_are_counted_drafts_1m5r')}</div> : null}
    </FitDialog>
  );
}
