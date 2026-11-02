// POSServicePricingScreen.tsx — Services → Pricing (/tenant/services/pricing). Rebuild (Oct 30 2026), one vertical scroll:
//   the four cards (Services · Average Price · Lowest · Highest) — always the WHOLE current catalog (active services with a
//   price for the three money cards); when a search / filter is on, each card also says what the filtered list holds ·
//   ONE search box (name · id · category · "$55" price · "45 min" duration) · Today / Week / Month / Year / Custom with the
//   date field it filters · tabs Price List | Price History | Customer History, each server-paged, newest first.
// Price List keeps its four columns (Service · Category · Duration · Price) plus Status and the actions. Edit Pricing
// needs a reason and the version the editor opened (a newer save is refused); every change is one append-only history
// row (catalog_change_log). A change takes effect when it is saved — future-dated prices are not offered, because nothing
// would apply them. Completed tickets keep their own price snapshot: Customer History shows what was actually charged.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCatalogApi } from '../api/posCatalogApi';
import { posServicesApi } from '../api/posServicesApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney } from '../i18n/format';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { nf, money, mins, day, pageOf, STATUS_TONE, statusText, saveCsv, CustomerHistoryTable, EditPricingDialog, ChangeHistoryTable } from './catalogShared';

type Tab = 'list' | 'history' | 'customers';
const TABS: Tab[] = ['list', 'history', 'customers'];
const SORTS = ['newest', 'name', 'price_desc', 'price_asc', 'duration', 'category', 'updated', 'oldest'];
const PAGE = 10;
const P0: Record<Tab, PeriodState> = { list: { preset: 'all' }, history: { preset: 'all' }, customers: { preset: 'month' } };

export function POSServicePricingScreen() {
  const nav = useNavigate(); const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'list';
  const setTab = (t: Tab) => { const p = new URLSearchParams(params); if (t === 'list') p.delete('tab'); else p.set('tab', t); p.delete('serviceId'); setParams(p, { replace: true }); };
  const historyService = params.get('serviceId');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [periods, setPeriods] = useState(P0); const period = periods[tab]; const setPeriod = (p: PeriodState) => setPeriods((x) => ({ ...x, [tab]: p }));
  const [dateField, setDateField] = useState('created');
  const [categoryId, setCategoryId] = useState(''); const [status, setStatus] = useState('catalog'); const [online, setOnline] = useState(params.get('online') ?? ''); const [sort, setSort] = useState('newest');
  const [field, setField] = useState('pricing'); const [kind, setKind] = useState('service');
  const [pages, setPages] = useState<Record<Tab, number>>({ list: 1, history: 1, customers: 1 }); const setPg = (t: Tab) => (n: number) => setPages((x) => ({ ...x, [t]: n }));
  const [tick, setTick] = useState(0); const reload = () => setTick((n) => n + 1);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [detail, setDetail] = useState<string | null>(null); const [editing, setEditing] = useState<any | null>(null);
  const [exporting, setExporting] = useState(false);

  const listScope = { q: q || undefined, categoryId: categoryId || undefined, status: status === 'catalog' ? undefined : status, online: online || undefined, sort, dateField, ...periodQuery(periods.list) };
  const histScope = { q: q || undefined, field, serviceId: historyService || undefined, ...periodQuery(periods.history) };
  const custScope = { q: q || undefined, kind, ...periodQuery(periods.customers) };
  const keys = { list: JSON.stringify(listScope), history: JSON.stringify(histScope), customers: JSON.stringify(custScope) };
  useEffect(() => setPg('list')(1), [keys.list]);    
  useEffect(() => setPg('history')(1), [keys.history]);    
  useEffect(() => setPg('customers')(1), [keys.customers]);    

  const whole = useLoad(() => posCatalogApi.services({ pageSize: 1 }), [tick]);
  const cats = useLoad(() => posCatalogApi.categories({ status: 'current', sort: 'name', pageSize: 100 }), [tick]);
  const list = useLoad(() => (tab === 'list' ? posCatalogApi.services({ ...listScope, page: pages.list, pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.list, pages.list, tick]);
  const hist = useLoad(() => (tab === 'history' ? posCatalogApi.history({ ...histScope, page: pages.history, pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.history, pages.history, tick]);
  const cust = useLoad(() => (tab === 'customers' && can('customers.view') ? posCatalogApi.customerHistory({ ...custScope, page: pages.customers, pageSize: PAGE }) : Promise.resolve(null)), [tab, keys.customers, pages.customers, tick]);

  const w = whole.data; const ws = w?.stats;
  const listFiltered = !!(q || categoryId || status !== 'catalog' || online || periods.list.preset !== 'all');
  const fs = listFiltered && list.data ? list.data : null;
  const filtered = tab === 'list' ? listFiltered || sort !== 'newest' : tab === 'history' ? !!(q || field !== 'pricing' || historyService || periods.history.preset !== 'all') : !!(q || kind !== 'service' || periods.customers.preset !== 'month');
  const clearAll = () => { setSearch(''); setPeriods(P0); setCategoryId(''); setStatus('catalog'); setOnline(''); setSort('newest'); setField('pricing'); setKind('service'); if (historyService) { const p = new URLSearchParams(params); p.delete('serviceId'); setParams(p, { replace: true }); } };
  const served = tab === 'list' ? list.data?.period : tab === 'history' ? hist.data?.period : cust.data?.period;
  const basis = tab === 'list' ? { basis: dateField, basisOptions: ['created', 'updated'].map((f) => ({ value: f, label: tx('cg.df.' + f) })), onBasis: setDateField }
    : { basis: tab === 'history' ? 'changed' : 'paid', basisOptions: [{ value: tab === 'history' ? 'changed' : 'paid', label: tx(tab === 'history' ? 'cg.df.changed' : 'cg.df.paid') }], onBasis: () => undefined };
  const doExport = async () => {
    setExporting(true); setNote(null);
    try { const r: any = await posServicesApi.exportCsv({ search: q || undefined, categoryId: categoryId || undefined }); saveCsv(r?.filename || 'services.csv', typeof r === 'string' ? r : r?.csv ?? ''); setNote({ tone: 'ok', text: tx('finance.exported') }); }
    catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('finance.state.loadFailed')) }); } finally { setExporting(false); }
  };
  const saved = (msg: string) => { setEditing(null); setNote({ tone: 'ok', text: msg }); reload(); };
  const sub = (scopeText: string, filteredText: string | null) => (filteredText ? <>{scopeText}<span className="cg-fsub">{filteredText}</span></> : scopeText);

  if (isForbidden(whole.error)) return <div className="work mos cgp" data-testid="pricing-screen"><h1>{tx('pos.service_pricing')}</h1><StateBlock error={whole.error} onRetry={whole.reload} /></div>;
  return (
    <div className="work mos cgp" data-testid="pricing-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.service_pricing')}</h1><div className="sub">{tx('pos.your_service_menu_durations_and_prices')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={reload} data-testid="refresh">{tx('finance.refresh')}</button>
          {can('services.view') ? <button type="button" className="fk-btn ghost" onClick={doExport} disabled={exporting} data-testid="export">{exporting ? tx('pos.loading') : tx('cg.exportPrices')}</button> : null}
          <button type="button" className="fk-btn ghost" onClick={() => nav('/services')} data-testid="back-services">{tx('pos.back_to_services')}</button>
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <div className="fk-kpis four cg-kpis" data-testid="kpis">
        {whole.error ? <StateBlock error={whole.error} onRetry={whole.reload} /> : <>
          <KpiCard testId="kpi-services" label={tx('pos.services')} loading={!w} value={w ? nf(w.totalItems) : ''} sub={sub(tx('cg.kpi.catalogScope'), fs ? tx('cg.kpi.filteredN', { n: nf(fs.totalItems) }) : null)} onClick={clearAll} />
          <KpiCard testId="kpi-average" tone="gold" label={tx('pos.average_price')} loading={!w} value={ws ? money(ws.averagePriceCents) : ''} sub={sub(ws ? tx('cg.kpi.pricedScope', { n: nf(ws.pricedServices) }) : '', fs ? tx('cg.kpi.filteredV', { v: money(fs.stats.averagePriceCents) }) : null)} />
          <KpiCard testId="kpi-lowest" label={tx('pos.lowest')} loading={!w} value={ws ? money(ws.lowestPriceCents) : ''} sub={sub(tx('cg.kpi.activePriced'), fs ? tx('cg.kpi.filteredV', { v: money(fs.stats.lowestPriceCents) }) : null)} onClick={() => { setTab('list'); setSort('price_asc'); }} />
          <KpiCard testId="kpi-highest" label={tx('pos.highest')} loading={!w} value={ws ? money(ws.highestPriceCents) : ''} sub={sub(tx('cg.kpi.activePriced'), fs ? tx('cg.kpi.filteredV', { v: money(fs.stats.highestPriceCents) }) : null)} onClick={() => { setTab('list'); setSort('price_desc'); }} />
        </>}
      </div>

      <div className="mos-tools" data-testid="toolbar">
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx(tab === 'customers' ? 'cg.custSearchPh' : tab === 'history' ? 'cg.histSearchPh' : 'cg.priceSearchPh')} aria-label={tx('cg.search')} data-testid="search" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        {tab === 'list' ? <>
          <select className="fk-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label={tx('pos.category')} data-testid="category"><option value="">{tx('cg.allCategories')}</option>{(cats.data?.items ?? []).map((c: any) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}<option value="none">{tx('cg.uncategorized')}</option></select>
          <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status')} data-testid="status">{['catalog', 'active', 'inactive', 'archived', 'all'].map((s) => <option key={s} value={s}>{tx('cg.statusF.' + s)}</option>)}</select>
          <select className="fk-select" value={online} onChange={(e) => setOnline(e.target.value)} aria-label={tx('cg.channels')} data-testid="online"><option value="">{tx('cg.onlineAll')}</option><option value="true">{tx('cg.onlineYes')}</option><option value="false">{tx('cg.onlineNo')}</option></select>
          <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('cg.sort')} data-testid="sort">{SORTS.map((s) => <option key={s} value={s}>{tx('cg.sort.' + s)}</option>)}</select>
        </> : tab === 'history' ? <select className="fk-select" value={field} onChange={(e) => setField(e.target.value)} aria-label={tx('cg.col.field')} data-testid="field">{['pricing', 'price', 'duration', 'all'].map((f) => <option key={f} value={f}>{tx('cg.fieldF.' + f)}</option>)}</select>
          : <select className="fk-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={tx('cg.kindF')} data-testid="kind">{['service', 'add_on', 'retail', 'all'].map((f) => <option key={f} value={f}>{tx('cg.kindF.' + f)}</option>)}</select>}
      </div>
      <div className="fn-tabsrow dsc-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={served} allowAll compact {...basis} />
        {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div>
      <div className="inv2-tabs mos-tabs">
        <div className="fk-seg inv2-tabseg" role="tablist" aria-label={tx('cg.pricingTabs')}>
          {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'tab-' + t} disabled={t === 'customers' && !can('customers.view')}>{tx('cg.ptab.' + t)}</button>)}
        </div>
      </div>

      {tab === 'list' ? <FitPanel testId="price-list" title={<>{tx('cg.ptab.list')}{list.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(list.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(list.data)} onPage={setPg('list')} label={tx('cg.ptab.list')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading_pricing')}</div>
          : list.data.items.length === 0 ? (filtered ? <Empty title={q ? tx('cg.noMatchSearch', { q }) : tx('cg.noMatch')}><button type="button" className="fk-btn" onClick={clearAll} data-testid="empty-clear">{tx('finance.clearFilters')}</button></Empty> : <Empty title={tx('pos.no_services_in_the_menu_yet')} />)
          : <table className="fk-table fn-table cg-table" data-testid="pricing-table">
            <thead><tr><th>{tx('pos.service_3')}</th><th>{tx('pos.category')}</th><th className="num">{tx('pos.duration')}</th><th className="num">{tx('pos.price')}</th><th className="t-opt">{tx('pos.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{list.data.items.map((s: any) => <tr key={s.serviceId} data-testid="pricing-row" className="inv2-click" onClick={() => setDetail(s.serviceId)}>
              <td><span className="fk-li-t">{s.name}</span><span className="fk-li-s">{s.matchedVia ? tx('cg.via.' + s.matchedVia) : s.updatedAt ? tx('cg.updatedOn', { d: day(s.updatedAt) }) : ''}</span></td>
              <td>{s.categoryName ?? <span className="fk-muted">{tx('cg.uncategorized')}</span>}</td>
              <td className="num">{mins(s.durationMinutes)}</td><td className="num"><b>{fmtMoney(s.priceCents)}</b></td>
              <td className="t-opt"><span className={'fk-chip ' + (STATUS_TONE[s.status] ?? 'mut')}>{statusText(s.status)}</span></td>
              <td className="fn-acts" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="fk-btn ghost sm" onClick={() => setDetail(s.serviceId)} data-testid="row-details">{tx('pos.details')}</button>
                {can('services.edit') && s.status !== 'archived' ? <button type="button" className="fk-btn sm" onClick={() => setEditing(s)} data-testid="row-edit-pricing">{tx('cg.qa.editPricing')}</button> : null}
              </td>
            </tr>)}</tbody>
          </table>}
        <div className="fk-hint" data-testid="pricing-rule">{tx('cg.pricing.noSchedule')}</div>
      </FitPanel> : null}

      {tab === 'history' ? <FitPanel testId="price-history" title={<>{tx('cg.ptab.history')}{historyService && hist.data?.items?.[0]?.serviceName ? ` · ${hist.data.items[0].serviceName}` : ''}{hist.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(hist.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(hist.data)} onPage={setPg('history')} label={tx('cg.ptab.history')} />}>
        {hist.error ? <StateBlock error={hist.error} onRetry={hist.reload} /> : !hist.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : hist.data.items.length === 0 ? <Empty title={filtered ? tx('cg.noMatch') : tx('cg.noHistory')}>{filtered ? <button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button> : null}</Empty>
          : <ChangeHistoryTable rows={hist.data.items} />}
        <div className="fk-hint">{tx('cg.historyRule')}</div>
      </FitPanel> : null}

      {tab === 'customers' ? <FitPanel testId="customer-history" title={<>{tx('cg.ptab.customers')}{cust.data && !cust.data.needsQuery ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(cust.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(cust.data)} onPage={setPg('customers')} label={tx('cg.ptab.customers')} />}>
        {!can('customers.view') ? <div className="fk-hint">{tx('cg.noCustomerAccess')}</div> : cust.error ? <StateBlock error={cust.error} onRetry={cust.reload} /> : !cust.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : cust.data.needsQuery ? <Empty title={tx('cg.customerNeedsQuery')} /> : cust.data.items.length === 0 ? <Empty title={tx('cg.noCustomerHistory', { q })} />
          : <CustomerHistoryTable rows={cust.data.items} onCustomer={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)} />}
        <div className="fk-hint">{tx('cg.chargedRule')}</div>
      </FitPanel> : null}

      {detail ? <ServicePriceDetails serviceId={detail} canEdit={can('services.edit')} onClose={() => setDetail(null)} onEdit={(s) => { setDetail(null); setEditing(s); }} /> : null}
      {editing ? <EditPricingDialog service={editing} onClose={() => setEditing(null)} onSaved={saved} /> : null}
    </div>
  );
}

function ServicePriceDetails({ serviceId, canEdit, onClose, onEdit }: { serviceId: string; canEdit: boolean; onClose: () => void; onEdit: (s: any) => void }) {
  const [t, setT] = useState<'overview' | 'history' | 'branches'>('overview'); const [hp, setHp] = useState(1);
  const d = useLoad(() => posCatalogApi.service(serviceId), [serviceId]);
  const h = useLoad(() => (t === 'history' ? posCatalogApi.history({ serviceId, field: 'all', page: hp, pageSize: 8 }) : Promise.resolve(null)), [serviceId, t, hp]);
  const x = d.data;
  return (
    <FitDialog wide title={x ? x.name : tx('pos.details')} subtitle={x ? <><span className={'fk-chip ' + (STATUS_TONE[x.status] ?? 'mut')}>{statusText(x.status)}</span> {fmtMoney(x.priceCents)} · {mins(x.durationMinutes)}</> : undefined} onClose={onClose} testId="dlg-price-details"
      footer={<>{x && canEdit && x.status !== 'archived' ? <button type="button" className="fk-btn primary" onClick={() => onEdit(x)} data-testid="details-edit-pricing">{tx('cg.qa.editPricing')}</button> : null}<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fk-seg mos-dtabs" role="tablist" aria-label={tx('pos.details')}>
          {(['overview', 'history', 'branches'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={t === k} className={t === k ? 'on' : ''} onClick={() => setT(k)} data-testid={'pd-tab-' + k}>{tx('cg.pdtab.' + k)}</button>)}
        </div>
        {t === 'overview' ? <dl className="fk-dl mo-dl" data-testid="pd-overview">
          <dt>{tx('pos.category')}</dt><dd>{x.categoryName ?? tx('cg.uncategorized')}</dd>
          <dt>{tx('pos.price')}</dt><dd><b>{fmtMoney(x.priceCents)}</b></dd>
          <dt>{tx('pos.duration')}</dt><dd>{mins(x.durationMinutes)}</dd>
          <dt>{tx('cg.channels')}</dt><dd>{x.onlineBookable ? tx('cg.onlineYes') : tx('cg.onlineNo')}</dd>
          <dt>{tx('cg.lastCharged')}</dt><dd>{x.sales90d.lastChargedCents == null ? tx('cg.noSales') : `${fmtMoney(x.sales90d.lastChargedCents)} · ${day(x.sales90d.lastAt)}`}</dd>
          <dt>{tx('cg.sold90')}</dt><dd>{x.sales90d.lines ? tx('cg.sold90v', { n: nf(x.sales90d.lines), v: fmtMoney(x.sales90d.cents), d: day(x.sales90d.lastAt) }) : tx('cg.noSales')}</dd>
          <dt>{tx('cg.f.id')}</dt><dd className="mos-mono">{x.serviceId}</dd>
          <dt>{tx('cg.f.updated')}</dt><dd>{day(x.updatedAt)}</dd>
        </dl> : null}
        {t === 'history' ? (h.error ? <StateBlock error={h.error} onRetry={h.reload} /> : !h.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : h.data.items.length === 0 ? <Empty title={tx('cg.noHistory')} /> : <><ChangeHistoryTable rows={h.data.items} showItem={false} /><Pager info={pageOf(h.data)} onPage={setHp} /></>) : null}
        {t === 'branches' ? <table className="fk-table fn-table cg-table" data-testid="pd-branches"><thead><tr><th>{tx('cg.col.branch')}</th><th className="num">{tx('pos.price')}</th><th className="num">{tx('pos.duration')}</th><th>{tx('pos.status')}</th></tr></thead>
          <tbody>{x.branches.map((b: any) => <tr key={b.branchId}><td>{b.name}<span className="fk-li-s">{b.current ? tx('cg.thisBranch') : b.differsFromThis ? tx('cg.differs') : b.offered ? tx('cg.same') : tx('cg.notOffered')}</span></td>
            <td className="num">{b.offered ? fmtMoney(b.priceCents) : '—'}</td><td className="num">{b.offered ? mins(b.durationMinutes) : '—'}</td><td>{b.offered ? statusText(b.status) : tx('cg.notOffered')}</td></tr>)}</tbody></table> : null}
      </>}
    </FitDialog>
  );
}
