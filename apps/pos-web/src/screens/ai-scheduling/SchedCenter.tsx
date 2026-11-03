// SchedCenter.tsx — AI Scheduling Optimizer guide (Nov 2 2026): the page's read side over /pos/ai-scheduling-optimizer/center/*.
//   • SchedCounters — the four photographed counters (Open recommendations · Awaiting customer approval · Automatic optimization
//     · Module), computed by the server with one stated definition each; "Module" opens into its parts; the last evaluation is
//     the worker's completion time (never the browser clock); data freshness; Check Scheduling System (read-only).
//   • SchedQueueCard — the recommendation queue: search, status group, which date, presets + month calendar, numbered pages,
//     newest first; a row says when the appointment moved since the suggestion (stale — apply will refuse it).
//   • SchedEventTrailCard — History as the append-only event trail (generated · staff · customer · apply), newest first.
// Nothing here changes a schedule: decisions, approvals and applying stay on the recommendation detail (the engine routes).
import { useCallback, useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../../components/FitKit';
import { RangeCalendar, isForbidden } from '../../components/FinanceKit';
import { errorTextOf } from '../../i18n/error-text';
import { fmtNumber, fmtInZone } from '../../i18n/format';
import { STATUS_LABEL, TYPE_LABEL, statusTone, pill, hm, pretty } from './schedUi';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const SC_GROUPS = ['all', 'open', 'customer', 'accepted', 'applied', 'failed', 'closed', 'stale'] as const;
const DATE_FIELDS = ['created', 'appointment', 'decided', 'applied'] as const;
const PRESETS = ['today', 'week', 'month', 'last_month', 'last_30'] as const;
const KINDS = ['all', 'generated', 'staff', 'customer', 'apply'] as const;
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const MODULE_TONE: Record<string, 'ok' | 'warn' | 'bad' | undefined> = { enabled: 'ok', disabled: 'warn', emergency_stopped: 'bad', platform_stopped: 'bad', subscription_restricted: 'warn', subscription_unknown: 'warn', unknown: 'warn' };
const ACTIONS = ['generated', 'submit_for_review', 'start_review', 'accept', 'partial_accept', 'reject', 'return', 'customer_approve', 'customer_reject', 'queue_application', 'apply_ok', 'apply_fail', 'retry', 'rollback', 'expire', 'supersede'];
type Period = { preset?: string; from?: string; to?: string };

export function scErr(e: unknown, fallbackKey = 'scx.loadFailed') {
  const x = e as { body?: { code?: string }; code?: string } | null;
  const code = x?.body?.code ?? x?.code;
  if (code === 'SC_INVALID_PERIOD') return t('scx.err.SC_INVALID_PERIOD');
  if (isForbidden(e)) return t('scx.err.PERMISSION_DENIED');
  if ((e as { status?: number } | null)?.status === 503) return t('scx.err.unavailable');
  return errorTextOf(e, t(fallbackKey));
}

// ── the four counters ─────────────────────────────────────────────────────────────────────────────────────────────
export function SchedCounters({ tick, onDrill }: { tick: number; onDrill: (group: (typeof SC_GROUPS)[number]) => void }) {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [parts, setParts] = useState(false);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const load = useCallback(() => { setErr(null); api.center.summary().then(setS).catch((e) => setErr(scErr(e))); }, []);
  useEffect(() => { load(); }, [load, tick]);
  const runCheck = () => { setHealth('loading'); api.center.check().then(setHealth).catch((e) => setHealth({ error: scErr(e) })); };
  const c = s?.counters ?? null; const m = s?.more ?? null; const mp = s?.moduleParts ?? null;
  return (
    <section data-testid="scx-counters" aria-label={t('scx.counters')} style={{ display: 'grid', gap: 8 }}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : null}
      <div className="rvw-kpis">
        <KpiCard testId="scx-kpi-open" label={t('scx.kpi.open')} value={c ? fmtNumber(c.openRecommendations) : '—'} loading={!s && !err} tone={c?.openRecommendations ? 'gold' : undefined} onClick={() => onDrill('open')} />
        <KpiCard testId="scx-kpi-customer" label={t('scx.kpi.customer')} value={c ? fmtNumber(c.awaitingCustomer) : '—'} loading={!s && !err} onClick={() => onDrill('customer')} />
        <KpiCard testId="scx-kpi-auto" label={t('scx.kpi.auto')} value={c ? t('scx.auto.' + c.automation) : '—'} loading={!s && !err} tone={c?.automation === 'on' ? 'gold' : c && c.automation !== 'off' && c.automation !== 'module_off' ? 'warn' : undefined} />
        <KpiCard testId="scx-kpi-module" label={t('scx.kpi.module')} value={c ? t('scx.module.' + c.module) : '—'} loading={!s && !err} tone={c ? MODULE_TONE[c.module] : undefined} onClick={() => setParts((x) => !x)} />
      </div>
      {s ? <div className="sub" data-testid="scx-eval">
        {s.lastEvaluation ? t('scx.lastEval', { at: when(s.lastEvaluation.at), trigger: t('scx.trigger.' + (s.lastEvaluation.trigger ?? 'manual')) }) : t('scx.neverEvaluated')}
        {' · '}{t('scx.fresh.booking', { at: when(s.freshness?.booking) })}{' · '}{t('scx.fresh.timeOff', { at: when(s.freshness?.timeOff) })}
        {' · '}<button className="btn ghost sm" data-testid="scx-check" onClick={runCheck}>{t('scx.check')}</button>
      </div> : null}
      {m && (m.pastExpiry || m.applyFailed || m.openConflicts) ? <div data-testid="scx-more" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {m.openConflicts ? <span className="chip bad">{t('scx.more.conflicts', { n: fmtNumber(m.openConflicts) })}</span> : null}
        {m.applyFailed ? <button className="chip bad" onClick={() => onDrill('failed')}>{t('scx.more.failed', { n: fmtNumber(m.applyFailed) })}</button> : null}
        {m.pastExpiry ? <span className="chip warn" title={t('scx.more.pastExpiryHint')}>{t('scx.more.pastExpiry', { n: fmtNumber(m.pastExpiry) })}</span> : null}
      </div> : null}
      {parts && mp ? <div className="panel" style={{ padding: 10 }} data-testid="scx-module-parts">
        <div>{t('scx.part.switch')}: <b>{mp.enabled == null ? t('scx.unknown') : t(mp.enabled ? 'scx.on' : 'scx.off')}</b></div>
        <div>{t('scx.part.emergency')}: <b>{mp.emergencyStop == null ? t('scx.unknown') : t(mp.emergencyStop ? 'scx.on' : 'scx.off')}</b></div>
        <div>{t('scx.part.platform')}: <b>{mp.platformStop == null ? t('scx.unknown') : t(mp.platformStop ? 'scx.on' : 'scx.off')}</b></div>
        <div>{t('scx.part.subscription')}: <b>{mp.subscription ? t(mp.subscription.allowed ? 'scx.sub.active' : 'scx.sub.restricted') : t('scx.unknown')}</b></div>
        <div>{t('scx.part.lastRun')}: <b>{mp.lastRun ? `${pretty(mp.lastRun.status)} · ${when(mp.lastRun.at)}${mp.lastRun.errorCode ? ` (${mp.lastRun.errorCode})` : ''}` : t('scx.neverEvaluated')}</b></div>
        <p className="sub">{t('scx.part.note')}</p>
      </div> : null}
      {health ? <SchedHealthDialog data={health} onClose={() => setHealth(null)} /> : null}
    </section>
  );
}

function SchedHealthDialog({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <FitDialog wide testId="scx-health" title={t('scx.check')} subtitle={data && data !== 'loading' && !data.error ? t('scx.health.overall', { s: t('scx.health.' + data.overall), at: when(data.checkedAt) }) : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('scx.close')}</button>}>
      {data === 'loading' ? <div className="state">{t('scx.health.running')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('scx.health.readOnly')}{data.reused ? ` ${t('scx.health.recent')}` : ''}</p>
        {(data.checks ?? []).map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`scx-chk-${x.key}`}>
            <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')}>{t('scx.health.' + x.state)}</span> <b>{t('scx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{t('scx.health.d.' + x.key + '.' + x.state)}</div>
          </div>
        ))}
      </>}
    </FitDialog>
  );
}

// ── the recommendation queue ──────────────────────────────────────────────────────────────────────────────────────
const slot = (x: any) => (x ? `${x.date ?? '—'} ${hm(x.start)} · ${x.technician ?? t('scx.anyTech')}` : '—');
export function SchedQueueCard({ tick, group: initialGroup = 'all', compact = false, selectedId, onSelect }: {
  tick: number; group?: (typeof SC_GROUPS)[number]; compact?: boolean; selectedId?: string | null; onSelect: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; group: string; dateField: string; page: number; pageSize: number }>({ group: initialGroup, dateField: 'created', page: 1, pageSize: compact ? 10 : 25 });
  const [period, setPeriod] = useState<Period>({});
  const [cal, setCal] = useState(false);
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setF((x) => ({ ...x, group: initialGroup, page: 1 })); }, [initialGroup]);
  const load = useCallback(() => { setErr(null); api.center.recommendations({ ...f, ...period, q: f.q }).then(setList).catch((e) => setErr(scErr(e))); }, [f, period]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (p: Partial<typeof f>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));
  const setPer = (p: Period) => { setPeriod(p); setF((x) => ({ ...x, page: 1 })); };
  const any = !!(f.q || f.group !== 'all' || period.preset);
  const items: any[] = Array.isArray(list?.items) ? list.items : [];
  const rows = compact ? items.slice(0, 5) : items;
  return (
    <section className="panel rvw-feed" data-testid={compact ? 'scx-recent' : 'scx-queue'} style={{ padding: 12 }}>
      <div className="p-h">{t(compact ? 'scx.recent' : 'scx.queue')} <span className="sub">· {t('scx.newestFirst')}{list ? ` · ${fmtNumber(list.total)}` : ''}</span></div>
      {!compact ? <>
        <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
          <input className="rvw-search" data-testid="scx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t(list?.customersVisible === false ? 'scx.searchPhNoCustomer' : 'scx.searchPh')} aria-label={t('scx.searchPh')} />
          <button className="btn" type="submit">{t('scx.search')}</button>
          <select data-testid="scx-group" aria-label={t('scx.statusLabel')} value={f.group} onChange={(e) => set({ group: e.target.value })}>{SC_GROUPS.map((g) => <option key={g} value={g}>{t('scx.group.' + g)}</option>)}</select>
          <select data-testid="scx-datefield" aria-label={t('scx.dateLabel')} value={f.dateField} onChange={(e) => set({ dateField: e.target.value })}>{DATE_FIELDS.map((d) => <option key={d} value={d}>{t('scx.date.' + d)}</option>)}</select>
          {any ? <button className="btn ghost" type="button" onClick={() => { setDraft(''); setPeriod({}); set({ q: undefined, group: 'all' }); }}>{t('scx.clear')}</button> : null}
        </form>
        <div className="rvw-dates">
          <button className={'btn ghost' + (!period.preset ? ' on' : '')} onClick={() => setPer({})}>{t('scx.preset.all')}</button>
          {PRESETS.map((p) => <button key={p} className={'btn ghost' + (period.preset === p ? ' on' : '')} data-testid={`scx-preset-${p}`} onClick={() => setPer({ preset: p })}>{t('scx.preset.' + p)}</button>)}
          <button className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} data-testid="scx-preset-custom" onClick={() => setCal(true)}>{period.preset === 'custom' ? `${period.from} → ${period.to}` : t('scx.preset.custom')}</button>
        </div>
        {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={list?.period?.today ?? new Date().toISOString().slice(0, 10)}
          onApply={(r) => { setPer({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setPer({}); setCal(false); }} /></div> : null}
        <p className="sub">{t('scx.dateNote.' + f.dateField)}</p>
      </> : null}
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('scx.loading')}</div> : rows.length === 0 ? <Empty title={any ? t('scx.noMatch') : t('scx.none')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>
          <th>{t('scx.col.suggestion')}</th><th>{t('scx.col.before')}</th><th>{t('scx.col.after')}</th><th>{t('scx.col.status')}</th><th>{t('scx.col.created')}</th></tr></thead>
          <tbody>{rows.map((r: any) => {
            const tone = statusTone(r.status);
            return (
              <tr key={r.id} data-testid="scx-row" tabIndex={0} aria-selected={selectedId === r.id} onClick={() => onSelect(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(r.id); }}>
                <td><b>{(TYPE_LABEL as Record<string, string>)[r.type] ?? pretty(r.type)}</b>
                  <div className="sub">{r.customer ? `${r.customer}${r.customerPhoneLast4 ? ` · •••${r.customerPhoneLast4}` : ''} · ` : ''}{(r.services ?? []).join(', ') || '—'}</div>
                  <div className="sub">#{String(r.id).slice(0, 8)}{r.branch ? ` · ${r.branch}` : ''}</div></td>
                <td className="nowrap">{slot(r.before)}</td>
                <td className="nowrap">{slot(r.after)}</td>
                <td><span style={pill(tone.bg, tone.fg)}>{(STATUS_LABEL as Record<string, string>)[r.status] ?? pretty(r.status)}</span>
                  {r.stale ? <div><span className="chip bad" data-testid="scx-stale">{t(r.appointmentMissing ? 'scx.apptGone' : 'scx.stale')}</span></div> : null}
                  {r.pastExpiry ? <div><span className="chip warn">{t('scx.pastExpiry')}</span></div> : null}
                  {r.needsCustomer ? <div className="sub">{t('scx.needsCustomer')}</div> : null}
                  {r.automated ? <div className="sub">{t('scx.automated')}</div> : null}</td>
                <td className="nowrap">{when(r.createdAt)}{r.confidence != null ? <div className="sub">{t('scx.confidence', { n: Math.round(r.confidence * 100) })}</div> : null}</td>
              </tr>
            );
          })}</tbody></table></div>)}
      {!compact ? <div className="rvw-pager">
        <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
        <label className="rvw-f"><span>{t('scx.rows')}</span><select value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div> : null}
    </section>
  );
}

// ── History: the event trail ──────────────────────────────────────────────────────────────────────────────────────
export function SchedEventTrailCard({ tick, onSelect }: { tick: number; onSelect: (id: string) => void }) {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; kind: string; page: number; pageSize: number }>({ kind: 'all', page: 1, pageSize: 25 });
  const [period, setPeriod] = useState<Period>({});
  const [cal, setCal] = useState(false);
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); api.center.history({ ...f, ...period, q: f.q }).then(setList).catch((e) => setErr(scErr(e))); }, [f, period]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (p: Partial<typeof f>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));
  const setPer = (p: Period) => { setPeriod(p); setF((x) => ({ ...x, page: 1 })); };
  const actor = (a: string | null) => (!a ? '—' : a === 'automation' || a === 'customer' ? t('scx.actor.' + a) : a);
  return (
    <section className="panel rvw-feed" data-testid="scx-trail" style={{ padding: 12 }}>
      <div className="p-h">{t('scx.trail')} <span className="sub">· {t('scx.newestFirst')} · {t('scx.trailNote')}</span></div>
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" data-testid="scx-trail-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('scx.trailSearchPh')} aria-label={t('scx.trailSearchPh')} />
        <button className="btn" type="submit">{t('scx.search')}</button>
        <select data-testid="scx-kind" aria-label={t('scx.kindLabel')} value={f.kind} onChange={(e) => set({ kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{t('scx.kind.' + k)}</option>)}</select>
      </form>
      <div className="rvw-dates">
        <button className={'btn ghost' + (!period.preset ? ' on' : '')} onClick={() => setPer({})}>{t('scx.preset.all')}</button>
        {PRESETS.map((p) => <button key={p} className={'btn ghost' + (period.preset === p ? ' on' : '')} onClick={() => setPer({ preset: p })}>{t('scx.preset.' + p)}</button>)}
        <button className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} onClick={() => setCal(true)}>{period.preset === 'custom' ? `${period.from} → ${period.to}` : t('scx.preset.custom')}</button>
      </div>
      {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={list?.period?.today ?? new Date().toISOString().slice(0, 10)}
        onApply={(r) => { setPer({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setPer({}); setCal(false); }} /></div> : null}
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('scx.loading')}</div> : !Array.isArray(list.items) || list.items.length === 0 ? <Empty title={t('scx.noEvents')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('scx.col.when')}</th><th>{t('scx.col.event')}</th><th>{t('scx.col.by')}</th><th>{t('scx.col.result')}</th><th /></tr></thead>
          <tbody>{list.items.map((e: any, i: number) => (
            <tr key={`${e.recommendationId}-${e.action}-${e.at}-${i}`} data-testid="scx-event">
              <td className="nowrap">{when(e.at)}</td>
              <td><span className="chip">{t('scx.kind.' + e.kind)}</span> <b>{t('scx.act.' + (ACTIONS.includes(e.action) ? e.action : 'other'))}</b><div className="sub">#{String(e.recommendationId).slice(0, 8)}</div></td>
              <td>{actor(e.actor)}</td>
              <td>{e.outcome ? ((STATUS_LABEL as Record<string, string>)[e.outcome] ?? pretty(e.outcome)) : '—'}{e.reason ? <div className="sub">{e.reason}</div> : null}</td>
              <td><button className="btn ghost sm" onClick={() => onSelect(e.recommendationId)}>{t('scx.open')}</button></td>
            </tr>))}</tbody></table></div>)}
      <div className="rvw-pager">
        <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
        <label className="rvw-f"><span>{t('scx.rows')}</span><select value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
    </section>
  );
}
