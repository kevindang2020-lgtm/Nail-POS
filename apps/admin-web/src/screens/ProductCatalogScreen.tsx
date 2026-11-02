// ProductCatalogScreen.tsx — Super Admin › Catalog Management › Product Catalog.
// Centralized master-catalog OVERSIGHT of products sold or used by salons across the platform. Driven by the
// product-catalog overview endpoint. BOUNDARY: branch inventory counts, purchase orders, and daily stock
// adjustments deliberately stay in the tenant POS and are never shown here. Honest rendering: subsystems with no
// backing schema (import errors/queue, tax category, sync updates, change history) render NotConnected. Cream/gold.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { superAdminApi, type ProductCatalogOverview, type PcRow, type PcImportJob, type PcImportError } from '../api/superAdminApi';
import { Donut, MiniBars, NotConnected, money } from './_chartkit';
import { AddProductModal } from './ProductCatalogAddProduct';
import { ImportProductsModal } from './ProductCatalogImport';
import { PushToTenantsModal } from './ProductCatalogPush';
import { MasterRecordsModal } from './ProductCatalogMasterRecords';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const ICON: Record<string, string> = { total_products: '📦', active_brands: '🏷', duplicate_products: '⧉', import_errors: '⚠', products_with_barcodes: '|||', suggested_retail_configured: '◎', active_tenants: '👥', retired_products: '🗄', taxable_products: '％', vendors: '🚚', product_categories: '▦', product_sync_updates: '↻' };

const ACTIONS: { key: string; label: string; danger?: boolean }[] = [
  { key: 'create_master', label: 'Create Master Product Records' },
  { key: 'import', label: 'Import Products' },
  { key: 'detect_dupes', label: 'Detect Duplicate SKUs' },
  { key: 'standardize', label: 'Standardize Product Information' },
  { key: 'barcodes', label: 'Update Barcodes' },
  { key: 'categories', label: 'Manage Product Categories' },
  { key: 'retire', label: 'Retire Discontinued Products' },
  { key: 'push', label: 'Push Optional Products to Tenants' },
  { key: 'import_errors', label: 'Review Product-Import Errors' },
  { key: 'sales', label: 'Review Product Sales Across the Platform' },
];

type Tab = 'all' | 'duplicates' | 'imports' | 'categories' | 'vendors' | 'history';

// The four product actions the catalog actually audits today. Anything else falls back to the raw action
// string rather than being silently relabelled.
const PRODUCT_ACTION_LABEL: Record<string, string> = {
  product_master_created: 'Master product created',
  product_master_retired: 'Product retired',
  product_barcode_added: 'Barcode added',
  product_distributed: 'Distributed to tenant',
};

export function ProductCatalogScreen() {
  const [data, setData] = useState<ProductCatalogOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPush, setShowPush] = useState(false);
  const [showMasters, setShowMasters] = useState(false);
  const [jobs, setJobs] = useState<PcImportJob[]>([]);
  const [importErrors, setImportErrors] = useState<PcImportError[]>([]);

  const loadImports = useCallback(() => {
    superAdminApi.productImports().then(setJobs).catch(() => setJobs([]));
    superAdminApi.productImportErrors({ status: 'open' }).then(setImportErrors).catch(() => setImportErrors([]));
  }, []);
  useEffect(() => { loadImports(); }, [loadImports]);

  const approveJob = async (id: string) => { const r = await superAdminApi.approveProductImport(id); if (!r.ok) { setNote((r.errors || ['Approve failed.']).join(' ')); return; } setNote(`Import approved — ${r.job?.importedRows ?? 0} imported, ${r.job?.failedRows ?? 0} held.`); loadImports(); load(); };
  const retryErr = async (id: string) => { const r = await superAdminApi.retryProductImportError(id); if (!r.ok) { setNote((r.errors || ['Retry failed.']).join(' ')); return; } setNote('Import error marked resolved for retry.'); loadImports(); load(); };
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // client-side narrowing over the returned page
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [vendor, setVendor] = useState('');
  const [tenantUsage, setTenantUsage] = useState('');

  const load = useCallback(() => {
    setErr(null);
    superAdminApi.productCatalog({ search: search || undefined, duplicateOnly: tab === 'duplicates' ? true : undefined, page, pageSize: 10 })
      .then(setData).catch((e: any) => setErr(e?.message || 'Failed to load Product Catalog.'));
  }, [search, tab, page]);
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);

  const rows = useMemo(() => {
    let r = data?.directory ?? [];
    if (category) r = r.filter((x) => x.categoryName === category);
    if (brand) r = r.filter((x) => x.brandName === brand);
    if (vendor) r = r.filter((x) => x.vendorName === vendor);
    if (tenantUsage === 'single') r = r.filter((x) => x.activeTenants <= 1);
    if (tenantUsage === 'multi') r = r.filter((x) => x.activeTenants > 1);
    return r;
  }, [data, category, brand, vendor, tenantUsage]);

  const categoryOpts = useMemo(() => (data?.byCategory ?? []).map((c) => c.label), [data]);
  const brandOpts = useMemo(() => (data?.byBrand ?? []).map((b) => b.label), [data]);
  const vendorOpts = useMemo(() => [...new Set((data?.directory ?? []).map((r) => r.vendorName).filter(Boolean))] as string[], [data]);
  const tenantOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data?.directory ?? []) if (r.tenantId) m.set(r.tenantId, r.tenantName || r.tenantId);
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [data]);

  const resetFilters = () => { setCategory(''); setBrand(''); setVendor(''); setTenantUsage(''); setSearch(''); setPage(1); };

  const onAction = (key: string) => {
    if (key === 'create_master') { setShowAdd(true); return; }
    if (key === 'import') { setShowImport(true); return; }
    if (key === 'push') { setShowPush(true); return; }
    if (key === 'retire') { setShowMasters(true); return; }
    if (key === 'detect_dupes') { setTab('duplicates'); setPage(1); return; }
    if (key === 'categories') { setTab('categories'); return; }
    if (key === 'import_errors') { setTab('imports'); return; }
    if (key === 'sales') return setNote('Product sales review reads the platform sales aggregate (read-only, permission-checked, audited). Branch inventory counts stay in the tenant POS.');
    setNote('This catalog workflow is not yet connected — a master-product / import pipeline is being built. No changes were made; branch inventory is never modified from here.');
  };

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;
  if (!data) return <div className="screen"><div className="state">Loading Product Catalog…</div></div>;

  const dupCount = data.duplicateDetection.duplicateSkus;
  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'all', label: 'All Products' }, { key: 'duplicates', label: 'Duplicate Review', badge: dupCount },
    { key: 'imports', label: 'Import Queue', badge: importErrors.length }, { key: 'categories', label: 'Categories' },
    { key: 'vendors', label: 'Vendors' }, { key: 'history', label: 'Change History' },
  ];
  const selS: React.CSSProperties = { height: 34, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5 };

  return (
    <div className="screen p-5">
      {/* HEADER */}
      <div className="vh flex flex-col lg:flex-row justify-between gap-3" >
        <div style={{ flex: 1 }}>
          <h1>Product Catalog <span title="Platform module" style={{ color: 'var(--g7,#A96F22)' }}>★</span></h1>
          <div className="sub">Centralized oversight of products sold or used by salons across the platform — without replacing branch-level inventory control.</div>
        </div>
        <div className="flex gap-2 items-baseline">
          <button className="btn ghost" onClick={() => setNote('A catalog export isn’t connected yet — the filtered list on this page is the current view.')}>⬇ Export Report</button>
          <button className="btn" onClick={() => onAction('create_master')}>+ Add Product</button>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="flex flex-wrap items-center gap-2 mt-2.5">
        <select className="inp" style={selS} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"><option value="">All Categories</option>{categoryOpts.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select className="inp" style={selS} value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand"><option value="">All Brands</option>{brandOpts.map((b) => <option key={b} value={b}>{b}</option>)}</select>
        <select className="inp" style={selS} value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor"><option value="">All Vendors</option>{vendorOpts.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        <select className="inp" style={{ ...selS, opacity: 0.55 }} disabled aria-label="Import Status" title="Import pipeline not connected"><option>All Statuses (—)</option></select>
        <select className="inp" style={{ ...selS, opacity: 0.55 }} disabled aria-label="Tax Category" title="Tax category not tracked on products"><option>All Tax Categories (—)</option></select>
        <select className="inp" style={selS} value={tenantUsage} onChange={(e) => setTenantUsage(e.target.value)} aria-label="Tenant Usage"><option value="">All Usage</option><option value="single">Single tenant</option><option value="multi">Multiple tenants</option></select>
        <select className="inp" style={selS} value={tab === 'duplicates' ? 'dupes' : ''} onChange={(e) => { setTab(e.target.value === 'dupes' ? 'duplicates' : 'all'); setPage(1); }} aria-label="Duplicate Check"><option value="">All Results</option><option value="dupes">Duplicates only</option></select>
        <input className="inp max-w-[300px]" style={{ flex: 1, minWidth: 200, height: 34, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8 }} placeholder="Search by product name, SKU, or barcode…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
        <button className="btn ghost" onClick={resetFilters}>↺ Reset Filters</button>
      </div>

      {note ? <div className="state" style={{ marginTop: 10 }}>{note} <button className="linkbtn" onClick={() => setNote(null)}>Dismiss</button></div> : null}

      {/* 12 KPI CARDS (2 × 6) */}
     <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 mt-3">
        {data.kpis.map((k) => (
          <div key={k.key} className="kpi" style={{ border: '1px solid var(--line)', background: '#fff' }} aria-label={`${k.label}: ${k.available ? k.value : 'not connected'}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: '50%', background: '#FBF1E2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>{ICON[k.key] || '•'}</span><span className="l" style={{ fontSize: 10.5 }}>{k.label}</span></div>
            <div className="v capitalize" style={{ fontSize: 12 }}>{k.available ? k.value : <NotConnected />}</div>
            <div className="d flat" style={{ fontSize: 10.5 }}>{k.available ? (k.supporting || '\u00A0') : 'NotConnected'}</div>
          </div>
        ))}
      </div>

      {/* MAIN GRID: master library (left) + actions/boundary (right) */}
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3 mt-3.5 items-start">
        <section className="panel">
          {/* tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 10, flexWrap: 'wrap' }}>
            {TABS.map((t) => (
              <button key={t.key} className="linkbtn" onClick={() => { setTab(t.key); setPage(1); }} style={{ padding: '6px 10px', borderBottom: tab === t.key ? '2px solid var(--g7,#A96F22)' : '2px solid transparent', color: tab === t.key ? 'var(--g7,#A96F22)' : undefined, fontWeight: tab === t.key ? 700 : 500 }}>
                {t.label}{t.badge ? <span className="nbadge" style={{ marginLeft: 6 }}>{t.badge}</span> : null}
              </button>
            ))}
            <button className="linkbtn" onClick={() => setShowMasters(true)} style={{ marginLeft: 'auto', padding: '6px 10px' }} title="Platform master product definitions">Master records ›</button>
          </div>

          {tab === 'imports' ? (
            jobs.length === 0 ? <div className="state">No import jobs yet. Use <b>Import Products</b> to stage a file.</div> : (
              <table className="tgrid" style={{ width: '100%', fontSize: 12.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>File</th><th>Source</th><th>Status</th><th>Total</th><th>Valid</th><th>Invalid</th><th>Imported</th><th>Actions</th></tr></thead>
                <tbody>{jobs.map((j) => (
                  <tr key={j.id}>
                    <td style={{ fontWeight: 600 }}>{j.filename || j.id}</td><td className="muted">{cap(j.source)}</td>
                    <td><span className={'pill ' + (j.status === 'imported' ? 'ok' : j.status === 'failed' ? 'bad' : 'warn')}>{cap(j.status)}</span></td>
                    <td>{j.totalRows}</td><td>{j.validRows}</td><td>{j.invalidRows}</td><td>{j.importedRows}</td>
                    <td>{(j.status === 'ready' || j.status === 'pending') ? <button className="linkbtn" onClick={() => approveJob(j.id)}>Approve</button> : <span className="muted">—</span>}</td>
                  </tr>))}</tbody></table>
            )
          )
          : tab === 'history' ? <div className="state">Change history <NotConnected />. A product change-log is not modelled yet.</div>
          : tab === 'categories' ? (
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Category</th><th>Products</th></tr></thead>
              <tbody>{data.byCategory.map((c) => <tr key={c.label}><td style={{ fontWeight: 600 }}>{c.label}</td><td>{c.count.toLocaleString()}</td></tr>)}</tbody></table>
          ) : tab === 'vendors' ? (
            <table className="tgrid" style={{ width: '100%', fontSize: 12.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Vendor</th><th>Products (page)</th></tr></thead>
              <tbody>{vendorOpts.map((v) => <tr key={v}><td style={{ fontWeight: 600 }}>{v}</td><td>{(data.directory.filter((r) => r.vendorName === v)).length}</td></tr>)}</tbody></table>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="tgrid" style={{ width: '100%', fontSize: 12, minWidth: 1000 }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}>
                    <th>Product</th><th>Brand</th><th>SKU</th><th>UPC / Barcode</th><th>Category</th><th>Cost</th><th>Retail</th><th>Tax</th><th>Unit</th><th>Vendor</th><th>Tenants</th><th>Import</th><th>Dup</th><th>Status</th><th>Actions</th>
                  </tr></thead>
                  <tbody>
                    {rows.length === 0 ? <tr><td colSpan={15}><div className="state">No products match these filters.</div></td></tr> :
                      rows.map((r: PcRow) => (
                        <tr key={r.id}>
                          <td style={{ fontWeight: 600 }}>{r.name}</td>
                          <td className="muted">{r.brandName || '—'}</td>
                          <td className="muted">{r.sku || '—'}</td>
                          <td className="muted">{r.barcode || '—'}</td>
                          <td className="muted">{r.categoryName || '—'}</td>
                          <td>{r.costCents != null ? money(r.costCents) : '—'}</td>
                          <td>{r.retailPriceCents != null ? money(r.retailPriceCents) : '—'}</td>
                          <td className="muted">{r.taxCategory ?? <NotConnected />}</td>
                          <td className="muted">{r.unitType ? cap(r.unitType) : '—'}</td>
                          <td className="muted">{r.vendorName || '—'}</td>
                          <td>{r.activeTenants.toLocaleString()}</td>
                          <td>{r.importStatusAvailable ? cap(r.importStatus) : <NotConnected />}</td>
                          <td>{r.duplicateFlag ? <span className="pill bad">Yes</span> : <span className="muted">No</span>}</td>
                          <td><span className={'pill ' + (r.status === 'Active' ? 'ok' : 'mut')}>{r.status}</span></td>
                          <td><button className="linkbtn" aria-label={`View ${r.name}`} onClick={() => setNote(`A per-product detail view isn\u2019t connected yet \u2014 ${r.id}\u2019s row is the master record; branch inventory counts stay in the tenant POS.`)}>View</button></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 10, fontSize: 12 }}>
                <span className="muted">Showing {rows.length ? (data.pagination.page - 1) * data.pagination.pageSize + 1 : 0} to {(data.pagination.page - 1) * data.pagination.pageSize + rows.length} of {data.pagination.totalItems.toLocaleString()} products</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button className="btn ghost" disabled={data.pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
                  <span>Page {data.pagination.page} / {data.pagination.totalPages}</span>
                  <button className="btn ghost" disabled={data.pagination.page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* RIGHT: Super Admin Actions + Boundary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="panel">
            <div className="phead"><h2>Super Admin Actions</h2></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-1 gap-[7px]">
              {ACTIONS.map((a) => <button key={a.key} className="qbtn" onClick={() => onAction(a.key)}>{a.label}</button>)}
            </div>
          </section>
          <section className="panel" style={{ borderLeft: '4px solid var(--g7,#A96F22)', background: 'linear-gradient(90deg,#FBF3E6,#FFFDF8)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><span aria-hidden="true">🛡</span><b style={{ fontSize: 12.5 }}>Boundary</b></div>
            <div className="muted" style={{ fontSize: 12 }}>Actual branch inventory counts, purchase orders, and daily stock adjustments normally remain in the tenant POS. This module governs the master catalog only.</div>
          </section>
        </div>
      </div>

      {/* ANALYTICS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-7" style={{ marginTop: 14 }}>
        <section className="panel">
          <div className="phead"><h2>Products by Category</h2></div>
          {data.byCategory.length ? <Donut data={data.byCategory.map((c) => ({ label: c.label, value: c.count }))} centerLabel={`${data.counts?.total ?? data.byCategory.reduce((a, c) => a + c.count, 0)}\nTotal`} /> : <div className="state">No categories.</div>}
        </section>
        <section className="panel">
          <div className="phead"><h2>Brand Adoption Overview</h2><span className="muted">Top 6</span></div>
          <MiniBars data={data.byBrand.map((b) => ({ label: b.label.slice(0, 8), value: b.count, tip: b.label }))} emptyHint="No brands." />
        </section>
        <section className="panel">
          <div className="phead"><h2>Suggested Retail Price Distribution</h2></div>
          <MiniBars data={data.retailPriceDistribution.map((b) => ({ label: b.label, value: b.count }))} emptyHint="No priced products." />
        </section>
        <section className="panel">
          <div className="phead"><h2>Duplicate SKU &amp; Barcode Detection</h2></div>
          <div style={{ display: 'flex', gap: 16 }}>
            <div><div className="muted" style={{ fontSize: 11 }}>Duplicate SKUs</div><div style={{ fontSize: 22, fontWeight: 800, color: 'var(--danger,#B85B4D)' }}>{data.duplicateDetection.duplicateSkus}</div></div>
            <div><div className="muted" style={{ fontSize: 11 }}>Duplicate Barcodes</div><div style={{ fontSize: 22, fontWeight: 800 }}>{data.duplicateDetection.duplicateBarcodes}</div></div>
            <div><div className="muted" style={{ fontSize: 11 }}>Potential Matches</div><div style={{ fontSize: 22, fontWeight: 800 }}>{data.duplicateDetection.potentialMatches}</div></div>
          </div>
          <button className="linkbtn" style={{ marginTop: 8 }} onClick={() => { setTab('duplicates'); setPage(1); }}>Review all duplicates ›</button>
        </section>
        <section className="panel">
          <div className="phead"><h2>Recent Product Import Activity</h2></div>
          {jobs.length === 0 ? <div className="state">No import activity yet.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {jobs.slice(0, 5).map((j) => (
                <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span className={'pill ' + (j.status === 'imported' ? 'ok' : j.status === 'failed' ? 'bad' : 'warn')}>{cap(j.status)}</span>
                  <span style={{ flex: 1 }}>{j.filename || j.id} — {j.validRows}/{j.totalRows} valid</span>
                  <span className="muted">{new Date(j.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
              <button className="linkbtn" style={{ marginTop: 4 }} onClick={() => { setTab('imports'); setPage(1); }}>View all import activity ›</button>
            </div>
          )}
        </section>
                  <section className="panel">
            <div className="phead"><h2>Product Version / Change History</h2><span className="muted" style={{ fontSize: 11 }}>Audited events</span></div>
            {data.productChangeHistory == null ? <div style={{ padding: 14 }}><NotConnected /></div>
              : !data.productChangeHistory.length ? <div className="state" style={{ padding: 18 }}>No product changes have been recorded yet.</div> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {data.productChangeHistory.map((h) => (
                  <li key={h.id} style={{ display: 'flex', gap: 10, padding: '8px 2px', borderTop: '1px solid var(--line, #E7DCC8)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{PRODUCT_ACTION_LABEL[h.action] || h.action.replace(/_/g, ' ')}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {h.productName || h.entityId || 'Product'}{h.tenantName ? ` · ${h.tenantName}` : ''}{h.actorName ? ` · by ${h.actorName}` : ''}
                      </div>
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{new Date(h.at).toLocaleString()}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel">
            <div className="phead"><h2>Compare Tenant Product Configurations</h2><span className="muted" style={{ fontSize: 11 }}>From master-product distributions</span></div>
            {data.tenantProductConfigs == null ? <div style={{ padding: 14 }}><NotConnected /></div>
              : !data.tenantProductConfigs.length ? <div className="state" style={{ padding: 18 }}>No master products have been distributed to tenants yet.</div> : (
              <table className="tbl"><thead><tr><th>Tenant</th><th style={{ textAlign: 'right' }}>Distributed</th><th style={{ textAlign: 'right' }}>Linked</th><th style={{ textAlign: 'right' }}>Pending</th><th>Last Sync</th></tr></thead>
                <tbody>
                  {data.tenantProductConfigs.map((c) => (
                    <tr key={c.tenantId}>
                      <td>{c.tenantName || c.tenantId}</td>
                      <td style={{ textAlign: 'right' }}>{c.distributed.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{c.linked.toLocaleString()}</td>
                      <td style={{ textAlign: 'right' }}>{c.pending.toLocaleString()}</td>
                      <td className="muted">{c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="panel">
            <div className="phead"><h2>Top Products by Tenant Usage</h2><span className="muted" style={{ fontSize: 11 }}>{data.topByTenantUsageScansAll === false ? 'Most recent products only' : 'Across the full catalog'}</span></div>
            {!data.topByTenantUsage?.length ? <div className="state" style={{ padding: 18 }}>No products are carried by more than one tenant yet.</div> : (
              <table className="tbl"><thead><tr><th>#</th><th>Product</th><th>Brand</th><th style={{ textAlign: 'right' }}>Tenants</th></tr></thead>
                <tbody>
                  {data.topByTenantUsage.map((t, i) => (
                    <tr key={t.sku}><td className="muted">{i + 1}</td><td>{t.name}</td><td className="muted">{t.brandName || '—'}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{t.tenants.toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
<section className="panel">
          <div className="phead"><h2>Import Error Queue</h2>{importErrors.length ? <span className="nbadge">{importErrors.length}</span> : null}</div>
          {importErrors.length === 0 ? <div className="state">No open import errors.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 12 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Error Type</th><th>Product</th><th>Source File</th><th>Status</th><th>Retry</th></tr></thead>
              <tbody>{importErrors.slice(0, 6).map((e) => (
                <tr key={e.id}>
                  <td>{cap(e.errorType)}</td><td className="muted">{e.productName || '—'}</td><td className="muted">{e.sourceFile || '—'}</td>
                  <td><span className={'pill ' + (e.status === 'resolved' ? 'ok' : 'bad')}>{cap(e.status)}</span></td>
                  <td>{e.retryable ? <button className="linkbtn" onClick={() => retryErr(e.id)}>Retry</button> : <span className="muted" title="Not technically retryable">—</span>}</td>
                </tr>))}</tbody></table>
          )}
        </section>
        <section className="panel ">
          <div className="phead"><h2>At-a-Glance Summary</h2></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><div className="muted" style={{ fontSize: 11 }}>Import Success Rate</div><div className='capitalize' style={{ fontSize: 15, fontWeight: 500 }}>{data.atAGlance.importSuccessRate == null ? <NotConnected /> : `${data.atAGlance.importSuccessRate}%`}</div></div>
            <div><div className="muted" style={{ fontSize: 11 }}>Duplicate Rate</div><div style={{ fontSize: 18, fontWeight: 500 }}>{data.atAGlance.duplicateRatePct}%</div></div>
            <div><div className="muted" style={{ fontSize: 11 }}>Barcode Coverage</div><div style={{ fontSize: 18, fontWeight: 500 }}>{data.atAGlance.barcodeCoveragePct}%</div></div>
            <div><div className="muted" style={{ fontSize: 11 }}>Retail Configured</div><div style={{ fontSize: 18, fontWeight: 500 }}>{data.atAGlance.retailConfiguredPct}%</div></div>
          </div>
        </section>
      </div>

      {showAdd ? <AddProductModal onClose={() => setShowAdd(false)} onCreated={(name, id) => { setShowAdd(false); setNote(`Master product “${name}” created as draft (${id}). It becomes available to tenants only through an explicit, audited distribution.`); load(); }} /> : null}
      {showImport ? <ImportProductsModal onClose={() => setShowImport(false)} onStaged={(job, deduped) => { setShowImport(false); setNote(deduped ? `This file was already staged as ${job.id} (idempotent — no duplicate job).` : `Staged ${job.filename || job.id}: ${job.validRows} valid, ${job.invalidRows} invalid. Approve it in the Import Queue to import the valid rows.`); loadImports(); load(); }} /> : null}
      {showPush ? <PushToTenantsModal tenantOptions={tenantOpts} onClose={() => setShowPush(false)} onDone={(msg) => { setShowPush(false); setNote(msg); }} /> : null}
      {showMasters ? <MasterRecordsModal onClose={() => setShowMasters(false)} onChanged={(msg) => { setNote(msg); }} /> : null}
    </div>
  );
}
