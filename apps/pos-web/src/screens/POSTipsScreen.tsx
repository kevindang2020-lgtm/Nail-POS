// POSTipsScreen.tsx — Payments & Money → Tips & Gratuity (/tenant/payments/tips). Tips mandate (Oct 29 2026): ONE
// full-screen page at 100 % zoom — header (Refresh · Export) · the filter row (search · date presets + Custom Range month
// calendar · date field · technician · method · status) · five equal KPIs from the server over the whole scope (Total Tips ·
// Card Tips · Cash Tips · Average Tip · No-Tip Count) · four views: Overview (Tips by Technician as a labelled horizontal
// chart + the distribution table + recent tip transactions), Tip Transactions, Technician Distribution, Adjustments & Reports.
// The photo's $9.60 / $19.20: the distribution summed the frozen per-line compensation snapshot, which a retried snapshot
// had credited twice; this screen reads ALLOCATED tips (one row per ticket and technician) and FLAGS a ticket whose snapshot
// disagrees with its collected tip instead of showing either number as the truth. Collected, allocated, unallocated,
// reversed and paid out are shown as the distinct things they are. A correction is a reasoned, audited re-allocation on the
// existing tips.adjust route — never an amount edit; a card refund stays on the processor workflow.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createIntentKeys } from '@aipowersalon/api-client';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posTipsScreenApi as api } from '../api/posTipsScreenApi';
import { posPayrollApi } from '../api/posPayrollApi';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, periodText, useLoad, StateBlock, isForbidden, centsFromText, textFromCents, type PeriodState } from '../components/FinanceKit';
import { useStepUp, isStepUpCancelled } from './access/accessUi';

type Tab = 'overview' | 'transactions' | 'distribution' | 'adjustments';
type Tech = { id: string; name: string | null };
type Row = { ticketId: string; ticketNumber: string | null; collectedAt: string | null; checkoutAt: string | null; branch: string | null; customer: { id: string; name: string | null; phone: string | null } | null; technicians: Tech[]; method: string; tenders: number; paymentRefs: string[];
  amountCents: number; cardCents: number; cashCents: number; pretipSalesCents: number; totalCents: number; allocatedCents: number; unallocatedCents: number; allocationState: string; snapshotCents: number | null; snapshotMismatch: boolean;
  reversedCents: number; netCents: number; manualCorrectionCents: number; payout: { state: string; periodId: string | null; periodLabel: string | null; paidAt: string | null }; matchedBy?: string | null };
type Dist = { technicianId: string; name: string | null; active: boolean; tickets: number; allocatedCents: number; cardCents: number; cashCents: number; sharePct: number; paidOutCents: number; pendingCents: number; manualCorrectionCents: number; reversedCents: number; netCents: number; lastAt: string | null };
type Note = { tone: 'ok' | 'bad'; text: string } | null;

const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const ALLOC_TONE: Record<string, string> = { allocated: 'ok', partial: 'warn', unallocated: 'warn', over: 'bad', none: 'mut' };
const PAYOUT_TONE: Record<string, string> = { paid: 'ok', approved: 'info', open: 'warn', none: 'mut' };
const errMsg = (e: unknown) => (e as Error)?.message || tx('finance.state.loadFailed');
const BASES = ['collected', 'checkout', 'allocation', 'adjustment', 'payout'];
const STATUSES = ['tipped', 'no_tip', 'unallocated', 'partial', 'mismatch', 'reversed', 'paid_out', 'pending_payout'];
const SORTS = ['collected_desc', 'collected_asc', 'amount_desc', 'amount_asc', 'ticket_desc'];
const pageInfo = (d: any) => (d ? { page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.pageCount } : null);
const techNames = (r: Row) => (r.technicians.length ? r.technicians.map((t) => t.name ?? '—').join(', ') : tx('tp.noTechnician'));

export function POSTipsScreen() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' }); const [basis, setBasis] = useState('collected');
  const [technicianId, setTech] = useState(''); const [method, setMethod] = useState(''); const [status, setStatus] = useState(''); const [sort, setSort] = useState('collected_desc');
  const [tick, setTick] = useState(0); const [note, setNote] = useState<Note>(null); const [detail, setDetail] = useState<string | null>(null); const [exporting, setExporting] = useState(false);
  const scope = { ...periodQuery(period), dateField: basis, search: q || undefined, technicianId: technicianId || undefined, method: method || undefined, status: status || undefined, sort };
  const sum = useLoad(() => api.summary({ ...periodQuery(period), dateField: basis, technicianId: technicianId || undefined }), [JSON.stringify(period), basis, technicianId, tick]);
  const techs = useLoad(() => api.technicians(), []);
  const k = sum.data?.kpis; const rec = sum.data?.reconciliation;
  const chips = [...(q ? [{ label: tx('tp.chip.search', { q }), clear: () => setSearch('') }] : []), ...(technicianId ? [{ label: (techs.data ?? []).find((t) => t.id === technicianId)?.name ?? tx('pos.technician'), clear: () => setTech('') }] : []),
    ...(method ? [{ label: tx('tp.method.' + method), clear: () => setMethod('') }] : []), ...(status ? [{ label: tx('tp.status.' + status), clear: () => setStatus('') }] : [])];
  const clearAll = () => { setSearch(''); setTech(''); setMethod(''); setStatus(''); setSort('collected_desc'); setPeriod({ preset: 'month' }); setBasis('collected'); };
  const doExport = async () => {
    setExporting(true);
    try { const csv = await api.exportCsv(scope); const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tips.csv'; a.click(); URL.revokeObjectURL(a.href); setNote({ tone: 'ok', text: tx('finance.exported') }); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } finally { setExporting(false); }
  };
  if (isForbidden(sum.error)) return <div className="work fit tp" data-testid="tips-screen"><h1>{tx('pos.tips_gratuity')}</h1><StateBlock error={sum.error} onRetry={sum.reload} /></div>;
  return (
    <div className="work fit tp" data-testid="tips-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.tips_gratuity')}</h1><div className="sub">{tx('tp.subtitle')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={() => setTick((t) => t + 1)} data-testid="refresh">{tx('finance.refresh')}</button>
          {sum.data?.permissions?.export ? <button type="button" className="fk-btn" onClick={doExport} disabled={exporting} data-testid="export">{exporting ? tx('pos.loading') : tx('tp.exportTips')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      <div className="fn-tabsrow tp-toolbar">
        <div className="fn-search tp-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => { setSearch(e.target.value); if (e.target.value && tab === 'overview') setTab('transactions'); }} placeholder={tx('tp.tipsSearchPh')} aria-label={tx('tp.tipsSearchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}</div>
        <select className="fk-select" value={technicianId} onChange={(e) => setTech(e.target.value)} aria-label={tx('pos.technician')} data-testid="technician"><option value="">{tx('tp.allTechnicians')}</option>{(techs.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select className="fk-select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label={tx('tp.methodLabel')} data-testid="method"><option value="">{tx('tp.allMethods')}</option>{['card', 'cash', 'split'].map((m) => <option key={m} value={m}>{tx('tp.method.' + m)}</option>)}</select>
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="status"><option value="">{tx('finance.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{tx('tp.status.' + s)}</option>)}</select>
      </div>
      <div className="fn-tabsrow tp-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={sum.data?.period} allowAll compact basis={basis} basisOptions={BASES.map((b) => ({ value: b, label: tx('tp.basis.' + b) }))} onBasis={setBasis} />
        {chips.length ? <span className="fn-chips" data-testid="chips">{chips.map((c) => <span key={c.label} className="fk-chip mut">{c.label}<button type="button" className="fk-chip-x" aria-label={tx('finance.removeFilter', { f: c.label })} onClick={c.clear}>✕</button></span>)}
          <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button></span> : null}
      </div>
      <div className="fk-kpis five" data-testid="kpis">
        {sum.error ? <StateBlock error={sum.error} onRetry={sum.reload} /> : <>
          <KpiCard testId="kpi-total" tone="gold" label={tx('tp.kpi.total')} loading={!k} value={k ? fmtMoney(k.totalTipsCents) : ''} sub={k ? (k.reversedCents ? tx('tp.kpi.totalSubRev', { n: fmtNumber(k.tippedTickets), r: fmtMoney(-k.reversedCents) }) : tx('tp.kpi.totalSub', { n: fmtNumber(k.tippedTickets) })) : ''} onClick={() => { setStatus('tipped'); setTab('transactions'); }} />
          <KpiCard testId="kpi-card" label={tx('tp.kpi.card')} loading={!k} value={k ? fmtMoney(k.cardTipsCents) : ''} sub={tx('tp.kpi.cardSub')} onClick={() => { setMethod('card'); setTab('transactions'); }} />
          <KpiCard testId="kpi-cash" label={tx('tp.kpi.cash')} loading={!k} value={k ? fmtMoney(k.cashTipsCents) : ''} sub={tx('tp.kpi.cashSub')} onClick={() => { setMethod('cash'); setTab('transactions'); }} />
          <KpiCard testId="kpi-avg" label={tx('tp.kpi.avg')} loading={!k} value={k ? (k.avgTipRatePct == null ? '—' : `${fmtNumber(k.avgTipRatePct, 1)}%`) : ''} sub={k ? (k.avgTipPerTippedTicketCents == null ? tx('tp.kpi.avgSubNone') : tx('tp.kpi.avgSub', { a: fmtMoney(k.avgTipPerTippedTicketCents) })) : ''} />
          <KpiCard testId="kpi-notip" label={tx('tp.kpi.noTip')} loading={!k} value={k ? fmtNumber(k.noTipCount) : ''} sub={k ? tx('tp.kpi.noTipSub', { n: fmtNumber(k.eligibleTickets) }) : ''} onClick={() => { setStatus('no_tip'); setTab('transactions'); }} />
        </>}
      </div>
      <div className="fk-seg fn-tabs tp-tabs" role="tablist" aria-label={tx('tp.views')} data-module-id="tp-views">
        {(['overview', 'transactions', 'distribution', 'adjustments'] as Tab[]).map((v) => <button key={v} type="button" role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)} data-testid={'tab-' + v}>{tx('tp.tab.' + v)}</button>)}
        {rec ? <span className="tp-recon" data-testid="recon-strip">
          <span>{tx('tp.recon.collected')} <b>{fmtMoney(rec.collectedCents)}</b></span><span>{tx('tp.recon.allocated')} <b>{fmtMoney(rec.allocatedCents)}</b></span>
          {rec.unallocatedCents ? <span className="tp-warn">{tx('tp.recon.unallocated')} <b>{fmtMoney(rec.unallocatedCents)}</b></span> : null}
          <span>{tx('tp.recon.paidOut')} <b>{fmtMoney(rec.paidOutCents)}</b></span><span>{tx('tp.recon.pending')} <b>{fmtMoney(rec.pendingPayoutCents)}</b></span>
          {rec.snapshotMismatchTickets ? <button type="button" className="fk-chip bad tp-chipbtn" onClick={() => { setStatus('mismatch'); setTab('transactions'); }} data-testid="mismatch-chip">{tx('tp.recon.mismatch', { n: fmtNumber(rec.snapshotMismatchTickets) })}</button> : null}
        </span> : null}
      </div>
      {tab === 'overview' ? <OverviewTab scope={scope} tick={tick} onTech={(id) => { setTech(id); setTab('transactions'); }} onOpen={setDetail} onViewAll={(t) => setTab(t)} /> : null}
      {tab === 'transactions' ? <TransactionsTab scope={scope} sort={sort} setSort={setSort} tick={tick} onOpen={setDetail} chips={chips.length > 0} clearAll={clearAll} periodLabel={periodText(sum.data?.period)} onAll={() => setPeriod({ preset: 'all' })} /> : null}
      {tab === 'distribution' ? <DistributionTab scope={scope} tick={tick} onTech={(id) => { setTech(id); setTab('transactions'); }} /> : null}
      {tab === 'adjustments' ? <AdjustmentsTab period={period} tick={tick} onOpen={setDetail} onExport={doExport} canExport={!!sum.data?.permissions?.export} rec={rec} /> : null}
      {detail ? <DetailDialog id={detail} onClose={() => setDetail(null)} onChanged={(t) => { setNote({ tone: 'ok', text: t }); setTick((x) => x + 1); }}
        onCustomer={(cid) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(cid)}`)} onTicket={(n) => nav(`/tenant/payments/transactions?search=${encodeURIComponent(n)}`)} onTech={(id) => { setDetail(null); setTech(id); setTab('transactions'); }} /> : null}
    </div>
  );
}

function TechBars({ items, total, onTech }: { items: Dist[]; total: number; onTech: (id: string) => void }) {
  const max = Math.max(1, ...items.map((x) => x.allocatedCents));
  if (!items.length) return <Empty title={tx('tp.noDistribution')}><span className="fk-hint">{tx('tp.noDistributionHint')}</span></Empty>;
  return (
    <div className="tp-bars" role="img" aria-label={tx('tp.barsAlt', { list: items.map((x) => `${x.name ?? '—'} ${fmtMoney(x.allocatedCents)}`).join(', ') })} data-testid="tech-bars">
      {items.map((x) => (
        <button type="button" key={x.technicianId} className="tp-bar" onClick={() => onTech(x.technicianId)} title={`${x.name ?? ''}: ${fmtMoney(x.allocatedCents)} · ${fmtNumber(x.sharePct, 1)}%`}>
          <span className="tp-bar-n">{x.name ?? '—'}</span>
          <span className="tp-bar-t"><span className="tp-bar-f" style={{ width: `${Math.max(2, Math.round((x.allocatedCents / max) * 100))}%` }} /></span>
          <span className="tp-bar-v">{fmtMoney(x.allocatedCents)}<span className="fk-li-s">{fmtNumber(x.sharePct, 1)}% · {tx('tp.ticketsN', { n: fmtNumber(x.tickets) })}</span></span>
        </button>
      ))}
      {items.length === 1 ? <div className="fk-hint">{tx('tp.onePerson', { a: fmtMoney(total) })}</div> : null}
    </div>
  );
}

function OverviewTab({ scope, tick, onTech, onOpen, onViewAll }: { scope: Record<string, unknown>; tick: number; onTech: (id: string) => void; onOpen: (id: string) => void; onViewAll: (t: Tab) => void }) {
  const dist = useLoad(() => api.distribution({ preset: scope.preset, from: scope.from, to: scope.to, dateField: scope.dateField, page: 1, pageSize: 8 }), [scope.preset, scope.from, scope.to, scope.dateField, tick]);
  const recent = useLoad(() => api.transactions({ ...scope, status: scope.status ?? 'tipped', page: 1, pageSize: 6 }), [JSON.stringify(scope), tick]);
  const items: Dist[] = dist.data?.items ?? [];
  return (
    <div className="tp-overview" data-testid="overview">
      <FitPanel testId="by-technician" title={tx('tp.byTechnician')} actions={<button type="button" className="fk-link" onClick={() => onViewAll('distribution')}>{tx('tp.viewAll')}</button>}>
        {dist.error ? <StateBlock error={dist.error} onRetry={dist.reload} /> : !dist.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <TechBars items={items} total={dist.data.totals.allocatedCents} onTech={onTech} />}
      </FitPanel>
      <FitPanel testId="distribution-mini" title={tx('tp.distribution')} actions={<button type="button" className="fk-link" onClick={() => onViewAll('distribution')}>{tx('tp.viewAll')}</button>}>
        {dist.error ? <StateBlock error={dist.error} onRetry={dist.reload} /> : !dist.data ? <div className="fk-loading">{tx('pos.loading')}</div> : items.length === 0 ? <Empty title={tx('tp.noDistribution')} /> :
          <table className="fk-table fn-table" data-testid="distribution-mini-table"><thead><tr><th>{tx('pos.technician')}</th><th className="num">{tx('tp.d.card')}</th><th className="num">{tx('tp.d.cash')}</th><th className="num">{tx('tp.d.allocated')}</th><th>{tx('tp.d.payout')}</th></tr></thead>
            <tbody>{items.map((x) => <tr key={x.technicianId}><td><button type="button" className="fk-link" onClick={() => onTech(x.technicianId)}>{x.name ?? '—'}</button></td><td className="num">{fmtMoney(x.cardCents)}</td><td className="num">{fmtMoney(x.cashCents)}</td><td className="num"><b>{fmtMoney(x.allocatedCents)}</b></td>
              <td>{x.paidOutCents ? <span className="fk-chip ok">{fmtMoney(x.paidOutCents)} {tx('tp.paidOut')}</span> : null} {x.pendingCents ? <span className="fk-chip warn">{fmtMoney(x.pendingCents)} {tx('tp.pending')}</span> : null}</td></tr>)}</tbody>
            <tfoot><tr><td>{tx('finance.total')}</td><td /><td /><td className="num"><b>{fmtMoney(dist.data.totals.allocatedCents)}</b></td><td /></tr></tfoot></table>}
      </FitPanel>
      <FitPanel testId="recent" className="tp-recent" title={tx('tp.recentTitle')} actions={<button type="button" className="fk-link" onClick={() => onViewAll('transactions')}>{tx('tp.viewAll')}</button>}>
        {recent.error ? <StateBlock error={recent.error} onRetry={recent.reload} /> : !recent.data ? <div className="fk-loading">{tx('pos.loading')}</div> : recent.data.items.length === 0 ? <Empty title={tx('tp.noTips')}><span className="fk-hint">{tx('tp.noTipsHint')}</span></Empty> :
          <table className="fk-table fn-table" data-testid="recent-table"><tbody>{(recent.data.items as Row[]).map((r) => <tr key={r.ticketId}><td>{when(r.collectedAt)}</td><td><button type="button" className="fk-link" onClick={() => onOpen(r.ticketId)}>#{r.ticketNumber ?? '—'}</button></td><td>{r.customer?.name ?? tx('sp.walkIn')}</td><td>{techNames(r)}</td><td>{tx('tp.method.' + r.method)}</td><td className="num"><b>{fmtMoney(r.amountCents)}</b></td>
            <td>{r.snapshotMismatch ? <span className="fk-chip bad">{tx('tp.mismatch')}</span> : <span className={'fk-chip ' + (ALLOC_TONE[r.allocationState] ?? 'mut')}>{tx('tp.alloc.' + r.allocationState)}</span>}</td></tr>)}</tbody></table>}
      </FitPanel>
    </div>
  );
}

function TransactionsTab({ scope, sort, setSort, tick, onOpen, chips, clearAll, periodLabel, onAll }: { scope: Record<string, unknown>; sort: string; setSort: (s: string) => void; tick: number; onOpen: (id: string) => void; chips: boolean; clearAll: () => void; periodLabel: string; onAll: () => void }) {
  const [page, setPage] = useState(1); const key = JSON.stringify(scope); useEffect(() => setPage(1), [key]);
  const fit = useFitRows<HTMLDivElement>(44, { min: 3, max: 18, reserve: 34 });
  const d = useLoad(() => api.transactions({ ...scope, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  useEffect(() => { if (d.data && d.data.page !== page) setPage(d.data.page); }, [d.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const rows: Row[] = d.data?.items ?? [];
  return (
    <FitPanel testId="transactions" bodyRef={fit.ref} className="fn-records" title={<span className="fn-chips">{tx('tp.tab.transactions')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}</span>}
      actions={<select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')} data-testid="sort">{SORTS.map((s) => <option key={s} value={s}>{tx('tp.sort.' + s)}</option>)}</select>}
      footer={<Pager info={pageInfo(d.data)} onPage={setPage} label={tx('tp.tab.transactions')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div>
        : rows.length === 0 ? <Empty title={tx('tp.noMatches')}><span className="fk-hint">{tx('tp.noMatchesHint', { p: periodLabel })}</span>{chips ? <button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button> : null}<button type="button" className="fk-btn" onClick={onAll}>{tx('sp.tryAllTime')}</button></Empty>
        : <table className="fk-table fn-table tp-table" data-testid="transactions-table">
          <thead><tr><th>{tx('tp.col.collected')}</th><th>{tx('tp.col.ticket')}</th><th>{tx('tp.col.customer')}</th><th>{tx('tp.col.technicians')}</th><th>{tx('tp.col.method')}</th><th className="num">{tx('tp.col.amount')}</th><th>{tx('tp.col.allocation')}</th><th>{tx('tp.col.payout')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.ticketId} data-testid="tip-row">
            <td>{when(r.collectedAt)}</td>
            <td className="fn-id"><button type="button" className="fk-li-t link" onClick={() => onOpen(r.ticketId)}>#{r.ticketNumber ?? '—'}</button><span className="fk-li-s">{r.paymentRefs[0] ?? (r.tenders > 1 ? tx('tp.splitTender', { n: fmtNumber(r.tenders) }) : '')}{r.matchedBy && scope.search ? ` · ${tx('tp.matched.' + r.matchedBy)}` : ''}</span></td>
            <td>{r.customer?.name ?? <span className="fk-muted">{tx('sp.walkIn')}</span>}{r.customer?.phone ? <span className="fk-li-s">{r.customer.phone}</span> : null}</td>
            <td>{techNames(r)}{r.technicians.length > 1 ? <span className="fk-li-s">{tx('tp.techCount', { n: fmtNumber(r.technicians.length) })}</span> : null}</td>
            <td>{tx('tp.method.' + r.method)}{r.method === 'split' ? <span className="fk-li-s">{fmtMoney(r.cardCents)} / {fmtMoney(r.cashCents)}</span> : null}</td>
            <td className="num"><b>{fmtMoney(r.amountCents)}</b>{r.reversedCents ? <span className="fk-li-s tp-neg">−{fmtMoney(-r.reversedCents)} {tx('tp.reversed')}</span> : null}</td>
            <td>{r.amountCents === 0 ? <span className="fk-chip mut">{tx('tp.alloc.none')}</span> : <span className={'fk-chip ' + (ALLOC_TONE[r.allocationState] ?? 'mut')}>{tx('tp.alloc.' + r.allocationState)}</span>}{r.snapshotMismatch ? <span className="fk-chip bad">{tx('tp.mismatch')}</span> : null}</td>
            <td>{r.amountCents === 0 ? '—' : <span className={'fk-chip ' + (PAYOUT_TONE[r.payout.state] ?? 'mut')}>{tx('tp.payout.' + r.payout.state)}</span>}{r.payout.periodLabel ? <span className="fk-li-s">{r.payout.periodLabel}</span> : null}</td>
            <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => onOpen(r.ticketId)}>{tx('finance.view')}</button></td>
          </tr>)}</tbody>
        </table>}
    </FitPanel>
  );
}

function DistributionTab({ scope, tick, onTech }: { scope: Record<string, unknown>; tick: number; onTech: (id: string) => void }) {
  const [page, setPage] = useState(1); const [sort, setSort] = useState('allocated_desc');
  const q = { preset: scope.preset, from: scope.from, to: scope.to, dateField: scope.dateField, sort }; const key = JSON.stringify(q); useEffect(() => setPage(1), [key]);
  const fit = useFitRows<HTMLDivElement>(44, { min: 3, max: 18, reserve: 34 });
  const d = useLoad(() => api.distribution({ ...q, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  const items: Dist[] = d.data?.items ?? [];
  return (
    <FitPanel testId="distribution" bodyRef={fit.ref} className="fn-records" title={<span className="fn-chips">{tx('tp.tab.distribution')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)} · {fmtMoney(d.data.totals.allocatedCents)}</span> : null}</span>}
      actions={<select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')}>{['allocated_desc', 'allocated_asc', 'name_asc', 'tickets_desc'].map((s) => <option key={s} value={s}>{tx('tp.dsort.' + s)}</option>)}</select>}
      footer={<Pager info={pageInfo(d.data)} onPage={setPage} label={tx('tp.tab.distribution')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : items.length === 0 ? <Empty title={tx('tp.noDistribution')}><span className="fk-hint">{tx('tp.noDistributionHint')}</span></Empty>
        : <table className="fk-table fn-table" data-testid="distribution-table"><thead><tr><th>{tx('pos.technician')}</th><th className="num">{tx('tp.d.card')}</th><th className="num">{tx('tp.d.cash')}</th><th className="num">{tx('tp.d.allocated')}</th><th className="num t-opt">{tx('tp.d.share')}</th><th className="num">{tx('tp.d.corrections')}</th><th className="num">{tx('tp.d.paidOut')}</th><th className="num">{tx('tp.d.pending')}</th><th className="num">{tx('tp.d.tickets')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{items.map((x) => <tr key={x.technicianId} data-testid="dist-row"><td><b>{x.name ?? '—'}</b>{!x.active ? <span className="fk-li-s">{tx('tp.archived')}</span> : null}</td><td className="num">{fmtMoney(x.cardCents)}</td><td className="num">{fmtMoney(x.cashCents)}</td><td className="num"><b>{fmtMoney(x.allocatedCents)}</b></td><td className="num t-opt">{fmtNumber(x.sharePct, 1)}%</td>
            <td className={'num' + (x.manualCorrectionCents + x.reversedCents < 0 ? ' tp-neg' : '')}>{x.manualCorrectionCents + x.reversedCents ? fmtMoney(x.manualCorrectionCents + x.reversedCents) : '—'}</td><td className="num">{fmtMoney(x.paidOutCents)}</td><td className="num">{fmtMoney(x.pendingCents)}</td><td className="num">{fmtNumber(x.tickets)}</td>
            <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => onTech(x.technicianId)}>{tx('tp.viewTips')}</button></td></tr>)}</tbody></table>}
    </FitPanel>
  );
}

function AdjustmentsTab({ period, tick, onOpen, onExport, canExport, rec }: { period: PeriodState; tick: number; onOpen: (id: string) => void; onExport: () => void; canExport: boolean; rec: any }) {
  const [page, setPage] = useState(1); const [kind, setKind] = useState(''); const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const key = JSON.stringify([period, kind, q]); useEffect(() => setPage(1), [key]);
  const fit = useFitRows<HTMLDivElement>(44, { min: 3, max: 18, reserve: 34 });
  const d = useLoad(() => api.adjustments({ ...periodQuery(period), kind: kind || undefined, search: q || undefined, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  return (
    <div className="tp-adjust">
      <FitPanel testId="reports" title={tx('tp.reportsTitle')}>
        <div className="tp-reports">
          {rec ? <dl className="fk-dl"><dt>{tx('tp.recon.collected')}</dt><dd>{fmtMoney(rec.collectedCents)}</dd><dt>{tx('tp.recon.reversed')}</dt><dd>{fmtMoney(rec.reversedCents)}</dd><dt>{tx('tp.recon.allocated')}</dt><dd>{fmtMoney(rec.allocatedCents)}</dd><dt>{tx('tp.recon.unallocated')}</dt><dd>{fmtMoney(rec.unallocatedCents)}</dd>
            <dt>{tx('tp.recon.manual')}</dt><dd>{fmtMoney(rec.manualCorrectionCents)}</dd><dt>{tx('tp.recon.paidOut')}</dt><dd>{fmtMoney(rec.paidOutCents)}</dd><dt>{tx('tp.recon.pending')}</dt><dd>{fmtMoney(rec.pendingPayoutCents)}</dd>
            <dt>{tx('tp.recon.snapshot')}</dt><dd>{fmtMoney(rec.snapshotCents)}{rec.snapshotMismatchTickets ? <span className="fk-chip bad"> {tx('tp.recon.mismatch', { n: fmtNumber(rec.snapshotMismatchTickets) })}</span> : <span className="fk-chip ok"> {tx('tp.recon.ok')}</span>}</dd></dl> : null}
          <div className="fk-hint">{tx('tp.reconRule')}</div>
          {canExport ? <button type="button" className="fk-btn" onClick={onExport} data-testid="export-report">{tx('tp.exportMatching')}</button> : null}
        </div>
      </FitPanel>
      <FitPanel testId="adjustments" bodyRef={fit.ref} className="fn-records" title={<span className="fn-chips">{tx('tp.adjustmentsTitle')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}</span>}
        actions={<><input className="fk-search sm" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('tp.adjSearchPh')} aria-label={tx('tp.adjSearchPh')} />
          <select className="fk-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={tx('tp.kindLabel')}><option value="">{tx('tp.kind.all')}</option><option value="correction">{tx('tp.kind.correction')}</option><option value="reversal">{tx('tp.kind.reversal')}</option></select></>}
        footer={<Pager info={pageInfo(d.data)} onPage={setPage} label={tx('tp.adjustmentsTitle')} />}>
        {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : d.data.items.length === 0 ? <Empty title={tx('tp.noAdjustments')}><span className="fk-hint">{tx('tp.noAdjustmentsHint')}</span></Empty>
          : <table className="fk-table fn-table" data-testid="adjustments-table"><thead><tr><th>{tx('tp.a.date')}</th><th>{tx('tp.col.ticket')}</th><th>{tx('pos.technician')}</th><th>{tx('tp.a.kind')}</th><th className="num">{tx('tp.col.amount')}</th><th>{tx('tp.a.reason')}</th><th>{tx('finance.status')}</th><th>{tx('tp.a.by')}</th></tr></thead>
            <tbody>{d.data.items.map((j: any) => <tr key={j.id}><td>{when(j.at)}</td><td>{j.ticketId ? <button type="button" className="fk-link" onClick={() => onOpen(j.ticketId)}>#{j.ticketNumber ?? '—'}</button> : '—'}</td><td>{j.technician ?? '—'}</td><td>{tx('tp.kind.' + j.kind)}{j.kind === 'reversal' ? <span className="fk-li-s">{codeLabel('tp.source.' + j.source, j.source)}</span> : null}</td>
              <td className={'num' + (j.amountCents < 0 ? ' tp-neg' : '')}>{j.amountCents > 0 ? '+' : ''}{fmtMoney(j.amountCents)}</td><td className="fn-wrap">{j.reason ?? '—'}</td><td><span className={'fk-chip ' + (['posted', 'approved', 'applied'].includes(j.status) ? 'ok' : j.status === 'rejected' ? 'bad' : 'warn')}>{codeLabel('tp.astatus.' + j.status, j.status)}</span></td><td>{j.actor ?? '—'}</td></tr>)}</tbody></table>}
      </FitPanel>
    </div>
  );
}

/** One tip event. The correction is a re-allocation with a reason on the existing tips.adjust route (step-up): Σ must equal
 *  the collected tip; a paid ticket's change becomes posted correction entries, the frozen snapshot is never rewritten. */
function DetailDialog({ id, onClose, onChanged, onCustomer, onTicket, onTech }: { id: string; onClose: () => void; onChanged: (t: string) => void; onCustomer: (id: string) => void; onTicket: (n: string) => void; onTech: (id: string) => void }) {
  const d = useLoad(() => api.detail(id), [id]);
  const stepUp = useStepUp(tx('tp.stepup'));
  const [editing, setEditing] = useState(false); const [amounts, setAmounts] = useState<Record<string, string>>({}); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [eligible, setEligible] = useState<{ technicianId: string; name: string | null }[]>([]);
  // D15/D19 gaps (Nov 5 2026): free-form adjustment — add or remove an amount for one technician, with a reason
  const [free, setFree] = useState(false); const [fTech, setFTech] = useState(''); const [fDir, setFDir] = useState<'add' | 'remove'>('add'); const [fAmt, setFAmt] = useState(''); const [fReason, setFReason] = useState('');
  const freeKeys = useRef(createIntentKeys());
  const t: Row | undefined = d.data?.tip; const allocs: any[] = d.data?.allocations ?? [];
  const startFree = async () => {
    setErr(null);
    try { const cur = await posPayrollApi.ticketTip(id); setEligible(cur.allocations); setFTech(cur.allocations[0]?.technicianId ?? ''); setFree(true); setEditing(false); }
    catch (e) { setErr(errMsg(e)); }
  };
  const fCents = centsFromText(fAmt) ?? 0;
  const saveFree = async () => {
    if (!t || !fTech || fCents <= 0) return; setBusy(true); setErr(null);
    const body = { technicianId: fTech, amountCents: fDir === 'remove' ? -fCents : fCents, reason: fReason.trim() };
    try {
      await stepUp.run(() => posPayrollApi.adjustTicketTip(id, body, freeKeys.current.keyFor('adjust', { id, ...body })));
      freeKeys.current.done('adjust');
      setFree(false); setFAmt(''); setFReason(''); d.reload(); onChanged(tx('tp.adjusted', { n: t.ticketNumber ?? '' }));
    } catch (e) { if (!isStepUpCancelled(e)) setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const sum = useMemo(() => Object.values(amounts).reduce((a, v) => a + (centsFromText(v) ?? 0), 0), [amounts]);
  const startEdit = async () => {
    setErr(null);
    try { const cur = await posPayrollApi.ticketTip(id); setEligible(cur.allocations); setAmounts(Object.fromEntries(cur.allocations.map((a) => [a.technicianId, textFromCents(a.tipCents)]))); setEditing(true); }
    catch (e) { setErr(errMsg(e)); }
  };
  const save = async () => {
    if (!t) return; setBusy(true); setErr(null);
    try {
      const allocations = eligible.map((e) => ({ technicianId: e.technicianId, tipCents: centsFromText(amounts[e.technicianId] ?? '') ?? 0 }));
      await stepUp.run(() => posPayrollApi.setTicketTip(id, { allocations, reason: reason.trim() }));
      setEditing(false); setReason(''); d.reload(); onChanged(tx('tp.adjusted', { n: t.ticketNumber ?? '' }));
    } catch (e) { if (!isStepUpCancelled(e)) setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <FitDialog wide title={t ? tx('tp.detailTitle', { n: t.ticketNumber ?? '—' }) : tx('tp.detailTitleBare')} subtitle={t ? `${when(t.collectedAt)} · ${t.customer?.name ?? tx('sp.walkIn')}${t.branch ? ' · ' + t.branch : ''}` : undefined} onClose={onClose} busy={busy} testId="tip-detail"
      footer={t ? <>
        {d.data.permissions.adjust && t.amountCents > 0 && !editing ? <button type="button" className="fk-btn" onClick={startEdit} data-testid="adjust">{tx('tp.adjust')}</button> : null}
        {d.data.permissions.adjust && !editing && !free ? <button type="button" className="fk-btn" onClick={startFree} data-testid="free-adjust">{tx('tp.freeAdjust')}</button> : null}
        {t.ticketNumber ? <button type="button" className="fk-btn" onClick={() => onTicket(t.ticketNumber!)}>{tx('sp.openTransactions')}</button> : null}
        {t.customer?.id && d.data.permissions.customer ? <button type="button" className="fk-btn" onClick={() => onCustomer(t.customer!.id)}>{tx('finance.openCustomer')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !t ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="gc-balance"><span className="fk-li-s">{tx('tp.col.amount')}</span><b>{fmtMoney(t.amountCents)}</b><span className="fk-chip mut">{tx('tp.method.' + t.method)}</span>
          <span className={'fk-chip ' + (ALLOC_TONE[t.allocationState] ?? 'mut')}>{tx('tp.alloc.' + t.allocationState)}</span><span className={'fk-chip ' + (PAYOUT_TONE[t.payout.state] ?? 'mut')}>{tx('tp.payout.' + t.payout.state)}</span>
          {t.snapshotMismatch ? <span className="fk-chip bad" data-testid="mismatch-flag">{tx('tp.mismatchLong', { s: fmtMoney(t.snapshotCents ?? 0), c: fmtMoney(t.amountCents) })}</span> : null}</div>
        <div className="fn-cols2">
          <dl className="fk-dl">
            <dt>{tx('tp.f.tipEvent')}</dt><dd className="fn-mono">{t.ticketId}</dd>
            <dt>{tx('tp.f.payments')}</dt><dd>{d.data.payments.map((p: any) => `${tx('tp.method.' + (p.method === 'cash' ? 'cash' : p.method === 'gift_card' ? 'gift' : 'card'))} ${fmtMoney(p.amountCents)}${p.tipCents ? ` (${tx('tp.f.tipPart', { a: fmtMoney(p.tipCents) })})` : ''}${p.processorRef ? ' · ' + p.processorRef : ''}`).join(' · ') || '—'}</dd>
            <dt>{tx('tp.f.cardCash')}</dt><dd>{fmtMoney(t.cardCents)} / {fmtMoney(t.cashCents)}</dd>
            <dt>{tx('tp.f.pretip')}</dt><dd>{fmtMoney(t.pretipSalesCents)} · {t.pretipSalesCents ? `${fmtNumber((t.amountCents / t.pretipSalesCents) * 100, 1)}%` : '—'}</dd>
            <dt>{tx('tp.f.collected')}</dt><dd>{when(t.collectedAt)}</dd>
            <dt>{tx('tp.f.checkout')}</dt><dd>{when(t.checkoutAt)}</dd>
          </dl>
          <dl className="fk-dl">
            <dt>{tx('tp.f.splitRule')}</dt><dd>{tx('tp.rule.' + d.data.splitRule)}</dd>
            <dt>{tx('tp.recon.unallocated')}</dt><dd>{fmtMoney(d.data.unallocatedCents)}</dd>
            <dt>{tx('tp.f.reversed')}</dt><dd>{t.reversedCents ? fmtMoney(t.reversedCents) : '—'}</dd>
            <dt>{tx('tp.f.payout')}</dt><dd>{tx('tp.payout.' + t.payout.state)}{t.payout.periodLabel ? ` · ${t.payout.periodLabel}` : ''}{t.payout.paidAt ? ` · ${when(t.payout.paidAt)}` : ''}</dd>
          </dl>
        </div>
        <h3 className="fk-h3">{tx('tp.allocTitle')}</h3>
        <table className="fk-table" data-testid="alloc-table"><thead><tr><th>{tx('pos.technician')}</th><th className="num">{tx('tp.d.allocated')}</th><th className="num">{tx('tp.d.snapshot')}</th><th className="num">{tx('tp.d.corrections')}</th><th className="num">{tx('tp.d.net')}</th></tr></thead>
          <tbody>{allocs.map((a) => <tr key={a.technicianId}><td><button type="button" className="fk-link" onClick={() => onTech(a.technicianId)}>{a.name ?? '—'}</button></td><td className="num"><b>{fmtMoney(a.allocatedCents)}</b></td>
            <td className="num">{a.snapshotCents == null ? '—' : fmtMoney(a.snapshotCents)}{a.snapshotMismatch ? <span className="fk-chip bad"> {tx('tp.mismatch')}</span> : null}</td>
            <td className={'num' + (a.manualCorrectionCents + a.reversedCents < 0 ? ' tp-neg' : '')}>{a.manualCorrectionCents + a.reversedCents ? fmtMoney(a.manualCorrectionCents + a.reversedCents) : '—'}</td><td className="num">{fmtMoney(a.netCents)}</td></tr>)}
            {allocs.length === 0 ? <tr><td colSpan={5} className="fk-muted">{tx('tp.noAllocations')}</td></tr> : null}</tbody></table>
        {editing ? <div className="fk-void tp-edit" data-testid="adjust-form">
          <div className="tp-edit-rows">{eligible.map((e) => <label key={e.technicianId} className="fk-field"><span>{e.name ?? e.technicianId}</span><input inputMode="decimal" value={amounts[e.technicianId] ?? ''} onChange={(ev) => setAmounts({ ...amounts, [e.technicianId]: ev.target.value })} data-testid={'alloc-' + e.technicianId} /></label>)}</div>
          <div className={'fk-hint' + (sum !== t.amountCents ? ' tp-warn' : '')}>{tx('tp.sumCheck', { s: fmtMoney(sum), t: fmtMoney(t.amountCents) })}</div>
          <label className="fk-field"><span>{tx('tp.reason')} *</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="adjust-reason" /></label>
          <button type="button" className="fk-btn" onClick={() => setEditing(false)} disabled={busy}>{tx('pos.cancel')}</button>
          <button type="button" className="fk-btn primary" onClick={save} disabled={busy || sum !== t.amountCents || reason.trim().length < 3} data-testid="adjust-save">{busy ? tx('pos.saving') : tx('tp.saveAdjustment')}</button>
          <div className="fk-hint">{tx('tp.adjustNote')}</div>
        </div> : null}
        {free ? <div className="fk-void tp-edit" data-testid="free-adjust-form">
          <div className="tp-edit-rows">
            <label className="fk-field"><span>{tx('pos.technician')}</span><select className="fk-select" value={fTech} onChange={(e) => setFTech(e.target.value)} data-testid="free-tech">{eligible.map((e) => <option key={e.technicianId} value={e.technicianId}>{e.name ?? e.technicianId}</option>)}</select></label>
            <label className="fk-field"><span>{tx('tp.freeDir')}</span><select className="fk-select" value={fDir} onChange={(e) => setFDir(e.target.value as 'add' | 'remove')} data-testid="free-dir"><option value="add">{tx('tp.freeAdd')}</option><option value="remove">{tx('tp.freeRemove')}</option></select></label>
            <label className="fk-field"><span>{tx('tp.col.amount')}</span><input inputMode="decimal" value={fAmt} onChange={(e) => setFAmt(e.target.value)} placeholder="0.00" data-testid="free-amount" /></label>
          </div>
          <label className="fk-field"><span>{tx('tp.reason')} *</span><input value={fReason} onChange={(e) => setFReason(e.target.value)} maxLength={500} data-testid="free-reason" /></label>
          <div className="fk-hint">{tx('tp.freeConfirm', { a: (fDir === 'remove' ? '−' : '+') + fmtMoney(fCents), n: eligible.find((e) => e.technicianId === fTech)?.name ?? '—' })}</div>
          <button type="button" className="fk-btn" onClick={() => setFree(false)} disabled={busy}>{tx('pos.cancel')}</button>
          <button type="button" className="fk-btn primary" onClick={saveFree} disabled={busy || !fTech || fCents <= 0 || fReason.trim().length < 3} data-testid="free-save">{busy ? tx('pos.saving') : tx('tp.saveAdjustment')}</button>
          <div className="fk-hint">{tx('tp.freeNote')}</div>
        </div> : null}
        {err ? <div className="fk-err" role="alert">{err}</div> : null}
        {d.data.adjustments.length ? <><h3 className="fk-h3">{tx('tp.adjustmentsTitle')}</h3><ul className="fn-notes">{d.data.adjustments.map((j: any) => <li key={j.id}><span className="fk-li-s">{when(j.at)} · {j.actor ?? '—'} · {tx('tp.kind.' + j.kind)} · {codeLabel('tp.astatus.' + j.status, j.status)}</span><div>{j.technician ?? '—'} {j.amountCents > 0 ? '+' : ''}{fmtMoney(j.amountCents)}{j.reason ? ` — ${j.reason}` : ''}</div></li>)}</ul></> : null}
        {d.data.audit.length ? <><h3 className="fk-h3">{tx('sp.auditTitle')}</h3><ul className="fn-notes">{d.data.audit.slice(0, 8).map((a: any, i: number) => <li key={i}><span className="fk-li-s">{when(a.at)} · {a.actor ?? '—'}</span><div>{codeLabel('tp.audit.' + a.action, a.action)}</div></li>)}</ul></> : null}
      </>}
      {stepUp.prompt}
    </FitDialog>
  );
}
