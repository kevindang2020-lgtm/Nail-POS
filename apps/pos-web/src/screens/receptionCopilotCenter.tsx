// receptionCopilotCenter.tsx — Reception Copilot Complete Build Guide (Oct 2026). The parts added to the existing Reception
// Copilot page (/tenant/ai/copilot), which keeps every original module:
//   useCopilotAction / PreparedCard / ActionOutcome   prepare → review (server preview) → confirm → verified outcome
//   CopilotOpsBar        live status strip (real values + "as of", Refresh, 45 s fallback) and Check Copilot System
//   PriorityAssistant    verified task sources with reason, evidence and a proposal — every proposal is prepared and needs
//                        a person to confirm; nothing books, moves, cancels or texts by itself
//   CopilotWorkspace     scoped search + Copilot activity history (filters, From/To month calendar, pages 10/20/50, newest
//                        first) — history only; the live queue keeps its own fair order
//   CustomerActivityOverlay  Overview · Appointments · Calls & Messages · Copilot Actions · Consent · Audit, Close, Open Booking
import { useCallback, useEffect, useState } from 'react';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { posCopilotCenterApi, type CcAction, type CcConfirmed, type CcPrepared } from '../api/posCopilotCenterApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtDateTime } from '../i18n/format';
import { FitDialog, Pager, Empty, ErrorRetry, useDebounced } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';

const when = (v?: string | null) => (v ? fmtDateTime(v) : '—');
// the device's day (Nov 3 audit: the UTC date marked tomorrow every US evening)
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const TONE: Record<string, string> = { READY: 'ok', WARNING: 'warn', FAILED: 'bad', NOT_CONFIGURED: 'warn', DISABLED: 'muted', UNKNOWN: 'muted',
  completed: 'ok', delivered: 'ok', succeeded: 'ok', pending_verification: 'warn', submitted: 'warn', provider_accepted: 'warn', pending: 'warn', failed: 'bad', unknown: 'muted' };
function Badge({ s }: { s: string }) { return <span className={`rcc-badge rcc-${TONE[s] ?? 'muted'}`} data-state={s}>{t(`rcc.state.${s}`)}</span>; }
function KV({ obj }: { obj: Record<string, unknown> | null }) {
  if (!obj) return null;
  const rows = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
  return (
    <dl className="rcc-kv">{rows.map(([k, v]) => (
      <div key={k}><dt>{t(`rcc.f.${k}`)}</dt><dd>{Array.isArray(v) ? v.map((x: any) => (typeof x === 'object' ? `${x.name} (${x.minutes} min, $${(Number(x.priceCents) / 100).toFixed(2)})` : String(x))).join(', ')
        : k.toLowerCase().includes('cents') ? `$${(Number(v) / 100).toFixed(2)}` : typeof v === 'boolean' ? (v ? t('rcc.yes') : t('rcc.no')) : String(v)}</dd></div>
    ))}</dl>
  );
}

// ── prepare → review → confirm ─────────────────────────────────────────────────────────────────────────────────────────
export function useCopilotAction() {
  const [action, setAction] = useState<CcAction | null>(null);
  const [prep, setPrep] = useState<CcPrepared | null>(null);
  const [result, setResult] = useState<CcConfirmed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'prepare' | 'confirm' | null>(null);
  const prepare = useCallback(async (a: CcAction) => {
    setBusy('prepare'); setError(null); setResult(null); setPrep(null);
    try { setPrep(await posCopilotCenterApi.prepare(a)); setAction(a); }
    catch (e) { setError(errorTextOf(e, t('rcc.failed'))); } finally { setBusy(null); }
  }, []);
  const confirm = useCallback(async () => {
    if (!action || !prep?.token || busy) return null;
    setBusy('confirm'); setError(null);
    try {
      const r = await posCopilotCenterApi.confirm(action, prep.token); setResult(r); setPrep(null);
      try { window.dispatchEvent(new CustomEvent('rcc:action-done')); } catch { /* old browsers: the activity list still refreshes on Refresh */ }
      return r;
    }
    catch (e) { setError(errorTextOf(e, t('rcc.failed'))); return null; } finally { setBusy(null); }
  }, [action, prep, busy]);
  const reset = useCallback(() => { setPrep(null); setAction(null); setError(null); }, []);
  return { prep, result, error, busy, prepare, confirm, reset };
}
export type CopilotActionHandle = ReturnType<typeof useCopilotAction>;

export function PreparedCard({ h, confirmLabel, testId }: { h: CopilotActionHandle; confirmLabel: string; testId: string }) {
  const p = h.prep; if (!p) return h.error ? <div className="rcc-err" role="alert" data-testid={`${testId}-error`}>{h.error}</div> : null;
  const blocked = p.state === 'blocked';
  return (
    <div className="rcc-card" data-testid={testId} data-state={p.state}>
      <div className="rcc-card-h"><b>{t('rcc.review')}: {t(`rcc.type.${p.type}`)}</b><Badge s={blocked ? 'failed' : 'pending'} /></div>
      {p.current ? <><div className="rcc-sub">{t('rcc.current')}</div><KV obj={p.current} /></> : null}
      <div className="rcc-sub">{t('rcc.proposed')}</div><KV obj={p.proposed} />
      {p.blocked.map((x, i) => <div key={`b${i}`} className="rcc-block" data-testid={`${testId}-blocked`}>{x}</div>)}
      {p.warnings.map((x, i) => <div key={`w${i}`} className="rcc-warn">{x}</div>)}
      {p.notices.map((x, i) => <div key={`n${i}`} className="rcc-note">{x}</div>)}
      {p.expiresAt ? <div className="rcc-note">{t('rcc.expires', { when: when(p.expiresAt) })}</div> : null}
      <div className="rcc-row">
        <button className="btn" disabled={blocked || !!h.busy} onClick={() => { void h.confirm(); }} data-testid={`${testId}-confirm`}>{h.busy === 'confirm' ? t('rcc.working') : confirmLabel}</button>
        <button className="btn ghost" disabled={!!h.busy} onClick={h.reset} data-testid={`${testId}-back`}>{t('rcc.back')}</button>
      </div>
      {h.error ? <div className="rcc-err" role="alert">{h.error}</div> : null}
    </div>
  );
}

export function ActionOutcome({ h, testId }: { h: CopilotActionHandle; testId: string }) {
  const r = h.result; if (!r) return null;
  const rec: Record<string, unknown> = r.record ?? {};
  const ref = rec.appointmentId ?? rec.notificationId ?? rec.providerRef ?? null;
  return (
    <div className={`rcc-outcome ${r.ok ? '' : 'rcc-outcome-bad'}`} role="status" data-testid={testId} data-state={r.state}>
      <Badge s={r.state} /> <span>{t(`rcc.outcome.${r.state}`)}</span>
      {ref ? <span className="rcc-ref"> · {t('rcc.reference')}: <code>{String(ref)}</code></span> : null}
      {rec.status ? <span className="rcc-ref"> · {t('rcc.f.status')}: {String(rec.status)}</span> : null}
      {rec.testSender ? <div className="rcc-note">{t('rcc.testSender')}</div> : null}
      {!r.ok ? <div className="rcc-err">{r.errorCode ? errorTextOf({ code: r.errorCode, message: r.message }, r.message ?? t('rcc.failed')) : r.message}</div> : null}
      {r.duplicate ? <div className="rcc-note">{t('rcc.duplicate')}</div> : null}
    </div>
  );
}

// ── live status strip + Check Copilot System ─────────────────────────────────────────────────────────────────────────
export function CopilotOpsBar() {
  const [o, setO] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [health, setHealth] = useState<any>(null); const [checking, setChecking] = useState(false);
  const load = useCallback(() => { posCopilotCenterApi.overview().then((r) => { setO(r); setErr(null); }).catch((e) => setErr(errorTextOf(e, t('rcc.failed')))); }, []);
  useEffect(() => { load(); const id = setInterval(load, 45_000); return () => clearInterval(id); }, [load]);
  const check = async () => { setChecking(true); try { setHealth(await posCopilotCenterApi.health()); load(); } catch (e) { setHealth({ error: errorTextOf(e, t('pos.something_went_wrong')) }); } finally { setChecking(false); } };
  return (
    <section className="rcc-ops" data-testid="rcc-ops" aria-label={t('rcc.status')}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !o ? <div className="rcc-muted">{t('rcc.loading')}</div> : (
        <div className="rcc-strip">
          <Stat label={t('rcc.waiting')} v={o.queue ? o.queue.waiting : null} test="waiting" />
          <Stat label={t('rcc.inService')} v={o.queue ? o.queue.inService : null} test="inservice" />
          <Stat label={t('rcc.techs')} v={o.activeTechnicians} test="techs" />
          <Stat label={t('rcc.upcoming')} v={o.upcomingNext2h} test="upcoming" />
          <Stat label={t('rcc.missedCalls')} v={o.missedCalls24h} test="missed" />
          <Stat label={t('rcc.failedActions')} v={o.failedActions24h} test="failed" />
          <div className="rcc-stat"><span>{t('rcc.health')}</span>{o.lastHealth ? <Badge s={o.lastHealth.overall} /> : <b className="rcc-muted">{t('rcc.notChecked')}</b>}</div>
        </div>
      )}
      <div className="rcc-row">
        {o ? <span className="rcc-muted" data-testid="rcc-asof">{t('rcc.asOf', { when: when(o.asOf) })}{o.queue ? '' : ` · ${t(`rcc.queue.${o.queueState}`)}`}</span> : null}
        <button className="btn ghost" onClick={load} data-testid="rcc-refresh">{t('rcc.refresh')}</button>
        <button className="btn" onClick={check} disabled={checking} data-testid="rcc-check">{checking ? t('rcc.working') : t('rcc.check')}</button>
      </div>
      {health ? (
        <FitDialog title={t('rcc.check')} subtitle={health.checkedAt ? `${t('rcc.asOf', { when: when(health.checkedAt) })}${health.rateLimited ? ` · ${t('rcc.rateLimited')}` : ''}` : undefined} onClose={() => setHealth(null)} wide testId="rcc-health">
          {health.error ? <div className="rcc-err">{health.error}</div> : (
            <>
              <div className="rcc-row"><b>{t('rcc.overall')}</b> <Badge s={health.overall} /></div>
              <table className="rcc-table"><thead><tr><th>{t('rcc.area')}</th><th>{t('rcc.state')}</th><th>{t('rcc.detail')}</th><th>{t('rcc.next')}</th></tr></thead>
                <tbody>{(health.checks ?? []).map((c: any) => (
                  <tr key={c.id} data-check={c.id}><td>{c.area}<div className="rcc-muted">{c.label}</div></td><td><Badge s={c.state} /></td><td>{c.detail}<div className="rcc-muted">{c.evidence}</div></td><td>{c.remedy ?? '—'}</td></tr>
                ))}</tbody></table>
              <div className="rcc-note">{t('rcc.checkNote')}</div>
            </>
          )}
        </FitDialog>
      ) : null}
    </section>
  );
}
function Stat({ label, v, test }: { label: string; v: number | null | undefined; test: string }) {
  return <div className="rcc-stat" data-testid={`rcc-stat-${test}`}><span>{label}</span><b>{v == null ? t('rcc.unknown') : v}</b></div>;
}

// ── Smart Front Desk Priority Assistant (approval required) ──────────────────────────────────────────────────────────
export function PriorityAssistant({ nav }: { nav: (to: string) => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const h = useCopilotAction();
  const load = useCallback(() => { posCopilotCenterApi.priorities().then((r) => { setD(r); setErr(null); }).catch((e) => setErr(errorTextOf(e, t('rcc.failed')))); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <section className="rcc-panel" data-testid="rcc-priorities">
      <div className="rcc-card-h"><b>{t('rcc.priorities')}</b><button className="btn ghost" onClick={load}>{t('rcc.refresh')}</button></div>
      <div className="rcc-note">{t('rcc.prioritiesNote')}</div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="rcc-muted">{t('rcc.loading')}</div> : !d.items.length ? <Empty title={t('rcc.prioritiesEmpty')} /> : (
        <ul className="rcc-list">{d.items.map((i: any) => (
          <li key={i.id} data-kind={i.kind} data-testid="rcc-priority">
            <span className={`rcc-pri rcc-pri-${i.priority}`}>{t(`rcc.pri.${i.priority}`)}</span>
            <div className="rcc-grow"><div>{i.reason}</div><div className="rcc-muted">{t('rcc.evidence')}: {i.evidence}</div></div>
            {i.proposal.actionType
              ? <button className="btn" disabled={!!h.busy} onClick={() => h.prepare({ type: i.proposal.actionType, ...(i.proposal.prefill ?? {}) } as CcAction)} data-testid="rcc-priority-prepare">{i.proposal.label}</button>
              : i.proposal.link ? <button className="btn ghost" onClick={() => nav(i.proposal.link)}>{i.proposal.label}</button> : <span className="rcc-muted">{i.proposal.label}</span>}
          </li>
        ))}</ul>
      )}
      {h.prep || h.error ? (
        <FitDialog title={t('rcc.reviewProposal')} onClose={h.reset} testId="rcc-priority-dialog">
          <PreparedCard h={h} confirmLabel={t('rcc.confirm')} testId="rcc-pa" />
        </FitDialog>
      ) : null}
      <ActionOutcome h={h} testId="rcc-pa-outcome" />
    </section>
  );
}

// ── scoped search + activity history ──────────────────────────────────────────────────────────────────────────────────
const SCOPES = ['customers', 'appointments', 'technicians', 'calls', 'activity'] as const;
const STATES = ['pending', 'succeeded', 'failed', 'unknown'] as const;
const TYPES = ['create_appointment', 'reschedule_appointment', 'cancel_appointment', 'send_message'] as const;
const PERIODS = ['today', 'yesterday', 'week', 'month', 'year', 'custom'] as const;
export function CopilotWorkspace() {
  const [tab, setTab] = useState<'search' | 'activity'>('activity');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="rcc-panel" data-testid="rcc-workspace">
      <div className="rcc-tabs" role="tablist">
        {(['activity', 'search'] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={`rcc-tab-${k}`}>{t(`rcc.tab.${k}`)}</button>)}
      </div>
      {tab === 'activity' ? <ActivityTab /> : <SearchTab onOpen={setOpen} />}
      {open ? <CustomerActivityOverlay customerId={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
function SearchTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [scope, setScope] = useState<string>('customers'); const [q, setQ] = useState(''); const dq = useDebounced(q, 300); const [page, setPage] = useState(1); const [size, setSize] = useState(20);
  const [r, setR] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setPage(1); }, [scope, dq, size]);
  useEffect(() => {
    let on = true; setErr(null);
    posCopilotCenterApi.search({ scope, q: dq, page, pageSize: size }).then((x) => on && setR(x)).catch((e) => on && setErr(errorTextOf(e, t('rcc.failed'))));
    return () => { on = false; };
  }, [scope, dq, page, size]);
  return (
    <div>
      <div className="rcc-row">
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label={t('rcc.scope')} data-testid="rcc-scope">{SCOPES.map((s) => <option key={s} value={s}>{t(`rcc.scope.${s}`)}</option>)}</select>
        <input className="rcc-grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('rcc.searchPh')} aria-label={t('rcc.searchPh')} data-testid="rcc-q" />
        <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label={t('rcc.pageSize')}>{[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        {q ? <button className="btn ghost" onClick={() => setQ('')}>{t('rcc.clear')}</button> : null}
      </div>
      <div className="rcc-muted" data-testid="rcc-search-scope">{t('rcc.scopeBadge', { scope: t(`rcc.scope.${scope}`) })}{r && !r.hint ? ` · ${t('rcc.total', { n: r.total })}` : ''}</div>
      {err ? <ErrorRetry message={err} onRetry={() => setPage((p) => p)} /> : !r ? null : r.hint ? <div className="rcc-muted">{t('rcc.typeMore')}</div> : !r.items.length ? <Empty title={t('rcc.noMatches')} /> : (
        <table className="rcc-table" data-testid="rcc-search-results"><tbody>{r.items.map((x: any) => (
          <tr key={x.id}>
            {scope === 'customers' ? <><td><b>{x.name}</b>{x.sharedPhoneProfiles ? <div className="rcc-warn">{t('rcc.sharedPhone', { n: x.sharedPhoneProfiles })}</div> : null}</td><td>{x.phone ?? '—'}</td><td>{x.email ?? '—'}</td>
              <td><button className="btn ghost" onClick={() => onOpen(x.id)} data-testid="rcc-open-customer">{t('rcc.openActivity')}</button></td></>
            : scope === 'appointments' ? <><td><b>{x.customer}</b><div className="rcc-muted"><code>{x.id}</code></div></td><td>{x.date} {x.startTime}</td><td>{x.technician ?? '—'}</td><td>{x.status}</td></>
            : scope === 'technicians' ? <><td><b>{x.name}</b></td><td><code>{x.id}</code></td><td>{x.active ? t('rcc.active') : t('rcc.inactive')}</td></>
            : scope === 'calls' ? <><td><code>{x.providerRef ?? x.id}</code></td><td>{when(x.at)}</td><td>{x.booking ?? '—'}</td><td>{x.followUp ? t('rcc.followUp') : ''}</td></>
            : <><td>{when(x.at)}</td><td>{x.summary}</td><td><Badge s={x.state} /></td></>}
          </tr>
        ))}</tbody></table>
      )}
      {r && !r.hint ? <Pager info={{ page: r.page, pageSize: r.pageSize, totalItems: r.total, totalPages: r.pages }} onPage={setPage} /> : null}
    </div>
  );
}
function ActivityTab() {
  const [f, setF] = useState<{ q: string; state?: string; type?: string; period: string; from?: string; to?: string; page: number; pageSize: number }>({ q: '', period: 'month', page: 1, pageSize: 20 });
  const dq = useDebounced(f.q, 300); const [r, setR] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [cal, setCal] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p, page: p.page ?? 1 }));
  const load = useCallback(() => {
    setErr(null);
    posCopilotCenterApi.activity({ q: dq, state: f.state, type: f.type, period: f.period, from: f.from, to: f.to, page: f.page, pageSize: f.pageSize }).then(setR).catch((e) => setErr(errorTextOf(e, t('rcc.failed'))));
  }, [dq, f.state, f.type, f.period, f.from, f.to, f.page, f.pageSize]);
  useEffect(() => { load(); }, [load]);
  // CP11: a newly confirmed action shows on page 1 straight away (history only — the live queue keeps its own order)
  useEffect(() => { const h = () => load(); window.addEventListener('rcc:action-done', h); return () => window.removeEventListener('rcc:action-done', h); }, [load]);
  return (
    <div>
      <div className="rcc-row">
        <button className="btn ghost" onClick={load} data-testid="rcc-act-refresh">{t('rcc.refresh')}</button>
        <input className="rcc-grow" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder={t('rcc.activityPh')} aria-label={t('rcc.activityPh')} data-testid="rcc-act-q" />
        <select value={f.state ?? ''} onChange={(e) => set({ state: e.target.value || undefined })} aria-label={t('rcc.state')} data-testid="rcc-act-state"><option value="">{t('rcc.allStates')}</option>{STATES.map((s) => <option key={s} value={s}>{t(`rcc.state.${s}`)}</option>)}</select>
        <select value={f.type ?? ''} onChange={(e) => set({ type: e.target.value || undefined })} aria-label={t('rcc.type')}><option value="">{t('rcc.allTypes')}</option>{TYPES.map((s) => <option key={s} value={s}>{t(`rcc.type.${s}`)}</option>)}</select>
        <select value={f.period} onChange={(e) => (e.target.value === 'custom' ? setCal(true) : set({ period: e.target.value, from: undefined, to: undefined }))} aria-label={t('rcc.period')} data-testid="rcc-act-period">
          {PERIODS.map((p) => <option key={p} value={p}>{t(`rcc.period.${p}`)}</option>)}</select>
        <button className="btn ghost" onClick={() => setCal(true)} data-testid="rcc-act-cal">{f.period === 'custom' && f.from ? `${f.from} → ${f.to}` : t('rcc.fromTo')}</button>
        <select value={f.pageSize} onChange={(e) => set({ pageSize: Number(e.target.value) })} aria-label={t('rcc.pageSize')} data-testid="rcc-act-size">{[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        <button className="btn ghost" onClick={() => setF({ q: '', period: 'month', page: 1, pageSize: f.pageSize })}>{t('rcc.clear')}</button>
      </div>
      <div className="rcc-muted" data-testid="rcc-act-window">{r ? t('rcc.window', { from: r.window.from, to: r.window.to, tz: r.window.tz, n: r.total }) : ''}</div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !r ? <div className="rcc-muted">{t('rcc.loading')}</div> : !r.items.length ? <Empty title={t('rcc.activityEmpty')}>{f.q || f.state || f.type ? t('rcc.filtersExclude') : t('rcc.noActionsYet')}</Empty> : (
        <table className="rcc-table" data-testid="rcc-activity"><thead><tr><th>{t('rcc.when')}</th><th>{t('rcc.action')}</th><th>{t('rcc.state')}</th><th>{t('rcc.reference')}</th><th>{t('rcc.by')}</th></tr></thead>
          <tbody>{r.items.map((x: any) => (
            <tr key={x.id} data-state={x.state}><td>{when(x.at)}</td><td>{x.summary}{x.errorCode ? <div className="rcc-muted">{x.errorCode}</div> : null}</td><td><Badge s={x.state} /></td><td>{x.reference ? <code>{String(x.reference).slice(0, 8)}</code> : '—'}</td><td>{x.actor ?? '—'}</td></tr>
          ))}</tbody></table>
      )}
      {r ? <Pager info={{ page: r.page, pageSize: r.pageSize, totalItems: r.total, totalPages: r.pages }} onPage={(p) => setF((x) => ({ ...x, page: p }))} /> : null}
      {cal ? (
        <FitDialog title={t('rcc.fromTo')} onClose={() => setCal(false)} testId="rcc-calendar">
          <RangeCalendar today={today()} initial={{ from: f.from, to: f.to }} onApply={(x) => { set({ period: 'custom', from: x.from, to: x.to }); setCal(false); }}
            onCancel={() => setCal(false)} onClear={() => { set({ period: 'month', from: undefined, to: undefined }); setCal(false); }} />
        </FitDialog>
      ) : null}
    </div>
  );
}

// ── Full Customer & Reception Activity Overlay ─────────────────────────────────────────────────────────────────────────
const OV_TABS = ['overview', 'appointments', 'messages', 'actions', 'consent', 'audit'] as const;
export function CustomerActivityOverlay({ customerId, onClose, nav }: { customerId: string; onClose: () => void; nav?: (to: string) => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [tab, setTab] = useState<(typeof OV_TABS)[number]>('overview');
  useEffect(() => { posCopilotCenterApi.customer(customerId).then(setD).catch((e) => setErr(errorTextOf(e, t('rcc.failed')))); }, [customerId]);
  const go = (to: string) => { if (nav) nav(to); else window.location.assign(to); };
  return (
    <FitDialog title={d?.overview?.name ?? t('rcc.customer')} onClose={onClose} wide testId="rcc-overlay"
      footer={<div className="rcc-row">{d ? <button className="btn" onClick={() => go(d.links.openBooking)} data-testid="rcc-ov-booking">{t('rcc.openBooking')}</button> : null}
        {d ? <button className="btn ghost" onClick={() => go(d.links.communications)}>{t('rcc.viewComms')}</button> : null}
        <button className="btn ghost" onClick={onClose} data-testid="rcc-ov-close">{t('rcc.close')}</button></div>}>
      {err ? <div className="rcc-err">{err}</div> : !d ? <div className="rcc-muted">{t('rcc.loading')}</div> : (
        <>
          <div className="rcc-tabs" role="tablist">{OV_TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={`rcc-ov-tab-${k}`}>{t(`rcc.ov.${k}`)}</button>)}</div>
          {tab === 'overview' ? <><KV obj={{ phone: d.overview.phone, phoneVerified: d.overview.phoneVerified, email: d.overview.email, customerSince: when(d.overview.customerSince) }} />
            {d.overview.sharedPhoneProfiles ? <div className="rcc-warn">{t('rcc.sharedPhone', { n: d.overview.sharedPhoneProfiles })}</div> : null}</> : null}
          {tab === 'appointments' ? <><div className="rcc-sub">{t('rcc.upcomingAppts')}</div>{d.appointments.upcoming.length ? <ul className="rcc-list">{d.appointments.upcoming.map((a: any) => <li key={a.id}>{a.date} {a.startTime} · {a.status}</li>)}</ul> : <div className="rcc-muted">{t('rcc.none')}</div>}
            <div className="rcc-sub">{t('rcc.pastAppts')}</div>{d.appointments.past.length ? <ul className="rcc-list">{d.appointments.past.map((a: any) => <li key={a.id}>{a.date} {a.startTime} · {a.status}</li>)}</ul> : <div className="rcc-muted">{t('rcc.none')}</div>}</> : null}
          {tab === 'messages' ? <>{d.messages.length ? <ul className="rcc-list">{d.messages.map((m: any) => <li key={m.id}>{when(m.at)} · {m.channel} <Badge s={m.state} /></li>)}</ul> : <div className="rcc-muted">{t('rcc.none')}</div>}<div className="rcc-note">{d.calls.note}</div></> : null}
          {tab === 'actions' ? (d.copilotActions.length ? <ul className="rcc-list">{d.copilotActions.map((a: any) => <li key={a.id}>{when(a.at)} · {a.summary} <Badge s={a.state} /></li>)}</ul> : <div className="rcc-muted">{t('rcc.none')}</div>) : null}
          {tab === 'consent' ? <KV obj={{ marketingSms: d.consent.marketingSms, marketingEmail: d.consent.marketingEmail, smsOptOut: d.consent.smsOptOut ? when(d.consent.smsOptOut.at) : t('rcc.no') }} /> : null}
          {tab === 'audit' ? (d.audit.length ? <ul className="rcc-list">{d.audit.map((a: any, i: number) => <li key={i}>{when(a.at)} · {a.summary}</li>)}</ul> : <div className="rcc-muted">{t('rcc.none')}</div>) : null}
          <div className="rcc-note">{t('rcc.overlayAudited')}</div>
        </>
      )}
    </FitDialog>
  );
}
