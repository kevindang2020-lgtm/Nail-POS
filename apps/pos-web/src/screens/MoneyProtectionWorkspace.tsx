// MoneyProtectionWorkspace.tsx — the six AI Money Protection guides (Nov 2 2026, built Nov 3 2026). The five pages
// (/tenant/ai/money-protection · /alerts · /investigations · /rules · /settings) keep their titles and descriptions and share one
// header: the page tabs, "Run detection now" and "Check AI Money Protection System". Everything is read from
// /pos/money-protection-center/*: the overview says whether monitoring is CURRENT (never "no alerts" when detection never ran);
// alerts and investigations have search, filters, which date, presets + From/To month calendar, sort and numbered pages; an
// alert opens with its evidence, the hóa đơn / payments / staff it points at and its history, and a person acknowledges,
// dismisses (reason) or reopens it — never about their own activity; investigations show an append-only timeline; the 15 rules
// show what each checks and how often it fires; a rule change needs a reason to weaken it and keeps before → after.
// Nothing here moves money.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { SavedViews } from '../components/SavedViews';
import { Link, useSearchParams } from 'react-router-dom';
import { posAIMoneyProtectionApi } from '../api/posAIMoneyProtectionApi';
import { t as tx, getLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { codedText } from '../i18n/coded-text';
import { mpTextCoded } from '@aipowersalon/api-contracts/tenant';
import type { CodedText } from '@aipowersalon/api-contracts';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, downloadText } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { money } from './reportsCommon';
import { deviceToday } from '../lib/deviceToday';
import { statusLabel } from '../i18n/status-label';   // the code stays the truth; only its label is translated

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const mc = posAIMoneyProtectionApi.center;
const GROUPS = ['open', 'new', 'resolved', 'dismissed', 'all'] as const;
const SEVS = ['all', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
const CATS = ['all', 'duplicate_charge', 'refund', 'void', 'discount', 'tip', 'failed_payment', 'reconciliation', 'employee', 'integrity'] as const;
const A_DATES = ['detected', 'last_seen', 'updated'] as const;
const A_SORTS = ['newest', 'oldest', 'severity', 'value'] as const;
const I_STATUS = ['active', 'OPEN', 'INVESTIGATING', 'WAITING_FOR_INFORMATION', 'ESCALATED', 'RESOLVED', 'CLOSED', 'all'] as const;
const I_DATES = ['opened', 'updated', 'closed'] as const;
const I_SORTS = ['updated', 'newest', 'oldest', 'severity', 'value'] as const;
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_90', 'last_month', 'year'] as const;
const RESOLUTIONS = ['EXPECTED_ACTIVITY', 'CUSTOMER_REQUEST', 'APPROVED_MANAGER_ACTION', 'PROCESSOR_ERROR', 'DEVICE_ERROR', 'SOFTWARE_BUG', 'DUPLICATE_WEBHOOK', 'DUPLICATE_CHARGE_CONFIRMED',
  'POLICY_VIOLATION', 'EMPLOYEE_MISUSE_CONFIRMED', 'ACCOUNT_COMPROMISE', 'INVENTORY_ERROR', 'CASH_RECONCILIATION_ERROR', 'FALSE_POSITIVE', 'INSUFFICIENT_EVIDENCE', 'OTHER'];
const MOVES: Record<string, string[]> = { OPEN: ['INVESTIGATING', 'WAITING_FOR_INFORMATION', 'ESCALATED'], INVESTIGATING: ['WAITING_FOR_INFORMATION', 'ESCALATED'], WAITING_FOR_INFORMATION: ['INVESTIGATING', 'ESCALATED'], ESCALATED: ['INVESTIGATING'], RESOLVED: ['CLOSED'] };
const RULE_IDS = ['MP_DUP_CHARGE_EXACT', 'MP_DUP_CHARGE_LIKELY', 'MP_REFUND_EXCEEDS_CAPTURE', 'MP_REFUND_METHOD_MISMATCH', 'MP_DISCOUNT_EXCEEDS_SUBTOTAL', 'MP_NEGATIVE_CAPTURE', 'MP_MULTIPLE_REVERSALS',
  'MP_FAILED_PAYMENT_RETRY_LOOP', 'MP_PAID_NO_CAPTURE', 'MP_CAPTURE_ON_CANCELLED', 'MP_REVERSAL_RATE_OUTLIER', 'MP_MEMBERSHIP_DUP_CHARGE', 'MP_GIFTCARD_NEGATIVE_BALANCE', 'MP_GIFTCARD_REDEEM_EXCEEDS', 'MP_CASH_DRAWER_VARIANCE'];
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const SEV_TONE: Record<string, string> = { CRITICAL: 'bad', HIGH: 'bad', MEDIUM: 'warn', LOW: '', INFO: '' };
const ruleName = (id: string, fallback?: string) => (RULE_IDS.includes(id) ? t('mpx.rule.' + id) : fallback ?? id);
const catName = (c: string | null | undefined) => t('mpx.cat.' + (c && (CATS as readonly string[]).includes(c) ? c : 'other'));
const stName = (s: string) => t('mpx.st.' + s);
const codeOf = (e: unknown) => { const x = e as { code?: string; details?: { code?: string }; body?: { code?: string } } | null; return x?.code ?? x?.details?.code ?? x?.body?.code; };
/** extras (Money Protection 5 · 14): an empty alerts list says WHICH empty it is — filtered, paused, never checked, failed,
 *  stale, no transaction data, or a verified pass that found nothing (with its time) */
/** extras (Money Protection 5 · 03): Evidence Completeness — per source kind, how many the alert points at, how many were
 *  verified in their own tables, missing, changed since the alert last saw them, and what this person may not see */
function EvidenceMeter({ c }: { c: { tickets: K; payments: K; staff: K; customerDetailsLimited: boolean } }) {
  const rows = (['tickets', 'payments', 'staff'] as const).filter((k) => c[k].expected > 0);
  if (!rows.length && !c.customerDetailsLimited) return null;
  return (
    <div className="sub" data-testid="mpx-completeness" style={{ marginTop: 6 }}>
      <b>{t('mpx.cm.title')}</b>
      {rows.map((k) => <div key={k} data-testid={'mpx-cm-' + k}>{t('mpx.d.' + k)}: {t('mpx.cm.line', { v: fmtNumber(c[k].verified), n: fmtNumber(c[k].expected) })}
        {c[k].missing ? ` · ${t('mpx.cm.missing', { n: fmtNumber(c[k].missing) })}` : ''}{c[k].stale ? ` · ${t('mpx.cm.stale', { n: fmtNumber(c[k].stale) })}` : ''}</div>)}
      {c.customerDetailsLimited ? <div data-testid="mpx-cm-limited">{t('mpx.cm.limited')}</div> : null}
    </div>
  );
}
type K = { expected: number; verified: number; missing: number; stale: number };

export function alertsEmpty(f: Record<string, any>, period: { preset?: string | null }, list: any): string {
  const filtered = !!(f.q || period.preset || (f.severity && f.severity !== 'all') || (f.category && f.category !== 'all') || f.rule || (f.status && f.status !== 'open'));
  if (filtered) return t('mpx.noMatch');
  const m = list?.monitor;
  if (!m) return t('mpx.noAlerts');
  if (m.state === 'module_off') return t('mpx.empty.off');
  if (m.state === 'never_checked') return t('mpx.empty.never');
  if (m.state === 'last_run_failed') return t('mpx.empty.failed');
  if (m.state === 'stale') return t('mpx.empty.stale', { at: m.lastSuccessAt ? fmtInZone(m.lastSuccessAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—' });
  if (m.lastEvaluated === 0) return t('mpx.empty.noData');
  return t('mpx.empty.verified', { at: m.lastSuccessAt ? fmtInZone(m.lastSuccessAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—', n: String(m.lastEvaluated ?? 0) });
}

/** Money Protection Rules extras #13 — staff-fairness guardrails: a peer-comparison (baseline) alert says how sure it can be —
 *  this person's sample, the minimum sample required, how many peers were compared and their sample range, and that it is a
 *  statistical comparison to review, never a conclusion. Values the alert did not record show "—". */
export function FairnessNote({ ev }: { ev: any }) {
  const b = ev?.baselineValues; const c = ev?.currentValues;
  if (!b || b.peerMeanRatePct == null) return null;   // only peer-comparison (baseline) alerts carry a peer mean
  const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? fmtNumber(v, d) : '—');
  const range = typeof b.peerCapturedMin === 'number' && typeof b.peerCapturedMax === 'number' ? `${fmtNumber(b.peerCapturedMin)}–${fmtNumber(b.peerCapturedMax)}` : '—';
  const small = typeof c?.capturedTransactions === 'number' && typeof b.minSampleSize === 'number' && c.capturedTransactions < b.minSampleSize * 2;
  return (
    <div className="fk-note" role="note" data-testid="mpx-fair" style={{ margin: '6px 0' }}>
      <b>{t('mpx.fair.title')}</b>
      <div data-testid="mpx-fair-sample">{t('mpx.fair.sample', { n: n(c?.capturedTransactions), r: n(c?.reversals), min: n(b.minSampleSize) })}</div>
      <div data-testid="mpx-fair-peers">{t('mpx.fair.peers', { p: n(b.comparedPeers ?? (typeof b.peerCount === 'number' ? b.peerCount - 1 : undefined)), range, avg: n(b.peerMeanRatePct, 1) })}</div>
      {small ? <div className="warn" data-testid="mpx-fair-small">{t('mpx.fair.small')}</div> : null}
      <div className="sub">{t('mpx.fair.caution')}</div>
    </div>
  );
}
export function mpErr(e: unknown) {
  const c = codeOf(e);
  if (c && ['MC_INVALID_PERIOD', 'MC_NOT_FOUND', 'MC_REASON_REQUIRED', 'MC_STALE', 'MC_STATE_INVALID', 'MC_DETECTION_FAILED', 'SEGREGATION_OF_DUTIES'].includes(c)) return t('mpx.err.' + c);
  if (isForbidden(e)) return t('mpx.err.forbidden');
  return errorTextOf(e, t('mpx.loadFailed'));
}
type Period = { preset?: string; from?: string; to?: string };

/** MONEY PROTECTION ALERTS 14 · AI MONEY PROTECTION 5 · 15 · Money Protection Rules 15 — the controlled export. The SERVER
 *  builds the file (the same filters, every page, a provenance block on top, sanitized columns, one audit row); the screen
 *  only asks for it and saves it. Shown only to people who may export (canExport from the server). */
function MpExport({ view, query, testId }: { view: 'alerts' | 'rules'; query?: Record<string, string | number | undefined>; testId: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const go = () => {
    setBusy(true); setNote(null);
    mc.exportCsv({ ...(query ?? {}), view }).then((csv) => { downloadText(`money-protection-${view}.csv`, String(csv)); setNote({ ok: true, text: t('mpx.export.done') }); })
      .catch((e) => setNote({ ok: false, text: mpErr(e) })).finally(() => setBusy(false));
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" className="btn ghost" data-testid={testId} disabled={busy} onClick={go} title={t('mpx.export.hint')} aria-label={`${t('mpx.export.btn')} — ${t('mpx.export.hint')}`}>{busy ? t('mpx.export.busy') : t('mpx.export.btn')}</button>
      {note ? <span role="status" className={'sub' + (note.ok ? '' : ' warn')} data-testid={`${testId}-note`}>{note.text}</span> : null}
    </span>
  );
}

/** the header every Money Protection page shares: title, description, tabs, Run detection now, Check */
function MpShell({ title, sub, tab, children, onChanged }: { title: string; sub: string; tab: string; children: ReactNode; onChanged?: () => void }) {
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runCheck = () => { setHealth('loading'); mc.check().then(setHealth).catch((e) => setHealth({ error: mpErr(e) })); };
  const runDetection = () => {
    setBusy(true); setNote(null);
    mc.runDetection().then((r: any) => { setNote(r.reused ? t('mpx.runReused') : t('mpx.runDone', { c: fmtNumber(r.created ?? 0), u: fmtNumber(r.updated ?? 0) })); onChanged?.(); })
      .catch((e) => setNote(mpErr(e))).finally(() => setBusy(false));
  };
  const TABS: [string, string][] = [['overview', '/tenant/ai/money-protection'], ['alerts', '/tenant/ai/money-protection/alerts'], ['investigations', '/tenant/ai/money-protection/investigations'],
    ['rules', '/tenant/ai/money-protection/rules'], ['settings', '/tenant/ai/money-protection/settings']];
  return (
    <div className="work" data-testid={`mpx-${tab}`}>
      {/* pinned action row: Run detection / Check stay reachable while a long list scrolls (sticky, not an overlay) */}
      <div className="vh mpx-pinned" data-testid="mpx-pinned" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 260 }}><h1>{title}</h1><div className="sub mb-3">{sub}</div></div>
        <button className="btn ghost" data-testid="mpx-run" disabled={busy} onClick={runDetection}>{busy ? t('mpx.running') : t('mpx.run')}</button>
        <button className="btn ghost" data-testid="mpx-check" onClick={runCheck}>{t('mpx.check')}</button>
      </div>
      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} aria-label={t('mpx.tab.overview')} data-testid="mpx-nav">
        {TABS.map(([k, to]) => <Link key={k} to={to} className={'btn ghost' + (k === tab ? ' on' : '')} aria-current={k === tab ? 'page' : undefined} data-testid={`mpx-tab-${k}`}>{t('mpx.tab.' + k)}</Link>)}
      </nav>
      <p className="sub" data-testid="mpx-safety">{t('mpx.safety')}</p>
      {note ? <div className="panel" role="status" data-testid="mpx-note" style={{ padding: 10, marginBottom: 8 }}>{note}</div> : null}
      {children}
      {health ? <FitDialog wide testId="mpx-health" title={t('mpx.check')} onClose={() => setHealth(null)}
        subtitle={health !== 'loading' && !health.error ? t('mpx.health.overall', { s: t('mpx.health.' + health.overall), at: when(health.checkedAt) }) : undefined}
        footer={<button className="btn ghost" onClick={() => setHealth(null)}>{t('mpx.close')}</button>}>
        {health === 'loading' ? <div className="state">{t('mpx.health.running')}</div> : health.error ? <div className="err">{health.error}</div> : <>
          <p className="sub">{t('mpx.health.readOnly')}{health.reused ? ` ${t('mpx.health.recent')}` : ''}</p>
          {(health.checks ?? []).map((x: any) => (
            <div key={x.key} className="rvw-check" data-testid={`mpx-chk-${x.key}`}>
              <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')}>{t('mpx.health.' + x.state)}</span> <b>{t('mpx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
              <div className="sub">{t('mpx.health.d.' + x.key + '.' + x.state)}</div>
              <div className="sub">{t('mpx.health.part', { c: t('mpx.comp.' + x.component) })} · {x.lastPassedAt ? t('mpx.health.lastPassed', { at: when(x.lastPassedAt) }) : t('mpx.health.neverPassed')}</div>
            </div>))}
        </>}
      </FitDialog> : null}
    </div>
  );
}

/** the shared list frame: search · filters · presets + calendar · table · pager */
function ListFrame({ testId, surface, f, set, period, setPer, today, searchPh, filters, list, err, onRetry, empty, children, total, staleAt }: {
  testId: string; surface: string; f: Record<string, any>; set: (x: Record<string, any>, keep?: boolean) => void; period: Period; setPer: (p: Period) => void; today?: string; searchPh: string;
  filters: ReactNode; list: any; err: string | null; onRetry: () => void; empty: string; children: ReactNode; total?: number; staleAt?: Date | null }) {
  const [draft, setDraft] = useState(f.q ?? '');
  const [cal, setCal] = useState(false);
  return (
    <section className="panel rvw-feed" data-testid={testId} style={{ padding: 12, marginTop: 8 }}>
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" type="search" data-testid="mpx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={searchPh} aria-label={searchPh} />
        <button className="btn" type="submit">{t('mpx.search')}</button>
        {filters}
        <SavedViews surface={surface} testId={`${testId}-views`} current={{ ...f, page: undefined, ...period }}
          onApply={(v) => { const { preset, from, to, ...rest } = v as Record<string, any>; setDraft(typeof rest.q === 'string' ? rest.q : ''); set({ q: undefined, ...rest }); setPer(preset ? { preset, from: from ?? undefined, to: to ?? undefined } : {}); }} />
        {f.q || period.preset ? <button className="btn ghost" type="button" data-testid="mpx-clear" onClick={() => { setDraft(''); setPer({}); set({ q: undefined }); }}>{t('mpx.clear')}</button> : null}
      </form>
      <div className="rvw-dates">
        <button className={'btn ghost' + (!period.preset ? ' on' : '')} onClick={() => setPer({})}>{t('mpx.preset.all')}</button>
        {PRESETS.map((p) => <button key={p} className={'btn ghost' + (period.preset === p ? ' on' : '')} data-testid={`mpx-preset-${p}`} onClick={() => setPer({ preset: p })}>{t('mpx.preset.' + p)}</button>)}
        <button className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} data-testid="mpx-custom" onClick={() => setCal(true)}>{period.preset === 'custom' ? `${period.from} → ${period.to}` : t('mpx.preset.custom')}</button>
      </div>
      {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={today ?? deviceToday()}
        onApply={(r) => { setPer({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setPer({}); setCal(false); }} /></div> : null}
      {staleAt ? <div className="fk-note warn" role="status" data-testid={`${testId}-stale`}><span>{t('mpx.stale.note', { t: fmtInZone(staleAt.toISOString(), { hour: 'numeric', minute: '2-digit' }) || '—' })}</span> <button type="button" className="btn ghost sm" data-testid={`${testId}-stale-retry`} onClick={onRetry}>{t('mpx.stale.retry')}</button></div> : null}
      {err && !staleAt ? <ErrorRetry message={err} onRetry={onRetry} /> : !list ? <div className="state">{t('mpx.loading')}</div> : !total ? <Empty title={empty} /> : children}
      <div className="rvw-pager">
        <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(n) => set({ page: n }, true)} />
        <label className="rvw-f"><span>{t('mpx.rows')}</span><select data-testid="mpx-rows" value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
    </section>
  );
}
function useList<F extends Record<string, any>>(fetch: (q: Record<string, any>) => Promise<any>, initial: F & { q?: string }, tick: number) {
  const [f, setF] = useState<F & { q?: string }>(initial);
  const [period, setPeriod] = useState<Period>({});
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  // MONEY PROTECTION ALERTS extras #15 (offline-safe): remember which query the shown list answered and when. A failed REFRESH
  // of that same query keeps the last-known rows on screen, marked Stale with the time and a Retry — never a blank or a zero.
  // A failed read for a DIFFERENT query (new filter / page) is an error: the old rows would not answer it.
  const [ok, setOk] = useState<{ key: string; at: Date } | null>(null);
  const qKey = JSON.stringify({ ...f, ...period });
  const load = useCallback(() => { setErr(null); const k = JSON.stringify({ ...f, ...period }); fetch({ ...f, ...period }).then((d) => { setList(d); setOk({ key: k, at: new Date() }); }).catch((e) => setErr(mpErr(e))); }, [f, period, fetch]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (x: Record<string, any>, keep = false) => setF((y) => ({ ...y, ...x, page: keep ? (x.page ?? y.page) : 1 }));
  const setPer = (p: Period) => { setPeriod(p); setF((y) => ({ ...y, page: 1 })); };
  const staleAt = err && list && ok && ok.key === qKey ? ok.at : null;
  return { f, set, period, setPer, list, err, load, staleAt };
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────────────────────
export function MpOverview() {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // extras (AI Money Protection 5 · 12): failure-aware snapshot — a failed refresh keeps the last figures, labelled "as of" their
  // read time and stale, instead of an error wall or zeros; with nothing ever read the cards stay "—"
  const [okAt, setOkAt] = useState<Date | null>(null);
  const load = useCallback(() => { setErr(null); mc.summary().then((x) => { setS(x); setOkAt(new Date()); }).catch((e) => setErr(mpErr(e))); }, []);
  useEffect(() => { load(); }, [load, tick]);
  const runs = useList(mc.runs, { page: 1, pageSize: 10 }, tick);
  const c = s?.cards;
  const monAt = s?.monitoring === 'last_run_failed' ? when(s?.lastRun?.startedAt) : when(s?.lastSuccessAt);
  return (
    <MpShell title={tx('pos.ai_money_protection')} sub={tx('pos.possible_financial_anomalies_from_your_real_z6vv')} tab="overview" onChanged={() => setTick((n) => n + 1)}>
      {err && s ? <div className="fk-note warn" role="status" data-testid="mpx-asof"><span>{t('mpx.asof', { t: okAt ? when(okAt.toISOString()) : '—' })}</span> <button type="button" className="btn ghost sm" data-testid="mpx-asof-retry" onClick={load}>{t('mpx.stale.retry')}</button></div>
        : err ? <ErrorRetry message={err} onRetry={load} /> : null}
      {s ? <div className={'panel' + (s.monitoring === 'current' ? '' : ' warn')} data-testid="mpx-monitoring" style={{ padding: 10, marginBottom: 8 }}>
        <b>{t('mpx.mon.' + s.monitoring, { at: monAt })}</b> <span className="sub">{s.scheduled ? t('mpx.mon.scheduledOn') : t('mpx.mon.scheduledOff')}</span></div> : null}
      <div className="rvw-kpis" data-testid="mpx-kpis">
        <KpiCard testId="mpx-kpi-new" label={t('mpx.kpi.new')} value={c ? fmtNumber(c.newAlerts) : '—'} loading={!s && !err} tone={c?.newAlerts ? 'gold' : undefined} />
        <KpiCard testId="mpx-kpi-open" label={t('mpx.kpi.open')} value={c ? fmtNumber(c.openAlerts) : '—'} loading={!s && !err} />
        <KpiCard testId="mpx-kpi-critical" label={t('mpx.kpi.critical')} value={c ? fmtNumber(c.critical) : '—'} loading={!s && !err} tone={c?.critical ? 'bad' : undefined} />
        <KpiCard testId="mpx-kpi-high" label={t('mpx.kpi.high')} value={c ? fmtNumber(c.high) : '—'} loading={!s && !err} tone={c?.high ? 'warn' : undefined} />
        <KpiCard testId="mpx-kpi-value" label={t('mpx.kpi.value')} value={c ? money(c.valueUnderReviewCents) : '—'} loading={!s && !err} />
        <KpiCard testId="mpx-kpi-cases" label={t('mpx.kpi.cases')} value={c ? fmtNumber(c.openInvestigations) : '—'} loading={!s && !err} />
        <KpiCard testId="mpx-kpi-dismissed" label={t('mpx.kpi.dismissed')} value={c ? fmtNumber(c.dismissed30d) : '—'} loading={!s && !err} />
      </div>
      <p className="sub" data-testid="mpx-value-hint">{t('mpx.kpi.valueHint')}</p>
      {/* extras (AI MONEY PROTECTION 5 · 11): the documented notification limits and what they did — read from the server */}
      {s?.notifications ? <details className="sub" data-testid="mpx-notify-limits"><summary>{t('mpx.ntf.open')}</summary>
        <div>{t('mpx.ntf.rule', { cd: fmtNumber(s.notifications.cooldownHours), cap: fmtNumber(s.notifications.hourlyCap) })}</div>
        <div data-testid="mpx-notify-24h">{t('mpx.ntf.last24h', { sent: fmtNumber(s.notifications.last24h.sent), cd: fmtNumber(s.notifications.last24h.heldCooldown), cap: fmtNumber(s.notifications.last24h.heldCap) })}</div>
        <div>{t('mpx.ntf.why')}</div></details> : null}
      {s?.exposure && s.exposure.alerts > 0 ? <details className="sub" data-testid="mpx-exposure"><summary>{t('mpx.exp.open')}</summary>
        <div>{t('mpx.exp.sum', { n: fmtNumber(s.exposure.alerts), v: money(s.exposure.sumCents) })}</div>
        <div data-testid="mpx-exposure-dedup">{s.exposure.overlappingAlerts ? t('mpx.exp.overlap', { n: fmtNumber(s.exposure.overlappingAlerts), g: fmtNumber(s.exposure.groups), v: money(s.exposure.dedupedCents) }) : t('mpx.exp.none')}</div>
        <div>{t('mpx.exp.why')}</div></details> : null}
      <section className="panel" style={{ padding: 12, marginTop: 8 }} data-testid="mpx-bycat">
        <div className="p-h">{t('mpx.byCategory')}</div>
        {s && !Object.keys(s.byCategory ?? {}).length ? <div className="state">{s.monitoring === 'current' ? t('mpx.noOpen') : t('mpx.mon.' + s.monitoring, { at: monAt })}</div>
          : Object.entries(s?.byCategory ?? {}).map(([k, n]) => <div key={k} className="rvw-ev"><Link to={`/tenant/ai/money-protection/alerts?category=${k}`}>{catName(k)}</Link> · <b>{fmtNumber(Number(n))}</b></div>)}
      </section>
      {s?.byBranch?.rows?.length > 1 || s?.byBranch?.financials === 'included' ? <section className="panel" style={{ padding: 12, marginTop: 8 }} data-testid="mpx-bybranch">
        <div className="p-h">{t('mpx.br.title')}</div>
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('mpx.br.branch')}</th><th>{t('mpx.br.open')}</th><th>{t('mpx.br.critical')}</th><th>{t('mpx.br.review')}</th><th>{t('mpx.br.sales')}</th></tr></thead>
          <tbody>{s.byBranch.rows.map((r: any) => <tr key={r.branchId} data-testid="mpx-br-row"><td>{r.branch ?? '—'}</td><td>{fmtNumber(r.openAlerts)}</td><td>{fmtNumber(r.critical)}</td><td>{money(r.valueUnderReviewCents)}</td>
            <td data-testid="mpx-br-sales">{r.netSalesCents == null ? '—' : money(r.netSalesCents)}</td></tr>)}
            {s.byBranch.unbranched?.openAlerts ? <tr data-testid="mpx-br-unbranched"><td>{t('mpx.br.salonWide')}</td><td>{fmtNumber(s.byBranch.unbranched.openAlerts)}</td><td>{fmtNumber(s.byBranch.unbranched.critical)}</td><td>{money(s.byBranch.unbranched.valueUnderReviewCents)}</td><td>—</td></tr> : null}</tbody></table></div>
        <div className="sub" data-testid="mpx-br-note">{s.byBranch.financials === 'included' ? t('mpx.br.salesFrom') : s.byBranch.financials === 'forbidden' ? t('mpx.br.salesHidden') : t('mpx.br.salesNone')} {t('mpx.br.why')}</div>
      </section> : null}
      <section className="panel" style={{ padding: 12, marginTop: 8 }} data-testid="mpx-runs">
        <div className="p-h">{t('mpx.runs')}</div>
        {runs.err ? <ErrorRetry message={runs.err} onRetry={runs.load} /> : !runs.list ? <div className="state">{t('mpx.loading')}</div> : !runs.list.total ? <div className="sub">{t('mpx.noRuns')}</div> : (
          <div className="rvw-table-wrap"><table className="tbl rvw-table"><tbody>{runs.list.items.map((r: any) => (
            <tr key={r.id} data-testid="mpx-run-row"><td className="nowrap">{when(r.startedAt)}</td><td>{t('mpx.run.trigger.' + r.trigger)}{r.actor ? ` · ${r.actor}` : ''}</td>
              <td><span className={'chip ' + (r.status === 'failed' ? 'bad' : r.status === 'running' ? 'warn' : 'ok')}>{t('mpx.run.status.' + r.status)}</span></td>
              <td>{r.status === 'succeeded' ? t('mpx.run.line', { c: fmtNumber(r.created), u: fmtNumber(r.updated) }) : r.errorCode ?? ''}</td></tr>))}</tbody></table></div>)}
        {runs.list && runs.list.totalPages > 1 ? <Pager info={{ page: runs.list.page, pageSize: runs.list.pageSize, totalItems: runs.list.total, totalPages: runs.list.totalPages }} onPage={(n) => runs.set({ page: n }, true)} /> : null}
      </section>
    </MpShell>
  );
}

// ── Alerts ────────────────────────────────────────────────────────────────────────────────────────────────────
export function MpAlerts() {
  const [params] = useSearchParams();
  const [tick, setTick] = useState(0);
  const init = { status: 'open', severity: 'all', category: (CATS as readonly string[]).includes(params.get('category') ?? '') ? params.get('category')! : 'all', rule: params.get('rule') ?? undefined,
    dateField: 'detected', sort: 'newest', page: 1, pageSize: 25 };
  const L = useList(mc.alerts, init, tick);
  const [open, setOpen] = useState<string | null>(null);
  const rows: any[] = L.list?.items ?? [];
  const [sel, setSel] = useState<string[]>([]); const [batch, setBatch] = useState(false);
  const canBatch = L.list?.canAct === true;
  const toggle = (id: string) => setSel((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 50 ? c : [...c, id]));
  return (
    <MpShell title={tx('pos.money_protection_alerts')} sub={tx('pos.possible_anomalies_requiring_review_each_shows_1ql7')} tab="alerts" onChanged={() => setTick((n) => n + 1)}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', overflowX: 'auto' }} role="tablist">
        {GROUPS.map((g) => <button key={g} role="tab" aria-selected={L.f.status === g} className={'btn ghost' + (L.f.status === g ? ' on' : '')} data-testid={`mpx-grp-${g}`} onClick={() => L.set({ status: g })}>{t('mpx.grp.' + g)}</button>)}
      </div>
      <ListFrame testId="mpx-alerts" surface="money-protection.alerts" f={L.f} set={L.set} period={L.period} setPer={L.setPer} today={L.list?.period?.today} list={L.list} err={L.err} onRetry={L.load} staleAt={L.staleAt} total={L.list?.total}
        searchPh={L.list?.customersVisible === false ? t('mpx.searchPhRefNoCustomer') : t('mpx.searchPhRef')} empty={alertsEmpty(L.f, L.period, L.list)}
        filters={<>
          <select data-testid="mpx-severity" aria-label={t('mpx.severityLabel')} value={L.f.severity} onChange={(e) => L.set({ severity: e.target.value })}>{SEVS.map((k) => <option key={k} value={k}>{t('mpx.sev.' + k)}</option>)}</select>
          <select data-testid="mpx-category" aria-label={t('mpx.categoryLabel')} value={L.f.category} onChange={(e) => L.set({ category: e.target.value, rule: undefined })}>{CATS.map((k) => <option key={k} value={k}>{catName(k)}</option>)}</select>
          <select data-testid="mpx-datefield" aria-label={t('mpx.dateLabel')} value={L.f.dateField} onChange={(e) => L.set({ dateField: e.target.value })}>{A_DATES.map((k) => <option key={k} value={k}>{t('mpx.date.' + k)}</option>)}</select>
          <select data-testid="mpx-sort" aria-label={t('mpx.sortLabel')} value={L.f.sort} onChange={(e) => L.set({ sort: e.target.value })}>{A_SORTS.map((k) => <option key={k} value={k}>{t('mpx.sort.' + k)}</option>)}</select>
          {L.list?.canExport === true ? <MpExport view="alerts" testId="mpx-export" query={(({ page: _p, pageSize: _s, ...rest }) => ({ ...rest, ...L.period }))(L.f)} /> : null}
        </>}>
        {canBatch && sel.length ? <div className="fk-note" role="status" data-testid="mpx-triage-bar"><span>{t('mpx.triage.selected', { n: fmtNumber(sel.length) })}</span>
          <button type="button" className="btn sm" data-testid="mpx-triage-open" onClick={() => setBatch(true)}>{t('mpx.triage.open')}</button>
          <button type="button" className="btn ghost sm" onClick={() => setSel([])}>{t('mpx.triage.clear')}</button></div> : null}
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>{canBatch ? <th aria-label={t('mpx.triage.select')} /> : null}<th>{t('mpx.col.when')}</th><th>{t('mpx.col.alert')}</th><th>{t('mpx.col.severity')}</th><th>{t('mpx.col.amount')}</th><th>{t('mpx.col.status')}</th><th /></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id} data-testid="mpx-alert-row">
              {canBatch ? <td><input type="checkbox" aria-label={t('mpx.triage.select')} checked={sel.includes(a.id)} onChange={() => toggle(a.id)} data-testid="mpx-alert-select" /></td> : null}
              <td className="nowrap">{when(a.firstSeenAt)}{a.eventCount > 1 ? <div className="sub">×{fmtNumber(a.eventCount)}</div> : null}</td>
              <td><b>{ruleName(a.ruleId, a.rule)}</b><div className="sub">{catName(a.category)}{a.branch ? ` · ${a.branch}` : ''}</div>
                {a.match?.field ? <div className="sub" data-testid="mpx-alert-match">{t('mpx.match.on', { field: t('mpx.match.' + a.match.field) })}{a.match.shown ? `: ${a.match.shown}` : ''}</div> : null}</td>
              <td><span className={'chip ' + (SEV_TONE[a.severity] ?? '')}>{t('mpx.sev.' + a.severity)}</span></td>
              <td>{money(a.amountCents)}</td>
              <td><span className="chip" data-testid="mpx-alert-status">{stName(a.status)}</span>{a.investigationId ? <div className="sub">{t('mpx.d.inCase')}</div> : null}</td>
              <td><button className="btn ghost sm" data-testid="mpx-alert-view" onClick={() => setOpen(a.id)}>{t('mpx.view')}</button></td>
            </tr>))}</tbody></table></div>
      </ListFrame>
      {open ? <AlertDialog id={open} onClose={() => setOpen(null)} onChanged={() => setTick((n) => n + 1)} /> : null}
      {batch ? <BatchTriage ids={sel} onClose={() => setBatch(false)} onDone={() => { setSel([]); setTick((n) => n + 1); }} /> : null}
    </MpShell>
  );
}

/** MONEY PROTECTION ALERTS 13 — Batch triage: the server says, per selected alert, what the action would do (nothing is
 *  written); only after the person confirms does it run the single-alert action for each. Acknowledge / dismiss / reopen
 *  only — no payout, charge, refund or write-off exists here. */
function BatchTriage({ ids: picked, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const [ids] = useState(picked);   // the selection when the dialog opened (the list clears its own after Apply)
  const [action, setAction] = useState<'acknowledge' | 'dismiss' | 'reopen'>('acknowledge');
  const [preview, setPreview] = useState<any | null>(null); const [result, setResult] = useState<any | null>(null);
  const [reason, setReason] = useState(''); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setPreview(null); setOk(false); setErr(null); setResult(null);
    mc.alertBatch({ ids, action }).then((r) => { if (live) setPreview(r); }).catch((e) => { if (live) setErr(errorTextOf(e, t('mpx.triage.failed'))); });
    return () => { live = false; };
  }, [ids, action]);
  const apply = async () => {
    setBusy(true); setErr(null);
    try { const r = await mc.alertBatch({ ids, action, reason: reason.trim() || null, confirm: true }); setResult(r); onDone(); }
    catch (e) { setErr(errorTextOf(e, t('mpx.triage.failed'))); } finally { setBusy(false); }
  };
  const c = preview?.counts; const needsReason = !!preview?.needsReason;
  return (
    <FitDialog title={t('mpx.triage.title')} subtitle={t('mpx.triage.sub')} onClose={onClose} busy={busy} testId="mpx-triage" footer={<>
      <button type="button" className="btn ghost" onClick={onClose}>{t('mpx.close')}</button>
      {!result ? <button type="button" className="btn" data-testid="mpx-triage-apply" disabled={busy || !c?.ready || !ok || (needsReason && reason.trim().length < 5)} onClick={() => void apply()}>{t('mpx.triage.apply', { n: fmtNumber(c?.ready ?? 0) })}</button> : null}</>}>
      <label className="field">{t('mpx.triage.action')}
        <select value={action} disabled={!!result} onChange={(e) => setAction(e.target.value as 'acknowledge' | 'dismiss' | 'reopen')} data-testid="mpx-triage-action">
          {(['acknowledge', 'dismiss', 'reopen'] as const).map((a) => <option key={a} value={a}>{t('mpx.act.' + a)}</option>)}</select></label>
      {err ? <div className="fk-note bad" role="alert">{err}</div> : null}
      {!preview && !err ? <div className="state">{t('mpx.loading')}</div> : null}
      {c && !result ? <div data-testid="mpx-triage-preview">
        <div>{t('mpx.triage.ready', { n: fmtNumber(c.ready) })}</div>
        {c.stateInvalid ? <div className="sub">{t('mpx.triage.stateInvalid', { n: fmtNumber(c.stateInvalid) })}</div> : null}
        {c.ownActivity ? <div className="sub">{t('mpx.triage.ownActivity', { n: fmtNumber(c.ownActivity) })}</div> : null}
        {c.notFound ? <div className="sub">{t('mpx.triage.notFound', { n: fmtNumber(c.notFound) })}</div> : null}
        {needsReason ? <label className="field">{t('mpx.triage.reason')}<textarea rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="mpx-triage-reason" /></label> : null}
        {c.ready ? <label className="emc-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="mpx-triage-confirm" />{t('mpx.triage.confirm', { n: fmtNumber(c.ready) })}</label> : null}
      </div> : null}
      {result ? <div role="status" data-testid="mpx-triage-result">{t('mpx.triage.result', { a: fmtNumber(result.applied), r: fmtNumber(result.refused) })}</div> : null}
      <p className="sub">{t('mpx.triage.noMoney')}</p>
    </FitDialog>
  );
}

type Explanation = { summary: string; source: 'ai' | 'fallback'; disclaimer: string; summaryCoded?: CodedText[] | null; disclaimerCoded?: CodedText | null; language?: 'en' | 'vi' | null };
/** Vietnamese POS §21 / §120: the deterministic summary — English: the server's text; Vietnamese: worded from its codes. An AI-written
 *  summary is in the language the gateway asked for: shown as is when it matches the screen, labelled with its language when not. */
function ExplainText({ x }: { x: Explanation }) {
  const lang = getLanguage();
  return <>
    {x.source === 'fallback'
      ? (lang === 'en' || !x.summaryCoded?.length ? <p style={{ margin: 0 }}>{x.summary}</p> : <p style={{ margin: 0 }}>{x.summaryCoded.map((c) => codedText(c)).join(' ')}</p>)
      : (x.language ?? 'en') === lang
        ? <p style={{ margin: 0 }} lang={x.language ?? 'en'} data-testid="mp-explain-ai">{x.summary}</p>
        : (x.language ?? 'en') === 'en'
          ? <p style={{ margin: 0 }} lang="en" data-testid="mp-explain-ai-english"><b>{tx('growth.mp.aiEnglish')}</b> {x.summary}</p>
          : <p style={{ margin: 0 }} lang="vi" data-testid="mp-explain-ai-vietnamese"><b>{tx('growth.mp.aiVietnamese')}</b> {x.summary}</p>}
    {x.disclaimer ? <div className="sub" style={{ marginTop: 6 }}>{lang === 'en' ? x.disclaimer : codedText(x.disclaimerCoded ?? { code: 'MP.DISCLAIMER' }, x.disclaimer)} {x.source === 'fallback' ? tx('pos.deterministic_summary') : ''}</div> : null}
  </>;
}

function AlertDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [act, setAct] = useState<null | 'acknowledge' | 'dismiss' | 'reopen'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [explain, setExplain] = useState<Explanation | { error: string } | 'loading' | null>(null);
  const load = useCallback(() => { setErr(null); mc.alert(id).then(setD).catch((e) => setErr(mpErr(e))); }, [id]);
  useEffect(() => { load(); }, [load]);
  const doAct = () => {
    if (!act || !d) return;
    setBusy(true); setMsg(null);
    mc.alertAction({ id, action: act, reason: reason.trim() || null, expectedStatus: d.alert.status })
      .then(() => { setMsg(t('mpx.act.done.' + act)); setAct(null); setReason(''); load(); onChanged(); })
      .catch((e) => { setMsg(mpErr(e)); if (codeOf(e) === 'MC_STALE') load(); }).finally(() => setBusy(false));
  };
  const openCase = () => {
    if (!d) return;
    setBusy(true);
    posAIMoneyProtectionApi.createInvestigation({ title: ruleName(d.alert.ruleId, d.alert.rule), alertIds: [id] }).then(() => { setMsg(t('mpx.d.caseOpened')); load(); onChanged(); })
      .catch((e) => setMsg(mpErr(e))).finally(() => setBusy(false));
  };
  const a = d?.alert;
  return (
    <FitDialog wide testId="mpx-alert" title={t('mpx.d.title')} subtitle={a ? `${ruleName(a.ruleId, a.rule)} · ${when(a.firstSeenAt)}` : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('mpx.close')}</button>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="state">{t('mpx.loading')}</div> : <>
        <div><span className={'chip ' + (SEV_TONE[a.severity] ?? '')}>{t('mpx.sev.' + a.severity)}</span> <span className="chip" data-testid="mpx-d-status">{stName(a.status)}</span> · <b>{money(a.amountCents)}</b> <span className="sub">{t('mpx.kpi.valueHint')}</span></div>
        {msg ? <div className="panel" role="status" data-testid="mpx-d-msg" style={{ padding: 8, marginTop: 8 }}>{msg}</div> : null}
        {/* the stored evidence is server English; Vietnamese is worded from its codes (an unknown sentence is shown as stored) */}
        <section style={{ marginTop: 10 }} data-testid="mpx-d-evidence"><div className="p-h">{t('mpx.d.evidence')}</div>
          <p>{d.evidence?.summary ? codedText(mpTextCoded(d.evidence.summary), d.evidence.summary) : d.rule?.description ?? ''}</p>
          <div className="sub">{tx('pos.risk_score')}{' '}{a.riskScore} {tx('pos.confidence_2')}{' '}{a.confidence}</div>
          <FairnessNote ev={d.evidence} />
          {Array.isArray(d.evidence?.recommendedReview) && d.evidence.recommendedReview.length ? <><b>{tx('pos.recommended_review')}</b><ul>{d.evidence.recommendedReview.map((r: string, i: number) => <li key={i}>{codedText(mpTextCoded(r), r)}</li>)}</ul></> : null}
          {Array.isArray(d.evidence?.alternativeExplanations) && d.evidence.alternativeExplanations.length ? <><b>{tx('pos.possible_benign_explanations')}</b><ul>{d.evidence.alternativeExplanations.map((r: string, i: number) => <li key={i}>{codedText(mpTextCoded(r), r)}</li>)}</ul></> : null}</section>
        <section style={{ marginTop: 10 }} data-testid="mpx-d-sources"><div className="p-h">{t('mpx.d.sources')}</div>
          {d.sources.tickets.map((x: any) => <div key={x.id} className="rvw-ev">{t('mpx.d.tickets')}: <Link to={`/tenant/payments/transactions?ticket=${encodeURIComponent(x.id)}`} data-testid="mpx-src-ticket" title={t('mpx.d.openSource')}><b>{x.number ?? x.id.slice(0, 8)}</b></Link> · {x.totalCents == null ? '' : money(x.totalCents)} · {when(x.at)}{x.customer ? ` · ${x.customer}` : ''}</div>)}
          {d.sources.payments.map((x: any) => <div key={x.id} className="rvw-ev">{t('mpx.d.payments')}: {money(x.amountCents)} · {statusLabel('paymentMethod', x.method)} · {statusLabel(['payment', 'state'], x.status)} · {when(x.at)} · <Link to={`/tenant/payments/transactions?q=${encodeURIComponent(x.id)}`} data-testid="mpx-src-payment">{t('mpx.d.openSource')}</Link></div>)}
          {d.sources.staff.length ? <div className="rvw-ev">{t('mpx.d.staff')}: {d.sources.staff.map((x: any) => x.name).filter(Boolean).join(', ')}</div> : null}
          {d.completeness ? <EvidenceMeter c={d.completeness} /> : null}
          {d.sources.missing.tickets + d.sources.missing.payments ? <div className="sub">{t('mpx.d.missing', { n: fmtNumber(d.sources.missing.tickets + d.sources.missing.payments) })}</div> : null}
        </section>
        {d.selfInvolved ? <p className="warn" data-testid="mpx-d-self">{t('mpx.d.self')}</p> : null}
        {d.canAct ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {(d.actions as string[]).map((x) => <button key={x} className="btn ghost" data-testid={`mpx-act-${x}`} onClick={() => { setAct(x as never); setReason(''); }}>{t('mpx.act.' + x)}</button>)}
          {!a.investigationId && a.group === 'open' ? <button className="btn" data-testid="mpx-open-case" disabled={busy} onClick={openCase}>{t('mpx.d.openCase')}</button> : null}
          <button className="btn ghost" data-testid="mpx-explain" onClick={() => { setExplain('loading'); posAIMoneyProtectionApi.explainAlert(id).then((x) => setExplain(x as Explanation)).catch((e) => setExplain({ error: mpErr(e) })); }}>{explain === 'loading' ? t('mpx.d.explaining') : tx('pos.explain_this_alert_advisory')}</button>
        </div> : null}
        {explain && explain !== 'loading' ? <div className="panel" style={{ padding: 8, marginTop: 8 }} data-testid="mpx-explain-out">{'error' in explain ? explain.error : <ExplainText x={explain} />}</div> : null}
        {act ? <div className="panel" style={{ padding: 10, marginTop: 8 }} data-testid="mpx-act-form">
          <label className="rvw-f"><span>{act === 'dismiss' ? t('mpx.act.reasonDismiss') : act === 'reopen' ? t('mpx.act.reasonReopen') : t('mpx.act.reasonOptional')}</span>
            <textarea data-testid="mpx-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}><button className="btn ghost" onClick={() => setAct(null)}>{t('mpx.cancel')}</button>
            <button className="btn" data-testid="mpx-act-go" disabled={busy || (act !== 'acknowledge' && reason.trim().length < 5)} onClick={doAct}>{t('mpx.act.' + act)}</button></div>
        </div> : null}
        <section style={{ marginTop: 10 }} data-testid="mpx-d-history"><div className="p-h">{t('mpx.d.history')}</div>
          {d.history.length ? d.history.map((h: any, i: number) => <div key={i} className="rvw-ev"><b>{t('mpx.ev.' + h.action)}</b> · {h.actor ?? '—'} · {when(h.at)}{h.reason ? <div className="sub">{h.reason}</div> : null}</div>) : <div className="sub">{t('mpx.d.noHistory')}</div>}
        </section>
      </>}
    </FitDialog>
  );
}

// ── Investigations ────────────────────────────────────────────────────────────────────────────────────────────
export function MpInvestigations() {
  const [tick, setTick] = useState(0);
  const L = useList(mc.investigations, { status: 'active', severity: 'all', dateField: 'opened', sort: 'updated', page: 1, pageSize: 25 }, tick);
  const [open, setOpen] = useState<any>(null);
  const rows: any[] = L.list?.items ?? [];
  return (
    <MpShell title={tx('pos.money_protection_investigations')} sub={tx('pos.human_review_of_possible_anomalies_notes_xycx')} tab="investigations" onChanged={() => setTick((n) => n + 1)}>
      {/* reviewer workload: all ACTIVE cases in scope (not the filtered list); a tile narrows the list to that slice */}
      {L.list?.workload ? <div className="mpx-workload" data-testid="mpx-workload" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
        {(['open', 'high', 'unassigned', 'aging'] as const).map((k) => (
          <button key={k} type="button" className={'fk-chip' + ((k === 'aging' || k === 'unassigned') && L.list.workload[k] > 0 ? ' warn' : k === 'high' && L.list.workload[k] > 0 ? ' bad' : '')} data-testid={'mpx-wl-' + k}
            disabled={k === 'unassigned'} title={k === 'unassigned' ? t('mpx.wl.unassignedHint') : undefined}
            onClick={() => L.set(k === 'high' ? { status: 'active', severity: 'HIGH' } : k === 'aging' ? { status: 'active', sort: 'oldest' } : { status: 'active', severity: 'all' })}>
            {t('mpx.wl.' + k)}: <b>{L.list.workload[k]}</b></button>))}
      </div> : null}
      <ListFrame testId="mpx-invs" surface="money-protection.investigations" f={L.f} set={L.set} period={L.period} setPer={L.setPer} today={L.list?.period?.today} list={L.list} err={L.err} onRetry={L.load} staleAt={L.staleAt} total={L.list?.total}
        searchPh={t('mpx.inv.searchPh')} empty={L.f.q || L.period.preset ? t('mpx.noMatch') : t('mpx.inv.empty')}
        filters={<>
          <select data-testid="mpx-istatus" aria-label={t('mpx.statusLabel')} value={L.f.status} onChange={(e) => L.set({ status: e.target.value })}>{I_STATUS.map((k) => <option key={k} value={k}>{t('mpx.ist.' + k)}</option>)}</select>
          <select data-testid="mpx-severity" aria-label={t('mpx.severityLabel')} value={L.f.severity} onChange={(e) => L.set({ severity: e.target.value })}>{SEVS.map((k) => <option key={k} value={k}>{t('mpx.sev.' + k)}</option>)}</select>
          <select data-testid="mpx-datefield" aria-label={t('mpx.dateLabel')} value={L.f.dateField} onChange={(e) => L.set({ dateField: e.target.value })}>{I_DATES.map((k) => <option key={k} value={k}>{t('mpx.idate.' + k)}</option>)}</select>
          <select data-testid="mpx-sort" aria-label={t('mpx.sortLabel')} value={L.f.sort} onChange={(e) => L.set({ sort: e.target.value })}>{I_SORTS.map((k) => <option key={k} value={k}>{t('mpx.sort.' + k)}</option>)}</select>
        </>}>
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('mpx.inv.col.opened')}</th><th>{t('mpx.inv.col.case')}</th><th>{t('mpx.inv.col.status')}</th><th>{t('mpx.inv.col.assignee')}</th><th>{t('mpx.inv.col.value')}</th><th>{t('mpx.inv.col.activity')}</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} data-testid="mpx-inv-row">
              <td className="nowrap">{when(r.openedAt)}</td>
              <td><b>{r.title}</b><div className="sub"><span className={'chip ' + (SEV_TONE[r.severity] ?? '')}>{t('mpx.sev.' + r.severity)}</span>{r.branch ? ` · ${r.branch}` : ''}</div></td>
              <td><span className="chip">{t('mpx.ist.' + r.status)}</span>{r.resolution ? <div className="sub">{t('mpx.res.' + r.resolution)}</div> : null}</td>
              <td>{r.assignee ?? <span className="chip warn">{t('mpx.inv.unassigned')}</span>}</td>
              <td>{money(r.valueUnderReviewCents)}</td>
              <td className="sub">{t('mpx.inv.counts', { a: fmtNumber(r.alerts), n: fmtNumber(r.notes) })}<div>{when(r.updatedAt)}</div></td>
              <td><button className="btn ghost sm" data-testid="mpx-inv-view" onClick={() => setOpen(r)}>{t('mpx.view')}</button></td>
            </tr>))}</tbody></table></div>
      </ListFrame>
      {open ? <CaseDialog row={open} onClose={() => setOpen(null)} onChanged={() => setTick((n) => n + 1)} /> : null}
    </MpShell>
  );
}

function CaseDialog({ row, onClose, onChanged }: { row: any; onClose: () => void; onChanged: () => void }) {
  const [tl, setTl] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string>(row.status);
  const [resolution, setResolution] = useState('');
  const [recovery, setRecovery] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setErr(null); mc.timeline(row.id).then(setTl).catch((e) => setErr(mpErr(e))); }, [row.id]);
  useEffect(() => { load(); }, [load]);
  const go = (p: Promise<unknown>, after?: (r: any) => void) => { setBusy(true); setMsg(null); p.then((r) => { setMsg(t('mpx.inv.done')); after?.(r); load(); onChanged(); }).catch((e) => setMsg(mpErr(e))).finally(() => setBusy(false)); };
  const done = status === 'RESOLVED' || status === 'CLOSED';
  return (
    <FitDialog wide testId="mpx-case" title={t('mpx.inv.title')} subtitle={`${row.title} · ${when(row.openedAt)}`} onClose={onClose} footer={<button className="btn ghost" onClick={onClose}>{t('mpx.close')}</button>}>
      <div><span className="chip" data-testid="mpx-case-status">{t('mpx.ist.' + status)}</span> · {money(row.valueUnderReviewCents)} <span className="sub">{t('mpx.kpi.valueHint')}</span></div>
      {msg ? <div className="panel" role="status" data-testid="mpx-case-msg" style={{ padding: 8, marginTop: 8 }}>{msg}</div> : null}
      {!done ? <div className="rvw-filters" style={{ marginTop: 10 }}>
        {(MOVES[status] ?? []).map((s) => <button key={s} className="btn ghost sm" data-testid={`mpx-move-${s}`} disabled={busy} onClick={() => go(posAIMoneyProtectionApi.setInvestigationStatus(row.id, s), () => setStatus(s))}>{t('mpx.inv.move')} {t('mpx.ist.' + s)}</button>)}
      </div> : status === 'RESOLVED' ? <button className="btn ghost sm" data-testid="mpx-move-CLOSED" disabled={busy} onClick={() => go(posAIMoneyProtectionApi.setInvestigationStatus(row.id, 'CLOSED'), () => setStatus('CLOSED'))}>{t('mpx.inv.move')} {t('mpx.ist.CLOSED')}</button> : null}
      {!done && status !== 'OPEN' ? <div className="rvw-filters" style={{ marginTop: 8 }}>
        <select data-testid="mpx-resolution" aria-label={t('mpx.inv.resolution')} value={resolution} onChange={(e) => setResolution(e.target.value)}><option value="">{t('mpx.inv.resolution')}</option>{RESOLUTIONS.map((r) => <option key={r} value={r}>{t('mpx.res.' + r)}</option>)}</select>
        <input data-testid="mpx-recovery" inputMode="decimal" value={recovery} onChange={(e) => setRecovery(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={t('mpx.inv.recovery')} aria-label={t('mpx.inv.recovery')} />
        <button className="btn" data-testid="mpx-resolve" disabled={busy || !resolution} onClick={() => go(posAIMoneyProtectionApi.resolveInvestigation(row.id, resolution, recovery ? Math.round(Number(recovery) * 100) : undefined), () => setStatus('RESOLVED'))}>{t('mpx.inv.resolve')}</button>
      </div> : null}
      <section style={{ marginTop: 10 }}><div className="p-h">{t('mpx.inv.note')}</div>
        <textarea data-testid="mpx-note-text" rows={2} value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} aria-label={t('mpx.inv.note')} />
        <button className="btn sm" data-testid="mpx-add-note" disabled={busy || !note.trim()} onClick={() => go(posAIMoneyProtectionApi.addNote(row.id, note.trim()), () => setNote(''))}>{t('mpx.inv.addNote')}</button></section>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !tl ? <div className="state">{t('mpx.loading')}</div> : <>
        <section style={{ marginTop: 10 }} data-testid="mpx-case-timeline"><div className="p-h">{t('mpx.inv.timeline')}</div>
          {tl.items.map((x: any, i: number) => <div key={i} className="rvw-ev" data-testid="mpx-tl-item"><b>{x.kind === 'note' ? t('mpx.ev.note') : t('mpx.ev.' + x.action)}</b>{x.to && x.kind !== 'note' && x.action !== 'assigned' ? ` → ${t('mpx.ist.' + x.to)}` : ''} · {x.actor ?? '—'} · {when(x.at)}
            {x.kind === 'note' ? <div>{x.text}</div> : x.detail?.resolution ? <div className="sub">{t('mpx.res.' + x.detail.resolution)}</div> : null}</div>)}</section>
        <section style={{ marginTop: 10 }}><div className="p-h">{t('mpx.inv.linked')}</div>
          {tl.alerts.map((a: any) => <div key={a.id} className="rvw-ev">{ruleName(a.ruleId, a.rule)} · {t('mpx.sev.' + a.severity)} · {money(a.amountCents)} · {stName(a.status)}</div>)}</section>
      </>}
    </FitDialog>
  );
}

// ── Rules & detection ─────────────────────────────────────────────────────────────────────────────────────────
function useRules(tick: number) {
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [okAt, setOkAt] = useState<Date | null>(null);
  const load = useCallback(() => { setErr(null); setForbidden(false); mc.rules().then((x) => { setR(x); setOkAt(new Date()); }).catch((e) => { setErr(mpErr(e)); setForbidden(isForbidden(e)); }); }, []);
  useEffect(() => { load(); }, [load, tick]);
  return { r, err, load, forbidden, okAt };
}
/** Money Protection Rules extras #08 — consistent empty states: which "nothing here" it is. Permission denied, an API outage with
 *  nothing loaded, a failed refresh of rules already shown (stale, with the time), no rules at all, and rules that are on but have
 *  no recorded evaluation yet — each worded differently, never a blank table or a false green. */
export function rulesState(x: { r: any; err: string | null; forbidden: boolean }): 'forbidden' | 'outage' | 'loading' | 'stale' | 'none' | 'unevaluated' | 'ok' {
  if (x.err && !x.r) return x.forbidden ? 'forbidden' : 'outage';
  if (!x.r) return 'loading';
  if (x.err) return 'stale';
  const rs: any[] = x.r.rules ?? [];
  if (!rs.length) return 'none';
  const on = rs.filter((y) => y.effective);
  if (on.length && on.every((y) => !y.lastCheckedAt)) return 'unevaluated';
  return 'ok';
}
function RuleState({ x }: { x: any }) {
  return !x.layerOn ? <span className="chip warn">{t('mpx.rules.layerOff')}</span> : <span className={'chip ' + (x.enabled ? 'ok' : 'warn')} data-testid="mpx-rule-state">{x.enabled ? t('mpx.rules.on') : t('mpx.rules.off')}</span>;
}
/** Money Protection Settings extras #02 — "Saved" is not "Effective": next to the saved On/Off, what detection is actually doing
 *  with the rule (the server's `effective` flag: saved on AND its layer on). A saved-on rule that is not running is said in red
 *  with why; nothing is claimed about a worker version (the server reports none). */
function EffectiveChip({ x }: { x: any }) {
  if (x.effective == null) return <span className="chip" data-testid="mpx-set-effective" data-state="unknown">{t('mpx.set.eff.unknown')}</span>;
  if (x.effective) return <span className="chip ok" data-testid="mpx-set-effective" data-state="running">{t('mpx.set.eff.running')}</span>;
  if (x.enabled) return <span className="chip bad" data-testid="mpx-set-effective" data-state="drift" title={t('mpx.set.eff.driftWhy')}>{t('mpx.set.eff.drift')}</span>;
  return <span className="chip" data-testid="mpx-set-effective" data-state="off">{t('mpx.set.eff.off')}</span>;
}
/** MONEY PROTECTION ALERTS 11: false-positive review insights from the recorded human decisions (90 days) — reviewed /
 *  dismissed / reopened per rule and the dismissal reasons people keep writing. Insight only: no rule is changed from here. */
type FpInsight = { ruleId: string; name: string; reviewed90d: number; dismissed90d: number; reopened90d: number; dismissRatePct: number | null; repeatedReasons: { reason: string; count: number }[] };
function FalsePositiveInsights({ items }: { items?: FpInsight[] }) {
  if (!items) return null;   // an older server: nothing shown, nothing guessed
  return (
    <section className="panel" style={{ padding: 12, marginTop: 12 }} data-testid="mpx-fp">
      <div className="p-h">{t('mpx.fp.title')}</div>
      {items.length === 0 ? <div className="sub" data-testid="mpx-fp-none">{t('mpx.fp.none')}</div> : (
        <table className="tbl rvw-table"><thead><tr><th>{t('mpx.rules.col.rule')}</th><th className="num">{t('mpx.fp.reviewed')}</th><th className="num">{t('mpx.fp.dismissed')}</th><th className="num">{t('mpx.fp.reopened')}</th><th>{t('mpx.fp.reasons')}</th></tr></thead>
          <tbody>{items.map((x) => <tr key={x.ruleId} data-testid="mpx-fp-row">
            <td><b>{ruleName(x.ruleId, x.name)}</b></td>
            <td className="num">{fmtNumber(x.reviewed90d)}</td>
            <td className="num">{fmtNumber(x.dismissed90d)}{x.dismissRatePct != null ? <div className="sub">{t('mpx.fp.rate', { n: fmtNumber(x.dismissRatePct) })}</div> : null}</td>
            <td className="num">{fmtNumber(x.reopened90d)}</td>
            <td className="sub">{x.repeatedReasons.length ? x.repeatedReasons.map((y) => t('mpx.fp.reasonN', { r: y.reason, n: fmtNumber(y.count) })).join(' · ') : t('mpx.fp.noPattern')}</td>
          </tr>)}</tbody></table>)}
      <p className="sub" data-testid="mpx-fp-policy">{t('mpx.fp.policy')}</p>
    </section>
  );
}

/** Money Protection Rules 07 — Safer Batch Readiness: the three ledgers the batch (reconciliation) rules read. A ledger that
 *  cannot be read, a layer that is off or a pass that is not scheduled is a warning (batch alerts may be missing); no recent
 *  records is only said. Read-only; an older server sends nothing and nothing is shown. */
type BatchSource = { source: string; rules: string[]; rulesOn: number; layerOn: boolean; state: string; warning: boolean; records30d: number | null; lastRecordAt: string | null };
type BatchReadinessView = { sources: BatchSource[]; scheduled: boolean; lastReconciliationAt: string | null; warnings: number };
function BatchReadiness({ b }: { b?: BatchReadinessView }) {
  if (!b) return null;
  return (
    <section className="panel" style={{ padding: 12, marginTop: 12 }} data-testid="mpx-batch">
      <div className="p-h">{t('mpx.batch.title')}</div>
      {b.warnings ? <div className="fk-note warn" role="status" data-testid="mpx-batch-warn">{t('mpx.batch.warn', { n: fmtNumber(b.warnings) })}</div> : <div className="sub" data-testid="mpx-batch-ok">{t('mpx.batch.ok')}</div>}
      <table className="tbl rvw-table"><thead><tr><th>{t('mpx.batch.col.ledger')}</th><th>{t('mpx.batch.col.state')}</th><th className="num">{t('mpx.batch.col.records')}</th><th>{t('mpx.batch.col.last')}</th><th className="num">{t('mpx.batch.col.rules')}</th></tr></thead>
        <tbody>{b.sources.map((x) => <tr key={x.source} data-testid="mpx-batch-row" data-state={x.state}>
          <td><b>{t('mpx.batch.src.' + x.source)}</b></td>
          <td><span className={'chip ' + (x.warning ? 'bad' : x.state === 'ready' ? 'ok' : '')}>{t('mpx.batch.st.' + x.state)}</span></td>
          <td className="num">{x.records30d == null ? '—' : fmtNumber(x.records30d)}</td>
          <td>{x.lastRecordAt ? when(x.lastRecordAt) : '—'}</td>
          <td className="num">{t('mpx.batch.rulesOn', { on: fmtNumber(x.rulesOn), n: fmtNumber(x.rules.length) })}</td>
        </tr>)}</tbody></table>
      <p className={'sub' + (b.scheduled ? '' : ' warn')} data-testid="mpx-batch-schedule">{b.scheduled ? t('mpx.batch.scheduled') : t('mpx.batch.notScheduled')} · {b.lastReconciliationAt ? t('mpx.batch.lastPass', { at: when(b.lastReconciliationAt) }) : t('mpx.batch.noPass')}</p>
    </section>
  );
}

export function MpRules() {
  const [tick, setTick] = useState(0);
  const { r, err, load, forbidden, okAt } = useRules(tick);
  const [open, setOpen] = useState<any>(null);
  const st = rulesState({ r, err, forbidden });
  return (
    <MpShell title={tx('pos.money_protection_rules_detection')} sub={t('mpx.rules.note')} tab="rules" onChanged={() => setTick((n) => n + 1)}>
      {st === 'forbidden' ? <div data-testid="mpx-rules-state" data-kind="forbidden"><Empty title={t('mpx.err.forbidden')} /></div>
        : st === 'outage' ? <div data-testid="mpx-rules-state" data-kind="outage"><ErrorRetry message={err ?? t('mpx.loadFailed')} onRetry={load} /></div>
        : st === 'loading' ? <div className="state">{t('mpx.loading')}</div>
        : st === 'none' ? <div data-testid="mpx-rules-state" data-kind="none"><Empty title={t('mpx.rules.none')} /></div> : (
        <>
        {st === 'stale' ? <div className="fk-note warn" role="status" data-testid="mpx-rules-state" data-kind="stale"><span>{t('mpx.stale.note', { t: okAt ? fmtInZone(okAt.toISOString(), { hour: 'numeric', minute: '2-digit' }) || '—' : '—' })}</span> <button type="button" className="btn ghost sm" onClick={load}>{t('mpx.stale.retry')}</button></div> : null}
        {st === 'unevaluated' ? <div className="fk-note" role="status" data-testid="mpx-rules-state" data-kind="unevaluated">{t('mpx.rules.noEvaluations')}</div> : null}
        {/* SUNMI addendum (Nov 8 2026): seven even summary tiles over the rule table, counted from the rules this page shows —
            Total · Enabled · Disabled · Exact comparison · Normal levels · Reconciliation · Not running (switched on, layer off) */}
        {(() => {
          const rs: any[] = r.rules; const n = (f: (x: any) => boolean) => fmtNumber(rs.filter(f).length);
          const off = rs.filter((x) => x.enabled && !x.effective).length;
          return <div className="rvw-kpis mpx-rule-kpis" data-testid="mpx-rule-kpis">
            <KpiCard testId="mpx-rk-total" label={t('mpx.rk.total')} value={fmtNumber(rs.length)} />
            <KpiCard testId="mpx-rk-enabled" label={t('mpx.rk.enabled')} value={n((x) => x.enabled)} tone="ok" />
            <KpiCard testId="mpx-rk-disabled" label={t('mpx.rk.disabled')} value={n((x) => !x.enabled)} />
            <KpiCard testId="mpx-rk-deterministic" label={t('mpx.layer.deterministic')} value={n((x) => x.layer === 'deterministic')} />
            <KpiCard testId="mpx-rk-baseline" label={t('mpx.layer.baseline')} value={n((x) => x.layer === 'baseline')} />
            <KpiCard testId="mpx-rk-reconciliation" label={t('mpx.layer.reconciliation')} value={n((x) => x.layer === 'reconciliation')} />
            <KpiCard testId="mpx-rk-errors" label={t('mpx.rk.errors')} value={fmtNumber(off)} tone={off ? 'bad' : 'ok'} sub={t('mpx.rk.errorsSub')} />
          </div>;
        })()}
        <section className="panel" style={{ padding: 12 }} data-testid="mpx-rules"><div className="p-h" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ flex: 1 }}>{t('mpx.rules.title')}</span>{r.canExport === true ? <MpExport view="rules" testId="mpx-rules-export" /> : null}</div>
          <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('mpx.rules.col.rule')}</th><th>{t('mpx.rules.col.category')}</th><th>{t('mpx.rules.col.layer')}</th><th>{t('mpx.rules.col.severity')}</th><th>{t('mpx.rules.col.mode')}</th><th>{t('mpx.rules.col.thresholds')}</th><th>{t('mpx.rules.col.review')}</th><th>{t('mpx.rules.col.state')}</th><th>{t('mpx.rules.col.alerts')}</th><th /></tr></thead>
            <tbody>{r.rules.map((x: any) => (
              <tr key={x.id} data-testid="mpx-rule-row">
                {/* SUNMI addendum (Nov 8 2026): the original guide's eight columns — Rule · Category · Layer · Severity · Mode · Thresholds ·
                    Human review · Status — then the alert counts (last alert under them) and the actions */}
                <td><b>{ruleName(x.id, x.name)}</b></td>
                <td>{catName(x.category)}</td>
                <td>{t('mpx.layer.' + x.layer)}</td>
                <td><span className={'chip ' + (SEV_TONE[x.severity] ?? '')}>{t('mpx.sev.' + x.severity)}</span>{x.severityOverridden ? <div className="sub">{t('mpx.rules.default', { s: t('mpx.sev.' + x.defaultSeverity) })}</div> : null}</td>
                <td>{['realtime', 'near_realtime', 'batch'].includes(x.mode) ? t('mpx.mode.' + x.mode) : '—'}</td>
                <td className="sub">{Object.keys(x.thresholds).length ? Object.entries(x.thresholds).map(([k, v]) => `${k} ${v}`).join(' · ') : '—'}</td>
                <td>{x.humanReview ? t('mpx.rules.reviewYes') : t('mpx.rules.reviewNo')}</td>
                <td><RuleState x={x} />{x.effective ? <div className={'sub' + (!x.lastCheckedAt || Date.now() - Date.parse(x.lastCheckedAt) > 26 * 3600_000 ? ' warn' : '')} data-testid="mpx-rule-checked">
                  {x.lastCheckedAt ? t('mpx.rules.checkedAt', { t: when(x.lastCheckedAt) }) : t('mpx.rules.notChecked')}</div> : null}</td>
                <td>{fmtNumber(x.alerts30d)}<div className="sub">{t('mpx.rules.col.last')}: {when(x.lastAlertAt)}</div>{x.dismissed90d ? <div className="sub">{t('mpx.rules.dismissed', { n: fmtNumber(x.dismissed90d) })}</div> : null}</td>
                <td className="mpx-acts"><div className="mpx-act-stack"><button className="btn ghost sm" data-testid="mpx-rule-view" onClick={() => setOpen(x)}>{t('mpx.view')}</button>
                  <Link className="btn ghost sm" to={`/tenant/ai/money-protection/alerts?rule=${x.id}`}>{t('mpx.rules.seeAlerts')}</Link></div></td>
              </tr>))}</tbody></table></div>
        </section>
        <BatchReadiness b={r.batchReadiness} />
        <FalsePositiveInsights items={r.falsePositiveInsights} /></>)}
      {open ? <FitDialog wide testId="mpx-rule" title={ruleName(open.id, open.name)} onClose={() => setOpen(null)} footer={<button className="btn ghost" onClick={() => setOpen(null)}>{t('mpx.close')}</button>}>
        <p>{open.description}</p>
        <div className="sub">{catName(open.category)} · {t('mpx.layer.' + open.layer)} · {t('mpx.rules.default', { s: t('mpx.sev.' + open.defaultSeverity) })}</div>
        {Object.keys(open.thresholds).length ? <div style={{ marginTop: 8 }}><b>{t('mpx.rules.thresholds')}</b>: {Object.entries(open.thresholds).map(([k, v]) => `${k} ${v}`).join(' · ')}</div> : null}
        <div style={{ marginTop: 8 }}><RuleState x={open} /> · {t('mpx.rules.col.alerts')}: {fmtNumber(open.alerts30d)}</div>
      </FitDialog> : null}
    </MpShell>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────────────────────────────────────
export function MpSettings() {
  const [tick, setTick] = useState(0);
  const { r, err, load } = useRules(tick);
  const H = useList(mc.history, { page: 1, pageSize: 25 }, tick);
  const [edit, setEdit] = useState<any>(null);
  return (
    <MpShell title={tx('pos.money_protection_settings')} sub={tx('pos.enable_disable_rules_adjust_severity_and_1pnq')} tab="settings" onChanged={() => setTick((n) => n + 1)}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !r ? <div className="state">{t('mpx.loading')}</div> : (
        <>
        {/* SUNMI addendum (Nov 8 2026): the status row, every number from the rules listed below — Rules · Enabled · Running ·
            Not running (on, layer off) · Overridden (severity or a threshold differs from its default). There is no "pending" state
            (changes save at once, audited), so no Pending card is invented. */}
        {(() => {
          const rs: any[] = r.rules; const over = rs.filter((x) => x.severityOverridden || Object.entries(x.thresholds ?? {}).some(([k, v]) => x.defaultThresholds?.[k] !== v)).length;
          const off = rs.filter((x) => x.enabled && !x.effective).length;
          return <div className="rvw-kpis mpx-set-kpis" data-testid="mpx-set-kpis">
            <KpiCard testId="mpx-sk-total" label={t('mpx.rk.total')} value={fmtNumber(rs.length)} />
            <KpiCard testId="mpx-sk-enabled" label={t('mpx.rk.enabled')} value={fmtNumber(rs.filter((x) => x.enabled).length)} />
            <KpiCard testId="mpx-sk-running" label={t('mpx.sk.running')} value={fmtNumber(rs.filter((x) => x.effective).length)} tone="ok" />
            <KpiCard testId="mpx-sk-errors" label={t('mpx.rk.errors')} value={fmtNumber(off)} tone={off ? 'bad' : 'ok'} sub={t('mpx.rk.errorsSub')} />
            <KpiCard testId="mpx-sk-overrides" label={t('mpx.sk.overrides')} value={fmtNumber(over)} tone={over ? 'gold' : undefined} sub={t('mpx.sk.overridesSub')} />
          </div>;
        })()}
        <section className="panel" style={{ padding: 12 }} data-testid="mpx-settings"><div className="p-h">{t('mpx.set.title')}</div>
          <div className="rvw-table-wrap mpx-set-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('mpx.rules.col.rule')}</th><th>{t('mpx.sk.colEnabled')}</th><th>{t('mpx.sk.colSeverity')}</th><th>{t('mpx.rules.col.thresholds')}</th><th /></tr></thead><tbody>{r.rules.map((x: any) => (
            <tr key={x.id} data-testid="mpx-set-row"><td><b>{ruleName(x.id, x.name)}</b><div className="sub">{t('mpx.rules.default', { s: t('mpx.sev.' + x.defaultSeverity) })}</div></td>
              <td><RuleState x={x} /> <EffectiveChip x={x} /></td><td><span className={'chip ' + (SEV_TONE[x.severity] ?? '')}>{t('mpx.sev.' + x.severity)}</span></td>
              <td className="sub">{Object.entries(x.thresholds).map(([k, v]) => `${k} ${v}`).join(' · ')}</td>
              <td className="mpx-acts">{r.canEdit ? <button className="btn ghost sm" data-testid="mpx-rule-edit" onClick={() => setEdit(x)}>{t('mpx.rules.edit')}</button> : null}</td></tr>))}</tbody></table></div>
        </section></>)}
      <ListFrame testId="mpx-history" surface="money-protection.history" f={H.f} set={H.set} period={H.period} setPer={H.setPer} today={H.list?.period?.today} list={H.list} err={H.err} onRetry={H.load} staleAt={H.staleAt} total={H.list?.total}
        searchPh={t('mpx.set.history')} empty={t('mpx.set.noHistory')} filters={null}>
        <div className="p-h">{t('mpx.set.history')}</div>
        {(H.list?.items ?? []).map((h: any) => <div key={h.id} className="rvw-ev" data-testid="mpx-hist-row">
          <b>{ruleName(h.ruleId, h.rule)}</b>: {h.before ? `${h.before.enabled ? t('mpx.rules.on') : t('mpx.rules.off')} · ${t('mpx.sev.' + h.before.severity)}` : '—'} → {h.after ? `${h.after.enabled ? t('mpx.rules.on') : t('mpx.rules.off')} · ${t('mpx.sev.' + h.after.severity)}` : '—'}
          {h.weaker ? <span className="chip warn"> {t('mpx.set.weaker')}</span> : null}<div className="sub">{h.actor ?? '—'} · {when(h.at)}{h.reason ? ` · ${h.reason}` : ''}</div></div>)}
      </ListFrame>
      {edit ? <RuleEditor rule={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setTick((n) => n + 1); }} /> : null}
    </MpShell>
  );
}

/** Money Protection Settings extras #05 — safe recovery: after a failed Save (refused, stale version, lost connection) the editor
 *  offers Reload Current (discard my edits, take what is saved now), Compare Changes (mine next to what is saved now) and Retry —
 *  Retry always asks first, and it is sent with the version this person last SAW, so a concurrent edit is never silently overwritten
 *  (the server refuses a stale version; only after Reload or Compare does the editor carry the newer version). */
export function ruleDraftDiff(mine: { enabled: boolean; sev: string; th: Record<string, string> }, cur: any): { field: string; mine: string; now: string }[] {
  const out: { field: string; mine: string; now: string }[] = [];
  const onOff = (b: boolean) => (b ? t('mpx.rules.on') : t('mpx.rules.off'));
  const sevOf = (s: string) => (s ? t('mpx.sev.' + s) : t('mpx.rules.defaultSev', { s: t('mpx.sev.' + cur.defaultSeverity) }));
  if (mine.enabled !== cur.enabled) out.push({ field: t('mpx.rules.enabled'), mine: onOff(mine.enabled), now: onOff(cur.enabled) });
  const curSev = cur.severityOverridden ? cur.severity : '';
  if (mine.sev !== curSev) out.push({ field: t('mpx.rules.severity'), mine: sevOf(mine.sev), now: sevOf(curSev) });
  const keys = Array.from(new Set([...Object.keys(mine.th), ...Object.keys(cur.thresholds ?? {})]));
  for (const k of keys) {
    const a = mine.th[k] ?? '—'; const b = cur.thresholds?.[k] != null ? String(cur.thresholds[k]) : '—';
    if (a !== b) out.push({ field: k, mine: a, now: b });
  }
  return out;
}
/** Threshold Change Preview (Money Protection Rules 09): what the proposed thresholds would have done to the last 30 days of
 *  detections — a dry run on the server (nothing saved, no alert raised). Shown only after the person asks for it. */
type ThresholdPreviewView = { supported: boolean; reason?: string; windowDays?: number; currentCount?: number; proposedCount?: number; stops?: number; starts?: number; severityChanges?: number;
  examples?: { fingerprint: string; change: 'stops' | 'starts' | 'severity'; fromSeverity: string | null; toSeverity: string | null; ticketIds: string[] }[] };
function ThresholdPreview({ p }: { p: ThresholdPreviewView }) {
  if (!p.supported) return <div className="fk-note" data-testid="mpx-th-preview" style={{ marginTop: 6 }}>{t('mpx.thp.unsupported')}</div>;
  return (
    <div className="panel" data-testid="mpx-th-preview" style={{ padding: 8, margin: '6px 0' }}>
      <div><b>{t('mpx.thp.title', { d: p.windowDays ?? 30 })}</b></div>
      <div data-testid="mpx-th-counts">{t('mpx.thp.counts', { now: p.currentCount ?? 0, next: p.proposedCount ?? 0 })}</div>
      <div className="sub">{t('mpx.thp.detail', { stops: p.stops ?? 0, starts: p.starts ?? 0, sev: p.severityChanges ?? 0 })}</div>
      {(p.examples ?? []).length ? <ul className="sub" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{(p.examples ?? []).slice(0, 5).map((x) => (
        <li key={x.fingerprint} data-testid="mpx-th-example">{t('mpx.thp.ex.' + x.change, { from: x.fromSeverity ? t('mpx.sev.' + x.fromSeverity) : '—', to: x.toSeverity ? t('mpx.sev.' + x.toSeverity) : '—', n: x.ticketIds.length })}</li>))}</ul> : null}
      <div className="sub" style={{ marginTop: 4 }}>{t('mpx.thp.dry')}</div>
    </div>
  );
}
function RuleEditor({ rule, onClose, onSaved }: { rule: any; onClose: () => void; onSaved: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(rule.enabled);
  const [sev, setSev] = useState<string>(rule.severityOverridden ? rule.severity : '');
  const [th, setTh] = useState<Record<string, string>>(Object.fromEntries(Object.entries(rule.thresholds).map(([k, v]) => [k, String(v)])));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [base, setBase] = useState<string | null>(rule.updatedAt ?? null);   // the version this person last saw
  const [cur, setCur] = useState<any>(null);                                  // what is saved now (after Reload / Compare)
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [preview, setPreview] = useState<ThresholdPreviewView | null>(null);
  const numericTh = () => Object.fromEntries(Object.entries(th).map(([k, v]) => [k, v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v]));
  const thChanged = Object.entries(th).some(([k, v]) => String(rule.thresholds?.[k] ?? '') !== v);
  const runPreview = () => {
    setBusy(true); setMsg(null);
    mc.previewRule({ ruleId: rule.id, thresholds: numericTh() }).then((p: ThresholdPreviewView) => setPreview(p)).catch((e) => { setPreview(null); setMsg(mpErr(e)); }).finally(() => setBusy(false));
  };
  const save = () => {
    setBusy(true); setMsg(null); setConfirmRetry(false);
    const thresholds = Object.fromEntries(Object.entries(th).map(([k, v]) => [k, v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v]));
    mc.saveRule({ ruleId: rule.id, enabled, severityOverride: sev || null, thresholds, reason: reason.trim() || null, expectedUpdatedAt: base })
      .then(() => onSaved()).catch((e) => { setMsg(mpErr(e)); setFailed(true); }).finally(() => setBusy(false));
  };
  const fetchCurrent = (apply: boolean) => {
    setBusy(true);
    mc.rules().then((rs: any) => {
      const x = (rs?.rules ?? []).find((y: any) => y.id === rule.id);
      if (!x) { setMsg(t('mpx.rec.gone')); return; }
      setCur(x); setBase(x.updatedAt ?? null);
      if (apply) {
        setEnabled(x.enabled); setSev(x.severityOverridden ? x.severity : '');
        setTh(Object.fromEntries(Object.entries(x.thresholds ?? {}).map(([k, v]) => [k, String(v)])));
        setMsg(null); setFailed(false); setCur(null);
      }
    }).catch((e) => setMsg(mpErr(e))).finally(() => setBusy(false));
  };
  const diff = cur ? ruleDraftDiff({ enabled, sev, th }, cur) : null;
  return (
    <FitDialog wide testId="mpx-rule-editor" title={ruleName(rule.id, rule.name)} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>{t('mpx.cancel')}</button><button className="btn" data-testid="mpx-rule-save" disabled={busy} onClick={save}>{t('mpx.save')}</button></>}>
      <p className="sub">{rule.description}</p>
      {msg ? <div className="err" data-testid="mpx-rule-msg">{msg}</div> : null}
      {failed ? <div className="panel" data-testid="mpx-rec" style={{ padding: 8, margin: '6px 0' }}>
        <div className="sub">{t('mpx.rec.why')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <button type="button" className="btn ghost sm" data-testid="mpx-rec-reload" disabled={busy} onClick={() => fetchCurrent(true)}>{t('mpx.rec.reload')}</button>
          <button type="button" className="btn ghost sm" data-testid="mpx-rec-compare" disabled={busy} onClick={() => fetchCurrent(false)}>{t('mpx.rec.compare')}</button>
          <button type="button" className="btn ghost sm" data-testid="mpx-rec-retry" disabled={busy} onClick={() => setConfirmRetry(true)}>{t('mpx.rec.retry')}</button>
        </div>
        {confirmRetry ? <div className="fk-note warn" role="alert" data-testid="mpx-rec-confirm" style={{ marginTop: 6 }}>
          <span>{cur ? t('mpx.rec.confirmOver') : t('mpx.rec.confirm')}</span>{' '}
          <button type="button" className="btn sm" data-testid="mpx-rec-yes" disabled={busy} onClick={save}>{t('mpx.rec.yes')}</button>{' '}
          <button type="button" className="btn ghost sm" data-testid="mpx-rec-no" onClick={() => setConfirmRetry(false)}>{t('mpx.cancel')}</button>
        </div> : null}
        {diff ? (diff.length ? <table className="tbl" data-testid="mpx-rec-diff" style={{ marginTop: 6 }}><thead><tr><th>{t('mpx.rec.field')}</th><th>{t('mpx.rec.mine')}</th><th>{t('mpx.rec.now')}</th></tr></thead>
          <tbody>{diff.map((d) => <tr key={d.field} data-testid="mpx-rec-diff-row"><td>{d.field}</td><td>{d.mine}</td><td>{d.now}</td></tr>)}</tbody></table>
          : <div className="sub" data-testid="mpx-rec-same">{t('mpx.rec.same')}</div>) : null}
      </div> : null}
      <label className="rvw-f"><input type="checkbox" data-testid="mpx-rule-enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> <span>{t('mpx.rules.enabled')}</span></label>
      <label className="rvw-f"><span>{t('mpx.rules.severity')}</span><select data-testid="mpx-rule-sev" value={sev} onChange={(e) => setSev(e.target.value)}>
        <option value="">{t('mpx.rules.defaultSev', { s: t('mpx.sev.' + rule.defaultSeverity) })}</option>{SEVS.filter((s) => s !== 'all').map((s) => <option key={s} value={s}>{t('mpx.sev.' + s)}</option>)}</select></label>
      {Object.keys(th).map((k) => <label key={k} className="rvw-f"><span>{k}</span><input value={th[k]} onChange={(e) => { setPreview(null); setTh((x) => ({ ...x, [k]: e.target.value })); }} aria-label={k} /></label>)}
      {thChanged ? <button type="button" className="btn ghost sm" data-testid="mpx-th-preview-btn" disabled={busy} onClick={runPreview}>{t('mpx.thp.btn')}</button> : null}
      {preview ? <ThresholdPreview p={preview} /> : null}
      <label className="rvw-f"><span>{t('mpx.rules.reason')}</span><textarea data-testid="mpx-rule-reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <div className="sub">{t('mpx.rules.reasonHint')}</div>
    </FitDialog>
  );
}
