// POSProductsScreen.tsx — Services & Products → Products (/tenant/products). Products mandate (Oct 29 2026): the inventory
// catalog with everything the two photos showed kept — the title, the three KPIs (Products · Need Reorder · Retail Value),
// the search, the gold + New Product button, the columns Product · SKU · Brand / Category · On Hand · Status · Retail and
// the Add Stock / Archive actions — and what they lacked: one universal search (name, SKU, barcode, colour, brand,
// category, supplier name / phone in any format, supplier SKU, PO number, technician), a period that names its date field
// (created · updated · stock activity · received · archived · expiration · last used), server paging newest first with
// numbered pages, sorting over the whole list, an Archived view with Restore, Last Used By on every row, and a Product
// Details overlay (Overview · Pricing · Inventory · Suppliers · Technician Usage · History).
// What the numbers mean (they were computed in the browser from a 200-row list before):
//   Products      active product records (bottles and lots are not products);
//   Need Reorder  products at or below their reorder level, out of stock included — the SAME scope as Stock Alerts and the
//                 sidebar badge (stock-alert-state.ts), location overrides applied (it used the base level only);
//   Retail Value  retail price × usable, unexpired units on hand — potential value, not sales; the cost value is beside it.
// The page scrolls vertically (the spec allows it); the sidebar scrolls on its own.
import { useEffect, useState } from 'react';
import { SystemCheckButton } from '../components/SystemCheck';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { inventoryApi } from '../api/inventoryApi';
import { posProductsApi } from '../api/posProductsApi';
import { posInventoryScreenApi } from '../api/posInventoryScreenApi';
import { fmtNumber } from '../i18n/format';
import { useCan } from '../components/usePermissions';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { StockChip, ProductDetailsDialog, ProductFormDialog, EditProductDialog, AddStockDialog, money, unitLabel, errMsg, sevLabel } from '../components/InventoryKit';
import { LastUsed, RecordUseDialog } from './POSInventoryAlertsScreen';

const STATUSES = ['needs_reorder', 'out_of_stock', 'critical', 'low', 'in_stock', 'overstock'];
const SORTS = ['newest', 'oldest', 'name', 'sku', 'stock', 'critical', 'price_desc', 'price_asc', 'updated', 'last_used'];
const DATE_FIELDS = ['created', 'updated', 'activity', 'received', 'archived', 'expiration', 'used'];
const PAGE_SIZE = 12;

export function POSProductsScreen() {
  const nav = useNavigate(); const can = useCan();
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [lifecycle, setLifecycle] = useState<'active' | 'archived'>('active');
  const [status, setStatus] = useState(''); const [brandId, setBrandId] = useState(''); const [categoryId, setCategoryId] = useState(''); const [vendorId, setVendorId] = useState('');
  const [sort, setSort] = useState('newest'); const [period, setPeriod] = useState<PeriodState>({ preset: 'all' }); const [dateField, setDateField] = useState('created');
  const [page, setPage] = useState(1); const [tick, setTick] = useState(0);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string; productId?: string; outside?: boolean } | null>(null);
  const [detail, setDetail] = useState<string | null>(null); const [adding, setAdding] = useState(false); const [editing, setEditing] = useState<string | null>(null);
  const [stockFor, setStockFor] = useState<any | null>(null); const [archiveFor, setArchiveFor] = useState<any | null>(null); const [recording, setRecording] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [exporting, setExporting] = useState(false);
  const scope = { search: q || undefined, lifecycle, status: status || undefined, brandId: brandId || undefined, categoryId: categoryId || undefined, vendorId: vendorId || undefined, sort, ...periodQuery(period), dateField };
  const key = JSON.stringify(scope); useEffect(() => { setPage(1); }, [key]);
  const metrics = useLoad(() => posInventoryScreenApi.metrics(), [tick]);
  const list = useLoad(() => posInventoryScreenApi.products({ ...scope, page, pageSize: PAGE_SIZE }), [key, page, tick]);
  const lookups = useLoad(async () => { const [c, b, v] = await Promise.all([inventoryApi.categories(), inventoryApi.brands(), inventoryApi.vendors()]); return { categories: c?.categories ?? [], brands: b?.brands ?? [], vendors: v?.vendors ?? [] }; }, [tick]);
  useEffect(() => { if (list.data && list.data.page !== page) setPage(list.data.page); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { setTick((t) => t + 1); window.dispatchEvent(new CustomEvent('aps:nav-counts-changed')); };
  const m = metrics.data; const rows: any[] = list.data?.rows ?? [];
  const filtered = !!(q || status || brandId || categoryId || vendorId || period.preset !== 'all' || lifecycle !== 'active');
  const clearAll = () => { setSearch(''); setStatus(''); setBrandId(''); setCategoryId(''); setVendorId(''); setPeriod({ preset: 'all' }); setDateField('created'); setLifecycle('active'); setSort('newest'); };
  const created = async (id: string) => {
    setAdding(false);
    // the new product is first on page 1 under the default order — unless the current filters exclude it
    const outside = !!(q || status || brandId || categoryId || vendorId || period.preset !== 'all' || lifecycle !== 'active' || sort !== 'newest');
    setPage(1); refresh(); setNote({ tone: 'ok', text: tx('prd.created'), productId: id, outside });
  };
  const archive = async (p: any) => {
    setBusy(p.id);
    try { await posProductsApi.archive(p.id); setArchiveFor(null); setNote({ tone: 'ok', text: tx('prd.archived', { n: p.name }), productId: p.id }); refresh(); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } finally { setBusy(null); }
  };
  const restore = async (p: any) => {
    setBusy(p.id);
    try { await posInventoryScreenApi.restoreProduct(p.id); setNote({ tone: 'ok', text: tx('prd.restored', { n: p.name }), productId: p.id }); refresh(); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } finally { setBusy(null); }
  };
  const doExport = async () => {
    setExporting(true);
    try { const csv = await posInventoryScreenApi.exportProducts(scope); const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'products.csv'; a.click(); URL.revokeObjectURL(a.href); setNote({ tone: 'ok', text: tx('finance.exported') }); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } finally { setExporting(false); }
  };
  const reorder = (p: any) => nav(`/tenant/inventory?tab=purchaseOrders&new=1&productId=${encodeURIComponent(p.id)}&qty=${p.suggestedReorder}${p.vendorId ? '&vendorId=' + encodeURIComponent(p.vendorId) : ''}`);
  if (isForbidden(metrics.error)) return <div className="work prd" data-testid="products-screen"><h1>{tx('pos.products')}</h1><StateBlock error={metrics.error} onRetry={metrics.reload} /></div>;
  const L = lookups.data;
  return (
    <div className="work prd" data-testid="products-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.products')}</h1><div className="sub">{tx('pos.your_inventory_catalog')}</div></div>
        <div className="fk-head-actions">
          <SystemCheckButton domain="inventory" />
          <button type="button" className="fk-btn" onClick={refresh} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn" onClick={() => nav('/tenant/inventory')} data-testid="to-inventory">{tx('prd.toInventory')}</button>
          {can('inventory.reports.view') ? <button type="button" className="fk-btn ghost" onClick={doExport} disabled={exporting} data-testid="export">{exporting ? tx('pos.loading') : tx('finance.exportReport')}</button> : null}
          {can('inventory.create') ? <button type="button" className="fk-btn primary" onClick={() => setAdding(true)} data-testid="new-product">{tx('pos.new_product_2')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span>
        {note.productId ? <button type="button" className="fk-link" onClick={() => setDetail(note.productId!)} data-testid="note-view">{tx('prd.viewProduct')}</button> : null}
        {note.outside ? <button type="button" className="fk-link" onClick={clearAll} data-testid="note-clear">{tx('finance.clearFilters')}</button> : null}
        <button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      <div className="fk-kpis three" data-testid="kpis">
        {metrics.error ? <StateBlock error={metrics.error} onRetry={metrics.reload} /> : <>
          <KpiCard testId="kpi-products" label={tx('pos.products')} loading={!m} value={m ? fmtNumber(m.products) : ''} sub={tx('prd.kpi.productsSub')} onClick={() => { clearAll(); }} />
          <KpiCard testId="kpi-reorder" tone={m && m.needReorder > 0 ? 'bad' : undefined} label={tx('pos.need_reorder')} loading={!m} value={m ? fmtNumber(m.needReorder) : ''} sub={m ? tx('prd.kpi.reorderSub', { o: fmtNumber(m.outOfStock) }) : ''} onClick={() => { setLifecycle('active'); setStatus('needs_reorder'); }} />
          <KpiCard testId="kpi-retail" label={tx('pos.retail_value')} loading={!m} value={m ? (m.retailValueCents == null ? '—' : money(m.retailValueCents)) : ''} sub={m && m.inventoryValueCents != null ? tx('prd.kpi.retailSub', { c: money(m.inventoryValueCents) }) : tx('prd.kpi.retailSubNoCost')} />
        </>}
      </div>
      <div className="prd-tools" data-testid="toolbar">
        <div className="fn-search prd-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('prd.searchPh')} aria-label={tx('prd.searchPh')} data-testid="search"
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}</div>
        <div className="fk-seg" role="group" aria-label={tx('prd.lifecycle')}>
          {(['active', 'archived'] as const).map((x) => <button key={x} type="button" className={lifecycle === x ? 'on' : ''} aria-pressed={lifecycle === x} onClick={() => setLifecycle(x)} data-testid={'life-' + x}>{tx('prd.life.' + x)}</button>)}
        </div>
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status')} data-testid="status"><option value="">{tx('prd.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{s === 'needs_reorder' ? tx('pos.need_reorder') : sevLabel(s)}</option>)}</select>
        <select className="fk-select" value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label={tx('pos.brand')} data-testid="brand"><option value="">{tx('prd.allBrands')}</option>{(L?.brands ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select className="fk-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label={tx('pos.category')} data-testid="category"><option value="">{tx('prd.allCategories')}</option>{(L?.categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="fk-select" value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label={tx('inv.f.supplier')} data-testid="supplier"><option value="">{tx('prd.allSuppliers')}</option>{(L?.vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('prd.sort')} data-testid="sort">{SORTS.map((s) => <option key={s} value={s}>{tx('prd.sort.' + s)}</option>)}</select>
      </div>
      <div className="fn-tabsrow prd-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={list.data?.period} allowAll compact basis={dateField} basisOptions={DATE_FIELDS.map((f) => ({ value: f, label: tx('prd.df.' + f) }))} onBasis={setDateField} />
        {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div>
      <FitPanel testId="products-list" className="prd-list" title={<span className="fn-chips">{lifecycle === 'archived' ? tx('prd.archivedProducts') : tx('prd.catalog')}{list.data ? <span className="fk-muted"> · {fmtNumber(list.data.total)}</span> : null}<span className="fk-hint">{period.preset !== 'all' ? tx('prd.dateShown', { f: tx('prd.df.' + dateField) }) : tx('prd.hint')}</span></span>}
        footer={<Pager info={list.data ? { page: list.data.page, pageSize: list.data.pageSize, totalItems: list.data.total, totalPages: list.data.pages } : null} onPage={setPage} label={tx('prd.catalog')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading_products')}</div>
          : rows.length === 0 ? (filtered ? <Empty title={q ? tx('pos.no_products_match_search', { search: q }) : tx('prd.noMatches')}><button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button></Empty>
            : <Empty title={tx('pos.no_products_yet')}>{can('inventory.create') ? <button type="button" className="fk-btn primary" onClick={() => setAdding(true)}>{tx('pos.new_product_2')}</button> : null}</Empty>)
          : <table className="fk-table fn-table prd-table" data-testid="products-table">
            <thead><tr><th>{tx('pos.product')}</th><th>SKU</th><th className="t-opt">{tx('pos.brand_category')}</th><th className="num">{tx('pos.on_hand_2')}</th><th>{tx('pos.status')}</th><th className="num">{tx('pos.retail')}</th><th className="t-opt2">{tx('sa.col.lastUsed')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id} data-testid="product-row" className={p.archivedAt ? 'sa-acked' : ''}>
                <td><button type="button" className="fk-li-t link" onClick={() => setDetail(p.id)} data-testid="product-name">{p.name}</button><span className="fk-li-s">{[p.colorNumber ? '#' + p.colorNumber : null, p.colorName].filter(Boolean).join(' · ') || (p.barcode ?? '')}</span></td>
                <td>{p.sku ?? <span className="fk-muted">—</span>}</td>
                <td className="t-opt">{[p.brand, p.category].filter(Boolean).join(' · ') || <span className="fk-muted">—</span>}</td>
                <td className="num"><b>{fmtNumber(p.onHand)}</b><span className="fk-li-s">{unitLabel(p.unit)}{p.stockDrift ? ' · ' + tx('prd.recountNeeded') : ''}</span></td>
                <td>{p.archivedAt ? <span className="fk-chip mut">{tx('inv.archived')}</span> : <StockChip severity={p.severity} testId="status-chip" />}</td>
                <td className="num">{p.retailCents != null ? money(p.retailCents) : <span className="fk-muted">—</span>}</td>
                <td className="t-opt2"><LastUsed r={p} testId="last-used" /></td>
                <td className="fn-acts">
                  <button type="button" className="fk-btn ghost sm" onClick={() => setDetail(p.id)} data-testid="details">{tx('prd.details')}</button>
                  {!p.archivedAt && can('inventory.stock.add') ? <button type="button" className="fk-btn ghost sm" onClick={() => setStockFor(p)} disabled={busy === p.id} data-testid="add-stock">{tx('pos.add_stock_2')}</button> : null}
                  {!p.archivedAt && can('inventory.archive') ? <button type="button" className="fk-btn ghost sm" onClick={() => setArchiveFor(p)} disabled={busy === p.id} data-testid="archive">{tx('pos.archive')}</button> : null}
                  {p.archivedAt && can('inventory.archive') ? <button type="button" className="fk-btn ghost sm" onClick={() => restore(p)} disabled={busy === p.id} data-testid="restore">{tx('inv.restore')}</button> : null}
                </td>
              </tr>))}</tbody>
          </table>}
      </FitPanel>
      {detail ? <ProductDetailsDialog productId={detail} can={can} onClose={() => setDetail(null)} onChanged={refresh}
        onEdit={(p) => { setDetail(null); setEditing(p.id); }} onAddStock={(p) => { setDetail(null); setStockFor(p); }} onRecordUse={(id) => { setDetail(null); setRecording(id); }} onReorder={reorder} /> : null}
      {adding ? <ProductFormDialog onClose={() => setAdding(false)} onSaved={created} /> : null}
      {editing ? <EditProductDialog productId={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); refresh(); setNote({ tone: 'ok', text: tx('prd.saved'), productId: id }); }} /> : null}
      {stockFor ? <AddStockDialog product={stockFor} onClose={() => setStockFor(null)} onSaved={() => { const n = stockFor.name; setStockFor(null); refresh(); setNote({ tone: 'ok', text: tx('prd.stockAdded', { n }), productId: stockFor.id }); }} /> : null}
      {recording ? <RecordUseDialog productId={recording} canOnBehalf={can('inventory.stock.adjust')} onClose={() => setRecording(null)} onDone={() => { setRecording(null); refresh(); setNote({ tone: 'ok', text: tx('prd.useRecorded') }); }} /> : null}
      {archiveFor ? <FitDialog title={tx('prd.archiveTitle', { n: archiveFor.name })} busy={busy === archiveFor.id} onClose={() => setArchiveFor(null)} testId="archive-confirm"
        footer={<><button type="button" className="fk-btn" onClick={() => setArchiveFor(null)}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={() => archive(archiveFor)} disabled={busy === archiveFor.id} data-testid="confirm-archive">{tx('pos.archive')}</button></>}>
        <p>{tx('prd.archiveBody')}</p>{archiveFor.onHand > 0 ? <div className="fk-note warn"><span>{tx('prd.archiveStock', { n: fmtNumber(archiveFor.onHand) })}</span></div> : null}
      </FitDialog> : null}
    </div>
  );
}
