// POSSplitPaymentsScreen.tsx — Payments & Money → Split Payments (/tenant/payments/split-payments). Split Payments mandate
// (Oct 29 2026): ONE full-screen page at 100 % zoom — header (Refresh · Export) · five KPIs from the server over the whole
// scope (Split Tickets · Split Total · Avg Tenders · Completed · Outstanding) · one universal search + status / method
// combination / register / sort · the period bar with its date field · a server-paged table, ONE ROW PER TICKET, newest
// first, each row opening its PAYMENT BREAKDOWN in place (Total ticket · Cash · Card · Gift Card · Remaining balance — the
// owner's ask: a split understood without opening another page) and a detail overlay with every tender attempt.
// What was wrong: the page grouped the newest 2,000 payment rows in the browser, showed a verified-looking 0 when the read
// failed, and had no search, dates, paging or breakdown. A declined attempt is never a tender; a ticket is counted once.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posSplitPaymentsApi } from '../api/posSplitPaymentsApi';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, periodText, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';

type Line = { method: string; cents: number };
type Breakdown = { totalCents: number; lines: Line[]; paidCents: number; refundedCents: number; balanceCents: number };
type Row = { ticketId: string; ticketNumber: string | null; createdAt: string | null; completedAt: string | null; lastTenderAt: string | null; branch: string | null; register: string | null; technician: string | null;
  customer: { id: string; name: string | null; phone: string | null } | null; methods: string[]; tenders: number; attempts: number; failedAttempts: number; pendingAttempts: number; qualifies: boolean;
  totalCents: number; paidCents: number; refundedCents: number; balanceCents: number; tipCents: number; status: string; breakdown: Breakdown; paymentRefs: string[]; matchedBy?: string | null };
type Note = { tone: 'ok' | 'bad'; text: string } | null;

const STATUS_TONE: Record<string, string> = { completed: 'ok', partially_paid: 'warn', pending: 'warn', failed: 'bad', partially_refunded: 'mut', refunded: 'mut', void: 'bad' };
const TENDER_TONE: Record<string, string> = { confirmed: 'ok', pending: 'warn', failed: 'bad', reversal: 'mut' };
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const day = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const statusLbl = (s: string) => codeLabel('sp.status.' + s, s);
const methodLbl = (m: string) => codeLabel('sp.method.' + m, m);
const errMsg = (e: unknown) => (e as Error)?.message || tx('finance.state.loadFailed');
const SORTS = ['created_desc', 'created_asc', 'completed_desc', 'total_desc', 'total_asc', 'tenders_desc', 'due_desc'];
const COMBOS = ['card_cash', 'gift_card', 'cash_gift', 'card_card', 'three_plus', 'any_gift', 'any_cash'];
const STATUSES = ['completed', 'partially_paid', 'pending', 'failed', 'partially_refunded', 'refunded', 'void'];
const BASES = ['completed', 'created', 'tender', 'refund', 'activity'];

/** The owner's breakdown, one block: Total ticket · each method's confirmed amount · Remaining balance (refunds shown when any). */
export function SplitBreakdown({ b, compact, testId }: { b: Breakdown; compact?: boolean; testId?: string }) {
  return (
    <dl className={'sp-breakdown' + (compact ? ' compact' : '')} data-testid={testId ?? 'breakdown'}>
      <div className="sp-bd-row total"><dt>{tx('sp.bd.total')}</dt><dd>{fmtMoney(b.totalCents)}</dd></div>
      {b.lines.map((l) => <div className="sp-bd-row" key={l.method}><dt>{methodLbl(l.method)}</dt><dd>{fmtMoney(l.cents)}</dd></div>)}
      {b.lines.length === 0 ? <div className="sp-bd-row"><dt className="fk-muted">{tx('sp.bd.noConfirmed')}</dt><dd>{fmtMoney(0)}</dd></div> : null}
      {b.refundedCents > 0 ? <div className="sp-bd-row neg"><dt>{tx('sp.bd.refunded')}</dt><dd>−{fmtMoney(b.refundedCents)}</dd></div> : null}
      <div className={'sp-bd-row balance' + (b.balanceCents > 0 ? ' due' : '')}><dt>{tx('sp.bd.balance')}</dt><dd>{fmtMoney(b.balanceCents)}</dd></div>
    </dl>
  );
}

export function POSSplitPaymentsScreen() {
  const nav = useNavigate();
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [status, setStatus] = useState(''); const [combo, setCombo] = useState(''); const [register, setRegister] = useState(''); const [sort, setSort] = useState('created_desc');
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' }); const [basis, setBasis] = useState('completed');
  const [page, setPage] = useState(1); const [tick, setTick] = useState(0); const [open, setOpen] = useState<string | null>(null); const [detail, setDetail] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null); const [exporting, setExporting] = useState(false);
  const scope = { ...periodQuery(period), dateField: basis, search: q || undefined, status: status || undefined, methods: combo || undefined, register: register || undefined, sort };
  const key = JSON.stringify(scope); useEffect(() => { setPage(1); setOpen(null); }, [key]);
  const fit = useFitRows<HTMLDivElement>(44, { min: 3, max: 18, reserve: 34 });
  const list = useLoad(() => posSplitPaymentsApi.list({ ...scope, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  const sum = useLoad(() => posSplitPaymentsApi.summary({ ...periodQuery(period), dateField: basis, register: register || undefined }), [JSON.stringify(period), basis, register, tick]);
  const regs = useLoad(() => posSplitPaymentsApi.registers(), []);
  useEffect(() => { if (list.data && list.data.page !== page) setPage(list.data.page); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const k = sum.data?.kpis; const rows: Row[] = list.data?.items ?? [];
  const chips = [...(q ? [{ label: tx('sp.chip.search', { q }), clear: () => setSearch('') }] : []), ...(status ? [{ label: statusLbl(status), clear: () => setStatus('') }] : []), ...(combo ? [{ label: tx('sp.combo.' + combo), clear: () => setCombo('') }] : []),
    ...(register ? [{ label: (regs.data ?? []).find((r) => r.id === register)?.name ?? tx('sp.register'), clear: () => setRegister('') }] : [])];
  const clearAll = () => { setSearch(''); setStatus(''); setCombo(''); setRegister(''); setSort('created_desc'); setPeriod({ preset: 'month' }); setBasis('completed'); };
  const doExport = async () => {
    setExporting(true);
    try { const csv = await posSplitPaymentsApi.exportCsv(scope); const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'split-payments.csv'; a.click(); URL.revokeObjectURL(a.href); setNote({ tone: 'ok', text: tx('finance.exported') }); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } finally { setExporting(false); }
  };
  if (isForbidden(list.error) || isForbidden(sum.error)) return <div className="work fit sp" data-testid="split-screen"><h1>{tx('pos.split_payments')}</h1><StateBlock error={list.error ?? sum.error} onRetry={list.reload} /></div>;
  return (
    <div className="work fit sp" data-testid="split-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.split_payments')}</h1><div className="sub">{tx('sp.subtitle')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={() => setTick((t) => t + 1)} data-testid="refresh">{tx('finance.refresh')}</button>
          {sum.data?.permissions?.export ? <button type="button" className="fk-btn" onClick={doExport} disabled={exporting} data-testid="export">{exporting ? tx('pos.loading') : tx('finance.exportCsv')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      {/* pending payment banner: card attempts still waiting for a result are NOT counted as paid — verify, never re-charge */}
      {k && k.pendingAttemptTickets > 0 ? <div className="fk-note warn" role="status" data-testid="pending-banner">{tx('sp.pendingBanner', { n: fmtNumber(k.pendingAttemptTickets) })}</div> : null}
      <div className="fk-kpis five" data-testid="kpis">
        {sum.error ? <StateBlock error={sum.error} onRetry={sum.reload} /> : <>
          <KpiCard testId="kpi-tickets" tone="gold" label={tx('sp.kpi.tickets')} loading={!k} value={k ? fmtNumber(k.splitTickets) : ''} sub={k ? tx('sp.kpi.ticketsSub', { n: fmtNumber(k.listedTickets - k.splitTickets) }) : ''} onClick={() => setStatus('')} />
          <KpiCard testId="kpi-total" label={tx('sp.kpi.total')} loading={!k} value={k ? fmtMoney(k.splitTotalCents) : ''} sub={k ? tx('sp.kpi.totalSub', { t: fmtMoney(k.tipsCents) }) : ''} />
          <KpiCard testId="kpi-avg" label={tx('sp.kpi.avg')} loading={!k} value={k ? fmtNumber(k.avgTenders, 1) : ''} sub={tx('sp.kpi.avgSub')} />
          <KpiCard testId="kpi-completed" label={tx('sp.kpi.completed')} loading={!k} value={k ? fmtNumber(k.completedTickets) : ''} sub={k ? tx('sp.kpi.completedSub', { r: fmtNumber(k.refundedTickets) }) : ''} onClick={() => setStatus('completed')} />
          <KpiCard testId="kpi-outstanding" tone={k && k.outstandingCents > 0 ? 'warn' : undefined} label={tx('sp.kpi.outstanding')} loading={!k} value={k ? fmtMoney(k.outstandingCents) : ''} sub={k ? tx('sp.kpi.outstandingSub', { n: fmtNumber(k.outstandingTickets) }) : ''} onClick={() => setStatus('partially_paid')} />
        </>}
      </div>
      <div className="fn-tabsrow sp-toolbar">
        <div className="fn-search sp-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('sp.searchPh')} aria-label={tx('sp.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}</div>
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="status"><option value="">{tx('finance.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{statusLbl(s)}</option>)}</select>
        <select className="fk-select" value={combo} onChange={(e) => setCombo(e.target.value)} aria-label={tx('sp.methods')} data-testid="methods"><option value="">{tx('sp.allMethods')}</option>{COMBOS.map((c) => <option key={c} value={c}>{tx('sp.combo.' + c)}</option>)}</select>
        <select className="fk-select" value={register} onChange={(e) => setRegister(e.target.value)} aria-label={tx('sp.register')} data-testid="register"><option value="">{tx('sp.allRegisters')}</option>{(regs.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')} data-testid="sort">{SORTS.map((s) => <option key={s} value={s}>{tx('sp.sort.' + s)}</option>)}</select>
      </div>
      <div className="fn-tabsrow sp-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={list.data?.period} allowAll compact basis={basis} basisOptions={BASES.map((b) => ({ value: b, label: tx('sp.basis.' + b) }))} onBasis={setBasis} />
        {chips.length ? <span className="fn-chips" data-testid="chips">{chips.map((c) => <span key={c.label} className="fk-chip mut">{c.label}<button type="button" className="fk-chip-x" aria-label={tx('finance.removeFilter', { f: c.label })} onClick={c.clear}>✕</button></span>)}
          <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button></span> : null}
      </div>
      <FitPanel testId="tickets" bodyRef={fit.ref} className="fn-records" title={<span className="fn-chips">{tx('sp.tableTitle')}{list.data ? <span className="fk-muted"> · {fmtNumber(list.data.total)}</span> : null}<span className="fk-hint sp-datenote">{tx('sp.dateShown.' + basis)}</span></span>}
        footer={<Pager info={list.data ? { page: list.data.page, pageSize: list.data.pageSize, totalItems: list.data.total, totalPages: list.data.pageCount } : null} onPage={setPage} label={tx('sp.tableTitle')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : rows.length === 0 ? (chips.length || period.preset !== 'all' ? <Empty title={tx('sp.noMatches')}><span className="fk-hint">{tx('sp.noMatchesHint', { p: periodText(list.data.period) })}</span>
                <button type="button" className="fk-btn" onClick={() => setPeriod({ preset: 'all' })}>{tx('sp.tryAllTime')}</button>{chips.length ? <button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button> : null}</Empty>
              : <Empty title={tx('sp.empty')}><span className="fk-hint">{tx('sp.emptyHint')}</span><button type="button" className="fk-btn" onClick={() => nav('/checkout')}>{tx('pos.checkout')}</button></Empty>)
          : <table className="fk-table fn-table sp-table" data-testid="tickets-table">
            <thead><tr><th /><th>{tx('sp.col.ticket')}</th><th>{tx('sp.col.customer')}</th><th>{tx('sp.col.date')}</th><th>{tx('sp.col.methods')}</th><th className="num">{tx('sp.col.tenders')}</th><th className="num">{tx('sp.col.total')}</th><th className="num t-opt">{tx('sp.col.paid')}</th><th className="num">{tx('sp.col.due')}</th><th>{tx('finance.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{rows.map((r) => {
              const isOpen = open === r.ticketId; const dateCol = basis === 'created' ? r.createdAt : basis === 'tender' ? r.lastTenderAt : (r.completedAt ?? r.createdAt);
              return [
                <tr key={r.ticketId} className={isOpen ? 'sp-open' : ''} data-testid="ticket-row" aria-expanded={isOpen}>
                  <td className="sp-tog"><button type="button" className="fk-btn ghost sm" aria-label={tx(isOpen ? 'sp.hideBreakdown' : 'sp.showBreakdown')} onClick={() => setOpen(isOpen ? null : r.ticketId)} data-testid="toggle-breakdown">{isOpen ? '▾' : '▸'}</button></td>
                  <td className="fn-id"><button type="button" className="fk-li-t link" onClick={() => setDetail(r.ticketId)}>{r.ticketNumber ? '#' + r.ticketNumber : tx('sp.noNumber')}</button><span className="fk-li-s">{r.register ?? r.branch ?? ''}{r.matchedBy && q ? ` · ${tx('sp.matched.' + r.matchedBy)}` : ''}</span></td>
                  <td>{r.customer?.name ?? <span className="fk-muted">{tx('sp.walkIn')}</span>}{r.customer?.phone ? <span className="fk-li-s">{r.customer.phone}</span> : null}</td>
                  <td>{when(dateCol)}</td>
                  <td>{r.methods.length ? r.methods.map(methodLbl).join(' + ') : <span className="fk-muted">—</span>}{r.failedAttempts ? <span className="fk-li-s sp-failed">{tx('sp.failedAttempts', { n: fmtNumber(r.failedAttempts) })}</span> : null}</td>
                  <td className="num">{fmtNumber(r.tenders)}</td>
                  <td className="num"><b>{fmtMoney(r.totalCents)}</b></td>
                  <td className="num t-opt">{fmtMoney(r.paidCents)}{r.refundedCents ? <span className="fk-li-s">−{fmtMoney(r.refundedCents)}</span> : null}</td>
                  <td className={'num' + (r.balanceCents > 0 ? ' sp-due' : '')}>{fmtMoney(r.balanceCents)}</td>
                  <td><span className={'fk-chip ' + (STATUS_TONE[r.status] ?? 'mut')}>{statusLbl(r.status)}</span></td>
                  <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => setDetail(r.ticketId)}>{tx('finance.view')}</button></td>
                </tr>,
                isOpen ? <tr key={r.ticketId + ':bd'} className="sp-bdrow" data-testid="breakdown-row"><td /><td colSpan={10}><div className="sp-bdwrap"><SplitBreakdown b={r.breakdown} compact />
                  <div className="sp-bdside"><span className="fk-li-s">{tx('sp.bd.tenders', { n: fmtNumber(r.tenders), a: fmtNumber(r.attempts) })}</span>{r.tipCents ? <span className="fk-li-s">{tx('sp.bd.tip', { t: fmtMoney(r.tipCents) })}</span> : null}
                    <button type="button" className="fk-btn sm" onClick={() => setDetail(r.ticketId)}>{tx('sp.viewTenders')}</button></div></div></td></tr> : null,
              ];
            })}</tbody>
          </table>}
      </FitPanel>
      {detail ? <DetailDialog id={detail} onClose={() => setDetail(null)} onCustomer={(cid) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(cid)}`)} onTransactions={(n) => nav(`/tenant/payments/transactions?search=${encodeURIComponent(n)}`)} onCheckout={(tid) => nav(`/checkout?ticket=${encodeURIComponent(tid)}`)} /> : null}
    </div>
  );
}

function DetailDialog({ id, onClose, onCustomer, onTransactions, onCheckout }: { id: string; onClose: () => void; onCustomer: (id: string) => void; onTransactions: (n: string) => void; onCheckout: (tid: string) => void }) {
  const d = useLoad(() => posSplitPaymentsApi.detail(id), [id]);
  const t: Row | undefined = d.data?.ticket; const f = d.data?.financials;
  return (
    <FitDialog wide title={t ? (t.ticketNumber ? `${tx('sp.col.ticket')} #${t.ticketNumber}` : tx('sp.noNumber')) : tx('sp.col.ticket')} subtitle={t ? `${t.customer?.name ?? tx('sp.walkIn')} · ${day(t.createdAt)}${t.register ? ' · ' + t.register : ''}` : undefined} onClose={onClose} testId="detail-dialog"
      footer={t ? <>
        {t.balanceCents > 0 && t.status === 'partially_paid' ? <button type="button" className="fk-btn primary" onClick={() => onCheckout(t.ticketId)} data-testid="open-checkout">{tx('sp.finishAtCheckout')}</button> : null}
        {t.ticketNumber ? <button type="button" className="fk-btn" onClick={() => onTransactions(t.ticketNumber!)}>{tx('sp.openTransactions')}</button> : null}
        {t.customer?.id ? <button type="button" className="fk-btn" onClick={() => onCustomer(t.customer!.id)}>{tx('finance.openCustomer')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !t || !f ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fn-statusline"><span className={'fk-chip ' + (STATUS_TONE[t.status] ?? 'mut')}>{statusLbl(t.status)}</span><span className="fk-hint">{tx('sp.statusNote.' + t.status)}</span></div>
        <div className="fn-cols2">
          <SplitBreakdown b={t.breakdown} testId="detail-breakdown" />
          <dl className="fk-dl">
            <dt>{tx('sp.f.subtotal')}</dt><dd>{fmtMoney(f.subtotalCents)}</dd>
            {f.discountCents ? <><dt>{tx('sp.f.discount')}</dt><dd>−{fmtMoney(f.discountCents)}</dd></> : null}
            <dt>{tx('sp.f.tax')}</dt><dd>{fmtMoney(f.taxCents)}</dd>
            <dt>{tx('sp.f.tip')}</dt><dd>{fmtMoney(f.tipCents)}{d.data.tipAllocations?.length ? <span className="fk-li-s">{d.data.tipAllocations.map((a: any) => `${a.name ?? '—'} ${fmtMoney(a.cents)}`).join(' · ')}</span> : null}</dd>
            {f.surchargeCents ? <><dt>{tx('sp.f.surcharge')}</dt><dd>{fmtMoney(f.surchargeCents)}</dd></> : null}
            <dt>{tx('sp.f.created')}</dt><dd>{when(t.createdAt)}</dd>
            <dt>{tx('sp.f.completed')}</dt><dd>{t.completedAt ? when(t.completedAt) : tx('sp.notCompleted')}</dd>
            {t.technician ? <><dt>{tx('sp.f.technician')}</dt><dd>{t.technician}</dd></> : null}
          </dl>
        </div>
        <h3 className="fk-h3">{tx('sp.tendersTitle')}</h3>
        <table className="fk-table" data-testid="tenders-table"><thead><tr><th>{tx('sp.t.method')}</th><th>{tx('sp.t.channel')}</th><th className="num">{tx('sp.t.amount')}</th><th>{tx('sp.t.state')}</th><th>{tx('sp.t.reference')}</th><th className="num">{tx('sp.t.refunded')}</th><th>{tx('sp.t.time')}</th></tr></thead>
          <tbody>{d.data.tenders.map((x: any) => <tr key={x.id}><td>{methodLbl(x.method)}{x.card ? <span className="fk-li-s">{x.card}</span> : x.giftCard ? <span className="fk-li-s">•••• {x.giftCard.last4}</span> : null}</td>
            <td>{x.channel ? codeLabel('sp.channel.' + x.channel, x.channel) : '—'}</td><td className="num"><b>{fmtMoney(x.amountCents)}</b>{x.surchargeCents ? <span className="fk-li-s">{tx('sp.t.surchargeIncl', { a: fmtMoney(x.surchargeCents) })}</span> : null}</td>
            <td><span className={'fk-chip ' + (TENDER_TONE[x.state] ?? 'mut')}>{tx('sp.tstate.' + x.state)}</span>{x.state !== 'confirmed' ? <span className="fk-li-s">{x.rawStatus}</span> : null}</td>
            <td className="fn-mono">{x.processorRef ?? (x.giftCard?.ledgerEntryId ? tx('sp.giftLedger') : x.drawerMovementId ? tx('sp.drawerEntry') : '—')}</td>
            <td className="num">{x.refundedCents ? fmtMoney(x.refundedCents) : '—'}{x.state === 'confirmed' && x.refundedCents ? <span className="fk-li-s">{tx('sp.t.refundable', { a: fmtMoney(x.refundableCents) })}</span> : null}</td><td>{when(x.at)}</td></tr>)}</tbody></table>
        <DuplicateEvents r={d.data.duplicateEvents} tenders={d.data.tenders} />
        {d.data.refunds.length ? <><h3 className="fk-h3">{tx('sp.refundsTitle')}</h3><ul className="fn-notes">{d.data.refunds.map((x: any) => <li key={x.id}><span className="fk-li-s">{when(x.at)} · {x.actor ?? '—'} · {codeLabel('sp.rstate.' + x.status, x.status)}</span><div>−{fmtMoney(x.amountCents)}{x.reason ? ` — ${x.reason}` : ''}{x.processorRefundId ? ` · ${x.processorRefundId}` : ''}</div></li>)}</ul></> : null}
        {d.data.lines?.length ? <><h3 className="fk-h3">{tx('sp.linesTitle')}</h3><table className="fk-table"><tbody>{d.data.lines.map((l: any) => <tr key={l.id}><td>{l.name ?? '—'}</td><td>{l.technician ?? ''}</td><td className="num">{fmtMoney(l.cents)}</td></tr>)}</tbody></table></> : null}
        {d.data.audit?.length ? <><h3 className="fk-h3">{tx('sp.auditTitle')}</h3><ul className="fn-notes">{d.data.audit.slice(0, 8).map((a: any, i: number) => <li key={i}><span className="fk-li-s">{when(a.at)} · {a.actor ?? '—'}</span><div>{codeLabel('sp.audit.' + a.action, a.action)}</div></li>)}</ul></> : null}
        <div className="fk-hint">{tx('sp.refundNote')}</div>
      </>}
    </FitDialog>
  );
}

// extras (Split Payments 13) — Duplicate event detector: the server's recorded signals for this ticket's tenders (repeated
// processor callbacks, the same operation reference on another tender, a tender posted twice to the gift-card ledger or the
// cash drawer). Diagnosis only — no button here erases, reverses or merges anything. Absent from an older server → nothing.
type DupEvents = { checkedTenders: number; findings: Array<{ paymentId: string; kind: string; count: number; ref: string | null }> };
export function DuplicateEvents({ r, tenders }: { r?: DupEvents | null; tenders: Array<{ id: string; method: string; amountCents: number }> }) {
  if (!r) return null;
  const tender = (id: string) => { const x = tenders.find((t) => t.id === id); return x ? `${methodLbl(x.method)} ${fmtMoney(x.amountCents)}` : id.slice(-8).toUpperCase(); };
  return <section data-testid="sp-dup">
    <h3 className="fk-h3">{tx('sp.dup.title')}</h3>
    {!r.findings.length ? <div className="fk-hint" data-testid="sp-dup-none">{tx('sp.dup.none', { n: fmtNumber(r.checkedTenders) })}</div>
      : <ul className="fn-notes">{r.findings.map((f, i) => <li key={f.paymentId + f.kind + i} data-testid="sp-dup-row"><span className="fk-chip warn">{codeLabel('sp.dup.k.' + f.kind, f.kind)}</span>{' '}
        <span>{tx('sp.dup.row', { t: tender(f.paymentId), n: fmtNumber(f.count) })}</span>{f.ref ? <span className="fk-li-s fn-mono"> {f.ref}</span> : null}</li>)}</ul>}
    <div className="fk-hint">{tx('sp.dup.safe')}</div>
  </section>;
}
