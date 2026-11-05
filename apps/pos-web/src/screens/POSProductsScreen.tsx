// POSProductsScreen.tsx — Products (inventory catalog). Reuses the existing inventory product endpoints:
// list (with search + stock status), create, add-stock, archive. No new backend.
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posProductsApi } from '../api/posProductsApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Product = { id: string; name: string; color_name: string | null; color_number: string | null; sku: string | null; brand_name: string | null; category_name: string | null; onHand: number; status: string; retail_price_cents: number | null; cost_cents: number | null; reorder_level: number | null };
type NamedRow = { id: string; name: string };

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  in_stock: { get label() { return t('pos.in_stock'); }, bg: '#E9F6EC', fg: '#2E9E54' }, low: { get label() { return t('pos.low'); }, bg: '#FBF7E8', fg: '#8A7418' },
  critical: { get label() { return t('pos.critical'); }, bg: '#FEF2E7', fg: '#B5651D' }, out_of_stock: { get label() { return t('pos.out'); }, bg: '#FDEEEE', fg: '#C0392B' },
  overstock: { get label() { return t('pos.overstock'); }, bg: '#EAF2FB', fg: '#2D6CBF' },
};
const chip = (status: string) => { const s = STATUS[status] || { label: status, bg: '#F0F0F0', fg: '#666' }; return <span style={{ padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: s.bg, color: s.fg }}>{s.label}</span>; };

export function POSProductsScreen() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState<NamedRow[]>([]);
  const [brands, setBrands] = useState<NamedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [stockFor, setStockFor] = useState<Product | null>(null);
  const [stockQty, setStockQty] = useState('');
  const timer = useRef<any>(null);
  // create form
  const [form, setForm] = useState({ name: '', categoryId: '', brandId: '', colorNumber: '', sku: '', cost: '', retail: '', reorder: '' });

  const load = useCallback(async (q: string) => {
    setError(null);
    try { const r = await posProductsApi.list(q || undefined); setProducts((r?.products || r || []) as Product[]); }
    catch (e: any) { setError(reportError(e, 'products')); }
  }, []);
  useEffect(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => load(search), 250); return () => timer.current && clearTimeout(timer.current); }, [search, load]);
  useEffect(() => {
    posProductsApi.categories().then((r) => setCategories((r?.categories || []) as NamedRow[])).catch(() => {});
    posProductsApi.brands().then((r) => setBrands((r?.brands || []) as NamedRow[])).catch(() => {});
  }, []);

  const createProduct = async () => {
    if (!form.name.trim()) { setNote(t('pos.product_name_is_required')); return; }
    setBusy('create'); setNote(null);
    try {
      await posProductsApi.create({
        name: form.name.trim(), categoryId: form.categoryId || null, brandId: form.brandId || null, colorNumber: form.colorNumber || null,
        sku: form.sku || null, costCents: form.cost ? (parseDollarsToCents(form.cost) ?? 0) : null,
        retailPriceCents: form.retail ? (parseDollarsToCents(form.retail) ?? 0) : null, reorderLevel: form.reorder ? parseInt(form.reorder, 10) : 0,
      });
      setShowAdd(false); setForm({ name: '', categoryId: '', brandId: '', colorNumber: '', sku: '', cost: '', retail: '', reorder: '' }); await load(search);
    } catch (e: any) { setNote(e?.message || t('pos.could_not_create_the_product')); }
    finally { setBusy(null); }
  };
  const addStock = async () => {
    if (!stockFor) return;
    const qty = parseInt(stockQty, 10) || 0;
    if (qty <= 0) { setNote(t('pos.enter_a_quantity_of_at_least_1cm5')); return; }
    setBusy(stockFor.id); setNote(null);
    try { await posProductsApi.addStock(stockFor.id, { quantity: qty }); setStockFor(null); setStockQty(''); await load(search); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_add_stock')); }
    finally { setBusy(null); }
  };
  const archive = async (p: Product) => {
    setBusy(p.id); setNote(null);
    try { await posProductsApi.archive(p.id); await load(search); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_archive_the_product')); }
    finally { setBusy(null); }
  };
  const up = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!products) return <div className="work"><div className="state">{t('pos.loading_products')}</div></div>;

  const lowCount = products.filter((p) => ['low', 'critical', 'out_of_stock'].includes(p.status)).length;
  const retailValue = products.reduce((a, p) => a + (p.retail_price_cents || 0) * (p.onHand || 0), 0);

  return (
    <div className="work">
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between items-start xl:items-center">
        <div className="vh"><h1>{t('pos.products')}</h1><div className="sub">{t('pos.your_inventory_catalog')}</div></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3.5">
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.products')}</div><div className="v">{products.length}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.need_reorder')}</div><div className="v" style={{ color: lowCount > 0 ? '#C0392B' : undefined }}>{lowCount}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.retail_value')}</div><div className="v" style={{ fontSize: 18 }}>{money(retailValue)}</div></div>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center mt-3 gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('pos.search_products')} style={{ flex: 1, padding: 10, maxWidth: '100%' }} className="sm:max-w-[360px]" />
        <button className={showAdd ? "btn" : "btn primary"}  onClick={() => { setShowAdd((v) => !v); setNote(null); }}>{showAdd ? t('pos.close') : t('pos.new_product_2')}</button>
      </div>
      {note ? <div className="err" style={{ marginTop: 10 }}>{note}</div> : null}

      {showAdd ? (
        <section className="panel" style={{ marginTop: 10 }}>
          <div className="p-h">{t('pos.new_product')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 mt-2">
            <label style={{ fontSize: 12.5, gridColumn: '1 / -1' }}>{t('pos.name_2')}<input value={form.name} onChange={(e) => up('name')(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }} /></label>
            <label style={{ fontSize: 12.5 }}>{t('pos.category')}<select value={form.categoryId} onChange={(e) => up('categoryId')(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label style={{ fontSize: 12.5 }}>{t('pos.brand')}<select value={form.brandId} onChange={(e) => up('brandId')(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }}><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label style={{ fontSize: 12.5 }}>{t('pos.color')}<input value={form.colorNumber} onChange={(e) => up('colorNumber')(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }} /></label>
            <label style={{ fontSize: 12.5 }}>SKU<input value={form.sku} onChange={(e) => up('sku')(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }} /></label>
            <label style={{ fontSize: 12.5 }}>{t('pos.cost_3')}<input type="number" min="0" step="0.01" value={form.cost} onChange={(e) => up('cost')(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }} /></label>
            <label style={{ fontSize: 12.5 }}>{t('pos.retail_2')}<input type="number" min="0" step="0.01" value={form.retail} onChange={(e) => up('retail')(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }} /></label>
            <label style={{ fontSize: 12.5 }}>{t('pos.reorder_level')}<input type="number" min="0" value={form.reorder} onChange={(e) => up('reorder')(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }} /></label>
          </div>
          <div style={{ marginTop: 12 }}><button className="btn primary" disabled={busy === 'create'} onClick={createProduct}>{busy === 'create' ? t('pos.creating') : t('pos.create_product_2')}</button></div>
        </section>
      ) : null}

      {stockFor ? (
        <section className="panel" style={{ marginTop: 10 }}>
          <div className="p-h">{t('pos.add_stock')}{' '}{stockFor.name}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <input type="number" min="1" placeholder={t('pos.quantity')} value={stockQty} onChange={(e) => setStockQty(e.target.value)} style={{ padding: 8, width: 140 }} />
            <button className="btn" disabled={busy === stockFor.id} onClick={addStock}>{busy === stockFor.id ? t('pos.adding') : t('pos.add')}</button>
            <button className="btn ghost" onClick={() => { setStockFor(null); setStockQty(''); }}>{t('pos.cancel')}</button>
          </div>
        </section>
      ) : null}

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        {products.length === 0 ? <div className="state" style={{ padding: 16 }}>{search ? t('pos.no_products_match_search', { search: String(search) }) : t('pos.no_products_yet')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.product')}</th><th>SKU</th><th>{t('pos.brand_category')}</th><th style={{ textAlign: 'right' }}>{t('pos.on_hand_2')}</th><th>{t('pos.status')}</th><th style={{ textAlign: 'right' }}>{t('pos.retail')}</th><th style={{ width: 170 }}></th></tr></thead>
                <tbody>{products.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 700 }}>{p.name}{p.color_number ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · #{p.color_number}</span> : null}</td>
                    <td>{p.sku || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td>{[p.brand_name, p.category_name].filter(Boolean).join(' · ') || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{p.onHand ?? 0}</td>
                    <td>{chip(p.status)}</td>
                    <td style={{ textAlign: 'right' }}>{p.retail_price_cents != null ? money(p.retail_price_cents) : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost" disabled={busy === p.id} onClick={() => { setStockFor(p); setStockQty(''); setNote(null); }}>{t('pos.add_stock_2')}</button>
                      <button className="btn ghost" style={{ marginLeft: 6 }} disabled={busy === p.id} onClick={() => archive(p)}>{t('pos.archive')}</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
