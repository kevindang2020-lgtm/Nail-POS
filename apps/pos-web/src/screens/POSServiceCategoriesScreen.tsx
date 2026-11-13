// POSServiceCategoriesScreen.tsx — Services → Categories (/tenant/services/categories). Rebuild (Oct 30 2026), one vertical
// scroll: the two cards (Categories · Total Services) and the Services per Category chart + Breakdown all come from ONE
// server aggregate, so they always agree (current categories; services not archived; an unassigned service counts too) ·
// Review notes — things a person should look at (a category named like a code, a hair service filed under a nails
// category, an empty category); NOTHING is changed automatically · ONE search box (category or service name; or a
// customer / phone / #ticket in Customer History when allowed) · Today / Week / Month / Year / Custom with its date field
// · the Category Directory, server-paged, newest first · Category details (Overview · Services · History) · New / Edit /
// Archive / Restore and Manage Services (move services to another category: preview old → new, a reason, one transaction,
// one history row per service — a move never changes a price or duration).
import { useEffect, useRef, useState } from 'react';
import { useSessionState } from '../components/useSessionState';
import { SystemCheckButton } from '../components/SystemCheck';
import { SavedViews, vStr, periodToView, periodFromView } from '../components/SavedViews';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCatalogApi } from '../api/posCatalogApi';
import { posServicesApi } from '../api/posServicesApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney } from '../i18n/format';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { nf, mins, day, pageOf, STATUS_TONE, statusText, Bars, CustomerHistoryTable, ChangeHistoryTable } from './catalogShared';

type Mode = 'categories' | 'customers';
const SORTS = ['newest', 'name', 'most', 'fewest', 'updated', 'oldest'];
const PAGE = 10;

export function POSServiceCategoriesScreen() {
  const nav = useNavigate(); const can = useCan();
  // Saved filter state: mode, search, period, filters, sort and page come back after leaving the screen (this browser tab);
  // a real search / filter change still returns to page 1 (the first render keeps the restored page)
  const [mode, setMode] = useSessionState<Mode>('aps.cg.mode', 'categories');
  const [search, setSearch] = useSessionState('aps.cg.search', ''); const q = useDebounced(search.trim(), 300);
  const [drill, setDrill] = useState<string | null>(null);   // the category picked on the chart (cleared with the search)
  const [period, setPeriod] = useSessionState<PeriodState>('aps.cg.period', { preset: 'all' }); const [dateField, setDateField] = useSessionState('aps.cg.dateField', 'created');
  const [status, setStatus] = useSessionState('aps.cg.status', 'current'); const [sort, setSort] = useSessionState('aps.cg.sort', 'newest');
  const [page, setPage] = useSessionState('aps.cg.page', 1); const [cpage, setCpage] = useSessionState('aps.cg.cpage', 1);
  const [tick, setTick] = useState(0); const reload = () => setTick((n) => n + 1);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [deciding, setDeciding] = useState<any>(null);   // SERVICE PRICING 13: the review finding being approved as is / reopened
  const [detail, setDetail] = useState<{ id: string; tab?: DTab } | null>(null);
  const [form, setForm] = useState<{ cat: any | null } | null>(null);
  const [archiving, setArchiving] = useState<any | null>(null);

  const scope = { q: q || undefined, status, sort, dateField, ...periodQuery(period) };
  const key = JSON.stringify(scope); const ckey = q + JSON.stringify(periodQuery(period));
  const keyMounted = useRef(false); const ckeyMounted = useRef(false);
  useEffect(() => { if (keyMounted.current) setPage(1); keyMounted.current = true; }, [key, setPage]);
  useEffect(() => { if (ckeyMounted.current) setCpage(1); ckeyMounted.current = true; }, [ckey, setCpage]);
  const summary = useLoad(() => posCatalogApi.categorySummary(), [tick]);
  const list = useLoad(() => (mode === 'categories' ? posCatalogApi.categories({ ...scope, page, pageSize: PAGE }) : Promise.resolve(null)), [mode, key, page, tick]);
  const cust = useLoad(() => (mode === 'customers' && can('customers.view') ? posCatalogApi.customerHistory({ q, kind: 'all', ...periodQuery(period), page: cpage, pageSize: PAGE }) : Promise.resolve(null)), [mode, ckey, cpage, tick]);

  const s = summary.data;
  const filtered = !!(q || status !== 'current' || sort !== 'newest' || period.preset !== 'all');
  const clearAll = () => { setSearch(''); setStatus('current'); setSort('newest'); setPeriod({ preset: 'all' }); };
  const done = (msg: string) => { setForm(null); setArchiving(null); setNote({ tone: 'ok', text: msg }); reload(); };
  const restore = async (c: any) => {
    setNote(null);
    try { await posServicesApi.updateCategory(c.categoryId, { status: 'active' }); done(tx('cg.cat.restored', { name: c.name })); }
    catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('pos.save_failed')) }); }
  };
  const breakdownName = (b: any) => b.name ?? tx('cg.uncategorized');

  if (isForbidden(summary.error)) return <div className="work mos cgc" data-testid="categories-screen"><h1>{tx('pos.service_categories')}</h1><StateBlock error={summary.error} onRetry={summary.reload} /></div>;
  return (
    <div className="work mos cgc" data-testid="categories-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.service_categories')}</h1><div className="sub">{tx('pos.how_your_service_catalog_is_organized')}</div></div>
        <div className="fk-head-actions">
          <SystemCheckButton domain="catalog" />
          <button type="button" className="fk-btn" onClick={reload} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => nav('/services')} data-testid="back-services">{tx('pos.back_to_services')}</button>
          {can('services.edit') ? <button type="button" className="fk-btn primary" onClick={() => setForm({ cat: null })} data-testid="new-category">{tx('cg.cat.new')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <div className="fk-kpis two cg-kpis" data-testid="kpis">
        {summary.error ? <StateBlock error={summary.error} onRetry={summary.reload} /> : <>
          <KpiCard testId="kpi-categories" label={tx('pos.categories')} loading={!s} value={s ? nf(s.categories) : ''} sub={tx('cg.kpi.categoriesSub')} onClick={() => { setMode('categories'); clearAll(); }} />
          <KpiCard testId="kpi-total-services" tone="gold" label={tx('pos.total_services')} loading={!s} value={s ? nf(s.totalServices) : ''} sub={s ? (s.unassigned ? tx('cg.kpi.servicesSubUn', { n: nf(s.unassigned) }) : tx('cg.kpi.servicesSub')) : ''} onClick={() => nav('/tenant/services/pricing')} />
        </>}
      </div>

      {/* Extras (Service Categories row 10): the authorized scope behind these counts — one branch (+ shared rows) or every
          branch listed separately, never a merged total that hides which branch holds what */}
      {s?.scope ? <div className="fk-hint" data-testid="catalog-scope">{s.scope.mode === 'branch'
        ? tx('cg.scope.branch', { b: s.scope.branchName ?? '—', n: nf(s.scope.branchServices ?? 0), m: nf(s.scope.salonWideServices ?? 0) })
        : <>{tx('cg.scope.salon', { k: nf((s.scope.branches ?? []).length) })} {(s.scope.branches ?? []).map((b: { branchId: string; name: string; services: number }) => `${b.name} ${nf(b.services)}`).join(' · ')}{s.scope.salonWideServices ? ` · ${tx('cg.scope.shared', { m: nf(s.scope.salonWideServices) })}` : ''}. {tx('cg.scope.salonNote')}</>}</div> : null}

      <div className="mos-row two cg-row">
        <FitPanel testId="chart" title={tx('pos.services_per_category')}>
          {!s ? <div className="fk-loading">{tx('pos.loading_categories')}</div> : <Bars items={s.breakdown.map((b: any) => ({ name: breakdownName(b), value: b.services }))} testId="bars-categories" empty={tx('pos.no_categories_yet')} fmt={(n) => nf(n)}
            onPick={(name, i) => { if (!s.breakdown[i]?.categoryId) return; setMode('categories'); setSearch(name); setDrill(name); }} />}
          {/* extras (Nov 11 2026) — chart-to-directory drill-down: a bar filters the directory below, with a visible Clear */}
          {drill && search === drill ? <div className="fk-hint" data-testid="chart-drill">{tx('cg.drill', { c: drill })} <button type="button" className="fk-btn ghost sm" data-testid="chart-drill-clear" onClick={() => { setDrill(null); setSearch(''); }}>{tx('finance.clearFilters')}</button></div> : null}
        </FitPanel>
        <FitPanel testId="breakdown" title={tx('pos.breakdown')}>
          {!s ? <div className="fk-loading">{tx('pos.loading')}</div> : s.breakdown.length === 0 ? <Empty title={tx('pos.no_data')} />
            : <table className="fk-table fn-table cg-table" data-testid="breakdown-table">
              <thead><tr><th>{tx('pos.category')}</th><th className="num">{tx('pos.services')}</th><th className="num">{tx('pos.share')}</th></tr></thead>
              <tbody>{s.breakdown.map((b: any) => <tr key={b.categoryId ?? 'none'} data-testid="breakdown-row" className={b.categoryId ? 'inv2-click' : ''} onClick={() => b.categoryId && setDetail({ id: b.categoryId })}>
                <td>{breakdownName(b)}{b.isAddOnCategory ? <span className="fk-li-s">{tx('cg.addOnCategory')}</span> : null}</td><td className="num">{nf(b.services)}</td><td className="num"><b>{b.sharePct.toFixed(1)}%</b></td>
              </tr>)}</tbody>
            </table>}
          <div className="fk-hint">{tx('cg.breakdownRule')}</div>
        </FitPanel>
      </div>

      {s && s.review.length ? <FitPanel testId="review" title={<>{tx('cg.review')}<span className="fk-muted"> · {nf(s.review.filter((r: any) => r.status !== 'approved').length)}</span></>}>
        <ul className="fk-list dense" data-testid="review-list">{s.review.map((r: any, i: number) => <li key={i} className="fk-li" data-testid={'review-' + r.kind} data-status={r.status ?? 'open'}>
          <span className="fk-li-t">{tx('cg.review.' + r.kind, { c: r.categoryName, s: r.serviceName ?? '' })}
            {r.status === 'approved' && r.lastDecision
              ? <span className="fk-li-s" data-testid="review-approved"><span className="fk-chip ok">{tx('cg.rv.approved')}</span> {tx('cg.rv.by', { who: r.lastDecision.by ?? '—', when: day(r.lastDecision.at) })} — {r.lastDecision.note}</span>
              : <span className="fk-li-s">{r.kind === 'service_category_mismatch' && r.categoryDomain && r.serviceDomain
                ? tx('cg.review.domainHint', { sd: tx('cg.domain.' + r.serviceDomain), cd: tx('cg.domain.' + r.categoryDomain) }) : tx('cg.review.' + r.kind + '.hint')}</span>}</span>
          <button type="button" className="fk-btn ghost sm" onClick={() => setDetail({ id: r.categoryId, tab: r.serviceId ? 'services' : 'overview' })}>{tx('cg.review.open')}</button>
          {can('services.edit') && r.status ? <button type="button" className="fk-btn ghost sm" data-testid="review-decide" onClick={() => setDeciding(r)}>{tx(r.status === 'approved' ? 'cg.rv.reopen' : 'cg.rv.approve')}</button> : null}
        </li>)}</ul>
        <div className="fk-hint">{tx('cg.reviewRule')}</div>
      </FitPanel> : null}
      {deciding ? <ReviewDecisionDialog item={deciding} onClose={() => setDeciding(null)} onDone={(m) => { setDeciding(null); setNote({ tone: 'ok', text: m }); reload(); }} /> : null}

      <div className="mos-tools" data-testid="toolbar">
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx(mode === 'customers' ? 'cg.custSearchPh' : 'cg.catSearchPh')} aria-label={tx('cg.search')} data-testid="search" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        <select className="fk-select" value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label={tx('cg.scope')} data-testid="mode"><option value="categories">{tx('cg.mode.categories')}</option><option value="customers" disabled={!can('customers.view')}>{tx('cg.mode.customers')}</option></select>
        {mode === 'categories' ? <>
          <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status')} data-testid="status">{['current', 'archived', 'all'].map((x) => <option key={x} value={x}>{tx('cg.catStatus.' + x)}</option>)}</select>
          <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('cg.sort')} data-testid="sort">{SORTS.map((x) => <option key={x} value={x}>{tx('cg.csort.' + x)}</option>)}</select>
        </> : null}
      </div>
      <div className="fn-tabsrow dsc-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={(mode === 'categories' ? list.data : cust.data)?.period} allowAll compact
          {...(mode === 'categories' ? { basis: dateField, basisOptions: ['created', 'updated'].map((f) => ({ value: f, label: tx('cg.df.' + f) })), onBasis: setDateField } : { basis: 'paid', basisOptions: [{ value: 'paid', label: tx('cg.df.paid') }], onBasis: () => undefined })} />
        <SavedViews surface={`catalog.categories.${mode}`} testId="cg-views" current={{ q: search, dateField, status, sort, ...periodToView(period) }}
          onApply={(v) => { setSearch(vStr(v, 'q')); setDateField(vStr(v, 'dateField', 'created')); setStatus(vStr(v, 'status', 'current')); setSort(vStr(v, 'sort', 'newest')); setPeriod(periodFromView(v, { preset: 'all' } as PeriodState)); }} />
        {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div>

      {mode === 'categories' ? <FitPanel testId="directory" title={<>{tx('cg.directory')}{list.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(list.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(list.data)} onPage={setPage} label={tx('cg.directory')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading_categories')}</div>
          : list.data.items.length === 0 ? (filtered ? <Empty title={q ? tx('cg.noMatchSearch', { q }) : tx('cg.noMatch')}><button type="button" className="fk-btn" onClick={clearAll} data-testid="empty-clear">{tx('finance.clearFilters')}</button></Empty> : <Empty title={tx('pos.no_categories_yet')} />)
          : <table className="fk-table fn-table cg-table" data-testid="directory-table">
            <thead><tr><th>{tx('pos.category')}</th><th className="num">{tx('pos.services')}</th><th className="num t-opt">{tx('cg.col.active')}</th><th className="num">{tx('pos.share')}</th><th>{tx('pos.status')}</th><th className="t-opt">{tx('cg.f.updated')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{list.data.items.map((c: any) => <tr key={c.categoryId} data-testid="category-row" className="inv2-click" onClick={() => setDetail({ id: c.categoryId })}>
              <td><span className="fk-li-t">{c.name}</span><span className="fk-li-s">{c.matchedServices?.length ? tx('cg.matchedServices', { s: c.matchedServices.map((m: any) => m.name).join(', ') }) : c.isAddOnCategory ? tx('cg.addOnCategory') : c.description ?? ''}</span></td>
              <td className="num"><b>{nf(c.services)}</b></td><td className="num t-opt">{nf(c.activeServices)}</td><td className="num">{c.sharePct.toFixed(1)}%</td>
              <td><span className={'fk-chip ' + (c.status === 'archived' ? 'mut' : 'ok')}>{c.status === 'archived' ? tx('cg.status.archived') : tx('cg.status.active')}</span></td>
              <td className="t-opt">{day(c.updatedAt ?? c.createdAt)}</td>
              <td className="fn-acts" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="fk-btn ghost sm" onClick={() => setDetail({ id: c.categoryId })} data-testid="row-details">{tx('pos.details')}</button>
                {can('services.edit') ? (c.status === 'archived'
                  ? <button type="button" className="fk-btn ghost sm" onClick={() => restore(c)} data-testid="row-restore">{tx('pos.restore')}</button>
                  : <><button type="button" className="fk-btn ghost sm" onClick={() => setForm({ cat: c })} data-testid="row-edit">{tx('pos.edit')}</button>
                    <button type="button" className="fk-btn ghost sm cg-act2" onClick={() => setArchiving(c)} data-testid="row-archive">{tx('pos.archive')}</button></>) : null}
              </td>
            </tr>)}</tbody>
          </table>}
      </FitPanel> : <FitPanel testId="customer-history" title={<>{tx('cg.mode.customers')}{cust.data && !cust.data.needsQuery ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(cust.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(cust.data)} onPage={setCpage} label={tx('cg.mode.customers')} />}>
        {cust.error ? <StateBlock error={cust.error} onRetry={cust.reload} /> : !cust.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : cust.data.needsQuery ? <Empty title={tx('cg.customerNeedsQuery')} /> : cust.data.items.length === 0 ? <Empty title={tx('cg.noCustomerHistory', { q })} />
          : <CustomerHistoryTable rows={cust.data.items} onCustomer={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)} />}
        <div className="fk-hint">{tx('cg.categoryAtSaleRule')}</div>
      </FitPanel>}

      {detail ? <CategoryDetails id={detail.id} initialTab={detail.tab} canEdit={can('services.edit')} onClose={() => setDetail(null)} onEdit={(c) => { setDetail(null); setForm({ cat: c }); }} onArchive={(c) => { setDetail(null); setArchiving(c); }} onRestore={(c) => { setDetail(null); void restore(c); }} onMoved={(m) => { setNote({ tone: 'ok', text: m }); reload(); }} /> : null}
      {form ? <CategoryForm cat={form.cat} onClose={() => setForm(null)} onSaved={done} /> : null}
      {archiving ? <ArchiveCategory cat={archiving} onClose={() => setArchiving(null)} onDone={done} /> : null}
    </div>
  );
}

function CategoryForm({ cat, onClose, onSaved }: { cat: any | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(cat?.name ?? ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim()) { setErr(tx('pos.category_name_is_required')); return; }
    setBusy(true); setErr(null);
    try {
      if (cat) await posServicesApi.updateCategory(cat.categoryId, { name: name.trim() }); else await posServicesApi.createCategory({ name: name.trim() });
      onSaved(tx(cat ? 'cg.cat.saved' : 'cg.cat.created', { name: name.trim() }));
    } catch (e) { setErr(errorTextOf(e, tx('pos.save_failed'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={cat ? tx('cg.cat.editTitle', { name: cat.name }) : tx('cg.cat.new')} onClose={onClose} busy={busy} testId="dlg-category"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={save} disabled={busy} data-testid="category-save">{busy ? tx('pos.saving_2') : cat ? tx('pos.save_changes_2') : tx('cg.cat.create')}</button></>}>
      <label className="fk-field wide">{tx('cg.f.name')}<input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="category-name" /></label>
      {cat ? <p className="fk-hint">{tx('cg.cat.renameRule')}</p> : null}
      {err ? <div className="fk-note bad" role="alert" data-testid="category-error"><span>{err}</span></div> : null}
    </FitDialog>
  );
}

function ArchiveCategory({ cat, onClose, onDone }: { cat: any; onClose: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const active = cat.activeServices ?? 0;
  const go = async () => {
    setBusy(true); setErr(null);
    try { await posServicesApi.archiveCategory(cat.categoryId, true); onDone(tx('cg.cat.archived', { name: cat.name })); }
    catch (e) { setErr(errorTextOf(e, tx('pos.archive_failed'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('cg.cat.archiveTitle', { name: cat.name })} onClose={onClose} busy={busy} testId="dlg-archive-category"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn danger" onClick={go} disabled={busy} data-testid="archive-confirm">{tx('pos.archive')}</button></>}>
      <p>{tx('cg.cat.archiveBody')}</p>
      {active > 0 ? <div className="fk-note warn" data-testid="archive-warning"><span>{tx('cg.cat.archiveActive', { n: nf(active) })}</span></div> : null}
      {err ? <div className="fk-note bad" role="alert"><span>{err}</span></div> : null}
    </FitDialog>
  );
}

type DTab = 'overview' | 'services' | 'history';
function CategoryDetails({ id, initialTab, canEdit, onClose, onEdit, onArchive, onRestore, onMoved }: { id: string; initialTab?: DTab; canEdit: boolean; onClose: () => void; onEdit: (c: any) => void; onArchive: (c: any) => void; onRestore: (c: any) => void; onMoved: (m: string) => void }) {
  const [t, setT] = useState<DTab>(initialTab ?? 'overview'); const [sp, setSp] = useState(1); const [hp, setHp] = useState(1); const [tick, setTick] = useState(0);
  const [moving, setMoving] = useState(false);
  const d = useLoad(() => posCatalogApi.category(id, { page: sp, pageSize: 8 }), [id, sp, tick]);
  const h = useLoad(() => (t === 'history' ? posCatalogApi.history({ categoryId: id, field: 'all', page: hp, pageSize: 8 }) : Promise.resolve(null)), [id, t, hp, tick]);
  const x = d.data;
  return (
    <FitDialog wide title={x ? x.name : tx('pos.details')} subtitle={x ? <span className={'fk-chip ' + (x.status === 'archived' ? 'mut' : 'ok')}>{x.status === 'archived' ? tx('cg.status.archived') : tx('cg.status.active')}</span> : undefined} onClose={onClose} testId="dlg-category-details"
      footer={<>{x && canEdit ? (x.status === 'archived' ? <button type="button" className="fk-btn ghost" onClick={() => onRestore(x)}>{tx('pos.restore')}</button>
        : <><button type="button" className="fk-btn ghost" onClick={() => onArchive({ ...x, activeServices: x.services.items.filter((s: any) => s.status === 'active').length })}>{tx('pos.archive')}</button><button type="button" className="fk-btn ghost" onClick={() => onEdit(x)}>{tx('pos.edit')}</button>
          <button type="button" className="fk-btn primary" onClick={() => { setT('services'); setMoving(true); }} data-testid="manage-services">{tx('cg.cat.manageServices')}</button></>) : null}<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fk-seg mos-dtabs" role="tablist" aria-label={tx('pos.details')}>
          {(['overview', 'services', 'history'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={t === k} className={t === k ? 'on' : ''} onClick={() => setT(k)} data-testid={'cd-tab-' + k}>{tx('cg.cdtab.' + k)}</button>)}
        </div>
        {t === 'overview' ? <dl className="fk-dl mo-dl" data-testid="cd-overview">
          <dt>{tx('cg.f.name')}</dt><dd>{x.name}{x.isAddOnCategory ? <span className="fk-li-s">{tx('cg.addOnCategory')}</span> : null}</dd>
          <dt>{tx('pos.services')}</dt><dd>{nf(x.services.totalItems)}</dd>
          <dt>{tx('cg.priceRange')}</dt><dd>{x.services.stats.lowestPriceCents == null ? '—' : `${fmtMoney(x.services.stats.lowestPriceCents)} – ${fmtMoney(x.services.stats.highestPriceCents)}`}</dd>
          <dt>{tx('cg.f.created')}</dt><dd>{day(x.createdAt)}</dd>
          <dt>{tx('cg.f.updated')}</dt><dd>{day(x.updatedAt)}</dd>
          <dt>{tx('cg.f.id')}</dt><dd className="mos-mono">{x.categoryId}</dd>
        </dl> : null}
        {t === 'services' ? (moving ? <ReassignPanel from={x} onCancel={() => setMoving(false)} onMoved={(m) => { setMoving(false); setTick((n) => n + 1); onMoved(m); }} />
          : x.services.items.length === 0 ? <Empty title={tx('cg.cat.noServices')} />
          : <><table className="fk-table fn-table cg-table" data-testid="cd-services"><thead><tr><th>{tx('pos.service_3')}</th><th className="num">{tx('pos.duration')}</th><th className="num">{tx('pos.price')}</th><th>{tx('pos.status')}</th></tr></thead>
            <tbody>{x.services.items.map((s: any) => <tr key={s.serviceId}><td>{s.name}</td><td className="num">{mins(s.durationMinutes)}</td><td className="num">{fmtMoney(s.priceCents)}</td><td><span className={'fk-chip ' + (STATUS_TONE[s.status] ?? 'mut')}>{statusText(s.status)}</span></td></tr>)}</tbody></table>
            <Pager info={pageOf(x.services)} onPage={setSp} /></>) : null}
        {t === 'history' ? (h.error ? <StateBlock error={h.error} onRetry={h.reload} /> : !h.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : h.data.items.length === 0 ? <Empty title={tx('cg.noHistory')} /> : <><ChangeHistoryTable rows={h.data.items} /><Pager info={pageOf(h.data)} onPage={setHp} /></>) : null}
      </>}
    </FitDialog>
  );
}

/** SERVICE PRICING 13 — Owner review: approve a finding as is, or reopen an approved one, with a note. The server keeps the
 *  decision (append-only, tied to the original ids and names) and changes nothing in the catalog; fixing a real mistake
 *  stays Manage Services. */
function ReviewDecisionDialog({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: (m: string) => void }) {
  const reopen = item.status === 'approved';
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (text.trim().length < 3) { setErr(tx('cg.rv.noteRequired')); return; }
    setBusy(true); setErr(null);
    try {
      await posCatalogApi.reviewDecision(item.categoryId, { kind: item.kind, serviceId: item.serviceId ?? null, decision: reopen ? 'reopen' : 'approve', note: text.trim() });
      onDone(tx(reopen ? 'cg.rv.reopened' : 'cg.rv.done'));
    } catch (e) { setErr(errorTextOf(e, tx('pos.save_failed'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx(reopen ? 'cg.rv.reopenTitle' : 'cg.rv.approveTitle')} onClose={onClose} busy={busy} testId="dlg-review-decision"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={() => void save()} disabled={busy} data-testid="review-decision-save">{tx(reopen ? 'cg.rv.reopen' : 'cg.rv.approve')}</button></>}>
      <p>{tx('cg.review.' + item.kind, { c: item.categoryName, s: item.serviceName ?? '' })}</p>
      <p className="fk-hint">{tx(reopen ? 'cg.rv.reopenHint' : 'cg.rv.approveHint')}</p>
      <label className="fk-field">{tx('cg.rv.note')}<textarea className="fk-input" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} data-testid="review-decision-note" /></label>
      {err ? <div className="fk-note bad" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

/** Manage Services: pick services, the target category and a reason → preview (old → new) → confirm. */
function ReassignPanel({ from, onCancel, onMoved }: { from: any; onCancel: () => void; onMoved: (m: string) => void }) {
  const all = useLoad(() => posCatalogApi.services({ categoryId: from.categoryId, status: 'all', sort: 'name', pageSize: 100 }), [from.categoryId]);
  const cats = useLoad(() => posCatalogApi.categories({ status: 'current', sort: 'name', pageSize: 100 }), []);
  const [picked, setPicked] = useState<string[]>([]); const [to, setTo] = useState(''); const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const targets = (cats.data?.items ?? []).filter((c: any) => c.categoryId !== from.categoryId);
  const toggle = (sid: string) => { setPreview(null); setPicked((x) => x.includes(sid) ? x.filter((y) => y !== sid) : [...x, sid]); };
  const run = async (confirm: boolean) => {
    if (!picked.length) { setErr(tx('cg.move.pick')); return; }
    if (!to) { setErr(tx('cg.move.target')); return; }
    if (confirm && !reason.trim()) { setErr(tx('cg.reasonRequired')); return; }
    setBusy(true); setErr(null);
    try {
      const r: any = await posCatalogApi.reassign(from.categoryId, { serviceIds: picked, toCategoryId: to, reason: reason.trim() || undefined, confirm });
      if (confirm) onMoved(tx('cg.move.done', { n: nf(r.moved), c: r.to?.name ?? '' })); else setPreview(r);
    } catch (e) { setErr(errorTextOf(e, tx('pos.save_failed'))); } finally { setBusy(false); }
  };
  return (
    <div className="cg-move" data-testid="reassign">
      <p className="fk-hint">{tx('cg.move.rule')}</p>
      {all.error ? <StateBlock error={all.error} onRetry={all.reload} /> : !all.data ? <div className="fk-loading">{tx('pos.loading')}</div> :
        <ul className="fk-list dense">{all.data.items.map((s: any) => <li key={s.serviceId} className="fk-li"><label className="cg-chk"><input type="checkbox" checked={picked.includes(s.serviceId)} onChange={() => toggle(s.serviceId)} data-testid="move-pick" /> {s.name}</label><span className="fk-muted">{fmtMoney(s.priceCents)} · {mins(s.durationMinutes)}</span></li>)}</ul>}
      <div className="cg-form">
        <label className="fk-field">{tx('cg.move.to')}<select value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); }} data-testid="move-to"><option value="">{tx('cg.move.choose')}</option>{targets.map((c: any) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}</select></label>
        <label className="fk-field">{tx('cg.f.reason')}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={tx('cg.f.reasonPh')} data-testid="move-reason" /></label>
      </div>
      {preview ? <div className="fk-note ok" data-testid="move-preview"><span>{tx('cg.move.preview', { n: nf(preview.services.length), f: preview.from.name, t: preview.to.name })} {preview.services.map((s: any) => s.name).join(', ')}</span></div> : null}
      {err ? <div className="fk-note bad" role="alert" data-testid="move-error"><span>{err}</span></div> : null}
      <div className="cg-acts">
        <button type="button" className="fk-btn ghost" onClick={onCancel} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn" onClick={() => run(false)} disabled={busy} data-testid="move-preview-btn">{tx('cg.move.previewBtn')}</button>
        <button type="button" className="fk-btn primary" onClick={() => run(true)} disabled={busy || !preview} data-testid="move-confirm">{tx('cg.move.confirm')}</button>
      </div>
    </div>
  );
}
