// POSInventoryReportScreen.tsx — Reports → Inventory (SUNMI batch 9 guide 11, Nov 10 2026). Read-only analytics lens over the
// Inventory module (inventory.view). Preserved: title + subtitle, Full View, the five cards (Inventory Value, Products,
// Low Stock, Out of Stock, Expiring Soon) and Reorder Attention (Product, On Hand, Status, Suggested Reorder).
// Fixed: "Expiring Soon" came from the older summary, which counted bottles dated within 30 days INCLUDING ones already
// expired, beside a Products card counting products — the guide's "11 products vs 128 expiring". The cards now read the
// Inventory screen metrics: each with its written definition, expiring vs expired apart, Low Stock with its Critical part.
// Added: data-health notes (stock drift, products without a cost, expired bottles), a searched + paged Reorder Attention
// (needs reorder / out / critical / low), and the stock-movement history for a period (newest first, paged). Every change
// to stock stays in Inventory — this screen links there.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posInventoryReportApi } from '../api/posInventoryReportApi';
import { useReportCadence, money, reportError, useUrlPeriod } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';
import { codeLabel } from '../components/peopleLabels';
import { PeriodBar } from '../components/FinanceKit';
import { Pager } from '../components/FitKit';
import { fmtInTz } from '../i18n/format';

type Metrics = {
  asOf: string; timeZone: string; today: string; products: number; bottles: number; lowStock: number; critical: number; outOfStock: number; needReorder: number;
  expiringSoon: number; expired: number; expiryHorizonDays: number; stockDrift: number; inventoryValueCents: number | null; productsWithoutCost: number;
  definitions: Record<string, string>;
};
type ProductRow = { id: string; name: string; colorNumber: string | null; sku: string | null; onHand: number; severity: string; suggestedReorder: number; unit: string; expired: number; expiring: number };
type Page<R> = { total: number; page: number; pageSize: number; pages: number; rows: R[] };
type Move = { id: string; product: string; type: string; before: number; change: number; after: number; reason: string | null; at: string | null; actor: string | null; poNumber: string | null };

const statusChip = (status: string) => {
  const map: Record<string, { bg: string; fg: string }> = { out_of_stock: { bg: '#FDEEEE', fg: '#C0392B' }, critical: { bg: '#FDEEEE', fg: '#C0392B' }, low: { bg: '#FFF4E0', fg: '#B5821F' } };
  const m = map[status] || { bg: '#F0F0F0', fg: '#666' };
  return <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: m.bg, color: m.fg }}>{statusLabel('stock', status)}</span>;
};
const REORDER = ['needs_reorder', 'out_of_stock', 'critical', 'low'] as const;

export function POSInventoryReportScreen() {
  const { reloadKey } = useReportCadence();
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { open: openIPad } = useIPadView();
  const nav = useNavigate();

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (posInventoryReportApi.metrics() as Promise<Metrics>)
      .then((d) => { if (alive) setM(d); })
      .catch((e: any) => { if (alive) { setM(null); setError(reportError(e, t('admin.reports.noun.inventory'))); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadKey]);

  const def = (k: string) => m?.definitions?.[k] ?? '';
  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.inventory_report')}</h1><div className="sub mb-3">{t('pos.stock_health_value_and_reorder_attention')}</div></div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        {m ? <span className="s" data-testid="inv-asof">{t('rpt.inv.asOf', { at: fmtInTz(m.asOf, m.timeZone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })}</span> : <span />}
        <div className="flex gap-2">
          <button className="btn ghost" onClick={() => nav('/tenant/inventory')}>{t('rpt.inv.open')}</button>
          <button className="btn ghost w-fit whitespace-nowrap" disabled={!m} title={t('pos.open_full_ipad_view')} onClick={() => m && openIPad(reportRequest(t('pos.inventory_report'), { kpis: [{ label: t('pos.inventory_value'), value: m.inventoryValueCents != null ? money(m.inventoryValueCents) : '—' }, { label: t('pos.products'), value: m.products }, { label: t('pos.low_stock'), value: m.lowStock }, { label: t('pos.out_of_stock_2'), value: m.outOfStock }, { label: t('pos.expiring_soon'), value: m.expiringSoon }] }))}>{t('pos.full_view')}</button>
        </div>
      </div>
      {loading && !m ? <div className="state">{t('pos.loading_inventory_report')}</div> : null}
      {error ? <div className="err" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}
      {m ? (<>
        <div className="kpis">
          <div className="kpi" title={def('inventoryValue')}><div className="l">{t('pos.inventory_value')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{m.inventoryValueCents != null ? money(m.inventoryValueCents) : '—'}</div><div className="d flat">{t('rpt.inv.valueBasis')}</div></div>
          <div className="kpi" title={def('products')}><div className="l">{t('pos.products')}</div><div className="v">{m.products}</div><div className="d flat">{m.bottles} {t('pos.bottles')}</div></div>
          <div className="kpi" title={def('lowStock')}><div className="l">{t('pos.low_stock')}</div><div className="v" style={{ color: m.lowStock ? '#B5821F' : undefined }}>{m.lowStock}</div><div className="d flat" data-testid="inv-critical">{t('rpt.inv.critical', { n: String(m.critical) })}</div></div>
          <div className="kpi" title={def('outOfStock')}><div className="l">{t('pos.out_of_stock_2')}</div><div className="v" style={{ color: m.outOfStock ? '#C0392B' : undefined }}>{m.outOfStock}</div></div>
          <div className="kpi" title={def('expiringSoon')}><div className="l">{t('pos.expiring_soon')}</div><div className="v" data-testid="inv-expiring">{m.expiringSoon}</div><div className="d flat">{t('rpt.inv.expiringUnit', { days: String(m.expiryHorizonDays) })}</div></div>
        </div>
        <InvHealth m={m} />
        <ReorderAttention reloadKey={reloadKey} />
        <MovementHistory reloadKey={reloadKey} />
      </>) : null}
    </div>
  );
}

function InvHealth({ m }: { m: Metrics }) {
  const notes: [string, string][] = [];
  if (m.expired > 0) notes.push(['inv-h-expired', t('rpt.inv.h.expired', { n: String(m.expired) })]);
  if (m.stockDrift > 0) notes.push(['inv-h-drift', t('rpt.inv.h.drift', { n: String(m.stockDrift) })]);
  if (m.productsWithoutCost > 0) notes.push(['inv-h-nocost', t('rpt.inv.h.noCost', { n: String(m.productsWithoutCost) })]);
  return (
    <section className="panel mb-3" data-testid="inv-health">
      <div className="p-h">{t('rpt.inv.health')}</div>
      {notes.length === 0 ? <div className="s" data-testid="inv-h-ok">{t('rpt.inv.h.ok')}</div> : <ul style={{ margin: 0, paddingLeft: 18 }}>{notes.map(([id, txt]) => <li key={id} data-testid={id}>{txt}</li>)}</ul>}
      <div className="s mt-1">{t('rpt.inv.h.counts', { products: String(m.products), bottles: String(m.bottles), expiring: String(m.expiringSoon) })}</div>
    </section>
  );
}

function ReorderAttention({ reloadKey }: { reloadKey: number }) {
  const [status, setStatus] = useState<(typeof REORDER)[number]>('needs_reorder');
  const [draft, setDraft] = useState(''); const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [d, setD] = useState<Page<ProductRow> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => { setPage(1); }, [status, q]);
  useEffect(() => { if (first.current) { first.current = false; return; } const h = setTimeout(() => setQ(draft.trim()), 300); return () => clearTimeout(h); }, [draft]);
  useEffect(() => {
    let alive = true; setErr(null);
    (posInventoryReportApi.products({ status, sort: 'critical', search: q || undefined, page, pageSize: 25 }) as Promise<Page<ProductRow>>)
      .then((r) => { if (!alive) return; if (Array.isArray(r?.rows)) setD(r); else { setD(null); setErr(t('rpt.inv.failed')); } })
      .catch((e: any) => { if (alive) { setD(null); setErr(reportError(e, t('pos.reorder_attention'))); } });
    return () => { alive = false; };
  }, [status, q, page, reloadKey]);
  return (
    <section className="panel mb-3" style={{ padding: 0, overflow: 'hidden' }} data-testid="inv-reorder">
      <div style={{ padding: '14px 14px 6px' }} className="flex flex-wrap items-center gap-2 justify-between">
        <div className="p-h">{t('pos.reorder_attention')}{d ? <span className="s"> · {t('rpt.inv.count', { n: String(d.total) })}</span> : null}</div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="fk-seg" role="group" aria-label={t('pos.status')}>{REORDER.map((k) => <button key={k} type="button" className={status === k ? 'on' : ''} aria-pressed={status === k} style={{ minHeight: 44 }} data-testid={`inv-st-${k}`} onClick={() => setStatus(k)}>{t('rpt.inv.st.' + k)}</button>)}</div>
          <input className="input" style={{ minWidth: 240, minHeight: 44 }} data-testid="inv-search" maxLength={100} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('rpt.inv.search')} aria-label={t('rpt.inv.search')} />
        </div>
      </div>
      {err ? <div className="err" role="alert" style={{ margin: 14 }}>{err}</div> : !d ? <div className="muted" style={{ padding: 14 }}>{t('pos.loading_inventory_report')}</div> : d.rows.length === 0 ? (
        <div className="state" style={{ padding: 16 }} data-testid="inv-reorder-empty">{q ? t('rpt.tx.noMatch') : t('pos.all_products_are_above_their_reorder_a2uq')}</div>
      ) : (
        <div className="overflow-x-auto w-full"><table className="tbl w-full">
          <thead><tr><th>{t('pos.product')}</th><th style={{ textAlign: 'right' }}>{t('pos.on_hand_2')}</th><th>{t('pos.status')}</th><th style={{ textAlign: 'right' }}>{t('pos.suggested_reorder')}</th><th style={{ textAlign: 'right' }}>{t('rpt.inv.expiringCol')}</th></tr></thead>
          <tbody>{d.rows.map((a) => (
            <tr key={a.id}>
              <td style={{ fontWeight: 700 }}>{a.name}{a.colorNumber ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {a.colorNumber}</span> : null}{a.sku ? <div className="s">{a.sku}</div> : null}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{a.onHand}</td>
              <td>{statusChip(a.severity)}</td>
              <td style={{ textAlign: 'right' }}>{a.suggestedReorder ? `+${a.suggestedReorder}` : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
              <td style={{ textAlign: 'right' }}>{a.expiring || a.expired ? `${a.expiring}${a.expired ? ' · ' + t('rpt.inv.expiredN', { n: String(a.expired) }) : ''}` : '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {d ? <div style={{ padding: '6px 14px' }}><Pager info={{ page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.pages }} onPage={setPage} label={t('pos.reorder_attention')} /></div> : null}
    </section>
  );
}

function MovementHistory({ reloadKey }: { reloadKey: number }) {
  const { period, setPeriod, query } = useUrlPeriod('month');
  const [draft, setDraft] = useState(''); const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [d, setD] = useState<(Page<Move> & { period?: { from: string | null; to: string | null; tz: string; today: string } }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(query);
  const first = useRef(true);
  useEffect(() => { setPage(1); }, [key, q]);
  useEffect(() => { if (first.current) { first.current = false; return; } const h = setTimeout(() => setQ(draft.trim()), 300); return () => clearTimeout(h); }, [draft]);
  useEffect(() => {
    let alive = true; setErr(null);
    (posInventoryReportApi.movements({ ...query, search: q || undefined, page, pageSize: 25 }) as Promise<any>)
      .then((r) => { if (!alive) return; if (Array.isArray(r?.rows)) setD(r); else { setD(null); setErr(t('rpt.inv.failed')); } })
      .catch((e: any) => { if (alive) { setD(null); setErr(reportError(e, t('rpt.inv.moves'))); } });
    return () => { alive = false; };
  }, [key, q, page, reloadKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const server = d?.period ? { preset: period.preset, from: d.period.from, to: d.period.to, tz: d.period.tz, today: d.period.today } : null;
  return (
    <section className="panel mb-3" data-testid="inv-moves">
      <div className="p-h">{t('rpt.inv.moves')}{d ? <span className="s"> · {t('rpt.inv.movesCount', { n: String(d.total) })}</span> : null}</div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <PeriodBar value={period} onChange={setPeriod} server={server} compact />
        <input className="input" style={{ minWidth: 240, minHeight: 44 }} data-testid="inv-moves-search" maxLength={100} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('rpt.inv.movesSearch')} aria-label={t('rpt.inv.movesSearch')} />
      </div>
      {err ? <div className="err" role="alert">{err}</div> : !d ? <div className="muted">{t('pos.loading_inventory_report')}</div> : d.rows.length === 0 ? <div className="muted" data-testid="inv-moves-empty">{q ? t('rpt.tx.noMatch') : t('rpt.inv.noMoves')}</div> : (
        <div className="overflow-x-auto w-full"><table className="tbl w-full">
          <thead><tr><th>{t('rpt.inv.when')}</th><th>{t('pos.product')}</th><th>{t('rpt.inv.type')}</th><th style={{ textAlign: 'right' }}>{t('rpt.inv.change')}</th><th style={{ textAlign: 'right' }}>{t('rpt.inv.after')}</th><th>{t('rpt.inv.by')}</th></tr></thead>
          <tbody>{d.rows.map((x) => (
            <tr key={x.id}>
              <td className="whitespace-nowrap">{x.at ? fmtInTz(x.at, d.period?.tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
              <td>{x.product}</td><td>{codeLabel('inv.move.' + x.type, x.type)}{x.reason ? <div className="s">{x.reason}</div> : null}</td>
              <td className="num" style={{ textAlign: 'right', color: x.change < 0 ? '#C0392B' : undefined }}>{x.change > 0 ? '+' : ''}{x.change}</td>
              <td className="num" style={{ textAlign: 'right' }}>{x.after}</td><td>{x.actor || '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {d ? <Pager info={{ page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.pages }} onPage={setPage} label={t('rpt.inv.moves')} /> : null}
    </section>
  );
}
