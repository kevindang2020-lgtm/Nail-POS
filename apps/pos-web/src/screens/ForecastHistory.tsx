// ForecastHistory.tsx — AI Analytics & Forecasting guide (Nov 2 2026): the forecast history (search, type, status, presets +
// From/To month calendars, newest first, numbered pages), one run's forecast vs actual, and the read-only
// "Check AI Analytics & Forecasting System". Used by POSAiForecastingScreen. Nothing here makes or changes a forecast.
import { useCallback, useEffect, useState } from 'react';
import { posAiForecastingApi } from '../api/posAiForecastingApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { money } from './reportsCommon';
import { growthCode } from './growthLabels';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const fc = posAiForecastingApi.center;
const TYPES = ['all', 'appointments', 'revenue', 'product_demand'] as const;
const STATUSES = ['all', 'pending', 'awaiting', 'partial', 'evaluated'] as const;
const SORTS = ['newest', 'oldest'] as const;
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year'] as const;
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const STATUS_TONE: Record<string, string> = { pending: '', awaiting: 'warn', partial: '', evaluated: 'ok' };
const codeOf = (e: unknown) => { const x = e as { code?: string; details?: { code?: string } } | null; return x?.code ?? x?.details?.code; };
function errText(e: unknown) {
  const c = codeOf(e);
  if (c === 'FC_INVALID_PERIOD' || c === 'FC_RUN_NOT_FOUND') return t('fch.err.' + c);
  if (isForbidden(e)) return t('fch.err.forbidden');
  return errorTextOf(e, t('fch.loadFailed'));
}
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
/** revenue is stored in cents; appointments and product demand are counts */
const val = (domain: string, n: number | null | undefined) => (n == null ? '—' : domain === 'revenue' ? money(n) : fmtNumber(Math.round(n * 10) / 10));
type Period = { preset?: string; from?: string; to?: string };
type RunRow = { runId: string; domain: string; model: string; modelVersion: string; branch: string | null; product: string | null; generatedAt: string | null; days: number;
  firstDay: string | null; lastDay: string | null; status: string; matured: number; realized: number; wape: number | null; coverage: number | null; backtestWape: number | null };

/** the header button + its dialog */
export function ForecastCheckButton() {
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const runCheck = () => { setHealth('loading'); fc.check().then(setHealth).catch((e) => setHealth({ error: errText(e) })); };
  return <>
    <button className="btn ghost w-fit whitespace-nowrap" data-testid="fch-check" onClick={runCheck}>{t('fch.check')}</button>
    {health ? <FitDialog wide testId="fch-health" title={t('fch.check')} onClose={() => setHealth(null)}
      subtitle={health !== 'loading' && !health.error ? t('fch.health.overall', { s: t('fch.health.' + health.overall), at: when(health.checkedAt) }) : undefined}
      footer={<button className="btn ghost" onClick={() => setHealth(null)}>{t('fch.close')}</button>}>
      {health === 'loading' ? <div className="state">{t('fch.health.running')}</div> : health.error ? <div className="err">{health.error}</div> : <>
        <p className="sub">{t('fch.health.readOnly')}{health.reused ? ` ${t('fch.health.recent')}` : ''}</p>
        {(health.checks ?? []).map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`fch-chk-${x.key}`}>
            <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')}>{t('fch.health.' + x.state)}</span> <b>{t('fch.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{t('fch.health.d.' + x.key + '.' + x.state)}</div>
            <div className="sub">{t('fch.health.part', { c: t('fch.comp.' + x.component) })} · {x.lastPassedAt ? t('fch.health.lastPassed', { at: when(x.lastPassedAt) }) : t('fch.health.neverPassed')} · {t('fch.health.checkedAt', { at: when(health.checkedAt) })}</div>
          </div>))}
      </>}
    </FitDialog> : null}
  </>;
}

export function ForecastHistory() {
  const [sum, setSum] = useState<any>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; domain: string; status: string; sort: string; page: number; pageSize: number }>({ domain: 'all', status: 'all', sort: 'newest', page: 1, pageSize: 25 });
  const [period, setPeriod] = useState<Period>({});
  const [cal, setCal] = useState(false);
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const loadSum = useCallback(() => { setSumErr(null); fc.summary().then(setSum).catch((e) => setSumErr(errText(e))); }, []);
  useEffect(() => { loadSum(); }, [loadSum]);
  const load = useCallback(() => { setErr(null); fc.runs({ ...f, ...period }).then(setList).catch((e) => setErr(errText(e))); }, [f, period]);
  useEffect(() => { load(); }, [load]);
  const set = (p: Partial<typeof f>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));
  const setPer = (p: Period) => { setPeriod(p); setF((x) => ({ ...x, page: 1 })); };
  const items: RunRow[] = Array.isArray(list?.items) ? list.items : [];
  const domains: string[] = Array.isArray(list?.domains) ? list.domains : Array.isArray(sum?.domains) ? sum.domains : [];
  const filtered = !!(f.q || f.domain !== 'all' || f.status !== 'all' || period.preset);
  const c = sum?.counters;
  return (
    <section className="panel" data-testid="fch-history" style={{ padding: 12, marginTop: 16 }}>
      <div className="p-h">{t('fch.history')}</div>
      <p className="sub">{t('fch.historyNote')}</p>
      {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSum} /> : null}
      <div className="rvw-kpis" data-testid="fch-kpis">
        <KpiCard testId="fch-kpi-runs" label={t('fch.kpi.runs')} value={c ? fmtNumber(c.runs) : '—'} loading={!sum && !sumErr} />
        <KpiCard testId="fch-kpi-runs30" label={t('fch.kpi.runs30')} value={c ? fmtNumber(c.runs30d) : '—'} loading={!sum && !sumErr} />
        <KpiCard testId="fch-kpi-awaiting" label={t('fch.kpi.awaiting')} value={c ? fmtNumber(c.awaitingActual) : '—'} loading={!sum && !sumErr} tone={c?.awaitingActual ? 'warn' : undefined} onClick={() => set({ status: 'awaiting' })} />
        <KpiCard testId="fch-kpi-evaluated" label={t('fch.kpi.evaluated')} value={c ? fmtNumber(c.evaluatedDays) : '—'} loading={!sum && !sumErr} />
      </div>
      {sum?.lastRun ? <div className="sub" data-testid="fch-lastrun" style={{ marginTop: 6 }}>
        {Object.entries(sum.lastRun as Record<string, string | null>).map(([d, at]) => `${t('fch.type.' + d)}: ${at ? when(at) : t('fch.never')}`).join(' · ')}
      </div> : null}

      <form className="rvw-filters" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" data-testid="fch-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('fch.searchPh')} aria-label={t('fch.searchPh')} />
        <button className="btn" type="submit">{t('fch.search')}</button>
        <select data-testid="fch-type" aria-label={t('fch.typeLabel')} value={f.domain} onChange={(e) => set({ domain: e.target.value })}>
          {TYPES.filter((k) => k === 'all' || domains.includes(k)).map((k) => <option key={k} value={k}>{t('fch.type.' + k)}</option>)}</select>
        <select data-testid="fch-status" aria-label={t('fch.statusLabel')} value={f.status} onChange={(e) => set({ status: e.target.value })}>{STATUSES.map((k) => <option key={k} value={k}>{t('fch.status.' + k)}</option>)}</select>
        <select data-testid="fch-sort" aria-label={t('fch.sortLabel')} value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{SORTS.map((k) => <option key={k} value={k}>{t('fch.sort.' + k)}</option>)}</select>
        {filtered ? <button className="btn ghost" type="button" data-testid="fch-clear" onClick={() => { setDraft(''); setPeriod({}); set({ q: undefined, domain: 'all', status: 'all' }); }}>{t('fch.clear')}</button> : null}
      </form>
      <div className="rvw-dates">
        <button className={'btn ghost' + (!period.preset ? ' on' : '')} onClick={() => setPer({})}>{t('fch.preset.all')}</button>
        {PRESETS.map((p) => <button key={p} className={'btn ghost' + (period.preset === p ? ' on' : '')} data-testid={`fch-preset-${p}`} onClick={() => setPer({ preset: p })}>{t('fch.preset.' + p)}</button>)}
        <button className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} data-testid="fch-custom" onClick={() => setCal(true)}>{period.preset === 'custom' ? `${period.from} → ${period.to}` : t('fch.preset.custom')}</button>
      </div>
      {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={list?.period?.today ?? deviceToday()}
        onApply={(r) => { setPer({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setPer({}); setCal(false); }} /></div> : null}

      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('fch.loading')}</div> : items.length === 0
        ? <Empty title={filtered ? t('fch.noMatch') : t('fch.empty')} /> : (
          <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>
            <th>{t('fch.col.generated')}</th><th>{t('fch.col.type')}</th><th>{t('fch.col.model')}</th><th>{t('fch.col.days')}</th><th>{t('fch.col.status')}</th><th>{t('fch.col.error')}</th><th>{t('fch.col.coverage')}</th><th /></tr></thead>
            <tbody>{items.map((r) => (
              <tr key={r.runId} data-testid="fch-row">
                <td className="nowrap">{when(r.generatedAt)}<div className="sub">{r.branch ?? '—'}</div></td>
                <td>{t('fch.type.' + r.domain)}{r.product ? <div className="sub">{r.product}</div> : null}</td>
                <td>{growthCode(r.model, 'level')}<div className="sub">{r.modelVersion}</div></td>
                <td className="nowrap">{r.firstDay} → {r.lastDay}<div className="sub">{fmtNumber(r.days)}</div></td>
                <td><span className={'chip ' + (STATUS_TONE[r.status] ?? '')} data-testid="fch-status-chip">{t('fch.status.' + r.status)}</span><div className="sub">{fmtNumber(r.realized)} / {fmtNumber(r.days)}</div></td>
                <td>{pct(r.wape)}</td>
                <td>{pct(r.coverage)}</td>
                <td><button className="btn ghost sm" data-testid="fch-view" onClick={() => setOpen(r.runId)}>{t('fch.view')}</button></td>
              </tr>))}</tbody></table></div>)}
      <div className="rvw-pager">
        <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
        <label className="rvw-f"><span>{t('fch.rows')}</span><select data-testid="fch-rows" value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
      {open ? <RunDialog runId={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

function RunDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); fc.run(runId).then(setData).catch((e) => setErr(errText(e))); }, [runId]);
  useEffect(() => { load(); }, [load]);
  const r = data?.run;
  return (
    <FitDialog wide testId="fch-run" title={t('fch.runTitle')} subtitle={r ? `${t('fch.type.' + r.domain)} · ${growthCode(r.model, 'level')} ${r.modelVersion} · ${when(r.generatedAt)}` : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('fch.close')}</button>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !data ? <div className="state">{t('fch.loading')}</div> : <>
        <p className="sub">{t('fch.runId', { id: r.runId })} · {r.backtestWape == null ? t('fch.backtestNone') : t('fch.backtest', { v: pct(r.backtestWape) })}</p>
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>
          <th>{t('fch.d.date')}</th><th>{t('fch.d.forecast')}</th><th>{t('fch.d.range')}</th><th>{t('fch.d.actual')}</th><th>{t('fch.d.error')}</th><th>{t('fch.d.inside')}</th></tr></thead>
          <tbody>{(data.days ?? []).map((d: any) => (
            <tr key={d.step} data-testid="fch-day">
              <td className="nowrap">{d.date}</td>
              <td>{val(r.domain, d.forecast)}</td>
              <td className="nowrap">{val(r.domain, d.lower)} – {val(r.domain, d.upper)}</td>
              <td>{d.actual == null ? <span className="chip">{t('fch.state.' + d.state)}</span> : val(r.domain, d.actual)}</td>
              <td>{val(r.domain, d.error)}</td>
              <td>{d.inside == null ? '—' : d.inside ? t('fch.yes') : t('fch.no')}</td>
            </tr>))}</tbody></table></div>
        <p className="sub">{t('fch.runNote')}</p>
      </>}
    </FitDialog>
  );
}
