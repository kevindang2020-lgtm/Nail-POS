// POSTransactionsScreen.tsx — Payments & Money → Transactions (/tenant/payments/transactions). Transactions mandate (Oct 29
// 2026): ONE full-screen page at 100 % zoom — header (Refresh · Export) · the four KPIs from the server over EVERY matching
// tender, each with its definition (Transactions · Gross · Tips · Net) · one universal search (customer name, phone in any
// format, email, ticket, payment / processor / refund reference, technician, amount) + status / method / technician / sort ·
// the period bar (Today · This Week · This Month · This Year · Custom Range calendar) with its date field (Payment completed ·
// Created · Refunded) · a server-paged ledger, ONE ROW PER TENDER, newest first · a details overlay (the tender, its ticket's
// lines / tenders / tips, refunds and what is still refundable, the settlement only when linked, receipt resend, the existing
// guarded refund). There is no edit or charge action anywhere on this page.
// What was wrong: the page summed whatever /pos/reports/transactions returned in the browser (100 rows shown), dates were
// UTC days drawn as midnight UTC (Oct 22 showed as Oct 21 8:00 PM), a partial tender showed "completed", Net was Gross.
import { useEffect, useState } from 'react';
import { SystemCheckButton } from '../components/SystemCheck';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posTransactionsApi } from '../api/posTransactionsApi';
import { posCheckoutApi } from '../api/posCheckoutApi';
import { TicketRefundPanel } from '../components/TicketRefundPanel';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { errorTextOf } from '../i18n/error-text';
import { useCan } from '../components/usePermissions';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced } from '../components/FitKit';
import { ExportPreview } from '../components/ExportPreview';
import { PeriodBar, periodQuery, periodText, useLoad, StateBlock, isForbidden, centsFromText, fmtYmdSafe, type PeriodState } from '../components/FinanceKit';

type Row = { id: string; ticketId: string | null; ticketNumber: string | null; state: string; rawStatus: string; createdAt: string | null; paidAt: string | null; lastRefundAt: string | null;
  customer: { id: string; name: string | null; phone: string | null } | null; technicians: string | null; method: string; channel: string | null; card: string | null; giftCardLast4: string | null;
  grossCents: number; tipCents: number; refundedCents: number; refundPendingCents: number; netCents: number; counted: boolean; processor: string | null; processorRef: string | null; settlementId: string | null; matchedBy?: string; matchSource?: 'ticket' | 'refund' | 'payment' | 'customer' | 'technician' | null };
const STATE_TONE: Record<string, string> = { completed: 'ok', partially_refunded: 'warn', refunded: 'warn', voided: 'mut', pending: 'info', failed: 'bad' };
const STATES = ['completed', 'partially_refunded', 'refunded', 'voided', 'pending', 'failed'];
const METHODS = ['card', 'cash', 'gift_card', 'other'];
const SORTS = ['created_desc', 'paid_desc', 'created_asc', 'amount_desc', 'amount_asc'];
const BASES = ['paid', 'created', 'refunded'];
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const stateLbl = (s: string) => codeLabel('txn.state.' + s, s);
const methodLbl = (m: string, last4?: string | null) => codeLabel('rv.method.' + m, m) + (last4 ? ' ••' + last4 : '');
const short = (id: string) => id.replace(/-/g, '').slice(-8).toUpperCase();
const errMsg = (e: unknown) => errorTextOf(e, tx('finance.state.loadFailed'));

export function POSTransactionsScreen() {
  const nav = useNavigate(); const can = useCan();
  // deep links (?ticket=<id> from Customer Timeline / Money Protection, ?q=<ref>) open the ledger already searched for
  // that reference across ALL dates (the server search matches ticket / payment / refund / batch ids exactly)
  const [sp] = useSearchParams(); const deepRef = (sp.get('ticket') ?? sp.get('q') ?? '').trim().slice(0, 100);
  const [search, setSearch] = useState(deepRef); const q = useDebounced(search.trim(), 300);
  const [status, setStatus] = useState(''); const [method, setMethod] = useState(''); const [tech, setTech] = useState(''); const [sort, setSort] = useState('created_desc');
  const [minA, setMinA] = useState(''); const [maxA, setMaxA] = useState('');
  const [period, setPeriod] = useState<PeriodState>(deepRef ? { preset: 'all' } : { preset: 'month' }); const [basis, setBasis] = useState('paid');
  const [page, setPage] = useState(1); const [tick, setTick] = useState(0); const [detail, setDetail] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null); const [exporting, setExporting] = useState(false); const [previewExport, setPreviewExport] = useState(false);
  const minC = minA ? centsFromText(minA) : null; const maxC = maxA ? centsFromText(maxA) : null;
  const amountBad = (minA && minC == null) || (maxA && maxC == null) || (minC != null && maxC != null && minC > maxC);
  const filters = { ...periodQuery(period), dateField: basis, search: q || undefined, method: method || undefined, technician: tech || undefined,
    minAmount: !amountBad && minC != null ? (minC / 100).toFixed(2) : undefined, maxAmount: !amountBad && maxC != null ? (maxC / 100).toFixed(2) : undefined };
  const scope = { ...filters, status: status || undefined, sort };
  const key = JSON.stringify(scope); useEffect(() => { setPage(1); }, [key]);
  const fit = useFitRows<HTMLDivElement>(46, { min: 3, max: 18, reserve: 34 });
  const list = useLoad(() => posTransactionsApi.list({ ...scope, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  const sum = useLoad(() => posTransactionsApi.summary(filters), [JSON.stringify(filters), tick]);
  const techs = useLoad(() => posTransactionsApi.technicians(), []);
  useEffect(() => { if (list.data && list.data.page !== page) setPage(list.data.page); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const k = sum.data?.kpis; const ctx = sum.data?.context; const rows: Row[] = list.data?.items ?? [];
  const chips = [...(q ? [{ label: tx('rv.chip.search', { q }), clear: () => setSearch('') }] : []), ...(status ? [{ label: stateLbl(status), clear: () => setStatus('') }] : []),
    ...(method ? [{ label: methodLbl(method), clear: () => setMethod('') }] : []), ...(tech ? [{ label: techs.data?.technicians.find((x) => x.id === tech)?.name ?? tx('txn.technician'), clear: () => setTech('') }] : []),
    ...(minA || maxA ? [{ label: tx('txn.chip.amount', { a: minA || '0', b: maxA || '∞' }), clear: () => { setMinA(''); setMaxA(''); } }] : [])];
  const clearAll = () => { setSearch(''); setStatus(''); setMethod(''); setTech(''); setMinA(''); setMaxA(''); setSort('created_desc'); setPeriod({ preset: 'month' }); setBasis('paid'); };
  const doExport = async () => {
    setExporting(true); setPreviewExport(false);
    try { const csv = await posTransactionsApi.exportCsv(scope); const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'transactions.csv'; a.click(); URL.revokeObjectURL(a.href); setNote({ tone: 'ok', text: tx('finance.exported') }); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } finally { setExporting(false); }
  };
  if (isForbidden(list.error) || isForbidden(sum.error)) return <div className="work fit tn" data-testid="transactions-screen"><h1>{tx('pos.transactions')}</h1><StateBlock error={list.error ?? sum.error} onRetry={list.reload} /></div>;
  return (
    <div className="work fit tn" data-testid="transactions-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.transactions')}</h1><div className="sub">{tx('txn.subtitle')}{sum.data ? ' · ' + periodText(sum.data.period) : ''}</div></div>
        <div className="fk-head-actions">
          <SystemCheckButton domain="payments" />
          <button type="button" className="fk-btn" onClick={() => setTick((t) => t + 1)} data-testid="refresh">{tx('finance.refresh')}</button>
          {can('reports.export') ? <button type="button" className="fk-btn" onClick={() => setPreviewExport(true)} disabled={exporting} data-testid="export">{exporting ? tx('pos.loading') : tx('finance.exportReport')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      <div className="fk-kpis" data-testid="kpis">
        {sum.error ? <StateBlock error={sum.error} onRetry={sum.reload} /> : <>
          <KpiCard testId="kpi-transactions" label={tx('pos.transactions')} loading={!k} value={k ? fmtNumber(k.transactions) : ''} sub={ctx ? tx('txn.kpi.txSub', { t: fmtNumber(ctx.tickets), f: fmtNumber(ctx.failed + ctx.pending) }) : ''} />
          <KpiCard testId="kpi-gross" tone="gold" label={tx('pos.gross')} loading={!k} value={k ? fmtMoney(k.grossCents) : ''} sub={tx('txn.kpi.grossSub')} />
          <KpiCard testId="kpi-tips" label={tx('pos.tips')} loading={!k} value={k ? fmtMoney(k.tipsCents) : ''} sub={tx('txn.kpi.tipsSub')} />
          <KpiCard testId="kpi-net" label={tx('pos.net')} loading={!k} value={k ? fmtMoney(k.netCents) : ''} sub={ctx ? tx('txn.kpi.netSub', { r: fmtMoney(ctx.refundedCents) }) : ''} />
        </>}
      </div>
      {sum.data?.previous && k ? (() => { const pv = sum.data.previous; const chg = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10);
        const g = chg(k.grossCents, pv.grossCents);   // extras (TRANSACTIONS 13): one compact line, never displacing the ledger or KPIs
        return <div className="fk-hint" data-testid="tx-trend">{tx('txn.trend', { from: fmtYmdSafe(pv.from), to: fmtYmdSafe(pv.to), g: fmtMoney(pv.grossCents), n: fmtNumber(pv.transactions) })}{g != null ? ` · ${tx(g >= 0 ? 'txn.trendUp' : 'txn.trendDown', { p: String(Math.abs(g)) })}` : ''}</div>; })() : null}
      {sum.data ? <details className="tn-defs" data-testid="definitions"><summary>{tx('txn.howCounted')}</summary><dl className="fk-dl">{['transactions', 'gross', 'tips', 'net'].map((x) => <div key={x} className="tn-def"><dt>{tx('txn.def.' + x)}</dt><dd>{tx('txn.defText.' + x)}</dd></div>)}</dl></details> : null}
      <div className="fn-tabsrow tn-toolbar">
        <div className="fn-search tn-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('txn.searchPh')} aria-label={tx('txn.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}</div>
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="status"><option value="">{tx('finance.allStatuses')}</option>{STATES.map((s) => <option key={s} value={s}>{stateLbl(s)}</option>)}</select>
        <select className="fk-select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label={tx('rv.method')} data-testid="method"><option value="">{tx('rv.allMethods')}</option>{METHODS.map((s) => <option key={s} value={s}>{methodLbl(s)}</option>)}</select>
        <select className="fk-select" value={tech} onChange={(e) => setTech(e.target.value)} disabled={!techs.data?.technicians.length} aria-label={tx('txn.technician')} data-testid="technician"><option value="">{tx('txn.allTechnicians')}</option>{(techs.data?.technicians ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <span className="tn-amt"><input className="fk-search xs" inputMode="decimal" value={minA} onChange={(e) => setMinA(e.target.value)} placeholder={tx('txn.min')} aria-label={tx('txn.minAmount')} data-testid="min-amount" />–<input className="fk-search xs" inputMode="decimal" value={maxA} onChange={(e) => setMaxA(e.target.value)} placeholder={tx('txn.max')} aria-label={tx('txn.maxAmount')} data-testid="max-amount" /></span>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')} data-testid="sort">{SORTS.map((s) => <option key={s} value={s}>{tx('txn.sort.' + s)}</option>)}</select>
      </div>
      {amountBad ? <div className="fk-error" role="alert" data-testid="amount-error">{tx('txn.amountBad')}</div> : null}
      <div className="fn-tabsrow tn-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={list.data?.period} compact allowAll basis={basis} basisOptions={BASES.map((b) => ({ value: b, label: tx('txn.basis.' + b) }))} onBasis={setBasis} />
        {chips.length ? <span className="fn-chips" data-testid="chips">{chips.map((c) => <span key={c.label} className="fk-chip mut">{c.label}<button type="button" className="fk-chip-x" aria-label={tx('finance.removeFilter', { f: c.label })} onClick={c.clear}>✕</button></span>)}
          <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button></span> : null}
      </div>
      <FitPanel testId="ledger" bodyRef={fit.ref} className="fn-records" title={<span className="fn-chips">{tx('txn.ledger')}{list.data ? <span className="fk-muted"> · {tx('txn.matches', { n: fmtNumber(list.data.total) })}</span> : null}<span className="fk-hint">{tx('txn.dateShown.' + basis)}</span></span>}
        footer={<Pager info={list.data ? { page: list.data.page, pageSize: list.data.pageSize, totalItems: list.data.total, totalPages: list.data.pageCount } : null} onPage={setPage} label={tx('txn.ledger')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : rows.length === 0 ? (chips.length ? <Empty title={tx('txn.noMatches')}><button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button></Empty>
            : <Empty title={tx('pos.no_transactions_in_this_period')}><span className="fk-hint">{tx('rv.emptyHint', { p: periodText(list.data.period) })}</span></Empty>)
          : <table className="fk-table fn-table tn-table" data-testid="ledger-table">
            <thead><tr><th>{tx('txn.col.paidAt')}</th><th>{tx('txn.col.ref')}</th><th>{tx('txn.col.customer')}</th><th className="t-opt">{tx('txn.col.techs')}</th><th>{tx('txn.col.method')}</th><th className="num">{tx('pos.gross')}</th><th className="num t-opt2">{tx('txn.col.tip')}</th><th className="num">{tx('pos.net')}</th><th>{tx('finance.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} data-testid="tx-row">
                <td>{when(basis === 'created' ? r.createdAt : basis === 'refunded' ? r.lastRefundAt : (r.paidAt ?? r.createdAt))}</td>
                <td className="fn-id"><span className="fn-mono">{short(r.id)}</span><span className="fk-li-s">{r.ticketNumber ? tx('txn.ticketN', { n: r.ticketNumber }) : tx('rv.notLinked')}{r.matchedBy && q && !r.matchSource ? ' · ' + tx('txn.matched.' + r.matchedBy) : ''}</span>{r.matchSource && q ? <span className="fk-chip mut" data-testid="txn-match-source">{tx('txn.src.' + r.matchSource)}</span> : null}</td>
                <td>{r.customer?.name ?? tx('rv.walkIn')}{r.customer?.phone ? <span className="fk-li-s">{r.customer.phone}</span> : null}</td>
                <td className="t-opt tn-techs">{r.technicians ?? '—'}</td>
                <td>{methodLbl(r.method, r.giftCardLast4)}{r.card || r.channel ? <span className="fk-li-s">{[r.card, r.channel ? codeLabel('txn.channel.' + r.channel, r.channel) : null].filter(Boolean).join(' · ')}</span> : null}</td>
                <td className="num"><b className={r.counted ? '' : 'fk-muted'}>{fmtMoney(r.grossCents)}</b></td>
                <td className="num t-opt2">{fmtMoney(r.tipCents)}</td>
                <td className="num">{r.counted ? fmtMoney(r.netCents) : <span className="fk-muted">—</span>}{r.refundedCents ? <span className="fk-li-s">−{fmtMoney(r.refundedCents)}</span> : null}</td>
                <td><span className={'fk-chip ' + (STATE_TONE[r.state] ?? 'mut')}>{stateLbl(r.state)}</span>{r.rawStatus === 'partial' ? <span className="fk-li-s">{tx('txn.splitPart')}</span> : null}</td>
                <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => setDetail(r.id)} data-testid="view">{tx('finance.view')}</button></td>
              </tr>))}</tbody>
          </table>}
      </FitPanel>
      {previewExport ? <ExportPreview title={tx('finance.exportReport')} count={list.data?.total} cap={20000} audited busy={exporting}
        period={`${periodText(list.data?.period)} · ${tx('txn.basis.' + basis)}`} filters={[...chips.map((c) => c.label), ...(sort !== 'created_desc' ? [tx('txn.sort.' + sort)] : [])]}
        onConfirm={doExport} onCancel={() => setPreviewExport(false)} /> : null}
      {detail ? <TxDialog id={detail} tick={tick} onClose={() => setDetail(null)} onChanged={() => setTick((t) => t + 1)} onNote={setNote}
        onCustomer={(cid) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(cid)}`)} onGo={(path) => nav(path)} /> : null}
    </div>
  );
}

export function TxDialog({ id, tick, onClose, onChanged, onNote, onCustomer, onGo }: { id: string; tick: number; onClose: () => void; onChanged: () => void; onNote: (n: { tone: 'ok' | 'bad' | 'warn'; text: string }) => void; onCustomer: (id: string) => void; onGo: (p: string) => void }) {
  const d = useLoad(() => posTransactionsApi.detail(id), [id, tick]);
  const [refunding, setRefunding] = useState(false); const [sending, setSending] = useState<string | null>(null);
  const t: (Row & { surchargeCents: number; refundableCents: number }) | undefined = d.data?.tender; const tk = d.data?.ticket; const perm = d.data?.permissions ?? {};
  const resend = async (channel: 'sms' | 'email') => {
    if (!tk?.id) return; setSending(channel);
    try { await posCheckoutApi.receiptSendAll(tk.id, { channels: [channel] }); onNote({ tone: 'ok', text: tx('txn.receiptSent.' + channel) }); }
    catch (e) { onNote({ tone: 'bad', text: errorTextOf(e, tx('pos.something_went_wrong')) }); } finally { setSending(null); }
  };
  return (
    <FitDialog wide title={t ? tx('txn.detailTitle', { id: short(t.id) }) : tx('txn.detail')} subtitle={t ? `${t.ticketNumber ? tx('txn.ticketN', { n: t.ticketNumber }) : tx('rv.notLinked')} · ${t.customer?.name ?? tx('rv.walkIn')} · ${when(t.paidAt ?? t.createdAt)}` : undefined} onClose={onClose} testId="tx-dialog"
      footer={t ? <>
        {t.customer?.id && perm.customer ? <button type="button" className="fk-btn" onClick={() => onCustomer(t.customer!.id)}>{tx('finance.openCustomer')}</button> : null}
        {tk?.id && perm.sendReceipt ? <><button type="button" className="fk-btn" onClick={() => resend('sms')} disabled={!!sending} data-testid="receipt-sms">{sending === 'sms' ? tx('pos.loading') : tx('txn.receiptSms')}</button>
          <button type="button" className="fk-btn" onClick={() => resend('email')} disabled={!!sending} data-testid="receipt-email">{sending === 'email' ? tx('pos.loading') : tx('txn.receiptEmail')}</button></> : null}
        {perm.refund && t.refundableCents > 0 && tk?.id ? <button type="button" className="fk-btn" onClick={() => setRefunding(true)} data-testid="detail-refund">{tx('pos.refund')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !t ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fn-statusline"><span className={'fk-chip ' + (STATE_TONE[t.state] ?? 'mut')}>{stateLbl(t.state)}</span><span className="fk-hint">{tx('txn.stateNote.' + t.state)}</span></div>
        <div className="fn-cols2">
          <dl className="fk-dl" data-testid="tender-facts">
            <dt>{tx('txn.f.payment')}</dt><dd className="fn-mono">{t.id}</dd>
            <dt>{tx('txn.f.amount')}</dt><dd><b>{fmtMoney(t.grossCents)}</b> <span className="fk-li-s">{tx('txn.f.tipIncluded', { t: fmtMoney(t.tipCents) })}</span></dd>
            <dt>{tx('txn.f.method')}</dt><dd>{methodLbl(t.method, t.giftCardLast4)}{t.card ? ' · ' + t.card : ''}{t.channel ? ' · ' + codeLabel('txn.channel.' + t.channel, t.channel) : ''}</dd>
            <dt>{tx('rv.f.processor')}</dt><dd>{t.processor ?? (t.method === 'cash' ? tx('rv.f.cashDrawer') : t.method === 'gift_card' ? tx('rv.f.giftLedger') : '—')}</dd>
            <dt>{tx('rv.f.providerRef')}</dt><dd className="fn-mono">{t.processorRef ?? tx('txn.notAvailable')}</dd>
            <dt>{tx('txn.f.paidAt')}</dt><dd>{when(t.paidAt)}</dd>
            <dt>{tx('txn.f.createdAt')}</dt><dd>{when(t.createdAt)}</dd>
            <dt>{tx('txn.col.techs')}</dt><dd>{t.technicians ?? '—'}</dd>
            <dt>{tx('rv.f.settlement')}</dt><dd>{d.data.settlement ? <button type="button" className="fk-li-t link" onClick={() => onGo('/tenant/payments/settlements')}>{d.data.settlement.reference ?? short(d.data.settlement.id)} · {codeLabel('rv.settle.' + d.data.settlement.status, d.data.settlement.status)}</button> : <span className="fk-muted">{tx('rv.notLinked')}</span>}</dd>
          </dl>
          <div>
            <h3 className="fk-h3">{tx('txn.refundTitle')}</h3>
            <dl className="rv-pos" data-testid="refund-position">
              <div><dt>{tx('rv.pos.captured')}</dt><dd>{fmtMoney(t.counted ? t.grossCents : 0)}</dd></div>
              <div><dt>{tx('rv.pos.refunded')}</dt><dd>{t.refundedCents ? '−' + fmtMoney(t.refundedCents) : fmtMoney(0)}</dd></div>
              <div className={t.refundPendingCents ? 'warn' : ''}><dt>{tx('rv.pos.pending')}</dt><dd>{t.refundPendingCents ? '−' + fmtMoney(t.refundPendingCents) : fmtMoney(0)}</dd></div>
              <div className="total"><dt>{tx('rv.pos.refundable')}</dt><dd>{fmtMoney(t.refundableCents)}</dd></div>
            </dl>
            {d.data.refunds.length ? <ul className="fn-notes" data-testid="refund-history">{d.data.refunds.map((x: any) => <li key={x.id}><span className="fk-li-s">{when(x.at)} · {x.actor ?? '—'} · {codeLabel('rv.raw.' + x.status, x.status)}</span><div>−{fmtMoney(x.amountCents)}{x.reason ? ` — ${x.reason}` : ''}</div></li>)}</ul> : <div className="fk-hint">{tx('txn.noRefunds')}</div>}
            <button type="button" className="fk-link" onClick={() => onGo('/tenant/payments/refunds-voids')}>{tx('txn.openRefunds')}</button>
          </div>
        </div>
        <PaymentTimeline items={d.data.timeline ?? []} />
        <DuplicateReview review={d.data.duplicateReview} />
        {tk ? <>
          <h3 className="fk-h3">{tx('txn.ticketTitle', { n: tk.ticketNumber ?? '—' })}</h3>
          <div className="fn-cols2">
            <div>{tk.lines?.length ? <table className="fk-table" data-testid="ticket-lines"><thead><tr><th>{tx('txn.col.item')}</th><th>{tx('txn.technician')}</th><th className="num">{tx('txn.col.amount')}</th></tr></thead>
              <tbody>{tk.lines.map((l: any) => <tr key={l.id}><td>{l.name ?? '—'}</td><td>{l.technician ?? '—'}</td><td className="num">{fmtMoney(l.cents)}</td></tr>)}</tbody></table> : <div className="fk-hint">{tx('txn.noLines')}</div>}</div>
            <dl className="fk-dl" data-testid="ticket-financials">
              <dt>{tx('txn.fin.subtotal')}</dt><dd>{fmtMoney(tk.financials?.subtotalCents)}</dd>
              <dt>{tx('txn.fin.discount')}</dt><dd>{tk.financials?.discountCents ? '−' + fmtMoney(tk.financials.discountCents) : fmtMoney(0)}</dd>
              <dt>{tx('txn.fin.tax')}</dt><dd>{fmtMoney(tk.financials?.taxCents)}</dd>
              {tk.financials?.surchargeCents ? <><dt>{tx('txn.fin.surcharge')}</dt><dd>{fmtMoney(tk.financials.surchargeCents)}</dd></> : null}
              <dt>{tx('txn.fin.tip')}</dt><dd>{fmtMoney(tk.financials?.tipCents)}{tk.tipAllocations?.length ? <span className="fk-li-s">{tk.tipAllocations.map((a: any) => `${a.name ?? '—'} ${fmtMoney(a.cents)}`).join(' · ')}</span> : null}</dd>
              <dt>{tx('txn.fin.total')}</dt><dd><b>{fmtMoney(tk.financials?.totalCents)}</b></dd>
              <dt>{tx('txn.fin.paid')}</dt><dd>{fmtMoney(tk.financials?.paidCents)}{tk.financials?.balanceCents ? <span className="fk-li-s">{tx('txn.fin.balance', { b: fmtMoney(tk.financials.balanceCents) })}</span> : null}</dd>
            </dl>
          </div>
          {tk.tenders?.length > 1 ? <><h3 className="fk-h3">{tx('rv.tendersTitle')}</h3>
            <table className="fk-table" data-testid="ticket-tenders"><thead><tr><th>{tx('txn.col.method')}</th><th className="num">{tx('txn.col.amount')}</th><th>{tx('finance.status')}</th><th>{tx('rv.t.ref')}</th></tr></thead>
              <tbody>{tk.tenders.map((x: any) => <tr key={x.id} className={x.id === t.id ? 'rv-this' : ''}><td>{methodLbl(x.method, x.giftCard?.last4)}{x.id === t.id ? <span className="fk-li-s">{tx('rv.t.thisOne')}</span> : null}</td><td className="num">{fmtMoney(x.amountCents)}</td><td>{codeLabel('txn.tstate.' + x.state, x.state)}</td><td className="fn-mono">{x.processorRef ?? '—'}</td></tr>)}</tbody></table></> : null}
        </> : null}
        <div className="fk-hint">{tx('txn.noEditNote')}</div>
      </>}
      {refunding && tk?.id ? <FitDialog wide title={tx('pos.refund')} subtitle={tk.ticketNumber ? tx('txn.ticketN', { n: tk.ticketNumber }) : undefined} onClose={() => { setRefunding(false); d.reload(); }} testId="ticket-refund-dialog">
        <TicketRefundPanel ticketId={tk.id} label={t?.customer?.name ?? undefined} onClose={() => { setRefunding(false); d.reload(); }} onDone={() => { onChanged(); onNote({ tone: 'ok', text: tx('rv.done.ticket') }); }} /></FitDialog> : null}
    </FitDialog>
  );
}

// extras arc (Nov 10 2026): the payment's state timeline from the server (recorded times only — created, approved,
// failed, refund requested / settled, batch settled, deposited), newest first. A state with no recorded time is absent.
export function PaymentTimeline({ items }: { items: Array<{ kind: string; at: string; amountCents?: number; ref?: string | null; status?: string | null }> }) {
  if (!items.length) return null;
  return <>
    <h3 className="fk-h3">{tx('ptl.title')}</h3>
    <ul className="fk-list dense" data-testid="payment-timeline" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((e, i) => <li key={e.kind + i} data-testid="payment-timeline-row" style={{ padding: '4px 0', borderBottom: '1px solid var(--line, #eee)' }}>
        <b>{tx('ptl.k.' + e.kind)}</b>
        <span className="fk-muted"> · {fmtInZone(e.at, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}{e.amountCents != null ? ` · ${fmtMoney(e.amountCents)}` : ''}{e.ref ? ` · ${e.ref}` : ''}</span>
      </li>)}
    </ul>
  </>;
}

// extras (TRANSACTIONS 03): Safe Duplicate-Payment Review — the server's recorded signals for this tender (a shared processor
// reference, repeated processor callbacks, a same-method same-amount second charge on the ticket within 10 minutes, money
// beyond what the ticket can owe). Diagnosis only: no button here voids, refunds or erases anything; a correction goes
// through Refunds & Voids. Absent from an older server → nothing is shown (never a fabricated "all clear").
type DupReview = { signals: number; sharedReference: Array<{ id: string; ticketNumber: string | null; amountCents: number; status: string; at: string | null }>;
  callbacks: { deliveries: number; distinctEvents: number; repeated: number; unprocessed: number }; conflicting: Array<{ id: string; amountCents: number; at: string | null; processorRef: string | null }>; overCollectedCents: number };
export function DuplicateReview({ review }: { review?: DupReview | null }) {
  if (!review) return null;
  const at = (v: string | null) => (v ? fmtInZone(v, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
  return <section data-testid="dup-review">
    <h3 className="fk-h3">{tx('txn.dup.title')}</h3>
    {review.signals === 0 ? <div className="fk-hint" data-testid="dup-none">{tx('txn.dup.none', { n: fmtNumber(review.callbacks.deliveries) })}</div> : <ul className="fn-notes">
      {review.sharedReference.length ? <li data-testid="dup-shared"><span className="fk-chip warn">{tx('txn.dup.shared', { n: fmtNumber(review.sharedReference.length) })}</span>
        <div className="fk-li-s">{review.sharedReference.map((x) => `${x.ticketNumber ? tx('txn.ticketN', { n: x.ticketNumber }) : short(x.id)} · ${fmtMoney(x.amountCents)} · ${codeLabel('rv.raw.' + x.status, x.status)} · ${at(x.at)}`).join(' | ')}</div></li> : null}
      {review.callbacks.repeated ? <li data-testid="dup-callbacks"><span className="fk-chip warn">{tx('txn.dup.callbacks', { d: fmtNumber(review.callbacks.deliveries), e: fmtNumber(review.callbacks.distinctEvents) })}</span>
        <div className="fk-li-s">{tx('txn.dup.callbacksNote', { u: fmtNumber(review.callbacks.unprocessed) })}</div></li> : null}
      {review.conflicting.length ? <li data-testid="dup-conflicting"><span className="fk-chip bad">{tx('txn.dup.conflicting', { n: fmtNumber(review.conflicting.length) })}</span>
        <div className="fk-li-s">{review.conflicting.map((x) => `${short(x.id)} · ${fmtMoney(x.amountCents)} · ${at(x.at)}${x.processorRef ? ' · ' + x.processorRef : ''}`).join(' | ')}</div></li> : null}
      {review.overCollectedCents ? <li data-testid="dup-over"><span className="fk-chip bad">{tx('txn.dup.over', { a: fmtMoney(review.overCollectedCents) })}</span></li> : null}
    </ul>}
    <div className="fk-hint">{tx('txn.dup.safe')}</div>
  </section>;
}
