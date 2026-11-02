// POSPromotionsScreen.tsx — Marketing → Promotions (/tenant/marketing/promotions). "Promotions Management Complete Build Guide"
// (Oct 30 2026). Repaired in place: same route, title, five KPI cards (+ the discount value actually redeemed), New Promotion,
// and the Code · Name · Discount · Redemptions · Status table with Pause / Resume / Archive on each row. A salon promotion IS a
// coupon (`deals` kind 'coupon' — the existing "vishal" record is untouched), so this screen reads the SAME records and ledger
// as Coupons and Discounts through the SAME endpoints; nothing here prices or redeems on its own.
//   header   Refresh · Check Promotion · View Redemption History · Promotion Assistant · New Promotion
//   search   ONE box, scope = Promotions | Redemption History | Eligibility Checks (+ Insights, Check System) · status · type ·
//            branch · service · Clear Filters · Today / Week / Month / Year / Custom (month calendar) on a stated date basis
//   library  newest first, numbered pages 10 / 20 / 50, row Pause / Resume / Archive (Archive asks first), click = details
//   details  Overview · Eligibility · Validity & limits · Services · Redemptions (Open Customer / Open Ticket) · Financial ·
//            Campaign links · Activity (who paused / resumed / archived, when, before → after) · Edit / Duplicate / Check
// Every action is permission-checked on the server; creating, duplicating or saving a suggestion makes a DRAFT and "Save &
// activate" is the normal Publish step. Checks are logged (Eligibility Checks) and never consume a use. Nothing sends.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posDiscountsApi } from '../api/posDiscountsApi';
import { posDealsApi, type DealView } from '../api/posDealsApi';
import { posPromotionsApi } from '../api/posPromotionsApi';
import { posServicesApi } from '../api/posServicesApi';
import { authApi } from '../api/authApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { DiscountDetailsDialog, RedemptionsTable, TONE, life, pageOf, discountLabel } from './POSDiscountsScreen';
import { Actions, AssistantDialog, Campaigns, CheckDialog, DuplicateDialog, Financial, SizePicker, healthTone } from './POSCouponsScreen';
import { posCouponsApi } from '../api/posCouponsApi';
import { DealWizard } from './deals/DealWizard';
import { DealCouponsPanel } from './deals/DealCouponsPanel';

type Tab = 'library' | 'redemptions' | 'checks' | 'insights' | 'health';
const TABS: Tab[] = ['library', 'redemptions', 'checks', 'insights', 'health'];
const STATUSES = ['live', 'active', 'scheduled', 'paused', 'draft', 'expired', 'exhausted', 'archived', 'all'];
const TYPES = ['all', 'percent', 'fixed'];
const BASES = ['created', 'starts', 'ends', 'updated', 'active'];
const RSTATES = ['confirmed', 'pending', 'released', 'reversed', 'all'];
const VERDICTS = ['all', 'eligible', 'not_eligible'];
const GRAINS = ['day', 'week', 'month'];
const SIZES = [10, 20, 50];
const PRESETS = ['all', 'today', 'week', 'month', 'year', 'custom'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const nf = (n: number) => fmtNumber(n || 0);
const day = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const pick = (v: string | null, list: string[], dflt: string) => (v && list.includes(v) ? v : dflt);

export function POSPromotionsScreen() {
  const nav = useNavigate(); const can = useCan();
  // a real owner/manager session carries the catalog key 'marketing.manage'; 'pos.marketing.manage' is its route alias (the server resolves both)
  const canManage = can('pos.marketing.manage') || can('marketing.manage');
  // §05 "stable query URL parameters": scope, search, status, type, branch, service, date basis, period, page and page size
  const [params, setParams] = useSearchParams();
  const P = (k: string) => params.get(k);
  const setP = (patch: Record<string, string | number | null>, keepPage = false) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') p.delete(k); else p.set(k, String(v)); }
    if (!keepPage) p.delete('page');   // a filter / scope change goes back to Page 1
    setParams(p, { replace: true });
  };
  const tab = pick(P('scope'), TABS, 'library') as Tab;
  const status = pick(P('status'), STATUSES, 'live'); const type = pick(P('type'), TYPES, 'all');
  const branchId = P('branch') ?? ''; const serviceId = P('service') ?? ''; const basis = pick(P('basis'), BASES, 'created');
  const redState = pick(P('state'), RSTATES, 'confirmed'); const verdict = pick(P('verdict'), VERDICTS, 'all'); const grain = pick(P('grain'), GRAINS, 'day');
  const size = SIZES.includes(Number(P('size'))) ? Number(P('size')) : 10; const page = Math.max(1, Math.trunc(Number(P('page'))) || 1);
  const preset = pick(P('preset'), PRESETS, tab === 'insights' ? 'month' : 'all') as PeriodState['preset'];
  const period: PeriodState = preset === 'custom' && YMD.test(P('from') ?? '') && YMD.test(P('to') ?? '') ? { preset, from: P('from')!, to: P('to')! } : { preset: preset === 'custom' ? 'all' : preset };
  const setPeriod = (p: PeriodState) => setP({ preset: p.preset === 'all' ? null : p.preset, from: p.preset === 'custom' ? p.from ?? null : null, to: p.preset === 'custom' ? p.to ?? null : null });
  const [search, setSearch] = useState(P('q') ?? ''); const q = useDebounced(search.trim(), 300);
  useEffect(() => { if ((P('q') ?? '') !== q) setP({ q: q || null }); }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps

  const [tick, setTick] = useState(0); const refresh = () => setTick((n) => n + 1);
  const [detail, setDetail] = useState<{ id: string; tab?: string } | null>(null);
  const [checking, setChecking] = useState<{ id: string; name: string } | null>(null);
  const [choose, setChoose] = useState(false);
  const [wizard, setWizard] = useState<{ editing: DealView | null } | null>(null);
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);
  const [assistant, setAssistant] = useState(false);
  const [confirmRow, setConfirmRow] = useState<{ id: string; name: string } | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { (posServicesApi.list() as Promise<any>).then((r) => setServices((Array.isArray(r) ? r : r?.items ?? r?.services ?? []).map((s: any) => ({ id: String(s.id ?? s.serviceId), name: String(s.name) })))).catch(() => setServices([])); }, []);
  useEffect(() => { authApi.branches().then((r) => setBranches((r?.branches ?? []).map((b) => ({ id: b.id, name: b.name ?? b.id.slice(0, 8) })))).catch(() => setBranches([])); }, []);

  const per = periodQuery(period);
  const libQ = { q: q || undefined, status, type, branchId: branchId || undefined, serviceId: serviceId || undefined, dateField: basis, ...per };
  const redQ = { q: q || undefined, state: redState, branchId: branchId || undefined, ...per };
  const chkQ = { q: q || undefined, verdict, ...per };
  const kpis = useLoad(() => posDiscountsApi.kpis(), [tick]);
  const list = useLoad(() => (tab === 'library' ? posDiscountsApi.list({ ...libQ, page, pageSize: size }) : Promise.resolve(null)), [tab, JSON.stringify(libQ), page, size, tick]);
  const reds = useLoad(() => (tab === 'redemptions' ? posDiscountsApi.redemptions({ ...redQ, page, pageSize: size }) : Promise.resolve(null)), [tab, JSON.stringify(redQ), page, size, tick]);
  const checks = useLoad(() => (tab === 'checks' ? posPromotionsApi.checks({ ...chkQ, page, pageSize: size }) : Promise.resolve(null)), [tab, JSON.stringify(chkQ), page, size, tick]);
  const trends = useLoad(() => (tab === 'insights' ? posPromotionsApi.trends({ grain, branchId: branchId || undefined, ...per }) : Promise.resolve(null)), [tab, grain, branchId, JSON.stringify(per), tick]);
  const health = useLoad(() => (tab === 'health' ? posCouponsApi.health() : Promise.resolve(null)), [tab, tick]);
  const current = tab === 'library' ? list : tab === 'redemptions' ? reds : tab === 'checks' ? checks : null;
  // the server clamps an out-of-range page (e.g. after a filter shrank the set): follow it
  useEffect(() => { const sp = current?.data?.page; if (sp && sp !== page) setP({ page: sp === 1 ? null : sp }, true); }, [current?.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = !!(q || type !== 'all' || branchId || serviceId || status !== 'live' || preset !== 'all' || redState !== 'confirmed' || verdict !== 'all');
  const clearAll = () => { setSearch(''); setP({ q: null, status: null, type: null, branch: null, service: null, basis: null, state: null, verdict: null, preset: null, from: null, to: null }); };
  /** §07: after Create, go to Page 1 (newest first) and say so when the current filters hide the new promotion */
  const activation = useRef<{ key: string; tone: 'ok' | 'bad'; extra: string } | null>(null);
  const afterCreate = (v: { id: string; title?: string; status?: string }, key: string, tone: 'ok' | 'bad' = 'ok', extra = '') => {
    const hidden = !!(q || type !== 'all' || branchId || serviceId || preset !== 'all' || !['live', 'all', 'draft', 'active', 'scheduled'].includes(status));
    setP({ scope: null, page: null }, true); refresh();
    setNote({ tone, text: (extra ? extra + ' ' : '') + tx(key, { name: String(v.title ?? '') }) + (hidden ? ' ' + tx('cp.hiddenByFilters') : '') });
    setDetail({ id: v.id });
  };
  const rowAct = async (p: any, a: 'pause' | 'resume' | 'archive') => {
    setBusyRow(p.id); setNote(null);
    const call = { pause: posDealsApi.pause, resume: posDealsApi.resume, archive: posDealsApi.archive }[a];
    try { await call(p.id); setNote({ tone: 'ok', text: tx('cp.did.' + a, { name: p.name }) }); refresh(); }
    catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('cp.failed')) }); } finally { setBusyRow(null); }
  };
  const openCustomer = (id: string, name: string) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`);
  const openTicket = (ticketId: string) => nav(`/checkout?ticket=${encodeURIComponent(ticketId)}`);
  const k = kpis.data;
  if (isForbidden(kpis.error)) return <div className="work dsc promo" data-testid="promotions-screen"><h1>{tx('pos.promotions')}</h1><StateBlock error={kpis.error} onRetry={kpis.reload} /></div>;
  const server = current?.data?.period ?? trends.data?.period;
  const searchKey = tab === 'redemptions' ? 'promo.searchRed' : tab === 'checks' ? 'promo.searchChecks' : 'promo.searchLib';

  return (
    <div className="work dsc cp promo" data-testid="promotions-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.promotions')}</h1><div className="sub">{tx('pos.coupon_codes_and_discounts_for_your_1gks')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={refresh} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setChoose(true)} data-testid="check-promotion">{tx('promo.checkPromotion')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setP({ scope: 'redemptions' })} data-testid="view-history">{tx('promo.viewHistory')}</button>
          {canManage ? <button type="button" className="fk-btn ghost" onClick={() => setAssistant(true)} data-testid="assistant">{tx('promo.assistant')}</button> : null}
          {canManage ? <button type="button" className="fk-btn primary" onClick={() => setWizard({ editing: null })} data-testid="new-promotion">{tx('pos.new_promotion')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <div className="fk-kpis six cp-kpis" data-testid="kpis">
        <KpiCard testId="kpi-total" label={tx('pos.total')} loading={!k} value={k ? nf(k.total) : ''} sub={k ? tx('cp.kpi.totalSub', { a: nf(k.split.archived) }) : ''} onClick={() => setP({ scope: null, status: 'all' })} />
        <KpiCard testId="kpi-active" tone="ok" label={tx('pos.active_3')} loading={!k} value={k ? nf(k.activeDiscounts) : ''} sub={k ? tx('dsc.kpi.activeSub', { s: nf(k.split.scheduled), p: nf(k.split.paused) }) : ''} onClick={() => setP({ scope: null, status: 'active' })} />
        <KpiCard testId="kpi-paused" tone={k && k.split.paused ? 'warn' : undefined} label={tx('pos.paused')} loading={!k} value={k ? nf(k.split.paused) : ''} sub={tx('cp.kpi.pausedSub')} onClick={() => setP({ scope: null, status: 'paused' })} />
        <KpiCard testId="kpi-redemptions" tone="gold" label={tx('pos.redemptions')} loading={!k} value={k ? nf(k.ledger.confirmedEvents) : ''} sub={k ? tx('cp.kpi.redSub', { p: nf(k.ledger.pendingAtCheckout) }) : ''} onClick={() => setP({ scope: 'redemptions' })} />
        <KpiCard testId="kpi-expiring" tone={k && k.expiringSoon > 0 ? 'warn' : undefined} label={tx('pos.expiring_soon')} loading={!k} value={k ? nf(k.expiringSoon) : ''} sub={k ? tx('dsc.kpi.expSub', { n: nf(k.expiringWindowDays) }) : ''} />
        <KpiCard testId="kpi-value" label={tx('promo.kpi.value')} loading={!k} value={k ? fmtMoney(k.ledger.savingsCents) : ''} sub={k ? tx('cp.kpi.valueSub', { g: fmtMoney(k.ledger.grossDiscountCents ?? 0), r: fmtMoney(k.ledger.reversedCents ?? 0) }) : ''} />
      </div>

      <div className="fk-seg inv2-tabseg" role="tablist" aria-label={tx('promo.scope')} data-testid="scope">
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setP({ scope: t === 'library' ? null : t })} data-testid={'tab-' + t}>{tx('promo.tab.' + t)}</button>)}
      </div>

      {tab !== 'health' ? <div className="dsc-tools" data-testid="toolbar">
        {tab !== 'insights' ? <div className="fn-search dsc-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx(searchKey)} aria-label={tx(searchKey)} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div> : null}
        {tab === 'library' ? <>
          <select className="fk-select" value={status} onChange={(e) => setP({ status: e.target.value === 'live' ? null : e.target.value })} aria-label={tx('pos.status')} data-testid="status">{STATUSES.map((s) => <option key={s} value={s}>{tx('dsc.status.' + s)}</option>)}</select>
          <select className="fk-select" value={type} onChange={(e) => setP({ type: e.target.value === 'all' ? null : e.target.value })} aria-label={tx('dsc.type')} data-testid="type">{TYPES.map((s) => <option key={s} value={s}>{tx('dsc.type.' + s)}</option>)}</select>
          <select className="fk-select" value={serviceId} onChange={(e) => setP({ service: e.target.value || null })} aria-label={tx('cp.service')} data-testid="service"><option value="">{tx('cp.anyService')}</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </> : null}
        {tab === 'library' || tab === 'redemptions' || tab === 'insights' ? <select className="fk-select" value={branchId} onChange={(e) => setP({ branch: e.target.value || null })} aria-label={tx('promo.branch')} data-testid="branch">
          <option value="">{tx('promo.allBranches')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select> : null}
        {tab === 'redemptions' ? <select className="fk-select" value={redState} onChange={(e) => setP({ state: e.target.value === 'confirmed' ? null : e.target.value })} aria-label={tx('pos.status')} data-testid="red-state">{RSTATES.map((s) => <option key={s} value={s}>{tx('dsc.rstate.' + s)}</option>)}</select> : null}
        {tab === 'checks' ? <select className="fk-select" value={verdict} onChange={(e) => setP({ verdict: e.target.value === 'all' ? null : e.target.value })} aria-label={tx('promo.verdict')} data-testid="verdict">{VERDICTS.map((s) => <option key={s} value={s}>{tx('promo.verdict.' + s)}</option>)}</select> : null}
        {tab === 'insights' ? <select className="fk-select" value={grain} onChange={(e) => setP({ grain: e.target.value === 'day' ? null : e.target.value })} aria-label={tx('promo.grain')} data-testid="grain">{GRAINS.map((s) => <option key={s} value={s}>{tx('promo.grain.' + s)}</option>)}</select> : null}
        {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div> : null}
      {tab !== 'health' ? <PeriodBar compact allowAll={tab !== 'insights'} value={period} onChange={setPeriod} server={server}
        basis={tab === 'library' ? basis : tab === 'checks' ? 'checked' : 'redeemed'} onBasis={tab === 'library' ? (b) => setP({ basis: b === 'created' ? null : b }) : () => undefined}
        basisOptions={tab === 'library' ? BASES.map((b) => ({ value: b, label: tx('cp.basis.' + b) })) : tab === 'checks' ? [{ value: 'checked', label: tx('promo.basis.checked') }] : [{ value: 'redeemed', label: tx('promo.basis.redeemed') }]} /> : null}

      {tab === 'library' ? <FitPanel testId="promotions-list" title={<>{tx('promo.library')}{list.data ? <span className="fk-muted"> · {tx('dsc.matching', { n: nf(list.data.totalItems) })}</span> : null}{preset !== 'all' ? <span className="fk-hint dsc-hint">{tx('cp.basisShown', { b: tx('cp.basis.' + basis) })}</span> : null}</>}
        footer={<div className="cp-foot"><Pager info={pageOf(list.data)} onPage={(n) => setP({ page: n === 1 ? null : n }, true)} label={tx('promo.library')} /><SizePicker size={size} onSize={(n) => setP({ size: n === 10 ? null : n })} /></div>}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : list.data.items.length === 0 ? (filtered ? <Empty title={q ? tx('dsc.noMatchSearch', { q }) : tx('dsc.noMatch')}><button type="button" className="fk-btn" onClick={clearAll} data-testid="empty-clear">{tx('finance.clearFilters')}</button></Empty>
            : <Empty title={tx('pos.no_promotions_yet_create_a_coupon_17xb')}>{canManage ? <button type="button" className="fk-btn primary" onClick={() => setWizard({ editing: null })}>{tx('pos.new_promotion')}</button> : null}</Empty>)
          : <table className="fk-table fn-table dsc-table" data-testid="promotions-table">
            <thead><tr><th>{tx('pos.code')}</th><th>{tx('pos.name')}</th><th>{tx('pos.discount_2')}</th><th className="t-opt">{tx('promo.col.dates')}</th><th>{tx('pos.redemptions')}</th><th>{tx('pos.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{list.data.items.map((p: any) => <tr key={p.id} className="inv2-click" onClick={() => setDetail({ id: p.id })} data-testid="promotion-row">
              <td><b className="dsc-code">{p.code ?? tx('dsc.noCode')}</b>{p.codes > 1 ? <span className="fk-li-s">{tx('dsc.codesN', { n: nf(p.codes) })}</span> : null}</td>
              <td><span className="fk-li-t">{p.name}</span>{p.matchedVia ? <span className="fk-li-s">{tx('dsc.via.' + p.matchedVia)}</span> : null}{p.branchName ? <span className="fk-li-s">{p.branchName}</span> : null}</td>
              <td>{discountLabel(p)}{p.minPurchaseCents ? <span className="fk-li-s">{tx('cp.minSpend', { v: fmtMoney(p.minPurchaseCents) })}</span> : null}</td>
              <td className="t-opt">{p.startsAt ? day(p.startsAt) : tx('promo.now')} – {p.endsAt ? day(p.endsAt) : tx('pos.no_end_date')}</td>
              <td data-testid="row-uses">{nf(p.used)}{p.maxRedemptions != null ? ` / ${nf(p.maxRedemptions)}` : ''}</td>
              <td><span className={'fk-chip ' + (TONE[p.lifecycle] ?? 'mut')} data-testid="row-status">{life(p.lifecycle)}</span></td>
              <td className="fn-acts" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="fk-btn ghost sm" onClick={() => setChecking({ id: p.id, name: p.name })} data-testid="row-check">{tx('cp.check')}</button>
                {canManage && p.dealStatus === 'active' ? <button type="button" className="fk-btn ghost sm" disabled={busyRow === p.id} onClick={() => void rowAct(p, 'pause')} data-testid="row-pause">{tx('pos.pause')}</button> : null}
                {canManage && p.dealStatus === 'paused' ? <button type="button" className="fk-btn ghost sm" disabled={busyRow === p.id} onClick={() => void rowAct(p, 'resume')} data-testid="row-resume">{tx('cp.act.resume')}</button> : null}
                {canManage && ['sold_out', 'expired', 'canceled', 'rejected'].includes(p.dealStatus) ? <button type="button" className="fk-btn ghost sm" disabled={busyRow === p.id} onClick={() => setConfirmRow({ id: p.id, name: p.name })} data-testid="row-archive">{tx('pos.archive')}</button> : null}
              </td></tr>)}</tbody>
          </table>}
      </FitPanel> : null}

      {tab === 'redemptions' ? <FitPanel testId="redemptions-list" title={<>{tx('promo.tab.redemptions')}{reds.data ? <span className="fk-muted"> · {tx('dsc.matching', { n: nf(reds.data.totalItems) })} · {tx('cp.redTotals', { v: fmtMoney(reds.data.totals.savingsCents), c: nf(reds.data.totals.uniqueCustomers) })}</span> : null}</>}
        footer={<div className="cp-foot"><Pager info={pageOf(reds.data)} onPage={(n) => setP({ page: n === 1 ? null : n }, true)} label={tx('promo.tab.redemptions')} /><SizePicker size={size} onSize={(n) => setP({ size: n === 10 ? null : n })} /></div>}>
        {reds.error ? <StateBlock error={reds.error} onRetry={reds.reload} /> : !reds.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : reds.data.items.length === 0 ? <Empty title={q ? tx('dsc.noMatchSearch', { q }) : tx('dsc.noRedemptions')} />
          : <RedemptionsTable rows={reds.data.items} onCoupon={(id) => setDetail({ id, tab: 'redemptions' })} onCustomer={openCustomer} onTicket={openTicket} />}
      </FitPanel> : null}

      {tab === 'checks' ? <FitPanel testId="checks-list" title={<>{tx('promo.tab.checks')}{checks.data ? <span className="fk-muted"> · {tx('dsc.matching', { n: nf(checks.data.totalItems) })}</span> : null}</>}
        footer={<div className="cp-foot"><Pager info={pageOf(checks.data)} onPage={(n) => setP({ page: n === 1 ? null : n }, true)} label={tx('promo.tab.checks')} /><SizePicker size={size} onSize={(n) => setP({ size: n === 10 ? null : n })} /></div>}>
        {checks.error ? <StateBlock error={checks.error} onRetry={checks.reload} /> : !checks.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : checks.data.items.length === 0 ? <Empty title={q ? tx('dsc.noMatchSearch', { q }) : tx('promo.noChecks')} />
          : <table className="fk-table fn-table dsc-table" data-testid="checks-table">
            <thead><tr><th>{tx('dsc.col.when')}</th><th>{tx('pos.customer')}</th><th>{tx('promo.col.promotion')}</th><th>{tx('dsc.col.ticket')}</th><th>{tx('promo.verdict')}</th><th className="num">{tx('promo.col.wouldTake')}</th><th className="t-opt">{tx('promo.col.by')}</th></tr></thead>
            <tbody>{checks.data.items.map((c: any) => <tr key={c.id} data-testid="check-row">
              <td>{when(c.at)}</td>
              <td>{c.customerId ? <button type="button" className="fk-li-t link" onClick={() => openCustomer(c.customerId, c.customerName ?? '')}>{c.customerName || '—'}</button> : <span>{tx('promo.noCustomer')}</span>}{c.maskedPhone ? <span className="fk-li-s">{c.maskedPhone}</span> : null}</td>
              <td><button type="button" className="fk-li-t link" onClick={() => setDetail({ id: c.dealId })}>{c.dealName}</button></td>
              <td>{c.ticketId && c.ticketNumber ? <button type="button" className="fk-li-t link" onClick={() => openTicket(c.ticketId)}>#{c.ticketNumber}</button> : '—'}</td>
              <td><span className={'fk-chip ' + (c.eligible ? 'ok' : 'warn')} data-testid="check-row-verdict">{tx('cp.v.' + c.verdict)}</span>{c.reasons?.[0]?.message ? <span className="fk-li-s">{c.reasons[0].message}</span> : null}</td>
              <td className="num">{c.eligible ? fmtMoney(c.discountPreviewCents) : '—'}</td>
              <td className="t-opt">{c.checkedBy ?? '—'}</td></tr>)}</tbody>
          </table>}
        <div className="fk-hint">{tx('promo.checksNote')}</div>
      </FitPanel> : null}

      {tab === 'insights' ? <Insights data={trends.data} error={trends.error} reload={trends.reload} onPromotion={(id) => setDetail({ id })} /> : null}

      {tab === 'health' ? <FitPanel testId="health" title={<>{tx('promo.tab.health')}{health.data ? <span className={'fk-chip ' + healthTone(health.data.overall)} style={{ marginLeft: 8 }} data-testid="health-overall">{tx('cp.health.' + health.data.overall)}</span> : null}</>}>
        {health.error ? <StateBlock error={health.error} onRetry={health.reload} /> : !health.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
          <ul className="fk-list" data-testid="health-checks">{health.data.checks.map((c: any) => <li key={c.key} className="fk-li" data-testid={'health-' + c.key}>
            <span className={'fk-chip ' + healthTone(c.status)}>{tx('cp.health.' + c.status)}</span>
            <span className="fk-li-t">{tx('cp.check.' + c.key)}</span><span className="fk-li-s">{c.detail}</span></li>)}</ul>
          <div className="fk-hint">{tx('cp.healthNote', { t: when(health.data.checkedAt) })}</div></>}
      </FitPanel> : null}

      {detail ? <DiscountDetailsDialog id={detail.id} initialTab={detail.tab} tick={tick} onClose={() => setDetail(null)} onCustomer={openCustomer} onTicket={openTicket}
        extras={{
          tabs: [
            { key: 'codes', label: tx('cp.dtab.codes'), render: (x) => <DealCouponsPanel dealId={x.id} title={x.name} onClose={() => setDetail({ id: x.id })} /> },
            { key: 'financial', label: tx('cp.dtab.financial'), render: (x) => <Financial x={x} /> },
            { key: 'campaigns', label: tx('promo.dtab.campaigns'), render: (x) => <Campaigns dealId={x.id} /> },
            { key: 'activity', label: tx('promo.dtab.activity'), render: (x) => <Activity dealId={x.id} tick={tick} /> },
          ],
          footer: (x) => <>
            <Actions x={x} canManage={canManage} confirmArchive onCheck={() => setChecking({ id: x.id, name: x.name })}
              onEdit={async () => { try { setWizard({ editing: await posDealsApi.get(x.id) as DealView }); setDetail(null); } catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('cp.failed')) }); } }}
              onDuplicate={() => setDup({ id: x.id, name: x.name })}
              onDone={(text, tone) => { setNote({ tone, text }); refresh(); }} /></>,
        }} /> : null}

      {choose ? <ChooseDialog onClose={() => setChoose(false)} onPick={(p) => { setChoose(false); setChecking(p); }} /> : null}
      {checking ? <CheckDialog dealId={checking.id} name={checking.name} services={services} onClose={() => { setChecking(null); if (tab === 'checks') refresh(); }}
        check={posPromotionsApi.check} subtitle={tx('promo.checkSub')} doneNote={tx('promo.checkLogged')} /> : null}
      {wizard ? <FitDialog wide title={wizard.editing ? tx('cp.editTitle', { name: wizard.editing.title }) : tx('promo.newTitle')} onClose={() => setWizard(null)} testId="dlg-wizard">
        <DealWizard editing={wizard.editing} initialKind="coupon" heading={tx('promo.newTitle')} onCancel={() => setWizard(null)}
          onActivate={canManage ? async (v) => {
            // the salon's own lifecycle, each step permission-checked by the server: draft → submit → approve → publish
            // (scheduled when it starts later). A refusal stops there and the promotion stays where it is — never "live".
            try {
              let cur: any = v;
              if (cur.status === 'draft') cur = await posDealsApi.submit(cur.id);
              if (cur.status === 'pending_approval') cur = await posDealsApi.approve(cur.id);
              if (cur.status === 'approved') cur = await posDealsApi.publish(cur.id);
              activation.current = { key: cur?.status === 'scheduled' ? 'promo.scheduled' : cur?.status === 'active' ? 'promo.activated' : 'promo.created', tone: 'ok', extra: '' };
            } catch (e) { activation.current = { key: 'promo.created', tone: 'bad', extra: errorTextOf(e, tx('cp.failed')) + ' ' + tx('promo.savedNotActivated') }; }
          } : undefined}
          onDone={(v) => {
            const editing = !!wizard.editing; setWizard(null);
            const a = activation.current; activation.current = null;
            afterCreate(v, editing ? 'cp.saved' : a?.key ?? 'promo.created', a?.tone ?? 'ok', a?.extra ?? '');
          }} />
      </FitDialog> : null}
      {dup ? <DuplicateDialog id={dup.id} name={dup.name} onClose={() => setDup(null)} onDone={(v) => { setDup(null); setDetail(null); afterCreate(v, 'cp.duplicated'); }} /> : null}
      {assistant ? <AssistantDialog services={services} title={tx('promo.assistant')} api={{ suggest: posPromotionsApi.suggest, draft: posCouponsApi.draft }}
        onClose={() => setAssistant(false)} onDone={(v) => { setAssistant(false); afterCreate(v, 'cp.assistDrafted'); }} /> : null}
      {confirmRow ? <FitDialog title={tx('promo.confirmTitle')} onClose={() => setConfirmRow(null)} testId="dlg-confirm-archive"
        footer={<><button type="button" className="fk-btn danger" onClick={() => { const r = confirmRow; setConfirmRow(null); void rowAct({ id: r.id, name: r.name }, 'archive'); }} data-testid="confirm-archive">{tx('pos.archive')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setConfirmRow(null)}>{tx('pos.cancel')}</button></>}>
        <p className="rt-p">{tx('promo.confirm.archive', { name: confirmRow.name })}</p>
      </FitDialog> : null}
    </div>
  );
}

/** "Check Promotion" from the header: pick the promotion first (searchable, the live ones), then the checker. */
function ChooseDialog({ onClose, onPick }: { onClose: () => void; onPick: (p: { id: string; name: string }) => void }) {
  const [s, setS] = useState(''); const q = useDebounced(s.trim(), 250);
  const r = useLoad(() => posDiscountsApi.list({ q: q || undefined, status: 'all', page: 1, pageSize: 20 }), [q]);
  return <FitDialog title={tx('promo.checkPromotion')} subtitle={tx('promo.chooseSub')} onClose={onClose} testId="dlg-choose">
    <input className="fk-search wide" type="search" value={s} onChange={(e) => setS(e.target.value)} placeholder={tx('promo.searchLib')} aria-label={tx('promo.searchLib')} data-testid="choose-search" />
    {r.error ? <StateBlock error={r.error} onRetry={r.reload} /> : !r.data ? <div className="fk-loading">{tx('pos.loading')}</div>
      : r.data.items.length === 0 ? <Empty title={tx('dsc.noMatch')} />
      : <ul className="fk-list dense" data-testid="choose-list">{r.data.items.map((p: any) => <li key={p.id} className="fk-li">
        <button type="button" className="fk-li-t link" onClick={() => onPick({ id: p.id, name: p.name })} data-testid="choose-item">{p.name}</button>
        <span className="fk-li-s">{p.code ?? tx('dsc.noCode')} · {discountLabel(p)} · {life(p.lifecycle)}</span></li>)}</ul>}
  </FitDialog>;
}

/** §12 Audit tab: who created / published / paused / resumed / archived it, when, and the status before → after. */
function Activity({ dealId, tick }: { dealId: string; tick: number }) {
  const a = useLoad(() => posPromotionsApi.activity(dealId), [dealId, tick]);
  if (a.error) return <StateBlock error={a.error} onRetry={a.reload} />;
  if (!a.data) return <div className="fk-loading">{tx('pos.loading')}</div>;
  const d = a.data;
  return <div data-testid="dd-activity-body">
    <div className="fk-hint">{tx('promo.createdBy', { who: d.createdBy ?? '—', at: when(d.createdAt) })}</div>
    {d.assistantOrigin ? <div className="fk-hint" data-testid="activity-origin">{tx('promo.fromAssistant', { who: d.assistantOrigin.by ?? '—', at: when(d.assistantOrigin.at), goal: tx('cp.goal.' + d.assistantOrigin.goal) })}</div> : null}
    {d.items.length === 0 ? <Empty title={tx('promo.noActivity')} /> : <ul className="fk-list dense">{d.items.map((r: any) => <li key={r.id} className="fk-li" data-testid="activity-row">
      <span className="fk-li-t">{when(r.at)} · {r.actor ?? tx('promo.system')}</span>
      <span className="fk-li-s">{r.fromStatus || r.toStatus ? `${r.fromStatus ?? '—'} → ${r.toStatus ?? '—'}` : r.action}{r.version != null ? ` · v${r.version}` : ''}</span></li>)}</ul>}
  </div>;
}

/** §14 trends · top promotions · branch and service views — completed redemptions only. */
function Insights({ data, error, reload, onPromotion }: { data: any; error: unknown; reload: () => void; onPromotion: (id: string) => void }) {
  const max = useMemo(() => Math.max(1, ...((data?.series ?? []) as { redemptions: number }[]).map((s) => s.redemptions)), [data]);
  if (error) return <StateBlock error={error} onRetry={reload} />;
  if (!data) return <div className="fk-loading">{tx('pos.loading')}</div>;
  return <div className="promo-insights" data-testid="insights">
    <FitPanel testId="trend" title={<>{tx('promo.trend')}<span className="fk-muted"> · {tx('promo.trendTotals', { n: nf(data.totals.redemptions), v: fmtMoney(data.totals.netDiscountCents), r: fmtMoney(data.totals.reversedCents) })}</span></>}>
      {data.series.length === 0 ? <Empty title={tx('dsc.noRedemptions')} /> : <ul className="promo-bars" data-testid="trend-bars">{data.series.map((s: any) => <li key={s.bucket} className="promo-bar" title={`${s.bucket}: ${s.redemptions}`}>
        <span className="promo-bar-l">{s.bucket}</span><span className="promo-bar-t"><span className="promo-bar-f" style={{ width: `${Math.round((s.redemptions / max) * 100)}%` }} /></span>
        <span className="promo-bar-v">{nf(s.redemptions)} · {fmtMoney(s.netDiscountCents)}</span></li>)}</ul>}
      <div className="fk-hint">{data.note}</div>
    </FitPanel>
    <div className="promo-insights-grid">
      <FitPanel testId="top" title={tx('promo.top')}>{data.top.length === 0 ? <Empty title={tx('dsc.noRedemptions')} /> : <ul className="fk-list dense">{data.top.map((t: any) => <li key={t.dealId} className="fk-li">
        <button type="button" className="fk-li-t link" onClick={() => onPromotion(t.dealId)}>{t.name}</button><span className="fk-li-s">{t.code ?? ''} · {nf(t.redemptions)} · {fmtMoney(t.netDiscountCents)}</span></li>)}</ul>}</FitPanel>
      <FitPanel testId="by-branch" title={tx('promo.byBranch')}>{data.byBranch.length === 0 ? <Empty title={tx('dsc.noRedemptions')} /> : <ul className="fk-list dense">{data.byBranch.map((b: any) => <li key={b.branchId ?? 'none'} className="fk-li">
        <span className="fk-li-t">{b.name}</span><span className="fk-li-s">{nf(b.redemptions)} · {fmtMoney(b.netDiscountCents)}</span></li>)}</ul>}</FitPanel>
      <FitPanel testId="by-service" title={tx('promo.byService')}>{data.byService.length === 0 ? <Empty title={tx('dsc.noRedemptions')} /> : <ul className="fk-list dense">{data.byService.map((s: any) => <li key={s.serviceId ?? s.name} className="fk-li">
        <span className="fk-li-t">{s.name}</span><span className="fk-li-s">{nf(s.redemptions)} · {tx('promo.associated', { v: fmtMoney(s.associatedLineSalesCents) })}</span></li>)}</ul>}</FitPanel>
    </div>
  </div>;
}
