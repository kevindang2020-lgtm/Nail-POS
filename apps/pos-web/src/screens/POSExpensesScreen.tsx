// POSExpensesScreen.tsx — Payments → Receipts & Expenses (Receipt/Expense/OCR/Accounting mandate, Oct 21 2026).
// One screen a salon owner can run without an accountant: snap or upload a receipt (it goes through the existing Receipt AI
// review — nothing posts without a person), add an expense by hand, approve what is waiting, see where the money went this
// month by category, pay bills, and export for the accountant. Every figure comes from the finance module
// (/owner/finance/*); only APPROVED expenses are counted. Duplicates are flagged and decided by a person — never deleted.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { parseDollarsToCents } from '@aipowersalon/ui';
import type { FinanceExpenseCreateRequest } from '@aipowersalon/api-contracts/tenant';
import { posExpensesApi, saveExportFile, type ExpenseTab, type FinCategory, type FinDashboard, type FinExpense, type FinReport } from '../api/posExpensesApi';
import { posAiOcrReceiptApi } from '../api/posAiOcrReceiptApi';
import { useCan } from '../components/usePermissions';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { serverText } from '../i18n/server-text';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtYmd } from '../i18n/format';

const TABS: Array<{ key: ExpenseTab; label: string }> = [{ key: 'inbox', get label() { return t('pos.inbox'); } }, { key: 'needs_review', get label() { return t('pos.needs_review_2'); } }, { key: 'approved', get label() { return t('pos.approved'); } }, { key: 'bills', get label() { return t('pos.bills'); } }, { key: 'duplicates', get label() { return t('pos.duplicates'); } }, { key: 'archived', get label() { return t('pos.archived_2'); } }];
const PAYMENT: Array<{ value: string; label: string }> = [{ value: '', get label() { return t('pos.not_set'); } }, { value: 'business_card', get label() { return t('pos.business_card'); } }, { value: 'cash', get label() { return t('pos.cash'); } }, { value: 'check', get label() { return t('pos.check'); } }, { value: 'ach', label: 'ACH' }, { value: 'bank_transfer', get label() { return t('pos.bank_transfer'); } }, { value: 'personal_card', get label() { return t('pos.personal_card_reimburse'); } }, { value: 'other', get label() { return t('pos.other'); } }];
const STATUSES: Array<{ key: string; label: string }> = [{ key: 'draft', get label() { return t('pos.draft_2'); } }, { key: 'pending_review', get label() { return t('pos.needs_review_3'); } }, { key: 'approved', get label() { return t('pos.approved'); } }, { key: 'rejected', get label() { return t('pos.rejected_2'); } }, { key: 'voided', get label() { return t('pos.voided_2'); } }];
const STATUS_COLOR: Record<string, string> = { draft: 'var(--muted)', pending_review: 'var(--aps-orange)', approved: '#2E7D32', rejected: '#C62828', voided: 'var(--muted)' };
const fmtDate = (iso?: string | null) => { if (!iso) return '—'; try { return fmtYmd(iso.slice(0, 10), { month: 'short', day: '2-digit', year: 'numeric' }, iso); } catch { return iso; } };   // calendar day, POS language
const todayInput = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const newKey = () => `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const errCode = (e: unknown): string => String((e as { code?: string })?.code ?? '');
const errMsg = (e: unknown, fallback: string): string => String((e as { message?: string })?.message || fallback);
const EMPTY_FORM = { kind: 'expense' as 'expense' | 'bill', category: '', amount: '', vendor: '', description: '', incurredOn: todayInput(), paymentMethod: '', dueDate: '', invoiceNumber: '' };

type Ask = { id: string; version: number; action: 'reject' | 'void' | 'not_duplicate' | 'duplicate' | 'pay' | 'link_payment'; label: string };

function Kpi({ label, value, color, detail }: { label: string; value: string; color?: string; detail?: React.ReactNode }) {
  return <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{label}</div><div className="v" style={color ? { color } : undefined}>{value}</div>{detail ? <div className="d">{detail}</div> : null}</div>;
}

export function POSExpensesScreen() {
  const can = useCan();
  const canManage = can('owner.expenses.manage'), canApprove = can('owner.expenses.approve'), canExport = can('owner.expenses.export');
  const [tab, setTab] = useState<ExpenseTab>('inbox');
  const [period, setPeriod] = useState('month');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<FinExpense[] | null>(null);
  const [dash, setDash] = useState<FinDashboard | null>(null);
  const [report, setReport] = useState<FinReport | null>(null);
  const [cats, setCats] = useState<FinCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [dupReason, setDupReason] = useState<string | null>(null);   // non-null = the server said "possible duplicate"
  const [ask, setAsk] = useState<Ask | null>(null);
  const [answer, setAnswer] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [list, d, r, c] = await Promise.all([
        posExpensesApi.expenses({ tab, period: tab === 'approved' ? period : undefined, q: search.trim() || undefined }),
        posExpensesApi.dashboard(), posExpensesApi.report(period), posExpensesApi.categories()]);
      setRows(list.items); setDash(d); setReport(r); setCats(c.categories.filter((x) => x.active));
    } catch (e) { setError(reportError(e, 'expenses')); }
    finally { setLoading(false); }
  }, [tab, period, search]);
  useEffect(() => { void load(); }, [load]);

  const label = (key: string) => serverText(cats.find((c) => c.key === key)?.label ?? key);

  // ── receipt upload → the existing Receipt AI pipeline (scan, read, review) ─────────────────────────────────────────
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('upload'); setNote(null); setDone(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      await posAiOcrReceiptApi.upload({ filename: file.name, mimeType: file.type, sizeBytes: file.size, bytes: Array.from(buf), headerBytes: Array.from(buf.slice(0, 16)) });
      setDone(t('people.expenses.receiptUploaded'));
      await load();
    } catch (e) { setNote(errMsg(e, t('people.expenses.err.upload'))); }
    finally { setBusy(null); if (fileRef.current) fileRef.current.value = ''; }
  };

  // ── add an expense by hand ─────────────────────────────────────────────────────────────────────────────────────────
  const suggest = async () => {
    if (!form.vendor.trim() || form.category) return;
    try { const r = await posExpensesApi.recommend(form.vendor.trim()); if (r?.key && r.source !== 'fallback') { setSuggested(r.key); setForm((f) => (f.category ? f : { ...f, category: r.key })); } } catch { /* a suggestion is optional */ }
  };
  const save = async (intent: 'draft' | 'submit' | 'approve', override?: string) => {
    setBusy('create'); setNote(null); setDone(null);
    const amountCents = parseDollarsToCents(form.amount) ?? -1;   // exact shared parser; invalid → rejected below, never mangled
    if (!amountCents || amountCents <= 0 || !form.incurredOn) { setNote(t('pos.enter_a_positive_amount_and_a_13pr')); setBusy(null); return; }
    if (form.kind === 'bill' && !form.dueDate) { setNote(t('pos.a_bill_needs_a_due_date')); setBusy(null); return; }
    try {
      await posExpensesApi.createExpense({
        kind: form.kind, category: form.category || null, amountCents, vendor: form.vendor.trim() || null, description: form.description.trim() || null, incurredOn: form.incurredOn,
        paymentMethod: (form.paymentMethod || null) as FinanceExpenseCreateRequest['paymentMethod'], reimburse: form.paymentMethod === 'personal_card' ? true : null,
        dueDate: form.kind === 'bill' ? form.dueDate : null, invoiceNumber: form.kind === 'bill' ? form.invoiceNumber.trim() || null : null,
        intent, duplicateOverrideReason: override ?? null, idempotencyKey: newKey(),
      });
      setForm({ ...EMPTY_FORM, incurredOn: todayInput() }); setSuggested(null); setDupReason(null); setShowAdd(false);
      setDone(intent === 'approve' ? t('pos.expense_saved_and_approved') : intent === 'submit' ? t('pos.expense_sent_for_review') : t('pos.draft_saved'));
      await load();
    } catch (e) {
      if (errCode(e) === 'RECEIPT_POSSIBLE_DUPLICATE' || errCode(e) === 'RECEIPT_DUPLICATE') setDupReason('');
      setNote(errMsg(e, t('people.expenses.err.add')));
    }
    finally { setBusy(null); }
  };

  // ── row actions ────────────────────────────────────────────────────────────────────────────────────────────────────
  const act = async (id: string, fn: () => Promise<unknown>, ok: string | ((result: unknown) => string)) => {
    setBusy(id); setNote(null); setDone(null);
    try { const r = await fn(); setDone(typeof ok === 'function' ? ok(r) : ok); await load(); }
    catch (e) { setNote(errCode(e) === 'EXPENSE_VERSION_CONFLICT' ? t('pos.someone_else_changed_this_expense_the_1ed3') : errMsg(e, t('people.common.tryAgain'))); if (errCode(e) === 'EXPENSE_VERSION_CONFLICT') await load(); }
    finally { setBusy(null); }
  };
  const confirmAsk = async () => {
    if (!ask) return;
    const a = ask; const text = answer.trim();
    if (a.action === 'pay') {
      const cents = parseDollarsToCents(text) ?? -1;
      if (cents <= 0) { setNote(t('pos.enter_the_amount_paid')); return; }
      setAsk(null); setAnswer('');
      return act(a.id, () => posExpensesApi.billPayment(a.id, cents, newKey()), t('people.expenses.paymentRecorded'));
    }
    if (a.action === 'link_payment') {
      // §62/§63: a person names the statement transaction (its reference or last digits) — stored as MATCHED by a person
      if (!text) { setNote(t('people.expenses.payment.needRef')); return; }
      setAsk(null); setAnswer('');
      return act(a.id, () => posExpensesApi.paymentLink(a.id, { decision: 'confirm', paymentRef: text, version: a.version }), t('people.expenses.payment.linked'));
    }
    if (!text) { setNote(t('pos.say_why_it_is_kept_in_7xdg')); return; }
    setAsk(null); setAnswer('');
    if (a.action === 'reject') return act(a.id, () => posExpensesApi.reject(a.id, text, a.version), t('people.expenses.rejected'));
    if (a.action === 'void') return act(a.id, () => posExpensesApi.voidExpense(a.id, text, a.version), t('people.expenses.voided'));
    return act(a.id, () => posExpensesApi.duplicateDecision(a.id, a.action === 'duplicate' ? 'duplicate' : 'not_duplicate', text), a.action === 'duplicate' ? t('pos.marked_as_a_duplicate_it_will_19nj') : t('pos.kept_marked_as_not_a_duplicate'));
  };
  const exportAs = async (format: 'csv' | 'xlsx') => {
    setBusy(`export-${format}`); setNote(null); setDone(null);
    try { const f = await posExpensesApi.exportFile(format, period); saveExportFile(f); setDone(t('people.expenses.exported')); }
    catch (e) { setNote(errMsg(e, t('people.expenses.err.export'))); }
    finally { setBusy(null); }
  };

  const topCats = (report?.byCategory ?? []).filter((c) => c.totalCents > 0);
  const maxCat = Math.max(1, ...topCats.map((c) => c.totalCents));

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.receipts_expenses')}</h1><div className="sub">{t('pos.snap_a_receipt_approve_it_and_1npq')}</div></div>

      {dash ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3.5 mt-2.5">
          <Kpi label={t('pos.this_month')} value={money(dash.thisMonthCents)} color="var(--aps-orange)" />
          <Kpi label={t('pos.today_2')} value={money(dash.todayCents)} detail={dash.receiptsUploadedToday ? <>{dash.receiptsUploadedToday} {t('pos.receipts_uploaded')}</> : null} />
          <Kpi label={t('pos.needs_review_3')} value={String(dash.needsReview + dash.drafts)} color={dash.needsReview ? 'var(--aps-orange)' : undefined} />
          <Kpi label={t('pos.bills_due')} value={String(dash.billsDue + dash.billsOverdue)} color={dash.billsOverdue ? '#C62828' : undefined} detail={dash.billsOverdue ? <>{dash.billsOverdue} {t('pos.overdue')}</> : null} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 justify-end" style={{ marginTop: 6 }}>
        {canManage ? (
          <>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" style={{ display: 'none' }} aria-label={t('pos.receipt_file')} onChange={(e) => void onFile(e.target.files?.[0])} />
            <button className="btn primary" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}>{busy === 'upload' ? t('pos.uploading') : t('pos.upload_receipt')}</button>
            <button className="btn" onClick={() => { setShowAdd(true); setNote(null); setDone(null); }}>{t('pos.add_expense')}</button>
          </>
        ) : null}
        {canExport ? (
          <>
            <button className="btn ghost" disabled={busy === 'export-csv'} onClick={() => void exportAs('csv')}>{t('pos.export_csv')}</button>
            <button className="btn ghost" disabled={busy === 'export-xlsx'} onClick={() => void exportAs('xlsx')}>{t('pos.export_excel')}</button>
          </>
        ) : null}
        <Link className="btn ghost" to="/tenant/ai/ocr-receipt">{t('pos.receipt_ai_review')}</Link>
      </div>
      {/* Receipt mandate §162 (Oct 28 2026): the export is bookkeeping, not tax advice */}
      {canExport ? <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('people.expenses.exportDisclaimer')}</div> : null}
      {note ? <div className="err" role="alert" style={{ marginTop: 10 }}>{note}</div> : null}
      {done ? <div className="ok" role="status" style={{ marginTop: 10 }}>{done}</div> : null}

      {showAdd ? (
        <section className="panel" style={{ marginTop: 10 }}>
          <div className="flex justify-between items-center mb-4 border-b border-[#E7DCC9] pb-3">
            <div className="p-h" style={{ margin: 0 }}>{t('pos.add_expense_2')}</div>
            <button className="btn ghost" style={{ height: 32, padding: '0 12px', fontSize: 11.5 }} onClick={() => { setShowAdd(false); setDupReason(null); }}>{t('pos.close')}</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">
            <label className="lf !mb-0"><span>{t('pos.type')}</span><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value === 'bill' ? 'bill' : 'expense' })}><option value="expense">{t('pos.expense_already_paid')}</option><option value="bill">{t('pos.bill_to_pay_later')}</option></select></label>
            <label className="lf !mb-0"><span>{t('pos.amount_2')}</span><input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></label>
            <label className="lf !mb-0"><span>{t('pos.date')}</span><input type="date" value={form.incurredOn} onChange={(e) => setForm({ ...form, incurredOn: e.target.value })} /></label>
            <label className="lf !mb-0"><span>{t('pos.vendor')}</span><input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} onBlur={() => void suggest()} placeholder={t('pos.e_g_sally_beauty')} /></label>
            <label className="lf !mb-0"><span>{t('pos.category')}</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">{t('pos.choose_for_me')}</option>
                {cats.map((c) => <option key={c.key} value={c.key}>{serverText(c.label)}</option>)}
              </select>
              {suggested && form.category === suggested ? <small style={{ color: 'var(--muted)' }}>{t('pos.suggested_from_the_vendor')}</small> : null}
            </label>
            <label className="lf !mb-0"><span>{t('pos.paid_with')}</span><select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>{PAYMENT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
            {form.kind === 'bill' ? (
              <>
                <label className="lf !mb-0"><span>{t('pos.due_date')}</span><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
                <label className="lf !mb-0"><span>{t('pos.invoice')}</span><input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} /></label>
              </>
            ) : null}
            <label className="lf !mb-0 sm:col-span-2 md:col-span-4"><span>{t('pos.description')}</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('pos.brief_description_of_the_expense')} /></label>
          </div>
          {dupReason !== null ? (
            <div className="panel" style={{ marginTop: 12, borderColor: 'var(--aps-orange)' }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('pos.this_looks_like_an_expense_already_1fow')}</div>
              <label className="lf !mb-0"><span>{t('pos.why_is_it_not_a_duplicate')}</span><input value={dupReason} onChange={(e) => setDupReason(e.target.value)} placeholder={t('pos.e_g_two_separate_deliveries_the_e5gr')} /></label>
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy === 'create' || !dupReason.trim()} onClick={() => void save(canApprove ? 'approve' : 'submit', dupReason.trim())}>{t('pos.save_anyway')}</button></div>
            </div>
          ) : null}
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost" disabled={busy === 'create'} onClick={() => void save('draft')}>{t('pos.save_draft_2')}</button>
            {canApprove
              ? <button className="btn primary" disabled={busy === 'create'} onClick={() => void save('approve')}>{busy === 'create' ? t('pos.adding') : t('pos.add_expense_2')}</button>
              : <button className="btn primary" disabled={busy === 'create'} onClick={() => void save('submit')}>{busy === 'create' ? t('pos.adding') : t('pos.send_for_approval')}</button>}
          </div>
        </section>
      ) : null}

      {ask ? (
        <section className="panel" style={{ marginTop: 10 }}>
          <div className="p-h" style={{ margin: 0 }}>{ask.label}</div>
          <div className="flex gap-2 items-end" style={{ marginTop: 8 }}>
            <label className="lf !mb-0" style={{ flex: 1 }}><span>{ask.action === 'pay' ? t('pos.amount_paid') : t('pos.reason_2')}</span><input value={answer} onChange={(e) => setAnswer(e.target.value)} type={ask.action === 'pay' ? 'number' : 'text'} /></label>
            <button className="btn primary" onClick={() => void confirmAsk()}>{t('pos.confirm')}</button>
            <button className="btn ghost" onClick={() => { setAsk(null); setAnswer(''); }}>{t('pos.cancel')}</button>
          </div>
        </section>
      ) : null}

      <div className="overflow-x-auto" style={{ marginTop: 12 }}>
        <div className="flex gap-1.5" role="tablist" style={{ minWidth: 520 }}>
          {TABS.map(({ key: k, label: l }) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'btn primary' : 'btn ghost'} style={{ minHeight: 40 }} onClick={() => setTab(k)}>
              {l}{k === 'needs_review' && dash?.needsReview ? ` (${dash.needsReview})` : k === 'duplicates' && dash?.possibleDuplicates ? ` (${dash.possibleDuplicates})` : k === 'bills' && dash && dash.billsDue + dash.billsOverdue ? ` (${dash.billsDue + dash.billsOverdue})` : ''}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between" style={{ marginTop: 8 }}>
        <PeriodTabs period={period} onChange={setPeriod} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('pos.search_vendor_note_invoice')} aria-label={t('pos.search_expenses')} style={{ minHeight: 40, minWidth: 220 }} />
      </div>

      {loading ? <div className="state" style={{ marginTop: 12 }}>{t('pos.loading_expenses')}</div>
        : error ? <div className="err" style={{ marginTop: 12 }}>{error}</div>
        : (
        <>
          <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
            {!rows || rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.nothing_here')}</div> : (
              <div className="overflow-x-auto">
                <div className="min-w-[720px]">
                  <table className="tbl">
                    <thead><tr><th>{t('pos.date')}</th><th>{t('pos.vendor')}</th><th>{t('pos.category')}</th><th>{t('pos.status')}</th><th style={{ textAlign: 'right' }}>{t('pos.amount_2')}</th><th style={{ width: 230 }}></th></tr></thead>
                    <tbody>{rows.map((x) => (
                      <tr key={x.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(x.incurredOn)}{x.kind === 'bill' && x.dueDate ? <div style={{ fontSize: 11, color: x.billDue === 'overdue' ? '#C62828' : 'var(--muted)' }}>{t('pos.due')}{' '}{fmtDate(x.dueDate)}</div> : null}</td>
                        <td>{x.vendorDisplay || x.vendor || <span style={{ color: 'var(--muted)' }}>—</span>}{x.description ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{x.description}</div> : null}</td>
                        <td style={{ fontWeight: 700 }}>{x.categoryLabel ? serverText(x.categoryLabel) : label(x.category)}</td>
                        <td>
                          <span style={{ color: STATUS_COLOR[x.status], fontWeight: 700 }}>{STATUSES.find((st) => st.key === x.status)?.label ?? x.status}</span>
                          {x.duplicateStatus === 'possible' || x.duplicateStatus === 'exact' ? <div style={{ fontSize: 11, color: '#C62828' }}>{t('pos.possible_duplicate')}</div> : null}
                          {x.receiptDocumentId ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('pos.receipt_attached')}</div> : null}
                          {x.paymentMatchStatus ? <div style={{ fontSize: 11, color: x.paymentMatchStatus === 'matched' ? '#2E7D32' : 'var(--muted)' }}>{x.paymentMatchStatus === 'matched' ? t('people.expenses.payment.matched', { ref: x.matchedPaymentRef ?? '' }) : x.paymentMatchStatus === 'possible_match' ? t('people.expenses.payment.possible') : t('people.expenses.payment.unmatched')}</div> : null}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(x.amountCents)}{x.kind === 'bill' && x.openCents ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{money(x.openCents)} {t('pos.open_4')}</div> : null}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="flex gap-1 justify-end flex-wrap">
                            {canManage && x.status === 'draft' ? <button className="btn ghost" disabled={busy === x.id} onClick={() => void act(x.id, () => posExpensesApi.submit(x.id, x.version), t('people.expenses.sentForReview'))}>{t('pos.send')}</button> : null}
                            {canApprove && (x.status === 'pending_review' || x.status === 'draft') && x.duplicateStatus !== 'possible' && x.duplicateStatus !== 'exact' ? <button className="btn primary" disabled={busy === x.id} onClick={() => void act(x.id, () => posExpensesApi.approve(x.id, x.version), t('people.expenses.approved'))}>{t('pos.approve')}</button> : null}
                            {canApprove && (x.duplicateStatus === 'possible' || x.duplicateStatus === 'exact') ? (
                              <>
                                <button className="btn ghost" disabled={busy === x.id} onClick={() => setAsk({ id: x.id, version: x.version, action: 'not_duplicate', label: t('pos.keep_it_why_is_it_not_xhae') })}>{t('pos.not_a_duplicate')}</button>
                                <button className="btn ghost" disabled={busy === x.id} onClick={() => setAsk({ id: x.id, version: x.version, action: 'duplicate', label: t('pos.mark_as_duplicate_why') })}>{t('pos.duplicate')}</button>
                              </>
                            ) : null}
                            {canApprove && x.status === 'pending_review' ? <button className="btn ghost" disabled={busy === x.id} onClick={() => setAsk({ id: x.id, version: x.version, action: 'reject', label: t('pos.reject_this_expense_why') })}>{t('pos.reject')}</button> : null}
                            {canManage && x.kind === 'bill' && x.status === 'approved' && x.openCents > 0 ? <button className="btn ghost" disabled={busy === x.id} onClick={() => setAsk({ id: x.id, version: x.version, action: 'pay', label: t('pos.record_a_bill_payment') })}>{t('pos.pay_2')}</button> : null}
                            {canApprove && x.status === 'approved' ? <button className="btn ghost" disabled={busy === x.id} onClick={() => setAsk({ id: x.id, version: x.version, action: 'void', label: t('pos.void_this_expense_why') })}>{t('pos.void')}</button> : null}
                            {/* §62/§63 (Oct 27 2026): the payment behind an approved expense — looked up (UNMATCHED honestly without a transaction feed) or named by a person */}
                            {canManage && x.status === 'approved' && x.paymentMatchStatus !== 'matched' ? <button className="btn ghost" disabled={busy === x.id} onClick={() => void act(x.id, () => posExpensesApi.paymentMatch(x.id), (r) => { const v = (r as { verdict?: string })?.verdict; return v === 'matched' ? t('people.expenses.payment.found') : v === 'possible_match' ? t('people.expenses.payment.possible') : t('people.expenses.payment.none'); })}>{t('people.expenses.payment.find')}</button> : null}
                            {canManage && x.status === 'approved' && x.paymentMatchStatus !== 'matched' ? <button className="btn ghost" disabled={busy === x.id} onClick={() => setAsk({ id: x.id, version: x.version, action: 'link_payment', label: t('people.expenses.payment.linkWhich') })}>{t('people.expenses.payment.link')}</button> : null}
                            {canManage && x.status === 'draft' ? <button className="btn ghost" disabled={busy === x.id} onClick={() => void act(x.id, () => posExpensesApi.deleteDraft(x.id), t('people.expenses.draftDeleted'))}>{t('pos.delete')}</button> : null}
                            {canManage && x.status !== 'draft' && !x.archivedAt ? <button className="btn ghost" disabled={busy === x.id} onClick={() => void act(x.id, () => posExpensesApi.archive(x.id), t('people.common.archived'))}>{t('pos.archive')}</button> : null}
                            {canManage && x.archivedAt ? <button className="btn ghost" disabled={busy === x.id} onClick={() => void act(x.id, () => posExpensesApi.restore(x.id), t('people.common.restored'))}>{t('pos.restore')}</button> : null}
                          </div>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {report ? (
            <section className="panel" style={{ marginTop: 12 }}>
              <div className="flex justify-between items-baseline flex-wrap gap-2">
                <div className="p-h" style={{ margin: 0 }}>{t('pos.where_the_money_went')}</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{money(report.totalCents)}{report.changePct != null ? <span style={{ fontSize: 12, marginLeft: 8, color: report.changePct > 0 ? '#C62828' : '#2E7D32' }}>{report.changePct > 0 ? '+' : ''}{report.changePct}%</span> : null}</div>
              </div>
              {topCats.length === 0 ? <div className="state" style={{ padding: '12px 0' }}>{t('pos.no_approved_expenses_in_this_period')}</div> : (
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  {topCats.map((c) => (
                    <div key={c.key} className="flex items-center gap-2">
                      <div style={{ width: 150, fontSize: 13 }}>{serverText(c.label)}</div>
                      <div style={{ flex: 1, background: '#F3ECE1', borderRadius: 4, height: 10 }}><div style={{ width: `${Math.round((c.totalCents / maxCat) * 100)}%`, background: 'var(--aps-orange)', height: 10, borderRadius: 4 }} /></div>
                      <div style={{ width: 100, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{money(c.totalCents)}</div>
                    </div>
                  ))}
                </div>
              )}
              {report.insights.length ? <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 13 }}>{report.insights.map((s) => <li key={s}>{serverText(s)}</li>)}</ul> : null}
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>{t('pos.only_approved_expenses_are_counted_drafts_1m5r')}</div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
