// TenantInventoryScreen.tsx — Inventory Overview (/tenant/inventory). Inventory mandate (Oct 29 2026): the page the two ASUS
// photos show (the top KPIs, and the product rows further down — the page SCROLLS vertically; the sidebar keeps its own
// scroll), rebuilt on one read model (/tenant/inventory/screen/*):
//   * Refresh · Scan Receipt · + Add Product kept; "Updated hh:mm" only from a real refresh result;
//   * eight KPIs + Inventory Value, each with its unit / scope caption (what 11 · 20 · 171 · 128 actually counted: the old
//     cards mixed a cached stock row with bottle rows — see inventory-screen.repository.ts), click-through to the list;
//   * the AI Inventory Assistant notice kept (entitlement enforced by its own panel — never unlocked here), compact;
//   * eight tabs kept — All Inventory · Technician Reports · Purchase Orders · Transfers · Counts · Catalog · Recipes ·
//     Alerts — each with its OWN search, filters, period (with the date field named) and numbered server pages, newest
//     first; switching tabs keeps each tab's state;
//   * All Inventory: Available / On hand with the unit, Open / Unopened, reorder level, severity (colour + text), Last Used
//     By (latest confirmed use by when it happened — "No recorded use" otherwise, never the last editor), and Add Stock ·
//     Bottles · Edit kept, plus Details · Record Usage · Usage History · Movements · Reorder;
//   * Technician Reports: usage by technician (click → the products they used) and the bottle-report review queue;
//   * Alerts: the Stock Alerts list itself (one source of truth with the sidebar badge).
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createIntentKeys } from '@aipowersalon/api-client';
import { useInlineConfirm, useEventCallback } from '@aipowersalon/ui';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { inventoryApi, type InvProduct, type PurchaseOrderLine, type InvVendor, type TransferBranch, type CountDetail, type ServiceRecipe } from '../api/inventoryApi';
import { posInventoryScreenApi } from '../api/posInventoryScreenApi';
import { posInventoryAlertsApi } from '../api/posInventoryAlertsApi';
import { colorContrastWarning, readableTextColor } from '../lib/contrast';
import { AiAssistantPanel } from '../components/AiAssistantPanel';
import { posAiApi, type ParsedReceipt } from '../api/posAiApi';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';
import { statusLabel } from '../i18n/status-label';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { useCan } from '../components/usePermissions';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { StockChip, ProductDetailsDialog, ProductFormDialog, EditProductDialog, AddStockDialog, money, unitLabel, errMsg, sevLabel, when, day, ymd } from '../components/InventoryKit';
import { LastUsed, RecordUseDialog } from './POSInventoryAlertsScreen';

type Tab = 'products' | 'reports' | 'purchaseOrders' | 'transfers' | 'counts' | 'catalog' | 'recipes' | 'alerts';
const TABS: Tab[] = ['products', 'reports', 'purchaseOrders', 'transfers', 'counts', 'catalog', 'recipes', 'alerts'];
interface TabState { search: string; status: string; period: PeriodState; dateField: string; page: number; extra: Record<string, string> }
const INITIAL: Record<Tab, TabState> = {
  products: { search: '', status: '', period: { preset: 'all' }, dateField: 'created', page: 1, extra: { sort: 'newest' } },
  reports: { search: '', status: '', period: { preset: 'month' }, dateField: 'occurred', page: 1, extra: { view: 'technicians' } },
  purchaseOrders: { search: '', status: '', period: { preset: 'all' }, dateField: 'created', page: 1, extra: {} },
  transfers: { search: '', status: '', period: { preset: 'all' }, dateField: 'created', page: 1, extra: { direction: '' } },
  counts: { search: '', status: '', period: { preset: 'all' }, dateField: 'created', page: 1, extra: {} },
  catalog: { search: '', status: '', period: { preset: 'all' }, dateField: 'created', page: 1, extra: { kind: 'brand' } },
  recipes: { search: '', status: '', period: { preset: 'all' }, dateField: 'created', page: 1, extra: { withRecipe: '' } },
  alerts: { search: '', status: '', period: { preset: 'all' }, dateField: 'created', page: 1, extra: {} },
};
const PRODUCT_DATE_FIELDS = ['created', 'updated', 'activity', 'received', 'archived', 'expiration', 'used'];
const PO_STATUSES = ['open', 'active', 'draft', 'approved', 'ordered', 'partial', 'received', 'cancelled'];
const PO_TONE: Record<string, string> = { draft: 'mut', approved: 'info', ordered: 'info', partial: 'warn', received: 'ok', cancelled: 'bad', closed: 'mut' };
const SIZES: Record<Tab, number> = { products: 12, reports: 10, purchaseOrders: 10, transfers: 10, counts: 10, catalog: 10, recipes: 10, alerts: 12 };

/** Products for the create-PO / transfer / recipe pickers (the existing modals take a list) — loaded when one opens. */
function usePickProducts(open: boolean) {
  const [rows, setRows] = useState<InvProduct[] | null>(null);
  useEffect(() => { if (open && !rows) inventoryApi.products().then((r) => setRows(r?.products ?? [])).catch(() => setRows([])); }, [open, rows]);
  return rows;
}

export function TenantInventoryScreen() {
  const nav = useNavigate(); const can = useCan();
  const [params, setParams] = useSearchParams();
  const initialTab: Tab = (TABS as readonly string[]).includes(params.get('tab') || '') ? (params.get('tab') as Tab) : 'products';
  const [tab, setTabRaw] = useState<Tab>(initialTab);
  const [state, setState] = useState<Record<Tab, TabState>>(INITIAL);
  const s = state[tab];
  const patch = (p: Partial<TabState>, keepPage = false) => setState((x) => ({ ...x, [tab]: { ...x[tab], ...p, ...(keepPage || 'page' in p ? {} : { page: 1 }) } }));
  const setExtra = (k: string, v: string) => patch({ extra: { ...s.extra, [k]: v } });
  const listTop = useRef<HTMLDivElement | null>(null);
  const setTab = (t: Tab) => { setTabRaw(t); const sp = new URLSearchParams(params); sp.set('tab', t); setParams(sp, { replace: true }); };
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string; productId?: string } | null>(null);
  const [adding, setAdding] = useState(false); const [scanning, setScanning] = useState(false);
  const [detail, setDetail] = useState<{ id: string; tab?: any } | null>(null); const [editing, setEditing] = useState<string | null>(null);
  const [stockFor, setStockFor] = useState<any | null>(null); const [recording, setRecording] = useState<string | null>(null);
  useEffect(() => { if (params.get('add') === '1') { setAdding(true); const sp = new URLSearchParams(params); sp.delete('add'); setParams(sp, { replace: true }); } }, [params, setParams]);
  const q = useDebounced(s.search.trim(), 300);
  const metrics = useLoad(() => posInventoryScreenApi.metrics(), [tick]);
  const refresh = () => { setTick((t) => t + 1); window.dispatchEvent(new CustomEvent('aps:nav-counts-changed')); };
  const m = metrics.data;
  const go = (t: Tab, p: Partial<TabState> = {}) => { setTab(t); setState((x) => ({ ...x, [t]: { ...x[t], ...p, page: 1 } })); setTimeout(() => listTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0); };
  if (isForbidden(metrics.error)) return <div className="work inv2" data-testid="inventory-screen"><h1>{tx('pos.inventory')}</h1><StateBlock error={metrics.error} onRetry={metrics.reload} /></div>;
  const kpis: Array<{ id: string; label: string; value: string; sub: string; tone?: 'ok' | 'warn' | 'bad' | 'gold'; onClick?: () => void }> = m ? [
    { id: 'products', label: tx('pos.products'), value: fmtNumber(m.products), sub: tx('inv.kpi.productsSub'), onClick: () => go('products', { status: '', search: '' }) },
    { id: 'bottles', label: tx('admin.inventory.kpi.bottles'), value: fmtNumber(m.bottles), sub: m.bottlesByUnit.length > 1 ? m.bottlesByUnit.map((u: any) => `${fmtNumber(u.count)} ${unitLabel(u.unit)}`).join(' · ') : tx('inv.kpi.bottlesSub') },
    { id: 'open', label: tx('status.stock.opened'), value: fmtNumber(m.open), sub: tx('inv.kpi.openSub') },
    { id: 'unopened', label: tx('status.stock.unopened'), value: fmtNumber(m.unopened), sub: tx('inv.kpi.unopenedSub') },
    { id: 'low', label: tx('status.stock.low_stock'), value: fmtNumber(m.lowStock), tone: m.lowStock ? 'warn' : undefined, sub: tx('inv.kpi.lowSub', { c: fmtNumber(m.critical) }), onClick: () => go('products', { status: 'low' }) },
    { id: 'out', label: tx('pos.out_of_stock'), value: fmtNumber(m.outOfStock), tone: m.outOfStock ? 'bad' : undefined, sub: tx('inv.kpi.outSub'), onClick: () => go('products', { status: 'out_of_stock' }) },
    { id: 'expiring', label: tx('admin.inventory.kpi.expiringSoon'), value: fmtNumber(m.expiringSoon), tone: m.expiringSoon ? 'warn' : undefined, sub: tx('inv.kpi.expiringSub', { d: fmtNumber(m.expiryHorizonDays), x: fmtNumber(m.expired) }), onClick: () => go('products', { dateField: 'expiration', period: { preset: 'custom', from: m.today, to: addDays(m.today, m.expiryHorizonDays) } }) },
    { id: 'pending', label: tx('admin.inventory.kpi.pendingReports'), value: fmtNumber(m.pendingReports), tone: m.pendingReports ? 'warn' : undefined, sub: tx('inv.kpi.pendingSub'), onClick: () => go('reports', { extra: { view: 'bottle' } }) },
    ...(m.inventoryValueCents != null ? [{ id: 'value', label: tx('admin.inventory.kpi.value'), value: money(m.inventoryValueCents), tone: 'gold' as const, sub: m.productsWithoutCost ? tx('inv.kpi.valueSubMissing', { n: fmtNumber(m.productsWithoutCost) }) : tx('inv.kpi.valueSub') }] : []),
  ] : [];
  return (
    <div className="work inv2" data-testid="inventory-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.inventory')}</h1><div className="sub">{tx('pos.track_salon_products_bottles_colors_usage_1gi5')}{m ? <span className="fk-muted"> · {tx('inv.updated', { t: fmtInZone(m.asOf, { hour: 'numeric', minute: '2-digit' }) })}</span> : null}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={refresh} data-testid="refresh">{tx('pos.refresh')}</button>
          <button type="button" className="fk-btn" onClick={() => setScanning(true)} data-testid="scan-receipt">{tx('pos.scan_receipt')}</button>
          {can('inventory.create') ? <button type="button" className="fk-btn primary" onClick={() => setAdding(true)} data-testid="add-product">{tx('pos.add_product')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span>
        {note.productId ? <button type="button" className="fk-link" onClick={() => setDetail({ id: note.productId! })}>{tx('prd.viewProduct')}</button> : null}
        <button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      <div className="inv2-kpis" data-testid="kpis">
        {metrics.error ? <StateBlock error={metrics.error} onRetry={metrics.reload} /> : !m ? Array.from({ length: 9 }, (_, i) => <KpiCard key={i} label="…" loading value="" />)
          : kpis.map((k) => <KpiCard key={k.id} testId={'kpi-' + k.id} label={k.label} value={k.value} sub={k.sub} tone={k.tone} onClick={k.onClick} />)}
      </div>
      {m?.stockDrift ? <div className="fk-note warn" role="status" data-testid="drift-note"><span>{tx('inv.driftBanner', { n: fmtNumber(m.stockDrift) })}</span></div> : null}
      <div className="inv2-ai"><AiAssistantPanel packageCode="ai_inventory_assistant" cta={tx('pos.suggest_reorders')} action="reorder" buildPrompt={() => tx('pos.nail_salon_inventory_v0_items_needing_14tm', { v0: m ? tx('pos.lowstock_low_outofstock_out_of_stock', { lowStock: String(m.lowStock), outOfStock: String(m.outOfStock) }) : '', v1: tx('pos.none_currently') })} /></div>
      <div className="inv2-tabs" ref={listTop}>
        <div className="fk-seg inv2-tabseg" role="tablist" aria-label={tx('inv.tabs')}>
          {TABS.map((x) => <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)} data-testid={'tab-' + x}>
            {tx('inv.tab.' + x)}{x === 'reports' && m?.pendingReports ? <span className="inv2-count">{m.pendingReports}</span> : x === 'alerts' && m?.openAlerts ? <span className="inv2-count bad">{m.openAlerts}</span> : null}</button>)}
        </div>
      </div>
      <div className="inv2-body" data-testid={'body-' + tab}>
        {tab === 'products' ? <ProductsTab s={s} q={q} patch={patch} setExtra={setExtra} tick={tick} can={can} onDetail={(id, t) => setDetail({ id, tab: t })} onEdit={setEditing} onAddStock={setStockFor} onRecord={setRecording} onAdd={() => setAdding(true)} nav={nav} /> : null}
        {tab === 'reports' ? <ReportsTab s={s} q={q} patch={patch} setExtra={setExtra} tick={tick} can={can} onDetail={(id, t) => setDetail({ id, tab: t })} onChanged={refresh} onRecord={() => setRecording('')} /> : null}
        {tab === 'purchaseOrders' ? <PurchaseOrdersTab s={s} q={q} patch={patch} tick={tick} can={can} onChanged={refresh} /> : null}
        {tab === 'transfers' ? <TransfersTab s={s} q={q} patch={patch} setExtra={setExtra} tick={tick} can={can} onChanged={refresh} /> : null}
        {tab === 'counts' ? <CountsTab s={s} q={q} patch={patch} tick={tick} can={can} onChanged={refresh} /> : null}
        {tab === 'catalog' ? <CatalogTab s={s} q={q} patch={patch} setExtra={setExtra} tick={tick} can={can} onChanged={refresh} nav={nav} /> : null}
        {tab === 'recipes' ? <RecipesTab s={s} q={q} patch={patch} setExtra={setExtra} tick={tick} can={can} onChanged={refresh} /> : null}
        {tab === 'alerts' ? <AlertsTab s={s} q={q} patch={patch} tick={tick} can={can} onDetail={(id) => setDetail({ id })} onChanged={refresh} nav={nav} /> : null}
      </div>
      {detail ? <ProductDetailsDialog productId={detail.id} initialTab={detail.tab} can={can} onClose={() => setDetail(null)} onChanged={refresh}
        onEdit={(p) => { setDetail(null); setEditing(p.id); }} onAddStock={(p) => { setDetail(null); setStockFor(p); }} onRecordUse={(id) => { setDetail(null); setRecording(id); }}
        onReorder={(p) => nav(`/tenant/inventory/purchase-orders?new=1&productId=${encodeURIComponent(p.id)}&qty=${p.suggestedReorder}${p.vendorId ? '&vendorId=' + encodeURIComponent(p.vendorId) : ''}`)} /> : null}
      {adding ? <ProductFormDialog onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); go('products', { search: '', status: '', period: { preset: 'all' }, extra: { sort: 'newest' } }); refresh(); setNote({ tone: 'ok', text: tx('prd.created'), productId: id }); }} /> : null}
      {editing ? <EditProductDialog productId={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); refresh(); setNote({ tone: 'ok', text: tx('prd.saved'), productId: id }); }} /> : null}
      {stockFor ? <AddStockDialog product={stockFor} onClose={() => setStockFor(null)} onSaved={() => { const p = stockFor; setStockFor(null); refresh(); setNote({ tone: 'ok', text: tx('prd.stockAdded', { n: p.name }), productId: p.id }); }} /> : null}
      {recording !== null ? <RecordUseDialog productId={recording || undefined} canOnBehalf={can('inventory.stock.adjust')} onClose={() => setRecording(null)} onDone={(r) => { setRecording(null); refresh(); setNote({ tone: r?.replay ? 'warn' : 'ok', text: r?.replay ? tx('sa.rec.replayed') : tx('prd.useRecorded'), productId: r?.event?.productId }); }} /> : null}
      {scanning ? <ReceiptScanModal onClose={() => setScanning(false)} onSaved={() => { setScanning(false); setNote({ tone: 'ok', text: tx('inv.receiptSaved') }); }} /> : null}
    </div>
  );
}

const addDays = (ymdStr: string, n: number) => { const [y, mo, d] = ymdStr.split('-').map(Number); const t = new Date(Date.UTC(y, mo - 1, d + n)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; };
type TabProps = { s: TabState; q: string; patch: (p: Partial<TabState>, keepPage?: boolean) => void; tick: number; can: (k: string) => boolean };
const pageInfo = (d: any) => (d ? { page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.pages } : null);

function Toolbar({ s, patch, placeholder, children, period, basis, server }: { s: TabState; patch: TabProps['patch']; placeholder: string; children?: React.ReactNode; period?: boolean; basis?: Array<{ value: string; label: string }>; server?: any }) {
  const filtered = !!(s.search || s.status || s.period.preset !== INITIAL.products.period.preset);
  return <>
    <div className="inv2-tools">
      <div className="fn-search inv2-search"><input className="fk-search wide" type="search" value={s.search} onChange={(e) => patch({ search: e.target.value })} placeholder={placeholder} aria-label={placeholder} data-testid="tab-search" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
        {s.search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => patch({ search: '' })}>✕</button> : null}</div>
      {children}
    </div>
    {period ? <div className="fn-tabsrow inv2-periodrow"><PeriodBar value={s.period} onChange={(p) => patch({ period: p })} server={server} allowAll compact {...(basis ? { basis: s.dateField, basisOptions: basis, onBasis: (b: string) => patch({ dateField: b }) } : {})} />
      {filtered ? <button type="button" className="fk-link" onClick={() => patch({ search: '', status: '', period: { preset: 'all' } })} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}</div> : null}
  </>;
}

// ── All Inventory ───────────────────────────────────────────────────────────────────────────────────────────────────
function ProductsTab({ s, q, patch, setExtra, tick, can, onDetail, onEdit, onAddStock, onRecord, onAdd, nav }: TabProps & { setExtra: (k: string, v: string) => void; onDetail: (id: string, tab?: any) => void; onEdit: (id: string) => void; onAddStock: (p: any) => void; onRecord: (id: string) => void; onAdd: () => void; nav: (to: string) => void }) {
  const lookups = useLoad(async () => { const [b, c, v, pk] = await Promise.all([inventoryApi.brands(), inventoryApi.categories(), inventoryApi.vendors(), posInventoryAlertsApi.pickers().catch(() => ({ technicians: [] }))]); return { brands: b?.brands ?? [], categories: c?.categories ?? [], vendors: v?.vendors ?? [], technicians: pk?.technicians ?? [] }; }, []);
  const scope = { search: q || undefined, status: s.status || undefined, brandId: s.extra.brandId || undefined, categoryId: s.extra.categoryId || undefined, vendorId: s.extra.vendorId || undefined, technicianId: s.extra.technicianId || undefined, sort: s.extra.sort || 'newest', ...periodQuery(s.period), dateField: s.dateField };
  const key = JSON.stringify(scope);
  const d = useLoad(() => posInventoryScreenApi.products({ ...scope, page: s.page, pageSize: SIZES.products }), [key, s.page, tick]);
  const [menu, setMenu] = useState<string | null>(null);
  const L = lookups.data; const rows: any[] = d.data?.rows ?? [];
  const filtered = !!(q || s.status || s.extra.brandId || s.extra.categoryId || s.extra.vendorId || s.extra.technicianId || s.period.preset !== 'all');
  return <>
    <Toolbar s={s} patch={patch} placeholder={tx('inv.searchProducts')} period server={d.data?.period} basis={PRODUCT_DATE_FIELDS.map((f) => ({ value: f, label: tx('prd.df.' + f) }))}>
      <select className="fk-select" value={s.status} onChange={(e) => patch({ status: e.target.value })} aria-label={tx('pos.status')} data-testid="status"><option value="">{tx('prd.allStatuses')}</option>{['needs_reorder', 'out_of_stock', 'critical', 'low', 'in_stock', 'overstock'].map((x) => <option key={x} value={x}>{x === 'needs_reorder' ? tx('pos.need_reorder') : sevLabel(x)}</option>)}</select>
      <select className="fk-select" value={s.extra.brandId ?? ''} onChange={(e) => setExtra('brandId', e.target.value)} aria-label={tx('pos.brand')} data-testid="brand"><option value="">{tx('prd.allBrands')}</option>{(L?.brands ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <select className="fk-select" value={s.extra.categoryId ?? ''} onChange={(e) => setExtra('categoryId', e.target.value)} aria-label={tx('pos.category')} data-testid="category"><option value="">{tx('prd.allCategories')}</option>{(L?.categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select className="fk-select" value={s.extra.vendorId ?? ''} onChange={(e) => setExtra('vendorId', e.target.value)} aria-label={tx('inv.f.supplier')} data-testid="supplier"><option value="">{tx('prd.allSuppliers')}</option>{(L?.vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
      <select className="fk-select" value={s.extra.technicianId ?? ''} onChange={(e) => setExtra('technicianId', e.target.value)} aria-label={tx('sa.col.technician')} data-testid="technician"><option value="">{tx('inv.allTechnicians')}</option>{(L?.technicians ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <select className="fk-select" value={s.extra.sort ?? 'newest'} onChange={(e) => setExtra('sort', e.target.value)} aria-label={tx('prd.sort')} data-testid="sort">{['newest', 'oldest', 'name', 'sku', 'stock', 'critical', 'updated', 'last_used'].map((x) => <option key={x} value={x}>{tx('prd.sort.' + x)}</option>)}</select>
    </Toolbar>
    <FitPanel testId="inv-products" className="inv2-list" title={<span className="fn-chips">{tx('inv.tab.products')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}<span className="fk-hint">{s.period.preset !== 'all' ? tx('prd.dateShown', { f: tx('prd.df.' + s.dateField) }) : tx('inv.hint.products')}</span></span>}
      footer={<Pager info={pageInfo(d.data)} onPage={(p) => patch({ page: p }, true)} label={tx('inv.tab.products')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading_inventory')}</div>
        : rows.length === 0 ? (filtered ? <Empty title={tx('prd.noMatches')}><button type="button" className="fk-btn" onClick={() => patch({ search: '', status: '', period: { preset: 'all' }, extra: { sort: 'newest' } })}>{tx('finance.clearFilters')}</button></Empty>
          : <Empty title={tx('pos.no_products_yet_add_your_first_1ncj')}>{can('inventory.create') ? <button type="button" className="fk-btn primary" onClick={onAdd}>{tx('pos.add_product')}</button> : null}</Empty>)
        : <table className="fk-table fn-table inv2-table" data-testid="products-table">
          <thead><tr><th>{tx('inv.col.product')}</th><th className="num">{tx('inv.col.availableOnHand')}</th><th className="num t-opt">{tx('inv.col.openUnopened')}</th><th className="num t-opt2">{tx('inv.col.reorder')}</th><th>{tx('inv.col.severity')}</th><th>{tx('sa.col.lastUsed')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} data-testid="inv-row">
              <td><button type="button" className="fk-li-t link" onClick={() => onDetail(p.id)} data-testid="inv-name">{p.name}</button><span className="fk-li-s">{[p.colorNumber ? '#' + p.colorNumber : null, p.colorName, p.sku, p.brand].filter(Boolean).join(' · ') || '—'}</span></td>
              <td className="num"><b>{fmtNumber(p.available)}</b> / {fmtNumber(p.onHand)}<span className="fk-li-s">{unitLabel(p.unit)}{p.stockDrift ? ' · ' + tx('prd.recountNeeded') : ''}</span></td>
              <td className="num t-opt">{fmtNumber(p.open)} / {fmtNumber(p.unopened)}{p.expiring ? <span className="fk-li-s warn">{tx('inv.expiringShort', { n: fmtNumber(p.expiring) })}</span> : null}</td>
              <td className="num t-opt2">{fmtNumber(p.reorderLevel)}{p.suggestedReorder ? <span className="fk-li-s">{tx('sa.suggest', { n: fmtNumber(p.suggestedReorder) })}</span> : null}</td>
              <td><StockChip severity={p.severity} testId="severity" /></td>
              <td><LastUsed r={p} testId="last-used" /></td>
              <td className="fn-acts">
                {can('inventory.stock.add') ? <button type="button" className="fk-btn ghost sm" onClick={() => onAddStock(p)} data-testid="add-stock">{tx('pos.add_stock_2')}</button> : null}
                <button type="button" className="fk-btn ghost sm" onClick={() => onDetail(p.id, 'inventory')} data-testid="bottles">{tx('pos.bottles_2')}</button>
                {can('inventory.update') ? <button type="button" className="fk-btn ghost sm" onClick={() => onEdit(p.id)} data-testid="edit">{tx('pos.edit')}</button> : null}
                <span className="inv2-more"><button type="button" className="fk-btn ghost sm" aria-haspopup="menu" aria-expanded={menu === p.id} onClick={() => setMenu(menu === p.id ? null : p.id)} data-testid="more" aria-label={tx('inv.more')}>⋯</button>
                  {menu === p.id ? <div className="inv2-menu" role="menu" onMouseLeave={() => setMenu(null)}>
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); onDetail(p.id); }} data-testid="m-details">{tx('prd.details')}</button>
                    {can('inventory.product_usage.submit') ? <button type="button" role="menuitem" onClick={() => { setMenu(null); onRecord(p.id); }} data-testid="m-record">{tx('sa.recordUse')}</button> : null}
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); onDetail(p.id, 'usage'); }} data-testid="m-usage">{tx('inv.usageHistory')}</button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); onDetail(p.id, 'history'); }} data-testid="m-moves">{tx('inv.movements')}</button>
                    {can('inventory.purchase_order.create') && p.suggestedReorder > 0 ? <button type="button" role="menuitem" onClick={() => nav(`/tenant/inventory/purchase-orders?new=1&productId=${encodeURIComponent(p.id)}&qty=${p.suggestedReorder}${p.vendorId ? '&vendorId=' + encodeURIComponent(p.vendorId) : ''}`)} data-testid="m-reorder">{tx('sa.reorder')}</button> : null}
                  </div> : null}</span>
              </td>
            </tr>))}</tbody>
        </table>}
    </FitPanel>
  </>;
}

// ── Technician Reports: usage by technician (→ their products) · the bottle-report review queue ─────────────────────
function ReportsTab({ s, q, patch, setExtra: _setExtra, tick, can, onDetail, onChanged, onRecord }: TabProps & { setExtra: (k: string, v: string) => void; onDetail: (id: string, tab?: any) => void; onChanged: () => void; onRecord: () => void }) {
  const view = s.extra.view || 'technicians'; const techId = s.extra.technicianId || '';
  const scope = { search: q || undefined, ...periodQuery(s.period), dateBasis: s.dateField === 'recorded' ? 'recorded' : 'occurred', technicianId: techId || undefined };
  const key = view + JSON.stringify(scope) + (view === 'bottle' ? s.status : '');
  const d = useLoad(() => view === 'bottle' ? posInventoryScreenApi.reports({ search: q || undefined, status: s.status || 'pending', ...periodQuery(s.period), page: s.page, pageSize: SIZES.reports })
    : view === 'products' ? posInventoryAlertsApi.usage({ ...scope, page: s.page, pageSize: SIZES.reports }) : posInventoryAlertsApi.technicians({ ...scope, page: s.page, pageSize: SIZES.reports }), [key, s.page, tick]);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [exporting, setExporting] = useState(false);
  const act = async (id: string, fn: () => Promise<unknown>) => { setBusy(id); setErr(null); try { await fn(); d.reload(); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); } };
  const rows: any[] = d.data?.rows ?? [];
  const doExport = async () => {
    setExporting(true);
    try { const csv = await posInventoryAlertsApi.exportCsv({ tab: view === 'products' ? 'usage' : 'technicians', ...scope }); const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `technician-usage-${view}.csv`; a.click(); URL.revokeObjectURL(a.href); }
    catch (e) { setErr(errMsg(e)); } finally { setExporting(false); }
  };
  const techName = view === 'products' && techId ? s.extra.technicianName : null;
  return <>
    <Toolbar s={s} patch={patch} placeholder={view === 'bottle' ? tx('inv.searchReports') : tx('sa.searchPh')} period server={d.data?.period}
      basis={view === 'bottle' ? undefined : [{ value: 'occurred', label: tx('sa.basis.occurred') }, { value: 'recorded', label: tx('sa.basis.recorded') }]}>
      <div className="fk-seg" role="group" aria-label={tx('inv.tab.reports')}>
        {['technicians', 'products', 'bottle'].map((v) => <button key={v} type="button" className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => patch({ extra: { ...s.extra, view: v, ...(v === 'technicians' ? { technicianId: '', technicianName: '' } : {}) } })} data-testid={'rv-' + v}>{tx('inv.rview.' + v)}</button>)}
      </div>
      {view === 'bottle' ? <select className="fk-select" value={s.status || 'pending'} onChange={(e) => patch({ status: e.target.value })} aria-label={tx('pos.status')} data-testid="report-status">{['pending', 'approved', 'rejected', 'all'].map((x) => <option key={x} value={x}>{tx('inv.rstatus.' + x)}</option>)}</select> : null}
      {techName ? <span className="fk-chip info">{techName}<button type="button" className="fk-x" aria-label={tx('finance.clearFilters')} onClick={() => patch({ extra: { ...s.extra, technicianId: '', technicianName: '' } })}>✕</button></span> : null}
      {view !== 'bottle' && can('inventory.product_usage.submit') ? <button type="button" className="fk-btn" onClick={onRecord} data-testid="record-use">{tx('sa.recordUse')}</button> : null}
      {view !== 'bottle' && can('inventory.reports.view') ? <button type="button" className="fk-btn ghost" onClick={doExport} disabled={exporting} data-testid="export-usage">{exporting ? tx('pos.loading') : tx('finance.exportReport')}</button> : null}
    </Toolbar>
    {err ? <div className="fk-error" role="alert">{err}</div> : null}
    <FitPanel testId="inv-reports" className="inv2-list" title={<span className="fn-chips">{tx('inv.rview.' + view)}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}<span className="fk-hint">{tx('inv.hint.r.' + view)}</span></span>}
      footer={<Pager info={pageInfo(d.data)} onPage={(p) => patch({ page: p }, true)} label={tx('inv.tab.reports')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div>
        : rows.length === 0 ? <Empty title={view === 'bottle' ? tx('pos.no_pending_technician_reports') : tx('sa.empty.' + (view === 'products' ? 'usage' : 'technicians'))} />
        : view === 'technicians' ? <table className="fk-table fn-table" data-testid="tech-table"><thead><tr><th>{tx('sa.col.technician')}</th><th className="num">{tx('sa.col.uses')}</th><th className="num">{tx('sa.col.products')}</th><th className="num">{tx('sa.col.used')}</th><th>{tx('sa.col.lastProduct')}</th><th>{tx('sa.col.lastAt')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.technicianId ?? 'unknown'} data-testid="tech-row"><td><b className={r.technicianId ? '' : 'fk-muted'}>{r.technicianId ? r.name : tx('sa.unknownTech')}</b></td><td className="num">{fmtNumber(r.uses)}</td><td className="num">{fmtNumber(r.products)}</td><td className="num"><b>{r.used}</b></td><td>{r.lastProduct ?? '—'}</td><td>{when(r.lastUsedAt)}</td>
            <td className="fn-acts">{r.technicianId ? <button type="button" className="fk-btn ghost sm" onClick={() => patch({ extra: { ...s.extra, view: 'products', technicianId: r.technicianId, technicianName: r.name } })} data-testid="tech-products">{tx('inv.productsUsed')}</button> : null}</td></tr>)}</tbody></table>
        : view === 'products' ? <table className="fk-table fn-table" data-testid="usage-table"><thead><tr><th>{tx('pos.product')}</th><th className="num">{tx('sa.col.used')}</th><th className="num">{tx('sa.col.uses')}</th><th className="num">{tx('sa.col.technicians')}</th><th>{tx('sa.col.lastUsed')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.productId} data-testid="usage-row"><td><button type="button" className="fk-li-t link" onClick={() => onDetail(r.productId, 'usage')}>{r.name}</button><span className="fk-li-s">{r.sku ?? '—'}</span></td><td className="num"><b>{r.used}</b><span className="fk-li-s">{unitLabel(r.unit)}</span></td><td className="num">{fmtNumber(r.uses)}</td><td className="num">{fmtNumber(r.technicians)}</td><td><LastUsed r={r} /></td>
            <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => onDetail(r.productId, 'usage')} data-testid="all-techs">{tx('inv.allTechsForProduct')}</button></td></tr>)}</tbody></table>
        : <table className="fk-table fn-table" data-testid="bottle-reports"><thead><tr><th>{tx('pos.product')}</th><th>{tx('pos.issue')}</th><th>{tx('sa.col.technician')}</th><th>{tx('inv.col.when')}</th><th>{tx('pos.note')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} data-testid="report-row"><td><button type="button" className="fk-li-t link" onClick={() => onDetail(r.productId)}>{r.product}</button>{r.colorNumber ? <span className="fk-li-s">#{r.colorNumber}</span> : null}</td>
            <td><span className="fk-chip warn">{statusLabel('inventoryReport', r.type)}</span></td><td>{r.technician ?? '—'}</td><td>{when(r.createdAt)}</td><td className="it-note">{r.note ?? '—'}</td>
            <td className="fn-acts">{r.status === 'pending' && can('inventory.technician_report.approve') ? <>
              <button type="button" className="fk-btn primary sm" disabled={busy === r.id} onClick={() => act(r.id, () => inventoryApi.approveReport(r.id))} data-testid="approve">{tx('pos.approve')}</button>
              <button type="button" className="fk-btn ghost sm" disabled={busy === r.id} onClick={() => act(r.id, () => inventoryApi.rejectReport(r.id))} data-testid="reject">{tx('pos.reject')}</button></> : <span className="fk-chip mut">{tx('inv.rstatus.' + r.status)}</span>}</td></tr>)}</tbody></table>}
    </FitPanel>
  </>;
}

// ── Purchase Orders ─────────────────────────────────────────────────────────────────────────────────────────────────
function PurchaseOrdersTab({ s, q, patch, tick, can, onChanged }: TabProps & { onChanged: () => void }) {
  const scope = { search: q || undefined, status: s.status || undefined, ...periodQuery(s.period), dateField: s.dateField };
  const key = JSON.stringify(scope);
  const d = useLoad(() => posInventoryScreenApi.purchaseOrders({ ...scope, page: s.page, pageSize: SIZES.purchaseOrders }), [key, s.page, tick]);
  const [creating, setCreating] = useState(false); const [receiveFor, setReceiveFor] = useState<string | null>(null); const [view, setView] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const pick = usePickProducts(creating);
  const { confirm, confirmUi } = useInlineConfirm();
  const act = async (id: string, fn: () => Promise<unknown>) => { setBusy(id); setErr(null); try { await fn(); d.reload(); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); } };
  const rows: any[] = d.data?.rows ?? [];
  return <>
    {confirmUi}
    <Toolbar s={s} patch={patch} placeholder={tx('inv.searchPos')} period server={d.data?.period} basis={['created', 'expected', 'approved', 'received'].map((f) => ({ value: f, label: tx('inv.podf.' + f) }))}>
      <select className="fk-select" value={s.status} onChange={(e) => patch({ status: e.target.value })} aria-label={tx('pos.status')} data-testid="po-status"><option value="">{tx('prd.allStatuses')}</option>{PO_STATUSES.map((x) => <option key={x} value={x}>{tx('inv.pos.' + x)}</option>)}</select>
      {can('inventory.purchase_order.create') ? <button type="button" className="fk-btn primary" onClick={() => setCreating(true)} data-testid="new-po">{tx('pos.new_purchase_order_2')}</button> : null}
    </Toolbar>
    {err ? <div className="fk-error" role="alert" data-testid="po-error">{err}</div> : null}
    <FitPanel testId="inv-pos" className="inv2-list" title={<span className="fn-chips">{tx('inv.tab.purchaseOrders')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}<span className="fk-hint">{tx('inv.hint.purchaseOrders')}</span></span>}
      footer={<Pager info={pageInfo(d.data)} onPage={(p) => patch({ page: p }, true)} label={tx('inv.tab.purchaseOrders')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading_purchase_orders')}</div>
        : rows.length === 0 ? <Empty title={tx('pos.no_purchase_orders_yet_create_one_y12v')}>{can('inventory.purchase_order.create') ? <button type="button" className="fk-btn" onClick={() => setCreating(true)}>{tx('pos.new_purchase_order_2')}</button> : null}</Empty>
        : <PoTable rows={rows} busy={busy} can={can} onView={setView} onReceive={setReceiveFor}
            onApprove={(id) => act(id, () => inventoryApi.approvePurchaseOrder(id))} onCancel={(id) => confirm(tx('inv.confirmCancelPo'), () => { void act(id, () => inventoryApi.cancelPurchaseOrder(id)); }, { confirmLabel: tx('inv.cancelPo') })} />}
    </FitPanel>
    {creating ? (pick ? <CreatePOModal products={pick} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); patch({ page: 1, status: '', search: '', period: { preset: 'all' } }); d.reload(); onChanged(); }} /> : <FitDialog title={tx('pos.new_purchase_order_3')} onClose={() => setCreating(false)}><div className="fk-loading">{tx('pos.loading')}</div></FitDialog>) : null}
    {receiveFor ? <ReceivePOModal poId={receiveFor} onClose={() => setReceiveFor(null)} onSaved={() => { setReceiveFor(null); d.reload(); onChanged(); }} /> : null}
    {view ? <PoDialog poId={view} onClose={() => setView(null)} /> : null}
  </>;
}

/** The shared purchase-order table (Inventory → Purchase Orders and Suppliers): readable expected date, progress, remaining. */
export function PoTable({ rows, busy, can, onView, onReceive, onApprove, onCancel, compact }: { rows: any[]; busy?: string | null; can: (k: string) => boolean; onView: (id: string) => void; onReceive?: (id: string) => void; onApprove?: (id: string) => void; onCancel?: (id: string) => void; compact?: boolean }) {
  return <table className="fk-table fn-table inv2-table" data-testid="po-table">
    <thead><tr><th>{tx('inv.col.po')}</th>{compact ? null : <th>{tx('inv.col.supplier')}</th>}<th>{tx('inv.col.expected')}</th><th className="num">{tx('inv.col.ordered')}</th><th className="num">{tx('inv.col.receivedProgress')}</th><th className="num t-opt">{tx('inv.col.remaining')}</th><th>{tx('inv.col.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
    <tbody>{rows.map((po) => <tr key={po.id} data-testid="po-row">
      <td><button type="button" className="fk-li-t link" onClick={() => onView(po.id)} data-testid="po-number">{po.poNumber ?? '—'}</button><span className="fk-li-s">{day(po.createdAt)}{po.branch && !compact ? ' · ' + po.branch : ''}</span></td>
      {compact ? null : <td>{po.vendor ? <>{po.vendor}{po.vendorArchived ? <span className="fk-chip mut">{tx('inv.inactiveSupplier')}</span> : null}</> : <span className="fk-muted">{tx('inv.noSupplier')}</span>}</td>}
      <td data-testid="po-expected">{po.expectedDate ? ymd(po.expectedDate) : <span className="fk-muted">{tx('inv.notSet')}</span>}{po.overdue ? <span className="fk-chip bad">{tx('inv.overdue')}</span> : null}</td>
      <td className="num">{money(po.totalCents)}<span className="fk-li-s">{tx('inv.lines', { n: fmtNumber(po.lines) })}</span></td>
      <td className="num">{fmtNumber(po.received)} / {fmtNumber(po.ordered)}</td>
      <td className="num t-opt">{fmtNumber(po.remaining)}<span className="fk-li-s">{money(po.remainingCents)}</span></td>
      <td><span className={'fk-chip ' + (PO_TONE[po.status] ?? 'mut')} data-testid="po-status-chip">{tx('inv.pos.' + po.status)}</span></td>
      <td className="fn-acts">
        {po.status === 'draft' && onApprove && can('inventory.purchase_order.approve') ? <button type="button" className="fk-btn primary sm" disabled={busy === po.id} onClick={() => onApprove(po.id)} data-testid="po-approve">{tx('pos.approve')}</button> : null}
        {['approved', 'ordered', 'partial'].includes(po.status) && onReceive && can('inventory.purchase_order.receive') ? <button type="button" className="fk-btn primary sm" disabled={busy === po.id} onClick={() => onReceive(po.id)} data-testid="po-receive">{tx('pos.receive')}</button> : null}
        {['draft', 'approved', 'ordered', 'partial'].includes(po.status) && onCancel && can('inventory.purchase_order.create') ? <button type="button" className="fk-btn ghost sm" disabled={busy === po.id} onClick={() => onCancel(po.id)} data-testid="po-cancel">{tx('inv.cancelPo')}</button> : null}
      </td></tr>)}</tbody>
  </table>;
}

/** One purchase order: supplier contact, lines (ordered / received / remaining, purchase unit), totals, receiving history. */
export function PoDialog({ poId, onClose, footer }: { poId: string; onClose: () => void; footer?: React.ReactNode }) {
  const d = useLoad(() => posInventoryScreenApi.purchaseOrder(poId), [poId]);
  const po = d.data?.purchaseOrder;
  return <FitDialog wide title={po ? tx('inv.poTitle', { n: po.poNumber ?? '—' }) : tx('inv.tab.purchaseOrders')} onClose={onClose} testId="po-dialog"
    subtitle={po ? <span>{po.vendor ?? tx('inv.noSupplier')}{po.vendorArchived ? ' · ' + tx('inv.inactiveSupplier') : ''} · <span className={'fk-chip ' + (PO_TONE[po.status] ?? 'mut')}>{tx('inv.pos.' + po.status)}</span></span> : undefined}
    footer={<>{footer}<button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></>}>
    {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
      <dl className="inv-dl">
        <div><dt>{tx('inv.podf.created')}</dt><dd>{when(po.createdAt)}</dd></div><div><dt>{tx('inv.podf.expected')}</dt><dd data-testid="po-dialog-expected">{po.expectedDate ? ymd(po.expectedDate) : tx('inv.notSet')}</dd></div>
        <div><dt>{tx('inv.podf.approved')}</dt><dd>{po.approvedAt ? when(po.approvedAt) : '—'}</dd></div><div><dt>{tx('inv.podf.received')}</dt><dd>{po.receivedAt ? when(po.receivedAt) : '—'}</dd></div>
        <div><dt>{tx('inv.contact')}</dt><dd>{d.data.contact ? [d.data.contact.name, d.data.contact.phone, d.data.contact.email].filter(Boolean).join(' · ') : po.vendorPhone ?? '—'}</dd></div>
        <div><dt>{tx('inv.totals')}</dt><dd>{tx('inv.totalsText', { s: money(po.subtotalCents), sh: money(po.shippingCents), t: money(po.taxCents), g: money(po.totalCents) })}</dd></div>
      </dl>
      <table className="fk-table" data-testid="po-lines"><thead><tr><th>{tx('pos.product')}</th><th className="num">{tx('inv.col.ordered')}</th><th className="num">{tx('inv.col.received')}</th><th className="num">{tx('inv.col.remaining')}</th><th className="num">{tx('inv.unitCost')}</th><th className="t-opt">{tx('inv.col.pack')}</th></tr></thead>
        <tbody>{d.data.lines.map((l: any) => <tr key={l.id} data-testid="po-line"><td><b>{l.product}</b><span className="fk-li-s">{[l.sku, l.supplierSku ? tx('inv.supplierSkuN', { s: l.supplierSku }) : null, l.lot ? tx('inv.lotN', { l: l.lot }) : null].filter(Boolean).join(' · ') || '—'}</span></td>
          <td className="num">{fmtNumber(l.ordered)}</td><td className="num">{fmtNumber(l.received)}</td><td className="num"><b>{fmtNumber(l.remaining)}</b></td><td className="num">{money(l.unitCostCents)}</td><td className="t-opt">{l.purchaseUnit ? tx('inv.packText', { u: l.purchaseUnit, n: fmtNumber(l.unitsPerPurchaseUnit ?? 1) }) : unitLabel(l.unit)}</td></tr>)}</tbody></table>
      <h3 className="fk-h3">{tx('inv.receivingHistory')}</h3>
      {d.data.receipts.length === 0 ? <div className="fk-hint">{tx('inv.noReceipts')}</div> :
        <table className="fk-table" data-testid="po-receipts"><thead><tr><th>{tx('inv.col.when')}</th><th>{tx('pos.product')}</th><th className="num">{tx('inv.col.qty')}</th><th>{tx('inv.col.by')}</th></tr></thead>
          <tbody>{d.data.receipts.map((r: any) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.product}</td><td className="num">+{fmtNumber(r.quantity)}</td><td>{r.actor ?? '—'}</td></tr>)}</tbody></table>}
      {po.notes ? <div className="fk-hint">{po.notes}</div> : null}
      <div className="fk-hint">{tx('inv.poNote')}</div>
    </>}
  </FitDialog>;
}

// ── Transfers ───────────────────────────────────────────────────────────────────────────────────────────────────────
function TransfersTab({ s, q, patch, setExtra, tick, can, onChanged }: TabProps & { setExtra: (k: string, v: string) => void; onChanged: () => void }) {
  const scope = { search: q || undefined, direction: s.extra.direction || undefined, ...periodQuery(s.period) };
  const d = useLoad(() => posInventoryScreenApi.transfers({ ...scope, page: s.page, pageSize: SIZES.transfers }), [JSON.stringify(scope), s.page, tick]);
  const [creating, setCreating] = useState(false); const pick = usePickProducts(creating);
  const rows: any[] = d.data?.rows ?? [];
  return <>
    <Toolbar s={s} patch={patch} placeholder={tx('inv.searchTransfers')} period server={d.data?.period}>
      <div className="fk-seg" role="group" aria-label={tx('inv.direction')}>{['', 'outbound', 'inbound'].map((x) => <button key={x || 'all'} type="button" className={(s.extra.direction ?? '') === x ? 'on' : ''} aria-pressed={(s.extra.direction ?? '') === x} onClick={() => setExtra('direction', x)} data-testid={'dir-' + (x || 'all')}>{tx('inv.dir.' + (x || 'all'))}</button>)}</div>
      {can('inventory.transfer') ? <button type="button" className="fk-btn primary" onClick={() => setCreating(true)} data-testid="new-transfer">{tx('pos.new_transfer')}</button> : null}
    </Toolbar>
    <FitPanel testId="inv-transfers" className="inv2-list" title={<span className="fn-chips">{tx('inv.tab.transfers')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}<span className="fk-hint">{tx('inv.hint.transfers')}</span></span>}
      footer={<Pager info={pageInfo(d.data)} onPage={(p) => patch({ page: p }, true)} label={tx('inv.tab.transfers')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading_transfers')}</div>
        : rows.length === 0 ? <Empty title={tx('pos.no_transfers_yet_move_stock_to_rh20')} />
        : <table className="fk-table fn-table" data-testid="transfers-table"><thead><tr><th>{tx('pos.transfer')}</th><th>{tx('pos.route')}</th><th className="num">{tx('pos.moved')}</th><th>{tx('pos.status')}</th><th>{tx('pos.date')}</th><th className="t-opt">{tx('inv.col.by')}</th></tr></thead>
          <tbody>{rows.map((t) => <tr key={t.id} data-testid="transfer-row"><td><b>{t.number ?? '—'}</b><span className="fk-li-s">{t.outbound ? tx('pos.outbound') : tx('pos.inbound')}</span></td><td>{t.from ?? '—'} → {t.to ?? '—'}</td>
            <td className="num">{t.units} {tx('pos.unit_2')}{enPlural(t.units === 1 ? '' : 's')}<span className="fk-li-s">{t.items} {tx('pos.item')}{enPlural(t.items === 1 ? '' : 's')}</span></td>
            <td><span className={'fk-chip ' + (t.status === 'completed' ? 'ok' : t.status === 'cancelled' ? 'bad' : 'warn')}>{codeLabel('admin.inventory.transfer', t.status, ['appointment', 'refund'])}</span></td><td>{when(t.createdAt)}</td><td className="t-opt">{t.createdBy ?? '—'}</td></tr>)}</tbody></table>}
    </FitPanel>
    {creating ? (pick ? <CreateTransferModal products={pick} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); patch({ page: 1 }); d.reload(); onChanged(); }} /> : <FitDialog title={tx('pos.new_branch_transfer')} onClose={() => setCreating(false)}><div className="fk-loading">{tx('pos.loading')}</div></FitDialog>) : null}
  </>;
}

// ── Counts ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function CountsTab({ s, q, patch, tick, can, onChanged }: TabProps & { onChanged: () => void }) {
  const scope = { search: q || undefined, status: s.status || undefined, ...periodQuery(s.period), dateField: s.dateField === 'reconciled' ? 'reconciled' : 'created' };
  const d = useLoad(() => posInventoryScreenApi.counts({ ...scope, page: s.page, pageSize: SIZES.counts }), [JSON.stringify(scope), s.page, tick]);
  const [creating, setCreating] = useState(false); const [openId, setOpenId] = useState<string | null>(null);
  const rows: any[] = d.data?.rows ?? [];
  return <>
    <Toolbar s={s} patch={patch} placeholder={tx('inv.searchCounts')} period server={d.data?.period} basis={[{ value: 'created', label: tx('inv.cdf.created') }, { value: 'reconciled', label: tx('inv.cdf.reconciled') }]}>
      <select className="fk-select" value={s.status} onChange={(e) => patch({ status: e.target.value })} aria-label={tx('pos.status')} data-testid="count-status"><option value="">{tx('prd.allStatuses')}</option>{['in_progress', 'submitted', 'reconciled', 'cancelled'].map((x) => <option key={x} value={x}>{codeLabel('admin.inventory.count', x, 'drawer')}</option>)}</select>
      {can('inventory.stock.count') ? <button type="button" className="fk-btn primary" onClick={() => setCreating(true)} data-testid="new-count">{tx('pos.new_count')}</button> : null}
    </Toolbar>
    <FitPanel testId="inv-counts" className="inv2-list" title={<span className="fn-chips">{tx('inv.tab.counts')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}<span className="fk-hint">{tx('inv.hint.counts')}</span></span>}
      footer={<Pager info={pageInfo(d.data)} onPage={(p) => patch({ page: p }, true)} label={tx('inv.tab.counts')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading_counts')}</div>
        : rows.length === 0 ? <Empty title={tx('pos.no_counts_yet_start_a_physical_xyef')} />
        : <table className="fk-table fn-table" data-testid="counts-table"><thead><tr><th>{tx('pos.count')}</th><th>{tx('pos.scope')}</th><th className="num">{tx('pos.counted')}</th><th>{tx('pos.status')}</th><th className="num">{tx('pos.variance')}</th><th className="t-opt">{tx('inv.col.by')}</th></tr></thead>
          <tbody>{rows.map((c) => <tr key={c.id} data-testid="count-row" className="inv2-click" onClick={() => setOpenId(c.id)}><td><b>{c.number ?? '—'}</b><span className="fk-li-s">{day(c.createdAt)}</span></td><td>{c.scope ?? tx('pos.all_products')}</td><td className="num">{fmtNumber(c.counted)} / {fmtNumber(c.lines)}</td>
            <td><span className={'fk-chip ' + (c.status === 'reconciled' ? 'ok' : c.status === 'in_progress' ? 'warn' : 'mut')}>{codeLabel('admin.inventory.count', c.status, 'drawer')}</span></td>
            <td className="num">{c.status === 'reconciled' ? (c.variance > 0 ? '+' : '') + fmtNumber(c.variance) : '—'}</td><td className="t-opt">{c.reconciledBy ?? c.startedBy ?? '—'}</td></tr>)}</tbody></table>}
    </FitPanel>
    {creating ? <CreateCountModal onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); d.reload(); onChanged(); setOpenId(id); }} /> : null}
    {openId ? <CountEntryModal id={openId} onClose={() => setOpenId(null)} onChanged={() => { d.reload(); onChanged(); }} /> : null}
  </>;
}

// ── Catalog: brands / categories (suppliers live on the Suppliers page — one directory) ─────────────────────────────
function CatalogTab({ s, q, patch, setExtra, tick, can, onChanged, nav }: TabProps & { setExtra: (k: string, v: string) => void; onChanged: () => void; nav: (to: string) => void }) {
  const kind = (s.extra.kind || 'brand') as 'brand' | 'category';
  const d = useLoad(() => posInventoryScreenApi.catalog({ kind, search: q || undefined, page: s.page, pageSize: SIZES.catalog }), [kind, q, s.page, tick]);
  const [editing, setEditing] = useState<{ item: any | null } | null>(null); const [err, setErr] = useState<string | null>(null);
  const { confirm, confirmUi } = useInlineConfirm();
  const manage = can(kind === 'brand' ? 'inventory.brand.manage' : 'inventory.category.manage');
  const full = async (id: string) => { const r = kind === 'brand' ? await inventoryApi.brands() : await inventoryApi.categories(); const list = (r as { brands?: Array<{ id: string }>; categories?: Array<{ id: string }> } | null); return (list?.brands ?? list?.categories ?? []).find((x) => x.id === id) ?? { id }; };
  const archive = (x: any) => confirm(tx('admin.inventory.confirmArchiveTag', { name: x.name }), () => { void (async () => {
    try { const r: any = await (kind === 'brand' ? inventoryApi.archiveBrand(x.id) : inventoryApi.archiveCategory(x.id)); d.reload(); onChanged(); if (r?.productsAffected) setErr(tx('admin.inventory.archivedTag', { name: x.name, count: String(r.productsAffected) })); }
    catch (e) { setErr(errMsg(e)); } })(); }, { confirmLabel: tx('pos.archive') });
  const rows: any[] = d.data?.rows ?? [];
  return <>
    {confirmUi}
    <Toolbar s={s} patch={patch} placeholder={tx('inv.searchCatalog')}>
      <div className="fk-seg" role="group" aria-label={tx('inv.tab.catalog')}>{(['brand', 'category'] as const).map((k) => <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setExtra('kind', k)} data-testid={'kind-' + k}>{tx('inv.kind.' + k)}</button>)}</div>
      {manage ? <button type="button" className="fk-btn primary" onClick={() => setEditing({ item: null })} data-testid="catalog-add">{tx('inv.addKind.' + kind)}</button> : null}
      <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/inventory/vendors')} data-testid="to-suppliers">{tx('inv.manageSuppliers')}</button>
    </Toolbar>
    {err ? <div className="fk-note warn" role="status"><span>{err}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setErr(null)}>✕</button></div> : null}
    <FitPanel testId="inv-catalog" className="inv2-list" title={<span className="fn-chips">{tx('inv.kind.' + kind)}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}<span className="fk-hint">{tx('inv.hint.catalog')}</span></span>}
      footer={<Pager info={pageInfo(d.data)} onPage={(p) => patch({ page: p }, true)} label={tx('inv.tab.catalog')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div>
        : rows.length === 0 ? <Empty title={tx('pos.none_yet')} />
        : <table className="fk-table fn-table" data-testid="catalog-table"><thead><tr><th>{tx('pos.name_2')}</th><th>{tx('pos.code')}</th><th className="num">{tx('pos.products')}</th><th>{tx('inv.f.created')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((x) => <tr key={x.id} data-testid="catalog-row"><td><b>{x.name}</b></td><td>{x.code ?? '—'}</td><td className="num">{fmtNumber(x.products)}</td><td>{day(x.createdAt)}</td>
            <td className="fn-acts">{manage ? <><button type="button" className="fk-btn ghost sm" onClick={async () => setEditing({ item: await full(x.id) })}>{tx('pos.edit')}</button><button type="button" className="fk-btn ghost sm" onClick={() => archive(x)}>{tx('pos.archive')}</button></> : null}</td></tr>)}</tbody></table>}
    </FitPanel>
    {editing ? <CatalogEditModal kind={kind} item={editing.item} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); patch({ page: 1 }); d.reload(); onChanged(); }} /> : null}
  </>;
}

// ── Recipes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function RecipesTab({ s, q, patch, setExtra, tick, can, onChanged }: TabProps & { setExtra: (k: string, v: string) => void; onChanged: () => void }) {
  const d = useLoad(() => posInventoryScreenApi.recipes({ search: q || undefined, withRecipe: s.extra.withRecipe || undefined, page: s.page, pageSize: SIZES.recipes }), [q, s.extra.withRecipe, s.page, tick]);
  const [openId, setOpenId] = useState<string | null>(null); const pick = usePickProducts(!!openId);
  const rows: any[] = d.data?.rows ?? [];
  return <>
    <Toolbar s={s} patch={patch} placeholder={tx('inv.searchRecipes')}>
      <div className="fk-seg" role="group" aria-label={tx('pos.recipes')}>{['', 'true', 'false'].map((x) => <button key={x || 'all'} type="button" className={(s.extra.withRecipe ?? '') === x ? 'on' : ''} aria-pressed={(s.extra.withRecipe ?? '') === x} onClick={() => setExtra('withRecipe', x)} data-testid={'rec-' + (x || 'all')}>{tx('inv.rec.' + (x || 'all'))}</button>)}</div>
    </Toolbar>
    <FitPanel testId="inv-recipes" className="inv2-list" title={<span className="fn-chips">{tx('inv.tab.recipes')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}<span className="fk-hint">{tx('inv.hint.recipes')}</span></span>}
      footer={<Pager info={pageInfo(d.data)} onPage={(p) => patch({ page: p }, true)} label={tx('inv.tab.recipes')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading_services')}</div>
        : rows.length === 0 ? <Empty title={tx('pos.no_active_services_yet_add_services_lz59')} />
        : <table className="fk-table fn-table" data-testid="recipes-table"><thead><tr><th>{tx('pos.service_3')}</th><th>{tx('pos.recipe')}</th><th className="num">{tx('pos.price')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} data-testid="recipe-row"><td><b>{r.name}</b></td><td>{r.lines === 0 ? <span className="fk-muted">{tx('pos.no_recipe')}</span> : <>{tx('inv.recipeLines', { n: fmtNumber(r.lines), u: fmtNumber(r.units, 2) })}<span className="fk-li-s">{r.products}</span></>}</td><td className="num">{money(r.priceCents)}</td>
            <td className="fn-acts">{can('inventory.update') ? <button type="button" className="fk-btn ghost sm" onClick={() => setOpenId(r.id)} data-testid="edit-recipe">{r.lines ? tx('pos.edit_recipe') : tx('pos.add_recipe')}</button> : null}</td></tr>)}</tbody></table>}
    </FitPanel>
    <div className="fk-hint">{tx('inv.recipeNote')}</div>
    {openId ? (pick ? <RecipeEditorModal serviceId={openId} products={pick} onClose={() => setOpenId(null)} onSaved={() => { setOpenId(null); d.reload(); onChanged(); }} /> : <FitDialog title={tx('pos.recipe_2')} onClose={() => setOpenId(null)}><div className="fk-loading">{tx('pos.loading')}</div></FitDialog>) : null}
  </>;
}

// ── Alerts: the Stock Alerts list itself (the sidebar badge's scope) ──────────────────────────────────────────────────
function AlertsTab({ s, q, patch, tick, can, onDetail, onChanged, nav }: TabProps & { onDetail: (id: string) => void; onChanged: () => void; nav: (to: string) => void }) {
  const d = useLoad(() => posInventoryAlertsApi.active({ search: q || undefined, severity: s.status || undefined, page: s.page, pageSize: SIZES.alerts }), [q, s.status, s.page, tick]);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const ack = async (id: string) => { setBusy(id); setErr(null); try { await posInventoryAlertsApi.acknowledge(id); d.reload(); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); } };
  const rows: any[] = d.data?.rows ?? [];
  return <>
    <Toolbar s={s} patch={patch} placeholder={tx('sa.searchPh')}>
      <select className="fk-select" value={s.status} onChange={(e) => patch({ status: e.target.value })} aria-label={tx('sa.severity')} data-testid="alert-severity"><option value="">{tx('sa.allSeverities')}</option>{['out_of_stock', 'critical', 'low'].map((x) => <option key={x} value={x}>{sevLabel(x)}</option>)}</select>
      <button type="button" className="fk-btn" onClick={() => nav('/tenant/inventory/alerts')} data-testid="to-stock-alerts">{tx('inv.openStockAlerts')}</button>
    </Toolbar>
    {err ? <div className="fk-error" role="alert">{err}</div> : null}
    <FitPanel testId="inv-alerts" className="inv2-list" title={<span className="fn-chips">{tx('inv.tab.alerts')}{d.data ? <span className="fk-muted"> · {fmtNumber(d.data.total)}</span> : null}<span className="fk-hint">{tx('inv.hint.alerts')}</span></span>}
      footer={<Pager info={pageInfo(d.data)} onPage={(p) => patch({ page: p }, true)} label={tx('inv.tab.alerts')} />}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading_alerts')}</div>
        : rows.length === 0 ? <Empty title={tx('pos.no_active_stock_alerts_you_ll_svxg')} />
        : <table className="fk-table fn-table" data-testid="alerts-table"><thead><tr><th>{tx('pos.product')}</th><th>{tx('inv.col.severity')}</th><th className="num">{tx('inv.col.onHand')}</th><th className="num">{tx('inv.col.reorder')}</th><th>{tx('inv.col.supplier')}</th><th>{tx('sa.col.lastUsed')}</th><th className="t-opt">{tx('sa.col.since')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.productId} data-testid="alert-row" className={r.acknowledgedAt ? 'sa-acked' : ''}>
            <td><button type="button" className="fk-li-t link" onClick={() => onDetail(r.productId)}>{r.name}</button><span className="fk-li-s">{r.sku ?? '—'}</span></td>
            <td><StockChip severity={r.severity} />{r.acknowledgedAt ? <span className="fk-li-s">{tx('sa.ackBy', { who: r.acknowledgedBy ?? '—' })}</span> : null}</td>
            <td className="num"><b>{fmtNumber(r.onHand)}</b></td><td className="num">{fmtNumber(r.reorderLevel)} / {fmtNumber(r.criticalLevel)}<span className="fk-li-s">{r.onOrder ? tx('sa.onOrder', { n: fmtNumber(r.onOrder) }) : ''}</span></td>
            <td>{r.vendor ?? '—'}</td><td><LastUsed r={r} /></td><td className="t-opt">{r.since ? when(r.since) : <span className="fk-muted">{tx('sa.sinceUnknown')}</span>}</td>
            <td className="fn-acts">
              {!r.acknowledgedAt ? <button type="button" className="fk-btn ghost sm" disabled={busy === r.productId} onClick={() => ack(r.productId)} data-testid="ack">{tx('pos.acknowledge')}</button> : null}
              {can('inventory.purchase_order.create') && r.suggestedReorder > 0 ? <button type="button" className="fk-btn ghost sm" onClick={() => nav(`/tenant/inventory/purchase-orders?new=1&productId=${encodeURIComponent(r.productId)}&qty=${r.suggestedReorder}${r.vendorId ? '&vendorId=' + encodeURIComponent(r.vendorId) : ''}`)} data-testid="reorder">{tx('sa.reorder')}</button> : null}
            </td></tr>)}</tbody></table>}
    </FitPanel>
  </>;
}

// ===== the existing create / receive / count / catalog / recipe / receipt modals, unchanged in behaviour =====

type DraftLine = { productId: string; quantity: string; costDollars: string };
function CreatePOModal({ products, onClose, onSaved }: { products: InvProduct[]; onClose: () => void; onSaved: () => void }) {
  const [vendors, setVendors] = useState<InvVendor[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [shipping, setShipping] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ productId: '', quantity: '12', costDollars: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { inventoryApi.vendors().then((r) => setVendors(r?.vendors ?? [])).catch(() => setVendors([])); }, []);
  const setLine = (i: number, k: keyof DraftLine, v: string) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((p) => [...p, { productId: '', quantity: '12', costDollars: '' }]);
  const removeLine = (i: number) => setLines((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p));
  const subtotal = lines.reduce((s, l) => s + (parseInt(l.quantity, 10) || 0) * (parseDollarsToCents(l.costDollars) ?? 0), 0);
  const total = subtotal + (parseDollarsToCents(shipping) ?? 0);
  const poKeys = useRef(createIntentKeys());
  const save = async () => {
    const clean = lines.filter((l) => l.productId && (parseInt(l.quantity, 10) || 0) > 0);
    if (clean.length === 0) { setError(tx('pos.add_at_least_one_product_line_rsup')); return; }
    setSaving(true); setError(null);
    try {
      const body = {
        vendorId: vendorId || null, expectedDate: expectedDate || null, shippingCents: (parseDollarsToCents(shipping) ?? 0),
        lines: clean.map((l) => ({ productId: l.productId, quantityOrdered: parseInt(l.quantity, 10) || 0, unitCostCents: (parseDollarsToCents(l.costDollars) ?? 0) })),
      };
      // one key per draft until it is created: a double tap or a retry creates ONE purchase order (D10)
      await inventoryApi.createPurchaseOrder(body, poKeys.current.keyFor('create', body));
      poKeys.current.done('create');
      onSaved();
    } catch (e: any) { setError(e?.message || tx('pos.could_not_create_purchase_order')); } finally { setSaving(false); }
  };
  return (
    <div className="inv-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal wide">
        <div className="im-h">{tx('pos.new_purchase_order_3')}</div>
        <div className="im-b">
          {error && <div className="inv-err">{error}</div>}
          <div className="if-row">
            <label className="if"><span>{tx('pos.vendor')}</span>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">{tx('pos.none_3')}</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="if"><span>{tx('pos.expected_date')}</span><input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></label>
            <label className="if"><span>{tx('pos.shipping')}</span><input value={shipping} onChange={(e) => setShipping(e.target.value)} inputMode="decimal" placeholder="0.00" /></label>
          </div>
          <div style={{ fontWeight: 700, fontSize: 12.5, margin: '6px 0 4px', color: 'var(--muted,#8A7A66)' }}>{tx('pos.line_items')}</div>
          {lines.map((l, i) => (
            <div key={i} className="if-row" style={{ alignItems: 'end' }}>
              <label className="if" style={{ flex: 2 }}><span>{tx('pos.product')}</span>
                <select value={l.productId} onChange={(e) => setLine(i, 'productId', e.target.value)}>
                  <option value="">{tx('pos.select_product')}</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.color_number ? ` #${p.color_number}` : ''}</option>)}
                </select>
              </label>
              <label className="if"><span>{tx('pos.qty')}</span><input value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} inputMode="numeric" /></label>
              <label className="if"><span>{tx('pos.unit_cost_2')}</span><input value={l.costDollars} onChange={(e) => setLine(i, 'costDollars', e.target.value)} inputMode="decimal" placeholder="4.50" /></label>
              <button className="btn sm ghost" onClick={() => removeLine(i)} disabled={lines.length === 1} title={tx('pos.remove_line')}>✕</button>
            </div>
          ))}
          <button className="btn sm ghost" onClick={addLine} style={{ marginTop: 4 }}>{tx('pos.add_line')}</button>
          <div style={{ textAlign: 'right', marginTop: 12, fontWeight: 700 }}>{tx('pos.subtotal_2')}{' '}{money(subtotal)} {tx('pos.total_4')}{' '}{money(total)}</div>
        </div>
        <div className="im-f"><button className="btn ghost" onClick={onClose}>{tx('pos.cancel')}</button><button className="btn primary" onClick={save} disabled={saving}>{saving ? tx('pos.creating') : tx('pos.create_purchase_order')}</button></div>
      </div>
    </div>
  );
}

type RecvLine = { quantity: string; lot: string; exp: string };
function ReceivePOModal({ poId, onClose, onSaved }: { poId: string; onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState<PurchaseOrderLine[] | null>(null);
  const [recv, setRecv] = useState<Record<string, RecvLine>>({});
  const [poNumber, setPoNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    inventoryApi.purchaseOrder(poId).then((r) => {
      setLines(r.lines); setPoNumber(r.purchaseOrder?.po_number || '');
      const init: Record<string, RecvLine> = {};
      r.lines.forEach((l) => { init[l.id] = { quantity: String(Math.max(0, l.quantity_ordered - l.quantity_received)), lot: l.lot_number || '', exp: l.expiration_date || '' }; });
      setRecv(init);
    }).catch((e: any) => setError(e?.message || tx('pos.could_not_load_purchase_order')));
  }, [poId]);
  const setR = (id: string, k: keyof RecvLine, v: string) => setRecv((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));
  const recvKeys = useRef(createIntentKeys());
  const save = async () => {
    const payload = (lines || [])
      .map((l) => ({ lineId: l.id, quantity: parseInt(recv[l.id]?.quantity || '0', 10) || 0, lotNumber: recv[l.id]?.lot || undefined, expirationDate: recv[l.id]?.exp || undefined }))
      .filter((x) => x.quantity > 0);
    if (payload.length === 0) { setError(tx('pos.enter_a_quantity_to_receive_on_1h96')); return; }
    setSaving(true); setError(null);
    try { await inventoryApi.receivePurchaseOrder(poId, { lines: payload }, recvKeys.current.keyFor('receive', { poId, payload })); recvKeys.current.done('receive'); onSaved(); }   // D10: a retried receipt counts once
    catch (e: any) { setError(e?.message || tx('pos.could_not_receive_purchase_order')); } finally { setSaving(false); }
  };
  return (
    <div className="inv-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal wide">
        <div className="im-h">{tx('pos.receive_2')}{' '}{poNumber || poId.slice(0, 8)}</div>
        <div className="im-b">
          {error && <div className="inv-err">{error}</div>}
          {!lines ? <div className="inv-empty">{tx('pos.loading')}</div>
            : lines.length === 0 ? <div className="inv-empty">{tx('pos.this_purchase_order_has_no_lines')}</div>
            : (
              <div className="bottle-list">
                {lines.map((l) => {
                  const remaining = Math.max(0, l.quantity_ordered - l.quantity_received);
                  return (
                    <div key={l.id} className="if-row" style={{ alignItems: 'end' }}>
                      <div className="if" style={{ flex: 2 }}>
                        <span>{l.product_name}{l.color_number ? ` #${l.color_number}` : ''}</span>
                        <div style={{ fontSize: 12, color: 'var(--muted,#8A7A66)', paddingTop: 4 }}>{tx('pos.ordered')}{' '}{l.quantity_ordered} {tx('pos.received_2')}{' '}{l.quantity_received} {tx('pos.remaining_2')}{' '}{remaining}</div>
                      </div>
                      <label className="if"><span>{tx('pos.receive')}</span><input value={recv[l.id]?.quantity ?? ''} onChange={(e) => setR(l.id, 'quantity', e.target.value)} inputMode="numeric" disabled={remaining === 0} /></label>
                      <label className="if"><span>{tx('pos.lot')}</span><input value={recv[l.id]?.lot ?? ''} onChange={(e) => setR(l.id, 'lot', e.target.value)} placeholder={tx('pos.optional_3')} disabled={remaining === 0} /></label>
                      <label className="if"><span>{tx('pos.expiration')}</span><input type="date" value={recv[l.id]?.exp ?? ''} onChange={(e) => setR(l.id, 'exp', e.target.value)} disabled={remaining === 0} /></label>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
        <div className="im-f"><button className="btn ghost" onClick={onClose}>{tx('pos.cancel')}</button><button className="btn primary" onClick={save} disabled={saving || !lines}>{saving ? tx('pos.receiving') : tx('pos.receive_into_inventory')}</button></div>
      </div>
    </div>
  );
}

type TLine = { productId: string; quantity: string };
function CreateTransferModal({ products, onClose, onSaved }: { products: InvProduct[]; onClose: () => void; onSaved: () => void }) {
  const [branches, setBranches] = useState<TransferBranch[]>([]);
  const [toBranchId, setToBranchId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<TLine[]>([{ productId: '', quantity: '1' }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ moved: number; lines: { name: string; moved: number; requested: number }[] } | null>(null);
  useEffect(() => { inventoryApi.transferBranches().then((r) => setBranches(r?.branches ?? [])).catch(() => setBranches([])); }, []);
  const setLine = (i: number, k: keyof TLine, v: string) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((p) => [...p, { productId: '', quantity: '1' }]);
  const removeLine = (i: number) => setLines((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p));
  const submit = async () => {
    if (!toBranchId) { setError(tx('pos.choose_a_destination_branch')); return; }
    const clean = lines.filter((l) => l.productId && (parseInt(l.quantity, 10) || 0) > 0);
    if (clean.length === 0) { setError(tx('pos.add_at_least_one_product_line_rsup')); return; }
    setSaving(true); setError(null);
    try {
      const r = await inventoryApi.createTransfer({ toBranchId, notes: notes || null, lines: clean.map((l) => ({ productId: l.productId, quantity: parseInt(l.quantity, 10) || 0 })) });
      const moved = r.transfer?.unit_count ?? r.lines.reduce((s, x) => s + x.quantity_moved, 0);
      setResult({ moved, lines: r.lines.map((x) => ({ name: x.product_name + (x.color_number ? ` #${x.color_number}` : ''), moved: x.quantity_moved, requested: x.quantity_requested })) });
    } catch (e: any) { setError(e?.message || tx('pos.could_not_complete_the_transfer')); } finally { setSaving(false); }
  };
  if (result) {
    const short = result.lines.some((l) => l.moved < l.requested);
    return (
      <div className="inv-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onSaved(); }}>
        <div className="inv-modal">
          <div className="im-h">{tx('pos.transfer_complete')}</div>
          <div className="im-b">
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{result.moved} {tx('pos.unit_2')}{enPlural(result.moved === 1 ? '' : 's')} {tx('pos.moved_2')}</div>
            <div className="bottle-list">
              {result.lines.map((l, i) => (
                <div key={i} className="bottle-row">
                  <span className={`inv-pill ${l.moved < l.requested ? 'orange' : 'ok'}`}>{l.moved}/{l.requested}</span>
                  <span className="br-meta">{l.name}</span>
                </div>
              ))}
            </div>
            {short && <div className="inv-err" style={{ marginTop: 10 }}>{tx('pos.some_lines_moved_fewer_than_requested_1qbm')}</div>}
          </div>
          <div className="im-f"><button className="btn primary" onClick={onSaved}>{tx('pos.done')}</button></div>
        </div>
      </div>
    );
  }
  return (
    <div className="inv-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal wide">
        <div className="im-h">{tx('pos.new_branch_transfer')}</div>
        <div className="im-b">
          {error && <div className="inv-err">{error}</div>}
          <label className="if"><span>{tx('pos.destination_branch')}</span>
            <select value={toBranchId} onChange={(e) => setToBranchId(e.target.value)}>
              <option value="">{tx('pos.select_branch')}</option>
              {branches.map((bb) => <option key={bb.id} value={bb.id}>{bb.name}{bb.city ? ` — ${bb.city}` : ''}</option>)}
            </select>
          </label>
          {branches.length === 0 && <div className="inv-empty">{tx('pos.no_other_branches_available_to_transfer_1f9c')}</div>}
          <div style={{ fontWeight: 700, fontSize: 12.5, margin: '6px 0 4px', color: 'var(--muted,#8A7A66)' }}>{tx('pos.products_to_move')}</div>
          {lines.map((l, i) => (
            <div key={i} className="if-row" style={{ alignItems: 'end' }}>
              <label className="if" style={{ flex: 2 }}><span>{tx('pos.product')}</span>
                <select value={l.productId} onChange={(e) => setLine(i, 'productId', e.target.value)}>
                  <option value="">{tx('pos.select_product')}</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.color_number ? ` #${p.color_number}` : ''} · {p.onHand} {tx('pos.on_hand_3')}</option>)}
                </select>
              </label>
              <label className="if"><span>{tx('pos.qty')}</span><input value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} inputMode="numeric" /></label>
              <button className="btn sm ghost" onClick={() => removeLine(i)} disabled={lines.length === 1} title={tx('pos.remove_line')}>✕</button>
            </div>
          ))}
          <button className="btn sm ghost" onClick={addLine} style={{ marginTop: 4 }}>{tx('pos.add_line')}</button>
          <label className="if" style={{ marginTop: 10 }}><span>{tx('pos.notes')}</span><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tx('pos.optional_3')} /></label>
        </div>
        <div className="im-f"><button className="btn ghost" onClick={onClose}>{tx('pos.cancel')}</button><button className="btn primary" onClick={submit} disabled={saving || branches.length === 0}>{saving ? tx('pos.transferring') : tx('pos.transfer_stock')}</button></div>
      </div>
    </div>
  );
}

const CL_GRID = { gridTemplateColumns: '2fr 1fr 1fr 1fr' } as const;
const C_TONE: Record<string, string> = { in_progress: 'warn', submitted: 'mut', reconciled: 'ok', cancelled: 'mut' };

function CreateCountModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [scopeType, setScopeType] = useState<'all' | 'category' | 'brand'>('all');
  const [scopeId, setScopeId] = useState('');
  const [cats, setCats] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { (async () => { try { const [c, b] = await Promise.all([inventoryApi.categories(), inventoryApi.brands()]); setCats(c?.categories ?? []); setBrands(b?.brands ?? []); } catch { /* non-fatal */ } })(); }, []);
  const save = async () => {
    setErr(null);
    if (scopeType !== 'all' && !scopeId) { setErr(tx('pos.choose_a_scopetype', { scopeType: String(scopeType) })); return; }
    setBusy(true);
    try { const r = await inventoryApi.createCount({ scopeType, scopeId: scopeType === 'all' ? undefined : scopeId, notes: notes || undefined }); onSaved(r.id); }
    catch (e: any) { setErr(e?.message || tx('pos.could_not_start_count')); setBusy(false); }
  };
  return (
    <div className="inv-ov" onClick={onClose}>
      <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="im-h"><h3>{tx('pos.new_physical_count')}</h3><button onClick={onClose}>✕</button></div>
        <div className="im-b">
          <div className="if"><label className="if-l">{tx('pos.scope')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['all', 'category', 'brand'] as const).map((s) => <button key={s} className={`btn ${scopeType === s ? 'primary' : ''}`} onClick={() => { setScopeType(s); setScopeId(''); }} style={{ textTransform: 'capitalize' }}>{s === 'all' ? tx('pos.all_products') : s}</button>)}
            </div>
          </div>
          {scopeType === 'category' && <div className="if"><label className="if-l">{tx('pos.category')}</label><select className="if-in" value={scopeId} onChange={(e) => setScopeId(e.target.value)}><option value="">{tx('pos.select')}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
          {scopeType === 'brand' && <div className="if"><label className="if-l">{tx('pos.brand')}</label><select className="if-in" value={scopeId} onChange={(e) => setScopeId(e.target.value)}><option value="">{tx('pos.select')}</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
          <div className="if"><label className="if-l">{tx('pos.notes')}</label><input className="if-in" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tx('pos.optional_2')} /></div>
          {err && <div className="inv-err">{err}</div>}
        </div>
        <div className="im-f"><button className="btn" onClick={onClose}>{tx('pos.cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? tx('pos.starting') : tx('pos.start_count')}</button></div>
      </div>
    </div>
  );
}

function CountEntryModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<CountDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useEventCallback(async () => { try { const d = await inventoryApi.count(id); setData(d); setDraft({}); } catch (e: any) { setErr(e?.message || tx('pos.could_not_load_count')); } });
  useEffect(() => { void load();   }, [id, load]);
  const saveLine = async (lineId: string) => {
    const v = draft[lineId];
    if (v === undefined) return;
    setBusy(true); setErr(null);
    try { const d = await inventoryApi.enterCount(id, { lineId, countedQty: v === '' ? null : parseInt(v, 10) }); setData(d); setDraft((x) => { const n = { ...x }; delete n[lineId]; return n; }); onChanged(); }
    catch (e: any) { setErr(e?.message || tx('pos.could_not_save')); }
    finally { setBusy(false); }
  };
  const act = async (fn: () => Promise<any>, label: string) => {
    setBusy(true); setErr(null);
    try { const d = await fn(); if (d?.count) setData(d); onChanged(); if (label === 'reconcile' || label === 'cancel') onClose(); }
    catch (e: any) { setErr(e?.message || tx('pos.could_not_label', { label: String(label) })); }
    finally { setBusy(false); }
  };
  if (!data) return <div className="inv-ov" onClick={onClose}><div className="inv-modal" onClick={(e) => e.stopPropagation()}><div className="im-b"><div className="inv-empty">{err || tx('pos.loading')}</div></div></div></div>;
  const c = data.count;
  const editable = c.status === 'in_progress';
  return (
    <div className="inv-ov" onClick={onClose}>
      <div className="inv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="im-h"><h3>{c.count_number} · {c.scope_label} <span className={`inv-pill ${C_TONE[c.status] || 'mut'}`} style={{ marginLeft: 8 }}>{codeLabel('admin.inventory.count', c.status, 'drawer')}</span></h3><button onClick={onClose}>✕</button></div>
        <div className="im-b">
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="inv-table">
                <div className="it-head" style={CL_GRID}><span>{tx('pos.product')}</span><span>{tx('pos.expected')}</span><span>{tx('pos.counted')}</span><span>{tx('pos.variance')}</span></div>
                {data.lines.map((l) => {
                  const draftVal = draft[l.id];
                  const countedShown = draftVal !== undefined ? draftVal : (l.counted_qty === null ? '' : String(l.counted_qty));
                  const countedNum = countedShown === '' ? null : parseInt(countedShown, 10);
                  const v = countedNum === null ? null : countedNum - l.expected_qty;
                  const tone = v === null ? 'mut' : v >= 0 ? 'ok' : 'warn';
                  return (
                    <div key={l.id} className="it-row" style={CL_GRID}>
                      <span className="it-name"><b>{l.product_name}</b>{l.color_number ? <small>#{l.color_number}</small> : null}</span>
                      <span className="it-onhand">{l.expected_qty}</span>
                      <span>{editable
                        ? <input className="if-in" style={{ width: 72, height: 30 }} inputMode="numeric" value={countedShown} placeholder="—"
                            onChange={(e) => setDraft((x) => ({ ...x, [l.id]: e.target.value.replace(/[^0-9]/g, '') }))} onBlur={() => saveLine(l.id)} />
                        : (l.counted_qty === null ? '—' : l.counted_qty)}</span>
                      <span>{v === null ? <span style={{ color: 'var(--muted,#8A7A66)' }}>—</span> : <span className={`inv-pill ${tone}`}>{v > 0 ? '+' : ''}{v}</span>}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {err && <div className="inv-err">{err}</div>}
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--muted,#8A7A66)' }}>{c.counted_count}/{c.line_count} {tx('pos.counted_2')}{c.status === 'reconciled' ? tx('pos.variance_units_unit_plural_adjusted', { variance_units: String(c.variance_units), plural: String(c.variance_units === 1 ? '' : 's') }) : ''}</div>
        </div>
        <div className="im-f">
          <button className="btn" onClick={onClose}>{tx('pos.close')}</button>
          {(c.status === 'in_progress' || c.status === 'submitted') && <button className="btn" onClick={() => act(() => inventoryApi.cancelCount(id), 'cancel')} disabled={busy}>{tx('pos.cancel_count')}</button>}
          {c.status === 'in_progress' && <button className="btn" onClick={() => act(() => inventoryApi.submitCount(id), 'submit')} disabled={busy}>{tx('pos.submit')}</button>}
          {(c.status === 'in_progress' || c.status === 'submitted') && <button className="btn primary" onClick={() => act(() => inventoryApi.reconcileCount(id), 'reconcile')} disabled={busy || c.counted_count === 0}>{tx('pos.reconcile_to_system')}</button>}
        </div>
      </div>
    </div>
  );
}

function initCatalogFields(kind: string, item: any | null): Record<string, string> {
  if (!item) return {};
  if (kind === 'category') return { name: item.name || '', code: item.code || '', description: item.description || '', displayColor: item.display_color || '', sortOrder: item.sort_order != null ? String(item.sort_order) : '', trackingMode: item.tracking_mode || 'quantity' };
  if (kind === 'brand') return { name: item.name || '', code: item.code || '', website: item.website || '', notes: item.notes || '' };
  return { name: item.name || '', contactName: item.contact_name || '', phone: item.phone || '', email: item.email || '', website: item.website || '', accountNumber: item.account_number || '', paymentTerms: item.payment_terms || '', leadTimeDays: item.lead_time_days != null ? String(item.lead_time_days) : '' };
}
function buildCatalogBody(kind: string, f: Record<string, string>): any {
  const name = (f.name || '').trim();
  if (kind === 'category') return { name, code: f.code || undefined, description: f.description || undefined, displayColor: f.displayColor || undefined, sortOrder: f.sortOrder ? parseInt(f.sortOrder, 10) : 0, trackingMode: f.trackingMode || 'quantity' };
  if (kind === 'brand') return { name, code: f.code || undefined, website: f.website || undefined, notes: f.notes || undefined };
  return { name, contactName: f.contactName || undefined, phone: f.phone || undefined, email: f.email || undefined, website: f.website || undefined, accountNumber: f.accountNumber || undefined, paymentTerms: f.paymentTerms || undefined, leadTimeDays: f.leadTimeDays || undefined };
}

function CatalogEditModal({ kind, item, onClose, onSaved }: { kind: 'category' | 'brand' | 'vendor'; item: any | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>(() => initCatalogFields(kind, item));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const isEdit = !!item;
  const hexValid = /^#?[0-9a-f]{6}$/i.test(f.displayColor || '');
  const hex = (f.displayColor || '').startsWith('#') ? (f.displayColor || '') : '#' + (f.displayColor || '');
  const colorWarn = kind === 'category' ? colorContrastWarning(f.displayColor || '') : null;
  const save = async () => {
    if (!f.name?.trim()) { setErr(tx('pos.name_is_required_2')); return; }
    setBusy(true); setErr(null);
    try {
      const body = buildCatalogBody(kind, f);
      if (kind === 'category') { if (isEdit) await inventoryApi.updateCategory(item.id, body); else await inventoryApi.createCategory(body); }
      else if (kind === 'brand') { if (isEdit) await inventoryApi.updateBrand(item.id, body); else await inventoryApi.createBrand(body); }
      else { if (isEdit) await inventoryApi.updateVendor(item.id, body); else await inventoryApi.createVendor(body); }
      onSaved();
    } catch (e: any) { setErr(e?.message || tx('pos.could_not_save')); setBusy(false); }
  };
  return (
    <div className="inv-ov" onClick={onClose}>
      <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="im-h"><h3 style={{ textTransform: 'capitalize' }}>{isEdit ? tx('pos.edit') : tx('pos.new')} {kind}</h3><button onClick={onClose}>✕</button></div>
        <div className="im-b">
          <div className="if"><label className="if-l">{tx('pos.name_2')}</label><input className="if-in" value={f.name || ''} onChange={(e) => set('name', e.target.value)} autoFocus /></div>
          {kind === 'category' && <>
            <div className="if"><label className="if-l">{tx('pos.display_color')}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" value={hexValid ? hex : '#A96F22'} onChange={(e) => set('displayColor', e.target.value)} style={{ width: 40, height: 32, padding: 0, border: '1px solid #E7DCC8', borderRadius: 8, background: 'none', cursor: 'pointer' }} />
                <input className="if-in" style={{ maxWidth: 130 }} value={f.displayColor || ''} placeholder="#A96F22" onChange={(e) => set('displayColor', e.target.value)} />
                {hexValid && <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: hex, color: readableTextColor(f.displayColor || '') }}>{f.name || tx('pos.category')}</span>}
              </div>
            </div>
            {colorWarn && <div className="inv-err" style={{ background: '#FCEFE0', color: '#9A5B12', borderColor: '#EAD2AE' }}>{colorWarn}</div>}
            <div className="if-row">
              <div className="if"><label className="if-l">{tx('pos.sort_order')}</label><input className="if-in" inputMode="numeric" value={f.sortOrder || ''} placeholder="0" onChange={(e) => set('sortOrder', e.target.value.replace(/[^0-9]/g, ''))} /></div>
              <div className="if"><label className="if-l">{tx('pos.tracking')}</label><select className="if-in" value={f.trackingMode || 'quantity'} onChange={(e) => set('trackingMode', e.target.value)}><option value="quantity">{tx('pos.quantity')}</option><option value="bottle">{tx('pos.bottle')}</option></select></div>
            </div>
            <div className="if"><label className="if-l">{tx('pos.code')}</label><input className="if-in" value={f.code || ''} placeholder={tx('pos.optional_2')} onChange={(e) => set('code', e.target.value)} /></div>
          </>}
          {kind === 'brand' && <>
            <div className="if-row">
              <div className="if"><label className="if-l">{tx('pos.code')}</label><input className="if-in" value={f.code || ''} placeholder={tx('pos.optional_2')} onChange={(e) => set('code', e.target.value)} /></div>
              <div className="if"><label className="if-l">{tx('pos.website')}</label><input className="if-in" value={f.website || ''} placeholder={tx('pos.optional_2')} onChange={(e) => set('website', e.target.value)} /></div>
            </div>
            <div className="if"><label className="if-l">{tx('pos.notes')}</label><input className="if-in" value={f.notes || ''} placeholder={tx('pos.optional_2')} onChange={(e) => set('notes', e.target.value)} /></div>
          </>}
          {kind === 'vendor' && <>
            <div className="if-row">
              <div className="if"><label className="if-l">{tx('pos.contact')}</label><input className="if-in" value={f.contactName || ''} placeholder={tx('pos.optional_2')} onChange={(e) => set('contactName', e.target.value)} /></div>
              <div className="if"><label className="if-l">{tx('pos.phone')}</label><input className="if-in" value={f.phone || ''} placeholder={tx('pos.optional_2')} onChange={(e) => set('phone', e.target.value)} /></div>
            </div>
            <div className="if-row">
              <div className="if"><label className="if-l">{tx('pos.email')}</label><input className="if-in" value={f.email || ''} placeholder={tx('pos.optional_2')} onChange={(e) => set('email', e.target.value)} /></div>
              <div className="if"><label className="if-l">{tx('pos.account_2')}</label><input className="if-in" value={f.accountNumber || ''} placeholder={tx('pos.optional_2')} onChange={(e) => set('accountNumber', e.target.value)} /></div>
            </div>
            <div className="if-row">
              <div className="if"><label className="if-l">{tx('pos.payment_terms')}</label><input className="if-in" value={f.paymentTerms || ''} placeholder={tx('pos.e_g_net_30')} onChange={(e) => set('paymentTerms', e.target.value)} /></div>
              <div className="if"><label className="if-l">{tx('pos.lead_time_days')}</label><input className="if-in" inputMode="numeric" value={f.leadTimeDays || ''} placeholder={tx('pos.optional_2')} onChange={(e) => set('leadTimeDays', e.target.value.replace(/[^0-9]/g, ''))} /></div>
            </div>
          </>}
          {err && <div className="inv-err">{err}</div>}
        </div>
        <div className="im-f"><button className="btn" onClick={onClose}>{tx('pos.cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? tx('pos.saving_2') : isEdit ? tx('pos.save_changes') : tx('pos.create_2')}</button></div>
      </div>
    </div>
  );
}

function RecipeEditorModal({ serviceId, products, onClose, onSaved }: { serviceId: string; products: InvProduct[]; onClose: () => void; onSaved: () => void }) {
  const [recipe, setRecipe] = useState<ServiceRecipe | null>(null);
  const [lines, setLines] = useState<{ productId: string; quantity: number }[]>([]);
  const [addPid, setAddPid] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { (async () => { try { const r = await inventoryApi.serviceRecipe(serviceId); setRecipe(r); setLines(r.lines.map((l) => ({ productId: l.product_id, quantity: l.quantity }))); } catch (e: any) { setErr(e?.message || tx('pos.could_not_load_recipe')); } })(); }, [serviceId]);
  const prodName = (id: string) => { const p = products.find((x) => x.id === id); return p ? `${p.name}${p.color_number ? ' #' + p.color_number : ''}` : (recipe?.lines.find((l) => l.product_id === id)?.product_name || id.slice(0, 8)); };
  const prodCost = (id: string): number => { const p = products.find((x) => x.id === id) as ({ cost_cents?: number | null } | undefined); return (p?.cost_cents ?? recipe?.lines.find((l) => l.product_id === id)?.cost_cents ?? 0) || 0; };
  const add = () => { if (!addPid || lines.some((l) => l.productId === addPid)) return; setLines((x) => [...x, { productId: addPid, quantity: 1 }]); setAddPid(''); };
  const setQty = (pid: string, q: number) => setLines((x) => x.map((l) => (l.productId === pid ? { ...l, quantity: Math.max(1, q) } : l)));
  const remove = (pid: string) => setLines((x) => x.filter((l) => l.productId !== pid));
  const totalCents = lines.reduce((s, l) => s + l.quantity * prodCost(l.productId), 0);
  const available = products.filter((p) => !lines.some((l) => l.productId === p.id));
  const save = async () => { setBusy(true); setErr(null); try { await inventoryApi.setServiceRecipe(serviceId, lines); onSaved(); } catch (e: any) { setErr(e?.message || tx('pos.could_not_save_recipe')); setBusy(false); } };
  return (
    <div className="inv-ov" onClick={onClose}>
      <div className="inv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="im-h"><h3>{tx('pos.recipe_2')}{' '}{recipe?.service.name || '…'}</h3><button onClick={onClose}>✕</button></div>
        <div className="im-b">
          <div style={{ fontSize: 12.5, color: 'var(--muted,#8A7A66)', marginBottom: 8 }}>{tx('pos.products_this_service_consumes_each_time_gif3')}</div>
          {lines.length === 0 ? <div className="inv-empty">{tx('pos.no_products_yet_add_one_below')}</div>
            : (
              <div className="overflow-x-auto">
                <div className="min-w-[500px]">
                  <div className="inv-table">
                    <div className="it-head" style={{ gridTemplateColumns: '2fr 1fr 1fr auto' }}><span>{tx('pos.product')}</span><span>{tx('pos.qty_service')}</span><span>{tx('pos.cost')}</span><span></span></div>
                    {lines.map((l) => (
                      <div key={l.productId} className="it-row" style={{ gridTemplateColumns: '2fr 1fr 1fr auto' }}>
                        <span className="it-name"><b>{prodName(l.productId)}</b></span>
                        <span><input className="if-in" style={{ width: 64, height: 30 }} inputMode="numeric" value={String(l.quantity)} onChange={(e) => setQty(l.productId, parseInt(e.target.value.replace(/[^0-9]/g, '') || '1', 10))} /></span>
                        <span style={{ fontSize: 13 }}>{money(l.quantity * prodCost(l.productId))}</span>
                        <span style={{ textAlign: 'right' }}><button className="btn" onClick={() => remove(l.productId)}>{tx('pos.remove')}</button></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          <div className="if-row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <div className="if" style={{ flex: 1 }}><label className="if-l">{tx('pos.add_product_2')}</label>
              <select className="if-in" value={addPid} onChange={(e) => setAddPid(e.target.value)}>
                <option value="">{tx('pos.select_a_product')}</option>
                {available.map((p) => <option key={p.id} value={p.id}>{p.name}{p.color_number ? ` #${p.color_number}` : ''}</option>)}
              </select>
            </div>
            <button className="btn primary" onClick={add} disabled={!addPid}>{tx('pos.add')}</button>
          </div>
          <div style={{ marginTop: 12, fontWeight: 700 }}>{tx('pos.recipe_cost_per_service')}{' '}{money(totalCents)}</div>
          {err && <div className="inv-err">{err}</div>}
        </div>
        <div className="im-f"><button className="btn" onClick={onClose}>{tx('pos.cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? tx('pos.saving_2') : tx('pos.save_recipe')}</button></div>
      </div>
    </div>
  );
}

// ===== OCR receipt scanner (ai_ocr_receipt_scanner) =====
function downscaleToBase64(file: File, maxDim: number, quality: number): Promise<{ base64: string; mime: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const scale = Math.min(1, maxDim / Math.max(w, h, 1));
      w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d'); if (!ctx) { reject(new Error('canvas_unavailable')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve({ base64: dataUrl.split(',')[1] || '', mime: 'image/jpeg', dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_load_failed')); };
    img.src = url;
  });
}

function ReceiptScanModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [phase, setPhase] = useState<'pick' | 'scanning' | 'review' | 'saving'>('pick');
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [vendor, setVendor] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState('inventory');
  const [amount, setAmount] = useState('');

  const manual = (msg: string) => { setErr(msg); setReceipt({ vendor: null, date: null, items: [], subtotalCents: 0, taxCents: 0, totalCents: 0, currency: null }); setAmount(''); setPhase('review'); };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    let img: { base64: string; mime: string; dataUrl: string };
    try { img = await downscaleToBase64(file, 1600, 0.82); } catch { setErr(tx('pos.could_not_read_that_image_file')); return; }
    setPreview(img.dataUrl); setPhase('scanning');
    try {
      const r = await posAiApi.scanReceipt(img.base64, img.mime);
      if (!r.ok || !r.receipt) { manual(tx('admin.inventory.receiptUnreadable')); return; }
      const rc = r.receipt;
      setReceipt(rc); setVendor(rc.vendor || ''); setDate(rc.date || ''); setAmount(((rc.totalCents || 0) / 100).toFixed(2));
      setPhase('review');
    } catch (e: any) {
      if (e?.status === 403) { setErr(tx('pos.ai_ocr_receipt_scanner_isn_t_13tw')); setPhase('pick'); }
      else manual(tx('admin.inventory.receiptUnreadable'));
    }
  };

  const save = async () => {
    const amountCents = (parseDollarsToCents(amount) ?? 0);
    if (!amountCents) { setErr(tx('pos.enter_the_receipt_total')); return; }
    setPhase('saving'); setErr(null);
    try {
      const desc = receipt && receipt.items.length ? receipt.items.map((i) => `${i.quantity}× ${i.name}`).join(', ').slice(0, 500) : null;
      await inventoryApi.saveReceiptExpense({ vendor: vendor.trim() || null, amountCents, incurredOn: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, category: category.trim() || 'inventory', description: desc });
      onSaved();
    } catch (e: any) { setErr(e?.message || tx('pos.could_not_save_expense')); setPhase('review'); }
  };

  return (
    <div className="inv-ov" onClick={onClose}>
      <div className="inv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="im-h"><h3>{tx('pos.scan_receipt')}</h3><button onClick={onClose}>✕</button></div>
        <div className="im-b">
          {phase === 'pick' && (
            <div>
              <p style={{ fontSize: 13, color: 'var(--muted,#8A7A66)', marginTop: 0 }}>{tx('pos.take_a_photo_of_a_supplier_1pr0')}</p>
              <label className="btn primary" style={{ display: 'inline-block', cursor: 'pointer' }}>
                {tx('pos.choose_photo')}
                <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
              </label>
            </div>
          )}
          {phase === 'scanning' && (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              {preview && <img src={preview} alt="" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 10, border: '1px solid #E7DCC8' }} />}
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--muted,#8A7A66)' }}>{tx('pos.reading_receipt')}</div>
            </div>
          )}
          {(phase === 'review' || phase === 'saving') && (
            <div>
              {preview && <img src={preview} alt="" style={{ maxWidth: 120, maxHeight: 120, objectFit: 'cover', borderRadius: 10, border: '1px solid #E7DCC8', float: 'right', marginLeft: 10 }} />}
              <div className="if-row">
                <div className="if"><label className="if-l">{tx('pos.vendor')}</label><input className="if-in" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder={tx('pos.supplier')} /></div>
                <div className="if"><label className="if-l">{tx('pos.date')}</label><input className="if-in" value={date} onChange={(e) => setDate(e.target.value)} placeholder={tx('pos.yyyy_mm_dd')} /></div>
              </div>
              <div className="if-row">
                <div className="if"><label className="if-l">{tx('pos.category')}</label><input className="if-in" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
                <div className="if"><label className="if-l">{tx('pos.total_5')}</label><input className="if-in" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" /></div>
              </div>
              {receipt && receipt.items.length > 0 && (
                <div style={{ marginTop: 10, clear: 'both' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted,#8A7A66)', marginBottom: 4 }}>{tx('pos.line_items_2')}</div>
                  {receipt.items.map((it, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0' }}>
                      <span>{it.quantity}× {it.name}</span><span>{money(it.totalCents)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted,#8A7A66)', borderTop: '1px solid #EFE5D3', marginTop: 4, paddingTop: 4 }}>
                    <span>{tx('pos.subtotal_2')}{' '}{money(receipt.subtotalCents)} {tx('pos.tax_6')}{' '}{money(receipt.taxCents)}</span><span>{tx('pos.total')}{' '}{money(receipt.totalCents)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
          {err && <div className="inv-err" style={{ clear: 'both' }}>{err}</div>}
        </div>
        <div className="im-f">
          <button className="btn" onClick={onClose}>{tx('pos.cancel')}</button>
          {(phase === 'review' || phase === 'saving') && <button className="btn primary" onClick={save} disabled={phase === 'saving'}>{phase === 'saving' ? tx('pos.saving_2') : tx('pos.save_expense')}</button>}
        </div>
      </div>
    </div>
  );
}
