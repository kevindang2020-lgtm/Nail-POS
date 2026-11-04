// POSInventoryAlertsScreen.tsx — Inventory → Stock Alerts (/tenant/inventory/alerts). Stock Alerts + Technician Product Usage
// mandate (Oct 29 2026): ONE full-screen page at 100 % zoom — header (Refresh · Record Product Use · View Inventory · Create
// Purchase Order · Alert Settings) · five KPIs from the server (Open Alerts — the SAME number as the sidebar badge · Out of Stock
// · Critical · Product Uses Today · Active Technicians) · four workspaces (Active Alerts · Product Usage · All Technicians ·
// Alert History) with one universal search (product, SKU, barcode, brand, category, vendor name / phone, PO number,
// technician), server paging newest first, and "Last Used By" on every product — the latest effective use by when it
// happened (never updated_at), "No recorded use" when there is none · a product overlay (every technician who used it, every
// use, corrections) · Record Product Use (product → technician → amount → stock before / after → confirm once, one idempotency
// key; a correction is a signed adjustment with a reason, never an edit).
// What was wrong: the sidebar counted products at their base reorder level (11) while this page listed persisted alert rows
// that are only written when a product CROSSES a threshold — products already low never got one (0, "inventory is healthy").
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { createIntentKeys } from '@aipowersalon/api-client';
import { posInventoryAlertsApi } from '../api/posInventoryAlertsApi';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { errorTextOf } from '../i18n/error-text';
import { useCan } from '../components/usePermissions';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';

type Tab = 'active' | 'usage' | 'technicians' | 'history';
const TABS: Tab[] = ['active', 'usage', 'technicians', 'history'];
const SEVERITIES = ['out_of_stock', 'critical', 'low'];
const SEV_TONE: Record<string, string> = { out_of_stock: 'bad', critical: 'warn', low: 'info' };
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const sevLbl = (s: string) => codeLabel('sa.sev.' + s, s);
const sourceLbl = (s: string) => codeLabel('sa.source.' + s, s);
const errMsg = (e: unknown) => errorTextOf(e, tx('finance.state.loadFailed'));
const unitLbl = (u: string) => codeLabel('sa.unit.' + u, u);

/** "Last Used By" as the page shows it everywhere: who, when, how much — or "No recorded use". */
export function LastUsed({ r, testId }: { r: { lastUsedAt: string | null; lastUsedLabel: string; lastUsedQuantity?: string | null; lastUsedTechnicianId?: string | null }; testId?: string }) {
  if (!r.lastUsedAt) return <span className="fk-muted" data-testid={testId}>{tx('sa.noUse')}</span>;
  const unknown = !r.lastUsedTechnicianId;
  return <span data-testid={testId}><b className={unknown ? 'fk-muted' : ''}>{unknown ? tx('sa.unknownTech') : r.lastUsedLabel}</b><span className="fk-li-s">{when(r.lastUsedAt)}{r.lastUsedQuantity ? ' · ' + r.lastUsedQuantity : ''}</span></span>;
}

export function POSInventoryAlertsScreen() {
  const nav = useNavigate(); const can = useCan();
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [severity, setSeverity] = useState(''); const [showAck, setShowAck] = useState(false);
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' }); const [basis, setBasis] = useState('occurred');
  const [page, setPage] = useState(1); const [tick, setTick] = useState(0);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string; eventId?: string; productId?: string } | null>(null);
  const [product, setProduct] = useState<string | null>(null); const [recording, setRecording] = useState<{ productId?: string } | null>(null);
  const [busyAck, setBusyAck] = useState<string | null>(null); const [exporting, setExporting] = useState(false);
  const scope = { search: q || undefined, ...(tab === 'active' ? { severity: severity || undefined, showAcknowledged: showAck ? 'true' : undefined } : {}),
    ...(tab === 'history' ? { severity: severity || undefined } : {}), ...(tab !== 'active' ? { ...periodQuery(period), ...(tab !== 'history' ? { dateBasis: basis } : {}) } : {}) };
  const key = tab + JSON.stringify(scope); useEffect(() => { setPage(1); }, [key]);
  const fit = useFitRows<HTMLDivElement>(46, { min: 3, max: 18, reserve: 34 });
  const sum = useLoad(() => posInventoryAlertsApi.summary(), [tick]);
  const list = useLoad(() => {
    const qq = { ...scope, page, pageSize: fit.rows };
    return tab === 'active' ? posInventoryAlertsApi.active(qq) : tab === 'usage' ? posInventoryAlertsApi.usage(qq) : tab === 'technicians' ? posInventoryAlertsApi.technicians(qq) : posInventoryAlertsApi.history(qq);
  }, [key, page, fit.rows, tick]);
  useEffect(() => { if (list.data && list.data.page !== page) setPage(list.data.page); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const k = sum.data; const rows: any[] = list.data?.rows ?? [];
  const canRecord = can('inventory.product_usage.submit'); const canAdjust = can('inventory.stock.adjust');
  const refresh = () => setTick((t) => t + 1);
  const acknowledge = async (productId: string) => {
    setBusyAck(productId);
    try { await posInventoryAlertsApi.acknowledge(productId); setNote({ tone: 'ok', text: tx('sa.acked') }); refresh(); window.dispatchEvent(new CustomEvent('aps:nav-counts-changed')); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } finally { setBusyAck(null); }
  };
  const doExport = async () => {
    setExporting(true);
    try { const csv = await posInventoryAlertsApi.exportCsv({ tab, ...scope }); const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `stock-alerts-${tab}.csv`; a.click(); URL.revokeObjectURL(a.href); setNote({ tone: 'ok', text: tx('finance.exported') }); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } finally { setExporting(false); }
  };
  const recorded = (r: any) => {
    setRecording(null); refresh(); window.dispatchEvent(new CustomEvent('aps:nav-counts-changed'));
    setNote({ tone: r?.replay ? 'warn' : 'ok', text: r?.replay ? tx('sa.rec.replayed') : tx('sa.rec.done', { q: r?.event?.quantity ?? '', p: r?.event?.productName ?? '', t: r?.event?.technicianName ?? '' }), eventId: r?.event?.id, productId: r?.event?.productId });
    if (tab === 'usage' || tab === 'technicians') setPage(1);
  };
  const chips = [...(q ? [{ label: tx('rv.chip.search', { q }), clear: () => setSearch('') }] : []), ...(severity && (tab === 'active' || tab === 'history') ? [{ label: sevLbl(severity), clear: () => setSeverity('') }] : [])];
  const clearAll = () => { setSearch(''); setSeverity(''); setShowAck(false); setPeriod({ preset: 'month' }); setBasis('occurred'); };
  if (isForbidden(sum.error)) return <div className="work fit sa" data-testid="stock-alerts-screen"><h1>{tx('pos.stock_alerts')}</h1><StateBlock error={sum.error} onRetry={sum.reload} /></div>;
  const head = (tab === 'active' ? ['product', 'severity', 'onHand', 'reorder', 'lastUsed', 'since', ''] : tab === 'usage' ? ['product', 'used', 'uses', 'technicians', 'onHand', 'lastUsed', ''] : tab === 'technicians' ? ['technician', 'uses', 'products', 'used', 'lastProduct', 'lastAt'] : ['product', 'severity', 'onHandAt', 'created', 'state', 'ackBy']);
  return (
    <div className="work fit sa" data-testid="stock-alerts-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.stock_alerts')}</h1><div className="sub">{tx('sa.subtitle')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={refresh} data-testid="refresh">{tx('finance.refresh')}</button>
          {canRecord ? <button type="button" className="fk-btn primary" onClick={() => setRecording({})} data-testid="record-use">{tx('sa.recordUse')}</button> : null}
          <button type="button" className="fk-btn" onClick={() => nav('/tenant/inventory')} data-testid="view-inventory">{tx('sa.viewInventory')}</button>
          {can('inventory.purchase_order.create') ? <button type="button" className="fk-btn" onClick={() => nav('/tenant/inventory/purchase-orders?new=1')} data-testid="create-po">{tx('sa.createPo')}</button> : null}
          {can('inventory.update') ? <button type="button" className="fk-btn" onClick={() => nav('/tenant/inventory?tab=products')} data-testid="alert-settings" title={tx('sa.settingsHint')}>{tx('sa.alertSettings')}</button> : null}
          {can('inventory.reports.view') ? <button type="button" className="fk-btn ghost" onClick={doExport} disabled={exporting} data-testid="export">{exporting ? tx('pos.loading') : tx('finance.exportReport')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span>
        {note.productId ? <button type="button" className="fk-link" onClick={() => setProduct(note.productId!)} data-testid="note-view-product">{tx('sa.viewProduct')}</button> : null}
        <button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      <div className="fk-kpis five" data-testid="kpis">
        {sum.error ? <StateBlock error={sum.error} onRetry={sum.reload} /> : <>
          <KpiCard testId="kpi-open" tone={k && k.openAlerts > 0 ? 'bad' : undefined} label={tx('pos.open_alerts')} loading={!k} value={k ? fmtNumber(k.openAlerts) : ''} sub={k ? tx('sa.kpi.openSub', { a: fmtNumber(k.acknowledged) }) : ''} onClick={() => { setTab('active'); setSeverity(''); setShowAck(false); }} />
          <KpiCard testId="kpi-out" tone={k && k.outOfStock > 0 ? 'bad' : undefined} label={tx('pos.out_of_stock_2')} loading={!k} value={k ? fmtNumber(k.outOfStock) : ''} sub={tx('sa.kpi.outSub')} onClick={() => { setTab('active'); setSeverity('out_of_stock'); }} />
          <KpiCard testId="kpi-critical" tone={k && k.critical > 0 ? 'warn' : undefined} label={tx('pos.critical')} loading={!k} value={k ? fmtNumber(k.critical) : ''} sub={k ? tx('sa.kpi.critSub', { l: fmtNumber(k.low) }) : ''} onClick={() => { setTab('active'); setSeverity('critical'); }} />
          <KpiCard testId="kpi-uses" label={tx('sa.kpi.uses')} loading={!k} value={k ? fmtNumber(k.productUsesToday) : ''} sub={tx('sa.kpi.usesSub')} onClick={() => { setTab('usage'); setPeriod({ preset: 'today' }); }} />
          <KpiCard testId="kpi-techs" label={tx('sa.kpi.techs')} loading={!k} value={k ? fmtNumber(k.activeTechniciansToday) : ''} sub={tx('sa.kpi.techsSub')} onClick={() => { setTab('technicians'); setPeriod({ preset: 'today' }); }} />
        </>}
      </div>
      <div className="fn-tabsrow sa-toolbar">
        <div className="fk-seg fn-tabs" role="tablist" aria-label={tx('sa.workspaces')}>
          {TABS.map((x) => <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)} data-testid={'tab-' + x}>{tx('sa.tab.' + x)}</button>)}
        </div>
        <div className="fn-search sa-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('sa.searchPh')} aria-label={tx('sa.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}</div>
        {tab === 'active' || tab === 'history' ? <select className="fk-select" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label={tx('sa.severity')} data-testid="severity"><option value="">{tx('sa.allSeverities')}</option>{SEVERITIES.map((s) => <option key={s} value={s}>{sevLbl(s)}</option>)}</select> : null}
        {tab === 'active' ? <label className="sa-check"><input type="checkbox" checked={showAck} onChange={(e) => setShowAck(e.target.checked)} data-testid="show-ack" />{tx('pos.show_acknowledged_alerts')}</label> : null}
      </div>
      {tab !== 'active' ? <div className="fn-tabsrow sa-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={list.data?.period} allowAll compact {...(tab !== 'history' ? { basis, basisOptions: [{ value: 'occurred', label: tx('sa.basis.occurred') }, { value: 'recorded', label: tx('sa.basis.recorded') }], onBasis: setBasis } : {})} />
        {chips.length ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div> : null}
      <FitPanel testId="sa-list" bodyRef={fit.ref} className="fn-records" title={<span className="fn-chips">{tx('sa.tab.' + tab)}{list.data ? <span className="fk-muted"> · {fmtNumber(list.data.total)}</span> : null}<span className="fk-hint">{tx('sa.hint.' + tab)}</span></span>}
        footer={<Pager info={list.data ? { page: list.data.page, pageSize: list.data.pageSize, totalItems: list.data.total, totalPages: list.data.pages } : null} onPage={setPage} label={tx('sa.tab.' + tab)} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : rows.length === 0 ? (chips.length ? <Empty title={tx('sa.noMatches')}><button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button></Empty>
            : <Empty title={tx('sa.empty.' + tab)}>{tab !== 'active' && canRecord ? <button type="button" className="fk-btn" onClick={() => setRecording({})}>{tx('sa.recordUse')}</button> : null}</Empty>)
          : <table className="fk-table fn-table sa-table" data-testid={'table-' + tab}>
            <thead><tr>{head.map((h, i) => <th key={i} className={['onHand', 'reorder', 'used', 'uses', 'technicians', 'products', 'onHandAt'].includes(h) ? 'num' : h === 'since' || h === 'ackBy' ? 't-opt' : ''}>{h ? tx('sa.col.' + h) : ''}</th>)}</tr></thead>
            <tbody>{rows.map((r: any) => tab === 'active' ? (
              <tr key={r.productId} data-testid="alert-row" className={r.acknowledgedAt ? 'sa-acked' : ''}>
                <td><button type="button" className="fk-li-t link" onClick={() => setProduct(r.productId)}>{r.name}</button><span className="fk-li-s">{[r.sku, r.brand, r.vendor].filter(Boolean).join(' · ') || '—'}</span></td>
                <td><span className={'fk-chip ' + (SEV_TONE[r.severity] ?? 'mut')}>{sevLbl(r.severity)}</span>{r.acknowledgedAt ? <span className="fk-li-s">{tx('sa.ackBy', { who: r.acknowledgedBy ?? '—' })}</span> : null}</td>
                <td className="num"><b>{fmtNumber(r.onHand)}</b></td>
                <td className="num">{fmtNumber(r.reorderLevel)}<span className="fk-li-s">{r.onOrder ? tx('sa.onOrder', { n: fmtNumber(r.onOrder) }) : r.suggestedReorder ? tx('sa.suggest', { n: fmtNumber(r.suggestedReorder) }) : ''}</span></td>
                <td><LastUsed r={r} testId="last-used" /></td>
                <td className="t-opt">{r.since ? when(r.since) : <span className="fk-muted">{tx('sa.sinceUnknown')}</span>}</td>
                <td className="fn-acts">
                  {!r.acknowledgedAt ? <button type="button" className="fk-btn ghost sm" onClick={() => acknowledge(r.productId)} disabled={busyAck === r.productId} data-testid="ack">{busyAck === r.productId ? tx('pos.saving_2') : tx('pos.acknowledge')}</button> : null}
                  {can('inventory.purchase_order.create') && r.suggestedReorder > 0 ? <button type="button" className="fk-btn ghost sm" onClick={() => nav(`/tenant/inventory/purchase-orders?new=1&productId=${encodeURIComponent(r.productId)}&qty=${r.suggestedReorder}${r.vendorId ? '&vendorId=' + encodeURIComponent(r.vendorId) : ''}`)} data-testid="reorder">{tx('sa.reorder')}</button> : null}
                </td>
              </tr>) : tab === 'usage' ? (
              <tr key={r.productId} data-testid="usage-row">
                <td><button type="button" className="fk-li-t link" onClick={() => setProduct(r.productId)}>{r.name}</button><span className="fk-li-s">{r.sku ?? '—'}</span></td>
                <td className="num"><b>{r.used}</b><span className="fk-li-s">{unitLbl(r.unit)}</span></td>
                <td className="num">{fmtNumber(r.uses)}{r.unattributedUses ? <span className="fk-li-s">{tx('sa.unattributed', { n: fmtNumber(r.unattributedUses) })}</span> : null}</td>
                <td className="num">{fmtNumber(r.technicians)}</td>
                <td className="num">{fmtNumber(r.onHand)}</td>
                <td><LastUsed r={r} testId="last-used" /></td>
                <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => setProduct(r.productId)} data-testid="view-usage">{tx('sa.viewUsage')}</button></td>
              </tr>) : tab === 'technicians' ? (
              <tr key={r.technicianId ?? 'unknown'} data-testid="tech-row">
                <td><b className={r.technicianId ? '' : 'fk-muted'}>{r.technicianId ? r.name : tx('sa.unknownTech')}</b></td>
                <td className="num">{fmtNumber(r.uses)}</td><td className="num">{fmtNumber(r.products)}</td><td className="num">{r.used != null ? <b>{r.used}</b> : (r.usedByUnit ?? []).map((u: any, i: number) => <span key={u.unit} data-testid="used-by-unit">{i ? ' · ' : ''}<b>{u.used}</b> {unitLbl(u.unit)}</span>)}</td>
                <td>{r.lastProduct ?? '—'}</td><td>{when(r.lastUsedAt)}</td>
              </tr>) : (
              <tr key={r.id} data-testid="history-row">
                <td><button type="button" className="fk-li-t link" onClick={() => setProduct(r.productId)}>{r.name}</button><span className="fk-li-s">{r.sku ?? '—'}</span></td>
                <td><span className={'fk-chip ' + (SEV_TONE[r.severity] ?? 'mut')}>{sevLbl(r.severity)}</span></td>
                <td className="num">{fmtNumber(r.onHandAtAlert)}</td><td>{when(r.createdAt)}</td>
                <td><span className={'fk-chip ' + (r.state === 'resolved' ? 'ok' : r.state === 'acknowledged' ? 'mut' : 'warn')}>{tx('sa.state.' + r.state)}</span><span className="fk-li-s">{r.resolvedAt ? when(r.resolvedAt) : r.acknowledgedAt ? when(r.acknowledgedAt) : ''}</span></td>
                <td className="t-opt">{r.acknowledgedBy ?? '—'}</td>
              </tr>))}</tbody>
          </table>}
      </FitPanel>
      {product ? <ProductDialog productId={product} tick={tick} canRecord={canRecord} canAdjust={canAdjust} onClose={() => setProduct(null)} onRecord={() => setRecording({ productId: product })} onChanged={refresh} /> : null}
      {recording ? <RecordUseDialog productId={recording.productId} canOnBehalf={canAdjust} onClose={() => setRecording(null)} onDone={recorded} /> : null}
    </div>
  );
}

/** Product overlay: header summary, Last Used By + Last Usage Recorded, every technician who used it, every use (paged). */
function ProductDialog({ productId, tick, canRecord, canAdjust, onClose, onRecord, onChanged }: { productId: string; tick: number; canRecord: boolean; canAdjust: boolean; onClose: () => void; onRecord: () => void; onChanged: () => void }) {
  const [period, setPeriod] = useState<PeriodState>({ preset: 'all' }); const [page, setPage] = useState(1); const [mine, setMine] = useState(0);
  const d = useLoad(() => posInventoryAlertsApi.ledger(productId, { ...periodQuery(period), page, pageSize: 8 }), [productId, JSON.stringify(period), page, tick, mine]);
  const [adjust, setAdjust] = useState<any | null>(null);
  const p = d.data?.product;
  return (
    <FitDialog wide title={p ? p.name : tx('sa.productTitle')} subtitle={p ? `${p.sku ?? '—'} · ${tx('sa.onHandN', { n: fmtNumber(p.onHand) })} · ${tx('sa.thresholds', { r: fmtNumber(p.reorderLevel), c: fmtNumber(p.criticalLevel) })}` : undefined} onClose={onClose} testId="product-dialog"
      footer={<>{canRecord ? <button type="button" className="fk-btn" onClick={onRecord} data-testid="product-record">{tx('sa.recordUse')}</button> : null}<button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !d.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="sa-last" data-testid="product-last">
          <div><span className="fk-li-s">{tx('sa.col.lastUsed')}</span><LastUsed r={d.data} testId="product-last-used" /></div>
          <div><span className="fk-li-s">{tx('sa.lastRecorded')}</span><b>{d.data.lastRecordedAt ? when(d.data.lastRecordedAt) : '—'}</b>{d.data.lastRecordedAt && d.data.lastUsedAt && d.data.lastRecordedAt !== d.data.lastUsedAt ? <span className="fk-li-s">{tx('sa.recordedDiffers')}</span> : null}</div>
        </div>
        <PeriodBar value={period} onChange={(x) => { setPeriod(x); setPage(1); }} server={d.data.period} allowAll compact />
        <h3 className="fk-h3">{tx('sa.allTechs')}</h3>
        {d.data.byTechnician.length === 0 ? <div className="fk-hint">{tx('sa.noUse')}</div> :
          <table className="fk-table" data-testid="by-tech"><thead><tr><th>{tx('sa.col.technician')}</th><th className="num">{tx('sa.col.used')}</th><th className="num">{tx('sa.col.uses')}</th><th>{tx('sa.col.lastAt')}</th></tr></thead>
            <tbody>{d.data.byTechnician.map((x: any) => <tr key={x.technicianId ?? 'unknown'} data-testid="by-tech-row"><td className={x.technicianId ? '' : 'fk-muted'}>{x.technicianId ? x.name : tx('sa.unknownTech')}</td><td className="num"><b>{x.used}</b></td><td className="num">{fmtNumber(x.uses)}</td><td>{when(x.lastUsedAt)}</td></tr>)}</tbody></table>}
        <h3 className="fk-h3">{tx('sa.events')} <span className="fk-muted">· {fmtNumber(d.data.total)}</span></h3>
        {d.data.events.length === 0 ? <div className="fk-hint">{tx('sa.noEvents')}</div> :
          <table className="fk-table" data-testid="events"><thead><tr><th>{tx('sa.col.occurred')}</th><th>{tx('sa.col.technician')}</th><th className="num">{tx('sa.col.qty')}</th><th>{tx('sa.col.source')}</th><th className="t-opt">{tx('sa.col.recorded')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{d.data.events.map((e: any) => <tr key={e.id} data-testid="event-row" className={e.status === 'reversed' ? 'sa-acked' : ''}>
              <td>{when(e.occurredAt)}</td><td className={e.technicianId ? '' : 'fk-muted'}>{e.technicianId ? e.technician : tx('sa.unknownTech')}{e.onBehalfReason ? <span className="fk-li-s">{tx('sa.onBehalfShown', { r: e.onBehalfReason })}</span> : null}</td>
              <td className="num"><b>{e.effective}</b>{e.corrected ? <span className="fk-li-s">{tx('sa.correctedFrom', { q: e.quantity })}</span> : null}</td>
              <td>{sourceLbl(e.source)}{e.status === 'reversed' ? <span className="fk-li-s">{tx('sa.reversed')}</span> : null}</td><td className="t-opt">{when(e.recordedAt)}</td>
              <td className="fn-acts">{canAdjust && e.eventId && e.status !== 'reversed' ? <button type="button" className="fk-btn ghost sm" onClick={() => setAdjust(e)} data-testid="correct">{tx('sa.correct')}</button> : null}</td>
            </tr>)}</tbody></table>}
        <Pager info={{ page: d.data.page, pageSize: d.data.pageSize, totalItems: d.data.total, totalPages: d.data.pages }} onPage={setPage} compact label={tx('sa.events')} />
      </>}
      {adjust ? <AdjustDialog event={adjust} unit={p?.unit ?? 'unit'} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); setMine((m) => m + 1); onChanged(); }} /> : null}
    </FitDialog>
  );
}

/** A correction: a signed amount (give back / used more) with a reason — the original use is never edited. */
export function AdjustDialog({ event, unit, onClose, onDone }: { event: any; unit: string; onClose: () => void; onDone: () => void }) {
  const [dir, setDir] = useState<'back' | 'more'>('back'); const [amount, setAmount] = useState(event.effective); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const keys = useRef(createIntentKeys());
  const valid = /^\d{1,6}(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0 && reason.trim().length >= 3;
  const submit = async () => {
    const body = { delta: (dir === 'back' ? '-' : '') + amount.trim(), reason: reason.trim() }; const intent = `adjust:${event.eventId}`;
    setBusy(true); setErr(null);
    try { await posInventoryAlertsApi.adjust(event.eventId, body, keys.current.keyFor(intent, body)); keys.current.done(intent); onDone(); }
    catch (e) { setErr(errorTextOf(e, tx('pos.something_went_wrong'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('sa.correctTitle')} subtitle={`${event.technicianId ? event.technician : tx('sa.unknownTech')} · ${when(event.occurredAt)} · ${event.effective} ${unitLbl(unit)}`} onClose={onClose} busy={busy} testId="adjust-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={submit} disabled={!valid || busy} data-testid="confirm-adjust">{busy ? tx('pos.loading') : tx('sa.saveCorrection')}</button></>}>
      <div className="fk-seg" role="radiogroup" aria-label={tx('sa.correctTitle')}>
        <button type="button" className={dir === 'back' ? 'on' : ''} aria-pressed={dir === 'back'} onClick={() => setDir('back')} data-testid="dir-back">{tx('sa.giveBack')}</button>
        <button type="button" className={dir === 'more' ? 'on' : ''} aria-pressed={dir === 'more'} onClick={() => setDir('more')} data-testid="dir-more">{tx('sa.usedMore')}</button>
      </div>
      <label className="fk-field"><span>{tx('sa.amountUnit', { u: unitLbl(unit) })}</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="adjust-amount" /></label>
      <label className="fk-field"><span>{tx('rv.reasonRequired')}</span><textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="adjust-reason" /></label>
      <div className="fk-hint">{tx('sa.correctNote')}</div>
      {err ? <div className="fk-error" role="alert" data-testid="adjust-error">{err}</div> : null}
    </FitDialog>
  );
}

const QUICK = ['0.25', '0.5', '1'];
const localNow = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

/** Record Product Use: 1 product (search / SKU / barcode scan) · 2 technician · 3 amount, time, ticket, note · 4 stock before → after · confirm once. */
export function RecordUseDialog({ productId, canOnBehalf, onClose, onDone }: { productId?: string; canOnBehalf: boolean; onClose: () => void; onDone: (r: any) => void }) {
  const [find, setFind] = useState(''); const fq = useDebounced(find.trim(), 250);
  const pick = useLoad(() => posInventoryAlertsApi.pickers(fq || undefined), [fq]);
  const [pid, setPid] = useState<string | null>(productId ?? null);
  const products: any[] = pick.data?.products ?? []; const techs: any[] = pick.data?.technicians ?? [];
  const [chosen, setChosen] = useState<any | null>(null);
  useEffect(() => { if (pid && !chosen) { const p = products.find((x) => x.id === pid); if (p) setChosen(p); } }, [pid, products, chosen]);
  useEffect(() => { if (productId && !chosen) posInventoryAlertsApi.pickers().then((r) => { const p = (r?.products ?? []).find((x: any) => x.id === productId); if (p) setChosen(p); }).catch(() => undefined); }, [productId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const me = techs.find((x) => x.isMe);
  const [techId, setTechId] = useState<string>(''); useEffect(() => { if (!techId && me) setTechId(me.id); }, [me, techId]);
  const [qty, setQty] = useState('0.5'); const [at, setAt] = useState(''); const [noteText, setNoteText] = useState(''); const [reason, setReason] = useState('');
  const [review, setReview] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const keys = useRef(createIntentKeys());
  const onBehalf = !!techId && techId !== me?.id;
  const whole = chosen && ['piece', 'pieces', 'pair', 'pairs', 'pack', 'packs', 'box', 'boxes', 'each', 'unit', 'units', 'kit', 'kits', 'roll', 'rolls'].includes(String(chosen.unit).toLowerCase());
  const qOk = /^\d{1,6}(\.\d{1,2})?$/.test(qty.trim()) && Number(qty) > 0 && (!whole || Number.isInteger(Number(qty)));
  const hundredths = qOk ? Math.round(Number(qty) * 100) : 0;
  const after = chosen ? chosen.stockHundredths - hundredths : 0;
  const valid = !!chosen && !!techId && qOk && (!onBehalf || reason.trim().length >= 3);
  // a scanner types the barcode and Enter: an exact SKU / barcode match picks the product at once
  const onScan = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key !== 'Enter') return; e.preventDefault(); const v = find.trim(); const hit = products.find((p) => p.barcode === v || (p.sku && p.sku.toLowerCase() === v.toLowerCase())); if (hit) { setChosen(hit); setPid(hit.id); } };
  const submit = async () => {
    if (!chosen) return;
    const body = { productId: chosen.id, quantity: qty.trim(), technicianId: onBehalf ? techId : undefined, onBehalfReason: onBehalf ? reason.trim() : undefined, occurredAt: at ? new Date(at).toISOString() : undefined, note: noteText.trim() || undefined, source: 'front_desk' as const };
    const intent = `use:${chosen.id}`; setBusy(true); setErr(null);
    try { const r = await posInventoryAlertsApi.record(body as Parameters<typeof posInventoryAlertsApi.record>[0], keys.current.keyFor(intent, body)); keys.current.done(intent); onDone(r); }
    catch (e) { setErr(errorTextOf(e, tx('pos.something_went_wrong'))); setReview(false); } finally { setBusy(false); }
  };
  return (
    <FitDialog wide title={tx('sa.recordUse')} subtitle={tx('sa.rec.sub')} onClose={onClose} busy={busy} testId="record-dialog"
      footer={<><button type="button" className="fk-btn" onClick={review ? () => setReview(false) : onClose} disabled={busy}>{review ? tx('rv.back') : tx('pos.cancel')}</button>
        {review ? <button type="button" className="fk-btn primary" onClick={submit} disabled={busy} data-testid="confirm-use">{busy ? tx('pos.loading') : tx('sa.rec.confirm')}</button>
          : <button type="button" className="fk-btn primary" onClick={() => setReview(true)} disabled={!valid} data-testid="review-use">{tx('sa.rec.review')}</button>}</>}>
      {review && chosen ? <div className="sa-review" data-testid="use-review">
        <dl className="rv-pos"><div><dt>{tx('sa.rec.before')}</dt><dd>{chosen.stock}</dd></div><div className="warn"><dt>{tx('sa.rec.use')}</dt><dd>−{qty}</dd></div><div className="total"><dt>{tx('sa.rec.after')}</dt><dd data-testid="stock-after">{(after / 100).toFixed(2).replace(/\.?0+$/, '')}</dd></div><div><dt>{tx('sa.col.technician')}</dt><dd className="sa-dd-s">{techs.find((x) => x.id === techId)?.name ?? '—'}</dd></div></dl>
        {after < 0 ? <div className="fk-note bad"><span>{tx('sa.rec.negative')}</span></div> : null}
        <div className="fk-hint">{tx('sa.rec.reviewNote', { p: chosen.name, u: unitLbl(chosen.unit) })}{onBehalf ? ' ' + tx('sa.rec.onBehalfNote') : ''}</div>
      </div> : <div className="fn-cols2">
        <div>
          <h3 className="fk-h3">{tx('sa.rec.step1')}</h3>
          {chosen ? <div className="sa-chosen" data-testid="chosen-product"><b>{chosen.name}</b><span className="fk-li-s">{[chosen.sku, chosen.barcode].filter(Boolean).join(' · ') || '—'} · {tx('sa.rec.inStock', { s: chosen.stock, u: unitLbl(chosen.unit) })}</span>
            {!productId ? <button type="button" className="fk-link" onClick={() => { setChosen(null); setPid(null); }}>{tx('sa.rec.change')}</button> : null}</div>
            : <><div className="fn-search"><input className="fk-search wide" type="search" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={onScan} placeholder={tx('sa.rec.findPh')} aria-label={tx('sa.rec.findPh')} data-testid="product-find" autoFocus /></div>
              {pick.error ? <StateBlock error={pick.error} onRetry={pick.reload} /> : <ul className="sa-picks" data-testid="product-picks">{products.slice(0, 7).map((p) => <li key={p.id}><button type="button" className="sa-pick" onClick={() => { setChosen(p); setPid(p.id); }} data-testid="product-pick"><b>{p.name}</b><span className="fk-li-s">{p.sku ?? '—'} · {tx('sa.rec.inStock', { s: p.stock, u: unitLbl(p.unit) })}</span></button></li>)}
                {products.length === 0 && pick.data ? <li className="fk-hint">{tx('sa.rec.noProduct')}</li> : null}</ul>}</>}
          <h3 className="fk-h3">{tx('sa.rec.step2')}</h3>
          {canOnBehalf || !me ? <select className="fk-select wide" value={techId} onChange={(e) => setTechId(e.target.value)} aria-label={tx('sa.col.technician')} data-testid="tech-pick">
            <option value="">{tx('sa.rec.chooseTech')}</option>{techs.map((x) => <option key={x.id} value={x.id}>{x.name}{x.isMe ? ' · ' + tx('sa.rec.me') : ''}</option>)}</select>
            : <div className="sa-chosen"><b>{me?.name}</b><span className="fk-li-s">{tx('sa.rec.yourself')}</span></div>}
          {!me && !canOnBehalf ? <div className="fk-hint">{tx('sa.rec.noTechRecord')}</div> : null}
          {onBehalf ? <label className="fk-field"><span>{tx('sa.rec.onBehalfReason')}</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="on-behalf-reason" /></label> : null}
        </div>
        <div>
          <h3 className="fk-h3">{tx('sa.rec.step3')}</h3>
          <div className="fk-seg sa-quick">{QUICK.filter((x) => !whole || Number.isInteger(Number(x))).map((x) => <button key={x} type="button" className={qty === x ? 'on' : ''} onClick={() => setQty(x)} data-testid={'qty-' + x}>{x}</button>)}</div>
          <label className="fk-field"><span>{tx('sa.amountUnit', { u: chosen ? unitLbl(chosen.unit) : tx('sa.unit.unit') })}</span><input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="qty" /></label>
          {!qOk && qty ? <div className="fk-error" role="alert">{whole ? tx('errors.USAGE_FRACTION_NOT_ALLOWED') : tx('errors.USAGE_QUANTITY_INVALID')}</div> : null}
          <label className="fk-field"><span>{tx('sa.rec.when')}</span><input type="datetime-local" value={at} max={localNow()} onChange={(e) => setAt(e.target.value)} data-testid="occurred-at" /></label>
          <div className="fk-hint">{tx('sa.rec.whenHint')}</div>
          <label className="fk-field"><span>{tx('sa.rec.note')}</span><input value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={1000} data-testid="use-note" /></label>
        </div>
      </div>}
      {err ? <div className="fk-error" role="alert" data-testid="use-error">{err}</div> : null}
    </FitDialog>
  );
}
