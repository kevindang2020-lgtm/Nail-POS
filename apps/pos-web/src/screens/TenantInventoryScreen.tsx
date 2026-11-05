// TenantInventoryScreen.tsx — Inventory Overview. Summary cards, product list with stock status + bottle
// counts, Add Product / Add Stock, per-product bottle drawer (open / mark empty / mark damaged), and the
// pending technician-report queue with approve/reject. All data is tenant+branch scoped server-side.
import { useEffect, useMemo, useState } from 'react';
import { useInlineConfirm, useEventCallback } from '@aipowersalon/ui';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { useSearchParams } from 'react-router-dom';
import { inventoryApi, type InvSummary, type InvProduct, type InvUnit, type TechReport, type PurchaseOrderSummary, type PurchaseOrderLine, type InvVendor, type InvCategory, type InvBrand, type TransferSummary, type TransferBranch, type CountSummary, type CountDetail, type RecipeServiceSummary, type ServiceRecipe, type StockAlert } from '../api/inventoryApi';
import { colorContrastWarning, readableTextColor } from '../lib/contrast';
import { AiAssistantPanel } from '../components/AiAssistantPanel';
import { posAiApi, type ParsedReceipt } from '../api/posAiApi';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';

import { statusLabel } from '../i18n/status-label';
import { codeLabel } from '../components/codeLabel';
import { fmtMoney, fmtYmd, fmtDateTime } from '../i18n/format';
const money = (c?: number | null) => (c == null ? '—' : fmtMoney(c));
const STATUS_TONE: Record<string, string> = { in_stock: 'ok', low: 'orange', critical: 'red', out_of_stock: 'red', overstock: 'blue' };

function Pill({ status }: { status: string }) {
  return <span className={`inv-pill ${STATUS_TONE[status] || 'mut'}`}>{statusLabel('stock', status)}</span>;
}

export function TenantInventoryScreen() {
  const [summary, setSummary] = useState<InvSummary | null>(null);
  const [products, setProducts] = useState<InvProduct[]>([]);
  const [reports, setReports] = useState<TechReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Deep-linkable tab: /tenant/inventory?tab=reports (used by the topbar notification bell) — invalid values fall back to products.
  const [params, setParams] = useSearchParams();
  const TABS = ['products', 'reports', 'purchaseOrders', 'transfers', 'counts', 'catalog', 'recipes', 'alerts'] as const;
  type Tab = (typeof TABS)[number];
  const initialTab: Tab = (TABS as readonly string[]).includes(params.get('tab') || '') ? (params.get('tab') as Tab) : 'products';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [stockFor, setStockFor] = useState<InvProduct | null>(null);
  const [openProduct, setOpenProduct] = useState<InvProduct | null>(null);
  const [thresholdFor, setThresholdFor] = useState<InvProduct | null>(null);

  const load = useEventCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, p, r] = await Promise.all([inventoryApi.summary(), inventoryApi.products(search ? { search } : undefined), inventoryApi.reports('pending')]);
      setSummary(s?.summary ?? null); setProducts(p?.products ?? []); setReports(r?.reports ?? []);
      try { setAlertCount((await inventoryApi.alertFeed()).openCount); } catch { /* alerts are non-critical */ }
    } catch (e: any) { setError(e?.message || tx('pos.could_not_load_inventory')); }
    finally { setLoading(false); }
  });
  useEffect(() => { void load();   }, [load]);
  // Deep-link from the Overview "Add Product" quick action: open the Add Product modal directly, then clear the param.
  useEffect(() => {
    if (params.get('add') === '1') {
      setAdding(true);
      const sp = new URLSearchParams(params); sp.delete('add'); setParams(sp, { replace: true });
    }
  }, [params, setParams]);

  const cards: [string, string | number, string][] = summary ? [
    [tx('pos.products'), summary.totalProducts, 'mut'], [tx('admin.inventory.kpi.bottles'), summary.totalBottles, 'mut'],
    [tx('status.stock.opened'), summary.openBottles, 'blue'], [tx('status.stock.unopened'), summary.unopenedBottles, 'ok'],
    [tx('status.stock.low_stock'), summary.lowStock, summary.lowStock ? 'orange' : 'mut'],
    [tx('pos.out_of_stock'), summary.outOfStock, summary.outOfStock ? 'red' : 'mut'],
    [tx('admin.inventory.kpi.expiringSoon'), summary.expiringSoon, summary.expiringSoon ? 'orange' : 'mut'],
    [tx('admin.inventory.kpi.pendingReports'), summary.pendingReports, summary.pendingReports ? 'orange' : 'mut'],
    ...(summary.inventoryValueCents != null ? [[tx('admin.inventory.kpi.value'), money(summary.inventoryValueCents), 'ok'] as [string, string, string]] : []),
  ] : [];

  return (
    <div className="work inv-work">
      <div className="inv-head flex flex-col xl:flex-row gap-3 justify-between items-start xl:items-center">
        <div>
          <h1>{tx('pos.inventory')}</h1>
          <p className="sub">{tx('pos.track_salon_products_bottles_colors_usage_1gi5')}</p>
        </div>
        <div className="inv-actions">
          <button className="btn ghost" onClick={() => load()}>{tx('pos.refresh')}</button>
          <button className="btn ghost" onClick={() => setScanning(true)}>{tx('pos.scan_receipt')}</button>
          <button className="btn primary" onClick={() => setAdding(true)}>{tx('pos.add_product')}</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2.5 mb-3.5 mt-2.5">
        {cards.map(([l, v, t]) => (<div key={l} className={`inv-kpi ${t}`} style={{ margin: 0, width: '100%' }}><div className="ik-v">{v}</div><div className="ik-l">{l}</div></div>))}
      </div>

      <AiAssistantPanel packageCode="ai_inventory_assistant" cta={tx('pos.suggest_reorders')} action="reorder" buildPrompt={() => {
        const needs = products.filter((p) => p.status === 'low' || p.status === 'critical' || p.status === 'out_of_stock').slice(0, 25)
          .map((p) => tx('pos.name_onhand_on_hand_v2_v3', { name: String(p.name), onHand: String(p.onHand), v2: String(p.reorderSuggestion > 0 ? tx('pos.suggest_reorder_reordersuggestion', { reorderSuggestion: String(p.reorderSuggestion) }) : ''), v3: statusLabel('stock', p.status) })).join('; ');
        return tx('pos.nail_salon_inventory_v0_items_needing_14tm', { v0: String(summary ? tx('pos.lowstock_low_outofstock_out_of_stock', { lowStock: String(summary.lowStock), outOfStock: String(summary.outOfStock) }) : ''), v1: String(needs || tx('pos.none_currently')) });
      }} />

      <div className="inv-tabs overflow-x-auto whitespace-nowrap flex overflow-y-hidden">
        <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>{tx('pos.all_inventory')}</button>
        <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>{tx('pos.technician_reports')}{summary?.pendingReports ? ` (${summary.pendingReports})` : ''}</button>
        <button className={tab === 'purchaseOrders' ? 'active' : ''} onClick={() => setTab('purchaseOrders')}>{tx('pos.purchase_orders')}</button>
        <button className={tab === 'transfers' ? 'active' : ''} onClick={() => setTab('transfers')}>{tx('pos.transfers')}</button>
        <button className={tab === 'counts' ? 'active' : ''} onClick={() => setTab('counts')}>{tx('pos.counts')}</button>
        <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>{tx('pos.catalog')}</button>
        <button className={tab === 'recipes' ? 'active' : ''} onClick={() => setTab('recipes')}>{tx('pos.recipes')}</button>
        <button className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}>{tx('pos.alerts')}{alertCount ? ` (${alertCount})` : ''}</button>
      </div>

      {error && <div className="inv-err">{error}</div>}

      {tab === 'products' && (
        <>
          <div className="inv-search flex flex-col sm:flex-row gap-2">
            <ImeSafeInput value={search} onValue={setSearch} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} placeholder={tx('pos.search_name_color_number_sku_barcode')} className="flex-1 w-full sm:w-auto" style={{ padding: '8px 12px' }} />
            <button className="btn w-full sm:w-auto" onClick={() => load()}>{tx('pos.search')}</button>
          </div>
          {loading ? <div className="inv-empty">{tx('pos.loading_inventory')}</div>
            : products.length === 0 ? <div className="inv-empty">{tx('pos.no_products_yet_add_your_first_1ncj')}</div>
            : (
              <div className="overflow-x-auto">
                <div className="min-w-[800px]">
                  <div className="inv-table">
                    <div className="it-head"><span>{tx('pos.product')}</span><span>{tx('pos.on_hand')}</span><span>{tx('pos.bottles_2')}</span><span>{tx('pos.status')}</span><span></span></div>
                    {products.map((p) => (
                      <div key={p.id} className="it-row">
                        <span className="it-name">
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {p.button_color && <span title={tx('pos.button_color')} style={{ width: 11, height: 11, borderRadius: 3, background: p.button_color, flex: '0 0 auto', border: '1px solid rgba(0,0,0,0.12)' }} />}
                            {p.image_url && <img src={p.image_url} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover', flex: '0 0 auto' }} />}
                            <b>{p.name}</b>
                          </span>
                          <small>{[p.brand_name, p.color_number && `#${p.color_number}`, p.color_name, p.finish].filter(Boolean).join(' · ') || p.category_name || '—'}</small>
                        </span>
                        <span className="it-onhand">{p.onHand}{p.reorderSuggestion > 0 && <em className="it-sug">{tx('pos.reorder_3')}{' '}{p.reorderSuggestion}</em>}</span>
                        <span className="it-bottles">
                          <span title={tx('pos.unopened')} className="bdot ok">{p.quantity_unopened ?? 0}</span>
                          <span title={tx('pos.open_4')} className="bdot blue">{p.quantity_open ?? 0}</span>
                          <span title={tx('pos.empty')} className="bdot mut">{p.quantity_empty ?? 0}</span>
                        </span>
                        <span><Pill status={p.status} /></span>
                        <span className="it-act whitespace-nowrap">
                          <button className="btn sm " onClick={() => setStockFor(p)}>{tx('pos.add_stock_2')}</button>
                          <button className="btn sm ghost" onClick={() => setOpenProduct(p)}>{tx('pos.bottles_2')}</button>
                          <button className="btn sm ghost" onClick={() => setThresholdFor(p)}>{tx('pos.edit')}</button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
        </>
      )}

      {tab === 'reports' && <ReportsTab reports={reports} onChange={load} />}
      {tab === 'purchaseOrders' && <PurchaseOrdersTab products={products} onChange={load} />}
      {tab === 'transfers' && <TransfersTab products={products} onChange={load} />}
      {tab === 'counts' && <CountsTab onChange={load} />}
      {tab === 'catalog' && <CatalogTab onChange={load} />}
      {tab === 'recipes' && <RecipesTab products={products} onChange={load} />}
      {tab === 'alerts' && <AlertsTab onChange={load} />}

      {adding && <AddProductModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {scanning && <ReceiptScanModal onClose={() => setScanning(false)} onSaved={() => { setScanning(false); }} />}
      {stockFor && <AddStockModal product={stockFor} onClose={() => setStockFor(null)} onSaved={() => { setStockFor(null); load(); }} />}
      {openProduct && <BottlesDrawer product={openProduct} onClose={() => setOpenProduct(null)} onChange={load} />}
      {thresholdFor && <ProductEditModal product={thresholdFor} onClose={() => setThresholdFor(null)} onSaved={() => { setThresholdFor(null); load(); }} />}
    </div>
  );
}

function ReportsTab({ reports, onChange }: { reports: TechReport[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, fn: () => Promise<any>) => { setBusy(id); try { await fn(); onChange(); } finally { setBusy(null); } };
  if (reports.length === 0) return <div className="inv-empty">{tx('pos.no_pending_technician_reports')}</div>;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px]">
        <div className="inv-table">
          <div className="it-head"><span>{tx('pos.product')}</span><span>{tx('pos.issue')}</span><span>{tx('pos.note')}</span><span></span></div>
          {reports.map((r) => (
            <div key={r.id} className="it-row">
              <span className="it-name"><b>{r.product_name}</b><small>{r.color_number ? `#${r.color_number}` : ''}</small></span>
              <span><span className="inv-pill orange">{statusLabel('inventoryReport', r.report_type)}</span></span>
              <span className="it-note">{r.note || '—'}</span>
              <span className="it-act">
                <button className="btn sm primary" disabled={busy === r.id} onClick={() => act(r.id, () => inventoryApi.approveReport(r.id))}>{tx('pos.approve')}</button>
                <button className="btn sm ghost" disabled={busy === r.id} onClick={() => act(r.id, () => inventoryApi.rejectReport(r.id))}>{tx('pos.reject')}</button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddProductModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ name: '', brandName: '', colorName: '', colorNumber: '', finish: '', sku: '', reorderLevel: 3, reorderQuantity: 6, costDollars: '', trackingMode: 'bottle' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) { setError(tx('pos.product_name_is_required_2')); return; }
    try {
      await inventoryApi.createProduct({
        name: f.name.trim(), colorName: f.colorName || null, colorNumber: f.colorNumber || null, finish: f.finish || null,
        sku: f.sku || null, reorderLevel: Number(f.reorderLevel) || 0, reorderQuantity: Number(f.reorderQuantity) || 0,
        costCents: f.costDollars ? (parseDollarsToCents(f.costDollars) ?? 0) : null, trackingMode: f.trackingMode,
      });
      onSaved();
    } catch (e: any) { setError(e?.message || tx('pos.could_not_create_product')); }
  };
  return (
    <div className="inv-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal">
        <div className="im-h">{tx('pos.add_product_2')}</div>
        <div className="im-b">
          {error && <div className="inv-err">{error}</div>}
          <label className="if"><span>{tx('pos.product_name')}</span><input value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder={tx('pos.e_g_dnd_gel_polish_428')} /></label>
          <div className="if-row">
            <label className="if"><span>{tx('pos.color_number')}</span><input value={f.colorNumber} onChange={(e) => set('colorNumber')(e.target.value)} placeholder="428" /></label>
            <label className="if"><span>{tx('pos.color_name')}</span><input value={f.colorName} onChange={(e) => set('colorName')(e.target.value)} placeholder={tx('pos.cherry_mocha')} /></label>
          </div>
          <div className="if-row">
            <label className="if"><span>{tx('pos.finish')}</span><input value={f.finish} onChange={(e) => set('finish')(e.target.value)} placeholder={tx('pos.gloss')} /></label>
            <label className="if"><span>SKU</span><input value={f.sku} onChange={(e) => set('sku')(e.target.value)} placeholder={tx('pos.dnd_428')} /></label>
          </div>
          <div className="if-row">
            <label className="if"><span>{tx('pos.reorder_level')}</span><input value={f.reorderLevel} onChange={(e) => set('reorderLevel')(e.target.value)} inputMode="numeric" /></label>
            <label className="if"><span>{tx('pos.reorder_qty')}</span><input value={f.reorderQuantity} onChange={(e) => set('reorderQuantity')(e.target.value)} inputMode="numeric" /></label>
            <label className="if"><span>{tx('pos.cost_3')}</span><input value={f.costDollars} onChange={(e) => set('costDollars')(e.target.value)} inputMode="decimal" placeholder="4.50" /></label>
          </div>
          <label className="if"><span>{tx('pos.tracking')}</span><select value={f.trackingMode} onChange={(e) => set('trackingMode')(e.target.value)}><option value="bottle">{tx('pos.individual_bottles')}</option><option value="quantity">{tx('pos.quantity_only')}</option></select></label>
        </div>
        <div className="im-f"><button className="btn ghost" onClick={onClose}>{tx('pos.cancel')}</button><button className="btn primary" onClick={save}>{tx('pos.create_product')}</button></div>
      </div>
    </div>
  );
}

function AddStockModal({ product, onClose, onSaved }: { product: InvProduct; onClose: () => void; onSaved: () => void }) {
  const [qty, setQty] = useState('6'); const [lot, setLot] = useState(''); const [exp, setExp] = useState(''); const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const n = parseInt(qty, 10);
    if (!n || n < 1) { setError(tx('pos.enter_a_quantity_of_at_least_1w0l')); return; }
    try { await inventoryApi.addStock(product.id, { quantity: n, lotNumber: lot || null, expirationDate: exp || null }); onSaved(); }
    catch (e: any) { setError(e?.message || tx('pos.could_not_add_stock_2')); }
  };
  return (
    <div className="inv-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal">
        <div className="im-h">{tx('pos.add_stock')}{' '}{product.name}</div>
        <div className="im-b">
          {error && <div className="inv-err">{error}</div>}
          <label className="if"><span>{tx('pos.number_of_bottles_units')}</span><input autoFocus value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" /></label>
          <div className="if-row">
            <label className="if"><span>{tx('pos.lot_number')}</span><input value={lot} onChange={(e) => setLot(e.target.value)} placeholder={tx('pos.optional_3')} /></label>
            <label className="if"><span>{tx('pos.expiration')}</span><input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
          </div>
        </div>
        <div className="im-f"><button className="btn ghost" onClick={onClose}>{tx('pos.cancel')}</button><button className="btn primary" onClick={save}>{tx('pos.add_to_inventory')}</button></div>
      </div>
    </div>
  );
}

function BottlesDrawer({ product, onClose, onChange }: { product: InvProduct; onClose: () => void; onChange: () => void }) {
  const [units, setUnits] = useState<InvUnit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useEventCallback(async () => { const r = await inventoryApi.product(product.id); setUnits(r?.units ?? []); });
  useEffect(() => { void refresh();   }, [refresh]);
  const act = async (id: string, fn: () => Promise<any>) => { setBusy(id); try { await fn(); await refresh(); onChange(); } finally { setBusy(null); } };
  const grouped = useMemo(() => units || [], [units]);
  return (
    <div className="inv-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal wide">
        <div className="im-h">{tx('pos.bottles_3')}{' '}{product.name}</div>
        <div className="im-b">
          {!units ? <div className="inv-empty">{tx('pos.loading_bottles')}</div>
            : grouped.length === 0 ? <div className="inv-empty">{tx('pos.no_bottles_yet_add_stock_to_1apw')}</div>
            : (
              <div className="overflow-x-auto">
                <div className="min-w-[500px]">
                  <div className="bottle-list">
                    {grouped.map((u) => (
                      <div key={u.id} className="bottle-row">
                        <span className={`inv-pill ${u.status === 'unopened' ? 'ok' : u.status === 'empty' || u.status === 'damaged' ? 'mut' : 'blue'}`}>{statusLabel('stock', u.status)}</span>
                        <span className="br-meta">{[u.lot_number && tx('admin.inventory.lot', { lot: String(u.lot_number) }), u.expiration_date && tx('admin.inventory.exp', { date: fmtYmd(String(u.expiration_date), { month: 'short', day: 'numeric', year: 'numeric' }, String(u.expiration_date)) })].filter(Boolean).join(' · ') || u.internal_barcode || '—'}</span>
                        <span className="br-act">
                          {u.status === 'unopened' && <button className="btn sm" disabled={busy === u.id} onClick={() => act(u.id, () => inventoryApi.openUnit(u.id))}>{tx('pos.open')}</button>}
                          {(u.status === 'opened' || u.status === 'low') && <button className="btn sm" disabled={busy === u.id} onClick={() => act(u.id, () => inventoryApi.markEmpty(u.id))}>{tx('pos.mark_empty')}</button>}
                          {(u.status === 'opened') && <button className="btn sm ghost" disabled={busy === u.id} onClick={() => act(u.id, () => inventoryApi.markLow(u.id))}>{tx('pos.low')}</button>}
                          {(u.status === 'unopened' || u.status === 'opened' || u.status === 'low') && <button className="btn sm ghost" disabled={busy === u.id} onClick={() => act(u.id, () => inventoryApi.markDamaged(u.id))}>{tx('pos.damaged')}</button>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
        </div>
        <div className="im-f"><button className="btn ghost" onClick={onClose}>{tx('pos.close')}</button></div>
      </div>
    </div>
  );
}

// ---- Purchase Orders (§18) — list, create (vendor + product lines), approve, receive, cancel ----
const PO_TONE: Record<string, string> = { draft: 'mut', approved: 'blue', ordered: 'blue', partial: 'orange', received: 'ok', cancelled: 'red', closed: 'mut' };
const PO_GRID = { gridTemplateColumns: '1.3fr 1.2fr .8fr .9fr .9fr 1.4fr' } as const;

function PurchaseOrdersTab({ products, onChange }: { products: InvProduct[]; onChange: () => void }) {
  const [pos, setPos] = useState<PurchaseOrderSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [receiveFor, setReceiveFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => { setErr(null); try { const r = await inventoryApi.purchaseOrders(); setPos(r?.purchaseOrders ?? []); } catch (e: any) { setErr(e?.message || tx('pos.could_not_load_purchase_orders')); } };
  useEffect(() => { void load();   }, []);
  const act = async (id: string, fn: () => Promise<any>) => { setBusy(id); setErr(null); try { await fn(); await load(); onChange(); } catch (e: any) { setErr(e?.message || tx('pos.action_failed_2')); } finally { setBusy(null); } };
  return (
    <>
      <div className="inv-search" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={() => setCreating(true)} disabled={products.length === 0}>{tx('pos.new_purchase_order_2')}</button>
      </div>
      {products.length === 0 && <div className="inv-empty">{tx('pos.add_at_least_one_product_before_kumk')}</div>}
      {err && <div className="inv-err">{err}</div>}
      {!pos ? <div className="inv-empty">{tx('pos.loading_purchase_orders')}</div>
        : pos.length === 0 ? <div className="inv-empty">{tx('pos.no_purchase_orders_yet_create_one_y12v')}</div>
        : (
          <div className="inv-table">
            <div className="it-head" style={PO_GRID}><span>PO</span><span>{tx('pos.vendor')}</span><span>{tx('pos.received')}</span><span>{tx('pos.total')}</span><span>{tx('pos.status')}</span><span></span></div>
            {pos.map((po) => (
              <div key={po.id} className="it-row" style={PO_GRID}>
                <span className="it-name"><b>{po.po_number || po.id.slice(0, 8)}</b><small>{new Date(po.created_at).toLocaleDateString()}</small></span>
                <span style={{ color: 'var(--muted,#8A7A66)', fontSize: 13 }}>{po.vendor_name || '—'}</span>
                <span className="it-onhand">{po.qty_received}/{po.qty_ordered}</span>
                <span>{po.total_cents != null ? money(po.total_cents) : '—'}</span>
                <span><span className={`inv-pill ${PO_TONE[po.status] || 'mut'}`}>{statusLabel('purchaseOrder', po.status)}</span></span>
                <span className="it-act">
                  {po.status === 'draft' && <button className="btn sm primary" disabled={busy === po.id} onClick={() => act(po.id, () => inventoryApi.approvePurchaseOrder(po.id))}>{tx('pos.approve')}</button>}
                  {(po.status === 'approved' || po.status === 'ordered' || po.status === 'partial') && <button className="btn sm primary" disabled={busy === po.id} onClick={() => setReceiveFor(po.id)}>{tx('pos.receive')}</button>}
                  {(po.status === 'draft' || po.status === 'approved' || po.status === 'ordered' || po.status === 'partial') && <button className="btn sm ghost" disabled={busy === po.id} onClick={() => act(po.id, () => inventoryApi.cancelPurchaseOrder(po.id))}>{tx('pos.cancel')}</button>}
                </span>
              </div>
            ))}
          </div>
        )}
      {creating && <CreatePOModal products={products} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); onChange(); }} />}
      {receiveFor && <ReceivePOModal poId={receiveFor} onClose={() => setReceiveFor(null)} onSaved={() => { setReceiveFor(null); load(); onChange(); }} />}
    </>
  );
}

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
  const save = async () => {
    const clean = lines.filter((l) => l.productId && (parseInt(l.quantity, 10) || 0) > 0);
    if (clean.length === 0) { setError(tx('pos.add_at_least_one_product_line_rsup')); return; }
    setSaving(true); setError(null);
    try {
      await inventoryApi.createPurchaseOrder({
        vendorId: vendorId || null, expectedDate: expectedDate || null, shippingCents: (parseDollarsToCents(shipping) ?? 0),
        lines: clean.map((l) => ({ productId: l.productId, quantityOrdered: parseInt(l.quantity, 10) || 0, unitCostCents: (parseDollarsToCents(l.costDollars) ?? 0) })),
      });
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
  const save = async () => {
    const payload = (lines || [])
      .map((l) => ({ lineId: l.id, quantity: parseInt(recv[l.id]?.quantity || '0', 10) || 0, lotNumber: recv[l.id]?.lot || undefined, expirationDate: recv[l.id]?.exp || undefined }))
      .filter((x) => x.quantity > 0);
    if (payload.length === 0) { setError(tx('pos.enter_a_quantity_to_receive_on_1h96')); return; }
    setSaving(true); setError(null);
    try { await inventoryApi.receivePurchaseOrder(poId, { lines: payload }); onSaved(); }
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

// ---- Branch Transfers (§19) — list + create (destination branch + product/qty lines) ----
const T_TONE: Record<string, string> = { completed: 'ok', cancelled: 'red' };
const T_GRID = { gridTemplateColumns: '1.2fr 1.6fr .9fr .8fr .9fr' } as const;

function TransfersTab({ products, onChange }: { products: InvProduct[]; onChange: () => void }) {
  const [rows, setRows] = useState<TransferSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => { setErr(null); try { const r = await inventoryApi.transfers(); setRows(r?.transfers ?? []); } catch (e: any) { setErr(e?.message || tx('pos.could_not_load_transfers')); } };
  useEffect(() => { void load();   }, []);
  return (
    <>
      <div className="inv-search" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={() => setCreating(true)} disabled={products.length === 0}>{tx('pos.new_transfer')}</button>
      </div>
      {products.length === 0 && <div className="inv-empty">{tx('pos.add_at_least_one_product_before_v51s')}</div>}
      {err && <div className="inv-err">{err}</div>}
      {!rows ? <div className="inv-empty">{tx('pos.loading_transfers')}</div>
        : rows.length === 0 ? <div className="inv-empty">{tx('pos.no_transfers_yet_move_stock_to_rh20')}</div>
        : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="inv-table">
                <div className="it-head" style={T_GRID}><span>{tx('pos.transfer')}</span><span>{tx('pos.route')}</span><span>{tx('pos.moved')}</span><span>{tx('pos.status')}</span><span>{tx('pos.date')}</span></div>
                {rows.map((t) => (
                  <div key={t.id} className="it-row" style={T_GRID}>
                    <span className="it-name"><b>{t.transfer_number || t.id.slice(0, 8)}</b><small>{t.outbound ? tx('pos.outbound') : tx('pos.inbound')}</small></span>
                    <span style={{ fontSize: 13 }}>{t.from_branch_name || '—'} <span style={{ color: 'var(--muted,#8A7A66)' }}>→</span> {t.to_branch_name || '—'}</span>
                    <span className="it-onhand">{t.unit_count} {tx('pos.unit_2')}{enPlural(t.unit_count === 1 ? '' : 's')}<em className="it-sug" style={{ display: 'block' }}>{t.item_count} {tx('pos.item')}{enPlural(t.item_count === 1 ? '' : 's')}</em></span>
                    <span><span className={`inv-pill ${T_TONE[t.status] || 'mut'}`}>{codeLabel('admin.inventory.transfer', t.status, ['appointment', 'refund'])}</span></span>
                    <span style={{ fontSize: 12.5, color: 'var(--muted,#8A7A66)' }}>{new Date(t.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      {creating && <CreateTransferModal products={products} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); onChange(); }} />}
    </>
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

// ===== Physical Inventory Counts (§20) =====
const C_GRID = { gridTemplateColumns: '1.3fr 1.1fr 0.8fr 0.9fr 0.9fr' } as const;
const CL_GRID = { gridTemplateColumns: '2fr 1fr 1fr 1fr' } as const;
const C_TONE: Record<string, string> = { in_progress: 'warn', submitted: 'mut', reconciled: 'ok', cancelled: 'mut' };

function CountsTab({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<CountSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => { setErr(null); try { const r = await inventoryApi.counts(); setRows(r?.counts ?? []); } catch (e: any) { setErr(e?.message || tx('pos.could_not_load_counts')); } };
  useEffect(() => { void load();   }, []);
  return (
    <>
      <div className="inv-search" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={() => setCreating(true)}>{tx('pos.new_count')}</button>
      </div>
      {err && <div className="inv-err">{err}</div>}
      {!rows ? <div className="inv-empty">{tx('pos.loading_counts')}</div>
        : rows.length === 0 ? <div className="inv-empty">{tx('pos.no_counts_yet_start_a_physical_xyef')}</div>
        : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="inv-table">
                <div className="it-head" style={C_GRID}><span>{tx('pos.count')}</span><span>{tx('pos.scope')}</span><span>{tx('pos.counted')}</span><span>{tx('pos.status')}</span><span>{tx('pos.variance')}</span></div>
                {rows.map((c) => (
                  <div key={c.id} className="it-row" style={{ ...C_GRID, cursor: 'pointer' }} onClick={() => setOpenId(c.id)}>
                    <span className="it-name"><b>{c.count_number || c.id.slice(0, 8)}</b><small>{new Date(c.created_at).toLocaleDateString()}</small></span>
                    <span style={{ fontSize: 13 }}>{c.scope_label}</span>
                    <span className="it-onhand">{c.counted_count}/{c.line_count}</span>
                    <span><span className={`inv-pill ${C_TONE[c.status] || 'mut'}`}>{codeLabel('admin.inventory.count', c.status, 'drawer')}</span></span>
                    <span style={{ fontSize: 13 }}>{c.status === 'reconciled' ? tx('pos.variance_units_unit_plural', { variance_units: String(c.variance_units), plural: String(c.variance_units === 1 ? '' : 's') }) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      {creating && <CreateCountModal onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); void load(); onChange(); setOpenId(id); }} />}
      {openId && <CountEntryModal id={openId} onClose={() => setOpenId(null)} onChanged={() => { void load(); onChange(); }} />}
    </>
  );
}

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

// ===== Catalog editors: Categories / Brands / Vendors (create · edit · archive) =====
function CatalogTab({ onChange }: { onChange: () => void }) {
  const [cats, setCats] = useState<InvCategory[] | null>(null);
  const [brands, setBrands] = useState<InvBrand[] | null>(null);
  const [vendors, setVendors] = useState<InvVendor[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: 'category' | 'brand' | 'vendor'; item: any | null } | null>(null);
  const load = async () => { setErr(null); try { const [c, b, v] = await Promise.all([inventoryApi.categories(), inventoryApi.brands(), inventoryApi.vendors()]); setCats(c?.categories ?? []); setBrands(b?.brands ?? []); setVendors(v?.vendors ?? []); } catch (e: any) { setErr(e?.message || tx('pos.could_not_load_catalog')); } };
  useEffect(() => { void load();   }, []);
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const archive = (kind: 'category' | 'brand' | 'vendor', id: string, name: string) => askConfirm(tx('admin.inventory.confirmArchiveTag', { name }), () => { void doArchive(kind, id, name); }, { confirmLabel: tx('pos.archive') });
  const doArchive = async (kind: 'category' | 'brand' | 'vendor', id: string, name: string) => {
    const fn = kind === 'category' ? inventoryApi.archiveCategory : kind === 'brand' ? inventoryApi.archiveBrand : inventoryApi.archiveVendor;
    try { const r: any = await fn(id); await load(); onChange(); if (r?.productsAffected) setErr(tx('admin.inventory.archivedTag', { name, count: String(r.productsAffected) })); }
    catch (e: any) { setErr(e?.message || tx('pos.could_not_archive')); }
  };
  const section = (title: string, kind: 'category' | 'brand' | 'vendor', rows: any[] | null, meta: (x: any) => React.ReactNode) => (
    <div style={{ marginBottom: 20 }}>
      <div className="inv-search" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontFamily: '"Playfair Display", serif', fontSize: 17 }}>{title}</h3>
        <button className="btn primary" onClick={() => setEditing({ kind, item: null })}>{tx('pos.add_2')}</button>
      </div>
      {!rows ? <div className="inv-empty">{tx('pos.loading')}</div>
        : rows.length === 0 ? <div className="inv-empty">{tx('pos.none_yet')}</div>
        : (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="inv-table">
                {rows.map((x) => (
                  <div key={x.id} className="it-row" style={{ gridTemplateColumns: '1.6fr 1.4fr auto' }}>
                    <span className="it-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {kind === 'category' && <span style={{ width: 14, height: 14, borderRadius: 4, background: x.display_color || 'transparent', border: '1px solid #E7DCC8', flex: '0 0 auto' }} />}
                      <b>{x.name}</b>
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--muted,#8A7A66)' }}>{meta(x)}</span>
                    <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn" onClick={() => setEditing({ kind, item: x })}>{tx('pos.edit')}</button>
                      <button className="btn" onClick={() => archive(kind, x.id, x.name)}>{tx('pos.archive')}</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
    </div>
  );
  return (
    <>
      {confirmUi}
      {err && <div className="inv-err">{err}</div>}
      {section(tx('pos.categories'), 'category', cats, (x) => [x.tracking_mode === 'bottle' ? tx('admin.inventory.bottleTracked') : tx('pos.quantity'), x.code].filter(Boolean).join(' · '))}
      {section(tx('pos.brands'), 'brand', brands, (x) => [x.code, x.website].filter(Boolean).join(' · ') || '—')}
      {section(tx('pos.vendors'), 'vendor', vendors, (x) => [x.contact_name, x.phone, x.account_number ? tx('pos.acct_account_number', { account_number: String(x.account_number) }) : ''].filter(Boolean).join(' · ') || '—')}
      {editing && <CatalogEditModal kind={editing.kind} item={editing.item} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); onChange(); }} />}
    </>
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

// ===== Service Recipes (§13): products a service consumes =====
function RecipesTab({ products, onChange }: { products: InvProduct[]; onChange: () => void }) {
  const [rows, setRows] = useState<RecipeServiceSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => { setErr(null); try { const r = await inventoryApi.recipeServices(); setRows(r?.services ?? []); } catch (e: any) { setErr(e?.message || tx('pos.could_not_load_services')); } };
  useEffect(() => { void load();   }, []);
  return (
    <>
      {err && <div className="inv-err">{err}</div>}
      {!rows ? <div className="inv-empty">{tx('pos.loading_services')}</div>
        : rows.length === 0 ? <div className="inv-empty">{tx('pos.no_active_services_yet_add_services_lz59')}</div>
        : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="inv-table">
                <div className="it-head" style={{ gridTemplateColumns: '2fr 1.3fr 0.9fr auto' }}><span>{tx('pos.service_3')}</span><span>{tx('pos.recipe')}</span><span>{tx('pos.price')}</span><span></span></div>
                {rows.map((s) => (
                  <div key={s.id} className="it-row" style={{ gridTemplateColumns: '2fr 1.3fr 0.9fr auto' }}>
                    <span className="it-name"><b>{s.name}</b></span>
                    <span style={{ fontSize: 13 }}>{s.recipe_lines === 0 ? <span style={{ color: 'var(--muted,#8A7A66)' }}>{tx('pos.no_recipe')}</span> : tx('pos.recipe_lines_product_plural_recipe_units_13hl', { recipe_lines: String(s.recipe_lines), plural: String(s.recipe_lines === 1 ? '' : 's'), recipe_units: String(s.recipe_units), plural2: String(s.recipe_units === 1 ? '' : 's') })}</span>
                    <span style={{ fontSize: 13 }}>{money(s.price_cents)}</span>
                    <span style={{ textAlign: 'right' }}><button className="btn" onClick={() => setOpenId(s.id)}>{s.recipe_lines ? tx('pos.edit_recipe') : tx('pos.add_recipe')}</button></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      {openId && <RecipeEditorModal serviceId={openId} products={products} onClose={() => setOpenId(null)} onSaved={() => { setOpenId(null); void load(); onChange(); }} />}
    </>
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
  const prodCost = (id: string): number => { const p = products.find((x) => x.id === id) as any; return (p?.cost_cents ?? recipe?.lines.find((l) => l.product_id === id)?.cost_cents ?? 0) || 0; };
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

// ===== Multi-level stock thresholds (§16) =====
function clientStockStatus(onHand: number, reorder: number, max: number | null, critical: number | null): string {
  if (onHand <= 0) return 'out_of_stock';
  const crit = critical != null && critical > 0 ? critical : (reorder > 0 ? Math.ceil(reorder / 2) : 0);
  if (crit > 0 && onHand <= crit) return 'critical';
  if (reorder > 0 && onHand <= reorder) return 'low';
  if (max && max > 0 && onHand > max) return 'overstock';
  return 'in_stock';
}

function ProductEditModal({ product, onClose, onSaved }: { product: InvProduct; onClose: () => void; onSaved: () => void }) {
  const [buttonColor, setButtonColor] = useState(product.button_color || '');
  const [imageUrl, setImageUrl] = useState(product.image_url || '');
  const [barcode, setBarcode] = useState(product.barcode || '');
  const [upc, setUpc] = useState(product.upc || '');
  const [reorder, setReorder] = useState(String(product.reorder_level ?? 0));
  const [critical, setCritical] = useState(product.critical_level != null ? String(product.critical_level) : '');
  const [qty, setQty] = useState(String(product.reorder_quantity ?? 0));
  const [max, setMax] = useState(product.maximum_stock != null ? String(product.maximum_stock) : '');
  const [leadTime, setLeadTime] = useState(product.lead_time_days != null ? String(product.lead_time_days) : '');
  const [vendorId, setVendorId] = useState(product.preferred_vendor_id || '');
  
  const [reorderOv, setReorderOv] = useState(product.reorder_level_override != null ? String(product.reorder_level_override) : '');
  const [criticalOv, setCriticalOv] = useState(product.critical_level_override != null ? String(product.critical_level_override) : '');
  const [qtyOv, setQtyOv] = useState(product.reorder_quantity_override != null ? String(product.reorder_quantity_override) : '');
  const [leadTimeOv, setLeadTimeOv] = useState(product.lead_time_days_override != null ? String(product.lead_time_days_override) : '');
  const [vendorIdOv, setVendorIdOv] = useState(product.preferred_vendor_id_override || '');

  const [vendors, setVendors] = useState<InvVendor[]>([]);
  useEffect(() => { inventoryApi.vendors().then(r => setVendors(r?.vendors ?? [])).catch(()=>setVendors([])); }, []);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (s: string): number | null => (s.trim() === '' ? null : parseInt(s, 10) || 0);
  const opt = (s: string) => (s.trim() === '' ? null : s.trim());
  const previewStatus = clientStockStatus(product.onHand, num(reorder) ?? 0, num(max), num(critical));
  const hexValid = /^#?[0-9a-f]{6}$/i.test(buttonColor.trim());
  const hex = buttonColor.trim().startsWith('#') ? buttonColor.trim() : '#' + buttonColor.trim();
  const colorWarn = hexValid ? colorContrastWarning(buttonColor) : null;
  const imgValid = /^https?:\/\//i.test(imageUrl.trim());
  const save = async () => {
    const r = num(reorder) ?? 0, c = num(critical), m = num(max);
    if (c != null && r > 0 && c > r) { setErr(tx('pos.critical_level_should_be_at_or_mtcr')); return; }
    if (imageUrl.trim() && !imgValid) { setErr(tx('pos.image_url_must_start_with_http_e6c1')); return; }
    setBusy(true); setErr(null);
    try {
      await inventoryApi.updateProduct(product.id, {
        buttonColor: buttonColor.trim() || null, imageUrl: imageUrl.trim() || null, barcode: barcode.trim() || null, upc: upc.trim() || null,
        reorderLevel: r, criticalLevel: c, reorderQuantity: num(qty) ?? 0, maximumStock: m,
        leadTimeDays: num(leadTime), preferredVendorId: opt(vendorId)
      });
      await inventoryApi.setStockOverrides(product.id, {
        reorderLevelOverride: opt(reorderOv), criticalLevelOverride: opt(criticalOv),
        reorderQuantityOverride: opt(qtyOv), leadTimeDaysOverride: opt(leadTimeOv),
        preferredVendorIdOverride: opt(vendorIdOv)
      });
      onSaved();
    } catch (e: any) { setErr(e?.message || tx('pos.could_not_save_changes')); setBusy(false); }
  };
  return (
    <div className="inv-ov" onClick={onClose}>
      <div className="inv-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="im-h"><h3>{tx('pos.edit_2')}{' '}{product.name}</h3><button onClick={onClose}>✕</button></div>
        <div className="im-b">
          <div style={{ fontWeight: 700, fontSize: 13, margin: '2px 0 8px' }}>{tx('pos.appearance_identifiers')}</div>
          <div className="if"><label className="if-l">{tx('pos.button_color_2')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="color" value={hexValid ? hex : '#A96F22'} onChange={(e) => setButtonColor(e.target.value)} style={{ width: 40, height: 32, padding: 0, border: '1px solid #E7DCC8', borderRadius: 8, background: 'none', cursor: 'pointer' }} />
              <input className="if-in" style={{ maxWidth: 140 }} value={buttonColor} placeholder="#A96F22" onChange={(e) => setButtonColor(e.target.value)} />
              {hexValid && <span style={{ padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: hex, color: readableTextColor(buttonColor) }}>{product.name.slice(0, 14)}</span>}
            </div>
          </div>
          {colorWarn && <div className="inv-err" style={{ background: '#FCEFE0', color: '#9A5B12', borderColor: '#EAD2AE' }}>{colorWarn}</div>}
          <div className="if"><label className="if-l">{tx('pos.image_url')}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input className="if-in" value={imageUrl} placeholder="https://…" onChange={(e) => setImageUrl(e.target.value)} />
              {imgValid && <img src={imageUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', border: '1px solid #E7DCC8', flex: '0 0 auto' }} />}
            </div>
          </div>
          <div className="if-row">
            <div className="if"><label className="if-l">{tx('pos.barcode')}</label><input className="if-in" value={barcode} placeholder={tx('pos.scan_or_type')} onChange={(e) => setBarcode(e.target.value)} /></div>
            <div className="if"><label className="if-l">UPC</label><input className="if-in" value={upc} placeholder={tx('pos.optional_2')} onChange={(e) => setUpc(e.target.value)} /></div>
          </div>
          <div style={{ fontWeight: 700, fontSize: 13, margin: '14px 0 8px', borderTop: '1px solid #EFE5D3', paddingTop: 12 }}>{tx('pos.tenant_defaults')}</div>
          <div style={{ fontSize: 13, marginBottom: 10 }}>{tx('pos.currently_2')}{' '}<b>{product.onHand}</b> {tx('pos.on_hand_4')}{' '}<span className={`inv-pill ${STATUS_TONE[previewStatus] || 'mut'}`}>{statusLabel('stock', previewStatus)}</span></div>
          <div className="if-row">
            <div className="if"><label className="if-l">{tx('pos.reorder_level_low_at_below')}</label><input className="if-in" inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value.replace(/[^0-9]/g, ''))} /></div>
            <div className="if"><label className="if-l">{tx('pos.critical_level_at_below')}</label><input className="if-in" inputMode="numeric" value={critical} placeholder={tx('pos.auto_reorder')} onChange={(e) => setCritical(e.target.value.replace(/[^0-9]/g, ''))} /></div>
          </div>
          <div className="if-row">
            <div className="if"><label className="if-l">{tx('pos.reorder_quantity')}</label><input className="if-in" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))} /></div>
            <div className="if"><label className="if-l">{tx('pos.maximum_overstock_above')}</label><input className="if-in" inputMode="numeric" value={max} placeholder={tx('pos.none_4')} onChange={(e) => setMax(e.target.value.replace(/[^0-9]/g, ''))} /></div>
          </div>
          <div className="if-row">
            <div className="if"><label className="if-l">{tx('pos.lead_time_days')}</label><input className="if-in" inputMode="numeric" value={leadTime} onChange={(e) => setLeadTime(e.target.value.replace(/[^0-9]/g, ''))} /></div>
            <label className="if"><span className="if-l">{tx('pos.preferred_vendor')}</span>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">{tx('pos.none_3')}</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted,#8A7A66)' }}>{tx('pos.leave_critical_blank_to_auto_derive_10lp')}</div>

          <div style={{ fontWeight: 700, fontSize: 13, margin: '14px 0 8px', borderTop: '1px solid #EFE5D3', paddingTop: 12 }}>{tx('pos.overrides_for_current_branch')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted,#8A7A66)', marginBottom: 10 }}>{tx('pos.leave_blank_to_use_the_tenant_v52u')}</div>
          <div className="if-row">
            <div className="if"><label className="if-l">{tx('pos.reorder_level_low_at_below')}</label><input className="if-in" inputMode="numeric" value={reorderOv} onChange={(e) => setReorderOv(e.target.value.replace(/[^0-9]/g, ''))} /></div>
            <div className="if"><label className="if-l">{tx('pos.critical_level_at_below')}</label><input className="if-in" inputMode="numeric" value={criticalOv} onChange={(e) => setCriticalOv(e.target.value.replace(/[^0-9]/g, ''))} /></div>
          </div>
          <div className="if-row">
            <div className="if"><label className="if-l">{tx('pos.reorder_quantity')}</label><input className="if-in" inputMode="numeric" value={qtyOv} onChange={(e) => setQtyOv(e.target.value.replace(/[^0-9]/g, ''))} /></div>
            <div className="if"><label className="if-l">{tx('pos.lead_time_days')}</label><input className="if-in" inputMode="numeric" value={leadTimeOv} onChange={(e) => setLeadTimeOv(e.target.value.replace(/[^0-9]/g, ''))} /></div>
          </div>
          <div className="if-row">
            <label className="if"><span className="if-l">{tx('pos.preferred_vendor')}</span>
              <select value={vendorIdOv} onChange={(e) => setVendorIdOv(e.target.value)}>
                <option value="">{tx('pos.use_tenant_default')}</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          </div>
          {err && <div className="inv-err">{err}</div>}
        </div>
        <div className="im-f"><button className="btn" onClick={onClose}>{tx('pos.cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? tx('pos.saving_2') : tx('pos.save_changes')}</button></div>
      </div>
    </div>
  );
}

// ===== Stock-threshold alerts (§17) =====
function AlertsTab({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<StockAlert[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => { setErr(null); try { const r = await inventoryApi.alertFeed(); setRows(r?.alerts ?? []); } catch (e: any) { setErr(e?.message || tx('pos.could_not_load_alerts')); } };
  useEffect(() => { void load();   }, []);
  const ack = async (id: string) => { setBusy(id); setErr(null); try { await inventoryApi.acknowledgeAlert(id); await load(); onChange(); } catch (e: any) { setErr(e?.message || tx('pos.could_not_acknowledge')); } finally { setBusy(null); } };
  return (
    <>
      {err && <div className="inv-err">{err}</div>}
      {!rows ? <div className="inv-empty">{tx('pos.loading_alerts')}</div>
        : rows.length === 0 ? <div className="inv-empty">{tx('pos.no_active_stock_alerts_you_ll_svxg')}</div>
        : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="inv-table">
                <div className="it-head" style={{ gridTemplateColumns: '1.2fr 2fr 0.8fr 1.1fr auto' }}><span>{tx('pos.level_2')}</span><span>{tx('pos.product')}</span><span>{tx('pos.on_hand')}</span><span>{tx('pos.when')}</span><span></span></div>
                {rows.map((a) => (
                  <div key={a.id} className="it-row" style={{ gridTemplateColumns: '1.2fr 2fr 0.8fr 1.1fr auto' }}>
                    <span><span className={`inv-pill ${STATUS_TONE[a.status] || 'mut'}`}>{statusLabel(['inventoryReport', 'stock'], a.status)}</span></span>
                    <span className="it-name"><b>{a.product_name}</b>{a.color_number ? <small>#{a.color_number}</small> : null}</span>
                    <span className="it-onhand">{a.on_hand}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--muted,#8A7A66)' }}>{fmtDateTime(a.created_at)}</span>
                    <span style={{ textAlign: 'right' }}>{a.acknowledged_at ? <span style={{ fontSize: 12, color: 'var(--muted,#8A7A66)' }}>{tx('pos.acknowledged_2')}</span> : <button className="btn sm" disabled={busy === a.id} onClick={() => ack(a.id)}>{busy === a.id ? '…' : tx('pos.acknowledge')}</button>}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
    </>
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
