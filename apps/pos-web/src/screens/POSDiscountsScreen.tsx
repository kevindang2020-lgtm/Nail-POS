// POSDiscountsScreen.tsx — Services → Discounts (/tenant/services/discounts). Discounts Management rebuild (Oct 29 2026):
// the front-desk visibility, lookup and performance layer over the ONE coupon engine; Marketing → Promotions stays the rule
// editor (Manage in Promotions). The content pane scrolls vertically only when it must (never sideways).
//   header (Refresh · Export · Manage in Promotions) · the five cards (Active Discounts · Percent-Off · Fixed-Amount ·
//   Redemptions · Expiring Soon — each states its scope and filters the list) · the coupon explanation · ONE search box +
//   Today / Week / Month / Year / Custom (month calendar) with the date field it filters · tabs Discounts | Redemption
//   History | Performance, each its own server-paged, newest-first numbered list · Discount Details (overview, eligibility,
//   validity & limits, applicable items, redemptions, audit history).
// Live & Scheduled Discounts keeps its seven columns (Code · Discount · On a $100 Ticket · Min Purchase · Valid · Usage ·
// Status) — codes masked (only the last four exist), the $100 figure marked illustrative. A historical period never changes
// a current-state card. Every number is the server's (/pos/discounts/*, tenant-scoped, integer cents, the salon's days).
import { useEffect, useState } from 'react';
import { SystemCheckButton } from '../components/SystemCheck';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posDiscountsApi } from '../api/posDiscountsApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced, type PageInfo } from '../components/FitKit';
import { ExportPreview } from '../components/ExportPreview';
import { savingsExplain, type SavingsRule } from './deals/savingsExplain';
import { exposure } from './deals/exposure';
import { PeriodBar, periodQuery, periodText, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';

type Tab = 'discounts' | 'redemptions' | 'performance';
const TABS: Tab[] = ['discounts', 'redemptions', 'performance'];
const STATUSES = ['live', 'active', 'scheduled', 'paused', 'draft', 'expired', 'exhausted', 'archived', 'all'];
const DATE_FIELDS = ['created', 'starts', 'ends', 'updated'];
const STATES = ['confirmed', 'pending', 'released', 'reversed', 'all'];
const PAGE = 10;
const PERIOD0: Record<Tab, PeriodState> = { discounts: { preset: 'all' }, redemptions: { preset: 'all' }, performance: { preset: 'month' } };
export const TONE: Record<string, string> = { active: 'ok', scheduled: 'info', paused: 'warn', draft: 'mut', expired: 'mut', exhausted: 'bad', archived: 'mut', redeemed: 'ok', partially_reversed: 'warn', applied: 'info', released: 'mut', reversed: 'bad' };

const nf = (n: number) => fmtNumber(n || 0);
const day = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
export const whenTime = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
export const life = (s: string) => tx('dsc.life.' + s);
const state = (s: string) => codeLabel('dsc.state.' + s, s);
export const pageOf = (d: any): PageInfo | null => (d ? { page: d.page, pageSize: d.pageSize, totalItems: d.totalItems, totalPages: d.totalPages } : null);
export const discountLabel = (p: any) => (p.discountType === 'percent' ? tx('pos.v0_off_2', { v0: String(p.discountPercent ?? 0) }) : tx('pos.v0_off', { v0: fmtMoney(p.discountCents ?? 0) }));
const validLabel = (p: any) => {
  const s = p.startsAt ? day(p.startsAt) : null; const e = p.endsAt ? day(p.endsAt) : null;
  if (s && e) return `${s} – ${e}`; if (e) return tx('pos.until_e', { e }); if (s) return tx('pos.from_s', { s }); return tx('pos.no_end_date');
};
export const usageLabel = (p: any) => (p.maxRedemptions == null ? tx('dsc.usage.unlimited', { n: nf(p.used) }) : tx('dsc.usage.capped', { n: nf(p.used), max: nf(p.maxRedemptions), left: nf(p.remaining ?? 0) }));
const ymdPlus = (ymd: string, days: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const saveCsv = (name: string, text: string) => { const blob = new Blob([String(text)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); };

export function POSDiscountsScreen() {
  const nav = useNavigate(); const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'discounts';
  const setTab = (t: Tab) => { const p = new URLSearchParams(params); if (t === 'discounts') p.delete('tab'); else p.set('tab', t); setParams(p, { replace: true }); };
  const canManage = can('pos.marketing.manage') || can('marketing.manage');   // catalog key or its route alias (Oct 30 2026: owners saw no Export)
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [periods, setPeriods] = useState<Record<Tab, PeriodState>>(PERIOD0);
  const period = periods[tab]; const setPeriod = (p: PeriodState) => setPeriods((x) => ({ ...x, [tab]: p }));
  const [status, setStatus] = useState('live'); const [type, setType] = useState('all'); const [dateField, setDateField] = useState('created'); const [redState, setRedState] = useState('confirmed');
  const [pages, setPages] = useState<Record<Tab, number>>({ discounts: 1, redemptions: 1, performance: 1 });
  const setPg = (t: Tab) => (n: number) => setPages((x) => ({ ...x, [t]: n }));
  const [tick, setTick] = useState(0);
  const [detail, setDetailState] = useState<{ id: string; tab?: DTab } | null>(null);
  const setDetail = (id: string | null, tab?: DTab) => setDetailState(id ? { id, tab } : null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const listScope = { q: q || undefined, status, type, dateField, ...periodQuery(periods.discounts) };
  const redScope = { q: q || undefined, state: redState, ...periodQuery(periods.redemptions) };
  const perfScope = { q: q || undefined, ...periodQuery(periods.performance) };
  const keys = { discounts: JSON.stringify(listScope), redemptions: JSON.stringify(redScope), performance: JSON.stringify(perfScope) };
  useEffect(() => setPg('discounts')(1), [keys.discounts]);    
  useEffect(() => setPg('redemptions')(1), [keys.redemptions]);    
  useEffect(() => setPg('performance')(1), [keys.performance]);    

  const kpis = useLoad(() => posDiscountsApi.kpis(), [tick]);
  const list = useLoad(() => (tab === 'discounts' ? posDiscountsApi.list({ ...listScope, page: pages.discounts, pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.discounts, pages.discounts, tick]);
  const reds = useLoad(() => (tab === 'redemptions' ? posDiscountsApi.redemptions({ ...redScope, page: pages.redemptions, pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.redemptions, pages.redemptions, tick]);
  const perf = useLoad(() => (tab === 'performance' ? posDiscountsApi.performance({ ...perfScope, page: pages.performance, pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.performance, pages.performance, tick]);
  const served = [['discounts', list.data], ['redemptions', reds.data], ['performance', perf.data]] as const;
  useEffect(() => { for (const [k, d] of served) { const p = (d as { page?: number } | null)?.page; if (p && p !== pages[k]) setPg(k)(p); } }, [list.data, reds.data, perf.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const k = kpis.data;
  const filtered = !!(q || (tab === 'discounts' && (status !== 'live' || type !== 'all' || period.preset !== 'all')) || (tab === 'redemptions' && (redState !== 'confirmed' || period.preset !== 'all')) || (tab === 'performance' && period.preset !== 'month'));
  const clearAll = () => { setSearch(''); setPeriods(PERIOD0); setStatus('live'); setType('all'); setDateField('created'); setRedState('confirmed'); };
  const showList = (s: string, t = 'all') => { setStatus(s); setType(t); setPeriods((x) => ({ ...x, discounts: { preset: 'all' } })); setTab('discounts'); };
  const serverPeriod = tab === 'discounts' ? list.data?.period : tab === 'redemptions' ? reds.data?.period : perf.data?.period;
  const basis = tab === 'discounts' ? { basis: dateField, basisOptions: DATE_FIELDS.map((f) => ({ value: f, label: tx('dsc.df.' + f) })), onBasis: setDateField }
    : { basis: 'redeemed', basisOptions: [{ value: 'redeemed', label: tx('dsc.df.redeemed') }], onBasis: () => undefined };
  const count = (d: any) => (d ? <span className="fk-muted"> · {tx('dsc.matching', { n: nf(d.totalItems) })}</span> : null);
  const noRows = (what: string, action?: React.ReactNode) => (filtered ? <Empty title={q ? tx('dsc.noMatchSearch', { q }) : tx('dsc.noMatch')}><button type="button" className="fk-btn" onClick={clearAll} data-testid="empty-clear">{tx('finance.clearFilters')}</button></Empty> : <Empty title={what}>{action}</Empty>);
  const promotions = () => nav('/tenant/marketing/promotions');
  const [previewExport, setPreviewExport] = useState(false);
  const doExport = async () => {
    setExporting(true); setNote(null); setPreviewExport(false);
    try {
      if (tab === 'redemptions') saveCsv('discount-redemptions.csv', await posDiscountsApi.exportRedemptions(redScope));
      else saveCsv('discounts.csv', await posDiscountsApi.exportList(listScope));
      setNote({ tone: 'ok', text: tx('finance.exported') });
    } catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('finance.state.loadFailed')) }); } finally { setExporting(false); }
  };

  if (isForbidden(kpis.error)) return <div className="work dsc" data-testid="discounts-screen"><h1>{tx('pos.discounts')}</h1><StateBlock error={kpis.error} onRetry={kpis.reload} /></div>;
  return (
    <div className="work dsc" data-testid="discounts-screen">
      {previewExport ? <ExportPreview title={tx('dsc.export.' + tab)} busy={exporting}
        count={tab === 'redemptions' ? reds.data?.totalItems : list.data?.totalItems} period={periodText(serverPeriod)}
        filters={[...(q ? [`“${q}”`] : []), ...(tab === 'discounts' ? [tx('dsc.status.' + status), tx('dsc.type.' + type)] : [tx('dsc.rstate.' + redState)])]}
        onConfirm={doExport} onCancel={() => setPreviewExport(false)} /> : null}
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.discounts')}</h1><div className="sub">{tx('pos.discount_rules_currently_live_across_your_1yi3')}</div></div>
        <div className="fk-head-actions">
          <SystemCheckButton domain="discounts" />
          <button type="button" className="fk-btn" onClick={() => setTick((n) => n + 1)} data-testid="refresh">{tx('finance.refresh')}</button>
          {canManage && tab !== 'performance' ? <button type="button" className="fk-btn ghost" onClick={() => setPreviewExport(true)} disabled={exporting} data-testid="export">{exporting ? tx('pos.loading') : tx('dsc.export.' + tab)}</button> : null}
          <button type="button" className="fk-btn primary" onClick={promotions} data-testid="manage-promotions">{tx('pos.manage_in_promotions')}</button>
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <div className="fk-kpis five dsc-kpis" data-testid="kpis">
        {kpis.error ? <StateBlock error={kpis.error} onRetry={kpis.reload} /> : <>
          <KpiCard testId="kpi-active" tone="ok" label={tx('pos.active_discounts')} loading={!k} value={k ? nf(k.activeDiscounts) : ''} sub={k ? tx('dsc.kpi.activeSub', { s: nf(k.split.scheduled), p: nf(k.split.paused) }) : ''} onClick={() => showList('active')} />
          <KpiCard testId="kpi-percent" label={tx('pos.percent_off_2')} loading={!k} value={k ? nf(k.percentOff) : ''} sub={tx('dsc.kpi.liveScope')} onClick={() => showList('live', 'percent')} />
          <KpiCard testId="kpi-fixed" label={tx('pos.fixed_amount')} loading={!k} value={k ? nf(k.fixedAmount) : ''} sub={tx('dsc.kpi.liveScope')} onClick={() => showList('live', 'fixed')} />
          <KpiCard testId="kpi-redemptions" tone="gold" label={tx('pos.redemptions')} loading={!k} value={k ? nf(k.redemptions) : ''} sub={k ? (k.redemptions !== k.ledger.confirmedEvents ? tx('dsc.kpi.redLedger', { n: nf(k.ledger.confirmedEvents) }) : tx('dsc.kpi.redSub', { c: nf(k.ledger.uniqueCustomers), v: fmtMoney(k.ledger.savingsCents) })) : ''}
            onClick={() => { setRedState('confirmed'); setPeriods((x) => ({ ...x, redemptions: { preset: 'all' } })); setTab('redemptions'); }} />
          <KpiCard testId="kpi-expiring" tone={k && k.expiringSoon > 0 ? 'warn' : undefined} label={tx('pos.expiring_soon')} loading={!k} value={k ? nf(k.expiringSoon) : ''} sub={k ? tx('dsc.kpi.expSub', { n: nf(k.expiringWindowDays) }) : ''}
            onClick={() => { const today = list.data?.period?.today ?? k?.today ?? deviceToday(); setStatus('live'); setType('all'); setDateField('ends'); setPeriods((x) => ({ ...x, discounts: { preset: 'custom', from: today, to: ymdPlus(today, k?.expiringWindowDays ?? 7) } })); setTab('discounts'); }} />
        </>}
      </div>
      <div className="dsc-explain fk-hint" data-testid="explain">{tx('pos.discounts_are_managed_as_coupon_codes_w1qz')}{k && k.ledger.pendingAtCheckout ? ` ${tx('dsc.pendingNote', { n: nf(k.ledger.pendingAtCheckout) })}` : ''}</div>

      <div className="dsc-tools" data-testid="toolbar">
        <div className="fn-search dsc-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('dsc.searchPh')} aria-label={tx('dsc.searchPh')} data-testid="search"
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        {tab === 'discounts' ? <>
          <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status')} data-testid="status">{STATUSES.map((s) => <option key={s} value={s}>{tx('dsc.status.' + s)}</option>)}</select>
          <select className="fk-select" value={type} onChange={(e) => setType(e.target.value)} aria-label={tx('dsc.type')} data-testid="type">{['all', 'percent', 'fixed'].map((s) => <option key={s} value={s}>{tx('dsc.type.' + s)}</option>)}</select>
        </> : tab === 'redemptions' ? (
          <select className="fk-select" value={redState} onChange={(e) => setRedState(e.target.value)} aria-label={tx('pos.status')} data-testid="red-state">{STATES.map((s) => <option key={s} value={s}>{tx('dsc.rstate.' + s)}</option>)}</select>
        ) : null}
      </div>
      <div className="fn-tabsrow dsc-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={serverPeriod} allowAll compact {...basis} />
        {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div>

      <div className="inv2-tabs dsc-tabs">
        <div className="fk-seg inv2-tabseg" role="tablist" aria-label={tx('dsc.tabs')}>
          {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'tab-' + t}>{tx('dsc.tab.' + t)}</button>)}
        </div>
      </div>

      {tab === 'discounts' ? (
        <FitPanel testId="discounts-list" title={<>{status === 'live' ? tx('pos.live_scheduled_discounts') : tx('dsc.status.' + status)}{count(list.data)}<span className="fk-hint dsc-hint">{period.preset !== 'all' ? tx('dsc.dateShown', { f: tx('dsc.df.' + dateField) }) : tx('dsc.sampleNote')}</span></>}
          footer={<Pager info={pageOf(list.data)} onPage={setPg('discounts')} label={tx('pos.live_scheduled_discounts')} />}>
          {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading_discounts')}</div>
            : list.data.items.length === 0 ? noRows(tx('dsc.noDiscounts'), <button type="button" className="fk-btn primary" onClick={promotions}>{tx('pos.manage_in_promotions')}</button>)
            : <table className="fk-table fn-table dsc-table" data-testid="discounts-table">
              <thead><tr><th>{tx('pos.code')}</th><th>{tx('pos.discount_2')}</th><th className="num">{tx('pos.on_a_100_ticket')}</th><th className="num">{tx('pos.min_purchase')}</th><th>{tx('pos.valid')}</th><th>{tx('pos.usage')}</th><th>{tx('pos.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
              <tbody>{list.data.items.map((p: any) => (
                <tr key={p.id} data-testid="discount-row" className="inv2-click" onClick={() => setDetail(p.id)}>
                  <td><button type="button" className="fk-li-t link dsc-code" onClick={(e) => { e.stopPropagation(); setDetail(p.id); }} data-testid="discount-code">{p.code ?? tx('dsc.noCode')}</button><span className="fk-li-s">{p.name}{p.matchedVia ? ` · ${tx('dsc.via.' + p.matchedVia)}` : ''}</span></td>
                  <td className="dsc-value">{discountLabel(p)}{p.maxDiscountCents ? <span className="fk-li-s">{tx('dsc.capAt', { v: fmtMoney(p.maxDiscountCents) })}</span> : null}</td>
                  <td className="num">{p.sampleSavingsCents > 0 ? `−${fmtMoney(p.sampleSavingsCents)}` : <span className="fk-muted" title={tx('dsc.sampleZero')}>—</span>}</td>
                  <td className="num">{p.minPurchaseCents > 0 ? fmtMoney(p.minPurchaseCents) : <span className="fk-muted">{tx('pos.none')}</span>}</td>
                  <td>{validLabel(p)}</td>
                  <td>{usageLabel(p)}</td>
                  <td><span className={'fk-chip ' + (TONE[p.lifecycle] ?? 'mut')} data-testid="status-chip">{life(p.lifecycle)}</span></td>
                  <td className="fn-acts" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="fk-btn ghost sm" onClick={() => setDetail(p.id)} data-testid="discount-details">{tx('dsc.details')}</button>
                    <button type="button" className="fk-btn ghost sm dsc-act2" onClick={() => setDetail(p.id, 'redemptions')} data-testid="discount-redemptions">{tx('dsc.redemptionsShort')}</button>
                  </td>
                </tr>))}</tbody>
            </table>}
        </FitPanel>
      ) : null}

      {tab === 'redemptions' ? <>
        {reds.data ? <div className="mos-totals" data-testid="red-totals">
          <div><span>{tx('dsc.tot.events')}</span><b>{nf(reds.data.totalItems)}</b></div>
          <div><span>{tx('dsc.tot.customers')}</span><b>{nf(reds.data.totals.uniqueCustomers)}</b></div>
          <div><span>{tx('dsc.tot.savings')}</span><b>{fmtMoney(reds.data.totals.savingsCents)}</b></div>
          <span className="fk-hint">{tx('dsc.tot.rule')}</span>
        </div> : null}
        <FitPanel testId="redemptions-list" title={<>{tx('dsc.tab.redemptions')}{count(reds.data)}</>} footer={<Pager info={pageOf(reds.data)} onPage={setPg('redemptions')} label={tx('dsc.tab.redemptions')} />}>
          {reds.error ? <StateBlock error={reds.error} onRetry={reds.reload} /> : !reds.data ? <div className="fk-loading">{tx('pos.loading')}</div> : reds.data.items.length === 0 ? noRows(tx('dsc.noRedemptions'))
            : <RedemptionsTable rows={reds.data.items} onCoupon={(dealId) => setDetail(dealId)} onCustomer={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)}
              onTicket={(tid, row) => nav(ticketRoute(row, tid))} />}
        </FitPanel>
      </> : null}

      {tab === 'performance' ? <>
        {perf.data ? <div className="mos-totals" data-testid="perf-totals">
          <div><span>{tx('dsc.tot.events')}</span><b>{nf(perf.data.totals.redemptions)}</b></div>
          <div><span>{tx('dsc.tot.customers')}</span><b>{nf(perf.data.totals.uniqueCustomers)}</b></div>
          <div><span>{tx('dsc.tot.savings')}</span><b>{fmtMoney(perf.data.totals.savingsCents)}</b></div>
          <span className="fk-hint">{tx('dsc.perfRule')}</span>
        </div> : null}
        <FitPanel testId="performance-list" title={<>{tx('dsc.tab.performance')}{count(perf.data)}</>} footer={<Pager info={pageOf(perf.data)} onPage={setPg('performance')} label={tx('dsc.tab.performance')} />}>
          {perf.error ? <StateBlock error={perf.error} onRetry={perf.reload} /> : !perf.data ? <div className="fk-loading">{tx('pos.loading')}</div> : perf.data.items.length === 0 ? noRows(tx('dsc.noDiscounts'))
            : <table className="fk-table fn-table dsc-table" data-testid="performance-table">
              <thead><tr><th>{tx('pos.code')}</th><th>{tx('pos.status')}</th><th className="num">{tx('pos.redemptions')}</th><th className="num">{tx('dsc.col.customers')}</th><th className="num">{tx('dsc.col.savings')}</th><th className="num t-opt">{tx('dsc.col.avg')}</th><th className="num t-opt">{tx('dsc.col.reversed')}</th><th>{tx('dsc.col.usesLeft')}</th><th className="num t-opt2">{tx('dsc.col.linkedSales')}</th></tr></thead>
              <tbody>{perf.data.items.map((p: any) => <tr key={p.id} className="inv2-click" onClick={() => setDetail(p.id)} data-testid="perf-row">
                <td><b className="dsc-code">{p.code ?? tx('dsc.noCode')}</b><span className="fk-li-s">{p.name} · {discountLabel(p)}</span></td>
                <td><span className={'fk-chip ' + (TONE[p.lifecycle] ?? 'mut')}>{life(p.lifecycle)}</span></td>
                <td className="num"><b>{nf(p.periodRedemptions)}</b></td><td className="num">{nf(p.periodCustomers)}</td><td className="num">{fmtMoney(p.periodSavingsCents)}</td>
                <td className="num t-opt">{p.avgDiscountCents == null ? '—' : fmtMoney(p.avgDiscountCents)}</td><td className="num t-opt">{nf(p.periodReversed)}</td>
                <td>{p.maxRedemptions == null ? tx('dsc.unlimited') : nf(p.remaining)}</td><td className="num t-opt2">{fmtMoney(p.linkedTicketSalesCents)}</td></tr>)}</tbody>
            </table>}
        </FitPanel>
      </> : null}

      {detail ? <DiscountDetailsDialog id={detail.id} initialTab={detail.tab} onClose={() => setDetail(null)} onPromotions={promotions} tick={tick}
        onCustomer={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)} onTicket={(tid, row) => nav(ticketRoute(row, tid))} /> : null}
    </div>
  );
}

/** Redemption → receipt (Promotions guide "View Receipt"; extras Nov 11 2026 on Discounts too): a paid ticket opens its
 *  receipt in Transactions, a code still on an unpaid ticket opens Checkout */
export const ticketRoute = (r: { ticketId: string; ticketNumber?: string | null; status?: string } | undefined, ticketId: string) =>
  (r && r.status !== 'applied' && r.ticketNumber ? `/tenant/payments/transactions?search=${encodeURIComponent(r.ticketNumber)}` : `/checkout?ticket=${encodeURIComponent(ticketId)}`);

export function RedemptionsTable({ rows, onCoupon, onCustomer, onTicket, compact = false, rule }: { rule?: SavingsRule; rows: any[]; onCoupon?: (dealId: string) => void; onCustomer?: (id: string, name: string) => void; onTicket?: (ticketId: string, row?: { ticketId: string; ticketNumber?: string | null; status?: string }) => void; compact?: boolean }) {
  return (
    <table className="fk-table fn-table dsc-table" data-testid="redemptions-table">
      <thead><tr><th>{tx('dsc.col.when')}</th><th>{tx('pos.customer')}</th>{compact ? null : <th>{tx('dsc.col.code')}</th>}<th>{tx('dsc.col.ticket')}</th><th className="num t-opt">{tx('dsc.col.subtotal')}</th><th className="num">{tx('dsc.col.discount')}</th><th className="num t-opt2">{tx('dsc.col.final')}</th><th>{tx('pos.status')}</th>{onCoupon ? <th aria-label={tx('finance.actions')} /> : null}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} data-testid="redemption-row">
        <td>{whenTime(r.at)}<span className="fk-li-s dsc-ref" title={r.id}>{r.id.slice(0, 8)}</span></td>
        <td>{r.customerId && onCustomer ? <button type="button" className="fk-li-t link" onClick={() => onCustomer(r.customerId, r.customerName ?? '')}>{r.customerName || '—'}</button> : <span>{r.customerName || tx('dsc.noCustomer')}</span>}{r.maskedPhone ? <span className="fk-li-s">{r.maskedPhone}</span> : null}</td>
        {compact ? null : <td><b className="dsc-code">{r.code ?? '—'}</b><span className="fk-li-s">{r.dealName}</span></td>}
        <td>{r.ticketNumber && r.ticketId && onTicket ? <button type="button" className="fk-li-t link" onClick={() => onTicket(r.ticketId, r)} data-testid="red-ticket">#{r.ticketNumber}</button> : r.ticketNumber ? '#' + r.ticketNumber : '—'}{r.technician ? <span className="fk-li-s">{r.technician}</span> : null}</td>
        <td className="num t-opt">{r.eligibleSubtotalCents == null ? '—' : fmtMoney(r.eligibleSubtotalCents)}</td>
        <td className="num"><b>−{fmtMoney(r.discountCents)}</b>{r.reversedCents ? <span className="fk-li-s">{tx('dsc.reversedAmt', { v: fmtMoney(r.reversedCents) })}</span> : null}{rule ? <SavingsWhy rule={rule} row={r} /> : null}<PreviewVsPaidWhy pvp={r.previewVsPaid} /></td>
        <td className="num t-opt2">{r.finalCents == null ? '—' : fmtMoney(r.finalCents)}</td>
        <td><span className={'fk-chip ' + (TONE[r.status] ?? 'mut')}>{state(r.status)}</span>{r.reversalReason ? <span className="fk-li-s">{codeLabel('dsc.reason.' + r.reversalReason, r.reversalReason)}</span> : null}</td>
        {onCoupon ? <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => onCoupon(r.dealId)} data-testid="red-coupon">{tx('dsc.viewCoupon')}</button></td> : null}
      </tr>)}</tbody>
    </table>
  );
}

/** Discount Exposure Meter: the most this promotion could still give away (an estimate / upper bound, exposure.ts) */
function ExposureRows({ x }: { x: any }) {
  const e = exposure({ discountType: x.discountType, discountCents: x.discountCents, maxDiscountCents: x.limits?.maxDiscountCents, maxRedemptions: x.limits?.maxRedemptions ?? x.maxRedemptions,
    remaining: x.remaining, used: x.used, budgetCents: x.limits?.budgetCents, savingsCents: x.usage?.savingsCents });
  const why = e.estimate != null ? tx(e.limitedBy === 'budget' ? 'dsc.exp.byBudget' : 'dsc.exp.byUses', { n: nf(e.usesLeft ?? 0), v: fmtMoney(e.perUse ?? 0) })
    : e.usesLeft == null ? tx('dsc.exp.unlimited') : tx('dsc.exp.noCap');
  return <><dt>{tx('dsc.exp.title')}</dt><dd data-testid="dd-exposure"><b>{e.estimate != null ? fmtMoney(e.estimate) : '—'}</b> <span className="fk-muted">· {tx('dsc.exp.estimate')}</span><span className="fk-li-s">{why}</span></dd></>;
}

/** Deals & Offers 08: the discount first priced vs the one paid, with the server's explanation (no estimate kept → nothing) */
type PvpChange = { code: string; beforeCents: number | null; afterCents: number | null; discountBeforeCents: number | null; discountAfterCents: number | null };
function PreviewVsPaidWhy({ pvp }: { pvp?: { estimateCents: number; paidCents: number; changeCents: number; unchanged: boolean; changes: PvpChange[] } | null }) {
  if (!pvp) return null;
  if (pvp.unchanged) return <span className="fk-li-s" data-testid="pvp-same">{tx('dsc.pvp.same')}</span>;
  const off = (c: number | null) => '−' + fmtMoney(Math.abs(c ?? 0));
  const line = (c: PvpChange) => c.code === 'line_removed' ? tx('dsc.pvp.removed', { p: fmtMoney(c.beforeCents ?? 0), d: off(c.discountBeforeCents) })
    : c.code === 'line_added' ? tx('dsc.pvp.added', { p: fmtMoney(c.afterCents ?? 0), d: off(c.discountAfterCents) })
    : c.code === 'price_changed' ? tx('dsc.pvp.price', { p0: fmtMoney(c.beforeCents ?? 0), p1: fmtMoney(c.afterCents ?? 0), d0: off(c.discountBeforeCents), d1: off(c.discountAfterCents) })
    : tx('dsc.pvp.other', { v: ((c.discountAfterCents ?? 0) > 0 ? '+' : '−') + fmtMoney(Math.abs(c.discountAfterCents ?? 0)) });
  return (
    <details className="dsc-why" data-testid="pvp"><summary>{tx('dsc.pvp.open', { a: off(pvp.estimateCents), b: off(pvp.paidCents) })}</summary>
      <ul className="fk-li-s" style={{ margin: '4px 0', paddingLeft: 16 }}>{pvp.changes.map((c, i) => <li key={i} data-testid="pvp-change">{line(c)}</li>)}</ul>
      <div className="fk-hint">{tx('dsc.pvp.note')}</div>
    </details>
  );
}

/** Automatic Savings Explanation: eligible subtotal → rule → cap → saving, each on its own line (savingsExplain.ts) */
function SavingsWhy({ rule, row }: { rule: SavingsRule; row: { discountCents: number; eligibleSubtotalCents?: number | null } }) {
  const e = savingsExplain(rule, row.eligibleSubtotalCents, row.discountCents);
  if (!e) return null;
  return (
    <details className="dsc-why" data-testid="savings-why"><summary>{tx('dsc.why.open')}</summary>
      <dl className="fk-dl mo-dl">
        <dt>{tx('dsc.why.eligible')}</dt><dd>{fmtMoney(e.eligible)}</dd>
        <dt>{rule.discountType === 'percent' ? tx('dsc.why.rulePct', { p: String(rule.discountPercent ?? 0) }) : tx('dsc.why.ruleFixed')}</dt><dd>−{fmtMoney(e.rule)}</dd>
        {e.cap != null ? <><dt>{e.capKind === 'cap' ? tx('dsc.why.cap', { v: fmtMoney(rule.maxDiscountCents ?? 0) }) : tx('dsc.why.subtotal')}</dt><dd data-testid="savings-why-cap">+{fmtMoney(e.cap)}</dd></> : null}
        <dt><b>{tx('dsc.why.saved')}</b></dt><dd><b>−{fmtMoney(e.recorded)}</b></dd>
      </dl>
      {e.matches ? null : <div className="fk-hint" data-testid="savings-why-diff">{tx('dsc.why.differs', { v: fmtMoney(e.expected) })}</div>}
    </details>
  );
}

export type DTab = 'overview' | 'eligibility' | 'limits' | 'items' | 'redemptions' | 'history';
const DTABS: DTab[] = ['overview', 'eligibility', 'limits', 'items', 'redemptions', 'history'];
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Extra tabs / footer actions a host screen adds (Marketing → Coupons adds Codes, Financial, Related Campaigns and the
 *  lifecycle actions); Services → Discounts passes none and is unchanged. */
export interface DetailExtras { tabs?: { key: string; label: string; render: (x: any) => React.ReactNode }[]; footer?: (x: any) => React.ReactNode; managed?: boolean;
  /** Marketing → Deals & Offers reads every kind through its own endpoints (pos/deals-offers); default = the coupon read model */
  load?: (id: string) => Promise<any>; loadRedemptions?: (q: Record<string, unknown>) => Promise<any> }
export function DiscountDetailsDialog({ id, initialTab, onClose, onPromotions, onCustomer, onTicket, tick, extras }: { id: string; initialTab?: string; onClose: () => void; onPromotions?: () => void; onCustomer: (id: string, name: string) => void; onTicket?: (ticketId: string, row?: { ticketId: string; ticketNumber?: string | null; status?: string }) => void; tick: number; extras?: DetailExtras }) {
  const [t, setT] = useState<string>(initialTab ?? 'overview'); const [rp, setRp] = useState(1);
  useEffect(() => { setT(initialTab ?? 'overview'); setRp(1); }, [id, initialTab]);
  const d = useLoad(() => (extras?.load ?? posDiscountsApi.detail)(id), [id, tick]);
  const reds = useLoad(() => (t === 'redemptions' ? (extras?.loadRedemptions ?? posDiscountsApi.redemptions)({ dealId: id, state: 'all', preset: 'all', page: rp, pageSize: 8 }) : Promise.resolve(null)), [id, t, rp, tick]);
  const x = d.data;
  const yes = (b: boolean) => (b ? tx('pos.yes') : tx('pos.no'));
  return (
    <FitDialog wide title={x ? `${x.code ?? tx('dsc.noCode')} · ${x.name}` : tx('dsc.detailsTitle')} subtitle={x ? <><span className={'fk-chip ' + (TONE[x.lifecycle] ?? 'mut')}>{life(x.lifecycle)}</span> {discountLabel(x)}</> : undefined} onClose={onClose} testId="dlg-discount"
      footer={<>{extras?.footer && x ? extras.footer(x) : null}{onPromotions ? <button type="button" className="fk-btn ghost" onClick={onPromotions} data-testid="dd-promotions">{tx('pos.manage_in_promotions')}</button> : null}<button type="button" className="fk-btn ghost" onClick={onClose} data-testid="dd-close">{tx('pos.close')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fk-seg mos-dtabs" role="tablist" aria-label={tx('dsc.detailsTitle')}>
          {DTABS.map((k) => <button key={k} type="button" role="tab" aria-selected={t === k} className={t === k ? 'on' : ''} onClick={() => setT(k)} data-testid={'dd-tab-' + k}>{tx('dsc.dtab.' + k)}</button>)}
          {(extras?.tabs ?? []).map((e) => <button key={e.key} type="button" role="tab" aria-selected={t === e.key} className={t === e.key ? 'on' : ''} onClick={() => setT(e.key)} data-testid={'dd-tab-' + e.key}>{e.label}</button>)}
        </div>
        {t === 'overview' ? <div className="mos-dgrid">
          <section><dl className="fk-dl mo-dl" data-testid="dd-overview">
            <dt>{tx('pos.code')}</dt><dd><b className="dsc-code">{x.code ?? tx('dsc.noCode')}</b>{x.limits.codes > 1 ? <span className="fk-muted"> · {tx('dsc.codesN', { n: nf(x.limits.codes) })}</span> : null}</dd>
            <dt>{tx('dsc.f.name')}</dt><dd>{x.name}</dd>
            {x.description ? <><dt>{tx('dsc.f.description')}</dt><dd>{x.description}</dd></> : null}
            <dt>{tx('pos.discount_2')}</dt><dd>{discountLabel(x)}</dd>
            <dt>{tx('pos.on_a_100_ticket')}</dt><dd>{x.sampleSavingsCents > 0 ? `−${fmtMoney(x.sampleSavingsCents)}` : '—'} <span className="fk-muted">· {tx('dsc.illustrative')}</span></dd>
            <dt>{tx('pos.status')}</dt><dd>{life(x.lifecycle)}{x.overview.suspendedReason ? <span className="fk-li-s">{x.overview.suspendedReason}</span> : null}</dd>
            <dt>{tx('dsc.f.scope')}</dt><dd>{x.overview.salonWide ? tx('dsc.salonWide') : x.overview.branch ?? '—'}</dd>
            <dt>{tx('dsc.f.id')}</dt><dd className="mos-mono">{x.id}</dd>
            <dt>{tx('dsc.f.created')}</dt><dd>{day(x.createdAt)}{x.overview.createdBy ? ` · ${x.overview.createdBy}` : ''}</dd>
          </dl></section>
          <section><h3 className="fk-h3">{tx('dsc.usageTitle')}</h3><dl className="fk-dl mo-dl" data-testid="dd-usage">
            <dt>{tx('dsc.tot.events')}</dt><dd><b>{nf(x.usage.confirmed)}</b></dd>
            <dt>{tx('dsc.tot.customers')}</dt><dd>{nf(x.usage.uniqueCustomers)}</dd>
            <dt>{tx('dsc.tot.savings')}</dt><dd>{fmtMoney(x.usage.savingsCents)}</dd>
            <dt>{tx('dsc.state.applied')}</dt><dd>{nf(x.usage.pendingAtCheckout)}</dd>
            <dt>{tx('dsc.state.reversed')}</dt><dd>{nf(x.usage.reversed)}</dd>
            <dt>{tx('dsc.lastRedeemed')}</dt><dd>{x.usage.lastRedeemedAt ? whenTime(x.usage.lastRedeemedAt) : '—'}</dd>
          </dl><div className="fk-hint">{tx('dsc.usageRule')}</div></section>
          {x.overview.terms ? <section><h3 className="fk-h3">{tx('dsc.f.terms')}</h3><p className="rt-p">{x.overview.terms}</p></section> : null}
        </div> : null}
        {t === 'eligibility' ? <dl className="fk-dl mo-dl" data-testid="dd-eligibility">
          <dt>{tx('pos.min_purchase')}</dt><dd>{x.minPurchaseCents > 0 ? fmtMoney(x.minPurchaseCents) : tx('pos.none')}</dd>
          <dt>{tx('dsc.e.newOnly')}</dt><dd>{yes(x.eligibility.newCustomersOnly)}</dd>
          <dt>{tx('dsc.e.memberOnly')}</dt><dd>{yes(x.eligibility.memberOnly)}</dd>
          <dt>{tx('dsc.e.days')}</dt><dd>{x.eligibility.daysOfWeek?.length ? x.eligibility.daysOfWeek.map((n: number) => tx('dsc.dow.' + DOW[n % 7])).join(', ') : tx('dsc.e.anyDay')}</dd>
          <dt>{tx('dsc.e.hours')}</dt><dd>{x.eligibility.validFromMinute != null && x.eligibility.validToMinute != null ? `${hm(x.eligibility.validFromMinute)} – ${hm(x.eligibility.validToMinute)}` : tx('dsc.e.anyTime')}</dd>
          <dt>{tx('dsc.e.stack')}</dt><dd>{x.eligibility.stackable ? tx('dsc.e.stackYes') : tx('dsc.e.stackNo')}</dd>
          <dt>{tx('dsc.e.code')}</dt><dd>{yes(x.eligibility.requiresCode)}</dd>
          <dt>{tx('dsc.e.rules')}</dt><dd>{x.eligibility.advancedRules ? tx('dsc.e.rulesN', { n: nf(x.eligibility.advancedRules) }) : tx('pos.none')}</dd>
          <dd className="fk-hint" style={{ gridColumn: '1 / -1' }}>{tx('dsc.e.serverRule')}</dd>
        </dl> : null}
        {t === 'limits' ? <dl className="fk-dl mo-dl" data-testid="dd-limits">
          <dt>{tx('pos.valid')}</dt><dd>{validLabel(x)}</dd>
          <dt>{tx('pos.usage')}</dt><dd>{usageLabel(x)}</dd>
          <dt>{tx('dsc.l.perCustomer')}</dt><dd>{x.limits.maxPerCustomer == null ? tx('dsc.unlimited') : nf(x.limits.maxPerCustomer)}</dd>
          <dt>{tx('dsc.l.cap')}</dt><dd>{x.limits.maxDiscountCents == null ? tx('pos.none') : fmtMoney(x.limits.maxDiscountCents)}</dd>
          <dt>{tx('dsc.l.budget')}</dt><dd>{x.limits.budgetCents == null ? tx('pos.none') : fmtMoney(x.limits.budgetCents)}</dd>
          <dt>{tx('dsc.l.codes')}</dt><dd>{tx('dsc.l.codesV', { n: nf(x.limits.codes), a: nf(x.limits.activeCodes), w: nf(x.limits.walletCodes) })}</dd>
          <ExposureRows x={x} />
        </dl> : null}
        {t === 'items' ? (x.services.length === 0 ? <div className="fk-hint" data-testid="dd-items">{tx('dsc.allItems')}</div>
          : <ul className="fk-list dense" data-testid="dd-items">{x.services.map((s: any) => <li key={s.id} className="fk-li"><span className="fk-li-t">{s.name}</span></li>)}</ul>) : null}
        {t === 'redemptions' ? (reds.error ? <StateBlock error={reds.error} onRetry={reds.reload} /> : !reds.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : reds.data.items.length === 0 ? <Empty title={tx('dsc.noRedemptions')} /> : <><RedemptionsTable rows={reds.data.items} compact onCustomer={onCustomer} onTicket={onTicket} rule={{ discountType: x.discountType, discountPercent: x.discountPercent, discountCents: x.discountCents, maxDiscountCents: x.limits?.maxDiscountCents ?? null }} /><Pager info={pageOf(reds.data)} onPage={setRp} /></>) : null}
        {t === 'history' ? (x.history.length === 0 ? <div className="fk-hint">{tx('dsc.noHistory')}</div> : (
          <table className="fk-table fn-table dsc-table" data-testid="dd-history"><thead><tr><th>{tx('dsc.col.when')}</th><th>{tx('dsc.col.version')}</th><th>{tx('dsc.col.by')}</th><th>{tx('dsc.col.terms')}</th></tr></thead>
            <tbody>{x.history.map((h: any) => <tr key={h.id}><td>{whenTime(h.at)}</td><td>v{h.version}</td><td>{h.actor || '—'}</td><td className="dsc-terms">{Object.entries(h.terms).map(([k2, v]) => `${tx('dsc.term.' + k2)}: ${k2.endsWith('Cents') ? fmtMoney(Number(v)) : String(v)}`).join(' · ') || '—'}</td></tr>)}</tbody></table>)) : null}
        {(extras?.tabs ?? []).filter((e) => e.key === t).map((e) => <div key={e.key} data-testid={'dd-' + e.key}>{e.render(x)}</div>)}
      </>}
    </FitDialog>
  );
}
