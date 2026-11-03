// InventoryCenterPanel.tsx — AI Inventory Assistant guides (Nov 3 2026): the Command Center tab. The six cards keep their labels and now
// come from /pos/ai-inventory/center/summary with a definition each and the reasons behind them (critical by its own level or by half the
// reorder level, products with no levels, stock that differs from its history; a salon-wide login sums every branch instead of reading
// 0 everywhere). Below: the product list (search · status · sort · pages), the stock activity (search · type · presets + From/To month
// calendar · pages, newest first) and Check Inventory System. Read-only.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { posAiInventoryApi } from '../api/posAiInventoryApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const ic = posAiInventoryApi.center;
const STATUSES = ['all', 'out_of_stock', 'critical', 'low', 'in_stock', 'overstock', 'no_threshold', 'ledger_mismatch'] as const;
const SORTS = ['attention', 'name', 'on_hand', 'updated'] as const;
const TYPES = ['all', 'received', 'retail_sale', 'service_usage', 'adjustment', 'count', 'transfer', 'damage_waste', 'return', 'other'] as const;
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_90', 'last_month', 'year'] as const;
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const ST_TONE: Record<string, string> = { out_of_stock: 'bad', critical: 'bad', low: 'warn', overstock: '', in_stock: 'ok' };
const ST_COLOR: Record<string, string> = { low: '#D09A36', critical: '#B85B4D', out_of_stock: '#B85B4D' };
const codeOf = (e: unknown) => { const x = e as { code?: string; details?: { code?: string } } | null; return x?.code ?? x?.details?.code; };
function errText(e: unknown) {
  if (codeOf(e) === 'IC_INVALID_PERIOD') return t('icx.err.IC_INVALID_PERIOD');
  if (isForbidden(e)) return t('icx.err.forbidden');
  return errorTextOf(e, t('icx.loadFailed'));
}
type Period = { preset?: string; from?: string; to?: string };

export function InventoryCenterPanel() {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const load = useCallback(() => { setErr(null); ic.summary().then(setS).catch((e) => setErr(errText(e))); }, []);
  useEffect(() => { load(); }, [load, tick]);
  const runCheck = () => { setHealth('loading'); ic.check().then(setHealth).catch((e) => setHealth({ error: errText(e) })); };
  const c = s?.cards; const r = s?.reasons;
  const Card = ({ id, label, value, def, color }: { id: string; label: string; value: number | undefined; def: string; color?: string }) => (
    <div className="kpi" data-testid={`icx-card-${id}`} title={def}><div className="k-l">{label}</div><div className="k-v" style={color ? { color } : undefined}>{value == null ? '—' : fmtNumber(value)}</div><div className="sub" style={{ fontSize: 11 }}>{def}</div></div>);
  return (
    <div data-testid="icx-panel">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <button className="btn ghost" data-testid="icx-refresh" onClick={() => setTick((n) => n + 1)}>{t('icx.refresh')}</button>
        <button className="btn ghost" data-testid="icx-check" onClick={runCheck}>{t('icx.check')}</button>
      </div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : null}
      <div className="kpis">
        <Card id="products" label={tx('pos.products')} value={c?.products} def={t('icx.def.products')} />
        <Card id="in_stock" label={tx('pos.in_stock')} value={c?.inStock} def={t('icx.def.inStock')} />
        <Card id="low" label={tx('pos.low')} value={c?.low} def={t('icx.def.low')} color={ST_COLOR.low} />
        <Card id="critical" label={tx('pos.critical')} value={c?.critical} def={t('icx.def.critical')} color={ST_COLOR.critical} />
        <Card id="out_of_stock" label={tx('pos.out_of_stock')} value={c?.outOfStock} def={t('icx.def.outOfStock')} color={ST_COLOR.out_of_stock} />
        <Card id="overstock" label={tx('pos.overstock')} value={c?.overstock} def={t('icx.def.overstock')} />
      </div>
      {s ? <div className="panel" data-testid="icx-reasons" style={{ padding: 10, marginTop: 8 }}>
        <div className="sub">{t('icx.scope.' + s.scope)} {t('icx.readOnly')}</div>
        {c?.critical ? <div>{t('icx.reasons', { e: fmtNumber(r.criticalExplicit), d: fmtNumber(r.criticalDerived) })}</div> : null}
        {r?.noThreshold ? <div className="warn">{t('icx.noThreshold', { n: fmtNumber(r.noThreshold) })}</div> : null}
        {r?.ledgerMismatch ? <div className="bad">{t('icx.mismatch', { n: fmtNumber(r.ledgerMismatch) })}</div> : null}
      </div> : null}
      <ProductsList tick={tick} />
      <ActivityList tick={tick} />
      {health ? <FitDialog wide testId="icx-health" title={t('icx.check')} onClose={() => setHealth(null)}
        subtitle={health !== 'loading' && !health.error ? t('icx.health.overall', { s: t('icx.health.' + health.overall), at: when(health.checkedAt) }) : undefined}
        footer={<button className="btn ghost" onClick={() => setHealth(null)}>{t('icx.close')}</button>}>
        {health === 'loading' ? <div className="state">{t('icx.health.running')}</div> : health.error ? <div className="err">{health.error}</div> : <>
          <p className="sub">{t('icx.health.readOnly')}{health.reused ? ` ${t('icx.health.recent')}` : ''}</p>
          {(health.checks ?? []).map((x: any) => (
            <div key={x.key} className="rvw-check" data-testid={`icx-chk-${x.key}`}>
              <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')}>{t('icx.health.' + x.state)}</span> <b>{t('icx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
              <div className="sub">{t('icx.health.d.' + x.key + '.' + x.state)}</div>
              <div className="sub">{t('icx.health.part', { c: t('icx.comp.' + x.component) })} · {x.lastPassedAt ? t('icx.health.lastPassed', { at: when(x.lastPassedAt) }) : t('icx.health.neverPassed')}</div>
            </div>))}
        </>}
      </FitDialog> : null}
    </div>
  );
}

function Frame({ testId, title, searchPh, onSearch, filters, children, pager }: { testId: string; title: string; searchPh: string; onSearch: (q?: string) => void; filters: ReactNode; children: ReactNode; pager: ReactNode }) {
  const [draft, setDraft] = useState('');
  return (
    <section className="panel rvw-feed" data-testid={testId} style={{ padding: 12, marginTop: 12 }}>
      <div className="p-h">{title}</div>
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); onSearch(draft.trim() || undefined); }}>
        <input className="rvw-search" type="search" data-testid={`${testId}-search`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={searchPh} aria-label={searchPh} />
        <button className="btn" type="submit">{t('icx.search')}</button>
        {filters}
      </form>
      {children}
      {pager}
    </section>
  );
}

function ProductsList({ tick }: { tick: number }) {
  const [f, setF] = useState<{ q?: string; status: string; sort: string; page: number; pageSize: number }>({ status: 'all', sort: 'attention', page: 1, pageSize: 25 });
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); ic.products(f).then(setList).catch((e) => setErr(errText(e))); }, [f]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (x: Partial<typeof f>, keep = false) => setF((y) => ({ ...y, ...x, page: keep ? (x.page ?? y.page) : 1 }));
  const rows: any[] = list?.items ?? [];
  return (
    <Frame testId="icx-products" title={t('icx.products')} searchPh={t('icx.searchPh')} onSearch={(q) => set({ q })}
      filters={<>
        <select data-testid="icx-status" aria-label={t('icx.statusLabel')} value={f.status} onChange={(e) => set({ status: e.target.value })}>{STATUSES.map((k) => <option key={k} value={k}>{t('icx.st.' + k)}</option>)}</select>
        <select data-testid="icx-sort" aria-label={t('icx.sortLabel')} value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{SORTS.map((k) => <option key={k} value={k}>{t('icx.sort.' + k)}</option>)}</select>
      </>}
      pager={<div className="rvw-pager"><Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(n) => set({ page: n }, true)} />
        <label className="rvw-f"><span>{t('icx.rows')}</span><select data-testid="icx-rows" value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label></div>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('icx.loading')}</div> : !rows.length ? <Empty title={f.q || f.status !== 'all' ? t('icx.noMatch') : t('icx.noProducts')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('icx.col.product')}</th><th>{t('icx.col.onHand')}</th><th>{t('icx.col.levels')}</th><th>{t('icx.col.ordered')}</th><th>{t('icx.col.status')}</th><th>{t('icx.col.ledger')}</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} data-testid="icx-product-row">
              <td><b>{p.name}</b><div className="sub">{[p.sku, p.category, p.vendor].filter(Boolean).join(' · ')}</div></td>
              <td>{fmtNumber(p.onHand)}{p.reserved ? <div className="sub">{t('icx.reserved', { n: fmtNumber(p.reserved) })}</div> : null}{!p.hasStockRecord ? <div className="sub warn">{t('icx.noRecord')}</div> : null}</td>
              <td>{p.noThreshold ? <span className="chip warn">{t('icx.noLevels')}</span> : <>{fmtNumber(p.reorderLevel)} / {fmtNumber(p.criticalLevel)}{p.criticalSource === 'derived' ? <div className="sub">{t('icx.derived')}</div> : null}</>}</td>
              <td>{p.openOrderQty ? fmtNumber(p.openOrderQty) : '—'}</td>
              <td><span className={'chip ' + (ST_TONE[p.status] ?? '')} data-testid="icx-status-chip">{t('icx.st.' + p.status)}</span></td>
              <td>{p.ledgerBalance == null ? <span className="sub">{t('icx.noLedger')}</span> : p.ledgerMismatch ? <span className="chip bad">{t('icx.ledgerDiff', { n: fmtNumber(p.ledgerBalance) })}</span> : <span className="sub">{t('icx.ledgerSame')}</span>}</td>
            </tr>))}</tbody></table></div>)}
    </Frame>
  );
}

function ActivityList({ tick }: { tick: number }) {
  const [f, setF] = useState<{ q?: string; type: string; page: number; pageSize: number }>({ type: 'all', page: 1, pageSize: 25 });
  const [period, setPeriod] = useState<Period>({});
  const [cal, setCal] = useState(false);
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); ic.activity({ ...f, ...period }).then(setList).catch((e) => setErr(errText(e))); }, [f, period]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (x: Partial<typeof f>, keep = false) => setF((y) => ({ ...y, ...x, page: keep ? (x.page ?? y.page) : 1 }));
  const setPer = (p: Period) => { setPeriod(p); setF((y) => ({ ...y, page: 1 })); };
  const rows: any[] = list?.items ?? [];
  return (
    <Frame testId="icx-activity" title={t('icx.activity')} searchPh={t('icx.actSearchPh')} onSearch={(q) => set({ q })}
      filters={<select data-testid="icx-type" aria-label={t('icx.typeLabel')} value={f.type} onChange={(e) => set({ type: e.target.value })}>{TYPES.map((k) => <option key={k} value={k}>{t('icx.type.' + k)}</option>)}</select>}
      pager={<div className="rvw-pager"><Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(n) => set({ page: n }, true)} /></div>}>
      <div className="rvw-dates">
        <button className={'btn ghost' + (!period.preset ? ' on' : '')} onClick={() => setPer({})}>{t('icx.preset.all')}</button>
        {PRESETS.map((p) => <button key={p} className={'btn ghost' + (period.preset === p ? ' on' : '')} data-testid={`icx-preset-${p}`} onClick={() => setPer({ preset: p })}>{t('icx.preset.' + p)}</button>)}
        <button className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} data-testid="icx-custom" onClick={() => setCal(true)}>{period.preset === 'custom' ? `${period.from} → ${period.to}` : t('icx.preset.custom')}</button>
      </div>
      {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={list?.period?.today ?? deviceToday()}
        onApply={(x) => { setPer({ preset: 'custom', from: x.from, to: x.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setPer({}); setCal(false); }} /></div> : null}
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('icx.loading')}</div> : !rows.length ? <Empty title={t('icx.noActivity')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('icx.col.when')}</th><th>{t('icx.col.product')}</th><th>{t('icx.col.type')}</th><th>{t('icx.col.change')}</th><th>{t('icx.col.after')}</th><th>{t('icx.col.by')}</th></tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.id} data-testid="icx-move-row">
              <td className="nowrap">{when(m.at)}</td><td><b>{m.product}</b>{m.reason ? <div className="sub">{m.reason}</div> : null}</td>
              <td>{t('icx.type.' + m.group)}</td><td>{m.change == null ? '—' : (m.change > 0 ? '+' : '') + fmtNumber(m.change)}</td><td>{m.after == null ? '—' : fmtNumber(m.after)}</td><td>{m.actor ?? '—'}</td>
            </tr>))}</tbody></table></div>)}
    </Frame>
  );
}
