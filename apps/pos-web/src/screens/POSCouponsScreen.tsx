// POSCouponsScreen.tsx — Marketing → Coupons (/tenant/marketing/coupons). Coupons & Promotions Management Center (guide of
// Oct 30 2026). Root cause fixed: this route used to render POSPromotionsScreen (title "Promotions" under the Coupons
// sidebar item); Marketing → Promotions keeps that screen and its route. Both show the SAME records — a coupon is a
// `deals` row of kind 'coupon' — so nothing is duplicated and no benefit can be applied twice.
//   header (Refresh · Coupon Assistant · New Coupon) · six cards (Total · Active · Paused · Redemptions · Expiring Soon ·
//   Discount value — each from the server, with its scope) · ONE search box per tab + status / type / service filters +
//   Today / Week / Month / Year / Custom (month calendar) with the date basis it filters · tabs Library | Redemption
//   History | Health · numbered pages 10 / 20 / 50, newest first · Details (overview, eligibility, limits, items,
//   redemptions, codes, financials, related campaigns, audit) with Check / Edit / Duplicate / lifecycle actions.
// Money is the server's (integer cents); codes are masked (only the last four exist). Creating, duplicating or saving an
// assistant suggestion makes a DRAFT — activation is the separate, permission-checked lifecycle step; nothing here sends.
import { posCustomersApi } from '../api/posCustomersApi';
import { HealthRunHistory } from '../components/HealthRunHistory';
import { parseDollarsToCents } from '@aipowersalon/money';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posDiscountsApi } from '../api/posDiscountsApi';
import { posDealsApi, type DealView } from '../api/posDealsApi';
import { posCouponsApi, type CouponAssistGoal, type CouponCheck } from '../api/posCouponsApi';
import { posServicesApi } from '../api/posServicesApi';
import { authApi } from '../api/authApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { DiscountDetailsDialog, RedemptionsTable, TONE, life, pageOf, discountLabel, usageLabel, whenTime } from './POSDiscountsScreen';
import { DealWizard } from './deals/DealWizard';
import { DealCouponsPanel } from './deals/DealCouponsPanel';
import { statusLabel } from '../i18n/status-label';   // the code stays the truth; only its label is translated

type Tab = 'library' | 'redemptions' | 'health';
const TABS: Tab[] = ['library', 'redemptions', 'health'];
const STATUSES = ['live', 'active', 'scheduled', 'paused', 'draft', 'expired', 'exhausted', 'archived', 'all'];
const BASES = ['created', 'updated', 'starts', 'ends', 'active'];
const STATES = ['confirmed', 'pending', 'released', 'reversed', 'all'];
const SIZES = [10, 20, 50];
const GOALS: CouponAssistGoal[] = ['slow_weekdays', 'promote_service', 'returning_visits', 'reconnect_inactive'];
const nf = (n: number) => fmtNumber(n || 0);
const day = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
/** the lifecycle actions the deal's status allows (the server's DEAL machine refuses anything else) */
const ACTIONS: Record<string, string[]> = { draft: ['submit', 'cancel'], pending_approval: ['approve', 'cancel'], approved: ['publish', 'cancel'], scheduled: ['cancel'], active: ['pause', 'cancel'],
  paused: ['resume', 'cancel'], sold_out: ['archive'], expired: ['archive'], canceled: ['archive'], rejected: ['archive'] };

export function POSCouponsScreen() {
  const nav = useNavigate(); const can = useCan();
  // a real owner/manager session carries the catalog key 'marketing.manage'; 'pos.marketing.manage' is its route alias (the server resolves both)
  const canManage = can('pos.marketing.manage') || can('marketing.manage');
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'library';
  const setParam = (k: string, v: string | null, dflt: string) => { const p = new URLSearchParams(params); if (v == null || v === dflt) p.delete(k); else p.set(k, v); setParams(p, { replace: true }); };
  const setTab = (t: Tab) => setParam('tab', t, 'library');
  const status = STATUSES.includes(params.get('status') ?? '') ? params.get('status')! : 'live';
  const setStatus = (s: string) => setParam('status', s, 'live');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [type, setType] = useState('all'); const [serviceId, setServiceId] = useState(''); const [basis, setBasis] = useState('created'); const [redState, setRedState] = useState('confirmed');
  const [periods, setPeriods] = useState<Record<'library' | 'redemptions', PeriodState>>({ library: { preset: 'all' }, redemptions: { preset: 'all' } });
  const pKey = tab === 'redemptions' ? 'redemptions' : 'library';
  const [page, setPage] = useState(1); const [rpage, setRpage] = useState(1); const [size, setSize] = useState(10);
  const [tick, setTick] = useState(0); const refresh = () => setTick((n) => n + 1);
  const [detail, setDetail] = useState<{ id: string; tab?: string } | null>(null);
  const [checking, setChecking] = useState<{ id: string; name: string } | null>(null);
  const [wizard, setWizard] = useState<{ editing: DealView | null } | null>(null);
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);
  const [assistant, setAssistant] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  // Coupons guide (Nov 4 2026): location filter (the salon's active locations), redemption date basis, expiring window, exports
  const [branchId, setBranchId] = useState(''); const [redBasis, setRedBasis] = useState('redeemed'); const [expDays, setExpDays] = useState(7);
  const branches = useLoad(() => authApi.branches().then((r: any) => (r.branches ?? []).filter((b: any) => b.isActive)), []);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { (posServicesApi.list() as Promise<any>).then((r) => setServices((Array.isArray(r) ? r : r?.items ?? r?.services ?? []).map((s: any) => ({ id: String(s.id ?? s.serviceId), name: String(s.name) })))).catch(() => setServices([])); }, []);

  const libScope = { q: q || undefined, status, type, serviceId: serviceId || undefined, dateField: basis, branchId: branchId || undefined, ...periodQuery(periods.library) };
  const redScope = { q: q || undefined, state: redState, branchId: branchId || undefined, dateField: redBasis, ...periodQuery(periods.redemptions) };
  const libKey = JSON.stringify([libScope, size]); const redKey = JSON.stringify([redScope, size]);
  useEffect(() => setPage(1), [libKey]); useEffect(() => setRpage(1), [redKey]);
  const kpis = useLoad(() => posDiscountsApi.kpis({ expiringDays: expDays }), [tick, expDays]);
  const list = useLoad(() => (tab === 'library' ? posDiscountsApi.list({ ...libScope, page, pageSize: size }) : Promise.resolve(null)), [tab, libKey, page, tick]);
  const reds = useLoad(() => (tab === 'redemptions' ? posDiscountsApi.redemptions({ ...redScope, page: rpage, pageSize: size }) : Promise.resolve(null)), [tab, redKey, rpage, tick]);
  const health = useLoad(() => (tab === 'health' ? posCouponsApi.health() : Promise.resolve(null)), [tab, tick]);
  useEffect(() => { const p = list.data?.page; if (p && p !== page) setPage(p); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const p = reds.data?.page; if (p && p !== rpage) setRpage(p); }, [reds.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = !!(branchId || q || (tab === 'library' && (status !== 'live' || type !== 'all' || serviceId || periods.library.preset !== 'all')) || (tab === 'redemptions' && (redState !== 'confirmed' || periods.redemptions.preset !== 'all')));
  const clearAll = () => { setBranchId(''); setRedBasis('redeemed'); setSearch(''); setType('all'); setServiceId(''); setBasis('created'); setRedState('confirmed'); setPeriods({ library: { preset: 'all' }, redemptions: { preset: 'all' } }); setStatus('live'); };
  /** a new / duplicated / assistant draft: Page 1 of the library, newest first; say so when the filters hide it */
  const afterCreate = (v: { id: string; title?: string; status?: string }, key: string) => {
    setTab('library'); setPage(1); refresh();
    const hidden = !!(q || type !== 'all' || serviceId || periods.library.preset !== 'all' || !['live', 'all', 'draft'].includes(status));
    setNote({ tone: 'ok', text: tx(key, { name: String(v.title ?? '') }) + (hidden ? ' ' + tx('cp.hiddenByFilters') : '') });
    setDetail({ id: v.id });
  };
  const k = kpis.data;
  if (isForbidden(kpis.error)) return <div className="work dsc" data-testid="coupons-screen"><h1>{tx('cp.title')}</h1><StateBlock error={kpis.error} onRetry={kpis.reload} /></div>;
  const server = tab === 'redemptions' ? reds.data?.period : list.data?.period;

  return (
    <div className="work dsc cp" data-testid="coupons-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('cp.title')}</h1><div className="sub">{tx('cp.subtitle')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={refresh} data-testid="refresh">{tx('finance.refresh')}</button>
          {canManage ? <button type="button" className="fk-btn ghost" onClick={() => setAssistant(true)} data-testid="assistant">{tx('cp.assistant')}</button> : null}
          {canManage ? <button type="button" className="fk-btn primary" onClick={() => setWizard({ editing: null })} data-testid="new-coupon">{tx('cp.newCoupon')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <div className="fk-kpis six cp-kpis" data-testid="kpis">
        <KpiCard testId="kpi-total" label={tx('cp.kpi.total')} loading={!k} value={k ? nf(k.total) : ''} sub={k ? tx('cp.kpi.totalSub', { a: nf(k.split.archived) }) : ''} onClick={() => setStatus('all')} />
        <KpiCard testId="kpi-active" tone="ok" label={tx('cp.kpi.active')} loading={!k} value={k ? nf(k.activeDiscounts) : ''} sub={k ? tx('dsc.kpi.activeSub', { s: nf(k.split.scheduled), p: nf(k.split.paused) }) : ''} onClick={() => setStatus('active')} />
        <KpiCard testId="kpi-paused" tone={k && k.split.paused ? 'warn' : undefined} label={tx('cp.kpi.paused')} loading={!k} value={k ? nf(k.split.paused) : ''} sub={tx('cp.kpi.pausedSub')} onClick={() => setStatus('paused')} />
        <KpiCard testId="kpi-redemptions" tone="gold" label={tx('pos.redemptions')} loading={!k} value={k ? nf(k.ledger.confirmedEvents) : ''} sub={k ? tx('cp.kpi.redSub', { p: nf(k.ledger.pendingAtCheckout) }) : ''} onClick={() => setTab('redemptions')} />
        <KpiCard testId="kpi-expiring" tone={k && k.expiringSoon > 0 ? 'warn' : undefined} label={tx('pos.expiring_soon')} loading={!k} value={k ? nf(k.expiringSoon) : ''} sub={k ? tx('dsc.kpi.expSub', { n: nf(k.expiringWindowDays) }) : ''} />
        <KpiCard testId="kpi-value" label={tx('cp.kpi.value')} loading={!k} value={k ? fmtMoney(k.ledger.savingsCents) : ''} sub={k ? tx('cp.kpi.valueSub', { g: fmtMoney(k.ledger.grossDiscountCents ?? 0), r: fmtMoney(k.ledger.reversedCents ?? 0) }) : ''} />
      </div>

      <div className="dsc-tools" data-testid="toolbar">
        <div className="fn-search dsc-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx(tab === 'redemptions' ? 'cp.searchRed' : 'cp.searchLib')} aria-label={tx(tab === 'redemptions' ? 'cp.searchRed' : 'cp.searchLib')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        {tab === 'library' ? <>
          <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status')} data-testid="status">{STATUSES.map((s) => <option key={s} value={s}>{tx('dsc.status.' + s)}</option>)}</select>
          <select className="fk-select" value={type} onChange={(e) => setType(e.target.value)} aria-label={tx('dsc.type')} data-testid="type">{['all', 'percent', 'fixed'].map((s) => <option key={s} value={s}>{tx('dsc.type.' + s)}</option>)}</select>
          <select className="fk-select" value={serviceId} onChange={(e) => setServiceId(e.target.value)} aria-label={tx('cp.service')} data-testid="service"><option value="">{tx('cp.anyService')}</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </> : null}
        {tab === 'redemptions' ? <select className="fk-select" value={redState} onChange={(e) => setRedState(e.target.value)} aria-label={tx('pos.status')} data-testid="red-state">{STATES.map((s) => <option key={s} value={s}>{tx('dsc.rstate.' + s)}</option>)}</select> : null}
        {(branches.data?.length ?? 0) > 1 && tab !== 'health' ? <select className="fk-select" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label={tx('cp.location')} data-testid="branch">
          <option value="">{tx('cp.allLocations')}</option>{(branches.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select> : null}
        {tab === 'library' ? <select className="fk-select" value={String(expDays)} onChange={(e) => setExpDays(Number(e.target.value))} aria-label={tx('cp.expiringWindow')} data-testid="expiring-window">
          {[3, 7, 14, 30].map((n) => <option key={n} value={n}>{tx('cp.expiringIn', { n: String(n) })}</option>)}</select> : null}
        {canManage && tab !== 'health' ? <button type="button" className="fk-btn ghost" disabled={exporting} data-testid="export" onClick={async () => {
          setExporting(true);
          try { const text = tab === 'redemptions' ? await posDiscountsApi.exportRedemptions({ ...redScope }) : await posDiscountsApi.exportList({ ...libScope }); saveText(tab === 'redemptions' ? 'coupon-redemptions.csv' : 'coupons.csv', text); }
          catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('cp.failed')) }); } finally { setExporting(false); }
        }}>{exporting ? tx('pos.loading') : tx('cp.exportCsv')}</button> : null}
        {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div>
      {tab !== 'health' ? <PeriodBar compact allowAll value={periods[pKey]} onChange={(p) => setPeriods((x) => ({ ...x, [pKey]: p }))} server={server}
        basis={tab === 'library' ? basis : redBasis} onBasis={tab === 'library' ? setBasis : setRedBasis}
        basisOptions={tab === 'library' ? BASES.map((b) => ({ value: b, label: tx('cp.basis.' + b) })) : ['redeemed', 'applied', 'finalized'].map((b) => ({ value: b, label: tx(b === 'redeemed' ? 'dsc.df.redeemed' : 'cp.redBasis.' + b) }))} /> : null}

      <div className="fk-seg inv2-tabseg" role="tablist" aria-label={tx('cp.title')} data-testid="cp-tabs">
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'tab-' + t}>{tx('cp.tab.' + t)}</button>)}
      </div>

      {tab === 'library' ? <FitPanel testId="coupons-list" title={<>{tx('cp.library')}{list.data ? <span className="fk-muted"> · {tx('dsc.matching', { n: nf(list.data.totalItems) })}</span> : null}{periods.library.preset !== 'all' ? <span className="fk-hint dsc-hint">{tx('cp.basisShown', { b: tx('cp.basis.' + basis) })}</span> : null}</>}
        footer={<div className="cp-foot"><Pager info={pageOf(list.data)} onPage={setPage} label={tx('cp.library')} /><SizePicker size={size} onSize={setSize} /></div>}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : list.data.items.length === 0 ? (filtered ? <Empty title={q ? tx('dsc.noMatchSearch', { q }) : tx('dsc.noMatch')}><button type="button" className="fk-btn" onClick={clearAll} data-testid="empty-clear">{tx('finance.clearFilters')}</button></Empty>
            : <Empty title={tx('cp.empty')}>{canManage ? <button type="button" className="fk-btn primary" onClick={() => setWizard({ editing: null })}>{tx('cp.newCoupon')}</button> : null}</Empty>)
          : <table className="fk-table fn-table dsc-table" data-testid="coupons-table">
            <thead><tr><th>{tx('pos.code')}</th><th>{tx('dsc.f.name')}</th><th>{tx('cp.col.value')}</th><th>{tx('pos.status')}</th><th>{tx('pos.redemptions')}</th><th className="t-opt">{tx('pos.valid')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{list.data.items.map((p: any) => <tr key={p.id} className="inv2-click" onClick={() => setDetail({ id: p.id })} data-testid="coupon-row">
              <td><b className="dsc-code">{p.code ?? tx('dsc.noCode')}</b>{p.codes > 1 ? <span className="fk-li-s">{tx('dsc.codesN', { n: nf(p.codes) })}</span> : null}</td>
              <td><span className="fk-li-t">{p.name}</span>{p.matchedVia ? <span className="fk-li-s">{tx('dsc.via.' + p.matchedVia)}</span> : null}</td>
              <td>{discountLabel(p)}{p.minPurchaseCents ? <span className="fk-li-s">{tx('cp.minSpend', { v: fmtMoney(p.minPurchaseCents) })}</span> : null}</td>
              <td><span className={'fk-chip ' + (TONE[p.lifecycle] ?? 'mut')}>{life(p.lifecycle)}</span></td>
              <td>{usageLabel(p)}</td>
              <td className="t-opt">{p.endsAt ? tx('cp.ends', { d: day(p.endsAt) }) : tx('pos.no_end_date')}</td>
              <td className="fn-acts" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="fk-btn ghost sm" onClick={() => setDetail({ id: p.id })} data-testid="coupon-view">{tx('cp.view')}</button>
                <button type="button" className="fk-btn ghost sm" onClick={() => setChecking({ id: p.id, name: p.name })} data-testid="coupon-check">{tx('cp.check')}</button>
              </td></tr>)}</tbody>
          </table>}
      </FitPanel> : null}

      {tab === 'redemptions' ? <FitPanel testId="redemptions-list" title={<>{tx('cp.tab.redemptions')}{reds.data ? <span className="fk-muted"> · {tx('dsc.matching', { n: nf(reds.data.totalItems) })} · {tx('cp.redTotals', { v: fmtMoney(reds.data.totals.savingsCents), c: nf(reds.data.totals.uniqueCustomers) })}</span> : null}</>}
        footer={<div className="cp-foot"><Pager info={pageOf(reds.data)} onPage={setRpage} label={tx('cp.tab.redemptions')} /><SizePicker size={size} onSize={setSize} /></div>}>
        {reds.error ? <StateBlock error={reds.error} onRetry={reds.reload} /> : !reds.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : reds.data.items.length === 0 ? <Empty title={q ? tx('dsc.noMatchSearch', { q }) : tx('dsc.noRedemptions')} />
          : <RedemptionsTable rows={reds.data.items} onCoupon={(id) => setDetail({ id, tab: 'redemptions' })} onTicket={(ticketId) => nav(`/tenant/payments/transactions?search=${encodeURIComponent(reds.data.items.find((x: any) => x.ticketId === ticketId)?.ticketNumber ?? ticketId)}`)} onCustomer={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)} />}
      </FitPanel> : null}

      {tab === 'health' ? <FitPanel testId="health" title={<>{tx('cp.tab.health')}{health.data ? <span className={'fk-chip ' + healthTone(health.data.overall)} style={{ marginLeft: 8 }} data-testid="health-overall">{tx('cp.health.' + health.data.overall)}</span> : null}</>}>
        {health.error ? <StateBlock error={health.error} onRetry={health.reload} /> : !health.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
          <ul className="fk-list" data-testid="health-checks">{health.data.checks.map((c: any) => <li key={c.key} className="fk-li" data-testid={'health-' + c.key}>
            <span className={'fk-chip ' + healthTone(c.status)}>{tx('cp.health.' + c.status)}</span>
            <span className="fk-li-t">{tx('cp.check.' + c.key)}</span><span className="fk-li-s">{c.detail}</span></li>)}</ul>
          <div className="fk-hint">{tx('cp.healthNote', { t: whenTime(health.data.checkedAt) })}</div>
          <HealthRunHistory run={() => posCouponsApi.runHealth()} list={(q) => posCouponsApi.healthRuns(q)} checkLabel={(k) => tx('cp.check.' + k)} onRan={() => health.reload()} /></>}
      </FitPanel> : null}

      {detail ? <DiscountDetailsDialog id={detail.id} initialTab={detail.tab} tick={tick} onClose={() => setDetail(null)}
        onCustomer={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)}
        extras={{
          tabs: [
            { key: 'codes', label: tx('cp.dtab.codes'), render: (x) => <DealCouponsPanel dealId={x.id} title={x.name} onClose={() => setDetail({ id: x.id })} /> },
            { key: 'financial', label: tx('cp.dtab.financial'), render: (x) => <Financial x={x} /> },
            { key: 'campaigns', label: tx('cp.dtab.campaigns'), render: (x) => <Campaigns dealId={x.id} /> },
          ],
          footer: (x) => <Actions x={x} canManage={canManage} onCheck={() => setChecking({ id: x.id, name: x.name })}
            onEdit={async () => { try { setWizard({ editing: await posDealsApi.get(x.id) as DealView }); setDetail(null); } catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('cp.failed')) }); } }}
            onDuplicate={() => setDup({ id: x.id, name: x.name })}
            onDone={(text, tone) => { setNote({ tone, text }); refresh(); }} />,
        }} /> : null}

      {checking ? <CheckDialog dealId={checking.id} name={checking.name} services={services} onClose={() => setChecking(null)} /> : null}
      {wizard ? <FitDialog wide title={wizard.editing ? tx('cp.editTitle', { name: wizard.editing.title }) : tx('cp.newCoupon')} onClose={() => setWizard(null)} testId="dlg-wizard">
        <DealWizard editing={wizard.editing} initialKind="coupon" heading={tx('cp.newCoupon')} onCancel={() => setWizard(null)}
          onDone={(v) => { const editing = !!wizard.editing; setWizard(null); afterCreate(v, editing ? 'cp.saved' : 'cp.created'); }} />
      </FitDialog> : null}
      {dup ? <DuplicateDialog id={dup.id} name={dup.name} onClose={() => setDup(null)} onDone={(v) => { setDup(null); setDetail(null); afterCreate(v, 'cp.duplicated'); }} /> : null}
      {assistant ? <AssistantDialog services={services} onClose={() => setAssistant(false)} onDone={(v) => { setAssistant(false); afterCreate(v, 'cp.assistDrafted'); }} /> : null}
    </div>
  );
}

export const healthTone = (s: string) => (s === 'ready' ? 'ok' : s === 'attention' ? 'warn' : s === 'failed' ? 'bad' : 'mut');
export function SizePicker({ size, onSize }: { size: number; onSize: (n: number) => void }) {
  return <label className="cp-size"><span>{tx('cp.rows')}</span><select className="fk-select" value={size} onChange={(e) => onSize(Number(e.target.value))} data-testid="page-size">{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>;
}

/** The details footer: Check · Edit · Duplicate · the lifecycle actions the deal's status allows. Marketing → Promotions passes
 *  confirmArchive (guide §12 "Archive (with confirmation)"): Archive / Cancel then ask once before acting. */
export function Actions({ x, canManage, onCheck, onEdit, onDuplicate, onDone, confirmArchive = false }: { x: any; canManage: boolean; onCheck: () => void; onEdit: () => void; onDuplicate: () => void; onDone: (text: string, tone: 'ok' | 'bad') => void; confirmArchive?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const acts = ACTIONS[x.dealStatus] ?? [];
  const run = async (a: string) => {
    setBusy(true);
    const call: Record<string, (id: string) => Promise<unknown>> = { submit: posDealsApi.submit, approve: (id) => posDealsApi.approve(id), publish: posDealsApi.publish, pause: posDealsApi.pause, resume: posDealsApi.resume, cancel: posDealsApi.cancel, archive: posDealsApi.archive };
    try { await call[a](x.id); onDone(tx('cp.did.' + a, { name: x.name }), 'ok'); }
    catch (e) { onDone(errorTextOf(e, tx('cp.failed')), 'bad'); } finally { setBusy(false); }
  };
  return <>
    <button type="button" className="fk-btn ghost" onClick={onCheck} data-testid="dd-check">{tx('cp.check')}</button>
    {canManage ? <>
      {!['canceled', 'archived', 'expired', 'rejected'].includes(x.dealStatus) ? <button type="button" className="fk-btn ghost" onClick={onEdit} disabled={busy} data-testid="dd-edit">{tx('cp.edit')}</button> : null}
      <button type="button" className="fk-btn ghost" onClick={onDuplicate} disabled={busy} data-testid="dd-duplicate">{tx('cp.duplicate')}</button>
      {acts.map((a) => <button key={a} type="button" className={'fk-btn ' + (a === 'publish' || a === 'resume' ? 'primary' : 'ghost')} disabled={busy}
        onClick={() => (confirmArchive && (a === 'archive' || a === 'cancel') ? setConfirming(a) : run(a))} data-testid={'dd-' + a}>{tx('cp.act.' + a)}</button>)}
      {confirming ? <span className="promo-confirm" role="alertdialog" aria-label={tx('promo.confirmTitle')} data-testid="dd-confirm">
        <span>{tx('promo.confirm.' + confirming, { name: x.name })}</span>
        <button type="button" className="fk-btn danger sm" disabled={busy} onClick={() => { const a = confirming; setConfirming(null); void run(a); }} data-testid="dd-confirm-yes">{tx('cp.act.' + confirming)}</button>
        <button type="button" className="fk-btn ghost sm" onClick={() => setConfirming(null)} data-testid="dd-confirm-no">{tx('pos.cancel')}</button></span> : null}
    </> : <span className="fk-hint" data-testid="dd-readonly">{tx('cp.readOnly')}</span>}
  </>;
}

export function Financial({ x }: { x: any }) {
  const perf = useLoad(() => posDiscountsApi.performance({ q: x.id, preset: 'all', page: 1, pageSize: 1 }), [x.id]);
  const p = perf.data?.items?.find((i: any) => i.id === x.id);
  return <><dl className="fk-dl mo-dl" data-testid="dd-financial-body">
    <dt>{tx('dsc.tot.events')}</dt><dd><b>{nf(x.usage.confirmed)}</b></dd>
    <dt>{tx('cp.fin.net')}</dt><dd>{fmtMoney(x.usage.savingsCents)}</dd>
    <dt>{tx('dsc.state.reversed')}</dt><dd>{nf(x.usage.reversed)}</dd>
    <dt>{tx('dsc.state.applied')}</dt><dd>{nf(x.usage.pendingAtCheckout)}</dd>
    <dt>{tx('cp.fin.linked')}</dt><dd>{p ? fmtMoney(p.linkedTicketSalesCents) : '—'}</dd>
    <dt>{tx('cp.fin.avg')}</dt><dd>{p && p.avgDiscountCents != null ? fmtMoney(p.avgDiscountCents) : '—'}</dd>
    <dd className="fk-hint" style={{ gridColumn: '1 / -1' }}>{tx('cp.fin.note')}</dd>
  </dl>{x.roi ? <RoiExplained roi={x.roi} byBranch={x.byBranch ?? []} /> : null}</>;
}

/** Extras (Coupons & Promotions 13 + 14): the server's source-based ROI parts, never combined into one "ROI" figure here —
 *  associated revenue (sales the offer was used on, not caused by it), discount cost, campaign spend (only when the provider
 *  reported every message's cost) and incremental lift (always unverified) — and the same counts per location. Read-only. */
type OfferRoiView = { associatedRevenueCents: number; associatedTickets: number; discountCostCents: number; redemptions: number;
  campaignSpend: { campaigns: number; messagesSent: number; messagesCosted: number; spendCents: number | null; state: 'no_campaign' | 'cost_unknown' | 'known' }; incrementalLift: 'unverified' };
type OfferBranchRow = { branchId: string | null; branchName: string | null; redemptions: number; uniqueCustomers: number; discountCents: number; associatedTickets: number; associatedRevenueCents: number };
export function RoiExplained({ roi, byBranch }: { roi: OfferRoiView; byBranch: OfferBranchRow[] }) {
  const sp = roi.campaignSpend;
  return <div data-testid="dd-roi">
    <h4 className="fk-sub">{tx('cp.roi.title')}</h4>
    <dl className="fk-dl mo-dl">
      <dt>{tx('cp.roi.revenue')}</dt><dd data-testid="roi-revenue">{fmtMoney(roi.associatedRevenueCents)} · {tx('cp.roi.tickets', { n: nf(roi.associatedTickets) })}</dd>
      <dt>{tx('cp.roi.discount')}</dt><dd data-testid="roi-discount">{fmtMoney(roi.discountCostCents)}</dd>
      <dt>{tx('cp.roi.spend')}</dt><dd data-testid="roi-spend">{sp.state === 'known' && sp.spendCents != null ? tx('cp.roi.spendKnown', { a: fmtMoney(sp.spendCents), n: nf(sp.campaigns), m: nf(sp.messagesSent) })
        : sp.state === 'cost_unknown' ? tx('cp.roi.spendUnknown', { c: nf(sp.messagesCosted), m: nf(sp.messagesSent) }) : tx('cp.roi.noCampaign')}</dd>
      <dt>{tx('cp.roi.lift')}</dt><dd data-testid="roi-lift">{tx('cp.roi.liftUnverified')}</dd>
    </dl>
    {byBranch.length ? <>
      <h4 className="fk-sub">{tx('cp.roi.branches')}</h4>
      <table className="fk-table" data-testid="roi-branches"><thead><tr><th scope="col">{tx('cp.roi.branch')}</th><th scope="col">{tx('dsc.tot.events')}</th><th scope="col">{tx('cp.roi.customers')}</th><th scope="col">{tx('cp.roi.discount')}</th><th scope="col">{tx('cp.roi.revenue')}</th></tr></thead>
        <tbody>{byBranch.map((b) => <tr key={b.branchId ?? 'none'} data-testid="roi-branch-row"><th scope="row">{b.branchName ?? tx('cp.roi.noBranch')}</th><td>{nf(b.redemptions)}</td><td>{nf(b.uniqueCustomers)}</td><td>{fmtMoney(b.discountCents)}</td><td>{fmtMoney(b.associatedRevenueCents)} · {tx('cp.roi.tickets', { n: nf(b.associatedTickets) })}</td></tr>)}</tbody></table>
    </> : null}
  </div>;
}

export function Campaigns({ dealId }: { dealId: string }) {
  const c = useLoad(() => posCouponsApi.campaigns(dealId), [dealId]);
  if (c.error) return <StateBlock error={c.error} onRetry={c.reload} />;
  if (!c.data) return <div className="fk-loading">{tx('pos.loading')}</div>;
  return <>{c.data.items.length === 0 ? <Empty title={tx('cp.noCampaigns')} /> : <ul className="fk-list dense">{c.data.items.map((r: any) => <li key={r.campaignId} className="fk-li"><span className="fk-li-t">{r.name}</span><span className="fk-li-s">{r.channel.toUpperCase()} · {statusLabel(['deal', 'state'], r.status)} · {tx('cp.codesLinked', { n: nf(r.codes) })}</span></li>)}</ul>}
    <div className="fk-hint">{tx('cp.campaignNote')}</div></>;
}

/** The read-only checker (Checkout's own engine). Deals & Offers reuses it with its own endpoint, subtitle and no code box. */
export function CheckDialog({ dealId, name, services, onClose, check = posCouponsApi.check, subtitle, showCode = true, doneNote }: { dealId: string; name: string; services: { id: string; name: string }[]; onClose: () => void;
  check?: (dealId: string, body: { ticketNumber?: string | null; serviceIds?: string[]; spendCents?: number | null; codeEntered?: boolean; customerId?: string | null }) => Promise<CouponCheck>; subtitle?: string; showCode?: boolean; doneNote?: string }) {
  const [ticket, setTicket] = useState(''); const [spend, setSpend] = useState(''); const [svc, setSvc] = useState<string[]>([]); const [code, setCode] = useState(true);
  const [res, setRes] = useState<CouponCheck | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  // audit B2 (Nov 4 2026): a hypothetical check can name the customer (new-customer-only and once-per-customer rules need one)
  const [cust, setCust] = useState<{ id: string; name: string } | null>(null); const [cq, setCq] = useState(''); const dcq = useDebounced(cq.trim(), 250);
  const [hits, setHits] = useState<{ id: string; name: string; phone: string | null }[]>([]);
  useEffect(() => {
    let alive = true; if (dcq.length < 2 || cust) { setHits([]); return; }
    (posCustomersApi.quickSearch(dcq) as Promise<any>).then((r) => { if (!alive) return; const items = Array.isArray(r) ? r : r?.items ?? r?.customers?.items ?? [];
      setHits(items.slice(0, 6).map((c: any) => ({ id: String(c.customerId ?? c.id), name: String(c.fullName ?? c.displayName ?? ''), phone: c.phone ?? null }))); }).catch(() => alive && setHits([]));
    return () => { alive = false; };
  }, [dcq, cust]);
  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await check(dealId, ticket.trim() ? { ticketNumber: ticket.trim(), codeEntered: showCode && code } : { spendCents: parseDollarsToCents(spend) ?? 0, serviceIds: svc, codeEntered: showCode && code, customerId: cust?.id ?? null })); }
    catch (e) { setErr(errorTextOf(e, tx('cp.failed'))); } finally { setBusy(false); }
  };
  return <FitDialog title={tx('cp.checkTitle', { name })} subtitle={subtitle ?? tx('cp.checkSub')} onClose={onClose} testId="dlg-check"
    footer={<><button type="button" className="fk-btn primary" onClick={run} disabled={busy} data-testid="check-run">{busy ? tx('pos.loading') : tx('cp.checkRun')}</button><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
    <div className="cp-form">
      <label className="lf"><span>{tx('cp.ticketNumber')}</span><input className="fk-input" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="#1042" data-testid="check-ticket" /></label>
      <div className="fk-hint">{tx('cp.orHypothetical')}</div>
      <label className="lf"><span>{tx('cp.spend')}</span><input className="fk-input" inputMode="decimal" value={spend} onChange={(e) => setSpend(e.target.value)} disabled={!!ticket.trim()} data-testid="check-spend" /></label>
      <fieldset className="cp-svcs" disabled={!!ticket.trim()}><legend>{tx('cp.services')}</legend>
        {services.slice(0, 30).map((s) => <label key={s.id} className="cp-chk"><input type="checkbox" checked={svc.includes(s.id)} onChange={(e) => setSvc((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))} />{s.name}</label>)}</fieldset>
      <label className="lf"><span>{tx('cp.checkCustomer')}</span>
        {cust ? <span className="fk-chip info" data-testid="check-customer">{cust.name}<button type="button" className="fk-chip-x" aria-label={tx('pos.cancel')} onClick={() => setCust(null)} disabled={!!ticket.trim()}>✕</button></span>
          : <input className="fk-input" type="search" value={cq} onChange={(e) => setCq(e.target.value)} disabled={!!ticket.trim()} placeholder={tx('cp.checkCustomerPh')} data-testid="check-customer-find" />}</label>
      {!cust && hits.length ? <ul className="fk-pick" data-testid="check-customer-hits">{hits.map((h) => <li key={h.id}><button type="button" onClick={() => { setCust({ id: h.id, name: h.name }); setCq(''); }} data-testid="check-customer-option"><b>{h.name}</b><span>{h.phone ?? ''}</span></button></li>)}</ul> : null}
      {showCode ? <label className="cp-chk"><input type="checkbox" checked={code} onChange={(e) => setCode(e.target.checked)} data-testid="check-code" />{tx('cp.codeEntered')}</label> : null}
    </div>
    {err ? <div className="fk-note bad" role="alert">{err}</div> : null}
    {res ? <div className="cp-verdict" data-testid="check-result">
      <span className={'fk-chip ' + (res.eligible ? 'ok' : 'warn')} data-testid="check-verdict">{tx('cp.v.' + res.verdict)}</span>
      {res.eligible ? <b data-testid="check-discount">{tx('cp.wouldTake', { v: fmtMoney(res.discountPreviewCents), b: fmtMoney(res.eligibleBaseCents) })}</b> : null}
      <div className="fk-hint">{tx('cp.va.' + res.verdict)}</div>
      {res.reasons.length ? <ul className="fk-list dense">{res.reasons.map((r, i) => <li key={i} className="fk-li"><span className="fk-li-t">{tx('cp.v.' + r.code)}</span><span className="fk-li-s">{r.message}</span></li>)}</ul> : null}
      {res.stacking ? <div data-testid="check-stacking">
        <div className="fk-li-t" style={{ marginTop: 8 }}>{tx('cp.stk.title', { m: tx('cp.stk.mode.' + res.stacking.mode) })}</div>
        <ul className="fk-list dense">{res.stacking.rows.map((r) => (
          <li key={r.benefit} className="fk-li" data-testid={'stk-' + r.benefit}>
            <span className="fk-li-t">{tx('cp.stk.b.' + r.benefit)} <span className={'fk-chip ' + (r.combines === 'yes' ? 'ok' : r.combines === 'no' ? 'warn' : '')}>{tx('cp.stk.a.' + r.combines)}</span></span>
            <span className="fk-li-s">{tx('cp.stk.r.' + r.benefit + '.' + r.reason, { v: r.value == null ? '—' : String(r.value) })}</span>
          </li>))}</ul>
      </div> : null}
      <div className="fk-hint">{tx('cp.readOnlyCheck')}</div>
      {doneNote ? <div className="fk-hint" data-testid="check-logged">{doneNote}</div> : null}
    </div> : null}
  </FitDialog>;
}

export function DuplicateDialog({ id, name, onClose, onDone }: { id: string; name: string; onClose: () => void; onDone: (v: any) => void }) {
  const [title, setTitle] = useState(`${name} (copy)`); const [code, setCode] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(null); try { onDone(await posCouponsApi.duplicate(id, { title: title.trim() || null, code: code.trim() || null })); } catch (e) { setErr(errorTextOf(e, tx('cp.failed'))); } finally { setBusy(false); } };
  return <FitDialog title={tx('cp.duplicateTitle', { name })} subtitle={tx('cp.duplicateSub')} onClose={onClose} testId="dlg-duplicate"
    footer={<><button type="button" className="fk-btn primary" onClick={go} disabled={busy} data-testid="dup-save">{tx('cp.duplicate')}</button><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.cancel')}</button></>}>
    <div className="cp-form">
      <label className="lf"><span>{tx('dsc.f.name')}</span><input className="fk-input" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="dup-title" /></label>
      <label className="lf"><span>{tx('cp.newCode')}</span><input className="fk-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="dup-code" /></label>
      {err ? <div className="fk-note bad" role="alert">{err}</div> : null}
    </div>
  </FitDialog>;
}

/** Suggest → edit → save as a DRAFT. Deals & Offers reuses it with its own endpoints, title and no code (a salon deal has none). */
export function AssistantDialog({ services, onClose, onDone, api = posCouponsApi, title, withCode = true }: { services: { id: string; name: string }[]; onClose: () => void; onDone: (v: any) => void;
  api?: { suggest: (goal: CouponAssistGoal) => Promise<any>; draft: (body: Record<string, unknown>) => Promise<any> }; title?: string; withCode?: boolean }) {
  const [goal, setGoal] = useState<CouponAssistGoal>('slow_weekdays'); const [s, setS] = useState<any | null>(null);
  const [name, setName] = useState(''); const [pct, setPct] = useState(''); const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const suggest = async () => { setBusy(true); setErr(null); setS(null); try { const r = await api.suggest(goal); setS(r); setName(r.terms.title); setPct(String(r.terms.discountPercent ?? '')); } catch (e) { setErr(errorTextOf(e, tx('cp.failed'))); } finally { setBusy(false); } };
  const save = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.draft({ goal, title: name.trim(), discountPercent: pct === '' ? null : Number(pct), ...(withCode ? { code: code.trim() || null } : {}) }); onDone(r.deal); }
    catch (e) { setErr(errorTextOf(e, tx('cp.failed'))); } finally { setBusy(false); }
  };
  const svcName = (id: string) => services.find((x) => x.id === id)?.name ?? id.slice(0, 8);
  return <FitDialog wide title={title ?? tx('cp.assistant')} subtitle={tx('cp.assistSub')} onClose={onClose} testId="dlg-assistant"
    footer={<>{s ? <button type="button" className="fk-btn primary" onClick={save} disabled={busy || !name.trim()} data-testid="assist-save">{tx('cp.assistSave')}</button> : null}<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
    <div className="cp-form">
      <label className="lf"><span>{tx('cp.goal')}</span><select className="fk-select" value={goal} onChange={(e) => { setGoal(e.target.value as CouponAssistGoal); setS(null); }} data-testid="assist-goal">{GOALS.map((g) => <option key={g} value={g}>{tx('cp.goal.' + g)}</option>)}</select></label>
      <button type="button" className="fk-btn" onClick={suggest} disabled={busy} data-testid="assist-suggest">{busy && !s ? tx('pos.loading') : tx('cp.suggest')}</button>
    </div>
    {err ? <div className="fk-note bad" role="alert">{err}</div> : null}
    {s ? <div className="cp-suggestion" data-testid="assist-result">
      <p className="rt-p">{s.explanation}</p>
      <dl className="fk-dl mo-dl">
        <dt>{tx('dsc.f.name')}</dt><dd><input className="fk-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="assist-title" /></dd>
        <dt>{tx('cp.percentOff')}</dt><dd><input className="fk-input" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} data-testid="assist-pct" /></dd>
        {withCode ? <><dt>{tx('cp.newCode')}</dt><dd><input className="fk-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} data-testid="assist-code" /></dd></> : null}
        {s.terms.daysOfWeek?.length ? <><dt>{tx('dsc.e.days')}</dt><dd>{s.terms.daysOfWeek.map((d: number) => tx('dsc.dow.' + ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d])).join(', ')}</dd></> : null}
        {s.terms.serviceIds?.length ? <><dt>{tx('cp.services')}</dt><dd>{s.terms.serviceIds.map(svcName).join(', ')}</dd></> : null}
        <dt>{tx('pos.valid')}</dt><dd>{day(s.terms.startsAt)} – {day(s.terms.endsAt)} · {tx('cp.onePerCustomer')}</dd>
        {s.eligibleCustomers != null ? <><dt>{tx('cp.eligibleCustomers')}</dt><dd>{nf(s.eligibleCustomers)}</dd></> : null}
        {s.exposure ? <><dt>{tx('cp.exposure')}</dt><dd>{fmtMoney(s.exposure.maxDiscountIfRepeatedCents)} <span className="fk-muted">· {tx('cp.exposureNote', { n: nf(s.exposure.visitsInBasis) })}</span></dd></> : null}
      </dl>
      <div className="fk-hint">{s.uncertainty}</div>
      {Array.isArray(s.safety) && s.safety.length ? <ul className="fk-list dense" data-testid="assist-safety">{s.safety.map((f: any) => <li key={f.key} className="fk-li" data-testid={'assist-flag-' + f.key}>
        <span className={'fk-chip ' + (f.level === 'ok' ? 'ok' : f.level === 'warn' ? 'warn' : 'mut')}>{tx('promo.flag.' + f.level)}</span><span className="fk-li-t">{tx('promo.flagKey.' + f.key)}</span><span className="fk-li-s">{f.detail}</span></li>)}</ul> : null}
      {s.messagePreview ? <div className="promo-preview" data-testid="assist-message"><b>{tx('promo.msgPreview')}</b><p className="rt-p">{s.messagePreview.sms}</p><div className="fk-hint">{s.messagePreview.note}</div></div> : null}
      <div className="fk-hint"><b>{tx('cp.assistSafety')}</b></div>
    </div> : null}
  </FitDialog>;
}

/** a CSV the server built, saved by the browser (no print; the file is the export) */
function saveText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
