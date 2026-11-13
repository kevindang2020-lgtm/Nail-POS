// POSDepositReconScreen.tsx — Payments & Money → AI Deposit Reconciliation (/tenant/payments/deposit-reconciliation).
// AI Deposit Reconciliation mandate (Oct 29 2026): ONE full-screen page at 100 % zoom — header (Refresh · Record a Deposit) ·
// four tabs (Overview · Fees · Exceptions · Reports) with one universal search · period (presets + Custom Range calendar +
// date field) / status / processor / bank account filters · five KPIs (Expected Deposits · Matched · Settlements · Missing
// Deposits · Net Difference — server aggregates, the calculation shown) · the tab body:
//   Overview   Settlements → Deposits (numbered pages, newest first) | Bank Accounts · Unmatched Deposits
//   Fees       fee KPIs + the per-batch fee table (components only where the processor supplies them)
//   Exceptions the case queue (classes, severity, reviewer, age) with View Evidence / Assign / Under Review / Resolve / Reopen
//   Reports    nine reports, each a paged table with totals over every filtered record; CSV and PDF exports
// Matching is an ALLOCATION a person makes (1:1, split, combined, partial), with the evidence recorded; a suggestion is
// rule-based evidence and is never applied by itself. Recording a deposit creates a record — no money moves.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SystemCheckButton } from '../components/SystemCheck';
import { SavedViews, vStr, periodToView, periodFromView } from '../components/SavedViews';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posDepositReconApi as api } from '../api/posDepositReconApi';
import { useCan } from '../components/usePermissions';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced, requestId } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, fmtYmdSafe, DateField, centsFromText, textFromCents, type PeriodState, type ServerPeriod } from '../components/FinanceKit';
import { useStepUp, isStepUpCancelled } from './access/accessUi';
import { financeDownload as download } from './POSSettlementsScreen';
import { deviceToday } from '../lib/deviceToday';

type Tab = 'overview' | 'fees' | 'exceptions' | 'reports';
type Status = 'pending' | 'expected' | 'matched' | 'partially_matched' | 'overdue' | 'exception' | 'under_review' | 'no_payout';
type SRow = { id: string; settlementRef: string | null; processor: string | null; settledAt: string | null; createdAt: string | null; grossCents: number; feeCents: number; adjustmentsCents: number;
  expectedNetCents: number; expectedArrival: string | null; arrivalSourced: boolean; transactionCount: number; currency: string; linkedDeposits: number; depositRefs: string[];
  matchedCents: number; allocatedCents: number; remainingCents: number; differenceCents: number; status: Status; providerStatus: string; openExceptions: number; matchedBy: string | null };
type DRow = { id: string; bankAccountId: string; account: string | null; bankName: string | null; amountCents: number; depositDate: string | null; reference: string | null; description: string | null; source: string; status: string;
  notes: string | null; createdAt: string | null; createdBy: string | null; allocatedCents: number; remainingCents: number; matchState: 'reconciled' | 'partial_allocation' | 'possible_candidate' | 'reviewed_unresolved' | 'no_candidates'; candidates: number; reviewNotes: number };
type Account = { id: string; nickname: string; bankName: string | null; accountType: string; last4: string | null; masked: string | null; status: string; isDefault: boolean; deposits: number; lastDepositDate: string | null };
const money = (c: number | null | undefined) => fmtMoney(c ?? 0);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const lbl = (k: string, fb: string) => codeLabel(k, fb);
const STATUS_TONE: Record<string, string> = { matched: 'ok', partially_matched: 'warn', expected: 'info', pending: 'mut', overdue: 'bad', exception: 'bad', under_review: 'warn', no_payout: 'mut' };
const MATCH_TONE: Record<string, string> = { reconciled: 'ok', partial_allocation: 'warn', possible_candidate: 'info', reviewed_unresolved: 'warn', no_candidates: 'mut' };
const EXC_TONE: Record<string, string> = { open: 'bad', reopened: 'bad', escalated: 'bad', in_review: 'warn', resolved: 'ok' };
const SEV_TONE: Record<string, string> = { critical: 'bad', high: 'bad', moderate: 'warn', low: 'info', info: 'mut' };
const STATUSES: Status[] = ['pending', 'expected', 'matched', 'partially_matched', 'overdue', 'exception', 'under_review', 'no_payout'];
const REPORTS = ['settlement_summary', 'matched_deposits', 'unmatched_deposits', 'missing_overdue', 'processing_fees', 'exceptions_aging', 'net_difference_trend', 'bank_accounts', 'processor_comparison'];
const RAISE_KINDS = ['missing_deposit', 'amount_mismatch', 'duplicate', 'unmatched_deposit', 'fee_difference', 'integration_error'];
const errMsg = (e: unknown) => (e as Error)?.message || tx('finance.state.loadFailed');
const errDetails = (e: any): Record<string, any> => e?.details?.error?.details ?? e?.details?.details ?? e?.details ?? {};
type Dlg = null | { kind: 'settlement'; id: string } | { kind: 'deposit'; id: string } | { kind: 'match'; depositId?: string; settlementId?: string; amountCents?: number; basis?: string }
  | { kind: 'suggest'; depositId: string } | { kind: 'record' } | { kind: 'account'; account?: Account } | { kind: 'exception'; id: string }
  | { kind: 'raise'; targetType: 'settlement' | 'deposit'; targetId: string; label: string } | { kind: 'note'; targetType: 'settlement' | 'deposit' | 'exception'; targetId: string; label: string };

export function POSDepositReconScreen() {
  const can = useCan();
  const canManage = can('reconciliation.manage'), canApprove = can('reconciliation.approve');
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('overview');
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' });
  const [basis, setBasis] = useState('settlement');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [status, setStatus] = useState('');
  const [processor, setProcessor] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string; actions?: { label: string; run: () => void }[] } | null>(null);
  const [dlg, setDlg] = useState<Dlg>(params.get('settlement') ? { kind: 'settlement', id: String(params.get('settlement')) } : null);
  const refresh = () => setTick((t) => t + 1);
  const pq = periodQuery(period);
  const scope = { ...pq, dateField: basis, search: q || undefined, processor: processor || undefined, bankAccountId: bankAccountId || undefined };
  const kpis = useLoad(() => api.kpis(scope), [JSON.stringify(scope), tick]);
  const accounts = useLoad(() => api.bankAccounts(), [tick]);
  const server: ServerPeriod | undefined = kpis.data?.period;
  const k = kpis.data?.kpis;
  const filtersOn = !!(q || status || processor || bankAccountId);
  const clearAll = () => { setSearch(''); setStatus(''); setProcessor(''); setBankAccountId(''); setPeriod({ preset: 'month' }); setBasis('settlement'); };
  const after = (text: string) => { setNote({ tone: 'ok', text }); refresh(); };

  return (
    <div className={'work fit dr dr-' + tab} data-testid="recon-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.ai_deposit_reconciliation')}</h1><div className="sub">{tx('finance.dr.subtitle')}</div></div>
        <div className="fk-head-actions">
          <SystemCheckButton domain="settlements" />
          <button type="button" className="fk-btn" onClick={refresh} data-testid="refresh">{tx('finance.refresh')}</button>
          {canManage ? <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'record' })} data-testid="record-deposit">+ {tx('finance.dr.recordDeposit')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><span className="fn-note-acts">{note.actions?.map((a) => <button key={a.label} type="button" className="fk-link" onClick={() => { a.run(); setNote(null); }}>{a.label}</button>)}<button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></span></div> : null}

      <div className="fn-tabsrow">
        <div className="fk-seg fn-tabs" role="tablist" aria-label={tx('finance.dr.tabs')}>
          {(['overview', 'fees', 'exceptions', 'reports'] as Tab[]).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'tab-' + t}>{tx('finance.dr.tab.' + t)}</button>)}
        </div>
        <UniversalSearch value={search} onChange={setSearch} q={q} onOpen={(r) => setDlg(r.type === 'bank_deposit' ? { kind: 'deposit', id: r.id } : r.type === 'exception' ? { kind: 'exception', id: r.id } : { kind: 'settlement', id: r.id })} />
      </div>
      <div className="fn-toolbar" role="toolbar" aria-label={tx('finance.filters')}>
        <PeriodBar value={period} onChange={setPeriod} server={server} basis={basis} onBasis={setBasis}
          basisOptions={['settlement', 'expected_deposit', 'bank_posted', 'payment', 'created'].map((b) => ({ value: b, label: tx('finance.drBasis.' + b) }))} compact />
        {tab === 'overview' ? <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="status">
          <option value="">{tx('finance.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{lbl('finance.recon.' + s, s)}</option>)}</select> : null}
        <input className="fk-search sm" value={processor} onChange={(e) => setProcessor(e.target.value.trim())} placeholder={tx('finance.processor')} aria-label={tx('finance.processor')} data-testid="processor" />
        <select className="fk-select" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} aria-label={tx('finance.dr.bankAccount')} data-testid="bank-filter">
          <option value="">{tx('finance.dr.allAccounts')}</option>{(accounts.data?.items ?? []).map((a: Account) => <option key={a.id} value={a.id}>{a.masked}</option>)}</select>
        <SavedViews surface="finance.deposit-reconciliation" testId="dr-views" current={{ basis, status, processor, bankAccountId, ...periodToView(period) }}
          onApply={(v) => { setBasis(vStr(v, 'basis', 'settlement')); setStatus(vStr(v, 'status')); setProcessor(vStr(v, 'processor')); setBankAccountId(vStr(v, 'bankAccountId')); setPeriod(periodFromView(v, { preset: 'month' } as PeriodState)); }} />
        {filtersOn ? <button type="button" className="fk-link" onClick={clearAll} data-testid="reset-filters">{tx('finance.resetFilters')}</button> : null}
      </div>

      <div className="fk-kpis five" data-testid="kpis">
        {kpis.error ? <StateBlock error={kpis.error} onRetry={kpis.reload} /> : <>
          <KpiCard testId="kpi-expected" label={tx('finance.dr.kpi.expected')} loading={!k} value={k ? money(k.expectedDepositsCents) : ''} sub={tx('finance.dr.kpi.expectedSub')} onClick={() => { setTab('overview'); setStatus(''); }} />
          <KpiCard testId="kpi-matched" label={tx('finance.dr.kpi.matched')} tone="ok" loading={!k} value={k ? money(k.matchedCents) : ''} sub={k ? tx('finance.dr.kpi.matchedSub', { m: fmtNumber(k.byStatus.matched), p: fmtNumber(k.byStatus.partiallyMatched) }) : ''} onClick={() => { setTab('overview'); setStatus('matched'); }} />
          <KpiCard testId="kpi-settlements" label={tx('finance.dr.kpi.settlements')} loading={!k} value={k ? fmtNumber(k.settlements) : ''} sub={kpis.data ? tx('finance.dr.kpi.settlementsSub', { basis: tx('finance.drBasis.' + kpis.data.dateBasis) }) : ''} onClick={() => { setTab('overview'); setStatus(''); }} />
          <KpiCard testId="kpi-missing" label={tx('finance.dr.kpi.missing')} tone={k && k.missingDeposits > 0 ? 'bad' : undefined} loading={!k} value={k ? fmtNumber(k.missingDeposits) : ''} sub={k ? tx('finance.dr.kpi.missingSub', { g: String(k.graceDays) }) : ''} onClick={() => { setTab('overview'); setStatus('overdue'); }} />
          <KpiCard testId="kpi-difference" label={tx('finance.dr.kpi.difference')} tone={k && k.netDifferenceCents !== 0 ? 'warn' : undefined} loading={!k} value={k ? (k.netDifferenceCents === 0 ? money(0) : (k.netDifferenceCents < 0 ? '' : '+') + money(k.netDifferenceCents)) : ''}
            sub={k ? tx('finance.dr.kpi.differenceSub', { m: money(k.netDifference.dueMatchedCents), e: money(k.netDifference.dueExpectedCents) }) : ''} onClick={() => setNote({ tone: 'ok', text: k ? tx('finance.dr.kpi.differenceExplain', { m: money(k.netDifference.dueMatchedCents), e: money(k.netDifference.dueExpectedCents), d: money(k.netDifferenceCents), n: fmtNumber(k.netDifference.notYetDueCount), nc: money(k.netDifference.notYetDueCents) }) : '' })} />
        </>}
      </div>

      {tab === 'overview' ? <Overview scope={{ ...scope, status: status || undefined }} tick={tick} accounts={accounts} canManage={canManage} setDlg={setDlg} filtersOn={filtersOn} clearAll={clearAll} unmatchedTotal={k?.unmatchedDeposits} /> : null}
      {tab === 'fees' ? <FeesTab scope={scope} tick={tick} onExport={() => exportReport('processing_fees', 'csv')} /> : null}
      {tab === 'exceptions' ? <ExceptionsTab scope={{ ...pq, search: q || undefined }} tick={tick} onOpen={(id) => setDlg({ kind: 'exception', id })} /> : null}
      {tab === 'reports' ? <ReportsTab scope={{ ...pq, dateField: basis, processor: processor || undefined, bankAccountId: bankAccountId || undefined }} tick={tick} onExport={exportReport} /> : null}

      {dlg?.kind === 'settlement' ? <SettlementReview id={dlg.id} canManage={canManage} canApprove={canApprove} onClose={() => { setDlg(null); if (params.get('settlement')) { params.delete('settlement'); setParams(params, { replace: true }); } }} setDlg={setDlg} onDone={after} /> : null}
      {dlg?.kind === 'deposit' ? <DepositView id={dlg.id} canManage={canManage} canApprove={canApprove} onClose={() => setDlg(null)} setDlg={setDlg} onDone={after} /> : null}
      {dlg?.kind === 'match' ? <MatchDialog init={dlg} canApprove={canApprove} onClose={() => setDlg(null)} onDone={(t) => { setDlg(null); after(t); }} /> : null}
      {dlg?.kind === 'suggest' ? <SuggestionsDialog depositId={dlg.depositId} canManage={canManage} onClose={() => setDlg(null)} onMatch={(m) => setDlg({ kind: 'match', ...m })} /> : null}
      {dlg?.kind === 'record' ? <RecordDepositDialog accounts={(accounts.data?.items ?? []).filter((a: Account) => a.status === 'active')} today={server?.today ?? deviceToday()} period={server}
        onClose={() => setDlg(null)} onDone={(dep, inPeriod) => { setDlg(null); refresh();
          setNote(inPeriod ? { tone: 'ok', text: tx('finance.dr.depositRecorded', { a: money(dep.amountCents) }) }
            : { tone: 'ok', text: tx('finance.dr.depositOutside', { a: money(dep.amountCents) }), actions: [{ label: tx('finance.viewRecord'), run: () => setDlg({ kind: 'deposit', id: dep.id }) }, { label: tx('finance.clearFilters'), run: () => { clearAll(); setPeriod({ preset: 'year' }); } }] }); }} /> : null}
      {dlg?.kind === 'account' ? <AccountDialog account={dlg.account} onClose={() => setDlg(null)} onDone={(t) => { setDlg(null); after(t); }} /> : null}
      {dlg?.kind === 'exception' ? <ExceptionDialog id={dlg.id} canManage={canManage} canApprove={canApprove} onClose={() => setDlg(null)} onDone={after} setDlg={setDlg} /> : null}
      {dlg?.kind === 'raise' ? <RaiseDialog target={dlg} onClose={() => setDlg(null)} onDone={(r) => { setDlg(null); after(r.existing ? tx('finance.dr.caseExists') : tx('finance.dr.caseRaised')); }} /> : null}
      {dlg?.kind === 'note' ? <NoteDialog target={dlg} onClose={() => setDlg(null)} onDone={() => { setDlg(null); after(tx('finance.dr.noteAdded')); }} /> : null}
    </div>
  );

  async function exportReport(type: string, fmt: 'csv' | 'pdf') {
    const qy = { ...pq, dateField: basis, processor: processor || undefined, bankAccountId: bankAccountId || undefined };
    try {
      if (fmt === 'csv') download(`reconciliation-${type}.csv`, await api.reportCsv(type, qy), 'text/csv;charset=utf-8');
      else download(`reconciliation-${type}.pdf`, await api.reportPdf(type, qy), 'application/pdf');
      setNote({ tone: 'ok', text: tx('finance.exported') });
    } catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); }
  }
}

function UniversalSearch({ value, onChange, q, onOpen }: { value: string; onChange: (v: string) => void; q: string; onOpen: (r: { type: string; id: string }) => void }) {
  const [open, setOpen] = useState(false);
  const res = useLoad(() => (q.length >= 2 ? api.search(q) : Promise.resolve(null)), [q]);
  const wrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => { const c = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', c); return () => document.removeEventListener('mousedown', c); }, []);
  const results: any[] = res.data?.results ?? [];
  return (
    <div className="fn-usearch" ref={wrap}>
      <input className="fk-search wide" type="search" value={value} onFocus={() => setOpen(true)} onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && results[0]) { onOpen(results[0]); setOpen(false); } }}
        placeholder={tx('finance.dr.searchPh')} aria-label={tx('finance.dr.searchPh')} data-testid="search" />
      {value ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => onChange('')}>✕</button> : null}
      {open && q.length >= 2 ? (
        <div className="fn-usearch-pop" role="listbox" data-testid="search-results">
          {res.error ? <div className="fk-err">{tx('finance.state.searchUnavailable')}</div>
            : !res.data ? <div className="fk-loading">{tx('pos.loading')}</div>
            : results.length === 0 ? <div className="fk-hint">{tx('finance.noMatches')}</div>
            : results.map((r) => (
              <button type="button" role="option" key={r.type + r.id} className="fn-usearch-item" onClick={() => { onOpen(r); setOpen(false); }}>
                <span className={'fk-chip ' + (r.type === 'exception' ? 'bad' : r.type === 'bank_deposit' ? 'info' : 'mut')}>{tx('finance.resultType.' + r.type)}</span>
                <b>{r.label}</b><span className="fk-li-s">{money(r.amountCents)}{r.date ? ' · ' + (String(r.date).length === 10 ? fmtYmdSafe(r.date) : when(r.date)) : ''}{r.via && r.via !== 'settlement' ? ' · ' + tx('finance.matchedBy.' + r.via) : ''}</span>
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function Overview({ scope, tick, accounts, canManage, setDlg, filtersOn, clearAll, unmatchedTotal }: { scope: Record<string, unknown>; tick: number; accounts: { data: any; error: unknown; loading: boolean; reload: () => void }; canManage: boolean; setDlg: (d: Dlg) => void; filtersOn: boolean; clearAll: () => void; unmatchedTotal?: number }) {
  const [sp, setSp] = useState(1); const [dp, setDp] = useState(1); const [sort, setSort] = useState('created_desc');
  const key = JSON.stringify(scope);
  useEffect(() => { setSp(1); setDp(1); }, [key]);
  const sfit = useFitRows<HTMLDivElement>(41, { min: 3, max: 16, reserve: 34 });
  const dfit = useFitRows<HTMLDivElement>(47, { min: 2, max: 10 });
  const s = useLoad(() => api.settlements({ ...scope, sort, page: sp, pageSize: sfit.rows }), [key, sort, sp, sfit.rows, tick]);
  const d = useLoad(() => api.deposits({ ...scope, unmatched: '1', page: dp, pageSize: dfit.rows }), [key, dp, dfit.rows, tick]);
  const rows: SRow[] = s.data?.items ?? [];
  const deps: DRow[] = d.data?.items ?? [];
  const accts: Account[] = accounts.data?.items ?? [];
  const canAdmin = !!accounts.data?.canManage;
  return (
    <div className="fn-ov">
      <FitPanel testId="settlements-deposits" bodyRef={sfit.ref} title={<>{tx('finance.dr.s2d')}{s.data ? <span className="fk-muted"> · {fmtNumber(s.data.total)}</span> : null}</>}
        actions={<select className="fk-select" value={sort} onChange={(e) => { setSort(e.target.value); setSp(1); }} aria-label={tx('finance.sort')} data-testid="sort">
          {['created_desc', 'created_asc', 'settled_desc', 'arrival_asc', 'difference_desc', 'expected_desc'].map((o) => <option key={o} value={o}>{tx('finance.drSort.' + o)}</option>)}</select>}
        footer={<Pager info={s.data ? { page: s.data.page, pageSize: s.data.pageSize, totalItems: s.data.total, totalPages: s.data.pageCount } : null} onPage={setSp} label={tx('finance.dr.s2d')} />}>
        {s.error ? <StateBlock error={s.error} onRetry={s.reload} /> : !s.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : rows.length === 0 ? <Empty title={filtersOn ? tx('finance.noMatches') : tx('finance.dr.noSettlements')}>{filtersOn ? <button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button> : <span className="fk-hint">{(unmatchedTotal ?? 0) > 0 ? tx('finance.dr.noSettlementsButDeposits') : tx('finance.dr.noSettlementsHint')}</span>}</Empty>
          : <table className="fk-table fn-table" data-testid="s2d-table">
            <thead><tr><th>{tx('finance.dr.col.settlement')}</th><th>{tx('finance.dr.col.date')}</th><th className="num t-opt">{tx('finance.dr.col.gross')}</th><th className="num t-opt">{tx('finance.dr.col.fees')}</th><th className="num">{tx('finance.dr.col.expected')}</th><th className="t-opt2">{tx('finance.dr.col.arrival')}</th><th className="t-opt2">{tx('finance.dr.col.deposits')}</th><th className="num">{tx('finance.dr.col.matched')}</th><th className="num">{tx('finance.dr.col.difference')}</th><th>{tx('finance.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} data-testid="s2d-row">
                <td className="fn-id"><button type="button" className="fk-li-t link" onClick={() => setDlg({ kind: 'settlement', id: r.id })}>{r.settlementRef ?? r.id.slice(0, 8)}</button><span className="fk-li-s">{lbl('finance.processorName.' + (r.processor ?? ''), r.processor ?? '—')}</span></td>
                <td>{when(r.settledAt ?? r.createdAt)}</td>
                <td className="num t-opt">{money(r.grossCents)}</td>
                <td className="num t-opt">{money(r.feeCents)}</td>
                <td className="num"><b>{money(r.expectedNetCents)}</b></td>
                <td className="t-opt2">{fmtYmdSafe(r.expectedArrival)}{r.arrivalSourced ? '' : <span className="fk-li-s"> {tx('finance.dr.est')}</span>}</td>
                <td className="t-opt2">{r.linkedDeposits ? (r.depositRefs.slice(0, 2).join(', ') || fmtNumber(r.linkedDeposits)) : '—'}</td>
                <td className="num">{money(r.matchedCents)}</td>
                <td className={'num' + (r.differenceCents < 0 ? ' neg' : '')}>{r.status === 'matched' ? money(0) : money(r.differenceCents)}</td>
                <td><span className={'fk-chip ' + (STATUS_TONE[r.status] ?? 'mut')}>{lbl('finance.recon.' + r.status, r.status)}</span></td>
                <td className="fn-acts">{canManage && r.remainingCents > 0 ? <button type="button" className="fk-btn ghost sm" onClick={() => setDlg({ kind: 'match', settlementId: r.id })}>{tx('finance.dr.match')}</button> : <button type="button" className="fk-btn ghost sm" onClick={() => setDlg({ kind: 'settlement', id: r.id })}>{tx('finance.review')}</button>}</td>
              </tr>))}</tbody>
          </table>}
      </FitPanel>
      <div className="fn-ov-side">
        <FitPanel testId="bank-accounts" className="fn-accounts" title={tx('finance.dr.bankAccounts')}
          actions={canAdmin ? <button type="button" className="fk-btn sm" onClick={() => setDlg({ kind: 'account' })} data-testid="add-account">+ {tx('finance.dr.addAccount')}</button> : null}>
          {accounts.error ? <StateBlock error={accounts.error} onRetry={accounts.reload} /> : !accounts.data ? <div className="fk-loading">{tx('pos.loading')}</div>
            : accts.length === 0 ? <Empty title={tx('finance.dr.noAccounts')}>{canAdmin ? <span className="fk-hint">{tx('finance.dr.noAccountsHint')}</span> : <span className="fk-hint">{tx('finance.dr.noAccountsAsk')}</span>}</Empty>
            : <ul className="fk-list dense">{accts.map((a) => (
              <li key={a.id} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{a.masked}{a.isDefault ? <span className="fk-chip info" style={{ marginLeft: 6 }}>{tx('finance.dr.default')}</span> : null}</span>
                <span className="fk-li-s">{a.bankName ?? '—'} · {lbl('finance.accountType.' + a.accountType, a.accountType)} · {tx('finance.dr.depositsN', { n: fmtNumber(a.deposits) })}</span></div>
                {a.status !== 'active' ? <span className="fk-chip mut">{tx('finance.dr.inactive')}</span> : null}
                {canAdmin ? <button type="button" className="fk-btn ghost sm" onClick={() => setDlg({ kind: 'account', account: a })} aria-label={tx('finance.dr.manageAccount', { a: a.masked ?? '' })}>{tx('finance.dr.manage')}</button> : null}
              </li>))}</ul>}
        </FitPanel>
        <FitPanel testId="unmatched-deposits" bodyRef={dfit.ref} title={<>{tx('finance.dr.unmatched')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}</>}
          actions={<span className="fk-hint">{tx('finance.drBasis.bank_posted')}</span>}
          footer={<Pager compact info={d.data ? { page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pageCount } : null} onPage={setDp} label={tx('finance.dr.unmatched')} />}>
          {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div>
            : deps.length === 0 ? <Empty title={tx('finance.dr.noUnmatched')} />
            : <ul className="fk-list" data-testid="unmatched-list">{deps.map((x) => (
              <li key={x.id} className="fk-li"><div className="fk-li-main"><button type="button" className="fk-li-t link" onClick={() => setDlg({ kind: 'deposit', id: x.id })}>{money(x.remainingCents)}{x.allocatedCents ? <span className="fk-li-s"> / {money(x.amountCents)}</span> : null} · {x.reference ?? tx('finance.dr.noReference')}</button>
                <span className="fk-li-s">{fmtYmdSafe(x.depositDate)} · {x.account ?? '—'} · {lbl('finance.depositSource.' + x.source, x.source)}</span></div>
                <span className={'fk-chip ' + (MATCH_TONE[x.matchState] ?? 'mut')}>{lbl('finance.matchState.' + x.matchState, x.matchState)}</span>
                <span className="fk-li-acts">{x.candidates > 0 ? <button type="button" className="fk-btn ghost sm" onClick={() => setDlg({ kind: 'suggest', depositId: x.id })} data-testid="suggest">{tx('finance.dr.suggestions')}</button> : null}
                  {canManage ? <button type="button" className="fk-btn ghost sm" onClick={() => setDlg({ kind: 'match', depositId: x.id })}>{tx('finance.dr.match')}</button> : null}</span>
              </li>))}</ul>}
        </FitPanel>
      </div>
    </div>
  );
}

function SettlementReview({ id, canManage, canApprove, onClose, setDlg, onDone }: { id: string; canManage: boolean; canApprove: boolean; onClose: () => void; setDlg: (d: Dlg) => void; onDone: (t: string) => void }) {
  const nav = useNavigate();
  const d = useLoad(() => api.settlement(id), [id]);
  const [unmatching, setUnmatching] = useState<{ id: string; reason: string; busy?: boolean; err?: string } | null>(null);
  const s: SRow | undefined = d.data?.settlement;
  const doUnmatch = async () => {
    if (!unmatching) return; setUnmatching({ ...unmatching, busy: true, err: undefined });
    try { await api.unmatch(unmatching.id, unmatching.reason); setUnmatching(null); d.reload(); onDone(tx('finance.dr.unmatchedDone')); }
    catch (e) { setUnmatching({ ...unmatching, busy: false, err: errMsg(e) }); }
  };
  return (
    <FitDialog wide title={s ? tx('finance.dr.reviewTitle', { ref: s.settlementRef ?? s.id.slice(0, 8) }) : tx('finance.review')} subtitle={s ? `${lbl('finance.processorName.' + (s.processor ?? ''), s.processor ?? '—')} · ${when(s.settledAt)}` : undefined} onClose={onClose} testId="settlement-review"
      footer={s ? <>
        <button type="button" className="fk-btn" onClick={() => nav(`/tenant/payments/settlements?settlement=${encodeURIComponent(id)}`)}>{tx('finance.dr.viewTransactions')}</button>
        {canManage ? <button type="button" className="fk-btn" onClick={() => setDlg({ kind: 'note', targetType: 'settlement', targetId: id, label: s.settlementRef ?? id.slice(0, 8) })}>{tx('finance.dr.addNote')}</button> : null}
        {canManage ? <button type="button" className="fk-btn" onClick={() => setDlg({ kind: 'raise', targetType: 'settlement', targetId: id, label: s.settlementRef ?? id.slice(0, 8) })}>{tx('finance.dr.investigate')}</button> : null}
        {canManage && s.remainingCents > 0 ? <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'match', settlementId: id })} data-testid="match-manually">{tx('finance.dr.matchManually')}</button> : null}
        <button type="button" className="fk-btn" onClick={onClose}>{tx('pos.close')}</button>
      </> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !s ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fn-statusline"><span className={'fk-chip ' + (STATUS_TONE[s.status] ?? 'mut')}>{lbl('finance.recon.' + s.status, s.status)}</span>
          <span className="fk-chip mut">{tx('finance.st.providerStatus')}: {lbl('finance.provider.' + s.providerStatus, s.providerStatus)}</span>
          <span className="fk-hint">{tx('finance.recon.help.' + s.status)}</span></div>
        <div className="fn-figs">
          <Fig l={tx('finance.dr.col.gross')} v={money(s.grossCents)} /><Fig l={tx('finance.dr.col.fees')} v={'− ' + money(s.feeCents)} />
          {s.adjustmentsCents ? <Fig l={tx('finance.st.r.adjustments')} v={money(s.adjustmentsCents)} /> : null}
          <Fig l={tx('finance.dr.col.expected')} v={money(s.expectedNetCents)} strong /><Fig l={tx('finance.dr.col.matched')} v={money(s.matchedCents)} /><Fig l={tx('finance.dr.remaining')} v={money(s.remainingCents)} strong={s.remainingCents > 0} />
          <Fig l={tx('finance.dr.col.arrival')} v={`${fmtYmdSafe(s.expectedArrival)}${s.arrivalSourced ? '' : ' ' + tx('finance.dr.est')}`} />
        </div>
        <h3 className="fk-h3">{tx('finance.dr.allocationHistory')}</h3>
        {d.data.allocations.length === 0 ? <div className="fk-hint">{tx('finance.st.noAllocations')}</div> : (
          <table className="fk-table" data-testid="allocations"><thead><tr><th>{tx('finance.st.a.deposit')}</th><th>{tx('finance.st.a.account')}</th><th>{tx('finance.st.a.posted')}</th><th className="num">{tx('finance.st.a.allocated')}</th><th>{tx('finance.dr.basis')}</th><th>{tx('finance.st.a.by')}</th><th>{tx('finance.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{d.data.allocations.map((a: any) => <tr key={a.id}><td>{a.depositReference ?? a.depositId.slice(0, 8)}</td><td>{a.account ?? '—'}</td><td>{fmtYmdSafe(a.depositDate)}</td><td className="num">{money(a.amountCents)}</td>
              <td>{lbl('finance.basisName.' + (a.evidence?.basis ?? a.source), a.evidence?.basis ?? a.source)}</td><td>{a.createdBy ?? '—'} · {when(a.createdAt)}</td>
              <td>{a.active ? <span className="fk-chip ok">{tx('finance.active')}</span> : <span className="fk-chip mut" title={a.unmatchReason ?? ''}>{tx('finance.unmatched')} · {when(a.unmatchedAt)}</span>}</td>
              <td>{a.active && canApprove ? <button type="button" className="fk-btn ghost sm" onClick={() => setUnmatching({ id: a.id, reason: '' })} data-testid="unmatch">{tx('finance.dr.unmatch')}</button> : null}</td></tr>)}</tbody></table>
        )}
        {unmatching ? <div className="fk-void"><label className="fk-field"><span>{tx('finance.dr.unmatchReason')}</span><input value={unmatching.reason} onChange={(e) => setUnmatching({ ...unmatching, reason: e.target.value })} data-autofocus data-testid="unmatch-reason" /></label>
          <button type="button" className="fk-btn" onClick={() => setUnmatching(null)}>{tx('pos.cancel')}</button>
          <button type="button" className="fk-btn danger" disabled={unmatching.busy || unmatching.reason.trim().length < 3} onClick={doUnmatch} data-testid="confirm-unmatch">{tx('finance.dr.confirmUnmatch')}</button>
          {unmatching.err ? <div className="fk-err">{unmatching.err}</div> : null}</div> : null}
        {d.data.exceptions.length ? <><h3 className="fk-h3">{tx('finance.dr.cases')}</h3><ul className="fk-list dense">{d.data.exceptions.map((e: any) => <li key={e.id} className="fk-li"><div className="fk-li-main"><button type="button" className="fk-li-t link" onClick={() => setDlg({ kind: 'exception', id: e.id })}>{e.title}</button></div><span className={'fk-chip ' + (EXC_TONE[e.status] ?? 'mut')}>{lbl('finance.exc.' + e.status, e.status)}</span></li>)}</ul></> : null}
        <h3 className="fk-h3">{tx('finance.dr.payments')}</h3>
        {d.data.payments.length === 0 ? <div className="fk-hint">{tx('finance.st.noLinkedPayments')}</div> : <table className="fk-table"><tbody>{d.data.payments.map((p: any) => <tr key={p.id}><td>{p.processorTransactionId ?? p.id.slice(0, 8)}</td><td>{when(p.createdAt)}</td><td>{p.ticketNumber ? '#' + p.ticketNumber : '—'}</td><td>{p.customer ? `${p.customer.name}${p.customer.phone ? ' · ' + p.customer.phone : ''}` : tx('finance.noLinkedCustomer')}</td><td className="num">{money(p.amountCents)}</td></tr>)}</tbody></table>}
        <Notes notes={d.data.notes} />
      </>}
    </FitDialog>
  );
}
function Fig({ l, v, strong }: { l: string; v: string; strong?: boolean }) { return <div className={'fn-fig' + (strong ? ' strong' : '')}><span>{l}</span><b>{v}</b></div>; }
function Notes({ notes }: { notes: Array<{ id: string; body: string; createdAt: string | null; author: string | null }> }) {
  if (!notes?.length) return null;
  return <><h3 className="fk-h3">{tx('finance.dr.notes')}</h3><ul className="fn-notes">{notes.map((n) => <li key={n.id}><span className="fk-li-s">{n.author ?? '—'} · {when(n.createdAt)}</span><div>{n.body}</div></li>)}</ul></>;
}

function DepositView({ id, canManage, canApprove, onClose, setDlg, onDone }: { id: string; canManage: boolean; canApprove: boolean; onClose: () => void; setDlg: (d: Dlg) => void; onDone: (t: string) => void }) {
  const d = useLoad(() => api.deposit(id), [id]);
  const dep: DRow | undefined = d.data?.deposit;
  const [unmatching, setUnmatching] = useState<{ id: string; reason: string; busy?: boolean; err?: string } | null>(null);
  const doUnmatch = async () => { if (!unmatching) return; setUnmatching({ ...unmatching, busy: true }); try { await api.unmatch(unmatching.id, unmatching.reason); setUnmatching(null); d.reload(); onDone(tx('finance.dr.unmatchedDone')); } catch (e) { setUnmatching({ ...unmatching, busy: false, err: errMsg(e) }); } };
  return (
    <FitDialog wide title={dep ? tx('finance.dr.depositTitle', { a: money(dep.amountCents) }) : tx('finance.dr.deposit')} subtitle={dep ? `${fmtYmdSafe(dep.depositDate)} · ${dep.account ?? '—'}` : undefined} onClose={onClose} testId="deposit-view"
      footer={dep ? <>
        {dep.candidates > 0 && dep.remainingCents > 0 ? <button type="button" className="fk-btn" onClick={() => setDlg({ kind: 'suggest', depositId: id })}>{tx('finance.dr.reviewSuggestion')}</button> : null}
        {canManage ? <button type="button" className="fk-btn" onClick={() => setDlg({ kind: 'note', targetType: 'deposit', targetId: id, label: dep.reference ?? money(dep.amountCents) })}>{tx('finance.dr.addNote')}</button> : null}
        {canManage ? <button type="button" className="fk-btn" onClick={() => setDlg({ kind: 'raise', targetType: 'deposit', targetId: id, label: dep.reference ?? money(dep.amountCents) })}>{tx('finance.dr.investigate')}</button> : null}
        {canManage && dep.remainingCents > 0 ? <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'match', depositId: id })}>{tx('finance.dr.searchSettlements')}</button> : null}
        <button type="button" className="fk-btn" onClick={onClose}>{tx('pos.close')}</button></> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !dep ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fn-statusline"><span className={'fk-chip ' + (MATCH_TONE[dep.matchState] ?? 'mut')}>{lbl('finance.matchState.' + dep.matchState, dep.matchState)}</span><span className="fk-hint">{tx('finance.dr.depositIsRecord')}</span></div>
        <dl className="fk-dl">
          <dt>{tx('finance.dr.f.amount')}</dt><dd><b>{money(dep.amountCents)}</b> · {tx('finance.dr.f.unallocated')} {money(dep.remainingCents)}</dd>
          <dt>{tx('finance.dr.f.posted')}</dt><dd>{fmtYmdSafe(dep.depositDate)}</dd>
          <dt>{tx('finance.dr.f.account')}</dt><dd>{dep.account ?? '—'}{dep.bankName ? ` · ${dep.bankName}` : ''}</dd>
          <dt>{tx('finance.dr.f.reference')}</dt><dd>{dep.reference ?? '—'}</dd>
          <dt>{tx('finance.dr.f.source')}</dt><dd>{lbl('finance.depositSource.' + dep.source, dep.source)}{dep.createdBy ? ` · ${tx('finance.dr.f.enteredBy', { who: dep.createdBy, when: when(dep.createdAt) })}` : ''}</dd>
          {dep.notes ? <><dt>{tx('finance.dr.f.notes')}</dt><dd>{dep.notes}</dd></> : null}
        </dl>
        <h3 className="fk-h3">{tx('finance.dr.allocationHistory')}</h3>
        {d.data.allocations.length === 0 ? <div className="fk-hint">{tx('finance.dr.noAllocationsDeposit')}</div> : <table className="fk-table"><tbody>{d.data.allocations.map((a: any) => <tr key={a.id}><td>{a.settlementRef ?? a.settlementId.slice(0, 8)}</td><td>{lbl('finance.processorName.' + (a.processor ?? ''), a.processor ?? '—')}</td><td className="num">{money(a.amountCents)}</td><td>{a.createdBy ?? '—'} · {when(a.createdAt)}</td>
          <td>{a.active ? <span className="fk-chip ok">{tx('finance.active')}</span> : <span className="fk-chip mut">{tx('finance.unmatched')}</span>}</td><td>{a.active && canApprove ? <button type="button" className="fk-btn ghost sm" onClick={() => setUnmatching({ id: a.id, reason: '' })}>{tx('finance.dr.unmatch')}</button> : null}</td></tr>)}</tbody></table>}
        {unmatching ? <div className="fk-void"><label className="fk-field"><span>{tx('finance.dr.unmatchReason')}</span><input value={unmatching.reason} onChange={(e) => setUnmatching({ ...unmatching, reason: e.target.value })} data-autofocus /></label>
          <button type="button" className="fk-btn" onClick={() => setUnmatching(null)}>{tx('pos.cancel')}</button>
          <button type="button" className="fk-btn danger" disabled={unmatching.busy || unmatching.reason.trim().length < 3} onClick={doUnmatch}>{tx('finance.dr.confirmUnmatch')}</button>
          {unmatching.err ? <div className="fk-err">{unmatching.err}</div> : null}</div> : null}
        <Notes notes={d.data.notes} />
      </>}
    </FitDialog>
  );
}

function SuggestionsDialog({ depositId, canManage, onClose, onMatch }: { depositId: string; canManage: boolean; onClose: () => void; onMatch: (m: { depositId: string; settlementId: string; amountCents: number; basis: string }) => void }) {
  const d = useLoad(() => api.suggestions(depositId), [depositId]);
  return (
    <FitDialog wide title={tx('finance.dr.suggestionsTitle')} subtitle={d.data ? `${money(d.data.deposit.remainingCents)} · ${fmtYmdSafe(d.data.deposit.depositDate)} · ${d.data.deposit.reference ?? ''}` : undefined} onClose={onClose} testId="suggestions"
      footer={<button type="button" className="fk-btn" onClick={onClose}>{tx('pos.close')}</button>}>
      <div className="fk-preview">{tx('finance.dr.suggestionsNote')}</div>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div>
        : d.data.suggestions.length === 0 ? <Empty title={tx('finance.dr.noSuggestions')} />
        : <table className="fk-table"><thead><tr><th>{tx('finance.dr.col.settlement')}</th><th>{tx('finance.dr.confidence')}</th><th>{tx('finance.dr.evidence')}</th><th className="num">{tx('finance.dr.remaining')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{d.data.suggestions.map((s: any) => <tr key={s.settlement.id} data-testid="suggestion">
            <td><b>{s.settlement.settlementRef ?? s.settlement.id.slice(0, 8)}</b><span className="fk-li-s"> · {when(s.settlement.settledAt)}</span></td>
            <td><span className={'fk-chip ' + (s.confidence === 'high' ? 'ok' : s.confidence === 'medium' ? 'info' : 'warn')}>{tx('finance.dr.conf.' + s.confidence)}</span></td>
            <td className="fn-wrap">{tx('finance.basisName.' + s.basis)} · {tx('finance.dr.ev.amountDelta', { d: money(s.evidence.amountDeltaCents) })}{s.evidence.dayDelta != null ? ' · ' + tx('finance.dr.ev.dayDelta', { n: String(s.evidence.dayDelta) }) : ''}{s.evidence.referenceMatch ? ' · ' + tx('finance.dr.ev.reference') : ''}</td>
            <td className="num">{money(s.settlement.remainingCents)}</td>
            <td>{canManage ? <button type="button" className="fk-btn sm" onClick={() => onMatch({ depositId, settlementId: s.settlement.id, amountCents: s.suggestedAmountCents, basis: s.basis })}>{tx('finance.dr.reviewAndMatch')}</button> : null}</td></tr>)}</tbody></table>}
    </FitDialog>
  );
}

function MatchDialog({ init, canApprove, onClose, onDone }: { init: { depositId?: string; settlementId?: string; amountCents?: number; basis?: string }; canApprove: boolean; onClose: () => void; onDone: (t: string) => void }) {
  const [depositId, setDepositId] = useState(init.depositId ?? '');
  const [settlementId, setSettlementId] = useState(init.settlementId ?? '');
  const [find, setFind] = useState(''); const fq = useDebounced(find.trim(), 300);
  const dep = useLoad(() => (depositId ? api.deposit(depositId) : Promise.resolve(null)), [depositId]);
  const st = useLoad(() => (settlementId ? api.settlement(settlementId) : Promise.resolve(null)), [settlementId]);
  const choosing: 'settlement' | 'deposit' | null = init.depositId && !settlementId ? 'settlement' : init.settlementId && !depositId ? 'deposit' : null;
  const allTime = { preset: 'all' };   // every open record — never a hard-coded range of years
  const cands = useLoad(() => choosing === 'settlement' ? api.settlements({ ...allTime, open: '1', search: fq || undefined, page: 1, pageSize: 8, sort: 'settled_desc' })
    : choosing === 'deposit' ? api.deposits({ ...allTime, unmatched: '1', search: fq || undefined, page: 1, pageSize: 8 }) : Promise.resolve(null), [choosing, fq]);
  const D: DRow | undefined = dep.data?.deposit; const S: SRow | undefined = st.data?.settlement;
  const maxCents = D && S ? Math.min(D.remainingCents, S.remainingCents) : 0;
  const [amount, setAmount] = useState(init.amountCents != null ? textFromCents(init.amountCents) : '');
  useEffect(() => { if (D && S && !amount) setAmount(textFromCents(maxCents)); }, [D?.id, S?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [reviewed, setReviewed] = useState(false); const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a NEW key per deposit / settlement pair (the deps are the point)
  const key = useMemo(() => requestId(), [depositId, settlementId]);   // one key per attempt at this pair (a retry reuses it)
  const cents = centsFromText(amount);
  const partialBoth = !!(D && S && cents != null && cents < D.remainingCents && cents < S.remainingCents);
  const submit = async () => {
    if (!D || !S || cents == null) return; setBusy(true); setErr(null);
    try { await api.allocate({ settlementId: S.id, depositId: D.id, amountCents: cents, reviewed, note: noteText || undefined, idempotencyKey: key, basis: init.basis }); onDone(tx('finance.dr.matched', { a: money(cents) })); }
    catch (e) { const det = errDetails(e); setErr(errMsg(e) + (det.settlementRemainingCents != null ? ` (${tx('finance.dr.remainingNow', { s: money(det.settlementRemainingCents), d: money(det.depositRemainingCents) })})` : '')); setBusy(false); }
  };
  return (
    <FitDialog wide title={tx('finance.dr.matchTitle')} subtitle={tx('finance.dr.matchSub')} onClose={onClose} busy={busy} testId="match-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" disabled={busy || !D || !S || cents == null || cents <= 0 || cents > maxCents || !reviewed || (partialBoth && !canApprove)} onClick={submit} data-testid="confirm-match">{busy ? tx('pos.saving') : tx('finance.dr.confirmMatch')}</button></>}>
      <div className="fn-cols2">
        <div className="fn-side"><h3 className="fk-h3">{tx('finance.dr.deposit')}</h3>
          {D ? <div className="fk-preview"><b>{money(D.remainingCents)}</b> {tx('finance.dr.f.unallocated')} · {fmtYmdSafe(D.depositDate)}<br />{D.reference ?? '—'} · {D.account ?? ''}{choosing !== 'settlement' && !init.depositId ? <button type="button" className="fk-link" onClick={() => setDepositId('')}>{tx('finance.change')}</button> : null}</div> : choosing === 'deposit' ? null : <div className="fk-loading">{tx('pos.loading')}</div>}
        </div>
        <div className="fn-side"><h3 className="fk-h3">{tx('finance.dr.col.settlement')}</h3>
          {S ? <div className="fk-preview"><b>{money(S.remainingCents)}</b> {tx('finance.dr.stillExpected')} · {S.settlementRef ?? ''}<br />{lbl('finance.processorName.' + (S.processor ?? ''), S.processor ?? '')} · {when(S.settledAt)} · {tx('finance.dr.col.arrival')} {fmtYmdSafe(S.expectedArrival)}{choosing !== 'deposit' && !init.settlementId ? <button type="button" className="fk-link" onClick={() => setSettlementId('')}>{tx('finance.change')}</button> : null}</div> : choosing === 'settlement' ? null : <div className="fk-loading">{tx('pos.loading')}</div>}
        </div>
      </div>
      {choosing ? <>
        <input className="fk-search wide" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={tx(choosing === 'settlement' ? 'finance.dr.findSettlement' : 'finance.dr.findDeposit')} aria-label={tx(choosing === 'settlement' ? 'finance.dr.findSettlement' : 'finance.dr.findDeposit')} data-autofocus data-testid="match-find" />
        {cands.error ? <StateBlock error={cands.error} onRetry={cands.reload} /> : !cands.data ? <div className="fk-loading">{tx('pos.loading')}</div> : cands.data.items.length === 0 ? <div className="fk-hint">{tx('finance.noMatches')}</div> :
          <ul className="fk-pick">{cands.data.items.map((c: any) => <li key={c.id}><button type="button" onClick={() => { if (choosing === 'settlement') setSettlementId(c.id); else setDepositId(c.id); setAmount(''); }} data-testid="match-candidate">
            {choosing === 'settlement' ? <><b>{c.settlementRef ?? c.id.slice(0, 8)} · {money(c.remainingCents)}</b><span>{lbl('finance.processorName.' + (c.processor ?? ''), c.processor ?? '')} · {when(c.settledAt)} · {lbl('finance.recon.' + c.status, c.status)}</span></>
              : <><b>{money(c.remainingCents)} · {c.reference ?? '—'}</b><span>{fmtYmdSafe(c.depositDate)} · {c.account ?? ''}</span></>}</button></li>)}</ul>}
      </> : null}
      {D && S ? <>
        <div className="fk-grid2">
          <label className="fk-field"><span>{tx('finance.dr.allocateAmount')}</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="match-amount" /></label>
          <label className="fk-field"><span>{tx('finance.dr.matchNote')}</span><input value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={1000} /></label>
        </div>
        <div className="fk-hint">{tx('finance.dr.maxAllocate', { a: money(maxCents) })}{cents != null && cents > maxCents ? ' — ' + tx('finance.dr.tooMuch') : ''}</div>
        {partialBoth ? <div className={'fk-preview' + (canApprove ? '' : ' bad')}>{tx(canApprove ? 'finance.dr.partialBothApprover' : 'finance.dr.partialBothNeedsOwner')}</div> : null}
        <label className="fk-check"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} data-testid="match-reviewed" />{tx('finance.dr.reviewedEvidence')}</label>
        <div className="fk-hint">{tx('finance.dr.matchMovesNoMoney')}</div>
      </> : null}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function RecordDepositDialog({ accounts, today, period, onClose, onDone }: { accounts: Account[]; today: string; period?: ServerPeriod; onClose: () => void; onDone: (d: DRow, inPeriod: boolean) => void }) {
  const [bankAccountId, setBank] = useState(accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? '');
  const [amount, setAmount] = useState(''); const [date, setDate] = useState(today); const [reference, setReference] = useState(''); const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [dup, setDup] = useState<{ amountCents: number; depositDate: string } | null>(null);
  const key = useRef(requestId());
  const cents = centsFromText(amount);
  const valid = !!bankAccountId && cents != null && cents > 0 && cents <= 100_000_000 && !!date && date <= today;
  const submit = async (allowDuplicateReference = false) => {
    if (!valid || cents == null) return; setBusy(true); setErr(null);
    try {
      const r = await api.recordDeposit({ bankAccountId, amountCents: cents, depositDate: date, reference: reference.trim() || undefined, notes: notes.trim() || undefined, idempotencyKey: key.current, allowDuplicateReference });
      const inPeriod = !period?.from || !period?.to || (date >= period.from && date <= period.to);
      onDone(r.deposit, inPeriod);
    } catch (e: any) {
      if (e?.code === 'DEPOSIT_DUPLICATE_REFERENCE') { const det = errDetails(e); setDup({ amountCents: det.amountCents, depositDate: det.depositDate }); key.current = requestId(); }
      else setErr(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <FitDialog title={tx('finance.dr.recordDeposit')} subtitle={tx('finance.dr.recordSub')} onClose={onClose} busy={busy} testId="record-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" disabled={!valid || busy} onClick={() => submit(false)} data-testid="save-deposit">{busy ? tx('pos.saving') : tx('finance.dr.saveDeposit')}</button></>}>
      {accounts.length === 0 ? <div className="fk-err">{tx('finance.dr.noActiveAccount')}</div> : <>
        <label className="fk-field"><span>{tx('finance.dr.f.account')} *</span>
          <select value={bankAccountId} onChange={(e) => setBank(e.target.value)} data-testid="dep-account">{accounts.map((a) => <option key={a.id} value={a.id}>{a.masked}{a.bankName ? ` — ${a.bankName}` : ''}</option>)}</select></label>
        <div className="fk-grid2">
          <label className="fk-field"><span>{tx('finance.dr.f.amount')} *</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-autofocus data-testid="dep-amount" /></label>
          <DateField label={tx('finance.dr.f.posted')} value={date} onChange={setDate} today={today} max={today} testId="dep-date" required />
        </div>
        {amount && (cents == null || cents <= 0) ? <div className="fk-err">{tx('finance.dr.amountInvalid')}</div> : null}
        <label className="fk-field"><span>{tx('finance.dr.f.reference')}</span><input value={reference} onChange={(e) => { setReference(e.target.value); setDup(null); }} maxLength={120} data-testid="dep-reference" /></label>
        <label className="fk-field"><span>{tx('finance.dr.f.notes')}</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></label>
        <div className="fk-hint">{tx('finance.dr.sourceManual')} · {tx('finance.dr.fileNotAvailable')}</div>
        <div className="fk-preview">{tx('finance.dr.recordIsRecord')}</div>
        {dup ? <div className="fk-preview bad" role="alert">{tx('finance.dr.duplicateRef', { a: money(dup.amountCents), d: fmtYmdSafe(dup.depositDate) })}
          <div style={{ marginTop: 6 }}><button type="button" className="fk-btn danger sm" onClick={() => submit(true)} disabled={busy} data-testid="dep-confirm-duplicate">{tx('finance.dr.recordAnyway')}</button></div></div> : null}
      </>}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function AccountDialog({ account, onClose, onDone }: { account?: Account; onClose: () => void; onDone: (t: string) => void }) {
  const stepUp = useStepUp(tx('pos.stepup_bank_account_needs_password'));
  const [nickname, setNickname] = useState(account?.nickname ?? ''); const [bankName, setBankName] = useState(account?.bankName ?? ''); const [type, setType] = useState(account?.accountType ?? 'checking'); const [last4, setLast4] = useState(account?.last4 ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [confirmOff, setConfirmOff] = useState(false);
  const run = async (fn: () => Promise<unknown>, done: string) => { setBusy(true); setErr(null); try { await stepUp.run(fn); onDone(done); } catch (e) { if (!isStepUpCancelled(e)) setErr(errMsg(e)); setBusy(false); } };
  const okNew = nickname.trim().length >= 2 && (!last4 || /^\d{4}$/.test(last4));
  return (
    <FitDialog title={account ? tx('finance.dr.manageAccount', { a: account.masked ?? '' }) : tx('finance.dr.addAccount')} subtitle={tx('finance.dr.accountSub')} onClose={onClose} busy={busy} testId="account-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        {account ? <button type="button" className="fk-btn primary" disabled={busy || nickname.trim().length < 2 || nickname.trim() === account.nickname} onClick={() => run(() => api.updateBankAccount(account.id, { nickname: nickname.trim() }), tx('finance.dr.accountSaved'))}>{tx('finance.dr.saveNickname')}</button>
          : <button type="button" className="fk-btn primary" disabled={busy || !okNew} onClick={() => run(() => api.addBankAccount({ nickname: nickname.trim(), bankName: bankName.trim() || undefined, accountType: type, accountLast4: last4 || undefined }), tx('finance.dr.accountAdded'))} data-testid="save-account">{tx('finance.dr.addAccount')}</button>}</>}>
      <label className="fk-field"><span>{tx('finance.dr.nickname')} *</span><input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={60} data-autofocus data-testid="acct-nickname" /></label>
      {account ? <dl className="fk-dl"><dt>{tx('finance.dr.bank')}</dt><dd>{account.bankName ?? '—'}</dd><dt>{tx('finance.dr.last4')}</dt><dd>••••{account.last4 ?? '—'}</dd><dt>{tx('finance.status')}</dt><dd>{account.status === 'active' ? tx('finance.active') : tx('finance.dr.inactive')}{account.isDefault ? ' · ' + tx('finance.dr.default') : ''}</dd><dt>{tx('finance.dr.depositsOnFile')}</dt><dd>{fmtNumber(account.deposits)}</dd></dl> : <>
        <div className="fk-grid2">
          <label className="fk-field"><span>{tx('finance.dr.bank')}</span><input value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={80} /></label>
          <label className="fk-field"><span>{tx('finance.dr.accountType')}</span><select value={type} onChange={(e) => setType(e.target.value)}>{['checking', 'savings', 'other'].map((t) => <option key={t} value={t}>{tx('finance.accountType.' + t)}</option>)}</select></label>
        </div>
        <label className="fk-field"><span>{tx('finance.dr.last4')}</span><input inputMode="numeric" value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" data-testid="acct-last4" /></label>
      </>}
      <div className="fk-preview">{tx('finance.dr.labelNotPayout')}</div>
      {account && account.status === 'active' ? <div className="fn-acct-actions">
        {!account.isDefault ? <button type="button" className="fk-btn" disabled={busy} onClick={() => run(() => api.updateBankAccount(account.id, { makeDefault: true }), tx('finance.dr.defaultSet'))}>{tx('finance.dr.setDefault')}</button> : null}
        {!confirmOff ? <button type="button" className="fk-btn danger" disabled={busy} onClick={() => setConfirmOff(true)}>{tx('finance.dr.deactivate')}</button>
          : <><span className="fk-hint">{tx('finance.dr.deactivateConfirm')}</span><button type="button" className="fk-btn danger" disabled={busy} onClick={() => run(() => api.updateBankAccount(account.id, { deactivate: true }), tx('finance.dr.deactivated'))} data-testid="confirm-deactivate">{tx('finance.dr.deactivate')}</button></>}
      </div> : null}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
      {stepUp.prompt}
    </FitDialog>
  );
}

function ExceptionDialog({ id, canManage, canApprove, onClose, onDone, setDlg }: { id: string; canManage: boolean; canApprove: boolean; onClose: () => void; onDone: (t: string) => void; setDlg: (d: Dlg) => void }) {
  const d = useLoad(() => api.exception(id), [id]);
  const reviewers = useLoad(() => (canManage ? api.reviewers() : Promise.resolve({ items: [] })), [canManage]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [resolving, setResolving] = useState(''); const [showResolve, setShowResolve] = useState(false);
  const x = d.data?.exception;
  const act = async (fn: () => Promise<unknown>, done: string) => { setBusy(true); setErr(null); try { await fn(); d.reload(); onDone(done); setShowResolve(false); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return (
    <FitDialog wide title={x ? x.title : tx('finance.dr.case')} subtitle={x ? `${lbl('finance.excClass.' + x.class, x.class)} · ${when(x.createdAt)}` : undefined} onClose={onClose} busy={busy} testId="exception-dialog"
      footer={x ? <>
        {canManage ? <button type="button" className="fk-btn" onClick={() => setDlg({ kind: 'note', targetType: 'exception', targetId: id, label: x.title })}>{tx('finance.dr.addNote')}</button> : null}
        {canManage && (x.status === 'open' || x.status === 'reopened') ? <button type="button" className="fk-btn" disabled={busy} onClick={() => act(() => api.review(id), tx('finance.dr.markedReview'))} data-testid="mark-review">{tx('finance.dr.markReview')}</button> : null}
        {canApprove && x.status !== 'resolved' ? <button type="button" className="fk-btn primary" disabled={busy} onClick={() => setShowResolve(true)} data-testid="resolve">{tx('finance.dr.resolve')}</button> : null}
        {canManage && x.status === 'resolved' ? <button type="button" className="fk-btn" disabled={busy} onClick={() => act(() => api.reopen(id), tx('finance.dr.reopened'))}>{tx('finance.dr.reopen')}</button> : null}
        <button type="button" className="fk-btn" onClick={onClose}>{tx('pos.close')}</button></> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fn-statusline"><span className={'fk-chip ' + (EXC_TONE[x.status] ?? 'mut')}>{lbl('finance.exc.' + x.status, x.status)}</span><span className={'fk-chip ' + (SEV_TONE[x.severity] ?? 'mut')}>{lbl('finance.sev.' + x.severity, x.severity)}</span><span className="fk-hint">{tx('finance.excClassHelp.' + x.class)}</span>
          {x.dueAt ? <span className={'fk-chip ' + (x.overdue ? 'bad' : 'mut')} data-testid="exc-dlg-due">{tx(x.overdue ? 'dr10.dueOverdue' : 'dr10.dueOn', { at: when(x.dueAt) })}</span> : null}</div>
        <dl className="fk-dl">
          <dt>{tx('finance.dr.e.amount')}</dt><dd>{money(x.amountCents)}</dd>
          <dt>{tx('finance.dr.e.evidence')}</dt><dd className="fn-wrap">{x.detail ?? '—'}</dd>
          <dt>{tx('finance.dr.e.reference')}</dt><dd className="fn-mono">{x.sourceRef ?? '—'}</dd>
          <dt>{tx('finance.dr.e.reviewer')}</dt><dd>{canManage && x.status !== 'resolved' ? <select className="fk-select" value="" onChange={(e) => e.target.value && act(() => api.assign(id, e.target.value), tx('finance.dr.assigned'))} aria-label={tx('finance.dr.assign')} data-testid="assign">
              <option value="">{x.reviewer ?? tx('finance.dr.unassigned')}</option>{(reviewers.data?.items ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name} · {lbl('finance.role.' + r.role, r.role)}</option>)}</select> : (x.reviewer ?? tx('finance.dr.unassigned'))}</dd>
          {x.resolutionNote ? <><dt>{tx('finance.dr.e.resolution')}</dt><dd>{x.resolutionNote} · {when(x.resolvedAt)}</dd></> : null}
        </dl>
        {showResolve ? <div className="fk-void"><label className="fk-field"><span>{tx('finance.dr.resolveReason')}</span><input value={resolving} onChange={(e) => setResolving(e.target.value)} data-autofocus data-testid="resolve-reason" /></label>
          <button type="button" className="fk-btn" onClick={() => setShowResolve(false)}>{tx('pos.cancel')}</button>
          <button type="button" className="fk-btn primary" disabled={busy || resolving.trim().length < 3} onClick={() => act(() => api.resolve(id, resolving.trim()), tx('finance.dr.resolved'))} data-testid="confirm-resolve">{tx('finance.dr.resolve')}</button></div> : null}
        {d.data.history?.length ? <><h3 className="fk-h3">{tx('finance.dr.history')}</h3><ul className="fn-notes">{d.data.history.map((h: any, i: number) => <li key={i}><span className="fk-li-s">{when(h.at)} · {h.role ?? ''}</span><div>{lbl('finance.auditAction.' + String(h.action).replace(/^reconciliation\./, ''), String(h.action))}</div></li>)}</ul></> : null}
        <Notes notes={d.data.notes} />
      </>}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function RaiseDialog({ target, onClose, onDone }: { target: { targetType: 'settlement' | 'deposit'; targetId: string; label: string }; onClose: () => void; onDone: (r: { id: string; existing: boolean }) => void }) {
  const [kind, setKind] = useState(target.targetType === 'deposit' ? 'unmatched_deposit' : 'missing_deposit'); const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <FitDialog title={tx('finance.dr.investigateTitle', { t: target.label })} onClose={onClose} busy={busy} testId="raise-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { onDone(await api.raise({ targetType: target.targetType, targetId: target.targetId, kind, note: text || undefined })); } catch (e) { setErr(errMsg(e)); setBusy(false); } }} data-testid="confirm-raise">{tx('finance.dr.openCase')}</button></>}>
      <label className="fk-field"><span>{tx('finance.dr.caseType')}</span><select value={kind} onChange={(e) => setKind(e.target.value)} data-autofocus>{RAISE_KINDS.map((k) => <option key={k} value={k}>{tx('finance.excKind.' + k)}</option>)}</select></label>
      <label className="fk-field"><span>{tx('finance.dr.whatYouSee')}</span><textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} /></label>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function NoteDialog({ target, onClose, onDone }: { target: { targetType: 'settlement' | 'deposit' | 'exception'; targetId: string; label: string }; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <FitDialog title={tx('finance.dr.noteTitle', { t: target.label })} onClose={onClose} busy={busy} testId="note-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" disabled={busy || !text.trim()} onClick={async () => { setBusy(true); try { await api.addNote({ targetType: target.targetType, targetId: target.targetId, body: text.trim() }); onDone(); } catch (e) { setErr(errMsg(e)); setBusy(false); } }} data-testid="save-note">{tx('finance.dr.saveNote')}</button></>}>
      <label className="fk-field"><span>{tx('finance.dr.note')}</span><textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} data-autofocus /></label>
      <div className="fk-hint">{tx('finance.dr.noteHint')}</div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function FeesTab({ scope, tick, onExport }: { scope: Record<string, unknown>; tick: number; onExport: () => void }) {
  const [page, setPage] = useState(1); const [cat, setCat] = useState('all'); const [sort, setSort] = useState('created_desc');
  const key = JSON.stringify(scope); useEffect(() => setPage(1), [key, cat, sort]);
  const fit = useFitRows<HTMLDivElement>(41, { min: 3, max: 18, reserve: 34 });
  const d = useLoad(() => api.fees({ ...scope, feeCategory: cat === 'all' ? undefined : cat, sort, page, pageSize: fit.rows }), [key, cat, sort, page, fit.rows, tick]);
  const k = d.data?.kpis;
  const ns = (v: number | null) => (v == null ? <span className="fk-muted">{tx('finance.notSuppliedShort')}</span> : money(v));
  return (
    <FitPanel testId="fees" bodyRef={fit.ref} className="fn-tabbody"
      title={<span className="fn-mini-kpis">{tx('finance.dr.tab.fees')}{k ? <> · <span>{tx('finance.dr.fee.total')} <b>{money(k.totalFeesCents)}</b></span><span>{tx('finance.dr.fee.gross')} <b>{money(k.grossCents)}</b></span><span>{tx('finance.dr.fee.net')} <b>{money(k.netPayoutCents)}</b></span><span>{tx('finance.dr.fee.rate')} <b>{k.effectiveRateBps == null ? '—' : (k.effectiveRateBps / 100).toFixed(2) + '%'}</b></span></> : null}</span>}
      actions={<><select className="fk-select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label={tx('finance.dr.feeCategory')} data-testid="fee-category">{['all', 'deducted', 'zero_fee', 'adjusted', 'components'].map((c) => <option key={c} value={c}>{tx('finance.feeCat.' + c)}</option>)}</select>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')}><option value="created_desc">{tx('finance.drSort.created_desc')}</option><option value="expected_desc">{tx('finance.drSort.fee_desc')}</option></select>
        <button type="button" className="fk-btn sm" onClick={onExport}>{tx('finance.exportCsv')}</button></>}
      footer={<Pager info={d.data ? { page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pageCount } : null} onPage={setPage} label={tx('finance.dr.tab.fees')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : d.data.items.length === 0 ? <Empty title={tx('finance.dr.noFees')} /> :
        <table className="fk-table fn-table" data-testid="fees-table"><thead><tr><th>{tx('finance.processor')}</th><th>{tx('finance.dr.col.settlement')}</th><th>{tx('finance.dr.col.date')}</th><th className="num">{tx('finance.dr.col.gross')}</th><th className="num t-opt">{tx('finance.dr.fee.interchange')}</th><th className="num t-opt">{tx('finance.dr.fee.assessment')}</th><th className="num t-opt">{tx('finance.dr.fee.markup')}</th><th className="num t-opt2">{tx('finance.dr.fee.other')}</th><th className="num">{tx('finance.dr.col.fees')}</th><th className="num">{tx('finance.dr.fee.net')}</th></tr></thead>
          <tbody>{d.data.items.map((r: any) => <tr key={r.id}><td>{lbl('finance.processorName.' + (r.processor ?? ''), r.processor ?? '—')}</td><td>{r.settlementRef ?? r.id.slice(0, 8)}</td><td>{when(r.settledAt)}</td><td className="num">{money(r.grossCents)}</td>
            <td className="num t-opt">{ns(r.interchangeCents)}</td><td className="num t-opt">{ns(r.assessmentCents)}</td><td className="num t-opt">{ns(r.markupCents)}</td><td className="num t-opt2">{r.otherAdjustmentsCents ? money(r.otherAdjustmentsCents) : '—'}</td><td className="num"><b>{money(r.feeCents)}</b></td><td className="num">{money(r.netPayoutCents)}</td></tr>)}</tbody></table>}
    </FitPanel>
  );
}

function ExceptionsTab({ scope, tick, onOpen }: { scope: Record<string, unknown>; tick: number; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1); const [status, setStatus] = useState('active'); const [severity, setSeverity] = useState(''); const [cls, setCls] = useState('');
  const key = JSON.stringify(scope); useEffect(() => setPage(1), [key, status, severity, cls]);
  const fit = useFitRows<HTMLDivElement>(41, { min: 3, max: 18, reserve: 34 });
  const d = useLoad(() => api.exceptions({ ...scope, status: status || undefined, severity: severity || undefined, class: cls || undefined, page, pageSize: fit.rows }), [key, status, severity, cls, page, fit.rows, tick]);
  const k = d.data?.kpis;
  return (
    <FitPanel testId="exceptions" bodyRef={fit.ref} className="fn-tabbody"
      title={<span className="fn-mini-kpis">{tx('finance.dr.tab.exceptions')}{k ? <> · <span>{tx('finance.exc.open')} <b>{fmtNumber(k.open)}</b></span><span>{tx('finance.exc.in_review')} <b>{fmtNumber(k.inReview)}</b></span><span>{tx('finance.exc.resolved')} <b>{fmtNumber(k.resolved)}</b></span><span>{tx('finance.dr.atRisk')} <b>{money(k.amountAtRiskCents)}</b></span></> : null}</span>}
      actions={<>
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="exc-status"><option value="">{tx('finance.allStatuses')}</option><option value="active">{tx('finance.dr.unresolved')}</option>{['open', 'in_review', 'escalated', 'reopened', 'resolved'].map((s) => <option key={s} value={s}>{tx('finance.exc.' + s)}</option>)}</select>
        <select className="fk-select" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label={tx('finance.dr.severity')}><option value="">{tx('finance.dr.allSeverities')}</option>{['critical', 'high', 'moderate', 'low', 'info'].map((s) => <option key={s} value={s}>{tx('finance.sev.' + s)}</option>)}</select>
        <select className="fk-select" value={cls} onChange={(e) => setCls(e.target.value)} aria-label={tx('finance.dr.caseType')} data-testid="exc-class"><option value="">{tx('finance.dr.allTypes')}</option>{['missing', 'amount_mismatch', 'duplicate', 'unmatched_credit', 'fee_reversal', 'integration'].map((c) => <option key={c} value={c}>{tx('finance.excClass.' + c)}</option>)}</select></>}
      footer={<Pager info={d.data ? { page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pageCount } : null} onPage={setPage} label={tx('finance.dr.tab.exceptions')} />}>
      {d.data?.cardAttempts ? <CardAttemptsBlock ca={d.data.cardAttempts} /> : null}
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : d.data.items.length === 0 ? <Empty title={tx('finance.dr.noCases')} /> :
        <table className="fk-table fn-table" data-testid="exceptions-table"><thead><tr><th>{tx('finance.dr.e.case')}</th><th>{tx('finance.dr.e.type')}</th><th>{tx('finance.dr.severity')}</th><th>{tx('finance.dr.e.reference')}</th><th className="num">{tx('finance.dr.e.amount')}</th><th className="t-opt">{tx('finance.dr.e.source')}</th><th>{tx('finance.status')}</th><th className="t-opt">{tx('finance.dr.e.reviewer')}</th><th className="num">{tx('finance.dr.e.age')}</th><th>{tx('dr10.due')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{d.data.items.map((e: any) => <tr key={e.id}><td className="fn-id"><button type="button" className="fk-li-t link" onClick={() => onOpen(e.id)}>{e.title}</button><span className="fk-li-s">{e.id.slice(0, 8)}</span></td>
            <td>{lbl('finance.excClass.' + e.class, e.class)}</td><td><span className={'fk-chip ' + (SEV_TONE[e.severity] ?? 'mut')}>{lbl('finance.sev.' + e.severity, e.severity)}</span></td>
            <td>{e.settlementRef ?? e.depositReference ?? '—'}</td><td className="num">{money(e.amountCents)}</td><td className="t-opt">{e.processor ? lbl('finance.processorName.' + e.processor, e.processor) : e.account ?? '—'}</td>
            <td><span className={'fk-chip ' + (EXC_TONE[e.status] ?? 'mut')}>{lbl('finance.exc.' + e.status, e.status)}</span></td><td className="t-opt">{e.reviewer ?? '—'}</td><td className="num">{tx('finance.dr.days', { n: fmtNumber(e.ageDays) })}</td>
            <td data-testid="exc-due">{e.dueAt ? <>{when(e.dueAt)}{e.overdue ? <span className="fk-chip bad" style={{ marginLeft: 4 }}>{tx('dr10.overdue')}</span> : null}</> : '—'}</td>
            <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => onOpen(e.id)}>{tx('finance.dr.viewEvidence')}</button></td></tr>)}</tbody></table>}
    </FitPanel>
  );
}

/** extras PAYMENTS 09 — the unresolved card attempts in the same inbox as the reconciliation cases (server list, read-only):
 *  why each is open (stale in flight / needs review / stranded), its evidence, and a link to Split Payments to settle it. */
interface CardAttempt { id: string; ticketId: string | null; ticketNumber: string | null; amountCents: number; state: string; reason: string; resolutionNote: string | null; lastErrorCode: string | null; card: { brand: string | null; last4: string } | null; ageMinutes: number }
function CardAttemptsBlock({ ca }: { ca: { total: number; amountCents: number; staleAfterMinutes: number; items: CardAttempt[] } }) {
  const nav = useNavigate();
  if (!ca.total) return <div className="fk-hint" data-testid="exc-card-none">{tx('finance.exc.card.none')}</div>;
  const age = (m: number) => (m >= 1440 ? tx('finance.dr.days', { n: fmtNumber(Math.floor(m / 1440)) }) : m >= 60 ? tx('finance.exc.card.hours', { n: fmtNumber(Math.floor(m / 60)) }) : tx('finance.exc.card.minutes', { n: fmtNumber(m) }));
  return (
    <div className="fk-note warn" data-testid="exc-card-attempts" style={{ display: 'block', marginBottom: 8 }}>
      <b>{tx('finance.exc.card.title', { n: fmtNumber(ca.total), a: money(ca.amountCents) })}</b>
      <ul className="tm-reasons">{ca.items.map((a) => <li key={a.id} data-testid="exc-card-row" data-reason={a.reason}>
        {a.ticketNumber ? '#' + a.ticketNumber : tx('rv.notLinked')} · {money(a.amountCents)} · {tx('finance.exc.card.reason.' + a.reason, { m: fmtNumber(ca.staleAfterMinutes) })}
        {a.card ? ` · ${(a.card.brand ?? '').toUpperCase()} ••${a.card.last4}` : ''} · {age(a.ageMinutes)}
        {a.resolutionNote ? <span className="fk-li-s"> {lbl('finance.exc.card.note.' + a.resolutionNote, a.resolutionNote)}</span> : null}
        {a.lastErrorCode ? <span className="fk-li-s"> {tx('finance.exc.card.err', { c: a.lastErrorCode })}</span> : null}
      </li>)}</ul>
      {ca.total > ca.items.length ? <div className="fk-li-s">{tx('finance.exc.card.more', { n: fmtNumber(ca.total - ca.items.length) })}</div> : null}
      <button type="button" className="fk-btn sm" onClick={() => nav('/tenant/payments/split-payments')} data-testid="exc-card-open">{tx('finance.exc.card.open')}</button>
    </div>
  );
}

function ReportsTab({ scope, tick, onExport }: { scope: Record<string, unknown>; tick: number; onExport: (type: string, fmt: 'csv' | 'pdf') => void }) {
  const [type, setType] = useState('settlement_summary'); const [page, setPage] = useState(1);
  const key = JSON.stringify(scope); useEffect(() => setPage(1), [key, type]);
  const fit = useFitRows<HTMLDivElement>(41, { min: 3, max: 18, reserve: 34 });
  const d = useLoad(() => api.report(type, { ...scope, page, pageSize: fit.rows }), [key, type, page, fit.rows, tick]);
  const cols: Array<{ key: string; label: string; money?: boolean }> = d.data?.columns ?? [];
  return (
    <div className="fn-reports">
      <nav className="fn-report-list" aria-label={tx('finance.dr.reportTypes')}>
        {REPORTS.map((r) => <button key={r} type="button" className={'fn-report-btn' + (type === r ? ' on' : '')} aria-current={type === r ? 'true' : undefined} onClick={() => setType(r)} data-testid={'report-' + r}>{tx('finance.report.' + r)}</button>)}
      </nav>
      <FitPanel testId="report" bodyRef={fit.ref} className="fn-tabbody" title={tx('finance.report.' + type)}
        actions={<><button type="button" className="fk-btn sm" onClick={() => onExport(type, 'csv')} data-testid="report-csv">{tx('finance.exportCsv')}</button><button type="button" className="fk-btn sm" onClick={() => onExport(type, 'pdf')} data-testid="report-pdf">{tx('finance.exportPdf')}</button></>}
        footer={<div className="fn-report-foot">{d.data ? <span className="fn-totals" data-testid="report-totals">{Object.entries(d.data.totals as Record<string, number>).map(([kk, v]) => <span key={kk}>{tx('finance.total')} {lbl('finance.reportCol.' + kk, kk)}: <b>{/Cents$/.test(kk) ? money(v) : fmtNumber(v)}</b></span>)}</span> : null}
          <Pager compact info={d.data ? { page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pageCount } : null} onPage={setPage} label={tx('finance.report.' + type)} /></div>}>
        {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
          <div className="fk-hint fn-def">{tx('finance.reportDef.' + type)}</div>
          {d.data.rows.length === 0 ? <Empty title={tx('finance.dr.noReportRows')} /> :
            <table className="fk-table fn-table" data-testid="report-table"><thead><tr>{cols.map((c) => <th key={c.key} className={c.money ? 'num' : ''}>{lbl('finance.reportCol.' + c.key, c.label)}</th>)}</tr></thead>
              <tbody>{d.data.rows.map((row: Record<string, unknown>, i: number) => <tr key={i}>{cols.map((c) => <td key={c.key} className={c.money ? 'num' : ''}>{c.money ? money(Number(row[c.key] ?? 0)) : reportCell(c.key, row[c.key])}</td>)}</tr>)}</tbody></table>}
        </>}
      </FitPanel>
    </div>
  );
}
function reportCell(key: string, v: unknown): string {
  if (v == null || v === '') return '—';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtYmdSafe(s);
  if (key === 'state') return codeLabel('finance.matchState.' + s, s);
  if (key === 'status') return codeLabel('finance.accountStatus.' + s, s);
  if (key === 'source') return codeLabel('finance.basisName.' + s, codeLabel('finance.depositSource.' + s, s));
  if (key === 'processor') return codeLabel('finance.processorName.' + s, s);
  if (key === 'bucket') return codeLabel('finance.ageBucket.' + s, s);
  return s;
}
