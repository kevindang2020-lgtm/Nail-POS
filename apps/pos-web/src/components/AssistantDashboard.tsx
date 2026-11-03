// AssistantDashboard.tsx — the AI add-on pages' workspace (Nov 3 2026: AI Review / Reputation, Customer Profile, Checkout Upsell and
// Fraud & Money Protection assistant guides). Each add-on page keeps its honest subscription header (AiPackagePanel) and, in the empty
// space below it, shows the module's OWN verified numbers, a searchable list of its records (search · filters · presets + From/To
// month calendar · numbered pages, newest first), and the module's read-only system check. Everything is read from the module that
// owns the data — no second review / customer / checkout / fraud system — and every change still happens in that module's workspace,
// which the page links to.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from './FitKit';
import { RangeCalendar, isForbidden } from './FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
export const asWhen = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
function toErr(e: unknown, custom?: (e: unknown) => string | null): string {
  return custom?.(e) ?? (isForbidden(e) ? t('asx.forbidden') : errorTextOf(e, t('asx.loadFailed')));
}
const DEFAULT_PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year'];

export type AsKpi = { key: string; label: string; value: (s: any) => string; tone?: (s: any) => 'warn' | 'bad' | 'gold' | undefined; hint?: string };
export type AsCol = { key: string; label: string; render: (r: any) => ReactNode };
export type AsFilter = { key: string; label: string; options: { value: string; label: string }[] };
export type AsCheckText = { title: (key: string) => string; detail: (key: string, state: string) => string; part?: (c: any) => string | null };
export interface AssistantDashboardProps {
  testId: string;
  /** the module's counters (null when it cannot be read — shown as an error, never as zeros) */
  summary: () => Promise<any>;
  kpis: AsKpi[];
  /** the module's own list: receives { q, <filters>, preset, from, to, sort, page, pageSize } */
  list: (q: Record<string, string | number | undefined>) => Promise<any>;
  columns: AsCol[];
  rowKey: (r: any) => string;
  filters?: AsFilter[];
  sorts?: { value: string; label: string }[];
  presets?: string[];
  searchPlaceholder: string;
  listTitle: string;
  emptyText: (filtered: boolean, summary: any) => string;
  check: () => Promise<any>;
  checkLabel: string;
  checkText: AsCheckText;
  openTo: string;
  openLabel: string;
  note?: ReactNode;
  errText?: (e: unknown) => string | null;
}

export function AssistantDashboard(p: AssistantDashboardProps) {
  const [sum, setSum] = useState<any>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState('');
  const initial = Object.fromEntries((p.filters ?? []).map((f) => [f.key, f.options[0]?.value ?? 'all']));
  const [f, setF] = useState<Record<string, any>>({ ...initial, sort: p.sorts?.[0]?.value, page: 1, pageSize: 25 });
  const [period, setPeriod] = useState<{ preset?: string; from?: string; to?: string }>({});
  const [cal, setCal] = useState(false);
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const custom = useRef(p.errText); custom.current = p.errText;
  const errText = (e: unknown) => toErr(e, custom.current);
  const { summary, list: fetchList } = p;
  const loadSum = useCallback(() => { setSumErr(null); summary().then(setSum).catch((e) => setSumErr(toErr(e, custom.current))); }, [summary]);
  useEffect(() => { loadSum(); }, [loadSum, tick]);
  const load = useCallback(() => { setErr(null); fetchList({ ...f, ...period }).then(setList).catch((e) => setErr(toErr(e, custom.current))); }, [f, period, fetchList]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (x: Record<string, any>, keepPage = false) => setF((y) => ({ ...y, ...x, page: keepPage ? (x.page ?? y.page) : 1 }));
  const setPer = (x: { preset?: string; from?: string; to?: string }) => { setPeriod(x); setF((y) => ({ ...y, page: 1 })); };
  const rows: any[] = Array.isArray(list?.items) ? list.items : [];
  const filtered = !!(f.q || period.preset || (p.filters ?? []).some((x) => f[x.key] !== initial[x.key]));
  const runCheck = () => { setHealth('loading'); p.check().then(setHealth).catch((e) => setHealth({ error: errText(e) })); };
  return (
    <div data-testid={p.testId} style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button className="btn ghost" data-testid="as-refresh" onClick={() => setTick((n) => n + 1)}>{t('asx.refresh')}</button>
        <button className="btn ghost" data-testid="as-check" onClick={runCheck}>{p.checkLabel}</button>
        <Link className="btn" data-testid="as-open" to={p.openTo}>{p.openLabel}</Link>
      </div>
      {p.note ? <p className="sub" style={{ marginTop: 8 }}>{p.note}</p> : null}
      {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSum} /> : null}
      <div className="rvw-kpis" data-testid="as-kpis" style={{ marginTop: 10 }}>
        {p.kpis.map((k) => <KpiCard key={k.key} testId={`as-kpi-${k.key}`} label={k.label} value={sum ? k.value(sum) : '—'} loading={!sum && !sumErr} tone={sum ? k.tone?.(sum) : undefined} />)}
      </div>
      <section className="panel rvw-feed" style={{ padding: 12, marginTop: 12 }} data-testid="as-list">
        <div className="p-h">{p.listTitle}</div>
        <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
          <input className="rvw-search" type="search" data-testid="as-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={p.searchPlaceholder} aria-label={p.searchPlaceholder} />
          <button className="btn" type="submit">{t('asx.search')}</button>
          {(p.filters ?? []).map((x) => <select key={x.key} data-testid={`as-f-${x.key}`} aria-label={x.label} value={f[x.key]} onChange={(e) => set({ [x.key]: e.target.value })}>
            {x.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>)}
          {p.sorts?.length ? <select data-testid="as-sort" aria-label={t('asx.sort')} value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{p.sorts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : null}
          {filtered ? <button className="btn ghost" type="button" data-testid="as-clear" onClick={() => { setDraft(''); setPeriod({}); set({ ...initial, q: undefined }); }}>{t('asx.clear')}</button> : null}
        </form>
        <div className="rvw-dates">
          <button className={'btn ghost' + (!period.preset ? ' on' : '')} onClick={() => setPer({})}>{t('asx.preset.all')}</button>
          {(p.presets ?? DEFAULT_PRESETS).map((x) => <button key={x} className={'btn ghost' + (period.preset === x ? ' on' : '')} data-testid={`as-preset-${x}`} onClick={() => setPer({ preset: x })}>{t('asx.preset.' + x)}</button>)}
          <button className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} data-testid="as-custom" onClick={() => setCal(true)}>{period.preset === 'custom' ? `${period.from} → ${period.to}` : t('asx.preset.custom')}</button>
        </div>
        {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={list?.period?.today ?? new Date().toISOString().slice(0, 10)}
          onApply={(r) => { setPer({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setPer({}); setCal(false); }} /></div> : null}
        {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('asx.loading')}</div> : rows.length === 0 ? <Empty title={p.emptyText(filtered, sum)} /> : (
          <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>{p.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={p.rowKey(r)} data-testid="as-row">{p.columns.map((c) => <td key={c.key}>{c.render(r)}</td>)}</tr>)}</tbody></table></div>)}
        <div className="rvw-pager">
          <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(n) => set({ page: n }, true)} />
          <label className="rvw-f"><span>{t('asx.rows')}</span><select data-testid="as-rows" value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
      </section>
      {health ? <FitDialog wide testId="as-health" title={p.checkLabel} onClose={() => setHealth(null)}
        subtitle={health !== 'loading' && !health.error ? t('asx.health.overall', { s: t('asx.health.' + health.overall), at: asWhen(health.checkedAt) }) : undefined}
        footer={<button className="btn ghost" onClick={() => setHealth(null)}>{t('asx.close')}</button>}>
        {health === 'loading' ? <div className="state">{t('asx.health.running')}</div> : health.error ? <div className="err">{health.error}</div> : <>
          <p className="sub">{t('asx.health.readOnly')}{health.reused ? ` ${t('asx.health.recent')}` : ''}</p>
          {(health.checks ?? []).map((x: any) => (
            <div key={x.key} className="rvw-check" data-testid={`as-chk-${x.key}`}>
              <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')}>{t('asx.health.' + x.state)}</span> <b>{p.checkText.title(x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
              <div className="sub">{p.checkText.detail(x.key, x.state)}</div>
              {p.checkText.part?.(x) || x.lastPassedAt !== undefined ? <div className="sub">{[p.checkText.part?.(x), x.lastPassedAt !== undefined ? (x.lastPassedAt ? t('asx.health.lastPassed', { at: asWhen(x.lastPassedAt) }) : t('asx.health.neverPassed')) : null].filter(Boolean).join(' · ')}</div> : null}
            </div>))}
        </>}
      </FitDialog> : null}
    </div>
  );
}
