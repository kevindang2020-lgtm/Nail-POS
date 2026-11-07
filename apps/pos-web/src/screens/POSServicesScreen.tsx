// POSServicesScreen.tsx — Services & Products (/services). Owner blueprint rebuild (Oct 30 2026), one vertical scroll:
//   1 header (Refresh · Export Data · Import Catalog · Add New) · ONE search box with a scope (everything · services ·
//     products · customer history · technician) · Today / Week / Month / Year / Custom with the date field it filters
//   2 ten KPIs in two rows of five — each states what it counts; a figure the data cannot support is "—" with the reason
//   3 Service Menu | Retail Product Catalog — each its own server-paged, newest-first list with View All
//   4 Bundles / Packages / Membership Add-ons (real /pos/bundles, with New Bundle) | AI Pricing & Menu Insights | Inventory
//     Alerts (the canonical Stock Alerts set — the same number as the sidebar)
//   5 Service / Product Detail (status toggle, Edit, qualified technicians) | Branches — the real branch model: every
//     branch keeps its own service rows, so each branch's own price / duration / status is shown; Configure edits the row
//     of the branch you are in (a branch's row is changed from that branch). No invented "+10%" overrides.
//   6 four charts on REALIZED paid ticket lines in the period (before refunds): Service Mix, Retail Mix, Category Revenue,
//     Add-On Conversion · 7 eight Quick Actions.
// Every number is the server's (/pos/catalog/*, /tenant/inventory/*, /pos/bundles, /pos/menu-insights), tenant-scoped,
// integer cents, the salon's days. Nothing here is seeded or estimated.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCatalogApi } from '../api/posCatalogApi';
import { posServicesApi } from '../api/posServicesApi';
import { posBundlesApi } from '../api/posBundlesApi';
import { posMenuInsightsApi } from '../api/posMenuInsightsApi';
import { posInventoryAlertsApi } from '../api/posInventoryAlertsApi';
import { posInventoryScreenApi } from '../api/posInventoryScreenApi';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { useCan } from '../components/usePermissions';
import { ProductFormDialog } from '../components/InventoryKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney } from '../i18n/format';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, centsFromText, type PeriodState } from '../components/FinanceKit';
import { nf, money, mins, day, pageOf, invPageOf, STATUS_TONE, statusText, saveCsv, Donut, Bars, Gauge, CustomerHistoryTable, EditPricingDialog, ServiceDialog } from './catalogShared';

type Scope = 'all' | 'services' | 'products' | 'customers' | 'technicians';
const SCOPES: Scope[] = ['all', 'services', 'products', 'customers', 'technicians'];
const BASES = ['sold', 'created', 'updated'];
const PAGE = 6;
const looksLikeCustomer = (q: string) => /^#\d+$/.test(q) || (q.replace(/\D/g, '').length >= 4 && !/[a-z]/i.test(q));
type BundleRow = { bundleId: string; name: string; kind: string; priceCents: number; savingsCents: number; status: string; isLiveNow: boolean };
type BundleState = { kpis?: { activeBundles: number }; rows?: BundleRow[] };
type Insight = { id: string; title: string; message: string; severity: string };
type Insights = { hasEnoughData?: boolean; insights?: Insight[] };
type AlertRow = { productId: string; name: string; onHand: number; reorderLevel: number; severity: string };
type ImportRow = { line: number; name: string; categoryName: string; categoryExists: boolean; priceDisplay: string; durationMinutes: number; action: string; errors?: string[] };
type ProductPick = { id: string; name: string; retailCents: number | null };
const SEV_TONE: Record<string, string> = { out_of_stock: 'bad', critical: 'bad', low: 'warn' };

export function POSServicesScreen() {
  const nav = useNavigate(); const can = useCan();
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [scope, setScope] = useState<Scope>('all');
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' });
  const [basis, setBasis] = useState('sold');
  const [svcPage, setSvcPage] = useState(1); const [prdPage, setPrdPage] = useState(1); const [custPage, setCustPage] = useState(1);
  const [tick, setTick] = useState(0); const reload = () => setTick((n) => n + 1);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [selSvc, setSelSvc] = useState<string | null>(null); const [selPrd, setSelPrd] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'service' | 'product'>('service');
  const [dialog, setDialog] = useState<null | { kind: 'service'; service: any | null } | { kind: 'pricing'; service: any } | { kind: 'import' } | { kind: 'bundle' } | { kind: 'addNew' } | { kind: 'product' }>(null);
  const [exporting, setExporting] = useState(false);

  const per = periodQuery(period);
  const listDate = basis === 'sold' ? {} : { dateField: basis, ...per };
  const svcQ = scope === 'all' || scope === 'services' ? (looksLikeCustomer(q) ? '' : q) : '';
  const techQ = scope === 'technicians' ? q : '';
  const prdQ = scope === 'all' || scope === 'products' ? (looksLikeCustomer(q) ? '' : q) : '';
  const showCustomers = !!q && (scope === 'customers' || (scope === 'all' && looksLikeCustomer(q)));
  const svcScope = { q: svcQ || undefined, technician: techQ || undefined, ...listDate };
  const prdScope = { search: prdQ || undefined, lifecycle: 'active', ...listDate };
  const keys = { svc: JSON.stringify(svcScope), prd: JSON.stringify(prdScope), cust: q + JSON.stringify(per) };
  useEffect(() => setSvcPage(1), [keys.svc]);
  useEffect(() => setPrdPage(1), [keys.prd]);
  useEffect(() => setCustPage(1), [keys.cust]);

  const dash = useLoad(() => posCatalogApi.dashboard(per), [JSON.stringify(per), tick]);
  const charts = useLoad(() => posCatalogApi.charts(per), [JSON.stringify(per), tick]);
  const svcs = useLoad(() => (scope === 'products' || scope === 'customers' ? Promise.resolve(null) : posCatalogApi.services({ ...svcScope, page: svcPage, pageSize: PAGE })), [scope, keys.svc, svcPage, tick]);
  const prds = useLoad(() => (scope === 'services' || scope === 'technicians' || scope === 'customers' || !can('inventory.view') ? Promise.resolve(null) : posInventoryScreenApi.products({ ...prdScope, page: prdPage, pageSize: PAGE })), [scope, keys.prd, prdPage, tick]);
  const cust = useLoad(() => (showCustomers && can('customers.view') ? posCatalogApi.customerHistory({ q, ...per, page: custPage, pageSize: 8 }) : Promise.resolve(null)), [showCustomers, keys.cust, custPage, tick]);
  const bundles = useLoad(() => (can('services.view') ? posBundlesApi.state() as Promise<BundleState> : Promise.resolve(null)), [tick]);
  const insights = useLoad(() => posMenuInsightsApi.get(30) as Promise<Insights>, [tick]);
  const alerts = useLoad(() => (can('inventory.view') ? Promise.all([posInventoryAlertsApi.summary(), posInventoryAlertsApi.active({ page: 1, pageSize: 5 })]) : Promise.resolve(null)), [tick]);
  const cats = useLoad(() => posCatalogApi.categories({ status: 'current', sort: 'name', pageSize: 100 }), [tick]);

  const firstSvc = svcs.data?.items?.[0]?.serviceId ?? null; const firstPrd = prds.data?.rows?.[0]?.id ?? null;
  const svcId = selSvc ?? firstSvc; const prdId = selPrd ?? firstPrd;
  const svcDetail = useLoad(() => (svcId ? posCatalogApi.service(svcId) : Promise.resolve(null)), [svcId, tick]);
  // live availability of the qualified technicians (who can do it AND is free right now)
  const qualified = useLoad(() => (svcId ? Promise.resolve(posTechniciansApi.qualified(svcId)).catch(() => null) : Promise.resolve(null)), [svcId, tick]);
  const prdDetail = useLoad(() => (prdId && detailTab === 'product' ? posInventoryScreenApi.product(prdId) : Promise.resolve(null)), [prdId, detailTab, tick]);

  const k = dash.data?.kpis; const sum = alerts.data?.[0];
  const catOptions = (cats.data?.items ?? []).map((c: any) => ({ categoryId: c.categoryId, name: c.name }));
  const filtered = !!(search || scope !== 'all' || period.preset !== 'month' || basis !== 'sold');
  const clearAll = () => { setSearch(''); setScope('all'); setPeriod({ preset: 'month' }); setBasis('sold'); };
  const done = (msg: string) => { setDialog(null); setNote({ tone: 'ok', text: msg }); reload(); };
  const doExport = async () => {
    setExporting(true); setNote(null);
    try {
      // D2 (Nov 3 2026): the export is the list the screen shows — the same search, technician and date filters, every page.
      // It used to call the older export with only the search text (a different matcher, no technician / date filter).
      const rows: any[] = []; let page = 1, pages = 1;
      do { const r: any = await posCatalogApi.services({ ...svcScope, page, pageSize: 100 }); rows.push(...(r?.items ?? [])); pages = Number(r?.totalPages) || 1; page++; } while (page <= pages && page <= 200);
      const esc = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
      const csv = [(['id', 'name', 'category', 'price', 'duration', 'status', 'online', 'location', 'sold30', 'created'] as const).map((k) => esc(tx('cg.csv.' + k))).join(','),
        ...rows.map((x) => [x.serviceId, x.name, x.categoryName ?? '', (Number(x.priceCents) / 100).toFixed(2), x.durationMinutes, x.status, x.onlineBookable ? 'yes' : 'no', x.branchName ?? '', x.sold30d, x.createdAt ?? ''].map(esc).join(','))].join('\n');
      saveCsv('services.csv', csv);
      setNote({ tone: 'ok', text: tx('finance.exported') });
    } catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('finance.state.loadFailed')) }); } finally { setExporting(false); }
  };
  const toggleStatus = async (s: any) => {
    setNote(null);
    try {
      if (s.status === 'active') await posServicesApi.update(s.serviceId, { status: 'inactive' });
      else if (s.status === 'archived') await posServicesApi.reactivate(s.serviceId);
      else await posServicesApi.update(s.serviceId, { status: 'active' });
      setNote({ tone: 'ok', text: tx(s.status === 'active' ? 'cg.svc.deactivated' : 'cg.svc.activated', { name: s.name }) }); reload();
    } catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('pos.save_failed')) }); }
  };
  const realizedSub = (basisKey: string | null | undefined) => (basisKey === 'realized' ? tx('cg.kpi.realized') : basisKey === 'menu' ? tx('cg.kpi.menuFallback') : tx('cg.kpi.noSales'));

  if (isForbidden(dash.error)) return <div className="work mos svp" data-testid="services-screen"><h1>{tx('pos.services_products')}</h1><StateBlock error={dash.error} onRetry={dash.reload} /></div>;
  const sd = svcDetail.data;
  return (
    <div className="work mos svp" data-testid="services-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.services_products')}</h1><div className="sub">{tx('pos.manage_service_menu_pricing_add_ons_iede')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={reload} data-testid="refresh">{tx('finance.refresh')}</button>
          {can('services.view') ? <button type="button" className="fk-btn ghost" onClick={doExport} disabled={exporting} data-testid="export">{exporting ? tx('pos.loading') : tx('pos.export_data')}</button> : null}
          {can('services.edit') ? <button type="button" className="fk-btn ghost" onClick={() => setDialog({ kind: 'import' })} data-testid="import">{tx('cg.importCatalog')}</button> : null}
          <button type="button" className="fk-btn primary" onClick={() => setDialog({ kind: 'addNew' })} data-testid="add-new">{tx('pos.add_new')}</button>
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <div className="mos-tools" data-testid="toolbar">
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('cg.svp.searchPh')} aria-label={tx('cg.svp.searchPh')} data-testid="search" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        <select className="fk-select" value={scope} onChange={(e) => setScope(e.target.value as Scope)} aria-label={tx('cg.scope')} data-testid="scope">{SCOPES.map((s) => <option key={s} value={s} disabled={(s === 'customers' && !can('customers.view')) || (s === 'products' && !can('inventory.view'))}>{tx('cg.scope.' + s)}</option>)}</select>
      </div>
      <div className="fn-tabsrow dsc-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={dash.data?.period} allowAll compact basis={basis} basisOptions={BASES.map((b) => ({ value: b, label: tx('cg.df.' + b) }))} onBasis={setBasis} />
        {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div>
      <div className="fk-hint mos-scope" data-testid="scope-note">{basis === 'sold' ? tx('cg.svp.periodSold') : tx('cg.svp.periodList', { f: tx('cg.df.' + basis) })}</div>

      <div className="fk-kpis five cg-kpis" data-testid="kpis">
        {dash.error ? <StateBlock error={dash.error} onRetry={dash.reload} /> : <>
          <KpiCard testId="kpi-total-services" label={tx('pos.total_services')} loading={!k} value={k ? nf(k.totalServices) : ''} sub={k ? tx('cg.kpi.totalSub', { a: nf(k.activeServices), i: nf(k.inactiveServices) }) : ''} onClick={() => setScope('services')} />
          <KpiCard testId="kpi-active-products" label={tx('pos.active_products')} loading={!k} value={k ? nf(k.activeProducts) : ''} sub={k ? tx('cg.kpi.productsSub', { n: nf(k.allProducts) }) : ''} onClick={() => setScope('products')} />
          <KpiCard testId="kpi-online" label={tx('pos.online_bookable')} loading={!k} value={k ? nf(k.onlineBookable) : ''} sub={k ? (k.onlinePctOfActive == null ? tx('cg.kpi.noActive') : tx('cg.kpi.onlineSub', { p: nf(k.onlinePctOfActive) })) : ''} />
          <KpiCard testId="kpi-low-stock" tone={sum && sum.openAlerts > 0 ? 'warn' : undefined} label={tx('pos.low_stock_alerts')} loading={!!can('inventory.view') && !sum} value={sum ? nf(sum.openAlerts) : '—'} sub={sum ? tx('cg.kpi.alertsSub', { o: nf(sum.outOfStock), c: nf(sum.critical) }) : tx('cg.kpi.noInventoryAccess')} onClick={() => nav('/tenant/inventory/alerts')} />
          <KpiCard testId="kpi-avg-price" tone="gold" label={tx('pos.avg_service_price')} loading={!k} value={k ? money(k.avgServicePriceCents) : ''} sub={k ? tx('cg.kpi.avgSub', { n: nf(k.pricedServices) }) : ''} onClick={() => nav('/tenant/services/pricing')} />
        </>}
      </div>
      <div className="fk-kpis five cg-kpis" data-testid="kpis-2">
        {dash.error ? null : <>
          <KpiCard testId="kpi-retail-today" label={tx('pos.retail_revenue_today')} loading={!k} value={k ? fmtMoney(k.retailRevenueTodayCents) : ''} sub={k ? tx('cg.kpi.retailSub', { n: nf(k.retailItemsToday), t: nf(k.retailTicketsToday) }) : ''} />
          <KpiCard testId="kpi-margin" label={tx('pos.service_mix_margin')} loading={!k} value="—" sub={tx('cg.kpi.marginReason')} />
          <KpiCard testId="kpi-top-category" label={tx('pos.top_category')} loading={!k} value={k ? k.topCategory ?? '—' : ''} sub={k ? `${realizedSub(k.topCategoryBasis)}${k.topCategoryCents != null ? ' · ' + fmtMoney(k.topCategoryCents) : ''}` : ''} onClick={() => nav('/tenant/services/categories')} />
          <KpiCard testId="kpi-packages" label={tx('pos.package_sales')} loading={!k} value="—" sub={k ? tx('cg.kpi.packagesSub', { n: nf(k.activeBundles) }) : ''} />
          <KpiCard testId="kpi-add-on-conversion" label={tx('pos.add_on_conversion')} loading={!k} value={k ? (k.addOnConversionPct == null ? '—' : `${k.addOnConversionPct}%`) : ''} sub={k ? (k.serviceTickets ? tx('cg.kpi.convSub', { a: nf(k.addOnTickets), s: nf(k.serviceTickets) }) : tx('cg.kpi.noServiceTickets')) : ''} onClick={() => nav('/tenant/services/add-ons')} />
        </>}
      </div>

      {showCustomers ? <FitPanel testId="customer-history" title={<>{tx('cg.customerHistory')}{cust.data && !cust.data.needsQuery ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(cust.data.totalItems) })}</span> : null}</>}
        footer={<Pager info={pageOf(cust.data)} onPage={setCustPage} label={tx('cg.customerHistory')} />}>
        {!can('customers.view') ? <div className="fk-hint">{tx('cg.noCustomerAccess')}</div> : cust.error ? <StateBlock error={cust.error} onRetry={cust.reload} /> : !cust.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : cust.data.needsQuery ? <div className="fk-hint">{tx('cg.customerNeedsQuery')}</div> : cust.data.items.length === 0 ? <Empty title={tx('cg.noCustomerHistory', { q })} />
          : <CustomerHistoryTable rows={cust.data.items} onCustomer={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)} />}
      </FitPanel> : null}

      <div className="mos-row two cg-row">
        {scope === 'products' || scope === 'customers' ? null : <FitPanel testId="service-menu" title={<>{tx('cg.serviceMenu')}{svcs.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(svcs.data.totalItems) })}</span> : null}</>}
          actions={<button type="button" className="fk-link" onClick={() => nav('/tenant/services/pricing')} data-testid="services-view-all">{tx('cg.viewAll')}</button>}
          footer={<Pager info={pageOf(svcs.data)} onPage={setSvcPage} compact label={tx('cg.serviceMenu')} />}>
          {svcs.error ? <StateBlock error={svcs.error} onRetry={svcs.reload} /> : !svcs.data ? <div className="fk-loading">{tx('pos.loading_services')}</div>
            : svcs.data.items.length === 0 ? (filtered ? <Empty title={q ? tx('cg.noMatchSearch', { q }) : tx('cg.noMatch')}><button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button></Empty>
              : <Empty title={tx('pos.no_services_in_the_menu_yet')}>{can('services.edit') ? <button type="button" className="fk-btn primary" onClick={() => setDialog({ kind: 'service', service: null })}>{tx('cg.qa.addService')}</button> : null}</Empty>)
            : <table className="fk-table fn-table cg-table" data-testid="services-table">
              <thead><tr><th>{tx('pos.service_3')}</th><th className="t-opt">{tx('pos.category')}</th><th className="num">{tx('pos.duration')}</th><th className="num">{tx('pos.price')}</th><th>{tx('pos.status')}</th></tr></thead>
              <tbody>{svcs.data.items.map((s: any) => <tr key={s.serviceId} data-testid="service-row" className={'inv2-click' + (s.serviceId === svcId ? ' sel' : '')} onClick={() => { setSelSvc(s.serviceId); setDetailTab('service'); }}>
                <td><span className="fk-li-t">{s.name}</span><span className="fk-li-s">{s.matchedVia ? tx('cg.via.' + s.matchedVia) : s.onlineBookable ? tx('cg.onlineYes') : tx('cg.onlineNo')}{s.addOns ? ` · ${tx('cg.addOnsN', { n: nf(s.addOns) })}` : ''}</span></td>
                <td className="t-opt">{s.categoryName ?? <span className="fk-muted">{tx('cg.uncategorized')}</span>}</td>
                <td className="num">{mins(s.durationMinutes)}</td><td className="num"><b>{fmtMoney(s.priceCents)}</b></td>
                <td><span className={'fk-chip ' + (STATUS_TONE[s.status] ?? 'mut')}>{statusText(s.status)}</span></td>
              </tr>)}</tbody>
            </table>}
        </FitPanel>}
        {scope === 'services' || scope === 'technicians' || scope === 'customers' ? null : <FitPanel testId="product-catalog" title={<>{tx('cg.productCatalog')}{prds.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(prds.data.total) })}</span> : null}</>}
          actions={<button type="button" className="fk-link" onClick={() => nav('/tenant/products')} data-testid="products-view-all">{tx('cg.viewAll')}</button>}
          footer={<Pager info={invPageOf(prds.data)} onPage={setPrdPage} compact label={tx('cg.productCatalog')} />}>
          {!can('inventory.view') ? <div className="fk-hint">{tx('cg.kpi.noInventoryAccess')}</div> : prds.error ? <StateBlock error={prds.error} onRetry={prds.reload} /> : !prds.data ? <div className="fk-loading">{tx('pos.loading')}</div>
            : prds.data.rows.length === 0 ? <Empty title={q ? tx('cg.noMatchSearch', { q }) : tx('cg.noProducts')} />
            : <table className="fk-table fn-table cg-table" data-testid="products-table">
              <thead><tr><th>{tx('cg.col.product')}</th><th className="t-opt">{tx('cg.col.sku')}</th><th className="num">{tx('cg.col.onHand')}</th><th className="num">{tx('cg.col.retail')}</th><th className="num t-opt">{tx('cg.col.margin')}</th></tr></thead>
              <tbody>{prds.data.rows.map((p: any) => <tr key={p.id} data-testid="product-row" className={'inv2-click' + (p.id === prdId && detailTab === 'product' ? ' sel' : '')} onClick={() => { setSelPrd(p.id); setDetailTab('product'); }}>
                <td><span className="fk-li-t">{p.name}</span><span className="fk-li-s">{[p.brand, p.category].filter(Boolean).join(' · ') || '—'}</span></td>
                <td className="t-opt cg-mono">{p.sku ?? '—'}</td>
                <td className="num">{nf(p.onHand)}{p.severity && SEV_TONE[p.severity] ? <span className={'fk-chip ' + SEV_TONE[p.severity]}>{tx('inv.sev.' + p.severity)}</span> : null}</td>
                <td className="num">{money(p.retailCents)}</td>
                <td className="num t-opt">{p.retailCents && p.costCents != null ? `${Math.round(((p.retailCents - p.costCents) / p.retailCents) * 100)}%` : '—'}</td>
              </tr>)}</tbody>
            </table>}
        </FitPanel>}
      </div>

      <div className="mos-row three">
        <FitPanel testId="bundles" title={<>{tx('cg.bundles')}{bundles.data ? <span className="fk-muted"> · {tx('cg.bundlesActive', { n: nf(bundles.data.kpis?.activeBundles) })}</span> : null}</>}
          actions={can('services.edit') ? <button type="button" className="fk-link" onClick={() => setDialog({ kind: 'bundle' })} data-testid="bundle-new">{tx('cg.qa.createBundle')}</button> : undefined}>
          {!can('services.view') ? <div className="fk-hint">{tx('cg.noBundleAccess')}</div> : bundles.error ? <StateBlock error={bundles.error} onRetry={bundles.reload} /> : !bundles.data ? <div className="fk-loading">{tx('pos.loading')}</div>
            : (bundles.data.rows ?? []).length === 0 ? <Empty title={tx('cg.noBundles')} />
            : <ul className="fk-list dense" data-testid="bundle-list">{(bundles.data.rows ?? []).slice(0, 5).map((b) => <li key={b.bundleId} className="fk-li"><span className="fk-li-t">{b.name}<span className="fk-li-s">{tx('cg.bundleKind.' + (['bundle', 'package', 'membership', 'promo'].includes(b.kind) ? b.kind : 'bundle'))}{b.savingsCents > 0 ? ` · ${tx('cg.saves', { v: fmtMoney(b.savingsCents) })}` : ''}</span></span>
              <b>{fmtMoney(b.priceCents)}</b><span className={'fk-chip ' + (b.isLiveNow ? 'ok' : 'mut')}>{b.isLiveNow ? tx('cg.live') : tx('cg.status.' + (b.status === 'archived' ? 'archived' : 'inactive'))}</span></li>)}</ul>}
          <div className="fk-hint">{tx('cg.bundlesRule')}</div>
        </FitPanel>
        <FitPanel testId="insights" title={tx('cg.insights')}>
          {insights.error ? <StateBlock error={insights.error} onRetry={insights.reload} /> : !insights.data ? <div className="fk-loading">{tx('pos.loading')}</div>
            : !insights.data.hasEnoughData || !(insights.data.insights ?? []).length ? <Empty title={tx('cg.insightsThin')} />
            : <ul className="fk-list dense" data-testid="insight-list">{(insights.data.insights ?? []).slice(0, 4).map((i) => <li key={i.id} className="fk-li"><span className="fk-li-t">{i.title}<span className="fk-li-s">{i.message}</span></span>
              <span className={'fk-chip ' + (i.severity === 'warning' ? 'warn' : i.severity === 'opportunity' ? 'ok' : 'info')}>{tx('cg.sev.' + (['warning', 'opportunity'].includes(i.severity) ? i.severity : 'info'))}</span></li>)}</ul>}
          <div className="fk-hint">{tx('cg.insightsRule')}</div>
        </FitPanel>
        <FitPanel testId="inventory-alerts" title={<>{tx('cg.inventoryAlerts')}{sum ? <span className="fk-muted"> · {nf(sum.openAlerts)}</span> : null}</>}
          actions={<button type="button" className="fk-link" onClick={() => nav('/tenant/inventory/alerts')} data-testid="alerts-view-all">{tx('cg.viewAll')}</button>}>
          {!can('inventory.view') ? <div className="fk-hint">{tx('cg.kpi.noInventoryAccess')}</div> : alerts.error ? <StateBlock error={alerts.error} onRetry={alerts.reload} /> : !alerts.data ? <div className="fk-loading">{tx('pos.loading')}</div>
            : (alerts.data[1]?.rows ?? []).length === 0 ? <Empty title={tx('cg.noAlerts')} />
            : <ul className="fk-list dense" data-testid="alert-list">{(alerts.data[1].rows as AlertRow[]).map((a) => <li key={a.productId} className="fk-li"><span className="fk-li-t">{a.name}<span className="fk-li-s">{tx('cg.alertLine', { h: nf(a.onHand), r: nf(a.reorderLevel) })}</span></span>
              <span className={'fk-chip ' + (SEV_TONE[a.severity] ?? 'warn')}>{tx('inv.sev.' + a.severity)}</span></li>)}</ul>}
        </FitPanel>
      </div>

      <div className="mos-row two cg-row">
        <FitPanel testId="detail" title={tx('cg.detail')}
          actions={<div className="fk-seg" role="tablist" aria-label={tx('cg.detail')}>{(['service', 'product'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={detailTab === t} className={detailTab === t ? 'on' : ''} onClick={() => setDetailTab(t)} data-testid={'detail-tab-' + t}>{tx('cg.detailTab.' + t)}</button>)}</div>}>
          {detailTab === 'service' ? (!svcId ? <Empty title={tx('cg.pickService')} /> : svcDetail.error ? <StateBlock error={svcDetail.error} onRetry={svcDetail.reload} /> : !sd ? <div className="fk-loading">{tx('pos.loading')}</div> : <div data-testid="service-detail">
            <div className="cg-dhead"><b className="cg-dname">{sd.name}</b><span className={'fk-chip ' + (STATUS_TONE[sd.status] ?? 'mut')}>{statusText(sd.status)}</span>
              <span className="cg-dacts">
                {can('services.edit') ? <button type="button" className="fk-btn ghost sm" onClick={() => toggleStatus(sd)} data-testid="detail-toggle">{sd.status === 'active' ? tx('cg.deactivate') : tx('cg.activate')}</button> : null}
                {can('services.edit') ? <button type="button" className="fk-btn ghost sm" onClick={() => setDialog({ kind: 'pricing', service: sd })} data-testid="detail-pricing">{tx('cg.qa.editPricing')}</button> : null}
                {can('services.edit') ? <button type="button" className="fk-btn sm" onClick={() => setDialog({ kind: 'service', service: sd })} data-testid="detail-edit">{tx('pos.edit')}</button> : null}
              </span></div>
            <dl className="fk-dl mo-dl">
              <dt>{tx('pos.category')}</dt><dd>{sd.categoryName ?? tx('cg.uncategorized')}{sd.categoryArchived ? <span className="fk-chip warn">{tx('cg.categoryArchived')}</span> : null}</dd>
              <dt>{tx('pos.price')}</dt><dd><b>{fmtMoney(sd.priceCents)}</b> · {mins(sd.durationMinutes)}</dd>
              <dt>{tx('cg.channels')}</dt><dd>{sd.onlineBookable ? tx('cg.onlineYes') : tx('cg.onlineNo')} · {sd.aiBookable ? tx('cg.aiYes') : tx('cg.aiNo')}</dd>
              <dt>{tx('cg.addOns')}</dt><dd>{sd.addOns.length || sd.categoryAddOns.length ? [...sd.addOns.map((a: any) => `${a.name} (+${fmtMoney(a.priceCents)})`), ...sd.categoryAddOns.map((a: any) => a.name)].join(', ') : tx('pos.none')}</dd>
              <dt>{tx('cg.sold90')}</dt><dd>{sd.sales90d.lines ? tx('cg.sold90v', { n: nf(sd.sales90d.lines), v: fmtMoney(sd.sales90d.cents), d: day(sd.sales90d.lastAt) }) : tx('cg.noSales')}</dd>
              <dt>{tx('cg.changes')}</dt><dd>{sd.changeCount ? <button type="button" className="fk-link" onClick={() => nav(`/tenant/services/pricing?tab=history&serviceId=${encodeURIComponent(sd.serviceId)}`)}>{tx('cg.changesN', { n: nf(sd.changeCount) })}</button> : tx('cg.noChanges')}</dd>
            </dl>
            <h3 className="fk-h3">{tx('pos.qualified_technicians')}{Array.isArray(qualified.data) && qualified.data.length ? <span className="fk-muted" data-testid="available-now"> · {tx('cg.availableNow', { a: nf(qualified.data.filter((q: { workingStatus?: string }) => q.workingStatus === 'available').length), n: nf(qualified.data.length) })}</span> : null}</h3>
            {sd.technicians.length === 0 ? <div className="fk-hint">{tx('pos.no_technicians_are_qualified_for_this_82of')}</div>
              : <div className="cg-chips" data-testid="detail-techs">{sd.technicians.map((t: any) => <span key={t.technicianId} className="fk-chip">{t.name}{t.primary ? ' ★' : ''}</span>)}</div>}
          </div>) : (!prdId ? <Empty title={tx('cg.pickProduct')} /> : prdDetail.error ? <StateBlock error={prdDetail.error} onRetry={prdDetail.reload} /> : !prdDetail.data ? <div className="fk-loading">{tx('pos.loading')}</div> : (() => { const p: any = prdDetail.data.product ?? prdDetail.data; return <div data-testid="product-detail">
            <div className="cg-dhead"><b className="cg-dname">{p.name}</b>{p.severity && SEV_TONE[p.severity] ? <span className={'fk-chip ' + SEV_TONE[p.severity]}>{tx('inv.sev.' + p.severity)}</span> : null}
              <span className="cg-dacts"><button type="button" className="fk-btn sm" onClick={() => nav(`/tenant/products?productId=${encodeURIComponent(p.id)}`)} data-testid="product-open">{tx('cg.openProduct')}</button></span></div>
            <dl className="fk-dl mo-dl">
              <dt>{tx('cg.col.sku')}</dt><dd className="cg-mono">{p.sku ?? '—'}</dd>
              <dt>{tx('cg.brandCategory')}</dt><dd>{[p.brand, p.category].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>{tx('cg.col.onHand')}</dt><dd>{tx('cg.stockLine', { h: nf(p.onHand), r: nf(p.reorderLevel) })}</dd>
              <dt>{tx('cg.col.retail')}</dt><dd>{money(p.retailCents)}{p.costCents != null ? ` · ${tx('cg.cost', { v: fmtMoney(p.costCents) })}` : ''}</dd>
              <dt>{tx('cg.supplier')}</dt><dd>{p.vendor ?? '—'}</dd>
            </dl></div>; })())}
        </FitPanel>
        <FitPanel testId="branches" title={tx('cg.branches')}>
          {!sd ? <Empty title={tx('cg.pickService')} /> : <>
            <table className="fk-table fn-table cg-table" data-testid="branch-table">
              <thead><tr><th>{tx('cg.col.branch')}</th><th className="num">{tx('pos.price')}</th><th className="num">{tx('pos.duration')}</th><th>{tx('pos.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
              <tbody>{sd.branches.map((b: any) => <tr key={b.branchId} data-testid="branch-row" className={b.current ? 'sel' : ''}>
                <td><span className="fk-li-t">{b.name}</span><span className="fk-li-s">{b.current ? tx('cg.thisBranch') : !b.offered ? tx('cg.notOffered') : b.differsFromThis ? tx('cg.differs') : tx('cg.same')}</span></td>
                <td className="num">{b.offered ? fmtMoney(b.priceCents) : '—'}</td><td className="num">{b.offered ? mins(b.durationMinutes) : '—'}</td>
                <td>{b.offered ? <span className={'fk-chip ' + (STATUS_TONE[b.status] ?? 'mut')}>{statusText(b.status)}</span> : <span className="fk-muted">{tx('cg.notOffered')}</span>}</td>
                <td className="fn-acts">{b.current && can('services.edit') ? <button type="button" className="fk-btn ghost sm" onClick={() => setDialog({ kind: 'service', service: sd })} data-testid="branch-configure">{tx('cg.configure')}</button> : null}</td>
              </tr>)}</tbody>
            </table>
            <div className="fk-hint" data-testid="branch-rule">{tx('cg.branchRule')}</div>
          </>}
        </FitPanel>
      </div>

      <div className="mos-row four" data-testid="charts">
        <FitPanel testId="chart-service-mix" title={tx('cg.chart.serviceMix')}>{charts.error ? <StateBlock error={charts.error} onRetry={charts.reload} /> : !charts.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <Donut items={charts.data.serviceMix} testId="donut-service" empty={tx('cg.chart.noSales')} />}</FitPanel>
        <FitPanel testId="chart-retail-mix" title={tx('cg.chart.retailMix')}>{!charts.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <Donut items={charts.data.retailMix} testId="donut-retail" empty={tx('cg.chart.noRetail')} />}</FitPanel>
        <FitPanel testId="chart-category" title={tx('cg.chart.category')}>{!charts.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <Bars items={charts.data.categoryRevenue.slice(0, 6).map((c: any) => ({ name: c.label, value: c.cents, sub: tx('cg.linesN', { n: nf(c.count) }) }))} testId="bars-category" empty={tx('cg.chart.noSales')} fmt={(n) => fmtMoney(n)} />}</FitPanel>
        <FitPanel testId="chart-conversion" title={tx('cg.chart.conversion')}>{!charts.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <Gauge pct={charts.data.addOnConversion.pct} testId="gauge-conversion">{charts.data.addOnConversion.serviceTickets ? tx('cg.kpi.convSub', { a: nf(charts.data.addOnConversion.withAddOn), s: nf(charts.data.addOnConversion.serviceTickets) }) : tx('cg.kpi.noServiceTickets')}</Gauge>}</FitPanel>
      </div>
      <div className="fk-hint" data-testid="chart-rule">{tx('cg.chart.rule')}</div>

      <FitPanel testId="quick-actions" title={tx('cg.quickActions')}>
        <div className="cg-quick">
          {([['addService', () => setDialog({ kind: 'service', service: null }), 'services.edit'], ['addProduct', () => setDialog({ kind: 'product' }), 'inventory.create'], ['editPricing', () => nav('/tenant/services/pricing'), 'services.view'],
            ['createBundle', () => setDialog({ kind: 'bundle' }), 'services.edit'], ['manageInventory', () => nav('/tenant/inventory'), 'inventory.view'], ['updateBooking', () => nav('/tenant/services/pricing?online=true'), 'services.view'],
            ['importCatalog', () => setDialog({ kind: 'import' }), 'services.edit'], ['viewReports', () => nav('/tenant/reports/services'), 'services.view']] as const).map(([key, fn, perm]) =>
            <button key={key} type="button" className="fk-btn ghost cg-qa" onClick={fn} disabled={!can(perm)} title={!can(perm) ? tx('people.fit.noPermission') : undefined} data-testid={'qa-' + key}>{tx('cg.qa.' + key)}</button>)}
        </div>
      </FitPanel>

      {dialog?.kind === 'service' ? <ServiceDialog service={dialog.service} categories={catOptions} onClose={() => setDialog(null)} onSaved={done} /> : null}
      {dialog?.kind === 'pricing' ? <EditPricingDialog service={dialog.service} onClose={() => setDialog(null)} onSaved={done} /> : null}
      {dialog?.kind === 'import' ? <ImportDialog onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'bundle' ? <BundleDialog onClose={() => setDialog(null)} onDone={done} /> : null}
      {dialog?.kind === 'product' ? <ProductFormDialog onClose={() => setDialog(null)} onSaved={(id) => { setSelPrd(id); setDetailTab('product'); done(tx('prd.created')); }} /> : null}
      {dialog?.kind === 'addNew' ? <FitDialog title={tx('pos.add_new')} onClose={() => setDialog(null)} testId="dlg-add-new">
        <div className="cg-quick two">
          <button type="button" className="fk-btn primary" disabled={!can('services.edit')} onClick={() => setDialog({ kind: 'service', service: null })} data-testid="add-new-service">{tx('cg.qa.addService')}</button>
          <button type="button" className="fk-btn" disabled={!can('inventory.create')} onClick={() => setDialog({ kind: 'product' })} data-testid="add-new-product">{tx('cg.qa.addProduct')}</button>
          <button type="button" className="fk-btn" disabled={!can('services.edit')} onClick={() => nav('/tenant/services/add-ons?new=1')}>{tx('cg.newAddOn')}</button>
          <button type="button" className="fk-btn" disabled={!can('services.edit')} onClick={() => setDialog({ kind: 'bundle' })}>{tx('cg.qa.createBundle')}</button>
        </div>
      </FitDialog> : null}
    </div>
  );
}

/** Import Catalog — preview first (nothing written), then commit only the valid rows (the services module owns both). */
function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [csv, setCsv] = useState(''); const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const run = async (commit: boolean) => {
    if (!csv.trim()) { setErr(tx('pos.paste_or_load_a_csv_first')); return; }
    setBusy(true); setErr(null);
    try {
      if (!commit) { const p: any = await posServicesApi.importPreview(csv); setPreview(p); if (!p?.ok) setErr(p?.message || tx('pos.csv_could_not_be_read')); }
      else { const r: any = await posServicesApi.importCommit(csv); onDone(tx('cg.import.done', { c: nf(r?.created), u: nf(r?.updated), f: nf(r?.failed) })); }
    } catch (e) { setErr(errorTextOf(e, tx('pos.import_failed'))); } finally { setBusy(false); }
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setCsv(String(r.result || '')); setPreview(null); }; r.readAsText(f); e.target.value = ''; };
  return (
    <FitDialog wide title={tx('pos.import_catalog_csv')} subtitle={tx('cg.import.sub')} onClose={onClose} busy={busy} testId="dlg-import"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn" onClick={() => run(false)} disabled={busy} data-testid="import-preview">{tx('cg.import.preview')}</button>
        <button type="button" className="fk-btn primary" onClick={() => run(true)} disabled={busy || !preview?.ok} data-testid="import-commit">{tx('cg.import.commit')}</button></>}>
      <label className="fk-field wide">{tx('cg.import.csv')}<textarea value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} placeholder={tx('cg.import.csvPh')} data-testid="import-csv" /></label>
      <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label={tx('cg.import.file')} />
      {preview?.ok ? <div className="fk-note ok" data-testid="import-summary"><span>{tx('cg.import.summary', { n: nf(preview.totalRows), c: nf(preview.willCreate), u: nf(preview.willUpdate), e: nf(preview.errorCount) })}</span></div> : null}
      {preview?.rows?.length ? <table className="fk-table fn-table cg-table"><thead><tr><th>#</th><th>{tx('cg.f.name')}</th><th>{tx('pos.category')}</th><th className="num">{tx('pos.price')}</th><th className="num">{tx('pos.duration')}</th><th>{tx('cg.import.action')}</th></tr></thead>
        <tbody>{(preview.rows as ImportRow[]).slice(0, 50).map((r) => <tr key={r.line}><td>{r.line}</td><td>{r.name}</td><td>{r.categoryName}{!r.categoryExists ? <span className="fk-li-s">{tx('cg.import.newCat')}</span> : null}</td><td className="num">{r.priceDisplay}</td><td className="num">{mins(r.durationMinutes)}</td>
          <td>{r.action === 'error' ? <span className="fk-chip bad" title={(r.errors || []).join('; ')}>{(r.errors || []).join('; ')}</span> : <span className="fk-chip ok">{tx('cg.import.' + r.action)}</span>}</td></tr>)}</tbody></table> : null}
      {err ? <div className="fk-note bad" role="alert"><span>{err}</span></div> : null}
    </FitDialog>
  );
}

/** New Bundle / Package — real items (services and retail products at their current prices); the bundles module derives
 *  the components total and the savings. */
function BundleDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [name, setName] = useState(''); const [kind, setKind] = useState('bundle'); const [price, setPrice] = useState('');
  const [find, setFind] = useState(''); const fq = useDebounced(find.trim(), 250);
  const [items, setItems] = useState<{ itemType: 'service' | 'product'; refId: string; label: string; quantity: number; unitPriceCents: number }[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const svc = useLoad(() => posCatalogApi.services({ q: fq || undefined, status: 'active', sort: 'name', pageSize: 6 }), [fq]);
  const prd = useLoad(() => posInventoryScreenApi.products({ search: fq || undefined, lifecycle: 'active', sort: 'name', pageSize: 4 }).catch(() => null), [fq]);
  const add = (it: { itemType: 'service' | 'product'; refId: string; label: string; unitPriceCents: number }) => setItems((x) => x.some((y) => y.refId === it.refId) ? x : [...x, { ...it, quantity: 1 }]);
  const total = items.reduce((a, i) => a + i.unitPriceCents * i.quantity, 0);
  const save = async () => {
    const cents = centsFromText(price);
    if (!name.trim()) { setErr(tx('pos.name_is_required')); return; }
    if (!items.length) { setErr(tx('cg.bundle.needItems')); return; }
    if (cents == null) { setErr(tx('pos.enter_a_valid_price_dollars_and_1qkm')); return; }
    setBusy(true); setErr(null);
    try { await posBundlesApi.create({ name: name.trim(), kind, priceCents: cents, status: 'active', items }); onDone(tx('cg.bundle.created', { name: name.trim() })); }
    catch (e) { setErr(errorTextOf(e, tx('pos.create_failed'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog wide title={tx('cg.qa.createBundle')} subtitle={tx('cg.bundle.sub')} onClose={onClose} busy={busy} testId="dlg-bundle"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={save} disabled={busy} data-testid="bundle-save">{tx('cg.bundle.create')}</button></>}>
      <div className="cg-form">
        <label className="fk-field wide">{tx('cg.f.name')}<input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="bundle-name" /></label>
        <label className="fk-field">{tx('cg.bundle.kind')}<select value={kind} onChange={(e) => setKind(e.target.value)}>{['bundle', 'package', 'membership'].map((k) => <option key={k} value={k}>{tx('cg.bundleKind.' + k)}</option>)}</select></label>
        <label className="fk-field">{tx('cg.bundle.price')}<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="bundle-price" /><span className="fk-hint">{tx('cg.bundle.componentsTotal', { v: fmtMoney(total) })}</span></label>
        <label className="fk-field wide">{tx('cg.bundle.find')}<input type="search" value={find} onChange={(e) => setFind(e.target.value)} data-testid="bundle-find" /></label>
      </div>
      <div className="cg-pick">
        {(svc.data?.items ?? []).map((s: any) => <button key={s.serviceId} type="button" className="fk-btn ghost sm" onClick={() => add({ itemType: 'service', refId: s.serviceId, label: s.name, unitPriceCents: s.priceCents })}>+ {s.name} · {fmtMoney(s.priceCents)}</button>)}
        {(((prd.data as { rows?: ProductPick[] } | null)?.rows) ?? []).filter((p) => p.retailCents != null).map((p) => <button key={p.id} type="button" className="fk-btn ghost sm" onClick={() => add({ itemType: 'product', refId: p.id, label: p.name, unitPriceCents: p.retailCents ?? 0 })}>+ {p.name} · {fmtMoney(p.retailCents ?? 0)}</button>)}
      </div>
      {items.length ? <ul className="fk-list dense" data-testid="bundle-items">{items.map((i) => <li key={i.refId} className="fk-li"><span className="fk-li-t">{i.label}<span className="fk-li-s">{tx('cg.kind.' + (i.itemType === 'product' ? 'retail' : 'service'))}</span></span><b>{fmtMoney(i.unitPriceCents)}</b>
        <button type="button" className="fk-x" aria-label={tx('cg.remove')} onClick={() => setItems((x) => x.filter((y) => y.refId !== i.refId))}>✕</button></li>)}</ul> : <div className="fk-hint">{tx('cg.bundle.needItems')}</div>}
      {err ? <div className="fk-note bad" role="alert"><span>{err}</span></div> : null}
    </FitDialog>
  );
}
