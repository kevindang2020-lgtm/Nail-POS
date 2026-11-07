// POSPaymentsOverviewScreen.tsx — Payments & Money → Overview (/tenant/payments/overview). Payments & Money mandate (Oct 29
// 2026): ONE viewport at 100 % zoom, no page scroll — header (salon · period · Refresh · Financial Report) · one universal
// search (customer, phone, ticket, receipt, invoice, transaction, payout) · Today / This Week / This Month / This Year /
// Custom Range · the EIGHT KPIs in a 4 × 2 grid, each labelled with its scope (the period · as of now) · four workspaces
// (Overview · Transactions · Revenue & Services · Payouts & Health) instead of panels stacked below the fold · the SIX
// all-time totals in a labelled strip · all EIGHT Quick Actions in a bottom bar (disabled with a reason when the role cannot).
// What was wrong: one 8-column KPI row, every module stacked so the totals and the Quick Actions were only reachable by
// scrolling; Revenue / Collections $116.43 beside three tenders summing $168.15 (only 'approved' summed — the split's
// 'partial' $51.72 tender dropped), UTC "today", Collections = Revenue, Average ÷ tenders, a "100 % Excellent" health score.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posMoneyOverviewApi } from '../api/posMoneyOverviewApi';
import { posTransactionsApi } from '../api/posTransactionsApi';
import { TxDialog } from './POSTransactionsScreen';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { useCan } from '../components/usePermissions';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced } from '../components/FitKit';   // useDebounced: services search
import { PeriodBar, periodQuery, periodText, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';

type Space = 'overview' | 'transactions' | 'revenue' | 'payouts';
const SPACES: Space[] = ['overview', 'transactions', 'revenue', 'payouts'];
const KINDS = ['', 'payments', 'refunds', 'voids', 'pending', 'failed'];   // All Transactions · Payments · Refunds · Voids · Pending · Failed
const KIND_KEY: Record<string, string> = { '': 'payment.tab.all', payments: 'payment.tab.payments', refunds: 'payment.tab.refunds', voids: 'payment.tab.voids', pending: 'payment.tab.pending', failed: 'payment.tab.failed' };
const PALETTE: Record<string, string> = { card: '#A96F22', cash: '#6BAF92', gift_card: '#7B9FD4', other: '#B0A0C8' };
const STATE_TONE: Record<string, string> = { completed: 'ok', partially_refunded: 'warn', refunded: 'warn', voided: 'mut', pending: 'info', failed: 'bad' };
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const methodLbl = (m: string) => codeLabel('rv.method.' + m, m);
const stateLbl = (s: string) => codeLabel('txn.state.' + s, s);
const pct = (v: number | null | undefined) => (v == null ? tx('pm.na') : `${fmtNumber(v, 1)}%`);

export function POSPaymentsOverviewScreen() {
  const nav = useNavigate(); const can = useCan();
  const [period, setPeriod] = useState<PeriodState>({ preset: 'today' }); const [space, setSpace] = useState<Space>('overview');
  const [search, setSearch] = useState(''); const [searchOpen, setSearchOpen] = useState(false); const q = search.trim(); const [tick, setTick] = useState(0);
  const [detail, setDetail] = useState<string | null>(null); const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [kind, setKind] = useState(''); const [txPage, setTxPage] = useState(1);
  const pq = periodQuery(period);
  const o = useLoad(() => posMoneyOverviewApi.overview(pq), [JSON.stringify(pq), tick]);
  const d = o.data; const k = d?.kpis; const out = d?.outstanding;
  const pqKey = JSON.stringify(pq);
  useEffect(() => { setTxPage(1); }, [kind, pqKey]);
  const drillDay = (start: string) => { setPeriod({ preset: 'custom', from: start, to: start }); setSpace('transactions'); setKind('payments'); };
  if (isForbidden(o.error)) return <div className="work fit pm" data-testid="money-screen"><h1>{tx('pos.payments_money')}</h1><StateBlock error={o.error} onRetry={o.reload} /></div>;
  const scopeP = d ? periodText(d.period) : '';
  const quick = [
    { k: 'record', l: tx('pos.record_payment'), to: '/checkout', p: 'checkout.process_payment' },
    { k: 'refund', l: tx('pos.issue_refund'), to: '/tenant/payments/refunds-voids', p: 'checkout.manage_overrides' },
    { k: 'invoice', l: tx('pos.new_invoice_2'), to: '/tenant/payments/invoices', p: 'checkout.view' },
    { k: 'tip', l: tx('pos.add_tip'), to: '/tenant/payments/tips', p: 'tips.adjust' },
    { k: 'payout', l: tx('pos.process_payout'), to: '/tenant/payments/settlements', p: 'payouts.manage' },
    { k: 'report', l: tx('pos.financial_report'), to: '/tenant/reports/payments', p: 'reports.view' },
    { k: 'reconcile', l: tx('pos.reconcile'), to: '/tenant/payments/deposit-reconciliation', p: 'reconciliation.view' },
    { k: 'settings', l: tx('pos.settings'), to: '/tenant/payments/terminals', p: 'settings.view' },
  ];
  return (
    <div className="work fit pm" data-testid="money-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.payments_money')}</h1><div className="sub">{tx('pm.subtitle', { scope: d?.scope === 'location' ? tx('pm.scope.location') : tx('pm.scope.salonWord') })}{d ? ' · ' + tx('pm.updated', { t: when(d.generatedAt) }) : ''}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={() => setTick((t) => t + 1)} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn" onClick={() => nav('/tenant/reports/payments')} disabled={!can('reports.view')} title={!can('reports.view') ? tx('people.fit.noPermission') : undefined} data-testid="financial-report">{tx('pos.financial_report')}</button>
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      <div className="fn-tabsrow pm-toolbar">
        <div className="fn-search pm-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.length >= 2) { e.preventDefault(); setSearchOpen(true); } }} placeholder={tx('pm.searchPh')} aria-label={tx('pm.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}</div>
        <button type="button" className="fk-btn" onClick={() => setSearchOpen(true)} disabled={q.length < 2} data-testid="search-go">{tx('pm.searchGo')}</button>
        <PeriodBar value={period} onChange={setPeriod} server={d?.period} allowAll compact />
      </div>
      <div className="fk-kpis pm-kpis" data-testid="kpis">
        {o.error ? <StateBlock error={o.error} onRetry={o.reload} /> : <>
          <KpiCard testId="kpi-revenue" tone="gold" label={tx('pm.kpi.revenue')} loading={!k} value={k ? fmtMoney(k.revenueCents) : ''} sub={tx('pm.sub.period', { p: scopeP })} onClick={() => setSpace('revenue')} />
          <KpiCard testId="kpi-collections" label={tx('pm.kpi.collections')} loading={!k} value={k ? fmtMoney(k.collectionsCents) : ''} sub={k ? (k.giftCardCollectionsCents ? tx('pm.sub.gift', { g: fmtMoney(k.giftCardCollectionsCents) }) : tx('pm.sub.period', { p: scopeP })) : ''} onClick={() => { setSpace('transactions'); setKind('payments'); }} />
          <KpiCard testId="kpi-refunds" label={tx('pos.refunds_issued_3')} loading={!k} value={k ? fmtMoney(k.refundsIssuedCents) : ''} sub={k ? (k.pendingRefundsCents ? tx('pm.sub.pendingRefunds', { a: fmtMoney(k.pendingRefundsCents) }) : tx('pm.sub.period', { p: scopeP })) : ''} onClick={() => { setSpace('transactions'); setKind('refunds'); }} />
          <KpiCard testId="kpi-outstanding" tone={k && k.outstandingBalanceCents > 0 ? 'warn' : undefined} label={tx('pos.outstanding_balance')} loading={!k} value={k ? fmtMoney(k.outstandingBalanceCents) : ''} sub={out ? tx('pm.sub.outstanding', { t: fmtNumber(out.ticketsDue), i: fmtNumber(out.invoicesDue) }) : ''} onClick={() => nav('/tenant/payments/invoices')} />
          <KpiCard testId="kpi-transactions" label={tx('pos.total_transactions')} loading={!k} value={k ? fmtNumber(k.totalTransactions) : ''} sub={tx('pm.sub.tenders')} onClick={() => { setSpace('transactions'); setKind('payments'); }} />
          <KpiCard testId="kpi-average" label={tx('pos.average_ticket')} loading={!k} value={k ? (k.paidTickets ? fmtMoney(k.averageTicketCents) : '—') : ''} sub={k ? tx('pm.sub.average', { n: fmtNumber(k.paidTickets) }) : ''} onClick={() => setSpace('revenue')} />
          <KpiCard testId="kpi-failed" tone={k && k.failedTransactions > 0 ? 'bad' : undefined} label={tx('pos.failed_transactions')} loading={!k} value={k ? fmtNumber(k.failedTransactions) : ''} sub={k ? (k.unresolvedTransactions ? tx('pm.sub.unresolved', { n: fmtNumber(k.unresolvedTransactions) }) : tx('pm.sub.period', { p: scopeP })) : ''} onClick={() => { setSpace('transactions'); setKind('failed'); }} />
          <KpiCard testId="kpi-payouts" label={tx('pos.pending_payouts')} loading={!k} value={k ? fmtMoney(k.pendingPayoutsCents) : ''} sub={k ? tx('pm.sub.payouts', { n: fmtNumber(k.pendingPayouts) }) : ''} onClick={() => setSpace('payouts')} />
        </>}
      </div>
      <div className="fn-tabsrow pm-spaces">
        <div className="fk-seg fn-tabs" role="tablist" aria-label={tx('pm.workspaces')} data-module-id="pm-spaces">{SPACES.map((s) => <button key={s} type="button" role="tab" aria-selected={space === s} className={space === s ? 'on' : ''} onClick={() => setSpace(s)} data-testid={'space-' + s}>{tx('pm.space.' + s)}</button>)}</div>
        <span className="fk-hint">{tx('pm.spaceHint.' + space, { p: scopeP })}</span>
      </div>
      <div className="pm-body" data-testid={'body-' + space}>
        {o.error ? <StateBlock error={o.error} onRetry={o.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div>
          : space === 'overview' ? <OverviewSpace d={d} onDay={drillDay} onTx={setDetail} onAll={() => setSpace('transactions')} onPayouts={() => setSpace('payouts')} />
          : space === 'transactions' ? <TransactionsSpace pq={pq} kind={kind} setKind={setKind} page={txPage} setPage={setTxPage} tick={tick} onTx={setDetail} onAll={() => nav('/tenant/payments/transactions')} />
          : space === 'revenue' ? <RevenueSpace d={d} pq={pq} onDay={drillDay} />
          : <PayoutsSpace d={d} onReconcile={() => nav('/tenant/payments/deposit-reconciliation')} onSettlements={() => nav('/tenant/payments/settlements')} />}
      </div>
      <div className="pm-totals" data-testid="totals" aria-label={tx('pm.totals')}>
        <span className="pm-totals-l">{tx('pm.allTime')}</span>
        {d ? [['totalRevenueCents', 'pos.total_revenue'], ['totalCollectedCents', 'pos.total_collected'], ['totalRefundsCents', 'pos.total_refunds'], ['outstandingBalanceCents', 'pos.outstanding_balance'], ['totalTipsCents', 'pos.total_tips'], ['totalPayoutsCents', 'pos.total_payouts']].map(([f, l]) =>
          <div key={f} className="pm-total" data-testid={'total-' + f} title={f === 'outstandingBalanceCents' ? tx('pm.asOfNow') : f === 'totalPayoutsCents' ? tx('pm.payoutsDef') : tx('pm.allTimeDef')}><span>{tx(l)}{f === 'outstandingBalanceCents' ? ' · ' + tx('pm.now') : ''}</span><b>{fmtMoney(d.totals[f])}</b></div>) : null}
      </div>
      <nav className="pm-quick" aria-label={tx('pos.quick_actions_2')} data-testid="quick-actions">
        {quick.map((a) => <button key={a.k} type="button" className="fk-btn pm-qa" onClick={() => nav(a.to)} disabled={!can(a.p)} title={can(a.p) ? undefined : tx('pm.noRole')} data-testid={'qa-' + a.k}>{a.l}</button>)}
      </nav>
      {searchOpen && q.length >= 2 ? <SearchDialog q={q} pq={pq} onClose={() => setSearchOpen(false)} onTx={(id) => setDetail(id)} onInvoice={() => nav('/tenant/payments/invoices')} onPayout={() => { setSearchOpen(false); setSpace('payouts'); }} /> : null}
      {detail ? <TxDialog id={detail} tick={tick} onClose={() => setDetail(null)} onChanged={() => setTick((t) => t + 1)} onNote={setNote}
        onCustomer={(cid) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(cid)}`)} onGo={(p) => nav(p)} /> : null}
    </div>
  );
}

/** Bars per bucket (revenue gold, collections outline); a bar opens that day's transactions. An accessible table rides along. */
function Trend({ trend, onDay, tall }: { trend: any; onDay?: (start: string) => void; tall?: boolean }) {
  const pts: any[] = trend?.points ?? [];
  if (!pts.length) return <Empty title={tx('pos.no_revenue_yet')} />;
  const max = Math.max(1, ...pts.map((p) => Math.max(p.revenueCents, p.collectionsCents)));
  const step = Math.max(1, Math.ceil(pts.length / (tall ? 16 : 10)));
  return (
    <div className={'pm-trend' + (tall ? ' tall' : '')}>
      <div className="pm-bars" role="img" aria-label={tx('pm.trendAria', { n: fmtNumber(pts.length) })}>
        {pts.map((p, i) => <button key={p.start} type="button" className="pm-bar" onClick={trend.bucket === 'day' && onDay ? () => onDay(p.start) : undefined} disabled={trend.bucket !== 'day' || !onDay}
          title={tx('pm.barTitle', { d: p.label, r: fmtMoney(p.revenueCents), c: fmtMoney(p.collectionsCents) })} data-testid="trend-bar">
          <span className="c" style={{ height: `${Math.round((p.collectionsCents / max) * 100)}%` }} /><span className="r" style={{ height: `${Math.round((p.revenueCents / max) * 100)}%` }} />
          <i>{i % step === 0 ? p.label : ''}</i></button>)}
      </div>
      <div className="pm-legend"><span><i className="r" />{tx('pm.kpi.revenue')}</span><span><i className="c" />{tx('pm.kpi.collections')}</span><span className="fk-hint">{tx('pm.bucket.' + trend.bucket)}</span></div>
      <table className="sr-only"><caption>{tx('pm.trendTable')}</caption><thead><tr><th>{tx('pm.col.date')}</th><th>{tx('pm.kpi.revenue')}</th><th>{tx('pm.kpi.collections')}</th></tr></thead><tbody>{pts.map((p) => <tr key={p.start}><td>{p.label}</td><td>{fmtMoney(p.revenueCents)}</td><td>{fmtMoney(p.collectionsCents)}</td></tr>)}</tbody></table>
    </div>
  );
}
function Methods({ m }: { m: any }) {
  const rows: any[] = m?.methods ?? [];
  if (!rows.length) return <Empty title={tx('pos.no_payments_captured_yet')} />;
  return <ul className="mo-bars pm-methods" data-testid="methods">{rows.map((r) => <li key={r.method}><span className="mo-bar-l">{methodLbl(r.method)} <span className="fk-muted">· {fmtNumber(r.count)}</span></span><span className="mo-bar"><span style={{ width: `${r.percent}%`, background: PALETTE[r.method] ?? '#B0A0C8' }} /></span><b>{fmtMoney(r.amountCents)}</b><span className="mo-pct">{fmtNumber(r.percent, 1)}%</span></li>)}</ul>;
}
function Health({ h, compact }: { h: any; compact?: boolean }) {
  const tone = h.status === 'healthy' ? 'ok' : h.status === 'attention' ? 'warn' : 'mut';
  return (
    <div className="pm-health" data-testid="health">
      <div className="fn-statusline"><span className={'fk-chip ' + tone} data-testid="health-status">{tx('pm.health.' + h.status)}</span>{h.reasons.map((r: string) => <span key={r} className="fk-chip mut">{tx('pm.reason.' + r)}</span>)}</div>
      <dl className="fk-dl">
        <dt>{tx('pm.h.success')}</dt><dd><b>{pct(h.successRatePercent)}</b> <span className="fk-li-s">{tx('pm.h.successDef', { s: fmtNumber(h.successful), f: fmtNumber(h.failed) })}</span></dd>
        <dt>{tx('pm.h.unresolved')}</dt><dd>{fmtNumber(h.unresolved)}</dd>
        <dt>{tx('pm.h.chargebacks')}</dt><dd>{fmtNumber(h.chargebacks)}{h.chargebackCents ? ' · ' + fmtMoney(h.chargebackCents) : ''}</dd>
        {!compact ? <><dt>{tx('pm.h.refundRate')}</dt><dd>{pct(h.refundRatePercent)} <span className="fk-li-s">{tx('pm.h.refundDef')}</span></dd>
          <dt>{tx('pm.h.collectionRate')}</dt><dd>{pct(h.collectionRatePercent)} <span className="fk-li-s">{tx('pm.h.collectionDef')}</span></dd>
          <dt>{tx('pm.h.freshPay')}</dt><dd>{when(h.latestPaymentAt)}</dd><dt>{tx('pm.h.freshSettle')}</dt><dd>{when(h.latestSettlementAt)}</dd></> : null}
      </dl>
    </div>
  );
}

function OverviewSpace({ d, onDay, onTx, onAll, onPayouts }: { d: any; onDay: (s: string) => void; onTx: (id: string) => void; onAll: () => void; onPayouts: () => void }) {
  return (
    <div className="pm-grid four">
      <FitPanel testId="panel-trend" title={tx('pos.revenue_overview')}><Trend trend={d.revenueTrend} onDay={onDay} /></FitPanel>
      <FitPanel testId="panel-methods" title={<span>{tx('pos.payment_methods_breakdown')} <span className="fk-hint">{tx('pm.methodsBase')}</span></span>}><Methods m={d.paymentMethods} /></FitPanel>
      <FitPanel testId="panel-recent" title={tx('pm.recent')} actions={<button type="button" className="fk-link" onClick={onAll}>{tx('pm.viewAll')}</button>}>
        {d.recentTransactions.length === 0 ? <Empty title={tx('pos.no_transactions_in_this_period')} /> :
          <ul className="pm-recent" data-testid="recent">{d.recentTransactions.map((r: any) => <li key={r.id}><button type="button" className="pm-rec" onClick={() => onTx(r.id)} data-testid="recent-row">
            <span><b>{r.customer ?? tx('rv.walkIn')}</b><span className="fk-li-s">{r.ticketNumber ? tx('txn.ticketN', { n: r.ticketNumber }) + ' · ' : ''}{methodLbl(r.method)} · {when(r.at)}</span></span>
            <span className="pm-rec-r"><b>{fmtMoney(r.amountCents)}</b><span className={'fk-chip ' + (STATE_TONE[r.state] ?? 'mut')}>{stateLbl(r.state)}</span></span></button></li>)}</ul>}
      </FitPanel>
      <FitPanel testId="panel-health" title={tx('pm.healthTitle')} actions={<button type="button" className="fk-link" onClick={onPayouts}>{tx('pm.space.payouts')}</button>}>
        <Health h={d.health} compact />
        <div className="pm-up"><span className="fk-li-s">{tx('pm.upcoming')}</span>{d.upcomingPayouts.items.length ? <b>{d.upcomingPayouts.items.slice(0, 2).map((p: any) => `${fmtMoney(p.netCents)} · ${p.expectedDate ?? '—'}`).join(' · ')}</b> : <span className="fk-muted">{tx('pm.noPayouts')}</span>}</div>
      </FitPanel>
    </div>
  );
}

function TransactionsSpace({ pq, kind, setKind, page, setPage, tick, onTx, onAll }: { pq: any; kind: string; setKind: (k: string) => void; page: number; setPage: (p: number) => void; tick: number; onTx: (id: string) => void; onAll: () => void }) {
  const fit = useFitRows<HTMLDivElement>(44, { min: 3, max: 14, reserve: 34 });
  const l = useLoad(() => posTransactionsApi.list({ ...pq, kind: kind || undefined, page, pageSize: fit.rows }), [JSON.stringify(pq), kind, page, fit.rows, tick]);
  const rows: any[] = l.data?.items ?? [];
  return (
    <FitPanel testId="panel-transactions" bodyRef={fit.ref} className="fn-records"
      title={<div className="fk-seg fn-tabs pm-kinds" role="tablist" aria-label={tx('pm.txFilters')}>{KINDS.map((x) => <button key={x || 'all'} type="button" role="tab" aria-selected={kind === x} className={kind === x ? 'on' : ''} onClick={() => setKind(x)} data-testid={'kind-' + (x || 'all')}>{tx(KIND_KEY[x])}</button>)}</div>}
      actions={<button type="button" className="fk-link" onClick={onAll} data-testid="open-transactions">{tx('pm.openTransactions')}</button>}
      footer={<Pager info={l.data ? { page: l.data.page, pageSize: l.data.pageSize, totalItems: l.data.total, totalPages: l.data.pageCount } : null} onPage={setPage} label={tx('pm.space.transactions')} />}>
      {l.error ? <StateBlock error={l.error} onRetry={l.reload} /> : !l.data ? <div className="fk-loading">{tx('pos.loading')}</div> : rows.length === 0 ? <Empty title={tx('pos.no_transactions_in_this_period')}><span className="fk-hint">{tx('pm.adjustDates')}</span></Empty> :
        <table className="fk-table fn-table" data-testid="tx-table"><thead><tr><th>{tx('txn.col.paidAt')}</th><th>{tx('txn.col.customer')}</th><th>{tx('txn.col.ref')}</th><th>{tx('txn.col.method')}</th><th className="num">{tx('txn.col.amount')}</th><th>{tx('finance.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} data-testid="tx-row"><td>{when(r.paidAt ?? r.createdAt)}</td><td>{r.customer?.name ?? tx('rv.walkIn')}{r.customer?.phone ? <span className="fk-li-s">{r.customer.phone}</span> : null}</td>
            <td>{r.ticketNumber ? tx('txn.ticketN', { n: r.ticketNumber }) : tx('rv.notLinked')}</td><td>{methodLbl(r.method)}</td><td className="num"><b>{fmtMoney(r.grossCents)}</b>{r.refundedCents ? <span className="fk-li-s">−{fmtMoney(r.refundedCents)}</span> : null}</td>
            <td><span className={'fk-chip ' + (STATE_TONE[r.state] ?? 'mut')}>{stateLbl(r.state)}</span></td><td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => onTx(r.id)} data-testid="tx-view">{tx('finance.view')}</button></td></tr>)}</tbody></table>}
    </FitPanel>
  );
}

function RevenueSpace({ d, pq, onDay }: { d: any; pq: any; onDay: (s: string) => void }) {
  const [page, setPage] = useState(1); const [s, setS] = useState(''); const sq = useDebounced(s.trim(), 300);
  const pqKey = JSON.stringify(pq);
  useEffect(() => { setPage(1); }, [sq, pqKey]);
  const fit = useFitRows<HTMLDivElement>(40, { min: 3, max: 14, reserve: 34 });
  const l = useLoad(() => posMoneyOverviewApi.services({ ...pq, search: sq || undefined, page, pageSize: fit.rows }), [JSON.stringify(pq), sq, page, fit.rows]);
  const items: any[] = l.data?.items ?? []; const top = Math.max(1, ...items.map((x) => x.revenueCents));
  return (
    <div className="pm-grid two">
      <FitPanel testId="panel-trend-wide" title={<span>{tx('pos.revenue_overview')} <span className="fk-hint">{fmtMoney(d.kpis.revenueCents)} · {fmtMoney(d.kpis.collectionsCents)}</span></span>}><Trend trend={d.revenueTrend} onDay={onDay} tall /></FitPanel>
      <FitPanel testId="panel-services" bodyRef={fit.ref} title={<span>{tx('pos.top_services_by_revenue')} <span className="fk-hint">{tx('pm.servicesBase')}</span></span>}
        actions={<div className="fn-search"><input className="fk-search" type="search" value={s} onChange={(e) => setS(e.target.value)} placeholder={tx('pm.servicesPh')} aria-label={tx('pm.servicesPh')} data-testid="services-search" /></div>}
        footer={<Pager info={l.data ? { page: l.data.page, pageSize: l.data.pageSize, totalItems: l.data.total, totalPages: l.data.pageCount } : null} onPage={setPage} compact label={tx('pos.top_services_by_revenue')} />}>
        {l.error ? <StateBlock error={l.error} onRetry={l.reload} /> : !l.data ? <div className="fk-loading">{tx('pos.loading')}</div> : items.length === 0 ? <Empty title={tx('pos.no_paid_services_yet')} /> :
          <ul className="mo-top pm-top" data-testid="services">{items.map((x, i) => <li key={x.name + i} data-testid="service-row"><span className="mo-rank">{(l.data.page - 1) * l.data.pageSize + i + 1}</span><span className="mo-top-n">{x.name}<span className="mo-bar"><span style={{ width: `${Math.round((x.revenueCents / top) * 100)}%`, background: '#C89B5A' }} /></span></span><span className="fk-muted">×{fmtNumber(x.count)}</span><b>{fmtMoney(x.revenueCents)}</b></li>)}</ul>}
      </FitPanel>
    </div>
  );
}

function PayoutsSpace({ d, onReconcile, onSettlements }: { d: any; onReconcile: () => void; onSettlements: () => void }) {
  const [status, setStatus] = useState('pending'); const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [status]);
  const fit = useFitRows<HTMLDivElement>(44, { min: 3, max: 12, reserve: 34 });
  const l = useLoad(() => posMoneyOverviewApi.payouts({ status, page, pageSize: fit.rows }), [status, page, fit.rows]);
  const items: any[] = l.data?.items ?? [];
  return (
    <div className="pm-grid two">
      <FitPanel testId="panel-payouts" bodyRef={fit.ref} className="fn-records"
        title={<div className="fk-seg fn-tabs" role="tablist" aria-label={tx('pm.payoutStatus')}>{['pending', 'paid', 'all'].map((x) => <button key={x} type="button" role="tab" aria-selected={status === x} className={status === x ? 'on' : ''} onClick={() => setStatus(x)} data-testid={'payout-' + x}>{tx('pm.payout.' + x)}</button>)}</div>}
        actions={<><button type="button" className="fk-link" onClick={onSettlements}>{tx('pm.openSettlements')}</button><button type="button" className="fk-link" onClick={onReconcile}>{tx('pos.reconcile')}</button></>}
        footer={<Pager info={l.data ? { page: l.data.page, pageSize: l.data.pageSize, totalItems: l.data.total, totalPages: l.data.pageCount } : null} onPage={setPage} compact label={tx('pm.upcoming')} />}>
        {l.error ? <StateBlock error={l.error} onRetry={l.reload} /> : !l.data ? <div className="fk-loading">{tx('pos.loading')}</div> : items.length === 0 ? <Empty title={status === 'pending' ? tx('pm.noPayouts') : tx('pm.noPayoutHistory')} /> :
          <table className="fk-table fn-table" data-testid="payouts-table"><thead><tr><th>{tx('pm.col.payout')}</th><th>{tx('rv.f.processor')}</th><th className="num">{tx('pm.col.net')}</th><th>{tx('pm.col.expected')}</th><th>{tx('pm.col.destination')}</th><th>{tx('finance.status')}</th><th>{tx('pm.col.bank')}</th></tr></thead>
            <tbody>{items.map((p) => <tr key={p.id} data-testid="payout-row"><td className="fn-mono">{p.reference ?? p.id.slice(-8)}</td><td>{p.processor ?? '—'}</td><td className="num"><b>{fmtMoney(p.netCents)}</b>{p.feeCents ? <span className="fk-li-s">{tx('pm.fee', { f: fmtMoney(p.feeCents) })}</span> : null}</td>
              <td>{p.expectedDate ?? '—'}</td><td>{p.destination ?? tx('txn.notAvailable')}</td><td><span className={'fk-chip ' + (p.status === 'pending' ? 'info' : p.status === 'failed' || p.status === 'returned' ? 'bad' : 'ok')}>{codeLabel('rv.settle.' + p.status, p.status)}</span></td>
              <td>{p.bank === 'deposit_recorded' ? <span className="fk-chip ok">{tx('pm.bank.recorded', { d: p.depositedDate ?? '' })}</span> : <span className="fk-chip mut">{tx('pm.bank.notConfirmed')}</span>}</td></tr>)}</tbody></table>}
      </FitPanel>
      <FitPanel testId="panel-health-wide" title={tx('pm.healthTitle')}><Health h={d.health} /><div className="fk-hint">{tx('pm.healthNote')}</div></FitPanel>
    </div>
  );
}

/** The universal search: typed results (payments · invoices · payouts), newest first, each opening its own record. */
function SearchDialog({ q, pq, onClose, onTx, onInvoice, onPayout }: { q: string; pq: any; onClose: () => void; onTx: (id: string) => void; onInvoice: () => void; onPayout: () => void }) {
  const r = useLoad(() => posMoneyOverviewApi.search({ ...pq, search: q }), [q, JSON.stringify(pq)]);
  const d = r.data;
  return (
    <FitDialog wide title={tx('pm.searchTitle', { q })} subtitle={d ? periodText(d.period) : undefined} onClose={onClose} testId="search-dialog" footer={<button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button>}>
      {r.error ? <StateBlock error={r.error} onRetry={r.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <h3 className="fk-h3">{tx('pm.res.payments')} <span className="fk-muted">· {fmtNumber(d.payments.total)}</span></h3>
        {d.payments.items.length === 0 ? <div className="fk-hint">{tx('pm.res.none')}</div> : <ul className="pm-recent" data-testid="search-payments">{d.payments.items.map((x: any) => <li key={x.id}><button type="button" className="pm-rec" onClick={() => onTx(x.id)} data-testid="search-payment">
          <span><b>{x.customer?.name ?? tx('rv.walkIn')}</b><span className="fk-li-s">{x.customer?.phone ? x.customer.phone + ' · ' : ''}{x.ticketNumber ? tx('txn.ticketN', { n: x.ticketNumber }) + ' · ' : ''}{methodLbl(x.method)} · {when(x.at)}</span></span>
          <span className="pm-rec-r"><b>{fmtMoney(x.amountCents)}</b><span className={'fk-chip ' + (STATE_TONE[x.state] ?? 'mut')}>{stateLbl(x.state)}</span></span></button></li>)}</ul>}
        <h3 className="fk-h3">{tx('pm.res.invoices')}</h3>
        {d.invoices.length === 0 ? <div className="fk-hint">{tx('pm.res.none')}</div> : <ul className="pm-recent" data-testid="search-invoices">{d.invoices.map((x: any) => <li key={x.id}><button type="button" className="pm-rec" onClick={onInvoice}><span><b>{x.number}</b><span className="fk-li-s">{x.customer ?? '—'} · {when(x.at)}</span></span><span className="pm-rec-r"><b>{fmtMoney(x.amountCents)}</b><span className="fk-chip mut">{codeLabel('pm.inv.' + x.state, x.state)}</span></span></button></li>)}</ul>}
        <h3 className="fk-h3">{tx('pm.res.payouts')}</h3>
        {d.payouts.length === 0 ? <div className="fk-hint">{tx('pm.res.none')}</div> : <ul className="pm-recent" data-testid="search-payouts">{d.payouts.map((x: any) => <li key={x.id}><button type="button" className="pm-rec" onClick={onPayout}><span><b>{x.reference ?? x.id.slice(-8)}</b><span className="fk-li-s">{x.processor ?? '—'} · {when(x.at)}</span></span><span className="pm-rec-r"><b>{fmtMoney(x.amountCents)}</b><span className="fk-chip mut">{codeLabel('rv.settle.' + x.state, x.state)}</span></span></button></li>)}</ul>}
      </>}
    </FitDialog>
  );
}
