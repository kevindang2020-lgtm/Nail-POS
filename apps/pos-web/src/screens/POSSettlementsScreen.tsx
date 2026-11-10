// POSSettlementsScreen.tsx — Payments & Money → Deposits & Settlements (/tenant/payments/settlements). Deposits & Settlements
// mandate (Oct 29 2026): ONE full-screen page that fits the POS content area at 100 % zoom —
//   header (Refresh · Export Report · View Deposit Reconciliation) · toolbar (presets + Custom Range calendar + date basis,
//   universal search, processor, status) · six KPI cards (server aggregates over the filters) · the reconciliation strip
//   (gross → fees → provider net payout vs bank-confirmed; "Not bank verified" without bank data) · Settlements / Refunds
//   tabs, each with its own numbered server pages (newest created first) that fill the rest of the screen.
// Fixes: "Net Deposited" was a processor figure presented as bank cash (now "Net Processor Payout"; bank-confirmed is
// separate); refunds were subtracted again from a net that already contained them; the period was the browser's clock
// ("This Week" = the last 7 days); there was no record list at all. Browsing never moves money.
import { useEffect, useRef, useState } from 'react';
import { SystemCheckButton } from '../components/SystemCheck';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posSettlementsApi } from '../api/posSettlementsApi';
import { posDepositReconApi } from '../api/posDepositReconApi';
import { useCan } from '../components/usePermissions';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, fmtYmdSafe, type PeriodState } from '../components/FinanceKit';

type Bank = 'unverified' | 'partial' | 'matched';
type SRow = { id: string; settlementRef: string | null; processor: string | null; fundingAccount: string | null; settledAt: string | null; createdAt: string | null; expectedPayoutDate: string | null;
  transactionCount: number; linkedPayments: number; grossCents: number; feeCents: number; netCents: number; expectedPayoutCents: number; refundsInBatchCents: number; chargebacksInBatchCents: number; adjustmentsCents: number;
  currency: string; providerStatus: string; bankState: Bank; bankConfirmedCents: number; linkedDeposits: number; matchedBy: string | null };
type RRow = { id: string; refundRef: string | null; processor: string | null; amountCents: number; reason: string | null; status: 'requested' | 'processing' | 'completed' | 'failed' | 'reversed'; rawStatus: string; createdAt: string | null; completedAt: string | null;
  payment: { id: string; processorTransactionId: string | null; amountCents: number; method: string | null; card: string | null; createdAt: string | null; refundsOnPayment: number } | null;
  ticket: { id: string; number: string | null } | null; customer: { id: string; name: string; phone: string | null } | null; saleSettlement: { id: string; ref: string | null } | null; matchedBy: string | null };
type Tab = 'settlements' | 'refunds';
const money = (c: number | null | undefined) => fmtMoney(c ?? 0);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const whenTime = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const lbl = (k: string, fb: string) => codeLabel(k, fb);
const BANK_TONE: Record<Bank, string> = { unverified: 'mut', partial: 'warn', matched: 'ok' };
const REFUND_TONE: Record<string, string> = { completed: 'ok', requested: 'warn', processing: 'info', failed: 'bad', reversed: 'mut' };
const PROVIDER_TONE: Record<string, string> = { settled: 'info', posted: 'info', pending: 'warn', needs_review: 'warn', failed: 'bad', returned: 'bad' };
const STATUS_OPTS = ['p:pending', 'p:settled', 'p:posted', 'p:needs_review', 'p:failed', 'p:returned', 'b:unverified', 'b:partial', 'b:matched'];
const REFUND_STATUS_OPTS = ['requested', 'processing', 'completed', 'failed', 'reversed'];
const S_SORTS = ['created_desc', 'created_asc', 'settled_desc', 'settled_asc', 'gross_desc', 'gross_asc', 'net_desc', 'net_asc'];
const R_SORTS = ['created_desc', 'created_asc', 'amount_desc', 'amount_asc'];

export function POSSettlementsScreen() {
  const nav = useNavigate();
  const can = useCan();
  const canExport = can('reports.export');
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' });
  const [basis, setBasis] = useState('settlement_date');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [processor, setProcessor] = useState('');
  const [status, setStatus] = useState('');          // settlements tab: 'p:…' provider / 'b:…' bank
  const [rStatus, setRStatus] = useState('');        // refunds tab
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'refunds' ? 'refunds' : 'settlements');
  const [pages, setPages] = useState<Record<Tab, number>>({ settlements: 1, refunds: 1 });
  const [sorts, setSorts] = useState<Record<Tab, string>>({ settlements: 'created_desc', refunds: 'created_desc' });
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string; action?: { label: string; run: () => void }[] } | null>(null);
  const [open, setOpen] = useState<{ kind: 'settlement'; id: string } | { kind: 'refund'; row: RRow } | null>(params.get('settlement') ? { kind: 'settlement', id: String(params.get('settlement')) } : null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const fit = useFitRows<HTMLDivElement>(41, { min: 3, max: 18, reserve: 34 });

  // any filter change resets BOTH lists to Page 1 (each keeps its own page otherwise)
  const filterKey = JSON.stringify([period, basis, q, processor, status, rStatus]);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setPages({ settlements: 1, refunds: 1 }); }, [filterKey]);

  const pq = periodQuery(period);
  const sStatus = status.startsWith('p:') ? status.slice(2) : undefined, sBank = status.startsWith('b:') ? status.slice(2) : undefined;
  const sumQ = { ...pq, dateField: basis, search: q || undefined, processor: processor || undefined, status: tab === 'refunds' ? (rStatus || undefined) : sStatus, bank: tab === 'settlements' ? sBank : undefined };
  const summary = useLoad(() => posSettlementsApi.summary(sumQ), [JSON.stringify(sumQ), tick]);
  const listQ = tab === 'settlements'
    ? { tab, ...pq, dateField: basis, search: q || undefined, processor: processor || undefined, status: sStatus, bank: sBank, sort: sorts.settlements, page: pages.settlements, pageSize: fit.rows }
    : { tab, ...pq, search: q || undefined, processor: processor || undefined, status: rStatus || undefined, sort: sorts.refunds, page: pages.refunds, pageSize: fit.rows };
  const list = useLoad(() => posSettlementsApi.list(listQ), [JSON.stringify(listQ), tick]);
  // Settlements guide §10 (Nov 4 2026): one search finds settlements AND refunds — while searching, the other tab's match count
  // shows on its tab, so a refund id typed on Settlements is never a dead end
  const otherTab: Tab = tab === 'settlements' ? 'refunds' : 'settlements';
  const otherQ = q ? { tab: otherTab, ...pq, search: q, processor: processor || undefined, page: 1, pageSize: 1 } : null;
  const other = useLoad(() => (otherQ ? posSettlementsApi.list(otherQ) : Promise.resolve(null)), [JSON.stringify(otherQ), tick]);
  useEffect(() => { const d = list.data; if (d && d.page !== pages[tab]) setPages((p) => ({ ...p, [tab]: d.page })); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  // a new record since the last look: first on Page 1 when it qualifies; otherwise say so and offer View / Clear Filters
  const seen = useRef<{ s?: string; r?: string }>({});
  useEffect(() => {
    const n = summary.data?.newest; if (!n) return;
    const check = (k: 's' | 'r', rec: { id: string; inScope: boolean } | null, kind: 'settlement' | 'refund') => {
      if (!rec) return;
      if (seen.current[k] && seen.current[k] !== rec.id) {
        if (rec.inScope) { setHighlight(rec.id); setTimeout(() => setHighlight(null), 4000); }
        else setNote({ tone: 'warn', text: tx(kind === 'settlement' ? 'finance.st.newOutside' : 'finance.st.newRefundOutside'), action: [
          ...(kind === 'settlement' ? [{ label: tx('finance.viewRecord'), run: () => setOpen({ kind: 'settlement', id: rec.id }) }] : []),
          { label: tx('finance.clearFilters'), run: () => clearAll() }] });
      }
      seen.current[k] = rec.id;
    };
    check('s', n.settlement, 'settlement'); check('r', n.refund, 'refund');
  }, [summary.data]);    

  const clearAll = () => { setSearch(''); setProcessor(''); setStatus(''); setRStatus(''); setPeriod({ preset: 'month' }); setBasis('settlement_date'); setNote(null); };
  const refresh = () => { setTick((t) => t + 1); };
  const exportReport = async () => {
    try {
      const csv = await posSettlementsApi.exportCsv({ ...listQ, page: undefined, pageSize: undefined });
      download(`${tab}-${summary.data?.period?.from ?? 'all'}-${summary.data?.period?.to ?? ''}.csv`, csv, 'text/csv;charset=utf-8');
      setNote({ tone: 'ok', text: tx('finance.exported') });
    } catch (e) { setNote({ tone: 'bad', text: (e as Error).message || tx('finance.state.loadFailed') }); }
  };

  const s = summary.data; const k = s?.kpis; const r = s?.reconciliation; const src = s?.sourceStatus;
  // Settlements guide audit (Nov 4 2026): with no processor feed (not set up / paused) and no batch ever received, the settlement
  // money cards say "Not set up" — a $0.00 there read as a real zero
  const noFeed = !!(src && (src.state === 'not_configured' || src.state === 'inactive') && k && k.settlements === 0);
  const kLoading = summary.loading && !s;
  const kErr = summary.error;
  const sourceNote = src && src.state !== 'connected'
    ? <div className={'fk-note ' + (src.state === 'awaiting_first_settlement' ? 'ok' : 'bad')} role="status" data-testid="source-note">
        <span>{tx('finance.st.source.' + src.state)}</span>
        {src.state !== 'awaiting_first_settlement' ? <button type="button" className="fk-link" onClick={() => nav('/tenant/integrations/payment-gateway')}>{tx('finance.st.configureProcessor')}</button> : null}
      </div> : null;
  const rows = (list.data?.items ?? []) as (SRow | RRow)[];
  const info = list.data ? { page: list.data.page, pageSize: list.data.pageSize, totalItems: list.data.total, totalPages: list.data.pageCount } : null;
  const processors: string[] = s?.options?.processors ?? [];
  const filtersOn = !!(q || processor || status || rStatus);
  const goRecon = (settlementId?: string) => nav('/tenant/payments/deposit-reconciliation' + (settlementId ? `?settlement=${encodeURIComponent(settlementId)}` : ''));

  return (
    <div className="work fit st" data-testid="settlements-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('finance.st.title')}</h1><div className="sub">{tx('finance.st.subtitle')}</div></div>
        <div className="fk-head-actions">
          <SystemCheckButton domain="settlements" />
          <button type="button" className="fk-btn" onClick={refresh} data-testid="refresh" title={tx('finance.st.refreshHint')}>{tx('finance.refresh')}</button>
          {canExport ? <button type="button" className="fk-btn" onClick={exportReport} data-testid="export">{tx('finance.exportReport')}</button> : null}
          <button type="button" className="fk-btn primary" onClick={() => goRecon()} data-testid="open-recon">{tx('finance.st.viewRecon')}</button>
        </div>
      </header>
      {note ? <div className={'fk-note ' + (note.tone === 'warn' ? 'bad' : note.tone)} role="status" data-testid="note"><span>{note.text}</span>
        <span className="fn-note-acts">{note.action?.map((a) => <button key={a.label} type="button" className="fk-link" onClick={() => { a.run(); setNote(null); }}>{a.label}</button>)}
          <button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></span></div> : sourceNote}

      <div className="fn-toolbar" role="toolbar" aria-label={tx('finance.filters')}>
        <PeriodBar value={period} onChange={setPeriod} server={s?.period ?? list.data?.period} basis={tab === 'refunds' ? 'refund_date' : basis} onBasis={tab === 'refunds' ? undefined : setBasis}
          basisOptions={tab === 'refunds' ? undefined : [{ value: 'settlement_date', label: tx('finance.basis.settlement_date') }, { value: 'expected_payout', label: tx('finance.basis.expected_payout') }, { value: 'created', label: tx('finance.basis.created') }]} />
        {tab === 'refunds' ? <span className="fn-basis-static">{tx('finance.period.dateField')}: <b>{tx('finance.basis.refund_date')}</b></span> : null}
        <div className="fn-search">
          <input className="fk-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('finance.st.searchPh')} aria-label={tx('finance.st.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}
        </div>
        <select className="fk-select" value={processor} onChange={(e) => setProcessor(e.target.value)} aria-label={tx('finance.processor')} data-testid="processor">
          <option value="">{tx('finance.allProcessors')}</option>
          {processors.map((p) => <option key={p} value={p}>{lbl('finance.processorName.' + p, p)}</option>)}
        </select>
        {tab === 'settlements' ? (
          <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="status">
            <option value="">{tx('finance.allStatuses')}</option>
            <optgroup label={tx('finance.st.providerStatus')}>{STATUS_OPTS.filter((o) => o.startsWith('p:')).map((o) => <option key={o} value={o}>{lbl('finance.provider.' + o.slice(2), o.slice(2))}</option>)}</optgroup>
            <optgroup label={tx('finance.st.bankState')}>{STATUS_OPTS.filter((o) => o.startsWith('b:')).map((o) => <option key={o} value={o}>{lbl('finance.bank.' + o.slice(2), o.slice(2))}</option>)}</optgroup>
          </select>
        ) : (
          <select className="fk-select" value={rStatus} onChange={(e) => setRStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="status">
            <option value="">{tx('finance.allStatuses')}</option>
            {REFUND_STATUS_OPTS.map((o) => <option key={o} value={o}>{lbl('finance.refund.' + o, o)}</option>)}
          </select>
        )}
        {filtersOn ? <button type="button" className="fk-link" onClick={clearAll} data-testid="reset-filters">{tx('finance.resetFilters')}</button> : null}
      </div>

      <div className="fk-kpis six" data-testid="kpis">
        {kErr ? <StateBlock error={kErr} onRetry={summary.reload} /> : <>
          <KpiCard testId="kpi-settlements" label={tx('finance.st.kpi.settlements')} loading={kLoading} value={k ? (noFeed ? tx('finance.st.notSetUp') : fmtNumber(k.settlements)) : ''} sub={s ? tx('finance.st.kpi.settlementsSub', { basis: tx('finance.basis.' + s.dateBasis) }) : ''} onClick={() => setTab('settlements')} />
          <KpiCard testId="kpi-gross" label={tx('finance.st.kpi.gross')} loading={kLoading} value={k ? (noFeed ? tx('finance.st.notSetUp') : money(k.grossSettledCents)) : ''} sub={tx('finance.st.kpi.grossSub')} onClick={() => { setTab('settlements'); setSorts((x) => ({ ...x, settlements: 'gross_desc' })); }} />
          <KpiCard testId="kpi-fees" label={tx('finance.st.kpi.fees')} loading={kLoading} value={k ? (noFeed ? tx('finance.st.notSetUp') : money(k.processorFeesCents)) : ''} sub={tx('finance.st.kpi.feesSub')} onClick={() => goRecon()} />
          <KpiCard testId="kpi-net" label={tx('finance.st.kpi.net')} tone="gold" loading={kLoading} value={k ? (noFeed ? tx('finance.st.notSetUp') : money(k.netProcessorPayoutCents)) : ''} sub={r ? (r.bankVerified ? tx('finance.st.kpi.netSubBank', { v: money(r.bankConfirmedCents) }) : tx('finance.notBankVerified')) : ''} onClick={() => { setTab('settlements'); setSorts((x) => ({ ...x, settlements: 'net_desc' })); }} />
          <KpiCard testId="kpi-refunds" label={tx('finance.st.kpi.refunds')} loading={kLoading} value={k ? fmtNumber(k.refunds) : ''} sub={k ? tx('finance.st.kpi.refundsSub', { c: fmtNumber(k.refundsCompleted), o: fmtNumber(k.refundsOpen), f: fmtNumber(k.refundsFailed) }) : ''} onClick={() => setTab('refunds')} />
          <KpiCard testId="kpi-refunds-total" label={tx('finance.st.kpi.refundsTotal')} loading={kLoading} tone={k && k.refundsTotalCents > 0 ? 'warn' : undefined} value={k ? money(k.refundsTotalCents) : ''} sub={tx('finance.st.kpi.refundsTotalSub')} onClick={() => { setTab('refunds'); setRStatus('completed'); }} />
        </>}
      </div>

      <section className="fn-strip" aria-label={tx('finance.st.reconTitle')} data-testid="recon-strip">
        <h2 className="fn-strip-t">{tx('finance.st.reconTitle')}</h2>
        {kErr ? <span className="fk-muted">{tx('finance.state.loadFailed')}</span> : !r ? <span className="fk-skel" aria-hidden /> : <>
          <Cell l={tx('finance.st.r.gross')} v={money(r.grossCents)} />
          <Cell l={tx('finance.st.r.fees')} v={'− ' + money(r.feesDeductedCents)} />
          {r.refundsInBatchCents || r.chargebacksInBatchCents ? <Cell l={tx('finance.st.r.refundsIn')} v={'− ' + money(r.refundsInBatchCents + r.chargebacksInBatchCents)} hint={tx('finance.st.r.refundsInHint')} /> : null}
          {r.adjustmentsCents ? <Cell l={tx('finance.st.r.adjustments')} v={(r.adjustmentsCents < 0 ? '− ' : '+ ') + money(Math.abs(r.adjustmentsCents))} /> : null}
          {r.providerDefinedDifferenceCents ? <Cell l={tx('finance.st.r.providerDiff')} v={money(r.providerDefinedDifferenceCents)} hint={tx('finance.st.r.providerDiffHint')} tone="warn" /> : null}
          <Cell l={tx('finance.st.r.expected')} v={'= ' + money(r.expectedPayoutCents)} strong />
          <Cell l={tx('finance.st.r.bank')} v={r.bankVerified ? money(r.bankConfirmedCents) : tx('finance.notBankVerified')} tone={r.bankVerified ? undefined : 'mut'} testId="bank-confirmed" />
          <Cell l={tx('finance.st.r.difference')} v={r.differenceCents == null ? tx('finance.notVerified') : money(r.differenceCents)} tone={r.differenceCents ? 'warn' : undefined}
            hint={r.bankVerified ? tx('finance.st.r.differenceHint', { m: fmtNumber(r.matched), p: fmtNumber(r.partial), u: fmtNumber(r.unverified) }) : undefined} />
        </>}
      </section>

      <FitPanel testId="records" className="fn-records" bodyRef={fit.ref}
        title={<span className="fk-seg fn-tabs" role="tablist">
          {(['settlements', 'refunds'] as Tab[]).map((t) => <button type="button" role="tab" key={t} aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'tab-' + t}>{tx('finance.st.tab.' + t)}{list.data && tab === t ? ` · ${fmtNumber(list.data.total)}` : q && other.data && t === otherTab ? ` · ${fmtNumber(other.data.total)}` : ''}</button>)}
        </span>}
        actions={<select className="fk-select" aria-label={tx('finance.sort')} value={sorts[tab]} onChange={(e) => { setSorts((x) => ({ ...x, [tab]: e.target.value })); setPages((p) => ({ ...p, [tab]: 1 })); }} data-testid="sort">
          {(tab === 'settlements' ? S_SORTS : R_SORTS).map((o) => <option key={o} value={o}>{tx('finance.sortBy.' + o)}</option>)}
        </select>}
        footer={<Pager info={info} onPage={(p) => setPages((x) => ({ ...x, [tab]: p }))} label={tx('finance.st.tab.' + tab)} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} />
          : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : rows.length === 0 ? <Empty title={filtersOn ? tx('finance.noMatches') : src && src.state !== 'connected' ? tx('finance.st.emptyNoSource') : tx('finance.st.emptyPeriod')}>
              {filtersOn ? <button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button>
                : <><button type="button" className="fk-btn" onClick={() => setPeriod({ preset: 'year' })}>{tx('finance.tryThisYear')}</button><button type="button" className="fk-btn" onClick={refresh}>{tx('finance.refresh')}</button></>}
            </Empty>
          : tab === 'settlements' ? (
            <table className="fk-table fn-table" data-testid="settlements-table">
              <thead><tr><th>{tx('finance.st.col.id')}</th><th>{tx('finance.st.col.date')}</th><th className="num t-opt">{tx('finance.st.col.txns')}</th><th className="num">{tx('finance.st.col.gross')}</th><th className="num">{tx('finance.st.col.fees')}</th><th className="num">{tx('finance.st.col.net')}</th><th>{tx('finance.st.col.bank')}</th><th>{tx('finance.st.col.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
              <tbody>
                {(rows as SRow[]).map((x) => (
                  <tr key={x.id} className={highlight === x.id ? 'fn-new' : ''} data-testid="settlement-row">
                    <td className="fn-id"><button type="button" className="fk-li-t link" onClick={() => setOpen({ kind: 'settlement', id: x.id })}>{x.settlementRef ?? x.id.slice(0, 8)}</button>
                      <span className="fk-li-s">{lbl('finance.processorName.' + (x.processor ?? ''), x.processor ?? '—')}{x.fundingAccount ? ` · ${x.fundingAccount}` : ''}{x.matchedBy && q ? ` · ${tx('finance.matchedBy.' + x.matchedBy)}` : ''}</span></td>
                    <td>{when(x.settledAt ?? x.createdAt)}</td>
                    <td className="num t-opt">{fmtNumber(x.transactionCount || x.linkedPayments)}</td>
                    <td className="num">{money(x.grossCents)}</td>
                    <td className="num">{money(x.feeCents)}</td>
                    <td className="num"><b>{money(x.expectedPayoutCents)}</b></td>
                    <td>{x.bankState === 'unverified' ? <span className="fk-chip mut">{tx('finance.notVerified')}</span> : <span className={'fk-chip ' + BANK_TONE[x.bankState]}>{money(x.bankConfirmedCents)}</span>}</td>
                    <td><span className={'fk-chip ' + (PROVIDER_TONE[x.providerStatus] ?? 'mut')}>{lbl('finance.provider.' + x.providerStatus, x.providerStatus)}</span></td>
                    <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => setOpen({ kind: 'settlement', id: x.id })}>{tx('finance.view')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="fk-table fn-table" data-testid="refunds-table">
              <thead><tr><th>{tx('finance.st.rcol.ref')}</th><th>{tx('finance.st.rcol.payment')}</th><th>{tx('finance.st.rcol.customer')}</th><th>{tx('finance.st.rcol.date')}</th><th className="num">{tx('finance.st.rcol.amount')}</th><th>{tx('finance.st.rcol.status')}</th><th className="t-opt">{tx('finance.st.rcol.impact')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
              <tbody>
                {(rows as RRow[]).map((x) => (
                  <tr key={x.id} className={highlight === x.id ? 'fn-new' : ''} data-testid="refund-row">
                    <td className="fn-id"><button type="button" className="fk-li-t link" onClick={() => setOpen({ kind: 'refund', row: x })}>{x.refundRef ?? x.id.slice(0, 8)}</button>{x.matchedBy && q ? <span className="fk-li-s">{tx('finance.matchedBy.' + x.matchedBy)}</span> : null}</td>
                    <td>{x.payment ? <span>{x.payment.processorTransactionId ?? x.payment.id.slice(0, 8)}{x.ticket?.number ? <span className="fk-li-s"> · #{x.ticket.number}</span> : null}</span> : '—'}</td>
                    <td>{x.customer ? <span>{x.customer.name}{x.customer.phone ? <span className="fk-li-s"> · {x.customer.phone}</span> : null}</span> : <span className="fk-muted">{tx('finance.noLinkedCustomer')}</span>}</td>
                    <td>{when(x.createdAt)}</td>
                    <td className="num"><b>{money(x.amountCents)}</b></td>
                    <td><span className={'fk-chip ' + (REFUND_TONE[x.status] ?? 'mut')}>{lbl('finance.refund.' + x.status, x.status)}</span></td>
                    <td className="t-opt fk-muted">{x.saleSettlement ? tx('finance.st.saleBatch', { ref: x.saleSettlement.ref ?? x.saleSettlement.id.slice(0, 8) }) : tx('finance.st.notInBatch')}</td>
                    <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => setOpen({ kind: 'refund', row: x })}>{tx('finance.view')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </FitPanel>

      {open?.kind === 'settlement' ? <SettlementDetail id={open.id} canExport={canExport} onClose={() => { setOpen(null); if (params.get('settlement')) { params.delete('settlement'); setParams(params, { replace: true }); } }} onRecon={goRecon} onNote={setNote} /> : null}
      {open?.kind === 'refund' ? <RefundDetail row={open.row} onClose={() => setOpen(null)} onSettlement={(id) => setOpen({ kind: 'settlement', id })} /> : null}
    </div>
  );
}

function Cell({ l, v, hint, strong, tone, testId }: { l: string; v: string; hint?: string; strong?: boolean; tone?: string; testId?: string }) {
  return <div className={'fn-cell' + (strong ? ' strong' : '') + (tone ? ' ' + tone : '')} title={hint} data-testid={testId}><span className="fn-cell-l">{l}</span><span className="fn-cell-v">{v}</span>{hint ? <span className="fn-cell-h">{hint}</span> : null}</div>;
}

function download(name: string, body: string | Blob, type: string) {
  const blob = typeof body === 'string' ? new Blob([body], { type }) : body;
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export { download as financeDownload };

function SettlementDetail({ id, canExport, onClose, onRecon, onNote }: { id: string; canExport: boolean; onClose: () => void; onRecon: (id: string) => void; onNote: (n: { tone: 'ok' | 'bad'; text: string }) => void }) {
  const d = useLoad(() => posSettlementsApi.detail(id), [id]);
  // Settlements guide (Nov 4 2026): Investigate — raise (or reopen) the reconciliation case for this batch; never a duplicate of an open case
  const canInvestigate = useCan()('reconciliation.manage');
  const [inv, setInv] = useState<null | { kind: string; note: string; busy: boolean; err: string | null }>(null);
  const investigate = async () => {
    if (!inv) return; setInv({ ...inv, busy: true, err: null });
    try { const r = await posDepositReconApi.raise({ targetType: 'settlement', targetId: id, kind: inv.kind, note: inv.note.trim() || undefined }); setInv(null); onNote({ tone: 'ok', text: tx(r?.existing ? 'finance.st.invExisting' : 'finance.st.invRaised') }); }
    catch (e) { setInv({ ...inv, busy: false, err: (e as Error).message || tx('pos.action_failed') }); }
  };
  const [tq, setTq] = useState(''); const tqd = useDebounced(tq.trim(), 300);
  const [tp, setTp] = useState(1);
  useEffect(() => setTp(1), [tqd]);
  const tr = useLoad(() => posSettlementsApi.transactions(id, { search: tqd || undefined, page: tp, pageSize: 6 }), [id, tqd, tp]);
  const txRef = useRef<HTMLDivElement | null>(null);
  const s: SRow | undefined = d.data?.settlement;
  const exportDetail = async () => {
    try { const csv = await posSettlementsApi.exportDetail(id); download(`settlement-${s?.settlementRef ?? id}.csv`, csv, 'text/csv;charset=utf-8'); onNote({ tone: 'ok', text: tx('finance.exported') }); }
    catch (e) { onNote({ tone: 'bad', text: (e as Error).message }); }
  };
  return (
    <FitDialog wide title={s ? tx('finance.st.detailTitle', { ref: s.settlementRef ?? s.id.slice(0, 8) }) : tx('finance.st.detail')} subtitle={s ? `${codeLabel('finance.processorName.' + (s.processor ?? ''), s.processor ?? '—')} · ${whenTime(s.settledAt)}` : undefined} onClose={onClose} testId="settlement-detail"
      footer={<>
        <button type="button" className="fk-btn" onClick={() => txRef.current?.scrollIntoView({ behavior: 'smooth' })}>{tx('finance.st.viewTransactions')}</button>
        <button type="button" className="fk-btn" onClick={() => onRecon(id)}>{tx('finance.st.openRecon')}</button>
        {canInvestigate ? <button type="button" className="fk-btn" onClick={() => setInv({ kind: s && s.bankState !== 'matched' ? 'missing_deposit' : 'amount_mismatch', note: '', busy: false, err: null })} data-testid="investigate">{tx('finance.st.investigate')}</button> : null}
        {canExport ? <button type="button" className="fk-btn" onClick={exportDetail} data-testid="export-detail">{tx('finance.exportDetail')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('finance.st.back')}</button>
      </>}>
      {inv ? <div className="fk-void" data-testid="investigate-form"><span>{tx('finance.st.invTitle')}</span>
        <select className="fk-select" value={inv.kind} onChange={(e) => setInv({ ...inv, kind: e.target.value })} aria-label={tx('finance.st.invKind')} data-testid="inv-kind">
          {['missing_deposit', 'amount_mismatch', 'fee_difference', 'duplicate', 'integration_error'].map((k) => <option key={k} value={k}>{tx('finance.st.invKind.' + k)}</option>)}</select>
        <input className="fk-search wide" value={inv.note} onChange={(e) => setInv({ ...inv, note: e.target.value })} maxLength={500} placeholder={tx('finance.st.invNote')} aria-label={tx('finance.st.invNote')} data-testid="inv-note" />
        <button type="button" className="fk-btn" onClick={() => setInv(null)} disabled={inv.busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" onClick={() => void investigate()} disabled={inv.busy} data-testid="inv-submit">{tx('finance.st.investigate')}</button>
        {inv.err ? <span className="fk-err" role="alert">{inv.err}</span> : null}</div> : null}
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !s ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fn-statusline">
          <span className={'fk-chip ' + (PROVIDER_TONE[s.providerStatus] ?? 'mut')}>{tx('finance.st.providerStatus')}: {codeLabel('finance.provider.' + s.providerStatus, s.providerStatus)}</span>
          <span className={'fk-chip ' + BANK_TONE[s.bankState]}>{tx('finance.st.bankState')}: {codeLabel('finance.bank.' + s.bankState, s.bankState)}</span>
          <span className="fk-hint">{tx('finance.st.bothStatuses')}</span>
        </div>
        <div className="fn-cols2">
          <dl className="fk-dl">
            <dt>{tx('finance.st.f.ref')}</dt><dd><b>{s.settlementRef ?? '—'}</b></dd>
            <dt>{tx('finance.st.f.internalId')}</dt><dd className="fn-mono">{s.id}</dd>
            <dt>{tx('finance.st.f.processor')}</dt><dd>{codeLabel('finance.processorName.' + (s.processor ?? ''), s.processor ?? '—')}{s.fundingAccount ? ` · ${tx('finance.st.f.funding')} ${s.fundingAccount}` : ''}</dd>
            <dt>{tx('finance.st.f.settled')}</dt><dd>{whenTime(s.settledAt)}</dd>
            <dt>{tx('finance.st.f.expectedPayout')}</dt><dd>{s.expectedPayoutDate ? fmtYmdSafe(s.expectedPayoutDate) : tx('finance.notSuppliedByProcessor')}</dd>
            <dt>{tx('finance.st.f.retrieved')}</dt><dd>{whenTime(d.data.provenance.retrievedAt)} · {tx('finance.st.f.viaWebhook')}</dd>
            <dt>{tx('finance.st.f.transactions')}</dt><dd>{fmtNumber(s.transactionCount)} {tx('finance.st.f.reported')} · {fmtNumber(s.linkedPayments)} {tx('finance.st.f.linked')}</dd>
          </dl>
          <table className="fk-table fn-amounts">
            <tbody>
              <tr><td>{tx('finance.st.r.gross')}</td><td className="num">{money(s.grossCents)}</td></tr>
              <tr><td>{tx('finance.st.r.fees')}</td><td className="num">− {money(s.feeCents)}</td></tr>
              <tr><td>{tx('finance.st.f.refundsIn')}</td><td className="num">{s.refundsInBatchCents ? '− ' + money(s.refundsInBatchCents) : tx('finance.noneReported')}</td></tr>
              <tr><td>{tx('finance.st.f.chargebacksIn')}</td><td className="num">{s.chargebacksInBatchCents ? '− ' + money(s.chargebacksInBatchCents) : tx('finance.noneReported')}</td></tr>
              <tr><td>{tx('finance.st.r.adjustments')}</td><td className="num">{s.adjustmentsCents ? money(s.adjustmentsCents) : tx('finance.noneReported')}</td></tr>
              <tr><td>{tx('finance.st.f.reserves')}</td><td className="num fk-muted">{tx('finance.notSuppliedByProcessor')}</td></tr>
              <tr className="strong"><td>{tx('finance.st.r.expected')}</td><td className="num">{money(s.expectedPayoutCents)}</td></tr>
              <tr><td>{tx('finance.st.r.bank')}</td><td className="num">{s.bankConfirmedCents > 0 ? money(s.bankConfirmedCents) : tx('finance.notVerified')}</td></tr>
            </tbody>
          </table>
        </div>
        <h3 className="fk-h3">{tx('finance.st.allocations')}</h3>
        {d.data.allocations.length === 0 ? <div className="fk-hint">{tx('finance.st.noAllocations')}</div> : (
          <table className="fk-table"><thead><tr><th>{tx('finance.st.a.deposit')}</th><th>{tx('finance.st.a.account')}</th><th>{tx('finance.st.a.posted')}</th><th className="num">{tx('finance.st.a.allocated')}</th><th>{tx('finance.st.a.by')}</th><th>{tx('finance.status')}</th></tr></thead>
            <tbody>{d.data.allocations.map((a: any) => <tr key={a.id}><td>{a.deposit.reference ?? a.deposit.id.slice(0, 8)}</td><td>{a.deposit.account ?? '—'}</td><td>{fmtYmdSafe(a.deposit.depositDate)}</td><td className="num">{money(a.amountCents)}</td><td>{a.createdBy ?? '—'} · {when(a.createdAt)}</td><td>{a.active ? <span className="fk-chip ok">{tx('finance.active')}</span> : <span className="fk-chip mut" title={a.unmatchReason ?? ''}>{tx('finance.unmatched')}</span>}</td></tr>)}</tbody></table>
        )}
        <div ref={txRef} className="fn-sub-head"><h3 className="fk-h3">{tx('finance.st.relatedTransactions')}</h3>
          <input className="fk-search" type="search" value={tq} onChange={(e) => setTq(e.target.value)} placeholder={tx('finance.st.txSearchPh')} aria-label={tx('finance.st.txSearchPh')} data-testid="tx-search" /></div>
        {tr.error ? <StateBlock error={tr.error} onRetry={tr.reload} /> : !tr.data ? <div className="fk-loading">{tx('pos.loading')}</div> : tr.data.items.length === 0 ? <div className="fk-hint">{tqd ? tx('finance.noMatches') : tx('finance.st.noLinkedPayments')}</div> : <>
          <table className="fk-table" data-testid="tx-table"><thead><tr><th>{tx('finance.st.t.txn')}</th><th>{tx('finance.st.t.date')}</th><th>{tx('finance.st.t.method')}</th><th>{tx('finance.st.t.ticket')}</th><th>{tx('finance.st.t.customer')}</th><th className="num">{tx('finance.st.t.amount')}</th></tr></thead>
            <tbody>{tr.data.items.map((p: any) => <tr key={p.id}><td>{p.processorTransactionId ?? p.id.slice(0, 8)}</td><td>{whenTime(p.createdAt)}</td><td>{p.card ?? codeLabel('finance.method.' + (p.method ?? ''), p.method ?? '—')}</td><td>{p.ticket?.number ? '#' + p.ticket.number : '—'}</td><td>{p.customer ? `${p.customer.name}${p.customer.phone ? ' · ' + p.customer.phone : ''}` : tx('finance.noLinkedCustomer')}</td><td className="num">{money(p.amountCents)}</td></tr>)}</tbody></table>
          <Pager info={{ page: tr.data.page, pageSize: tr.data.pageSize, totalItems: tr.data.total, totalPages: tr.data.pageCount }} onPage={setTp} compact />
          <div className="fk-hint">{tx('finance.st.batchNotOnePerson')}</div>
        </>}
      </>}
    </FitDialog>
  );
}

function RefundDetail({ row, onClose, onSettlement }: { row: RRow; onClose: () => void; onSettlement: (id: string) => void }) {
  const nav = useNavigate();
  return (
    <FitDialog title={tx('finance.st.refundTitle', { ref: row.refundRef ?? row.id.slice(0, 8) })} subtitle={whenTime(row.createdAt)} onClose={onClose} testId="refund-detail"
      footer={<>{row.saleSettlement ? <button type="button" className="fk-btn" onClick={() => onSettlement(row.saleSettlement!.id)}>{tx('finance.st.openSaleBatch')}</button> : null}
        {row.customer ? <button type="button" className="fk-btn" onClick={() => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(row.customer!.id)}`)}>{tx('finance.openCustomer')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></>}>
      <dl className="fk-dl">
        <dt>{tx('finance.status')}</dt><dd><span className={'fk-chip ' + (REFUND_TONE[row.status] ?? 'mut')}>{codeLabel('finance.refund.' + row.status, row.status)}</span></dd>
        <dt>{tx('finance.st.rcol.amount')}</dt><dd><b>{money(row.amountCents)}</b>{row.status !== 'completed' ? <span className="fk-hint"> · {tx('finance.st.notCountedInTotal')}</span> : null}</dd>
        <dt>{tx('finance.st.rcol.ref')}</dt><dd>{row.refundRef ?? '—'}</dd>
        <dt>{tx('finance.st.rcol.payment')}</dt><dd>{row.payment ? `${row.payment.processorTransactionId ?? row.payment.id.slice(0, 8)} · ${money(row.payment.amountCents)}${row.payment.card ? ' · ' + row.payment.card : ''}` : '—'}</dd>
        <dt>{tx('finance.st.f.refundsOnPayment')}</dt><dd>{row.payment ? fmtNumber(row.payment.refundsOnPayment) : '—'}</dd>
        <dt>{tx('finance.st.rcol.customer')}</dt><dd>{row.customer ? `${row.customer.name}${row.customer.phone ? ' · ' + row.customer.phone : ''}` : tx('finance.noLinkedCustomer')}</dd>
        <dt>{tx('finance.st.rcol.impact')}</dt><dd>{row.saleSettlement ? tx('finance.st.saleBatch', { ref: row.saleSettlement.ref ?? '' }) : tx('finance.st.notInBatch')} — {tx('finance.st.nettingNotReported')}</dd>
        {row.reason ? <><dt>{tx('finance.reason')}</dt><dd>{row.reason}</dd></> : null}
      </dl>
      <div className="fk-hint">{tx('finance.st.refundViewOnly')}</div>
    </FitDialog>
  );
}
