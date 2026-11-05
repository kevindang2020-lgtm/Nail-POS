import { useCallback, useEffect, useRef, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { ownerFinanceExpensesApi as fin, type FinanceCategory, type FinanceDashboard, type FinanceExpense, type FinanceInboxTab, type FinanceReport, type FinanceRule, type FinanceSettings, type FinanceVendorSpend, type FinanceImportRow, type OwnerPeriod } from '../api/ownerApi';
import { PeriodSelector } from '../components/PeriodSelector';
import { useOwnerNav } from '../shell/nav';
import { OwnerSkeletonBlocks } from '../components/OwnerSkeleton';
import { centsToUsd } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display
// Receipt / Expense mandate §155–§157 (Oct 27 2026): offline, a receipt photo is held encrypted on the phone and uploaded on reconnect
import { createReceiptCaptureQueue, isOffline, CaptureUnavailableError, type ReceiptCaptureQueue, type CaptureSummary } from '@aipowersalon/mobile-sdk';

// ExpensesScreen — the Owner App's Receipts & Expenses (Receipt/Expense/OCR/Accounting mandate, Oct 21 2026). Snap a receipt
// (camera, photo or PDF → the Receipt AI pipeline; a person reviews, nothing posts on its own), approve what is waiting,
// pay bills, see where the money went by category, export for the accountant, and teach the salon's vendor → category
// rules. Every figure comes from the finance module and counts APPROVED expenses only — the same number the P&L uses.
const money = (c: number) => centsToUsd(c);
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const newKey = () => `owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const errCode = (e: unknown) => String((e as { code?: string })?.code ?? '');
const errStatus = (e: unknown) => Number((e as { status?: number })?.status ?? 0);
const errMsg = (e: unknown, fallback: string) => String((e as { message?: string })?.message || fallback);
const TABS: Array<{ key: FinanceInboxTab; label: string }> = [{ key: 'needs_review', label: 'Review' }, { key: 'approved', label: 'Approved' }, { key: 'bills', label: 'Bills' }, { key: 'duplicates', label: 'Duplicates' }];
const STATUS: Record<string, string> = { draft: 'Draft', pending_review: 'Needs review', approved: 'Approved', rejected: 'Rejected', voided: 'Voided' };
/** the payment methods an expense records (the POS Expenses list uses the same values) */
const PAY_METHODS: Array<[string, string]> = [['business_card', 'Business card'], ['cash', 'Cash'], ['check', 'Check'], ['ach', 'ACH'], ['bank_transfer', 'Bank transfer'], ['personal_card', 'Personal card (reimburse)'], ['other', 'Other']];
const EMPTY = { kind: 'expense' as 'expense' | 'bill', category: '', amount: '', incurredOn: todayStr(), vendor: '', description: '', dueDate: '' };
type Ask = { e: FinanceExpense; action: 'reject' | 'void' | 'not_duplicate' | 'duplicate' | 'pay' };

/** a pasted / chosen CSV (header row: date, vendor, amount, category, branch, description) → rows; quoted cells allowed */
export function parseExpenseCsv(text: string): FinanceImportRow[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const cells = (l: string) => { const out: string[] = []; let cur = ''; let q = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map((x) => x.trim()); };
  if (!lines.length) return [];
  const head = cells(lines[0]).map((h) => h.toLowerCase());
  const at = (r: string[], k: string) => { const i = head.indexOf(k); return i >= 0 ? r[i] ?? '' : ''; };
  return lines.slice(1).map((l) => { const r = cells(l); return { date: at(r, 'date'), vendor: at(r, 'vendor'), amount: at(r, 'amount'), category: at(r, 'category') || null, branch: at(r, 'branch') || null, description: at(r, 'description') || null }; });
}

function saveFile(f: { filename: string; contentType: string; content: string }) {
  const bin = atob(f.content); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: f.contentType }));
  const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExpensesScreen() {
  const { back } = useOwnerNav();
  const { effectiveBranchId, branches = [] } = useOwnerBranch();
  const [period, setPeriod] = useState<OwnerPeriod>('month');
  const [tab, setTab] = useState<FinanceInboxTab>('needs_review');
  // §87: list filters, applied on the server (category / vendor / payment method / search)
  const [fq, setFq] = useState(''); const [fqApplied, setFqApplied] = useState('');
  const [fCat, setFCat] = useState(''); const [fMethod, setFMethod] = useState(''); const [fVendor, setFVendor] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { const t = setTimeout(() => setFqApplied(fq.trim()), 300); return () => clearTimeout(t); }, [fq]);
  const [rows, setRows] = useState<FinanceExpense[] | null>(null);
  const [dash, setDash] = useState<FinanceDashboard | null>(null);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [cats, setCats] = useState<FinanceCategory[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [dupReason, setDupReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [answer, setAnswer] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [rules, setRules] = useState<FinanceRule[]>([]);
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [sharesDraft, setSharesDraft] = useState<Pick<FinanceSettings, 'sharedCostPolicy' | 'sharedCostShares'> | null>(null);   // P2-3
  const [rule, setRule] = useState({ vendor: '', categoryKey: '' });
  const [dupHint, setDupHint] = useState<string | null>(null);
  const [spend, setSpend] = useState<Record<string, FinanceVendorSpend>>({});
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [bulkCat, setBulkCat] = useState('');
  const [newCat, setNewCat] = useState('');
  const [importRows, setImportRows] = useState<FinanceImportRow[] | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  // Oct 27 2026: §18 several photos → one receipt or several; §26 "difficult to read" guidance; §111 progress; §155 the offline queue; §83 rules
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [quality, setQuality] = useState<{ documentId: string; flags: string[]; deferred: boolean } | null>(null);
  // §142: the expense this uploaded receipt could be the evidence for (MATCHED / POSSIBLE_MATCH) — a person decides to link it
  const [suggest, setSuggest] = useState<{ documentId: string; expenseId: string; verdict: 'matched' | 'possible_match' } | null>(null);
  const [queued, setQueued] = useState<CaptureSummary[]>([]);
  const [autoRule, setAutoRule] = useState({ vendor: '', max: '' });
  const attachRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    Promise.all([fin.list(tab, tab === 'approved' ? period : undefined, effectiveBranchId, { q: fqApplied || undefined, category: fCat || undefined, paymentMethod: fMethod || undefined, vendorId: fVendor?.id }), fin.dashboard(effectiveBranchId), fin.report(period, effectiveBranchId), fin.categories()])
      .then(([l, d, r, c]) => { setRows(l.items); setDash(d); setReport(r); setCats(c.categories.filter((x) => x.active)); })
      .catch((e: unknown) => setErr(errStatus(e) === 403 ? 'You do not have access to expenses.' : errMsg(e, 'Unable to load expenses.')))
      .finally(() => setLoading(false));
  }, [tab, period, effectiveBranchId, fqApplied, fCat, fMethod, fVendor]);
  useEffect(() => { load(); }, [load]);

  const label = (key: string) => cats.find((c) => c.key === key)?.label ?? key;

  const payload = async (file: File) => { const buf = new Uint8Array(await file.arrayBuffer()); return { filename: file.name, mimeType: file.type, sizeBytes: file.size, bytes: Array.from(buf), headerBytes: Array.from(buf.slice(0, 16)) }; };
  const queue = useRef<ReceiptCaptureQueue | null>(null);
  const captureQueue = () => (queue.current ??= createReceiptCaptureQueue());
  const refreshQueue = useCallback(() => captureQueue().pending().then(setQueued).catch(() => setQueued([])), []);
  const uploader = useCallback((f: { filename: string; mimeType: string; sizeBytes: number; bytes: Uint8Array; source: string }) =>
    fin.uploadReceipt({ filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, bytes: Array.from(f.bytes), headerBytes: Array.from(f.bytes.slice(0, 16)), source: f.source === 'mobile_camera' ? 'mobile_camera' : 'owner_app_upload' }).then((r) => ({ documentId: r.documentId })), []);
  useEffect(() => { void refreshQueue(); return captureQueue().bindReconnect(uploader, (r) => { void refreshQueue(); if (r.uploaded.length) { setNote(`${r.uploaded.length} receipt${r.uploaded.length === 1 ? '' : 's'} from this phone uploaded.`); load(); } }); }, [refreshQueue, uploader, load]);
  const isNetworkError = (e: unknown) => isOffline() || e instanceof TypeError || (e as { status?: number })?.status === 0;
  /** §155: hold the photos on the phone (encrypted); nothing is recorded until the backend confirms the upload */
  const holdOffline = async (files: File[], source: 'mobile_camera' | 'owner_app_upload') => {
    try {
      for (const f of files) await captureQueue().enqueue({ filename: f.name, mimeType: f.type, bytes: new Uint8Array(await f.arrayBuffer()), source });
      await refreshQueue();
      setNote(`No connection — ${files.length} receipt${files.length === 1 ? '' : 's'} saved on this phone, encrypted. They upload when you are back online; nothing is recorded until then.`);
    } catch (e) { setNote(e instanceof CaptureUnavailableError ? e.message : errMsg(e, 'Could not save the receipt on this phone.')); }
  };
  const syncQueue = async () => { setBusy(true); try { const r = await captureQueue().sync(uploader); await refreshQueue(); if (r.uploaded.length) { setNote(`${r.uploaded.length} uploaded.`); load(); } else if (r.failed.length) setNote('Still no connection — the receipts stay on this phone.'); } finally { setBusy(false); } };
  /** one or several photos: `combine` = page 2, 3 … of ONE receipt (never a second expense); otherwise one receipt each */
  const sendFiles = async (files: File[], combine: boolean, source: 'mobile_camera' | 'owner_app_upload') => {
    setPendingFiles(null); setQuality(null);
    if (!files.length) return;
    if (isOffline()) { await holdOffline(files, source); return; }
    setBusy(true); setNote(null);
    try {
      if (combine) {
        setProgress(`Uploading page 1 of ${files.length}…`);
        const first = await fin.uploadReceipt({ ...(await payload(files[0])), source, deferExtraction: true });
        const flags = new Set<string>(first.quality?.flags ?? []);
        for (let i = 1; i < files.length; i++) { setProgress(`Uploading page ${i + 1} of ${files.length}…`); const p = await fin.addReceiptPage(first.documentId, await payload(files[i])); for (const f of p.quality?.flags ?? []) flags.add(f); }
        if (flags.size) { setQuality({ documentId: first.documentId, flags: [...flags], deferred: true }); return; }
        setProgress('Reading the receipt…');
        await fin.readReceipt(first.documentId).catch(() => undefined);   // no provider → it waits for manual entry; honest, not an error here
        await askSuggestion(first.documentId);
        setNote(`Receipt uploaded (${files.length} pages). It is being read now — it appears under Review once someone checks it.`);
        load(); return;
      }
      let difficult: { documentId: string; flags: string[] } | null = null;
      for (let i = 0; i < files.length; i++) {
        setProgress(files.length > 1 ? `Uploading receipt ${i + 1} of ${files.length}…` : 'Uploading…');
        const r = await fin.uploadReceipt({ ...(await payload(files[i])), source });
        if (files.length === 1 && !r.quality?.difficult) await askSuggestion(r.documentId);
        if (r.quality?.difficult) { const prior: string[] = difficult ? difficult.flags : []; difficult = { documentId: r.documentId, flags: [...new Set([...prior, ...r.quality.flags])] }; }
      }
      if (difficult) { setQuality({ ...difficult, deferred: false }); return; }
      setNote(files.length > 1 ? `${files.length} receipts uploaded. They are being read now.` : 'Receipt uploaded. It is being read now — it appears under Review once someone checks it.');
      load();
    } catch (e) { if (isNetworkError(e)) { await holdOffline(files, source); return; } setNote(errMsg(e, 'Could not upload the receipt.')); }
    finally { setBusy(false); setProgress(null); if (camRef.current) camRef.current.value = ''; if (fileRef.current) fileRef.current.value = ''; }
  };
  const onReceipt = async (list: FileList | null, source: 'mobile_camera' | 'owner_app_upload') => {
    const files = Array.from(list ?? []);
    if (files.length > 1) { setPendingFiles(files); if (fileRef.current) fileRef.current.value = ''; return; }
    await sendFiles(files, false, source);
  };
  /** §142: ask finance whether the receipt matches an expense already recorded (best effort — no suggestion is not an error) */
  const askSuggestion = async (documentId: string) => {
    let s2: Awaited<ReturnType<typeof fin.suggestedExpense>> | null = null;
    try { s2 = await fin.suggestedExpense(documentId); } catch { return; }   // a suggestion is optional: its failure never fails the upload
    if (s2 && s2.expenseId && (s2.verdict === 'matched' || s2.verdict === 'possible_match')) setSuggest({ documentId, expenseId: s2.expenseId, verdict: s2.verdict });
  };
  const linkSuggested = async () => {
    if (!suggest) return;
    const sg = suggest; setSuggest(null); setBusy(true);
    try { await fin.linkReceipt(sg.expenseId, sg.documentId); setNote('Receipt linked to that expense.'); load(); }
    catch (e) { setNote(errMsg(e, 'Could not link the receipt.')); }
    finally { setBusy(false); }
  };
  const processAnyway = async () => {
    if (!quality) return;
    const q = quality; setQuality(null);
    if (q.deferred) { setBusy(true); try { await fin.readReceipt(q.documentId).catch(() => undefined); } finally { setBusy(false); } }
    await askSuggestion(q.documentId);
    setNote('Receipt uploaded. It is being read now — it appears under Review once someone checks it.');
    load();
  };
  const QUALITY_LABEL: Record<string, string> = { low_resolution: 'low resolution', too_dark: 'too dark', washed_out: 'washed out', low_contrast: 'low contrast', likely_blurry: 'looks blurry', tiny_file: 'very small file', multiple_receipts: 'more than one receipt in the picture' };

  /** before saving: does this look like one already recorded? (a hint — the server decides on save) */
  const precheck = async () => {
    const cents = parseDollarsToCents(form.amount);
    if (cents == null || cents <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(form.incurredOn)) return;
    try { const r = await fin.checkDuplicates({ vendor: form.vendor.trim() || null, incurredOn: form.incurredOn, amountCents: cents }); setDupHint(r.status === 'none' ? null : 'This may already be recorded — check the list before saving.'); } catch { setDupHint(null); }
  };
  const submit = (override?: string) => {
    const cents = parseDollarsToCents(form.amount);              // null on invalid — never a silent $0.00
    if (!form.amount || cents == null || cents <= 0) { setFormErr('Enter a valid amount.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.incurredOn)) { setFormErr('Enter a valid date.'); return; }
    if (form.kind === 'bill' && !/^\d{4}-\d{2}-\d{2}$/.test(form.dueDate)) { setFormErr('A bill needs a due date.'); return; }
    setBusy(true); setFormErr(null);
    fin.create({ kind: form.kind, category: form.category || null, amountCents: cents, incurredOn: form.incurredOn, vendor: form.vendor.trim() || null, description: form.description.trim() || null,
      branchId: effectiveBranchId ?? null, dueDate: form.kind === 'bill' ? form.dueDate : null, intent: 'approve', duplicateOverrideReason: override ?? null, idempotencyKey: newKey() })
      .then(() => { setAdding(false); setDupReason(null); setForm({ ...EMPTY, incurredOn: todayStr() }); setNote('Expense saved.'); load(); })
      .catch((e: unknown) => {
        if (errCode(e) === 'RECEIPT_POSSIBLE_DUPLICATE' || errCode(e) === 'RECEIPT_DUPLICATE') setDupReason('');
        setFormErr(errStatus(e) === 403 ? 'You cannot add expenses.' : errMsg(e, 'Could not save.'));
      })
      .finally(() => setBusy(false));
  };

  const act = (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setNote(null);
    fn().then(() => { setNote(ok); load(); })
      .catch((e: unknown) => { setNote(errCode(e) === 'EXPENSE_VERSION_CONFLICT' ? 'Someone else changed this expense. Refreshed — try again.' : errMsg(e, 'That did not work.')); load(); })
      .finally(() => setBusy(false));
  };
  const confirm = () => {
    if (!ask) return;
    const { e, action } = ask; const text = answer.trim();
    if (action === 'pay') {
      const cents = parseDollarsToCents(text);
      if (cents == null || cents <= 0) { setNote('Enter the amount paid.'); return; }
      setAsk(null); setAnswer(''); return act(() => fin.billPayment(e.id, cents, newKey()), 'Payment recorded.');
    }
    if (!text) { setNote('Say why — it is kept in the expense history.'); return; }
    setAsk(null); setAnswer('');
    if (action === 'reject') return act(() => fin.reject(e.id, text, e.version), 'Rejected.');
    if (action === 'void') return act(() => fin.voidExpense(e.id, text, e.version), 'Voided. It no longer counts.');
    return act(() => fin.duplicateDecision(e.id, action === 'duplicate' ? 'duplicate' : 'not_duplicate', text), action === 'duplicate' ? 'Marked as a duplicate.' : 'Kept — not a duplicate.');
  };
  const onAttach = async (file: File | undefined) => {
    const id = attachFor; setAttachFor(null);
    if (!file || !id) return;
    setBusy(true); setNote(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const up = await fin.uploadReceipt({ filename: file.name, mimeType: file.type, sizeBytes: file.size, bytes: Array.from(buf), headerBytes: Array.from(buf.slice(0, 16)) });
      await fin.attach(id, up.documentId);
      setNote('Receipt attached.'); load();
    } catch (e) { setNote(errMsg(e, 'Could not attach the receipt.')); }
    finally { setBusy(false); if (attachRef.current) attachRef.current.value = ''; }
  };
  const vendorHistory = (vendorId: string) => fin.vendorSpend(vendorId, effectiveBranchId).then((v) => setSpend((m) => ({ ...m, [vendorId]: v }))).catch((e: unknown) => setNote(errMsg(e, 'Could not load the vendor.')));
  const openIds = (rows ?? []).filter((x) => x.status === 'pending_review' || x.status === 'draft').map((x) => x.id);
  const bulkApprove = () => {
    setBusy(true); setNote(null);
    fin.batchApprove((rows ?? []).filter((x) => x.status === 'pending_review').map((x) => x.id))
      .then((r) => { setNote(`${r.approved?.length ?? 0} approved${r.exceptions?.length ? ` · ${r.exceptions.length} need a look` : ''}.`); load(); })
      .catch((e: unknown) => setNote(errMsg(e, 'That did not work.'))).finally(() => setBusy(false));
  };
  const bulkCategorize = (key: string) => { if (!key || !openIds.length) return; setBulkCat(''); act(() => fin.batchCategorize(openIds, key), 'Category set for the waiting expenses.'); };
  const addCategory = () => { const l = newCat.trim(); if (!l) return; setNewCat(''); act(() => fin.addCategory(l), 'Category added.'); };
  const onCsv = async (file: File | undefined) => {
    if (!file) return;
    const rowsIn = parseExpenseCsv(await file.text());
    if (csvRef.current) csvRef.current.value = '';
    if (!rowsIn.length) { setImportInfo('That file has no rows.'); return; }
    try {
      const dry = await fin.importRows(rowsIn, true);
      setImportRows(dry.accepted ? rowsIn : null);
      setImportInfo(`${dry.accepted} of ${rowsIn.length} rows are ready${dry.rejected.length ? ` · not imported: ${dry.rejected.slice(0, 5).map((r) => `row ${r.row} (${r.reason})`).join(', ')}` : ''}.`);
    } catch (e) { setImportInfo(errMsg(e, 'Could not read that file.')); }
  };
  const runImport = () => { const r = importRows; if (!r) return; setImportRows(null); act(async () => { const x = await fin.importRows(r, false); setImportInfo(`${x.created} expenses imported.`); }, 'Import finished.'); };
  const recategorize = (e: FinanceExpense, category: string) => act(() => fin.update(e.id, { category, version: e.version }), 'Category changed.');
  const exportAs = (format: 'csv' | 'xlsx') => {
    setBusy(true); setNote(null);
    fin.exportFile(format, period, effectiveBranchId).then((f) => { saveFile(f); setNote('Export downloaded.'); })
      .catch((e: unknown) => setNote(errMsg(e, 'Could not export.'))).finally(() => setBusy(false));
  };

  const openRules = () => {
    setShowRules((v) => !v);
    Promise.all([fin.rules(), fin.settings()]).then(([r, s]) => { setRules(r.rules.filter((x) => x.active)); setSettings(s); }).catch((e: unknown) => setNote(errMsg(e, 'Could not load the rules.')));
  };
  const addRule = () => {
    if (!rule.vendor.trim() || !rule.categoryKey) { setNote('Pick a vendor and a category.'); return; }
    act(async () => { await fin.addRule(rule.vendor.trim(), rule.categoryKey); setRule({ vendor: '', categoryKey: '' }); setRules((await fin.rules()).rules.filter((x) => x.active)); }, 'Rule saved — future receipts from this vendor use it.');
  };
  const removeRule = (id: string) => act(async () => { await fin.removeRule(id); setRules((await fin.rules()).rules.filter((x) => x.active)); }, 'Rule removed.');
  const toggle = (k: 'requireApproval' | 'duplicateDetection' | 'learnFromCorrections' | 'notifyNeedsReview' | 'notifyBillDue' | 'notifyDuplicate' | 'notifyWeeklySummary' | 'notifyMonthlySummary') => {
    if (!settings) return;
    act(async () => setSettings(await fin.saveSettings({ [k]: !settings[k], version: settings.version })), 'Settings saved.');
  };
  /** §83: the owner's low-risk auto-approval rules — a trusted vendor at or under a threshold, receipt-backed, clean money only */
  const saveAutoRules = (rules: Array<{ vendor: string; maxCents: number; categoryKey?: string | null }>) => {
    if (!settings) return;
    act(async () => { setSettings(await fin.saveSettings({ autoApprovalRules: rules, version: settings.version })); setAutoRule({ vendor: '', max: '' }); }, 'Auto-approval rules saved.');
  };
  const addAutoRule = () => {
    if (!settings) return;
    const cents = parseDollarsToCents(autoRule.max);
    if (!autoRule.vendor.trim() || cents == null || cents <= 0) { setNote('Name the vendor and the amount up to which its receipts are approved automatically.'); return; }
    saveAutoRules([...settings.autoApprovalRules.map((r) => ({ vendor: r.vendorNorm, maxCents: r.maxCents, categoryKey: r.categoryKey ?? null })), { vendor: autoRule.vendor.trim(), maxCents: cents }]);
  };
  const removeAutoRule = (vendorNorm: string) => { if (!settings) return; saveAutoRules(settings.autoApprovalRules.filter((r) => r.vendorNorm !== vendorNorm).map((r) => ({ vendor: r.vendorNorm, maxCents: r.maxCents, categoryKey: r.categoryKey ?? null }))); };
  const renameCategory = (c: FinanceCategory) => {
    const next = answer.trim(); if (!next) return;
    setAnswer(''); act(() => fin.renameCategory(c.key, next), 'Category renamed.');
  };

  const topCats = (report?.byCategory ?? []).filter((c) => c.totalCents > 0);
  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Expenses</div></div>
        <button className="owner-iconbtn" aria-label="Add expense" onClick={() => { setAdding((v) => !v); setFormErr(null); setDupReason(null); }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--owner-primary)" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </header>

      <div style={{ padding: '0 16px', display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} aria-label="Take a photo of a receipt" onChange={(e) => void onReceipt(e.target.files, 'mobile_camera')} />
          <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" style={{ display: 'none' }} aria-label="Choose a receipt photo or PDF" onChange={(e) => void onReceipt(e.target.files, 'owner_app_upload')} />
          <input ref={attachRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} aria-label="Attach a receipt to this expense" onChange={(e) => void onAttach(e.target.files?.[0])} />
          <button className="owner-actbtn primary" style={{ flex: 1, minHeight: 44 }} disabled={busy} onClick={() => camRef.current?.click()}>Snap receipt</button>
          <button className="owner-actbtn" style={{ flex: 1, minHeight: 44 }} disabled={busy} onClick={() => fileRef.current?.click()}>Photo or PDF</button>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
        {progress && <div role="status" className="muted" style={{ fontSize: 12.5 }}>{progress}</div>}
        {note && <div role="status" className="muted" style={{ fontSize: 12.5 }}>{note}</div>}
        {pendingFiles && (
          <div className="owner-chartcard" role="group" aria-label={`${pendingFiles.length} photos — one receipt or several?`} style={{ padding: 12, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 13 }}>{pendingFiles.length} photos — one receipt or several?</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="owner-actbtn primary" disabled={busy} onClick={() => void sendFiles(pendingFiles, true, 'owner_app_upload')}>Combine into one receipt ({pendingFiles.length} pages)</button>
              <button className="owner-actbtn" disabled={busy} onClick={() => void sendFiles(pendingFiles, false, 'owner_app_upload')}>Upload as {pendingFiles.length} separate receipts</button>
              <button className="owner-actbtn" disabled={busy} onClick={() => setPendingFiles(null)}>Cancel</button>
            </div>
          </div>
        )}
        {quality && (
          <div className="owner-chartcard" role="status" style={{ padding: 12, display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>This receipt may be difficult to read.</div>
            <div className="muted" style={{ fontSize: 12 }}>{quality.flags.map((f) => QUALITY_LABEL[f] ?? f).join(' · ')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="owner-actbtn primary" disabled={busy} onClick={() => { setQuality(null); camRef.current?.click(); }}>Retake photo</button>
              <button className="owner-actbtn" disabled={busy} onClick={() => void processAnyway()}>Process anyway</button>
            </div>
          </div>
        )}
        {suggest && (
          <div className="owner-chartcard" role="status" style={{ padding: 12, display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 13 }}>{suggest.verdict === 'matched' ? 'This receipt matches an expense already recorded (same vendor, date and total). Link it instead of posting a second expense.' : 'This receipt may belong to an expense already recorded (same total around that date). Check it before posting a second expense.'}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="owner-actbtn primary" disabled={busy} onClick={() => void linkSuggested()}>Link to that expense</button>
              <button className="owner-actbtn" disabled={busy} onClick={() => setSuggest(null)}>Not this one</button>
            </div>
          </div>
        )}
        {queued.length > 0 && (
          <div className="owner-chartcard" role="status" style={{ padding: 10, fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="muted">{queued.length} receipt{queued.length === 1 ? '' : 's'} waiting to upload from this phone.</span>
            <button className="owner-actbtn" disabled={busy || isOffline()} onClick={() => void syncQueue()}>Upload now</button>
          </div>
        )}
      </div>

      {adding && (
        <div className="owner-chartcard" style={{ margin: '8px 16px', padding: 14 }}>
          <div className="owner-serif" style={{ fontSize: 15, marginBottom: 10 }}>New expense</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <select className="owner-input" aria-label="Type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value === 'bill' ? 'bill' : 'expense' })}>
              <option value="expense">Expense (already paid)</option><option value="bill">Bill (to pay later)</option>
            </select>
            <select className="owner-input" aria-label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Category: choose for me</option>
              {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <input className="owner-input" inputMode="decimal" placeholder="Amount (e.g. 250.00)" value={form.amount} onChange={(e) => { setForm({ ...form, amount: e.target.value }); setDupHint(null); }} onBlur={() => void precheck()} />
            {dupHint && <div style={{ color: 'var(--owner-danger)', fontSize: 12 }}>{dupHint}</div>}
            <input className="owner-input" type="date" aria-label="Date" max={todayStr()} value={form.incurredOn} onChange={(e) => setForm({ ...form, incurredOn: e.target.value })} />
            {form.kind === 'bill' && <input className="owner-input" type="date" aria-label="Due date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />}
            <input className="owner-input" placeholder="Vendor (optional)" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
            <input className="owner-input" placeholder="Note (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            {dupReason !== null && (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>This looks like an expense already recorded.</div>
                <input className="owner-input" placeholder="Why is it not a duplicate?" value={dupReason} onChange={(e) => setDupReason(e.target.value)} />
                <button className="owner-actbtn primary" disabled={busy || !dupReason.trim()} onClick={() => submit(dupReason.trim())}>Save anyway</button>
              </div>
            )}
            {formErr && <div style={{ color: 'var(--owner-danger)', fontSize: 12.5 }}>{formErr}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="owner-actbtn" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
              <button className="owner-actbtn primary" onClick={() => submit()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {ask && (
        <div className="owner-chartcard" style={{ margin: '8px 16px', padding: 14, display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 600 }}>{ask.action === 'pay' ? 'Record a bill payment' : ask.action === 'reject' ? 'Reject — why?' : ask.action === 'void' ? 'Void — why?' : ask.action === 'duplicate' ? 'Mark as duplicate — why?' : 'Keep it — why is it not a duplicate?'}</div>
          <input className="owner-input" aria-label={ask.action === 'pay' ? 'Amount paid' : 'Reason'} inputMode={ask.action === 'pay' ? 'decimal' : 'text'} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="owner-actbtn" onClick={() => { setAsk(null); setAnswer(''); }}>Cancel</button>
            <button className="owner-actbtn primary" onClick={confirm} disabled={busy}>Confirm</button>
          </div>
        </div>
      )}

      {loading && !dash ? (
        <div style={{ padding: '4px 16px 16px' }}><OwnerSkeletonBlocks count={3} /></div>
      ) : err ? (
        <div className="owner-state"><div className="big owner-serif">Couldn’t load</div><div className="muted" style={{ marginBottom: 16 }}>{err}</div><button className="owner-actbtn primary" onClick={load}>Retry</button></div>
      ) : (
        <div style={{ padding: '4px 16px 16px' }}>
          {dash && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
              <div className="owner-kpi"><div className="label">This month</div><div className="val" style={{ fontSize: 16 }}>{money(dash.thisMonthCents)}</div></div>
              <div className="owner-kpi"><div className="label">To review</div><div className="val" style={{ fontSize: 16 }}>{dash.needsReview + dash.drafts}</div></div>
              <div className="owner-kpi"><div className="label">Bills due</div><div className="val" style={{ fontSize: 16, color: dash.billsOverdue ? 'var(--owner-danger)' : undefined }}>{dash.billsDue + dash.billsOverdue}</div>{dash.billsOverdue ? <div className="sub down">{dash.billsOverdue} overdue</div> : null}</div>
            </div>
          )}

          <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto' }}>
            {TABS.map((x) => <button key={x.key} role="tab" aria-selected={tab === x.key} className={tab === x.key ? 'owner-actbtn primary' : 'owner-actbtn'} style={{ minHeight: 40 }} onClick={() => setTab(x.key)}>{x.label}</button>)}
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }} data-testid="ex-filters">
            <input className="owner-input" type="search" aria-label="Search expenses" placeholder="Search vendor, description, invoice, amount" value={fq} onChange={(e) => setFq(e.target.value)} style={{ flex: '1 1 220px', minHeight: 40 }} />
            <select className="owner-input" aria-label="Filter by category" value={fCat} onChange={(e) => setFCat(e.target.value)} style={{ maxWidth: 200, minHeight: 40 }}>
              <option value="">All categories</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select className="owner-input" aria-label="Filter by payment method" value={fMethod} onChange={(e) => setFMethod(e.target.value)} style={{ maxWidth: 200, minHeight: 40 }}>
              <option value="">All payment methods</option>{PAY_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {fVendor && <button className="owner-actbtn" data-testid="ex-vendor-chip" aria-label={`Vendor filter: ${fVendor.name}. Remove`} style={{ minHeight: 40 }} onClick={() => setFVendor(null)}>Vendor: {fVendor.name} ✕</button>}
            {(fq || fCat || fMethod || fVendor) && <button className="owner-actbtn" style={{ minHeight: 40 }} onClick={() => { setFq(''); setFCat(''); setFMethod(''); setFVendor(null); }}>Clear filters</button>}
          </div>

          {tab === 'needs_review' && openIds.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <button className="owner-actbtn primary" disabled={busy} onClick={bulkApprove}>Approve all clean</button>
              <select className="owner-input" aria-label="Set category for all" style={{ maxWidth: 200, minHeight: 40 }} value={bulkCat} onChange={(e) => bulkCategorize(e.target.value)}>
                <option value="">Set category for all…</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          )}
          {rows && rows.length === 0 && <div className="owner-state"><div className="big owner-serif">Nothing here</div><div className="muted">Snap a receipt or tap + to record one.</div></div>}
          {rows && rows.map((e) => (
            <div key={e.id} className="owner-chartcard" style={{ padding: '10px 14px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{e.vendorDisplay || e.vendor || e.categoryLabel}{e.vendorId && fVendor?.id !== e.vendorId && <button className="owner-actbtn" style={{ marginLeft: 8, fontSize: 11.5, minHeight: 32, padding: "2px 8px" }} data-testid="ex-only-vendor" onClick={() => setFVendor({ id: e.vendorId!, name: e.vendorDisplay || e.vendor || 'vendor' })}>Only this vendor</button>}</div>
                <div style={{ fontWeight: 600 }}>{money(e.amountCents)}</div>
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                {e.incurredOn} · {STATUS[e.status] ?? e.status}{e.kind === 'bill' && e.dueDate ? ` · due ${e.dueDate}` : ''}{e.receiptDocumentId ? ' · receipt' : ''}{e.description ? ` · ${e.description}` : ''}
              </div>
              {e.vendorId && spend[e.vendorId] && <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>This vendor: {money(spend[e.vendorId].thisMonthCents)} this month · {money(spend[e.vendorId].thisYearCents)} this year ({spend[e.vendorId].thisYearCount})</div>}
              {e.reimbursementStatus && e.reimbursementStatus !== 'not_required' && <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>Reimbursement: {e.reimbursementStatus.replace('_', ' ')}</div>}
              {(e.duplicateStatus === 'possible' || e.duplicateStatus === 'exact') && <div style={{ color: 'var(--owner-danger)', fontSize: 12, marginTop: 4 }}>Possible duplicate — decide before it counts.</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {e.status !== 'approved' && e.status !== 'voided' ? (
                  <select className="owner-input" aria-label="Change category" style={{ maxWidth: 170, minHeight: 36 }} value={e.category} onChange={(ev) => recategorize(e, ev.target.value)}>
                    {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                ) : <span className="muted" style={{ fontSize: 12 }}>{label(e.category)}</span>}
                {(e.status === 'pending_review' || e.status === 'draft') && e.duplicateStatus !== 'possible' && e.duplicateStatus !== 'exact' && <button className="owner-actbtn primary" disabled={busy} onClick={() => act(() => fin.approve(e.id, e.version), 'Approved.')}>Approve</button>}
                {e.status === 'pending_review' && <button className="owner-actbtn" disabled={busy} onClick={() => setAsk({ e, action: 'reject' })}>Reject</button>}
                {e.status === 'pending_review' && <button className="owner-actbtn" disabled={busy} onClick={() => act(() => fin.returnToDraft(e.id, e.version), 'Moved back to draft.')}>To draft</button>}
                {(e.duplicateStatus === 'possible' || e.duplicateStatus === 'exact') && <>
                  <button className="owner-actbtn" disabled={busy} onClick={() => setAsk({ e, action: 'not_duplicate' })}>Not a duplicate</button>
                  <button className="owner-actbtn" disabled={busy} onClick={() => setAsk({ e, action: 'duplicate' })}>Duplicate</button>
                </>}
                {e.kind === 'bill' && e.status === 'approved' && e.openCents > 0 && <button className="owner-actbtn" disabled={busy} onClick={() => setAsk({ e, action: 'pay' })}>Pay</button>}
                {e.status === 'approved' && <button className="owner-actbtn" disabled={busy} onClick={() => setAsk({ e, action: 'void' })}>Void</button>}
                {e.status === 'approved' && e.reimbursementStatus === 'pending' && <button className="owner-actbtn" disabled={busy} onClick={() => act(() => fin.reimbursement(e.id, 'approve'), 'Reimbursement approved.')}>Approve reimbursement</button>}
                {e.status === 'approved' && e.reimbursementStatus === 'approved' && <button className="owner-actbtn" disabled={busy} onClick={() => act(() => fin.reimbursement(e.id, 'pay'), 'Marked as reimbursed.')}>Mark reimbursed</button>}
                {!e.receiptDocumentId && e.status !== 'voided' && <button className="owner-actbtn" disabled={busy} onClick={() => { setAttachFor(e.id); attachRef.current?.click(); }}>Attach receipt</button>}
                {e.vendorId && !spend[e.vendorId] && <button className="owner-actbtn" onClick={() => void vendorHistory(e.vendorId!)}>Vendor history</button>}
                {e.status === 'draft' && <button className="owner-trash" aria-label="Delete draft" disabled={busy} onClick={() => act(() => fin.deleteDraft(e.id), 'Draft deleted.')}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--owner-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 002 2h6a2 2 0 002-2V6" /></svg>
                </button>}
              </div>
            </div>
          ))}

          {report && (
            <div className="owner-chartcard" style={{ padding: '10px 14px', marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div className="owner-serif" style={{ fontSize: 15 }}>Where the money went</div>
                <div className="owner-serif" style={{ fontSize: 20, color: 'var(--owner-primary)' }}>{money(report.totalCents)}</div>
              </div>
              {topCats.length === 0 ? <div className="muted" style={{ fontSize: 12.5, padding: '8px 0' }}>No approved expenses in this period.</div> : topCats.map((c) => (
                <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--owner-border)' }}>
                  <span>{c.label}<span className="muted" style={{ fontSize: 11.5 }}> · {c.count}</span></span><span>{money(c.totalCents)}</span>
                </div>
              ))}
              {report.sharedCosts?.branch && report.sharedCosts.branch.allocatedCents > 0 ? (
                <div data-testid="shared-cost-share" style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--owner-border)' }}>
                  <span>This branch's share of salon-wide costs<span className="muted" style={{ fontSize: 11.5 }}> · {report.sharedCosts.branch.expenseCount}</span></span>
                  <span>{money(report.sharedCosts.branch.allocatedCents)}</span>
                </div>
              ) : null}
              {report.sharedCosts?.branch && report.sharedCosts.branch.allocatedCents > 0 ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', fontWeight: 700 }}><span>With salon-wide costs</span><span>{money(report.totalCents + report.sharedCosts.branch.allocatedCents)}</span></div>
              ) : null}
              {report.insights.map((s) => <div key={s} className="muted" style={{ fontSize: 12, marginTop: 6 }}>{s}</div>)}
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Approved expenses only — the same figure your profit uses.</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="owner-actbtn" disabled={busy} onClick={() => exportAs('csv')}>Export CSV</button>
                <button className="owner-actbtn" disabled={busy} onClick={() => exportAs('xlsx')}>Export Excel</button>
              </div>
              {/* Receipt mandate §162 (Oct 28 2026): the export is bookkeeping, not tax advice */}
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>For bookkeeping only — not tax or accounting advice. Review deductions with your accountant.</div>
            </div>
          )}

          <button className="owner-actbtn" style={{ marginTop: 12, width: '100%' }} onClick={openRules}>{showRules ? 'Hide categories & rules' : 'Categories & rules'}</button>
          {showRules && (
            <div className="owner-chartcard" style={{ padding: '10px 14px', marginTop: 8, display: 'grid', gap: 8 }}>
              <div className="owner-serif" style={{ fontSize: 14 }}>Vendor rules</div>
              {rules.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No rules yet. Rules you add here always win over suggestions.</div>}
              {rules.map((r) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                  <span>{r.vendorNorm} → {label(r.categoryKey)}{r.kind === 'learned' ? <span className="muted"> · learned</span> : null}</span>
                  <button className="owner-actbtn" disabled={busy} onClick={() => removeRule(r.id)}>Remove</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="owner-input" placeholder="Vendor" value={rule.vendor} onChange={(e) => setRule({ ...rule, vendor: e.target.value })} />
                <select className="owner-input" aria-label="Rule category" value={rule.categoryKey} onChange={(e) => setRule({ ...rule, categoryKey: e.target.value })}>
                  <option value="">Category</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <button className="owner-actbtn primary" disabled={busy} onClick={addRule}>Add</button>
              </div>
              {settings && (
                <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                  <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={settings.requireApproval} onChange={() => toggle('requireApproval')} /> Staff expenses need my approval</label>
                  <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={settings.duplicateDetection} onChange={() => toggle('duplicateDetection')} /> Warn me about possible duplicates</label>
                  <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={settings.learnFromCorrections} onChange={() => toggle('learnFromCorrections')} /> Learn from my category changes</label>
                  {/* §177 (Oct 27 2026): what the owner is told about; §83 the owner's auto-approval rules */}
                  <div className="owner-serif" style={{ fontSize: 14, marginTop: 6 }}>Tell me about</div>
                  <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={settings.notifyNeedsReview ?? true} onChange={() => toggle('notifyNeedsReview')} /> Receipts and expenses that need my review</label>
                  <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={settings.notifyBillDue ?? true} onChange={() => toggle('notifyBillDue')} /> Bills coming due or overdue</label>
                  <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={settings.notifyDuplicate ?? true} onChange={() => toggle('notifyDuplicate')} /> Possible duplicates</label>
                  <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={settings.notifyWeeklySummary ?? true} onChange={() => toggle('notifyWeeklySummary')} /> A weekly expense summary</label>
                  <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={settings.notifyMonthlySummary ?? true} onChange={() => toggle('notifyMonthlySummary')} /> A monthly expense summary</label>
                  <div data-testid="auto-approval-rules" style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                    <div className="owner-serif" style={{ fontSize: 14 }}>Approve automatically</div>
                    <div className="muted" style={{ fontSize: 12 }}>A scanned receipt from a trusted vendor, at or under the amount, with the numbers adding up and no possible duplicate, is approved without a tap. Anything else still waits for you.</div>
                    {(settings.autoApprovalRules ?? []).map((r) => (
                      <div key={r.vendorNorm} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <span>{r.vendorNorm} · up to {centsToUsd(r.maxCents)}{r.categoryKey ? ` · ${label(r.categoryKey)}` : ''}</span>
                        <button className="owner-actbtn" disabled={busy} aria-label={`Remove auto-approval for ${r.vendorNorm}`} onClick={() => removeAutoRule(r.vendorNorm)}>Remove</button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <input className="owner-input" aria-label="Trusted vendor" placeholder="Vendor (e.g. PSE&G)" value={autoRule.vendor} onChange={(e) => setAutoRule({ ...autoRule, vendor: e.target.value })} style={{ flex: 2, minWidth: 120 }} />
                      <input className="owner-input" aria-label="Approve up to" placeholder="Up to $" inputMode="decimal" value={autoRule.max} onChange={(e) => setAutoRule({ ...autoRule, max: e.target.value })} style={{ flex: 1, minWidth: 90 }} />
                      <button className="owner-actbtn primary" disabled={busy} onClick={addAutoRule}>Add rule</button>
                    </div>
                  </div>
                  {branches.length > 1 && (
                    <div data-testid="shared-cost-policy" style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                      <div className="owner-serif" style={{ fontSize: 14 }}>Salon-wide costs on a branch's report</div>
                      <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="radio" name="scp" checked={(sharesDraft ?? settings).sharedCostPolicy === 'NONE'} onChange={() => setSharesDraft({ sharedCostPolicy: 'NONE', sharedCostShares: settings.sharedCostShares })} /> Don't split them (shown under the whole salon)</label>
                      <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="radio" name="scp" checked={(sharesDraft ?? settings).sharedCostPolicy === 'MANUAL_PERCENTAGE'} onChange={() => setSharesDraft({ sharedCostPolicy: 'MANUAL_PERCENTAGE', sharedCostShares: settings.sharedCostShares.length ? settings.sharedCostShares : branches.map((b) => ({ branchId: b.branchId, basisPoints: 0 })) })} /> Split them by my percentages</label>
                      {(sharesDraft ?? settings).sharedCostPolicy === 'MANUAL_PERCENTAGE' && branches.map((b) => {
                        const cur = (sharesDraft ?? settings).sharedCostShares.find((x) => x.branchId === b.branchId)?.basisPoints ?? 0;
                        return (
                          <label key={b.branchId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                            <span style={{ flex: 1 }}>{b.branchName}</span>
                            <input className="owner-input" style={{ width: 80 }} inputMode="decimal" aria-label={`${b.branchName} share percent`} value={String(cur / 100)}
                              onChange={(e) => { const pct = Number(e.target.value); const bp = Number.isFinite(pct) ? Math.round(pct * 100) : 0; const base = sharesDraft ?? { sharedCostPolicy: 'MANUAL_PERCENTAGE' as const, sharedCostShares: settings.sharedCostShares };
                                setSharesDraft({ ...base, sharedCostShares: [...base.sharedCostShares.filter((x) => x.branchId !== b.branchId), { branchId: b.branchId, basisPoints: bp }] }); }} /> %
                          </label>
                        );
                      })}
                      {sharesDraft && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {sharesDraft.sharedCostPolicy === 'MANUAL_PERCENTAGE' && <span className="muted" style={{ fontSize: 12 }}>Total {sharesDraft.sharedCostShares.reduce((t, x) => t + x.basisPoints, 0) / 100}% (must be 100%)</span>}
                          <button className="owner-actbtn primary" disabled={busy} onClick={() => act(async () => { setSettings(await fin.saveSettings({ sharedCostPolicy: sharesDraft.sharedCostPolicy, sharedCostShares: sharesDraft.sharedCostShares.filter((x) => x.basisPoints > 0 || sharesDraft.sharedCostPolicy === 'NONE'), version: settings.version })); setSharesDraft(null); }, 'Branch shares saved.')}>Save shares</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="owner-serif" style={{ fontSize: 14, marginTop: 6 }}>Add a category</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="owner-input" placeholder="e.g. Laundry" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
                <button className="owner-actbtn primary" disabled={busy || !newCat.trim()} onClick={addCategory}>Add category</button>
              </div>
              <div className="owner-serif" style={{ fontSize: 14, marginTop: 6 }}>Import past expenses (CSV)</div>
              <div className="muted" style={{ fontSize: 11.5 }}>Columns: date, vendor, amount, category, branch, description. Every row is checked before anything is saved.</div>
              <input ref={csvRef} type="file" accept=".csv,text/csv" aria-label="Choose a CSV file" onChange={(e) => void onCsv(e.target.files?.[0])} />
              {importInfo && <div style={{ fontSize: 12.5 }}>{importInfo}</div>}
              {importRows && <button className="owner-actbtn primary" disabled={busy} onClick={runImport}>Import</button>}
              <div className="owner-serif" style={{ fontSize: 14, marginTop: 6 }}>Rename a category</div>
              <div style={{ display: 'grid', gap: 6 }}>
                <input className="owner-input" placeholder="New name" value={ask ? '' : answer} onChange={(e) => setAnswer(e.target.value)} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{cats.map((c) => <button key={c.key} className="owner-actbtn" disabled={busy || !answer.trim() || !!ask} onClick={() => renameCategory(c)}>{c.label}</button>)}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
