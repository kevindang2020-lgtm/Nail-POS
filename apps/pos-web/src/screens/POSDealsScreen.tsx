// POSDealsScreen.tsx — Marketing & Growth → Deals & Offers (/tenant/marketing/deals). Deals & Offers guide (Oct 30 2026),
// rebuilt IN PLACE over the one deals engine (BUILD_PLAN Phase 5): nothing the owner had is gone — New Deal (the five-step
// wizard), every deal row with its quick Pause / Resume, Edit, version history, a coupon's codes, the dashboard and the
// technician-deal settings — and the guide's additions are on top:
//   header   Refresh · Check Deal System · Deals Assistant · New Deal
//   cards    Total · Active · Pending approval · Redemptions · Expiring soon · Discount value used (all from the server)
//   policy   "Technician deals: On — manager approval required · Max 10%" with Edit settings (enforced server-side)
//   find     one search box (deal, technician, service, customer who used it) + status / kind / owner / technician /
//            service / type + Today · Week · Month · Year · Custom month calendar with an explicit date basis
//   tabs     Deals (numbered pages 10/20/50, newest created first) · Approvals (oldest waiting first, full decision
//            overlay: Approve / Reject / Request Changes / Close) · Redemption History · Performance · System health · Settings
//   details  overview, eligibility, limits, services, redemptions, approvals & policy, performance, versions; Check / Edit /
//            Duplicate / lifecycle actions. The checker is Checkout's own engine and changes nothing.
// Money is the server's (integer cents). A technician deal is never decided by its own proposer (server rule DEAL_SELF_APPROVAL).
import { HealthRunHistory } from '../components/HealthRunHistory';
import { authApi } from '../api/authApi';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posDealsApi, type DealView, type DealSettings } from '../api/posDealsApi';
import { posDealsOffersApi } from '../api/posDealsOffersApi';
import { posServicesApi } from '../api/posServicesApi';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { DiscountDetailsDialog, RedemptionsTable, TONE, life, pageOf, discountLabel, usageLabel, whenTime } from './POSDiscountsScreen';
import { CheckDialog, AssistantDialog, DuplicateDialog, SizePicker, healthTone } from './POSCouponsScreen';
import { DealWizard } from './deals/DealWizard';
import { DealCouponsPanel } from './deals/DealCouponsPanel';
import { DealsDashboard } from './deals/DealsDashboard';
import { DealsSettingsPanel } from './deals/DealsSettingsPanel';
import { CommissionImpactPanel } from './deals/CommissionImpactPanel';

type Tab = 'library' | 'approvals' | 'redemptions' | 'performance' | 'health' | 'settings';
const TABS: Tab[] = ['library', 'approvals', 'redemptions', 'performance', 'health', 'settings'];
const STATUSES = ['live', 'active', 'scheduled', 'pending', 'paused', 'draft', 'expired', 'exhausted', 'archived', 'all'];
const KINDS = ['all', 'deal', 'coupon', 'automatic', 'announcement'];
const OWNERS = ['all', 'salon', 'technician'];
const BASES = ['created', 'updated', 'starts', 'ends', 'approved', 'redeemed', 'active'];
const RSTATES = ['confirmed', 'pending', 'released', 'reversed', 'all'];
const ORDERS = ['oldest', 'start', 'newest'];
const nf = (n: number) => fmtNumber(n || 0);
const day = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
/** the lifecycle actions the deal's status allows (the server's DEAL machine refuses anything else) */
const ACTIONS: Record<string, string[]> = { draft: ['submit', 'cancel'], pending_approval: ['approve', 'request_changes', 'reject'], approved: ['publish', 'cancel'], scheduled: ['cancel'],
  active: ['pause', 'cancel'], paused: ['resume', 'cancel'], sold_out: ['archive'], expired: ['archive'], canceled: ['archive'], rejected: ['archive'] };
const priceLine = (p: any) => (p.originalPriceCents != null && p.finalPriceCents != null && p.finalPriceCents !== p.originalPriceCents
  ? `${fmtMoney(p.originalPriceCents)} → ${fmtMoney(p.finalPriceCents)}` : null);
const pct = (p: { discountType: string; discountPercent: number | null; discountCents: number | null }) => (p.discountType === 'percent' ? `${p.discountPercent ?? 0}%` : fmtMoney(p.discountCents ?? 0));

/** extras (Deals & Offers 07): a proposal still waiting for a manager when its start time is near (≤ 48 h) or already
 *  passed is flagged — it is never auto-approved; the manager still decides */
export function approvalUrgency(startsAt: string | null | undefined, now: number): { kind: 'soon' | 'passed'; hours: number } | null {
  if (!startsAt) return null;
  const ms = Date.parse(startsAt) - now; if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return { kind: 'passed', hours: 0 };
  const hours = Math.ceil(ms / 3600000);
  return hours <= 48 ? { kind: 'soon', hours } : null;
}

export function POSDealsScreen() {
  const nav = useNavigate(); const can = useCan();
  const canManage = can('pos.marketing.manage') || can('marketing.manage');
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'library';
  const setParam = (k: string, v: string | null, dflt: string) => { const p = new URLSearchParams(params); if (v == null || v === dflt) p.delete(k); else p.set(k, v); setParams(p, { replace: true }); };
  const setTab = (t: Tab) => setParam('tab', t, 'library');
  const pick = (k: string, list: string[], dflt: string) => (list.includes(params.get(k) ?? '') ? params.get(k)! : dflt);
  const status = pick('status', STATUSES, 'live'); const kind = pick('kind', KINDS, 'all'); const owner = pick('owner', OWNERS, 'all');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [type, setType] = useState('all'); const [serviceId, setServiceId] = useState(''); const [technicianId, setTechnicianId] = useState('');
  const [basis, setBasis] = useState('created'); const [redState, setRedState] = useState('confirmed'); const [order, setOrder] = useState('oldest');
  const [periods, setPeriods] = useState<Record<'library' | 'redemptions', PeriodState>>({ library: { preset: 'all' }, redemptions: { preset: 'all' } });
  const pKey = tab === 'redemptions' ? 'redemptions' : 'library';
  const [page, setPage] = useState(1); const [rpage, setRpage] = useState(1); const [apage, setApage] = useState(1); const [size, setSize] = useState(10);
  const [tick, setTick] = useState(0); const refresh = () => setTick((n) => n + 1);
  const [detail, setDetail] = useState<{ id: string; tab?: string } | null>(null);
  const [checking, setChecking] = useState<{ id: string; name: string } | null>(null);
  const [wizard, setWizard] = useState<{ editing: DealView | null } | null>(null);
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);
  const [assistant, setAssistant] = useState(false);
  const [deciding, setDeciding] = useState<any | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [techs, setTechs] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { (posServicesApi.list() as Promise<any>).then((r) => setServices((Array.isArray(r) ? r : r?.items ?? r?.services ?? []).map((s: any) => ({ id: String(s.id ?? s.serviceId), name: String(s.name) })))).catch(() => setServices([])); }, []);
  useEffect(() => { (posTechniciansApi.list({ pageSize: 100 }) as Promise<any>).then((r) => setTechs((Array.isArray(r) ? r : r?.items ?? r?.technicians ?? []).map((x: any) => ({ id: String(x.id ?? x.technicianId), name: String(x.fullName ?? x.displayName ?? x.name ?? '') })).filter((x: any) => x.name))).catch(() => setTechs([])); }, []);

  // Deals guide (Nov 4 2026): a location filter on every list, and the redemption date basis (applied / ticket paid)
  const [branchId, setBranchId] = useState(''); const [redBasis, setRedBasis] = useState('redeemed');
  const branches = useLoad(() => authApi.branches().then((r: any) => (r.branches ?? []).filter((b: any) => b.isActive)), []);
  const libScope = { q: q || undefined, status, kind, ownerType: owner, type, serviceId: serviceId || undefined, technicianId: technicianId || undefined, dateField: basis, branchId: branchId || undefined, ...periodQuery(periods.library) };
  const redScope = { q: q || undefined, state: redState, branchId: branchId || undefined, dateField: redBasis, ...periodQuery(periods.redemptions) };
  const [aprPeriod, setAprPeriod] = useState<PeriodState>({ preset: 'all' });
  const aprScope = { q: q || undefined, order, branchId: branchId || undefined, ...periodQuery(aprPeriod) };
  const libKey = JSON.stringify([libScope, size]); const redKey = JSON.stringify([redScope, size]); const aprKey = JSON.stringify([aprScope, size]);
  useEffect(() => setPage(1), [libKey]); useEffect(() => setRpage(1), [redKey]); useEffect(() => setApage(1), [aprKey]);
  const kpis = useLoad(() => posDealsOffersApi.kpis(), [tick]);
  const list = useLoad(() => (tab === 'library' ? posDealsOffersApi.library({ ...libScope, page, pageSize: size }) : Promise.resolve(null)), [tab, libKey, page, tick]);
  const apr = useLoad(() => (tab === 'approvals' ? posDealsOffersApi.approvals({ ...aprScope, page: apage, pageSize: size }) : Promise.resolve(null)), [tab, aprKey, apage, tick]);
  const reds = useLoad(() => (tab === 'redemptions' ? posDealsOffersApi.redemptions({ ...redScope, page: rpage, pageSize: size }) : Promise.resolve(null)), [tab, redKey, rpage, tick]);
  const health = useLoad(() => (tab === 'health' ? posDealsOffersApi.health() : Promise.resolve(null)), [tab, tick]);
  const settings = useLoad(() => (tab === 'settings' ? posDealsApi.getSettings() as Promise<DealSettings> : Promise.resolve(null)), [tab, tick]);
  useEffect(() => { const p = list.data?.page; if (p && p !== page) setPage(p); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const p = reds.data?.page; if (p && p !== rpage) setRpage(p); }, [reds.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const p = apr.data?.page; if (p && p !== apage) setApage(p); }, [apr.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const libFiltered = status !== 'live' || kind !== 'all' || owner !== 'all' || type !== 'all' || !!serviceId || !!technicianId || periods.library.preset !== 'all';
  const filtered = !!(branchId || q || (tab === 'library' && libFiltered) || (tab === 'redemptions' && (redState !== 'confirmed' || periods.redemptions.preset !== 'all')) || (tab === 'approvals' && order !== 'oldest'));
  const clearAll = () => {
    setBranchId(''); setRedBasis('redeemed'); setAprPeriod({ preset: 'all' }); setSearch(''); setType('all'); setServiceId(''); setTechnicianId(''); setBasis('created'); setRedState('confirmed'); setOrder('oldest');
    setPeriods({ library: { preset: 'all' }, redemptions: { preset: 'all' } });
    const p = new URLSearchParams(params); ['status', 'kind', 'owner'].forEach((k) => p.delete(k)); setParams(p, { replace: true });
  };
  /** a new / duplicated / assistant draft: Page 1 of the library, newest first; say so when the filters hide it */
  const afterCreate = (v: { id: string; title?: string }, key: string) => {
    setTab('library'); setPage(1); refresh();
    const hidden = !!(q || type !== 'all' || serviceId || technicianId || kind !== 'all' || owner !== 'all' || periods.library.preset !== 'all' || !['live', 'all', 'draft'].includes(status));
    setNote({ tone: 'ok', text: tx(key, { name: String(v.title ?? '') }) + (hidden ? ' ' + tx('cp.hiddenByFilters') : '') });
    setDetail({ id: v.id });
  };
  const quick = async (p: any, action: 'pause' | 'resume') => {
    setBusy(p.id + action);
    try { await (action === 'pause' ? posDealsApi.pause(p.id) : posDealsApi.resume(p.id)); setNote({ tone: 'ok', text: tx('do.did.' + action, { name: p.name }) }); refresh(); }
    catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('cp.failed')) }); } finally { setBusy(null); }
  };
  const k = kpis.data;
  if (isForbidden(kpis.error)) return <div className="work dsc" data-testid="deals-screen"><h1>{tx('pos.deals_offers')}</h1><StateBlock error={kpis.error} onRetry={kpis.reload} /></div>;
  const server = tab === 'redemptions' ? reds.data?.period : list.data?.period;
  const pol = k?.techPolicy;

  return (
    <div className="work dsc cp do" data-testid="deals-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.deals_offers')}</h1><div className="sub">{tx('do.subtitle')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={refresh} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setTab('health')} data-testid="check-system">{tx('do.checkSystem')}</button>
          {canManage ? <button type="button" className="fk-btn ghost" onClick={() => setAssistant(true)} data-testid="assistant">{tx('do.assistant')}</button> : null}
          {canManage ? <button type="button" className="fk-btn primary" onClick={() => setWizard({ editing: null })} data-testid="new-deal">{tx('pos.new_deal')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <div className="fk-kpis six cp-kpis" data-testid="kpis">
        <KpiCard testId="kpi-total" label={tx('cp.kpi.total')} loading={!k} value={k ? nf(k.total) : ''} sub={k ? tx('do.kpi.totalSub', { a: nf(k.split.archived) }) : ''} onClick={() => setParam('status', 'all', 'live')} />
        <KpiCard testId="kpi-active" tone="ok" label={tx('cp.kpi.active')} loading={!k} value={k ? nf(k.activeDiscounts) : ''} sub={k ? tx('dsc.kpi.activeSub', { s: nf(k.split.scheduled), p: nf(k.split.paused) }) : ''} onClick={() => setParam('status', 'active', 'live')} />
        <KpiCard testId="kpi-pending" tone={k && k.pendingApproval ? 'warn' : undefined} label={tx('do.kpi.pending')} loading={!k} value={k ? nf(k.pendingApproval) : ''} sub={k ? tx('do.kpi.pendingSub', { t: nf(k.pendingTechnician) }) : ''} onClick={() => setTab('approvals')} />
        <KpiCard testId="kpi-redemptions" tone="gold" label={tx('pos.redemptions')} loading={!k} value={k ? nf(k.ledger.confirmedEvents) : ''} sub={k ? tx('cp.kpi.redSub', { p: nf(k.ledger.pendingAtCheckout) }) : ''} onClick={() => setTab('redemptions')} />
        <KpiCard testId="kpi-expiring" tone={k && k.expiringSoon > 0 ? 'warn' : undefined} label={tx('pos.expiring_soon')} loading={!k} value={k ? nf(k.expiringSoon) : ''} sub={k ? tx('dsc.kpi.expSub', { n: nf(k.expiringWindowDays) }) : ''} />
        <KpiCard testId="kpi-value" label={tx('cp.kpi.value')} loading={!k} value={k ? fmtMoney(k.ledger.savingsCents) : ''} sub={k ? tx('cp.kpi.valueSub', { g: fmtMoney(k.ledger.grossDiscountCents ?? 0), r: fmtMoney(k.ledger.reversedCents ?? 0) }) : ''} />
      </div>

      {pol ? <div className="do-policy" data-testid="tech-policy">
        <span className="do-policy-t">{tx('do.techDeals')}</span>
        <span className={'fk-chip ' + (pol.allowTechnicianDeals === 'off' ? 'mut' : 'ok')} data-testid="tech-policy-state">{tx('do.policy.' + pol.allowTechnicianDeals)}</span>
        <span className="do-policy-s" data-testid="tech-policy-cap">{tx('do.maxTech', { v: pol.maxDiscountPercent == null ? tx('do.noCap') : `${pol.maxDiscountPercent}%` })}{pol.maxFixedDiscountCents != null ? ` · ${tx('do.maxFixed', { v: fmtMoney(pol.maxFixedDiscountCents) })}` : ''}</span>
        <span className="fk-hint">{tx('do.policyNote')}</span>
        {canManage ? <button type="button" className="fk-link" onClick={() => setTab('settings')} data-testid="edit-policy">{tx('do.editSettings')}</button> : null}
      </div> : null}

      {tab !== 'health' && tab !== 'settings' && tab !== 'performance' ? <div className="dsc-tools" data-testid="toolbar">
        <div className="fn-search dsc-search"><input className="fk-input fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx(tab === 'redemptions' ? 'do.searchRed' : tab === 'approvals' ? 'do.searchApr' : 'do.searchLib')} aria-label={tx(tab === 'redemptions' ? 'do.searchRed' : tab === 'approvals' ? 'do.searchApr' : 'do.searchLib')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        {tab === 'library' ? <>
          <select className="fk-select" value={status} onChange={(e) => setParam('status', e.target.value, 'live')} aria-label={tx('pos.status')} data-testid="status">{STATUSES.map((s) => <option key={s} value={s}>{tx(s === 'pending' ? 'do.status.pending' : 'dsc.status.' + s)}</option>)}</select>
          <select className="fk-select" value={kind} onChange={(e) => setParam('kind', e.target.value, 'all')} aria-label={tx('do.kind')} data-testid="kind">{KINDS.map((s) => <option key={s} value={s}>{tx('do.kind.' + s)}</option>)}</select>
          <select className="fk-select" value={owner} onChange={(e) => setParam('owner', e.target.value, 'all')} aria-label={tx('do.owner')} data-testid="owner">{OWNERS.map((s) => <option key={s} value={s}>{tx('do.owner.' + s)}</option>)}</select>
          <select className="fk-select" value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} aria-label={tx('pos.technician')} data-testid="technician"><option value="">{tx('do.anyTech')}</option>{techs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="fk-select" value={serviceId} onChange={(e) => setServiceId(e.target.value)} aria-label={tx('cp.service')} data-testid="service"><option value="">{tx('cp.anyService')}</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="fk-select" value={type} onChange={(e) => setType(e.target.value)} aria-label={tx('dsc.type')} data-testid="type">{['all', 'percent', 'fixed'].map((s) => <option key={s} value={s}>{tx('dsc.type.' + s)}</option>)}</select>
        </> : null}
        {tab === 'redemptions' ? <select className="fk-select" value={redState} onChange={(e) => setRedState(e.target.value)} aria-label={tx('pos.status')} data-testid="red-state">{RSTATES.map((s) => <option key={s} value={s}>{tx('dsc.rstate.' + s)}</option>)}</select> : null}
        {tab === 'approvals' ? <select className="fk-select" value={order} onChange={(e) => setOrder(e.target.value)} aria-label={tx('do.order')} data-testid="apr-order">{ORDERS.map((s) => <option key={s} value={s}>{tx('do.order.' + s)}</option>)}</select> : null}
        {(branches.data?.length ?? 0) > 1 ? <select className="fk-select" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label={tx('cp.location')} data-testid="branch">
          <option value="">{tx('cp.allLocations')}</option>{(branches.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select> : null}
        {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div> : null}
      {tab === 'approvals' ? <div data-testid="apr-period"><PeriodBar compact allowAll value={aprPeriod} onChange={setAprPeriod} server={apr.data?.period} basis="requested" basisOptions={[{ value: 'requested', label: tx('do.aprRequested') }]} /></div> : null}
      {tab === 'library' || tab === 'redemptions' ? <PeriodBar compact allowAll value={periods[pKey]} onChange={(p) => setPeriods((x) => ({ ...x, [pKey]: p }))} server={server}
        basis={tab === 'library' ? basis : redBasis} onBasis={tab === 'library' ? setBasis : setRedBasis}
        basisOptions={tab === 'library' ? BASES.map((b) => ({ value: b, label: tx('do.basis.' + b) })) : ['redeemed', 'applied', 'finalized'].map((b) => ({ value: b, label: tx(b === 'redeemed' ? 'dsc.df.redeemed' : 'cp.redBasis.' + b) }))} /> : null}

      <div className="fk-seg inv2-tabseg" role="tablist" aria-label={tx('pos.deals_offers')} data-testid="do-tabs">
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'tab-' + t}>
          {tx('do.tab.' + t)}{t === 'approvals' && k && k.pendingApproval ? <span className="do-count">{nf(k.pendingApproval)}</span> : null}</button>)}
      </div>

      {tab === 'library' ? <FitPanel testId="deals-list" title={<>{tx('do.library')}{list.data ? <span className="fk-muted"> · {tx('dsc.matching', { n: nf(list.data.totalItems) })}</span> : null}{periods.library.preset !== 'all' ? <span className="fk-hint dsc-hint">{tx('cp.basisShown', { b: tx('do.basis.' + basis) })}</span> : null}</>}
        footer={<div className="cp-foot"><Pager info={pageOf(list.data)} onPage={setPage} label={tx('do.library')} /><SizePicker size={size} onSize={setSize} /></div>}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : list.data.items.length === 0 ? (filtered ? <Empty title={q ? tx('dsc.noMatchSearch', { q }) : tx('dsc.noMatch')}><button type="button" className="fk-btn" onClick={clearAll} data-testid="empty-clear">{tx('finance.clearFilters')}</button></Empty>
            : <Empty title={tx('pos.nothing_here_yet_create_your_first_1c2a')}>{canManage ? <button type="button" className="fk-btn primary" onClick={() => setWizard({ editing: null })}>{tx('pos.new_deal')}</button> : null}</Empty>)
          : <table className="fk-table fn-table dsc-table" data-testid="deals-table">
            <thead><tr><th>{tx('dsc.f.name')}</th><th>{tx('cp.col.value')}</th><th>{tx('pos.status')}</th><th>{tx('pos.redemptions')}</th><th className="t-opt">{tx('pos.valid')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{list.data.items.map((p: any) => <tr key={p.id} className="inv2-click" onClick={() => setDetail({ id: p.id })} data-testid="deal-row">
              <td><span className="fk-li-t">{p.name}</span>
                <span className="fk-li-s">{tx('do.kind.' + p.kind)} · {p.ownerType === 'technician' ? tx('do.byTech', { t: p.technicianName ?? '—' }) : tx('pos.salon_deal')}{p.matchedVia ? ` · ${tx('do.via.' + p.matchedVia)}` : ''}</span></td>
              <td>{p.kind === 'announcement' ? tx('do.kind.announcement') : discountLabel(p)}{priceLine(p) ? <span className="fk-li-s" data-testid="price-line">{priceLine(p)}</span> : null}{p.minPurchaseCents ? <span className="fk-li-s">{tx('cp.minSpend', { v: fmtMoney(p.minPurchaseCents) })}</span> : null}</td>
              <td><span className={'fk-chip ' + (p.dealStatus === 'pending_approval' ? 'warn' : TONE[p.lifecycle] ?? 'mut')}>{p.dealStatus === 'pending_approval' ? tx('do.status.pending') : life(p.lifecycle)}</span></td>
              <td>{usageLabel(p)}</td>
              <td className="t-opt">{p.endsAt ? tx('cp.ends', { d: day(p.endsAt) }) : tx('pos.no_end_date')}</td>
              <td className="fn-acts" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="fk-btn ghost sm" onClick={() => setDetail({ id: p.id })} data-testid="deal-view">{tx('cp.view')}</button>
                <button type="button" className="fk-btn ghost sm" onClick={() => setChecking({ id: p.id, name: p.name })} data-testid="deal-check">{tx('cp.check')}</button>
                {canManage && p.dealStatus === 'active' ? <button type="button" className="fk-btn sm" disabled={!!busy} onClick={() => quick(p, 'pause')} data-testid="deal-pause">{tx('pos.pause')}</button> : null}
                {canManage && p.dealStatus === 'paused' ? <button type="button" className="fk-btn sm" disabled={!!busy} onClick={() => quick(p, 'resume')} data-testid="deal-resume">{tx('pos.resume')}</button> : null}
              </td></tr>)}</tbody>
          </table>}
      </FitPanel> : null}

      {tab === 'approvals' ? <FitPanel testId="approvals" title={<>{tx('do.tab.approvals')}{apr.data ? <span className="fk-muted"> · {tx('dsc.matching', { n: nf(apr.data.totalItems) })}</span> : null}<span className="fk-hint dsc-hint">{tx('do.order.' + order)}</span></>}
        footer={<div className="cp-foot"><Pager info={pageOf(apr.data)} onPage={setApage} label={tx('do.tab.approvals')} /><SizePicker size={size} onSize={setSize} /></div>}>
        {apr.error ? <StateBlock error={apr.error} onRetry={apr.reload} /> : !apr.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : apr.data.items.length === 0 ? <Empty title={tx('do.noPending')} />
          : <table className="fk-table fn-table dsc-table" data-testid="approvals-table">
            <thead><tr><th>{tx('do.col.requested')}</th><th>{tx('do.col.proposal')}</th><th>{tx('cp.col.value')}</th><th>{tx('do.col.policy')}</th><th className="t-opt">{tx('pos.valid')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{apr.data.items.map((a: any) => <tr key={a.id} className="inv2-click" onClick={() => setDeciding(a)} data-testid="approval-row">
              <td>{whenTime(a.requestedAt)}</td>
              <td><span className="fk-li-t">{a.title}</span><span className="fk-li-s">{a.ownerType === 'technician' ? tx('do.byTech', { t: a.technicianName ?? '—' }) : tx('pos.salon_deal')}{a.services.length ? ` · ${a.services.join(', ')}` : ''}</span>
                {(() => { const u = approvalUrgency(a.startsAt, Date.now()); return u ? <span className={'fk-chip ' + (u.kind === 'passed' ? 'bad' : 'warn')} data-testid="approval-sla">{u.kind === 'passed' ? tx('do.sla.passed') : tx('do.sla.soon', { h: String(u.hours) })}</span> : null; })()}</td>
              <td>{discountLabel(a)}{priceLine(a) ? <span className="fk-li-s">{priceLine(a)}</span> : null}</td>
              <td>{a.policy ? <span className={'fk-chip ' + (a.policy.withinPolicy ? 'ok' : 'bad')} data-testid="approval-policy">{a.policy.withinPolicy ? tx('do.within', { c: a.policy.maxDiscountPercent == null ? tx('do.noCap') : `${a.policy.maxDiscountPercent}%` }) : tx('do.outside')}</span> : <span className="fk-muted">{tx('do.salonRules')}</span>}</td>
              <td className="t-opt">{a.endsAt ? `${day(a.startsAt ?? a.requestedAt)} – ${day(a.endsAt)}` : tx('pos.no_end_date')}</td>
              <td className="fn-acts" onClick={(e) => e.stopPropagation()}><button type="button" className="fk-btn primary sm" onClick={() => setDeciding(a)} data-testid="approval-open">{tx('do.review')}</button></td>
            </tr>)}</tbody>
          </table>}
      </FitPanel> : null}

      {tab === 'approvals' && can('compensation.view_all') ? <CommissionImpactPanel canApprove={can('compensation.manage')} /> : null}

      {tab === 'redemptions' ? <FitPanel testId="redemptions-list" title={<>{tx('do.tab.redemptions')}{reds.data ? <span className="fk-muted"> · {tx('dsc.matching', { n: nf(reds.data.totalItems) })} · {tx('cp.redTotals', { v: fmtMoney(reds.data.totals.savingsCents), c: nf(reds.data.totals.uniqueCustomers) })}</span> : null}</>}
        footer={<div className="cp-foot"><Pager info={pageOf(reds.data)} onPage={setRpage} label={tx('do.tab.redemptions')} /><SizePicker size={size} onSize={setSize} /></div>}>
        {reds.error ? <StateBlock error={reds.error} onRetry={reds.reload} /> : !reds.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : reds.data.items.length === 0 ? <Empty title={q ? tx('dsc.noMatchSearch', { q }) : tx('dsc.noRedemptions')} />
          : <RedemptionsTable rows={reds.data.items} onCoupon={(id) => setDetail({ id, tab: 'redemptions' })} onTicket={(ticketId) => nav(`/tenant/payments/transactions?search=${encodeURIComponent(reds.data.items.find((x: any) => x.ticketId === ticketId)?.ticketNumber ?? ticketId)}`)} onCustomer={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)} />}
      </FitPanel> : null}

      {tab === 'performance' ? <FitPanel testId="performance" title={tx('do.tab.performance')}><DealsDashboard /><div className="fk-hint">{tx('do.perfNote')}</div></FitPanel> : null}

      {tab === 'health' ? <FitPanel testId="health" title={<>{tx('do.tab.health')}{health.data ? <span className={'fk-chip ' + healthTone(health.data.overall)} style={{ marginLeft: 8 }} data-testid="health-overall">{tx('cp.health.' + health.data.overall)}</span> : null}</>}>
        {health.error ? <StateBlock error={health.error} onRetry={health.reload} /> : !health.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
          <ul className="fk-list" data-testid="health-checks">{health.data.checks.map((c: any) => <li key={c.key} className="fk-li" data-testid={'health-' + c.key}>
            <span className={'fk-chip ' + healthTone(c.status)}>{tx('cp.health.' + c.status)}</span>
            <span className="fk-li-t">{tx('do.check.' + c.key)}</span><span className="fk-li-s">{c.detail}</span></li>)}</ul>
          <div className="fk-hint">{tx('cp.healthNote', { t: whenTime(health.data.checkedAt) })}</div>
          <HealthRunHistory run={() => posDealsOffersApi.runHealth()} list={(q) => posDealsOffersApi.healthRuns(q)} checkLabel={(k) => tx('do.check.' + k)} onRan={() => health.reload()} /></>}
      </FitPanel> : null}

      {tab === 'settings' ? (settings.error ? <StateBlock error={settings.error} onRetry={settings.reload} /> : !settings.data ? <div className="fk-loading">{tx('pos.loading')}</div>
        : <DealsSettingsPanel settings={settings.data} onSaved={() => { refresh(); setNote({ tone: 'ok', text: tx('do.settingsSaved') }); }} />) : null}

      {detail ? <DiscountDetailsDialog id={detail.id} initialTab={detail.tab} tick={tick} onClose={() => setDetail(null)}
        onCustomer={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)}
        extras={{
          load: posDealsOffersApi.detail, loadRedemptions: posDealsOffersApi.redemptions,
          tabs: [
            { key: 'approvals', label: tx('do.dtab.approvals'), render: (x) => <ApprovalsHistory x={x} /> },
            { key: 'performance', label: tx('do.dtab.performance'), render: (x) => <Performance x={x} /> },
            { key: 'codes', label: tx('cp.dtab.codes'), render: (x: any) => (x.kind === 'coupon' ? <DealCouponsPanel dealId={x.id} title={x.name} onClose={() => setDetail({ id: x.id })} /> : <div className="fk-hint">{tx('do.noCodes')}</div>) },
          ],
          footer: (x) => <Actions x={x} canManage={canManage} onCheck={() => setChecking({ id: x.id, name: x.name })}
            onEdit={async () => { try { setWizard({ editing: await posDealsApi.get(x.id) as DealView }); setDetail(null); } catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('cp.failed')) }); } }}
            onDuplicate={() => setDup({ id: x.id, name: x.name })}
            onDecide={() => setDeciding({ id: x.id, title: x.name, fromDetail: true })}
            onDone={(text, tone) => { setNote({ tone, text }); refresh(); }} />,
        }} /> : null}

      {deciding ? <DecisionDialog item={deciding} canManage={canManage} onClose={() => setDeciding(null)} onView={(id) => { setDeciding(null); setDetail({ id }); }}
        onDone={(text, tone) => { setDeciding(null); setNote({ tone, text }); refresh(); }} /> : null}
      {checking ? <CheckDialog dealId={checking.id} name={checking.name} services={services} onClose={() => setChecking(null)} check={posDealsOffersApi.check} subtitle={tx('do.checkSub')} showCode={false} /> : null}
      {wizard ? <FitDialog wide title={wizard.editing ? tx('cp.editTitle', { name: wizard.editing.title }) : tx('pos.new_deal')} onClose={() => setWizard(null)} testId="dlg-wizard">
        <DealWizard editing={wizard.editing} onCancel={() => setWizard(null)}
          onDone={(v) => { const editing = !!wizard.editing; setWizard(null); afterCreate(v, editing ? 'cp.saved' : 'do.created'); }} />
      </FitDialog> : null}
      {dup ? <DuplicateDialog id={dup.id} name={dup.name} onClose={() => setDup(null)} onDone={(v) => { setDup(null); setDetail(null); afterCreate(v, 'cp.duplicated'); }} /> : null}
      {assistant ? <AssistantDialog services={services} api={posDealsOffersApi} title={tx('do.assistant')} withCode={false} onClose={() => setAssistant(false)} onDone={(v) => { setAssistant(false); afterCreate(v, 'do.assistDrafted'); }} /> : null}
    </div>
  );
}

function Actions({ x, canManage, onCheck, onEdit, onDuplicate, onDecide, onDone }: { x: any; canManage: boolean; onCheck: () => void; onEdit: () => void; onDuplicate: () => void; onDecide: () => void; onDone: (text: string, tone: 'ok' | 'bad') => void }) {
  const [busy, setBusy] = useState(false);
  const acts = (ACTIONS[x.dealStatus] ?? []).filter((a) => !['approve', 'reject', 'request_changes'].includes(a));
  const run = async (a: string) => {
    setBusy(true);
    const call: Record<string, (id: string) => Promise<unknown>> = { submit: posDealsApi.submit, publish: posDealsApi.publish, pause: posDealsApi.pause, resume: posDealsApi.resume, cancel: posDealsApi.cancel, archive: posDealsApi.archive };
    try { await call[a](x.id); onDone(tx('do.did.' + a, { name: x.name }), 'ok'); }
    catch (e) { onDone(errorTextOf(e, tx('cp.failed')), 'bad'); } finally { setBusy(false); }
  };
  const salon = (x.owner?.ownerType ?? 'salon') === 'salon';
  return <>
    <button type="button" className="fk-btn ghost" onClick={onCheck} data-testid="dd-check">{tx('do.checkEligibility')}</button>
    {canManage ? <>
      {x.dealStatus === 'pending_approval' ? <button type="button" className="fk-btn primary" onClick={onDecide} data-testid="dd-decide">{tx('do.review')}</button> : null}
      {!['canceled', 'archived', 'expired', 'rejected'].includes(x.dealStatus) ? <button type="button" className="fk-btn ghost" onClick={onEdit} disabled={busy} data-testid="dd-edit">{tx('cp.edit')}</button> : null}
      {salon ? <button type="button" className="fk-btn ghost" onClick={onDuplicate} disabled={busy} data-testid="dd-duplicate">{tx('cp.duplicate')}</button> : null}
      {acts.map((a) => <button key={a} type="button" className={'fk-btn ' + (a === 'publish' || a === 'resume' ? 'primary' : 'ghost')} disabled={busy} onClick={() => run(a)} data-testid={'dd-' + a}>{tx('do.act.' + a)}</button>)}
    </> : <span className="fk-hint" data-testid="dd-readonly">{tx('cp.readOnly')}</span>}
  </>;
}

function ApprovalsHistory({ x }: { x: any }) {
  return <div data-testid="dd-approvals-body">
    <dl className="fk-dl mo-dl">
      <dt>{tx('do.owner')}</dt><dd>{x.owner?.ownerType === 'technician' ? tx('do.byTech', { t: x.owner.technicianName ?? '—' }) : tx('pos.salon_deal')}</dd>
      <dt>{tx('do.approvedBy')}</dt><dd>{x.owner?.approvedBy ?? '—'}</dd>
      {x.policy ? <><dt>{tx('do.col.policy')}</dt><dd><span className={'fk-chip ' + (x.policy.withinPolicy ? 'ok' : 'bad')}>{x.policy.withinPolicy ? tx('do.within', { c: x.policy.maxDiscountPercent == null ? tx('do.noCap') : `${x.policy.maxDiscountPercent}%` }) : tx('do.outside')}</span>
        {x.policy.violations.length ? <span className="fk-li-s">{x.policy.violations.join(' ')}</span> : null}</dd></> : <><dt>{tx('do.col.policy')}</dt><dd className="fk-muted">{tx('do.salonRules')}</dd></>}
    </dl>
    {x.approvals.length === 0 ? <div className="fk-hint">{tx('do.noDecisions')}</div>
      : <table className="fk-table fn-table dsc-table"><thead><tr><th>{tx('dsc.col.when')}</th><th>{tx('do.col.decision')}</th><th>{tx('dsc.col.by')}</th><th>{tx('dsc.col.version')}</th><th>{tx('do.col.note')}</th></tr></thead>
        <tbody>{x.approvals.map((a: any) => <tr key={a.id}><td>{whenTime(a.at)}</td><td><span className={'fk-chip ' + (a.decision === 'approved' ? 'ok' : a.decision === 'rejected' ? 'bad' : 'warn')}>{tx('do.decision.' + a.decision)}</span></td><td>{a.actor ?? '—'}</td><td>v{a.version}</td><td>{a.reason ?? ''}</td></tr>)}</tbody></table>}
    <div className="fk-hint">{tx('do.auditNote')}</div>
  </div>;
}

function Performance({ x }: { x: any }) {
  const p = x.performance;
  return <dl className="fk-dl mo-dl" data-testid="dd-performance-body">
    <dt>{tx('do.perf.completed')}</dt><dd><b>{nf(p.completed)}</b></dd>
    <dt>{tx('do.perf.gross')}</dt><dd>{fmtMoney(p.grossDiscountCents)}</dd>
    <dt>{tx('do.perf.reversed')}</dt><dd>{fmtMoney(p.reversedCents)}</dd>
    <dt>{tx('do.perf.net')}</dt><dd><b>{fmtMoney(p.netDiscountCents)}</b></dd>
    <dt>{tx('do.perf.linked')}</dt><dd>{fmtMoney(p.linkedServiceRevenueCents)}</dd>
    <dd className="fk-hint" style={{ gridColumn: '1 / -1' }}>{tx('do.perf.note')}</dd>
  </dl>;
}

/** §9 the full approval overlay: Overview · Eligibility · Comparison to Policy · Approval History · Notes, then Approve /
 *  Reject / Request Changes / Close. The decision itself is the server's (self-approval and today's rules re-checked there). */
function DecisionDialog({ item, canManage, onClose, onView, onDone }: { item: any; canManage: boolean; onClose: () => void; onView: (id: string) => void; onDone: (text: string, tone: 'ok' | 'bad') => void }) {
  const d = useLoad(() => posDealsOffersApi.detail(item.id), [item.id]);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const a = item.fromDetail ? null : item;   // from the inbox: the request row (policy, exposure); from details: the record
  const x = d.data;
  const decide = async (what: 'approve' | 'reject' | 'request_changes') => {
    if (what !== 'approve' && !reason.trim()) { setErr(tx(what === 'reject' ? 'pos.a_rejection_reason_is_required' : 'errors.DEAL_CHANGES_REASON_REQUIRED')); return; }
    setBusy(true); setErr(null);
    try {
      if (what === 'approve') await posDealsApi.approve(item.id, reason.trim() || undefined);
      else if (what === 'reject') await posDealsApi.reject(item.id, reason.trim());
      else await posDealsApi.requestChanges(item.id, reason.trim());
      onDone(tx('do.did.' + what, { name: item.title }), 'ok');
    } catch (e) { setErr(errorTextOf(e, tx('cp.failed'))); } finally { setBusy(false); }
  };
  const own = !!a?.ownProposal;
  const pol = a?.policy ?? x?.policy ?? null;
  return <FitDialog wide title={tx('do.reviewTitle', { name: item.title })} subtitle={tx('do.reviewSub')} onClose={onClose} testId="dlg-decide"
    footer={<>
      {canManage && !own ? <>
        <button type="button" className="fk-btn primary" disabled={busy} onClick={() => decide('approve')} data-testid="decide-approve">{tx('pos.approve')}</button>
        <button type="button" className="fk-btn" disabled={busy} onClick={() => decide('request_changes')} data-testid="decide-changes">{tx('do.act.request_changes')}</button>
        <button type="button" className="fk-btn ghost" disabled={busy} onClick={() => decide('reject')} data-testid="decide-reject">{tx('pos.reject')}</button>
      </> : null}
      <button type="button" className="fk-btn ghost" onClick={() => onView(item.id)} data-testid="decide-view">{tx('do.fullDetails')}</button>
      <button type="button" className="fk-btn ghost" onClick={onClose} data-testid="decide-close">{tx('pos.close')}</button>
    </>}>
    {own ? <div className="fk-note warn" role="note" data-testid="decide-own">{tx('errors.DEAL_SELF_APPROVAL')}</div> : null}
    {err ? <div className="fk-note bad" role="alert" data-testid="decide-error">{err}</div> : null}
    {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <div className="mos-dgrid">
      <section><h3 className="fk-h3">{tx('do.sec.overview')}</h3><dl className="fk-dl mo-dl" data-testid="decide-overview">
        <dt>{tx('do.col.requested')}</dt><dd>{a ? whenTime(a.requestedAt) : '—'}</dd>
        <dt>{tx('do.owner')}</dt><dd>{x.owner?.ownerType === 'technician' ? tx('do.byTech', { t: x.owner.technicianName ?? '—' }) : tx('pos.salon_deal')}</dd>
        <dt>{tx('cp.col.value')}</dt><dd><b>{discountLabel(x)}</b>{priceLine(a ?? x) ? ` · ${priceLine(a ?? x)}` : ''}</dd>
        <dt>{tx('cp.services')}</dt><dd>{x.services.length ? x.services.map((s: any) => s.name).join(', ') : tx('dsc.allItems')}</dd>
        <dt>{tx('dsc.f.scope')}</dt><dd>{x.overview.salonWide ? tx('dsc.salonWide') : x.overview.branch ?? '—'}</dd>
        <dt>{tx('pos.valid')}</dt><dd>{x.startsAt ? day(x.startsAt) : tx('do.now')} – {x.endsAt ? day(x.endsAt) : tx('pos.no_end_date')}</dd>
      </dl></section>
      <section><h3 className="fk-h3">{tx('do.sec.eligibility')}</h3><dl className="fk-dl mo-dl" data-testid="decide-eligibility">
        <dt>{tx('dsc.e.newOnly')}</dt><dd>{x.eligibility.newCustomersOnly ? tx('pos.yes') : tx('pos.no')}</dd>
        <dt>{tx('pos.min_purchase')}</dt><dd>{x.minPurchaseCents > 0 ? fmtMoney(x.minPurchaseCents) : tx('pos.none')}</dd>
        <dt>{tx('pos.usage')}</dt><dd>{usageLabel(x)}</dd>
        <dt>{tx('dsc.l.perCustomer')}</dt><dd>{x.limits.maxPerCustomer == null ? tx('dsc.unlimited') : nf(x.limits.maxPerCustomer)}</dd>
      </dl></section>
      <section><h3 className="fk-h3">{tx('do.sec.policy')}</h3><dl className="fk-dl mo-dl" data-testid="decide-policy">
        {pol ? <>
          <dt>{tx('do.proposed')}</dt><dd><b>{pct(x)}</b></dd>
          <dt>{tx('do.cap')}</dt><dd>{pol.maxDiscountPercent == null ? tx('do.noCap') : `${pol.maxDiscountPercent}%`}{pol.maxFixedDiscountCents != null ? ` · ${fmtMoney(pol.maxFixedDiscountCents)}` : ''}</dd>
          <dt>{tx('do.result')}</dt><dd><span className={'fk-chip ' + (pol.withinPolicy ? 'ok' : 'bad')} data-testid="decide-within">{pol.withinPolicy ? tx('do.within', { c: pol.maxDiscountPercent == null ? tx('do.noCap') : `${pol.maxDiscountPercent}%` }) : tx('do.outside')}</span>
            {pol.violations?.length ? <span className="fk-li-s">{pol.violations.join(' ')}</span> : null}</dd>
          {a?.exposure ? <><dt>{tx('do.exposure')}</dt><dd>{tx('do.perUse', { v: fmtMoney(a.exposure.perUseCents) })}{a.exposure.maxTotalCents != null ? ` · ${tx('do.maxTotal', { v: fmtMoney(a.exposure.maxTotalCents), n: nf(a.exposure.maxUses) })}` : ` · ${tx('do.noUseLimit')}`}</dd></> : null}
        </> : <dd className="fk-muted" style={{ gridColumn: '1 / -1' }}>{tx('do.salonRules')}</dd>}
      </dl></section>
      <section><h3 className="fk-h3">{tx('do.sec.history')}</h3>{x.approvals.length === 0 ? <div className="fk-hint">{tx('do.noDecisions')}</div>
        : <ul className="fk-list dense" data-testid="decide-history">{x.approvals.map((h: any) => <li key={h.id} className="fk-li"><span className="fk-li-t">{tx('do.decision.' + h.decision)} · v{h.version}</span><span className="fk-li-s">{whenTime(h.at)}{h.actor ? ` · ${h.actor}` : ''}{h.reason ? ` · ${h.reason}` : ''}</span></li>)}</ul>}</section>
      {canManage && !own ? <section style={{ gridColumn: '1 / -1' }}><h3 className="fk-h3">{tx('do.sec.notes')}</h3>
        <textarea className="fk-input do-notes" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('do.notesPh')} aria-label={tx('do.sec.notes')} data-testid="decide-notes" /></section> : null}
    </div>}
  </FitDialog>;
}
