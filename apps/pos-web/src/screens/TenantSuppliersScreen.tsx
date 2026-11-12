// TenantSuppliersScreen.tsx — Services & Products → Suppliers (/tenant/inventory/vendors). Suppliers & Purchasing mandate
// (Oct 29 2026): ONE bounded workspace at 100 % zoom (no page scroll; lists page inside their panels, details scroll inside
// their overlay) on the real vendors / contacts / supplier-products / purchase-order backend:
//   * header with a prominent + Add Supplier; four KPIs with their scope (Total Suppliers = active, inactive beside it ·
//     Active POs = approved / ordered / partially received, drafts beside it · Open PO Value = still to arrive, a real $0.00
//     never a dash · Brands = catalog brands, with how many have no supplier) — each opens the matching list;
//   * Supplier Directory: one search (name, trade name, code, phone in any format, email, contact person / phone / email,
//     product, SKU, barcode, supplier SKU, brand, PO number — with what matched), All / Active / Inactive / Preferred, brand,
//     sort (Newest · A–Z · Last order), numbered server pages newest first;
//   * Supplier Details: Overview · Contacts (many, one primary, deactivate keeps history) · Supplied Products (links with
//     supplier SKU / cost / pack / lead time; never stock) · Purchase Orders · Receiving History · Notes — beside the
//     directory when there is room, an overlay otherwise;
//   * Purchase Orders workspace: every order at this location with search, status, date field (created / expected /
//     approved / received) + calendar, the expected date as a calendar date (it printed a raw midnight-UTC timestamp),
//     inactive-supplier and no-supplier orders labelled, Link Supplier for an order with none;
//   * Create Draft PO opens the one purchase-order flow (draft → approve → receive; only receiving adds stock).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { inventoryApi } from '../api/inventoryApi';
import { posInventoryScreenApi, posSuppliersApi } from '../api/posInventoryScreenApi';
import { fmtNumber } from '../i18n/format';
import { useCan } from '../components/usePermissions';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, centsFromText, textFromCents, type PeriodState } from '../components/FinanceKit';
import { money, day, when, errMsg, unitLabel } from '../components/InventoryKit';
import { codeLabel } from '../components/peopleLabels';
import { PoTable, PoDialog } from './TenantInventoryScreen';
import { SystemCheckButton } from '../components/SystemCheck';

type Work = 'directory' | 'orders';
type DTab = 'overview' | 'contacts' | 'products' | 'orders' | 'receiving' | 'notes';
const DTABS: DTab[] = ['overview', 'contacts', 'products', 'orders', 'receiving', 'notes'];
const STATUS = ['active', 'all', 'inactive', 'preferred'];
const PO_STATUSES = ['open', 'active', 'draft', 'approved', 'ordered', 'partial', 'received', 'cancelled'];
const dupsOf = (e: any): Array<{ id: string; name: string; active: boolean }> | null => {
  const d = e?.details?.duplicates ?? e?.details?.error?.details?.duplicates ?? e?.body?.duplicates;
  return Array.isArray(d) && d.length ? d : null;
};
function useWide(px: number) {
  const [w, setW] = useState(() => typeof window !== 'undefined' && window.innerWidth >= px);
  useEffect(() => { const f = () => setW(window.innerWidth >= px); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, [px]);
  return w;
}

export function TenantSuppliersScreen() {
  const nav = useNavigate(); const can = useCan(); const wide = useWide(1440);
  const [work, setWork] = useState<Work>('directory');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [status, setStatus] = useState('active'); const [brandId, setBrandId] = useState(''); const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1); const [tick, setTick] = useState(0);
  const [poSearch, setPoSearch] = useState(''); const pq = useDebounced(poSearch.trim(), 300);
  const [poStatus, setPoStatus] = useState(''); const [poPeriod, setPoPeriod] = useState<PeriodState>({ preset: 'all' }); const [poField, setPoField] = useState('created'); const [poPage, setPoPage] = useState(1); const [unlinked, setUnlinked] = useState(false);
  const [sel, setSel] = useState<string | null>(null); const [overlay, setOverlay] = useState(false);
  const [form, setForm] = useState<{ supplier: any | null } | null>(null); const [viewPo, setViewPo] = useState<string | null>(null); const [linkPo, setLinkPo] = useState<any | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string; supplierId?: string; outside?: boolean } | null>(null);
  const fit = useFitRows<HTMLDivElement>(47, { min: 3, max: 14, reserve: 34 });
  const dirScope = { search: q || undefined, status, brandId: brandId || undefined, sort };
  const poScope = { search: pq || undefined, status: poStatus || undefined, ...periodQuery(poPeriod), dateField: poField, unlinked: unlinked ? 'true' : undefined };
  useEffect(() => { setPage(1); }, [JSON.stringify(dirScope)]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPoPage(1); }, [JSON.stringify(poScope)]);   // eslint-disable-line react-hooks/exhaustive-deps
  const kpis = useLoad(() => posSuppliersApi.kpis(), [tick]);
  const brands = useLoad(() => inventoryApi.brands(), []);
  const dir = useLoad(() => work === 'directory' ? posSuppliersApi.directory({ ...dirScope, page, pageSize: fit.rows }) : Promise.resolve(null), [work, JSON.stringify(dirScope), page, fit.rows, tick]);
  const pos = useLoad(() => work === 'orders' ? posInventoryScreenApi.purchaseOrders({ ...poScope, page: poPage, pageSize: fit.rows }) : Promise.resolve(null), [work, JSON.stringify(poScope), poPage, fit.rows, tick]);
  useEffect(() => { if (dir.data && dir.data.page !== page) setPage(dir.data.page); }, [dir.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const k = kpis.data; const rows: any[] = dir.data?.rows ?? [];
  const refresh = () => setTick((t) => t + 1);
  const select = (id: string) => { setSel(id); if (!wide) setOverlay(true); };
  const clearDir = () => { setSearch(''); setStatus('active'); setBrandId(''); setSort('newest'); };
  const saved = (id: string, createdNew: boolean) => {
    setForm(null); refresh();
    const outside = createdNew && (!!q || brandId !== '' || sort !== 'newest' || status === 'inactive');
    if (createdNew) { setWork('directory'); setPage(1); }
    setSel(id); if (!wide) setOverlay(true);
    setNote({ tone: 'ok', text: createdNew ? tx('sup.created') : tx('sup.saved'), supplierId: id, outside });
  };
  if (isForbidden(kpis.error)) return <div className="work fit sup" data-testid="suppliers-screen"><h1>{tx('pos.suppliers')}</h1><StateBlock error={kpis.error} onRetry={kpis.reload} /></div>;
  const detail = sel ? <SupplierDetail key={sel} vendorId={sel} tick={tick} can={can} nav={nav} onChanged={refresh} onEdit={(s) => setForm({ supplier: s })} onViewPo={setViewPo} compact={wide && !overlay} /> : null;
  return (
    <div className="work fit sup" data-testid="suppliers-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.suppliers')}</h1><div className="sub">{tx('pos.supplier_directory_contacts_purchase_orders_and_mls9')}</div></div>
        <div className="fk-head-actions">
          <SystemCheckButton domain="suppliers" />
          <button type="button" className="fk-btn" onClick={refresh} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn" onClick={() => nav('/tenant/inventory?tab=purchaseOrders')} data-testid="manage-pos">{tx('pos.manage_in_inventory')}</button>
          {can('inventory.vendor.manage') ? <button type="button" className="fk-btn primary big" onClick={() => setForm({ supplier: null })} data-testid="add-supplier">{tx('pos.add_supplier')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span>
        {note.supplierId ? <button type="button" className="fk-link" onClick={() => select(note.supplierId!)}>{tx('sup.viewRecord')}</button> : null}
        {note.outside ? <button type="button" className="fk-link" onClick={clearDir}>{tx('finance.clearFilters')}</button> : null}
        <button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      <div className="fk-kpis four" data-testid="kpis">
        {kpis.error ? <StateBlock error={kpis.error} onRetry={kpis.reload} /> : <>
          <KpiCard testId="kpi-suppliers" label={tx('pos.total_suppliers')} loading={!k} value={k ? fmtNumber(k.totalSuppliers) : ''} sub={k ? tx('sup.kpi.suppliersSub', { i: fmtNumber(k.inactiveSuppliers), p: fmtNumber(k.preferredSuppliers) }) : ''} onClick={() => { setWork('directory'); setStatus('active'); }} />
          <KpiCard testId="kpi-active-pos" tone={k && k.activePurchaseOrders > 0 ? 'gold' : undefined} label={tx('pos.active_pos')} loading={!k} value={k ? fmtNumber(k.activePurchaseOrders) : ''} sub={k ? tx('sup.kpi.posSub', { d: fmtNumber(k.draftPurchaseOrders), t: fmtNumber(k.totalPurchaseOrders) }) : ''} onClick={() => { setWork('orders'); setPoStatus('active'); setUnlinked(false); }} />
          <KpiCard testId="kpi-open-value" label={tx('pos.open_po_value')} loading={!k} value={k ? (k.openPoValueCents == null ? '—' : money(k.openPoValueCents)) : ''} sub={k && k.draftValueCents != null ? tx('sup.kpi.valueSub', { d: money(k.draftValueCents) }) : tx('sup.kpi.valueSubHidden')} onClick={() => { setWork('orders'); setPoStatus('active'); }} />
          <KpiCard testId="kpi-brands" label={tx('pos.brands')} loading={!k} value={k ? fmtNumber(k.brands) : ''} sub={k ? tx('sup.kpi.brandsSub', { n: fmtNumber(k.brandsWithoutSupplier) }) : ''} onClick={() => nav('/tenant/inventory?tab=catalog')} />
        </>}
      </div>
      {k && (k.unlinkedPurchaseOrders || k.inactiveSupplierPurchaseOrders) ? <div className="fk-note warn" role="status" data-testid="legacy-note"><span>{tx('sup.legacyNote', { u: fmtNumber(k.unlinkedPurchaseOrders), i: fmtNumber(k.inactiveSupplierPurchaseOrders) })}</span>
        {k.unlinkedPurchaseOrders ? <button type="button" className="fk-link" onClick={() => { setWork('orders'); setUnlinked(true); setPoStatus(''); }} data-testid="show-unlinked">{tx('sup.showUnlinked')}</button> : null}</div> : null}
      <div className="fn-tabsrow sup-toolbar">
        <div className="fk-seg fn-tabs" role="tablist" aria-label={tx('sup.workspaces')}>
          {(['directory', 'orders'] as Work[]).map((w) => <button key={w} type="button" role="tab" aria-selected={work === w} className={work === w ? 'on' : ''} onClick={() => setWork(w)} data-testid={'work-' + w}>{tx('sup.work.' + w)}</button>)}
        </div>
        {work === 'directory' ? <>
          <div className="fn-search sup-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('sup.searchPh')} aria-label={tx('sup.searchPh')} data-testid="search" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
            {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}</div>
          <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status')} data-testid="status">{STATUS.map((x) => <option key={x} value={x}>{tx('sup.status.' + x)}</option>)}</select>
          <select className="fk-select" value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label={tx('pos.brand')} data-testid="brand"><option value="">{tx('prd.allBrands')}</option>{(brands.data?.brands ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('prd.sort')} data-testid="sort">{['newest', 'az', 'last_order'].map((x) => <option key={x} value={x}>{tx('sup.sort.' + x)}</option>)}</select>
        </> : <>
          <div className="fn-search sup-search"><input className="fk-search wide" type="search" value={poSearch} onChange={(e) => setPoSearch(e.target.value)} placeholder={tx('inv.searchPos')} aria-label={tx('inv.searchPos')} data-testid="po-search" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
            {poSearch ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setPoSearch('')}>✕</button> : null}</div>
          <select className="fk-select" value={poStatus} onChange={(e) => setPoStatus(e.target.value)} aria-label={tx('pos.status')} data-testid="po-status"><option value="">{tx('prd.allStatuses')}</option>{PO_STATUSES.map((x) => <option key={x} value={x}>{tx('inv.pos.' + x)}</option>)}</select>
          <label className="sa-check"><input type="checkbox" checked={unlinked} onChange={(e) => setUnlinked(e.target.checked)} data-testid="unlinked" />{tx('sup.noSupplierOnly')}</label>
        </>}
      </div>
      {work === 'orders' ? <div className="fn-tabsrow sup-periodrow"><PeriodBar value={poPeriod} onChange={setPoPeriod} server={pos.data?.period} allowAll compact basis={poField} basisOptions={['created', 'expected', 'approved', 'received'].map((f) => ({ value: f, label: tx('inv.podf.' + f) }))} onBasis={setPoField} /></div> : null}
      <div className={'sup-work' + (work === 'directory' && wide && sel && !overlay ? ' split' : '')}>
        {work === 'directory' ? <FitPanel testId="directory" bodyRef={fit.ref} className="fn-records" title={<span className="fn-chips">{tx('pos.supplier_directory')}{dir.data ? <span className="fk-muted"> · {fmtNumber(dir.data.total)}</span> : null}<span className="fk-hint">{tx('sup.dirHint')}</span></span>}
          footer={<Pager info={dir.data ? { page: dir.data.page, pageSize: dir.data.pageSize, totalItems: dir.data.total, totalPages: dir.data.pages } : null} onPage={setPage} label={tx('pos.supplier_directory')} />}>
          {dir.error ? <StateBlock error={dir.error} onRetry={dir.reload} /> : !dir.data ? <div className="fk-loading">{tx('pos.loading_suppliers')}</div>
            : rows.length === 0 ? (q || brandId || status !== 'active' ? <Empty title={tx('pos.no_suppliers_match')}><button type="button" className="fk-btn" onClick={clearDir}>{tx('finance.clearFilters')}</button></Empty>
              : <Empty title={tx('pos.no_suppliers_yet')}>{can('inventory.vendor.manage') ? <button type="button" className="fk-btn primary" onClick={() => setForm({ supplier: null })} data-testid="add-first">{tx('pos.add_your_first_supplier')}</button> : null}</Empty>)
            : <table className="fk-table fn-table sup-table" data-testid="directory-table">
              <thead><tr><th>{tx('pos.supplier')}</th><th>{tx('sup.col.contact')}</th><th className="t-opt">{tx('sup.col.phoneEmail')}</th><th className="num t-opt2">{tx('sup.col.brandsProducts')}</th><th className="num">{tx('sup.col.openPos')}</th><th className="t-opt">{tx('sup.col.lastOrder')}</th><th>{tx('pos.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
              <tbody>{rows.map((v) => <tr key={v.id} data-testid="supplier-row" className={(sel === v.id ? 'sel ' : '') + (!v.active ? 'sa-acked' : '')}>
                <td><button type="button" className="fk-li-t link" onClick={() => select(v.id)} data-testid="supplier-name">{v.name}</button><span className="fk-li-s">{[v.tradeName, v.code].filter(Boolean).join(' · ')}{v.matchedVia && q ? <span className="fk-chip info sm" data-testid="matched-via">{tx('sup.via.' + v.matchedVia)}</span> : null}</span></td>
                <td>{v.primaryContact ? <>{v.primaryContact.name}<span className="fk-li-s">{v.primaryContact.role ?? (v.primaryContact.source === 'supplier_record' ? tx('sup.fromRecord') : '')}</span></> : <span className="fk-muted">—</span>}</td>
                <td className="t-opt">{v.phone ?? '—'}<span className="fk-li-s">{v.email ?? ''}</span></td>
                <td className="num t-opt2">{fmtNumber(v.brands)} / {fmtNumber(v.products)}</td>
                <td className="num">{fmtNumber(v.openPurchaseOrders)}</td>
                <td className="t-opt">{v.lastOrderAt ? day(v.lastOrderAt) : <span className="fk-muted">{tx('sup.never')}</span>}</td>
                <td><span className={'fk-chip ' + (v.active ? 'ok' : 'mut')}>{v.active ? tx('sup.status.active') : tx('sup.status.inactive')}</span>{v.preferred ? <span className="fk-chip gold">{tx('inv.preferred')}</span> : null}</td>
                <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => select(v.id)} data-testid="view">{tx('sup.view')}</button>
                  {v.active && can('inventory.purchase_order.create') ? <button type="button" className="fk-btn ghost sm" onClick={() => nav(`/tenant/inventory?tab=purchaseOrders&new=1&vendorId=${encodeURIComponent(v.id)}`)} data-testid="draft-po">{tx('sup.draftPo')}</button> : null}</td>
              </tr>)}</tbody></table>}
        </FitPanel> : <FitPanel testId="orders" bodyRef={fit.ref} className="fn-records" title={<span className="fn-chips">{tx('pos.purchase_orders')}{pos.data ? <span className="fk-muted"> · {fmtNumber(pos.data.total)}</span> : null}<span className="fk-hint">{tx('sup.poHint')}</span></span>}
          footer={<Pager info={pos.data ? { page: pos.data.page, pageSize: pos.data.pageSize, totalItems: pos.data.total, totalPages: pos.data.pages } : null} onPage={setPoPage} label={tx('pos.purchase_orders')} />}>
          {pos.error ? <StateBlock error={pos.error} onRetry={pos.reload} /> : !pos.data ? <div className="fk-loading">{tx('pos.loading')}</div>
            : pos.data.rows.length === 0 ? <Empty title={tx('pos.no_purchase_orders_yet_create_and_1db3')} />
            : <PoTable rows={pos.data.rows} can={can} onView={(id) => { const r = pos.data.rows.find((x: any) => x.id === id); if (r && !r.vendorId && can('inventory.purchase_order.create')) setLinkPo(r); else setViewPo(id); }} />}
        </FitPanel>}
        {work === 'directory' && wide && sel && !overlay ? <section className="fk-panel sup-detail" data-testid="detail-panel">{detail}<button type="button" className="fk-x sup-detail-x" aria-label={tx('pos.close')} onClick={() => setSel(null)}>✕</button></section> : null}
      </div>
      {sel && overlay ? <FitDialog wide title={tx('pos.supplier_detail')} onClose={() => { setOverlay(false); if (!wide) setSel(null); }} testId="detail-overlay">{detail}</FitDialog> : null}
      {form ? <SupplierFormDialog supplier={form.supplier} onClose={() => setForm(null)} onSaved={saved} /> : null}
      {viewPo ? <PoDialog poId={viewPo} onClose={() => setViewPo(null)} /> : null}
      {linkPo ? <LinkPoDialog po={linkPo} onClose={() => setLinkPo(null)} onView={() => { setViewPo(linkPo.id); setLinkPo(null); }} onDone={() => { setLinkPo(null); refresh(); setNote({ tone: 'ok', text: tx('sup.poLinked') }); }} /> : null}
    </div>
  );
}

/** Supplier Details: header + six tabs. `compact` = the side panel (no outer dialog). */
function SupplierDetail({ vendorId, tick, can, nav, onChanged, onEdit, onViewPo, compact }: { vendorId: string; tick: number; can: (k: string) => boolean; nav: (to: string) => void; onChanged: () => void; onEdit: (s: any) => void; onViewPo: (id: string) => void; compact: boolean }) {
  const [tab, setTab] = useState<DTab>('overview'); const [mine, setMine] = useState(0);
  const d = useLoad(() => posSuppliersApi.supplier(vendorId), [vendorId, mine, tick]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [contact, setContact] = useState<{ c: any | null } | null>(null); const [linking, setLinking] = useState<{ row: any | null } | null>(null);
  const changed = () => { setMine((m) => m + 1); onChanged(); };
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); changed(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  if (d.error) return <StateBlock error={d.error} onRetry={d.reload} />;
  if (!d.data) return <div className="fk-loading">{tx('pos.loading')}</div>;
  const s = d.data.supplier; const o = d.data.overview; const manage = can('inventory.vendor.manage');
  const primary = d.data.contacts.find((c: any) => c.primary && c.active) ?? null;
  return <div className={'sup-d' + (compact ? ' compact' : '')} data-testid="supplier-detail">
    <div className="sup-d-head">
      <div style={{ minWidth: 0 }}><h2 data-testid="detail-name">{s.name}{s.preferred ? <span className="fk-chip gold">{tx('inv.preferred')}</span> : null}<span className={'fk-chip ' + (s.active ? 'ok' : 'mut')}>{s.active ? tx('sup.status.active') : tx('sup.status.inactive')}</span></h2>
        <div className="fk-li-s">{[primary ? primary.name : s.contactName, primary ? (primary.mobilePhone ?? primary.officePhone) : s.phone, primary?.email ?? s.email].filter(Boolean).join(' · ') || tx('sup.noContact')}</div></div>
      <div className="sup-d-acts">
        {manage ? <button type="button" className="fk-btn sm" onClick={() => onEdit(s)} data-testid="edit-supplier">{tx('pos.edit')}</button> : null}
        {s.active && can('inventory.purchase_order.create') ? <button type="button" className="fk-btn sm primary" onClick={() => nav(`/tenant/inventory?tab=purchaseOrders&new=1&vendorId=${encodeURIComponent(s.id)}`)} data-testid="detail-draft-po">{tx('sup.draftPo')}</button> : null}
        {manage && s.active ? <button type="button" className="fk-btn ghost sm" disabled={busy} onClick={() => act(() => inventoryApi.archiveVendor(s.id))} data-testid="deactivate">{tx('sup.deactivate')}</button> : null}
        {manage && !s.active ? <button type="button" className="fk-btn ghost sm" disabled={busy} onClick={() => act(() => posSuppliersApi.restore(s.id))} data-testid="reactivate">{tx('sup.reactivate')}</button> : null}
      </div>
    </div>
    <div className="fk-seg sup-dtabs" role="tablist" aria-label={tx('pos.supplier_detail')}>
      {DTABS.map((x) => <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)} data-testid={'dtab-' + x}>{tx('sup.dtab.' + x)}{x === 'contacts' ? ` (${d.data.contacts.filter((c: any) => c.active).length})` : ''}</button>)}
    </div>
    {err ? <div className="fk-error" role="alert" data-testid="detail-error">{err}</div> : null}
    <div className="sup-d-body">
      {tab === 'overview' ? <dl className="inv-dl" data-testid="detail-overview">
        <div><dt>{tx('sup.f.activeOrders')}</dt><dd>{fmtNumber(o.activeOrders)}<span className="fk-li-s">{tx('sup.draftsN', { n: fmtNumber(o.draftOrders) })}</span></dd></div>
        <div><dt>{tx('sup.f.lastOrder')}</dt><dd>{o.lastOrderAt ? day(o.lastOrderAt) : tx('sup.never')}</dd></div>
        <div><dt>{tx('sup.f.orderedThisYear')}</dt><dd>{o.orderedThisYearCents == null ? '—' : money(o.orderedThisYearCents)}<span className="fk-li-s">{tx('sup.orderedNote')}</span></dd></div>
        <div><dt>{tx('sup.f.lastReceived')}</dt><dd>{o.lastReceivedAt ? when(o.lastReceivedAt) : '—'}</dd></div>
        <div><dt>{tx('pos.lead_time')}</dt><dd>{s.leadTimeDays == null ? '—' : tx('inv.days', { n: fmtNumber(s.leadTimeDays) })}</dd></div>
        <div><dt>{tx('pos.payment_terms')}</dt><dd>{s.paymentTerms ?? '—'}</dd></div>
        <div><dt>{tx('sup.f.minimum')}</dt><dd>{s.minimumOrderCents == null ? '—' : money(s.minimumOrderCents)}</dd></div>
        <div><dt>{tx('sup.f.code')}</dt><dd>{s.code ?? '—'}</dd></div>
        <div className="wide"><dt>{tx('sup.f.address')}</dt><dd>{[s.address.street, s.address.city, s.address.state, s.address.postalCode, s.address.country].filter(Boolean).join(', ') || '—'}</dd></div>
        <div><dt>{tx('pos.website')}</dt><dd>{s.website ?? '—'}</dd></div>
        <div><dt>{tx('pos.account_2')}</dt><dd>{s.accountNumber ? '••••' + String(s.accountNumber).slice(-4) : '—'}</dd></div>
        <div className="wide"><dt>{tx('sup.f.copy')}</dt><dd className="sup-copy">{[s.phone, s.email, primary?.mobilePhone, primary?.email].filter(Boolean).map((v: string) => <button key={v} type="button" className="fk-btn ghost sm" onClick={() => { void navigator.clipboard?.writeText(v); }} data-testid="copy">{tx('sup.copy', { v })}</button>)}{![s.phone, s.email, primary?.mobilePhone, primary?.email].some(Boolean) ? '—' : null}</dd></div>
      </dl> : null}
      {tab === 'contacts' ? <>
        {manage ? <div className="sup-d-tools"><button type="button" className="fk-btn sm primary" onClick={() => setContact({ c: null })} data-testid="add-contact">{tx('sup.addContact')}</button></div> : null}
        {s.contactName || s.phone || s.email ? <div className="fk-hint" data-testid="record-contact">{tx('sup.recordContact', { v: [s.contactName, s.phone, s.email].filter(Boolean).join(' · ') })}</div> : null}
        {d.data.contacts.length === 0 ? <Empty title={tx('sup.noContacts')} /> :
          <table className="fk-table" data-testid="contacts-table"><thead><tr><th>{tx('sup.col.name')}</th><th>{tx('sup.col.phone')}</th><th>{tx('pos.email')}</th><th>{tx('sup.col.prefers')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{d.data.contacts.map((c: any) => <tr key={c.id} data-testid="contact-row" className={c.active ? '' : 'sa-acked'}><td><b>{c.name}</b>{c.primary ? <span className="fk-chip ok">{tx('sup.primary')}</span> : null}{!c.active ? <span className="fk-chip mut">{tx('sup.status.inactive')}</span> : null}<span className="fk-li-s">{c.role ?? ''}</span></td>
              <td>{c.mobilePhone ?? '—'}<span className="fk-li-s">{c.officePhone ?? ''}</span></td><td>{c.email ?? '—'}</td><td>{c.preferredMethod ? tx('sup.method.' + c.preferredMethod) : '—'}</td>
              <td className="fn-acts">{manage && c.active ? <><button type="button" className="fk-btn ghost sm" onClick={() => setContact({ c })} data-testid="edit-contact">{tx('pos.edit')}</button><button type="button" className="fk-btn ghost sm" disabled={busy} onClick={() => act(() => posSuppliersApi.deactivateContact(s.id, c.id))} data-testid="deactivate-contact">{tx('sup.deactivate')}</button></> : null}</td></tr>)}</tbody></table>}
      </> : null}
      {tab === 'products' ? <SupplierProducts vendorId={s.id} manage={manage} tick={mine} onLink={(row) => setLinking({ row })} onUnlink={(pid) => act(() => posSuppliersApi.unlinkProduct(s.id, pid))} busy={busy} /> : null}
      {tab === 'orders' ? <SupplierOrders vendorId={s.id} can={can} onView={onViewPo} /> : null}
      {tab === 'receiving' ? <SupplierReceiving vendorId={s.id} /> : null}
      {tab === 'notes' ? <div data-testid="detail-notes"><div className="sup-notes">{s.notes ? s.notes : <span className="fk-muted">{tx('sup.noNotes')}</span>}</div>
        {d.data.audit.length ? <><h3 className="fk-h3">{tx('inv.auditTrail')}</h3><ul className="inv-audit">{d.data.audit.map((a: any) => <li key={a.id}><b>{codeLabel('sup.audit.' + a.action, a.action)}</b><span className="fk-li-s">{when(a.at)} · {a.actor ?? tx('inv.system')}</span></li>)}</ul></> : null}
        <div className="fk-hint">{tx('sup.docsNote')}</div></div> : null}
    </div>
    {contact ? <ContactDialog vendorId={s.id} contact={contact.c} onClose={() => setContact(null)} onSaved={() => { setContact(null); changed(); }} /> : null}
    {linking ? <LinkProductDialog vendorId={s.id} row={linking.row} onClose={() => setLinking(null)} onSaved={() => { setLinking(null); changed(); }} /> : null}
  </div>;
}

function SupplierProducts({ vendorId, manage, tick, onLink, onUnlink, busy }: { vendorId: string; manage: boolean; tick: number; onLink: (row: any | null) => void; onUnlink: (pid: string) => void; busy: boolean }) {
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300); const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q]);
  const d = useLoad(() => posSuppliersApi.products(vendorId, { search: q || undefined, page, pageSize: 6 }), [vendorId, q, page, tick]);
  return <div data-testid="detail-products">
    <div className="sup-d-tools"><input className="fk-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('sup.searchProducts')} aria-label={tx('sup.searchProducts')} data-testid="products-search" />
      {manage ? <button type="button" className="fk-btn sm primary" onClick={() => onLink(null)} data-testid="link-product">{tx('sup.linkProduct')}</button> : null}</div>
    {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : d.data.rows.length === 0 ? <Empty title={tx('sup.noProducts')} /> :
      <table className="fk-table" data-testid="supplier-products"><thead><tr><th>{tx('pos.product')}</th><th>{tx('inv.col.supplierSku')}</th><th className="num">{tx('inv.col.lastCost')}</th><th className="t-opt">{tx('inv.col.pack')}</th><th className="num">{tx('inv.col.onHand')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
        <tbody>{d.data.rows.map((r: any) => <tr key={r.productId} data-testid="supplier-product-row"><td><b>{r.name}</b>{r.preferred ? <span className="fk-chip gold">{tx('inv.preferred')}</span> : null}<span className="fk-li-s">{[r.sku, r.brand, tx('sup.src.' + r.source)].filter(Boolean).join(' · ')}</span></td>
          <td>{r.supplierSku ?? '—'}</td><td className="num">{money(r.lastCostCents)}{r.priceHistoryCents.length > 1 ? <span className="fk-li-s">{tx('sup.history', { v: r.priceHistoryCents.map((c: number) => money(c)).join(' · ') })}</span> : null}</td>
          <td className="t-opt">{r.purchaseUnit ? tx('inv.packText', { u: r.purchaseUnit, n: fmtNumber(r.unitsPerPurchaseUnit ?? 1) }) : unitLabel(r.unit)}{r.leadTimeDays != null ? <span className="fk-li-s">{tx('inv.days', { n: fmtNumber(r.leadTimeDays) })}</span> : null}</td><td className="num">{fmtNumber(r.onHand)}</td>
          <td className="fn-acts">{manage ? <><button type="button" className="fk-btn ghost sm" onClick={() => onLink(r)} data-testid="edit-link">{r.linkId ? tx('pos.edit') : tx('sup.link')}</button>{r.linkId ? <button type="button" className="fk-btn ghost sm" disabled={busy} onClick={() => onUnlink(r.productId)} data-testid="unlink">{tx('sup.unlink')}</button> : null}</> : null}</td></tr>)}</tbody></table>}
    {d.data ? <Pager info={{ page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pages }} onPage={setPage} compact label={tx('sup.dtab.products')} /> : null}
    <div className="fk-hint">{tx('sup.productsNote')}</div>
  </div>;
}

function SupplierOrders({ vendorId, can, onView }: { vendorId: string; can: (k: string) => boolean; onView: (id: string) => void }) {
  const [page, setPage] = useState(1); const [period, setPeriod] = useState<PeriodState>({ preset: 'all' }); const [field, setField] = useState('created');
  const d = useLoad(() => posSuppliersApi.purchaseOrders(vendorId, { ...periodQuery(period), dateField: field, page, pageSize: 6 }), [vendorId, JSON.stringify(period), field, page]);
  return <div data-testid="detail-orders">
    <PeriodBar value={period} onChange={(p) => { setPeriod(p); setPage(1); }} server={d.data?.period} allowAll compact basis={field} basisOptions={['created', 'expected', 'approved', 'received'].map((f) => ({ value: f, label: tx('inv.podf.' + f) }))} onBasis={(f) => { setField(f); setPage(1); }} />
    {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : d.data.rows.length === 0 ? <Empty title={tx('pos.no_purchase_orders_for_this_supplier')} /> : <PoTable rows={d.data.rows} can={can} onView={onView} compact />}
    {d.data ? <Pager info={{ page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pages }} onPage={setPage} compact label={tx('sup.dtab.orders')} /> : null}
  </div>;
}

function SupplierReceiving({ vendorId }: { vendorId: string }) {
  const [page, setPage] = useState(1); const [period, setPeriod] = useState<PeriodState>({ preset: 'all' });
  const d = useLoad(() => posSuppliersApi.receiving(vendorId, { ...periodQuery(period), page, pageSize: 6 }), [vendorId, JSON.stringify(period), page]);
  return <div data-testid="detail-receiving">
    <PeriodBar value={period} onChange={(p) => { setPeriod(p); setPage(1); }} server={d.data?.period} allowAll compact />
    {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : d.data.rows.length === 0 ? <Empty title={tx('sup.noReceipts')} /> :
      <table className="fk-table" data-testid="receiving-table"><thead><tr><th>{tx('inv.col.when')}</th><th>{tx('pos.product')}</th><th className="num">{tx('inv.col.qty')}</th><th>PO</th><th className="t-opt">{tx('inv.col.by')}</th></tr></thead>
        <tbody>{d.data.rows.map((r: any) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.product}<span className="fk-li-s">{r.sku ?? ''}</span></td><td className="num">+{fmtNumber(r.quantity)}</td><td>{r.poNumber ?? '—'}</td><td className="t-opt">{r.receivedBy ?? '—'}</td></tr>)}</tbody></table>}
    {d.data ? <Pager info={{ page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pages }} onPage={setPage} compact label={tx('sup.dtab.receiving')} /> : null}
  </div>;
}

const EMPTY = { name: '', tradeName: '', supplierCode: '', contactName: '', phone: '', email: '', website: '', street: '', city: '', state: '', postalCode: '', country: '', accountNumber: '', paymentTerms: '', leadTimeDays: '', minimumOrder: '', notes: '', preferred: false };
/** Add / Edit Supplier — the duplicate warning shows the matching suppliers and asks before saving another. */
function SupplierFormDialog({ supplier, onClose, onSaved }: { supplier: any | null; onClose: () => void; onSaved: (id: string, createdNew: boolean) => void }) {
  const edit = !!supplier;
  const [f, setF] = useState(() => supplier ? { name: supplier.name ?? '', tradeName: supplier.tradeName ?? '', supplierCode: supplier.code ?? '', contactName: supplier.contactName ?? '', phone: supplier.phone ?? '', email: supplier.email ?? '', website: supplier.website ?? '',
    street: supplier.address?.street ?? '', city: supplier.address?.city ?? '', state: supplier.address?.state ?? '', postalCode: supplier.address?.postalCode ?? '', country: supplier.address?.country ?? '', accountNumber: '',
    paymentTerms: supplier.paymentTerms ?? '', leadTimeDays: supplier.leadTimeDays != null ? String(supplier.leadTimeDays) : '', minimumOrder: textFromCents(supplier.minimumOrderCents), notes: supplier.notes ?? '', preferred: !!supplier.preferred } : EMPTY);
  const set = (k: keyof typeof EMPTY) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [dups, setDups] = useState<Array<{ id: string; name: string; active: boolean }> | null>(null);
  const emailOk = !f.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const phoneOk = !f.phone.trim() || (f.phone.replace(/\D/g, '').length >= 7 && f.phone.replace(/\D/g, '').length <= 15);
  const leadOk = !f.leadTimeDays.trim() || /^\d{1,4}$/.test(f.leadTimeDays.trim());
  const minOk = !f.minimumOrder.trim() || centsFromText(f.minimumOrder) != null;
  const valid = !!f.name.trim() && emailOk && phoneOk && leadOk && minOk;
  const save = async (confirmDuplicate = false) => {
    if (!valid) return; setBusy(true); setErr(null);
    const body: Record<string, unknown> = { name: f.name.trim(), tradeName: f.tradeName.trim() || null, supplierCode: f.supplierCode.trim() || null, contactName: f.contactName.trim() || null, phone: f.phone.trim() || null, email: f.email.trim() || null,
      website: f.website.trim() || null, street: f.street.trim() || null, city: f.city.trim() || null, state: f.state.trim() || null, postalCode: f.postalCode.trim() || null, country: f.country.trim() || null,
      paymentTerms: f.paymentTerms.trim() || null, leadTimeDays: f.leadTimeDays.trim() || null, minimumOrderCents: f.minimumOrder.trim() ? centsFromText(f.minimumOrder) : null, notes: f.notes.trim() || null, preferred: f.preferred,
      ...(f.accountNumber.trim() ? { accountNumber: f.accountNumber.trim() } : {}), ...(confirmDuplicate ? { confirmDuplicate: true } : {}) };
    try {
      if (edit) { await inventoryApi.updateVendor(supplier.id, body); onSaved(supplier.id, false); }
      else { const r = await inventoryApi.createVendor(body); onSaved(r.id, true); }
    } catch (e) { const d = dupsOf(e); if (d) setDups(d); else setErr(errMsg(e)); setBusy(false); }
  };
  const input = (k: keyof typeof EMPTY, label: string, opts: { mode?: 'numeric' | 'decimal' | 'email' | 'tel'; ph?: string; testId?: string; bad?: boolean } = {}) =>
    <label className={'fk-field' + (opts.bad ? ' bad' : '')}><span>{label}</span><input value={String(f[k])} inputMode={opts.mode === 'email' ? 'email' : opts.mode === 'tel' ? 'tel' : opts.mode} type={opts.mode === 'email' ? 'email' : 'text'} placeholder={opts.ph} onChange={(e) => set(k)(e.target.value)} data-testid={opts.testId} aria-invalid={opts.bad || undefined} /></label>;
  return (
    <FitDialog wide title={edit ? tx('pos.edit_supplier') : tx('pos.add_supplier_2')} busy={busy} onClose={onClose} testId="supplier-form"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        {dups ? <button type="button" className="fk-btn primary" onClick={() => save(true)} disabled={busy} data-testid="save-anyway">{tx('sup.saveAnyway')}</button>
          : <button type="button" className="fk-btn primary" onClick={() => save(false)} disabled={!valid || busy} data-testid="supplier-save">{busy ? tx('pos.saving_2') : edit ? tx('pos.save_changes') : tx('pos.create_supplier')}</button>}</>}>
      {dups ? <div className="fk-note warn" role="alert" data-testid="dup-warning"><span>{tx('sup.dupWarning')}</span><ul>{dups.map((d) => <li key={d.id}>{d.name}{d.active ? '' : ' · ' + tx('sup.status.inactive')}</li>)}</ul></div> : null}
      <div className="inv-form">
        <section><h3 className="fk-h3">{tx('sup.form.business')}</h3>
          <label className="fk-field wide"><span>{tx('pos.supplier_name')}</span><input value={f.name} onChange={(e) => { set('name')(e.target.value); setDups(null); }} data-testid="sf-name" data-autofocus /></label>
          <div className="inv-row2">{input('tradeName', tx('sup.form.tradeName'))}{input('supplierCode', tx('sup.f.code'), { testId: 'sf-code' })}</div>
          <div className="inv-row2">{input('phone', tx('pos.phone'), { mode: 'tel', testId: 'sf-phone', bad: !phoneOk })}{input('email', tx('pos.email'), { mode: 'email', testId: 'sf-email', bad: !emailOk })}</div>
          <div className="inv-row2">{input('contactName', tx('pos.contact_name'))}{input('website', tx('pos.website'))}</div>
          {input('street', tx('sup.form.street'))}
          <div className="inv-row3">{input('city', tx('sup.form.city'))}{input('state', tx('sup.form.state'))}{input('postalCode', tx('sup.form.postal'))}</div>
          {input('country', tx('sup.form.country'))}
        </section>
        <section><h3 className="fk-h3">{tx('sup.form.purchasing')}</h3>
          <div className="inv-row2">{input('paymentTerms', tx('pos.payment_terms'), { ph: tx('pos.e_g_net_30') })}{input('leadTimeDays', tx('pos.lead_time_days'), { mode: 'numeric', bad: !leadOk })}</div>
          <div className="inv-row2">{input('minimumOrder', tx('sup.f.minimum'), { mode: 'decimal', bad: !minOk })}{input('accountNumber', tx('pos.account_number'), { ph: edit ? tx('sup.form.accountKeep') : undefined })}</div>
          <label className="sa-check"><input type="checkbox" checked={f.preferred} onChange={(e) => set('preferred')(e.target.checked)} data-testid="sf-preferred" />{tx('sup.form.preferred')}</label>
          <label className="fk-field"><span>{tx('pos.notes')}</span><textarea rows={4} maxLength={4000} value={f.notes} onChange={(e) => set('notes')(e.target.value)} /></label>
        </section>
      </div>
      {!emailOk ? <div className="fk-error" role="alert">{tx('errors.VENDOR_EMAIL_INVALID')}</div> : !phoneOk ? <div className="fk-error" role="alert">{tx('errors.VENDOR_PHONE_INVALID')}</div> : null}
      {err ? <div className="fk-error" role="alert" data-testid="supplier-form-error">{err}</div> : null}
    </FitDialog>
  );
}

function ContactDialog({ vendorId, contact, onClose, onSaved }: { vendorId: string; contact: any | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: contact?.name ?? '', role: contact?.role ?? '', mobilePhone: contact?.mobilePhone ?? '', officePhone: contact?.officePhone ?? '', email: contact?.email ?? '', preferredMethod: contact?.preferredMethod ?? '', primary: !!contact?.primary, notes: contact?.notes ?? '' });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const ph = (s: string) => !s.trim() || (s.replace(/\D/g, '').length >= 7 && s.replace(/\D/g, '').length <= 15);
  const valid = !!f.name.trim() && ph(f.mobilePhone) && ph(f.officePhone) && (!f.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()));
  const save = async () => {
    setBusy(true); setErr(null);
    const body = { name: f.name.trim(), role: f.role.trim() || null, mobilePhone: f.mobilePhone.trim() || null, officePhone: f.officePhone.trim() || null, email: f.email.trim() || null, preferredMethod: f.preferredMethod || null, primary: f.primary, notes: f.notes.trim() || null };
    try { if (contact) await posSuppliersApi.editContact(vendorId, contact.id, body); else await posSuppliersApi.addContact(vendorId, body); onSaved(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return <FitDialog title={contact ? tx('sup.editContact') : tx('sup.addContact')} busy={busy} onClose={onClose} testId="contact-form"
    footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={save} disabled={!valid || busy} data-testid="contact-save">{busy ? tx('pos.saving_2') : tx('pos.save_changes')}</button></>}>
    <div className="inv-row2"><label className="fk-field"><span>{tx('sup.col.name')}</span><input value={f.name} onChange={(e) => set('name')(e.target.value)} data-testid="cf-name" data-autofocus /></label><label className="fk-field"><span>{tx('sup.form.role')}</span><input value={f.role} onChange={(e) => set('role')(e.target.value)} /></label></div>
    <div className="inv-row2"><label className="fk-field"><span>{tx('sup.form.mobile')}</span><input inputMode="tel" value={f.mobilePhone} onChange={(e) => set('mobilePhone')(e.target.value)} data-testid="cf-mobile" /></label><label className="fk-field"><span>{tx('sup.form.office')}</span><input inputMode="tel" value={f.officePhone} onChange={(e) => set('officePhone')(e.target.value)} /></label></div>
    <div className="inv-row2"><label className="fk-field"><span>{tx('pos.email')}</span><input type="email" value={f.email} onChange={(e) => set('email')(e.target.value)} data-testid="cf-email" /></label>
      <label className="fk-field"><span>{tx('sup.col.prefers')}</span><select className="fk-select" value={f.preferredMethod} onChange={(e) => set('preferredMethod')(e.target.value)}><option value="">—</option>{['phone', 'mobile', 'email', 'text'].map((m) => <option key={m} value={m}>{tx('sup.method.' + m)}</option>)}</select></label></div>
    <label className="sa-check"><input type="checkbox" checked={f.primary} onChange={(e) => set('primary')(e.target.checked)} data-testid="cf-primary" />{tx('sup.form.primary')}</label>
    <label className="fk-field"><span>{tx('pos.notes')}</span><input value={f.notes} onChange={(e) => set('notes')(e.target.value)} maxLength={2000} /></label>
    {err ? <div className="fk-error" role="alert">{err}</div> : null}
  </FitDialog>;
}

function LinkProductDialog({ vendorId, row, onClose, onSaved }: { vendorId: string; row: any | null; onClose: () => void; onSaved: () => void }) {
  const [find, setFind] = useState(''); const fq = useDebounced(find.trim(), 250);
  const pick = useLoad(() => row ? Promise.resolve(null) : posInventoryScreenApi.products({ search: fq || undefined, page: 1, pageSize: 6 }), [fq, !!row]);
  const [chosen, setChosen] = useState<any | null>(row ? { id: row.productId, name: row.name, sku: row.sku } : null);
  const [f, setF] = useState({ supplierSku: row?.supplierSku ?? '', cost: textFromCents(row?.lastCostCents ?? null), purchaseUnit: row?.purchaseUnit ?? '', units: row?.unitsPerPurchaseUnit ? String(row.unitsPerPurchaseUnit) : '1', minQty: row?.minimumOrderQty ? String(row.minimumOrderQty) : '', lead: row?.leadTimeDays != null ? String(row.leadTimeDays) : '', preferred: !!row?.preferred });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const whole = (s: string, min: number) => !s.trim() || (/^\d{1,6}$/.test(s.trim()) && Number(s) >= min);
  const valid = !!chosen && (!f.cost || centsFromText(f.cost) != null) && whole(f.units, 1) && whole(f.minQty, 1) && whole(f.lead, 0);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await posSuppliersApi.linkProduct(vendorId, { productId: chosen.id, supplierSku: f.supplierSku.trim() || null, lastCostCents: f.cost ? centsFromText(f.cost) : null, purchaseUnit: f.purchaseUnit.trim() || null, unitsPerPurchaseUnit: f.units.trim() || 1, minimumOrderQty: f.minQty.trim() || null, leadTimeDays: f.lead.trim() || null, preferred: f.preferred }); onSaved(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return <FitDialog wide title={row ? tx('sup.editLink', { n: row.name }) : tx('sup.linkProduct')} busy={busy} onClose={onClose} testId="link-form"
    footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={save} disabled={!valid || busy} data-testid="link-save">{busy ? tx('pos.saving_2') : tx('pos.save_changes')}</button></>}>
    {chosen ? <div className="sa-chosen" data-testid="link-chosen"><b>{chosen.name}</b><span className="fk-li-s">{chosen.sku ?? '—'}</span>{!row ? <button type="button" className="fk-link" onClick={() => setChosen(null)}>{tx('sa.rec.change')}</button> : null}</div>
      : <><div className="fn-search"><input className="fk-search wide" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={tx('sup.findProduct')} aria-label={tx('sup.findProduct')} data-testid="link-find" data-autofocus /></div>
        {pick.error ? <StateBlock error={pick.error} onRetry={pick.reload} /> : <ul className="sa-picks" data-testid="link-picks">{(pick.data?.rows ?? []).map((p: any) => <li key={p.id}><button type="button" className="sa-pick" onClick={() => setChosen(p)} data-testid="link-pick"><b>{p.name}</b><span className="fk-li-s">{[p.sku, p.brand].filter(Boolean).join(' · ') || '—'}</span></button></li>)}</ul>}</>}
    <div className="inv-row3"><label className="fk-field"><span>{tx('inv.col.supplierSku')}</span><input value={f.supplierSku} onChange={(e) => set('supplierSku')(e.target.value)} data-testid="lf-sku" /></label>
      <label className="fk-field"><span>{tx('sup.form.cost')}</span><input inputMode="decimal" value={f.cost} onChange={(e) => set('cost')(e.target.value)} data-testid="lf-cost" /></label>
      <label className="fk-field"><span>{tx('sup.form.lead')}</span><input inputMode="numeric" value={f.lead} onChange={(e) => set('lead')(e.target.value)} /></label></div>
    <div className="inv-row3"><label className="fk-field"><span>{tx('sup.form.purchaseUnit')}</span><input value={f.purchaseUnit} onChange={(e) => set('purchaseUnit')(e.target.value)} placeholder={tx('sup.form.purchaseUnitPh')} /></label>
      <label className="fk-field"><span>{tx('sup.form.unitsPer')}</span><input inputMode="numeric" value={f.units} onChange={(e) => set('units')(e.target.value)} /></label>
      <label className="fk-field"><span>{tx('sup.form.minQty')}</span><input inputMode="numeric" value={f.minQty} onChange={(e) => set('minQty')(e.target.value)} /></label></div>
    <label className="sa-check"><input type="checkbox" checked={f.preferred} onChange={(e) => set('preferred')(e.target.checked)} />{tx('sup.form.preferredForProduct')}</label>
    <div className="fk-hint">{tx('sup.productsNote')}</div>
    {err ? <div className="fk-error" role="alert">{err}</div> : null}
  </FitDialog>;
}

/** An order with no supplier: keep its history, link it to a supplier record (explicit, audited) — or just view it. */
function LinkPoDialog({ po, onClose, onDone, onView }: { po: any; onClose: () => void; onDone: () => void; onView: () => void }) {
  const [find, setFind] = useState(''); const fq = useDebounced(find.trim(), 250);
  const d = useLoad(() => posSuppliersApi.directory({ search: fq || undefined, status: 'active', page: 1, pageSize: 6 }), [fq]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const link = async (vendorId: string) => { setBusy(true); setErr(null); try { await posSuppliersApi.linkPurchaseOrder(po.id, vendorId); onDone(); } catch (e) { setErr(errMsg(e)); setBusy(false); } };
  return <FitDialog title={tx('sup.linkPoTitle', { n: po.poNumber ?? '—' })} subtitle={tx('sup.linkPoSub')} busy={busy} onClose={onClose} testId="link-po"
    footer={<><button type="button" className="fk-btn" onClick={onView}>{tx('sup.viewOrder')}</button><button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></>}>
    <div className="fn-search"><input className="fk-search wide" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={tx('sup.searchPh')} aria-label={tx('sup.searchPh')} data-testid="link-po-find" data-autofocus /></div>
    {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : <ul className="sa-picks">{(d.data?.rows ?? []).map((v: any) => <li key={v.id}><button type="button" className="sa-pick" disabled={busy} onClick={() => link(v.id)} data-testid="link-po-pick"><b>{v.name}</b><span className="fk-li-s">{v.phone ?? v.email ?? ''}</span></button></li>)}</ul>}
    {err ? <div className="fk-error" role="alert">{err}</div> : null}
  </FitDialog>;
}
