// InventoryKit.tsx — Inventory / Products / Suppliers mandates (Oct 29 2026): the pieces POS Inventory (/tenant/inventory),
// Products (/tenant/products) and Suppliers (/tenant/inventory/vendors) share, so a product looks and behaves the same on
// every page:
//   StockChip            severity as colour AND text (Out · Critical · Low · In stock · Overstock)
//   ProductDetailsDialog Overview · Pricing · Inventory (bottles, lots, expiry) · Suppliers · Technician Usage (every
//                        technician who used it, every use — the Stock Alerts ledger) · History (stock movements + audit)
//   ProductFormDialog    Add / Edit product: identity, codes, units, pricing, stock rules (+ this location's overrides);
//                        a duplicate SKU / barcode is refused by the server and said so here
//   AddStockDialog       a documented receipt: quantity, lot, expiration, cost, note — one movement, never a duplicate product
// Usage history and Record Product Use come from the Stock Alerts screen (one usage system, never two).
import { useEffect, useMemo, useRef, useState } from 'react';
import { createIntentKeys } from '@aipowersalon/api-client';
import { outcomeUnknown } from './outcomeUnknown';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { inventoryApi, type InvDuplicatesResult, type InvStockPreview } from '../api/inventoryApi';
import { posInventoryScreenApi } from '../api/posInventoryScreenApi';
import { posInventoryAlertsApi } from '../api/posInventoryAlertsApi';
import { fmtMoney, fmtNumber, fmtInZone, fmtYmd } from '../i18n/format';
import { errorTextOf } from '../i18n/error-text';
import { codeLabel } from './peopleLabels';
import { FitDialog, Pager, Empty } from './FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, centsFromText, textFromCents, type PeriodState } from './FinanceKit';
import { LastUsed, AdjustDialog } from '../screens/POSInventoryAlertsScreen';

export const SEV_TONE: Record<string, string> = { out_of_stock: 'bad', critical: 'warn', low: 'info', in_stock: 'ok', overstock: 'mut' };
export const sevLabel = (s: string) => codeLabel('inv.sev.' + s, s);
export const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
export const day = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
export const ymd = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtYmd(v, { month: 'short', day: 'numeric', year: 'numeric' }, v) : tx('inv.notSet'));
export const money = (c?: number | null) => (c == null ? '—' : fmtMoney(c));
export const unitLabel = (u: string) => codeLabel('sa.unit.' + u, u);
export const errMsg = (e: unknown) => errorTextOf(e, tx('finance.state.loadFailed'));

export function StockChip({ severity, testId }: { severity: string; testId?: string }) {
  return <span className={'fk-chip ' + (SEV_TONE[severity] ?? 'mut')} data-testid={testId}>{sevLabel(severity)}</span>;
}

type DTab = 'overview' | 'pricing' | 'inventory' | 'suppliers' | 'usage' | 'history';
const DTABS: DTab[] = ['overview', 'pricing', 'inventory', 'suppliers', 'usage', 'history'];

/** Product Details overlay (bounded, internal scroll). Actions are offered only where the role allows them. */
export function ProductDetailsDialog({ productId, onClose, onChanged, can, onEdit, onAddStock, onRecordUse, onReorder, initialTab = 'overview' }: {
  productId: string; onClose: () => void; onChanged: () => void; can: (k: string) => boolean;
  onEdit?: (p: any) => void; onAddStock?: (p: any) => void; onRecordUse?: (productId: string) => void; onReorder?: (p: any) => void; initialTab?: DTab;
}) {
  const [tab, setTab] = useState<DTab>(initialTab); const [tick, setTick] = useState(0);
  const d = useLoad(() => posInventoryScreenApi.product(productId), [productId, tick]);
  const [busy, setBusy] = useState(false); const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const p = d.data?.product;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setNote(null);
    try { await fn(); setNote({ tone: 'ok', text: ok }); setTick((t) => t + 1); onChanged(); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } finally { setBusy(false); }
  };
  const archived = !!p?.archivedAt;
  return (
    <FitDialog wide title={p ? p.name : tx('inv.productDetails')} busy={busy} testId="product-details" onClose={onClose}
      subtitle={p ? <span>{[p.sku, p.brand, p.category].filter(Boolean).join(' · ') || '—'} · <StockChip severity={p.severity} />{archived ? <span className="fk-chip mut">{tx('inv.archived')}</span> : null}</span> : undefined}
      footer={p ? <>
        {!archived && onEdit && can('inventory.update') ? <button type="button" className="fk-btn" onClick={() => onEdit(p)} data-testid="pd-edit">{tx('pos.edit')}</button> : null}
        {!archived && onAddStock && can('inventory.stock.add') ? <button type="button" className="fk-btn" onClick={() => onAddStock(p)} data-testid="pd-add-stock">{tx('pos.add_stock_2')}</button> : null}
        {!archived && onRecordUse && can('inventory.product_usage.submit') ? <button type="button" className="fk-btn" onClick={() => onRecordUse(p.id)} data-testid="pd-record-use">{tx('sa.recordUse')}</button> : null}
        {!archived && onReorder && can('inventory.purchase_order.create') && p.suggestedReorder > 0 ? <button type="button" className="fk-btn" onClick={() => onReorder(p)} data-testid="pd-reorder">{tx('sa.reorder')}</button> : null}
        {archived && can('inventory.archive') ? <button type="button" className="fk-btn" disabled={busy} onClick={() => act(() => posInventoryScreenApi.restoreProduct(p.id), tx('inv.restored'))} data-testid="pd-restore">{tx('inv.restore')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></> : <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fk-seg inv-dtabs" role="tablist" aria-label={tx('inv.productDetails')}>
          {DTABS.map((x) => <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)} data-testid={'pd-tab-' + x}>{tx('inv.dtab.' + x)}</button>)}
        </div>
        {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="pd-note"><span>{note.text}</span></div> : null}
        {tab === 'overview' ? <Overview d={d.data} can={can} busy={busy} onRecount={() => act(() => posInventoryScreenApi.recountProduct(p.id), tx('inv.recounted'))} /> : null}
        {tab === 'pricing' ? <Pricing p={p} history={d.data.priceHistory ?? []} /> : null}
        {tab === 'inventory' ? <Bottles d={d.data} can={can} onChanged={() => { setTick((t) => t + 1); onChanged(); }} /> : null}
        {tab === 'suppliers' ? <Suppliers d={d.data} /> : null}
        {tab === 'usage' ? <Usage productId={productId} unit={p.unit} canAdjust={can('inventory.stock.adjust')} onChanged={onChanged} /> : null}
        {tab === 'history' ? <History productId={productId} audit={d.data.audit} /> : null}
      </>}
    </FitDialog>
  );
}

function Field({ k, v, testId }: { k: string; v: React.ReactNode; testId?: string }) { return <div><dt>{k}</dt><dd data-testid={testId}>{v ?? '—'}</dd></div>; }

function Overview({ d, can, busy, onRecount }: { d: any; can: (k: string) => boolean; busy: boolean; onRecount: () => void }) {
  const p = d.product;
  return <>
    <dl className="inv-dl" data-testid="pd-overview">
      <Field k={tx('inv.f.onHand')} v={<b>{fmtNumber(p.onHand)} {unitLabel(p.unit)}</b>} testId="pd-onhand" />
      <Field k={tx('inv.f.available')} v={fmtNumber(p.available)} />
      <Field k={tx('inv.f.openUnopened')} v={tx('inv.openUnopened', { o: fmtNumber(p.open), u: fmtNumber(p.unopened) })} />
      <Field k={tx('inv.f.reorderAt')} v={tx('inv.thresholds', { r: fmtNumber(p.reorderLevel), c: fmtNumber(p.criticalLevel) })} />
      <Field k={tx('inv.f.expiring')} v={p.expiring ? tx('inv.expiringN', { n: fmtNumber(p.expiring), d: ymd(p.nextExpiry) }) : p.nextExpiry ? ymd(p.nextExpiry) : '—'} />
      <Field k={tx('inv.f.expired')} v={p.expired ? <span className="fk-chip bad">{fmtNumber(p.expired)}</span> : '0'} />
      <Field k={tx('inv.f.supplier')} v={p.vendor ?? tx('inv.noSupplier')} />
      <Field k={tx('inv.f.lastActivity')} v={when(p.lastActivityAt)} />
      <div className="wide"><dt>{tx('sa.col.lastUsed')}</dt><dd><LastUsed r={p} testId="pd-last-used" /></dd></div>
      <Field k={tx('inv.f.identity')} v={[p.colorNumber ? '#' + p.colorNumber : null, p.colorName, p.finish, p.size].filter(Boolean).join(' · ') || '—'} />
      <Field k={tx('inv.f.codes')} v={[p.sku && 'SKU ' + p.sku, p.barcode && tx('inv.barcodeN', { b: p.barcode }), p.upc && 'UPC ' + p.upc].filter(Boolean).join(' · ') || '—'} />
      <Field k={tx('inv.f.created')} v={day(p.createdAt)} />
    </dl>
    {p.stockDrift ? <div className="fk-note warn" role="status" data-testid="pd-drift"><span>{tx('inv.driftNote', { c: fmtNumber(p.cachedOnHand), b: fmtNumber(p.onHand) })}</span>
      {can('inventory.stock.adjust') ? <button type="button" className="fk-btn sm" disabled={busy} onClick={onRecount} data-testid="pd-recount">{tx('inv.recount')}</button> : null}</div> : null}
  </>;
}

/** Products backlog · 11: one audited cost / retail change (integer cents; null before = no price was set) */
type PriceChangeRow = { id: string; at: string | null; actor: string | null; reason: string | null; retail: { before: number | null; after: number | null } | null; cost: { before: number | null; after: number | null } | null };
function PriceHistory({ rows }: { rows: PriceChangeRow[] }) {
  const ba = (x: { before: number | null; after: number | null }) => `${money(x.before)} → ${money(x.after)}`;
  return <div className="wide" data-testid="pd-price-history">
    <h3 className="fk-h3">{tx('inv.price.history')}</h3>
    {rows.length === 0 ? <div className="fk-hint">{tx('inv.price.none')}</div> :
      <ul className="inv-audit">{rows.map((r) => <li key={r.id} data-testid="price-change">
        <b>{[r.retail ? tx('inv.price.retailChange', { v: ba(r.retail) }) : null, r.cost ? tx('inv.price.costChange', { v: ba(r.cost) }) : null].filter(Boolean).join(' · ')}</b>
        <span className="fk-li-s">{when(r.at)} · {r.actor ?? tx('inv.system')}{r.reason ? ` · ${tx('inv.price.why', { r: r.reason })}` : ''}</span>
      </li>)}</ul>}
    <div className="fk-hint" data-testid="pd-price-receipts">{tx('inv.price.receiptsKeep')}</div>
  </div>;
}

function Pricing({ p, history }: { p: any; history: PriceChangeRow[] }) {
  return <dl className="inv-dl" data-testid="pd-pricing">
    <Field k={tx('inv.f.cost')} v={money(p.costCents)} /><Field k={tx('inv.f.retail')} v={money(p.retailCents)} />
    <Field k={tx('inv.f.margin')} v={p.marginCents == null ? '—' : money(p.marginCents)} /><Field k={tx('inv.f.retailItem')} v={p.isRetail ? tx('inv.yes') : tx('inv.no')} />
    <Field k={tx('inv.f.valueOnHand')} v={p.costCents == null ? '—' : money(p.costCents * Math.max(0, p.onHand - p.expired))} />
    <Field k={tx('inv.f.leadTime')} v={p.leadTimeDays == null ? '—' : tx('inv.days', { n: fmtNumber(p.leadTimeDays) })} />
    <div className="wide"><dt>{tx('inv.f.rules')}</dt><dd>{tx('inv.rulesText', { r: fmtNumber(p.thresholds.reorderLevel), c: fmtNumber(p.thresholds.criticalLevel), q: fmtNumber(p.reorderQuantity) })}
      {p.thresholds.reorderOverride != null || p.thresholds.criticalOverride != null ? <span className="fk-li-s">{tx('inv.overrideNote')}</span> : null}</dd></div>
    <PriceHistory rows={history} />
  </dl>;
}

type BottleAct = 'open' | 'empty' | 'low' | 'damaged' | 'expired' | 'missing' | 'found' | 'dispose';
// D9 gaps (Nov 5 2026): expired / missing / found / throw away follow the server's bottle rules
const BOTTLE_ACTIONS: Record<string, BottleAct[]> = { unopened: ['open', 'damaged', 'expired', 'missing'], opened: ['low', 'empty', 'damaged', 'expired', 'missing'], low: ['empty', 'damaged', 'expired', 'missing'], empty: ['dispose'], damaged: ['dispose'], expired: ['dispose'], missing: ['found'] };
// Missing / found change the count, so they need the stock-adjust permission
const ACT_PERM: Partial<Record<BottleAct, string>> = { missing: 'inventory.stock.adjust', found: 'inventory.stock.adjust' };
const BOTTLE_CALL: Record<BottleAct, (id: string) => Promise<unknown>> = { open: (id) => inventoryApi.openUnit(id), empty: (id) => inventoryApi.markEmpty(id), low: (id) => inventoryApi.markLow(id), damaged: (id) => inventoryApi.markDamaged(id), expired: (id) => inventoryApi.markExpired(id), missing: (id) => inventoryApi.markMissing(id), found: (id) => inventoryApi.markFound(id), dispose: (id) => inventoryApi.dispose(id) };
function Bottles({ d, can, onChanged }: { d: any; can: (k: string) => boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const run = async (id: string, a: BottleAct) => {
    setBusy(id); setErr(null);
    try { await BOTTLE_CALL[a](id); onChanged(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };
  if (!d.bottles.length) return <Empty title={tx('inv.noBottles')} />;
  // identical bottles (same state, lot, expiry, received day, opener) are one row with a count — an action applies to one
  // bottle of the group, so 58 sealed pairs of gloves are one line, not 58
  const groups: Array<{ key: string; ids: string[]; u: any }> = [];
  for (const u of d.bottles) {
    const k = [u.status, u.lot, u.expirationDate, (u.receivedAt ?? '').slice(0, 10), u.openedBy, u.remainingPercent, u.location].join('|');
    const g = groups.find((x) => x.key === k); if (g) g.ids.push(u.id); else groups.push({ key: k, ids: [u.id], u });
  }
  return <>
    {err ? <div className="fk-error" role="alert">{err}</div> : null}
    <table className="fk-table" data-testid="pd-bottles"><thead><tr><th>{tx('inv.col.state')}</th><th className="num">{tx('inv.col.count')}</th><th>{tx('inv.col.lot')}</th><th>{tx('inv.col.expires')}</th><th>{tx('inv.col.received')}</th><th className="t-opt">{tx('inv.col.opened')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
      <tbody>{groups.map(({ key, ids, u }) => <tr key={key} data-testid="bottle-row" className={['empty', 'disposed', 'sold', 'returned'].includes(u.status) ? 'sa-acked' : ''}>
        <td><span className={'fk-chip ' + (u.status === 'unopened' ? 'ok' : u.status === 'opened' || u.status === 'low' ? 'info' : 'mut')}>{codeLabel('inv.bottle.' + u.status, u.status)}</span>{u.remainingPercent != null && (u.status === 'opened' || u.status === 'low') ? <span className="fk-li-s">{tx('inv.remainingPct', { n: fmtNumber(u.remainingPercent) })}</span> : null}</td>
        <td className="num"><b>{fmtNumber(ids.length)}</b></td>
        <td>{u.lot ?? '—'}{u.barcode && ids.length === 1 ? <span className="fk-li-s">{u.barcode}</span> : null}</td>
        <td>{u.expirationDate ? ymd(u.expirationDate) : '—'}{u.expired ? <span className="fk-chip bad">{tx('inv.expired')}</span> : null}</td>
        <td>{day(u.receivedAt)}</td><td className="t-opt">{u.openedAt ? day(u.openedAt) : '—'}{u.openedBy ? <span className="fk-li-s">{u.openedBy}</span> : null}</td>
        <td className="fn-acts">{can('inventory.update') ? (BOTTLE_ACTIONS[u.status] ?? []).filter((a) => !ACT_PERM[a] || can(ACT_PERM[a]!)).map((a) => <button key={a} type="button" className="fk-btn ghost sm" disabled={busy === ids[0]} onClick={() => run(ids[0], a)} data-testid={'bottle-' + a} title={ids.length > 1 ? tx('inv.oneOfGroup') : undefined}>{tx('inv.bottleAct.' + a)}</button>) : null}</td>
      </tr>)}</tbody></table>
    <div className="fk-hint">{tx('inv.bottleNote')}</div>
  </>;
}

function Suppliers({ d }: { d: any }) {
  return <>
    {d.suppliers.length === 0 ? <Empty title={tx('inv.noSuppliersLinked')} /> :
      <table className="fk-table" data-testid="pd-suppliers"><thead><tr><th>{tx('inv.col.supplier')}</th><th>{tx('inv.col.supplierSku')}</th><th className="num">{tx('inv.col.lastCost')}</th><th>{tx('inv.col.pack')}</th><th>{tx('inv.col.lastOrdered')}</th></tr></thead>
        <tbody>{d.suppliers.map((s: any) => <tr key={s.id} data-testid="pd-supplier-row"><td><b>{s.name}</b>{s.preferred ? <span className="fk-chip ok">{tx('inv.preferred')}</span> : null}{!s.active ? <span className="fk-chip mut">{tx('inv.inactive')}</span> : null}<span className="fk-li-s">{[s.phone, s.email].filter(Boolean).join(' · ') || '—'}</span></td>
          <td>{s.supplierSku ?? '—'}</td><td className="num">{money(s.lastCostCents)}</td><td>{s.purchaseUnit ? tx('inv.packText', { u: s.purchaseUnit, n: fmtNumber(s.unitsPerPurchaseUnit ?? 1) }) : '—'}</td><td>{day(s.lastOrderedAt)}</td></tr>)}</tbody></table>}
    <h3 className="fk-h3">{tx('inv.recentOrders')}</h3>
    {d.purchaseOrders.length === 0 ? <div className="fk-hint">{tx('inv.noOrders')}</div> :
      <table className="fk-table" data-testid="pd-orders"><thead><tr><th>PO</th><th>{tx('inv.col.supplier')}</th><th>{tx('inv.col.status')}</th><th className="num">{tx('inv.col.received')}</th><th>{tx('inv.col.expected')}</th></tr></thead>
        <tbody>{d.purchaseOrders.map((o: any) => <tr key={o.id}><td><b>{o.poNumber ?? '—'}</b><span className="fk-li-s">{day(o.createdAt)}</span></td><td>{o.vendor ?? tx('inv.noSupplier')}</td><td>{codeLabel('inv.po.' + o.status, o.status)}</td><td className="num">{fmtNumber(o.received)} / {fmtNumber(o.ordered)}</td><td>{ymd(o.expectedDate)}</td></tr>)}</tbody></table>}
  </>;
}

/** Every technician who used the product and every use (the same ledger as Stock Alerts). */
function Usage({ productId, unit, canAdjust, onChanged }: { productId: string; unit: string; canAdjust: boolean; onChanged: () => void }) {
  const [period, setPeriod] = useState<PeriodState>({ preset: 'all' }); const [page, setPage] = useState(1); const [mine, setMine] = useState(0);
  const d = useLoad(() => posInventoryAlertsApi.ledger(productId, { ...periodQuery(period), page, pageSize: 6 }), [productId, JSON.stringify(period), page, mine]);
  const [adjust, setAdjust] = useState<any | null>(null);
  if (d.error) return <StateBlock error={d.error} onRetry={d.reload} />;
  if (!d.data) return <div className="fk-loading">{tx('pos.loading')}</div>;
  return <div data-testid="pd-usage">
    <div className="sa-last"><div><span className="fk-li-s">{tx('sa.col.lastUsed')}</span><LastUsed r={d.data} testId="pd-usage-last" /></div>
      <div><span className="fk-li-s">{tx('sa.lastRecorded')}</span><b>{d.data.lastRecordedAt ? when(d.data.lastRecordedAt) : '—'}</b></div></div>
    <PeriodBar value={period} onChange={(x) => { setPeriod(x); setPage(1); }} server={d.data.period} allowAll compact />
    <h3 className="fk-h3">{tx('sa.allTechs')}</h3>
    {d.data.byTechnician.length === 0 ? <div className="fk-hint">{tx('sa.noUse')}</div> :
      <table className="fk-table" data-testid="pd-by-tech"><thead><tr><th>{tx('sa.col.technician')}</th><th className="num">{tx('sa.col.used')}</th><th className="num">{tx('sa.col.uses')}</th><th>{tx('sa.col.lastAt')}</th></tr></thead>
        <tbody>{d.data.byTechnician.map((x: any) => <tr key={x.technicianId ?? 'unknown'}><td className={x.technicianId ? '' : 'fk-muted'}>{x.technicianId ? x.name : tx('sa.unknownTech')}</td><td className="num"><b>{x.used}</b> {unitLabel(unit)}</td><td className="num">{fmtNumber(x.uses)}</td><td>{when(x.lastUsedAt)}</td></tr>)}</tbody></table>}
    <h3 className="fk-h3">{tx('sa.events')} <span className="fk-muted">· {fmtNumber(d.data.total)}</span></h3>
    {d.data.events.length === 0 ? <div className="fk-hint">{tx('sa.noEvents')}</div> :
      <table className="fk-table"><thead><tr><th>{tx('sa.col.occurred')}</th><th>{tx('sa.col.technician')}</th><th className="num">{tx('sa.col.qty')}</th><th>{tx('sa.col.source')}</th><th className="t-opt">{tx('sa.col.recorded')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
        <tbody>{d.data.events.map((e: any) => <tr key={e.id} className={e.status === 'reversed' ? 'sa-acked' : ''}><td>{when(e.occurredAt)}</td><td className={e.technicianId ? '' : 'fk-muted'}>{e.technicianId ? e.technician : tx('sa.unknownTech')}</td>
          <td className="num"><b>{e.effective}</b>{e.corrected ? <span className="fk-li-s">{tx('sa.correctedFrom', { q: e.quantity })}</span> : null}</td><td>{codeLabel('sa.source.' + e.source, e.source)}</td><td className="t-opt">{when(e.recordedAt)}</td>
          <td className="fn-acts">{canAdjust && e.eventId && e.status !== 'reversed' ? <button type="button" className="fk-btn ghost sm" onClick={() => setAdjust(e)}>{tx('sa.correct')}</button> : null}</td></tr>)}</tbody></table>}
    <Pager info={{ page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pages }} onPage={setPage} compact label={tx('sa.events')} />
    {adjust ? <AdjustDialog event={adjust} unit={unit} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); setMine((m) => m + 1); onChanged(); }} /> : null}
  </div>;
}

function History({ productId, audit }: { productId: string; audit: any[] }) {
  const [page, setPage] = useState(1); const [period, setPeriod] = useState<PeriodState>({ preset: 'all' });
  const m = useLoad(() => posInventoryScreenApi.movements({ productId, ...periodQuery(period), page, pageSize: 6 }), [productId, page, JSON.stringify(period)]);
  return <div data-testid="pd-history">
    <PeriodBar value={period} onChange={(x) => { setPeriod(x); setPage(1); }} server={m.data?.period} allowAll compact />
    <h3 className="fk-h3">{tx('inv.movements')} {m.data ? <span className="fk-muted">· {fmtNumber(m.data.total)}</span> : null}</h3>
    {m.error ? <StateBlock error={m.error} onRetry={m.reload} /> : !m.data ? <div className="fk-loading">{tx('pos.loading')}</div> : m.data.rows.length === 0 ? <div className="fk-hint">{tx('inv.noMovements')}</div> :
      <table className="fk-table" data-testid="pd-movements"><thead><tr><th>{tx('inv.col.when')}</th><th>{tx('inv.col.movement')}</th><th className="num">{tx('inv.col.change')}</th><th className="num">{tx('inv.col.after')}</th><th className="t-opt">{tx('inv.col.by')}</th></tr></thead>
        <tbody>{m.data.rows.map((r: any) => <tr key={r.id} data-testid="movement-row"><td>{when(r.at)}</td><td>{codeLabel('inv.move.' + r.type, r.type)}{r.poNumber ? <span className="fk-li-s">{r.poNumber}</span> : r.reason ? <span className="fk-li-s">{r.reason}</span> : null}</td>
          <td className={'num ' + (r.change < 0 ? 'neg' : 'pos')}>{r.change > 0 ? '+' : ''}{fmtNumber(r.change)}</td><td className="num">{fmtNumber(r.after)}</td><td className="t-opt">{r.actor ?? '—'}</td></tr>)}</tbody></table>}
    {m.data ? <Pager info={{ page: m.data.page, pageSize: m.data.pageSize, totalItems: m.data.total, totalPages: m.data.pages }} onPage={setPage} compact label={tx('inv.movements')} /> : null}
    <h3 className="fk-h3">{tx('inv.auditTrail')}</h3>
    {audit.length === 0 ? <div className="fk-hint">{tx('inv.noAudit')}</div> :
      <ul className="inv-audit" data-testid="pd-audit">{audit.map((a) => <li key={a.id}><b>{codeLabel('inv.audit.' + a.action, a.action)}</b><span className="fk-li-s">{when(a.at)} · {a.actor ?? tx('inv.system')}</span></li>)}</ul>}
  </div>;
}

/** Add / Edit Product. Edit loads the product's details (thresholds with this location's overrides and its stock version). */
export function ProductFormDialog({ product, onClose, onSaved }: { product?: any | null; onClose: () => void; onSaved: (id: string) => void }) {
  const edit = !!product;
  const lookups = useLoad(async () => { const [c, b, v] = await Promise.all([inventoryApi.categories(), inventoryApi.brands(), inventoryApi.vendors()]); return { categories: c?.categories ?? [], brands: b?.brands ?? [], vendors: v?.vendors ?? [] }; }, []);
  const [f, setF] = useState(() => ({
    name: product?.name ?? '', brandId: product?.brandId ?? '', categoryId: product?.categoryId ?? '', colorNumber: product?.colorNumber ?? '', colorName: product?.colorName ?? '', finish: product?.finish ?? '',
    sku: product?.sku ?? '', barcode: product?.barcode ?? '', upc: product?.upc ?? '', unitType: product?.unit ?? 'bottle', trackingMode: product?.trackingMode ?? 'bottle',
    cost: textFromCents(product?.costCents), retail: textFromCents(product?.retailCents), isRetail: !!product?.isRetail,
    reorder: product ? String(product.thresholds?.baseReorderLevel ?? product.reorderLevel ?? 0) : '3', critical: product?.thresholds?.baseCriticalLevel != null ? String(product.thresholds.baseCriticalLevel) : '',
    reorderQty: product ? String(product.reorderQuantity ?? 0) : '6', max: product?.maximumStock != null ? String(product.maximumStock) : '', leadTime: product?.leadTimeDays != null ? String(product.leadTimeDays) : '',
    vendorId: product?.vendorId ?? '', trackExpiration: !!product?.trackExpiration,
    reorderOv: product?.thresholds?.reorderOverride != null ? String(product.thresholds.reorderOverride) : '', criticalOv: product?.thresholds?.criticalOverride != null ? String(product.thresholds.criticalOverride) : '',
  }));
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  // Products backlog · 11: an edit that changes the cost or retail price may say why — it goes into the price history
  const [priceReason, setPriceReason] = useState('');
  const priceChanged = edit && (centsFromText(f.cost) !== (product?.costCents ?? null) || centsFromText(f.retail) !== (product?.retailCents ?? null));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  // Products Management 07: possible duplicates (near SKU, barcode, supplier SKU, same name + size) — the server's answer, for
  // review; a NEW product shows them once before it is created and a second Save creates it anyway (an exact SKU / barcode
  // is still refused by the server)
  const [dups, setDups] = useState<InvDuplicatesResult['candidates'] | null>(null);
  const dupKey = `${f.name.trim()}|${f.sku.trim()}|${f.barcode.trim()}`;
  const [dupSeenFor, setDupSeenFor] = useState<string | null>(null);
  const checkDups = async (): Promise<InvDuplicatesResult['candidates']> => {
    const r = await inventoryApi.productDuplicates({ name: f.name.trim(), sku: f.sku.trim(), barcode: f.barcode.trim(), ...(edit ? { exceptId: product.id } : {}) });
    const c = Array.isArray(r?.candidates) ? r.candidates : [];
    setDups(c); setDupSeenFor(dupKey); return c;
  };
  const int = (s: string) => (s.trim() === '' ? null : /^\d{1,6}$/.test(s.trim()) ? Number(s.trim()) : NaN);
  const problems = useMemo(() => {
    const out: string[] = [];
    if (!f.name.trim()) out.push(tx('pos.product_name_is_required_2'));
    for (const [k, v] of [['reorder', f.reorder], ['critical', f.critical], ['reorderQty', f.reorderQty], ['max', f.max], ['leadTime', f.leadTime], ['reorderOv', f.reorderOv], ['criticalOv', f.criticalOv]] as const) if (Number.isNaN(int(v))) out.push(tx('inv.form.wholeNumber', { f: tx('inv.form.' + k) }));
    if ((f.cost && centsFromText(f.cost) == null) || (f.retail && centsFromText(f.retail) == null)) out.push(tx('inv.form.moneyInvalid'));
    const r = int(f.reorder) ?? 0; const c = int(f.critical);
    if (c != null && !Number.isNaN(c) && r > 0 && c > r) out.push(tx('pos.critical_level_should_be_at_or_mtcr'));
    return out;
  }, [f]);
  const save = async () => {
    if (problems.length) { setErr(problems[0]); return; }
    setBusy(true); setErr(null);
    if (!edit && dupSeenFor !== dupKey) {
      try { if ((await checkDups()).length) { setBusy(false); return; } }   // shown for review — Save again creates it anyway
      catch (e) { setErr(errMsg(e)); setBusy(false); return; }
    }
    const body: Record<string, unknown> = {
      name: f.name.trim(), brandId: f.brandId || null, categoryId: f.categoryId || null, colorNumber: f.colorNumber.trim() || null, colorName: f.colorName.trim() || null, finish: f.finish.trim() || null,
      sku: f.sku.trim() || null, barcode: f.barcode.trim() || null, upc: f.upc.trim() || null, unitType: f.unitType, trackingMode: f.trackingMode,
      isRetail: f.isRetail,
      reorderLevel: int(f.reorder) ?? 0, criticalLevel: int(f.critical), reorderQuantity: int(f.reorderQty) ?? 0, maximumStock: int(f.max), leadTimeDays: int(f.leadTime),
      preferredVendorId: f.vendorId || null, trackExpiration: f.trackExpiration,
    };
    // an edit sends a price only when it changed — a viewer whose prices are hidden (shown blank) never wipes them
    const costCents = f.cost ? centsFromText(f.cost) : null, retailCents = f.retail ? centsFromText(f.retail) : null;
    if (!edit || costCents !== (product?.costCents ?? null)) body.costCents = costCents;
    if (!edit || retailCents !== (product?.retailCents ?? null)) body.retailPriceCents = retailCents;
    try {
      let id = product?.id as string | undefined;
      // concurrent-edit protection: the save carries the updatedAt this form opened with; a product changed elsewhere since
      // then is refused by the server (409 PRODUCT_CHANGED) and the message asks to reload instead of overwriting it
      if (edit && priceChanged && priceReason.trim()) body.priceChangeReason = priceReason.trim();
      if (edit) await inventoryApi.updateProduct(product.id, product.updatedAt ? { ...body, expectedUpdatedAt: product.updatedAt } : body);
      else id = (await inventoryApi.createProduct(body)).id;
      if (edit && (f.reorderOv !== (product.thresholds?.reorderOverride == null ? '' : String(product.thresholds.reorderOverride)) || f.criticalOv !== (product.thresholds?.criticalOverride == null ? '' : String(product.thresholds.criticalOverride))))
        await inventoryApi.setStockOverrides(product.id, { reorderLevelOverride: f.reorderOv.trim() || null, criticalLevelOverride: f.criticalOv.trim() || null, expectedVersion: product.stockVersion ?? undefined });
      onSaved(String(id));
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const L = lookups.data;
  const input = (k: keyof typeof f, label: string, opts: { mode?: 'numeric' | 'decimal'; ph?: string; testId?: string } = {}) =>
    <label className="fk-field"><span>{label}</span><input value={String(f[k])} inputMode={opts.mode} placeholder={opts.ph} onChange={(e) => set(k)(e.target.value)} data-testid={opts.testId} /></label>;
  return (
    <FitDialog wide title={edit ? tx('inv.form.editTitle', { n: product.name }) : tx('pos.add_product_2')} busy={busy} onClose={onClose} testId="product-form"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={save} disabled={busy} data-testid="product-save">{busy ? tx('pos.saving_2') : edit ? tx('pos.save_changes') : tx('pos.create_product')}</button></>}>
      <div className="inv-form">
        <section><h3 className="fk-h3">{tx('inv.form.identity')}</h3>
          <label className="fk-field wide"><span>{tx('pos.product_name')}</span><input value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder={tx('pos.e_g_dnd_gel_polish_428')} data-testid="pf-name" data-autofocus /></label>
          <div className="inv-row2">
            <label className="fk-field"><span>{tx('pos.brand')}</span><select className="fk-select" value={f.brandId} onChange={(e) => set('brandId')(e.target.value)} data-testid="pf-brand"><option value="">—</option>{(L?.brands ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="fk-field"><span>{tx('pos.category')}</span><select className="fk-select" value={f.categoryId} onChange={(e) => set('categoryId')(e.target.value)}><option value="">—</option>{(L?.categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          </div>
          <div className="inv-row3">{input('colorNumber', tx('pos.color_number'), { ph: '428' })}{input('colorName', tx('pos.color_name'))}{input('finish', tx('pos.finish'))}</div>
          <div className="inv-row3">{input('sku', 'SKU', { testId: 'pf-sku' })}{input('barcode', tx('pos.barcode'), { testId: 'pf-barcode' })}{input('upc', 'UPC')}</div>
          <button type="button" className="fk-btn" data-testid="pf-dup-check" disabled={busy} onClick={() => { checkDups().catch((e) => setErr(errMsg(e))); }}>{tx('inv.dup.check')}</button>
          {dups && dupSeenFor === dupKey ? (dups.length === 0 ? <div className="fk-li-s" data-testid="pf-dups-none">{tx('inv.dup.none')}</div> : (
            <div data-testid="pf-dups" role="status" style={{ border: "1px solid #E8C48A", background: "#FFF7E8", borderRadius: 8, padding: 8, margin: "6px 0", fontSize: 12 }}>
              <b>{tx('inv.dup.title', { n: String(dups.length) })}</b>
              {dups.map((c) => <div key={c.productId} data-testid={`pf-dup-${c.productId}`}>{c.name}{c.sku ? ' ' + tx('inv.dup.sku', { sku: c.sku }) : ''} — {c.reasons.map((r) => codeLabel(`inv.dup.reason.${r}`, r) + (r === 'supplier_sku' && c.supplierSku ? ` ${c.supplierSku}${c.supplierName ? ` (${c.supplierName})` : ''}` : '')).join(', ')}</div>)}
              {!edit ? <div className="fk-li-s">{tx('inv.dup.saveAnyway')}</div> : null}
            </div>)) : null}
          <div className="inv-row2">
            <label className="fk-field"><span>{tx('inv.form.unit')}</span><select className="fk-select" value={f.unitType} onChange={(e) => set('unitType')(e.target.value)}>{['bottle', 'jar', 'tube', 'piece', 'pair', 'pack', 'box', 'ml', 'g'].map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</select></label>
            <label className="fk-field"><span>{tx('pos.tracking')}</span><select className="fk-select" value={f.trackingMode} onChange={(e) => set('trackingMode')(e.target.value)}><option value="bottle">{tx('pos.individual_bottles')}</option><option value="quantity">{tx('pos.quantity_only')}</option></select></label>
          </div>
        </section>
        <section><h3 className="fk-h3">{tx('inv.form.pricing')}</h3>
          <div className="inv-row2">{input('cost', tx('pos.cost_3'), { mode: 'decimal', ph: '4.50', testId: 'pf-cost' })}{input('retail', tx('pos.retail_2'), { mode: 'decimal', testId: 'pf-retail' })}</div>
          {priceChanged ? <label className="fk-field wide"><span>{tx('inv.price.reasonLabel')}</span><input value={priceReason} maxLength={300} onChange={(e) => setPriceReason(e.target.value)} placeholder={tx('inv.price.reasonPh')} data-testid="pf-price-reason" /></label> : null}
          <label className="sa-check"><input type="checkbox" checked={f.isRetail} onChange={(e) => set('isRetail')(e.target.checked)} />{tx('inv.form.isRetail')}</label>
          <h3 className="fk-h3">{tx('inv.form.stock')}</h3>
          <div className="inv-row3">{input('reorder', tx('inv.form.reorder'), { mode: 'numeric', testId: 'pf-reorder' })}{input('critical', tx('inv.form.critical'), { mode: 'numeric', ph: tx('pos.auto_reorder') })}{input('reorderQty', tx('inv.form.reorderQty'), { mode: 'numeric' })}</div>
          <div className="inv-row2">{input('max', tx('inv.form.max'), { mode: 'numeric', ph: tx('pos.none_4') })}{input('leadTime', tx('inv.form.leadTime'), { mode: 'numeric' })}</div>
          <label className="fk-field"><span>{tx('pos.preferred_vendor')}</span><select className="fk-select" value={f.vendorId} onChange={(e) => set('vendorId')(e.target.value)}><option value="">{tx('pos.none_3')}</option>{(L?.vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
          <label className="sa-check"><input type="checkbox" checked={f.trackExpiration} onChange={(e) => set('trackExpiration')(e.target.checked)} />{tx('inv.form.trackExpiration')}</label>
          {edit ? <><h3 className="fk-h3">{tx('pos.overrides_for_current_branch')}</h3><div className="inv-row2">{input('reorderOv', tx('inv.form.reorderOv'), { mode: 'numeric', ph: tx('pos.use_tenant_default') })}{input('criticalOv', tx('inv.form.criticalOv'), { mode: 'numeric', ph: tx('pos.use_tenant_default') })}</div></> : null}
        </section>
      </div>
      {lookups.error ? <div className="fk-hint">{tx('inv.form.lookupsFailed')}</div> : null}
      {err ? <div className="fk-error" role="alert" data-testid="product-form-error">{err}</div> : null}
    </FitDialog>
  );
}

/** Add Stock: a documented receipt (manual add). A PO receipt goes through Receive on the purchase order instead. */
export function AddStockDialog({ product, onClose, onSaved }: { product: { id: string; name: string; unit?: string; onHand?: number; costCents?: number | null; trackExpiration?: boolean }; onClose: () => void; onSaved: (r: any) => void }) {
  const [qty, setQty] = useState('6'); const [lot, setLot] = useState(''); const [exp, setExp] = useState(''); const [cost, setCost] = useState(textFromCents(product.costCents ?? null)); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const sent = useRef(false);
  // round 10 (Inventory 10): one key per intended receipt — a retry after an unknown outcome reuses it (the server answers from
  // the first save); changing what is being added makes a new one
  const keys = useRef(createIntentKeys()); const [unsure, setUnsure] = useState(false);
  const n = /^\d{1,4}$/.test(qty.trim()) ? Number(qty.trim()) : 0;
  const valid = n >= 1 && n <= 1000 && (!cost || centsFromText(cost) != null) && (!exp || /^\d{4}-\d{2}-\d{2}$/.test(exp));
  // Products Management 09: the server's preview for this location — now / coming / after / after + coming and the status of
  // each by THE stock status rule (never re-derived here); unavailable → the simple before → after subtitle only
  const [pv, setPv] = useState<InvStockPreview | null>(null);
  useEffect(() => {
    if (n < 1 || n > 1000) { setPv(null); return; }
    let live = true;
    const h = setTimeout(() => { inventoryApi.stockPreview(product.id, n).then((r) => { if (live) setPv(r ?? null); }).catch(() => { if (live) setPv(null); }); }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [product.id, n]);
  const save = async () => {
    if (!valid || sent.current) return; sent.current = true; setBusy(true); setErr(null);
    const body = { quantity: n, lotNumber: lot.trim() || null, expirationDate: exp || null, costCents: cost ? centsFromText(cost) : null, note: note.trim() || null };
    const intent = `add:${product.id}`;
    try { const r = await inventoryApi.addStock(product.id, body, keys.current.keyFor(intent, body)); keys.current.done(intent); setUnsure(false); onSaved(r); }
    catch (e) { sent.current = false; setUnsure(outcomeUnknown(e)); setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <FitDialog title={tx('inv.addStockTitle', { n: product.name })} subtitle={product.onHand != null ? tx('inv.addStockSub', { n: fmtNumber(product.onHand), after: fmtNumber((product.onHand ?? 0) + n), u: unitLabel(product.unit ?? 'unit') }) : undefined} busy={busy} onClose={onClose} testId="add-stock"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={save} disabled={!valid || busy} data-testid="add-stock-save">{busy ? tx('pos.saving_2') : tx('pos.add_to_inventory')}</button></>}>
      <label className="fk-field"><span>{tx('pos.number_of_bottles_units')}</span><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="add-stock-qty" data-autofocus /></label>
      <div className="inv-row2"><label className="fk-field"><span>{tx('pos.lot_number')}</span><input value={lot} onChange={(e) => setLot(e.target.value)} placeholder={tx('pos.optional_3')} /></label>
        <label className="fk-field"><span>{tx('pos.expiration')}</span><input type="date" value={exp} onChange={(e) => setExp(e.target.value)} data-testid="add-stock-exp" /></label></div>
      <div className="inv-row2"><label className="fk-field"><span>{tx('inv.unitCost')}</span><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
        <label className="fk-field"><span>{tx('pos.note')}</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={tx('pos.optional_3')} /></label></div>
      {pv && pv.quantity === n ? (
        <div data-testid="add-stock-preview" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, margin: '6px 0', fontSize: 12 }}>
          <b>{tx('inv.pv.title', { b: pv.branch.name || '—', u: unitLabel(pv.unit) })}</b>
          {([['now', pv.onHand, pv.statusNow], ['after', pv.afterAdd, pv.statusAfter], ['afterIncoming', pv.afterAddAndIncoming, pv.statusAfterIncoming]] as const).map(([k, v, st]) => (
            <div key={k} data-testid={`add-stock-pv-${k}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><span>{tx('inv.pv.' + k)}</span><span><b>{fmtNumber(v)}</b> <StockChip severity={st} /></span></div>))}
          <div data-testid="add-stock-pv-incoming" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{tx('inv.pv.incoming')}</span><b>{fmtNumber(pv.incoming)}</b></div>
          <div className="fk-li-s" data-testid="add-stock-pv-levels">{tx('inv.pv.levels', { r: fmtNumber(pv.reorderLevel), c: fmtNumber(pv.criticalLevel), m: pv.maximumStock != null ? fmtNumber(pv.maximumStock) : '—' })}</div>
          {pv.clearsReorder ? <div data-testid="add-stock-pv-clears">{tx('inv.pv.clears')}</div> : null}
          {pv.overMaximum ? <div data-testid="add-stock-pv-over" style={{ color: '#A8321F' }}>{tx('inv.pv.over')}</div> : null}
        </div>) : null}
      <div className="fk-hint">{tx('inv.addStockNote')}</div>
      {err ? <div className="fk-error" role="alert">{err}</div> : null}
      {unsure ? <div className="fk-note warn" role="status" data-testid="add-stock-unsure"><span>{tx('inv.retrySafe')}</span></div> : null}
    </FitDialog>
  );
}

/** Edit from a list row: load the product's details (thresholds, overrides, stock version) first, then the form. */
export function EditProductDialog({ productId, onClose, onSaved }: { productId: string; onClose: () => void; onSaved: (id: string) => void }) {
  const d = useLoad(() => posInventoryScreenApi.product(productId), [productId]);
  if (d.data) return <ProductFormDialog product={d.data.product} onClose={onClose} onSaved={onSaved} />;
  return <FitDialog title={tx('pos.edit')} onClose={onClose} testId="product-form-loading">{d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : <div className="fk-loading">{tx('pos.loading')}</div>}</FitDialog>;
}
