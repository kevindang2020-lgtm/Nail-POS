// POSAICallsScreen.tsx — AI Center → AI Calls (/tenant/ai/receptionist/calls). Rebuilt in place for the AI Calls & Voice
// Intelligence guide (Oct 31 2026). The original composition is kept: the "Calls" title, its subtitle and the Recent Calls
// panel with an honest empty state. What changed:
//   • P0 — the list was empty because nothing received the provider's call events; the call record was written only when
//     the agent itself posted an outcome. Signed Retell events now arrive at /webhooks/voice/retell, and the empty state
//     says WHY there are no calls (Check AI Calls System) instead of a bare "No calls yet"
//   • header: Check AI Calls System · Refresh · AI Receptionist; summary strip from verified counters ("—" = unknown)
//   • history: scoped search (calls / customers / AI appointments / AI activity), status + outcome, date basis, From/To
//     month calendar, numbered pages 10/20/50, newest first; non-private filters kept in the URL (never the search text)
//   • the call overlay with Close: Overview · Customer · Summary/Transcript · Recording · Tool Activity · Booking ·
//     Handoff & Follow-Ups · Audit / Errors — opening a call is audited; transcripts only for managers; recordings are
//     never linked; "booked" from the AI is shown apart from bookings Booking actually holds
//   • the missed-call / unresolved assistant (urgent + oldest first, suggestions only) and Reconciliation
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posAiCallsCenterApi, type AicCallsQuery } from '../api/posAiCallsCenterApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtDateTime } from '../i18n/format';
import { FitDialog, Pager, Empty, ErrorRetry, useDebounced } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';
import { statusLabel } from '../i18n/status-label';   // the code stays the truth; only its label is translated

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const SCOPES = ['calls', 'customers', 'appointments', 'activity'] as const;
const PERIODS = ['today', 'week', 'month', 'year', 'custom'] as const;
const STATUSES = ['completed', 'missed', 'abandoned', 'failed', 'handed_off', 'in_progress'] as const;
const BASES = ['call_started', 'call_ended', 'recorded', 'last_event'] as const;   // A10 Nov 6: more date bases
const OUTCOMES = ['booked', 'booking_requested', 'question', 'handoff', 'follow_up'] as const;
const TABS = ['overview', 'customer', 'summary', 'recording', 'tools', 'booking', 'handoff', 'audit'] as const;
const TONE: Record<string, string> = { READY: 'ok', WARNING: 'warn', FAILED: 'bad', NOT_CONFIGURED: 'warn', DISABLED: 'muted', UNKNOWN: 'bad', BLOCKED_EXTERNAL: 'muted' };
const STAT_TONE: Record<string, string> = { completed: 'ok', failed: 'bad', abandoned: 'bad', missed: 'bad', handed_off: 'warn', in_progress: 'warn', unknown: 'muted' };
const when = (v?: string | null) => (v ? fmtDateTime(v) : '—');
const dur = (s?: number | null) => (s == null ? '—' : `${Math.floor(s / 60)}m ${s % 60}s`);
const num = (v: number | null | undefined) => (v == null ? '—' : String(v));
const today = () => deviceToday();
const QKEYS = ['status', 'outcome', 'dateBasis', 'period', 'from', 'to', 'sort', 'page', 'pageSize', 'agent', 'direction', 'minSeconds', 'maxSeconds'] as const;

function Badge({ tone, label, testId }: { tone: string; label: string; testId?: string }) { return <span className={`aic-badge aic-${tone}`} data-testid={testId}>{label}</span>; }
function Metric({ id, label, value, sub }: { id: string; label: string; value: string; sub?: string }) {
  return <div className="aic-metric" data-testid={`aic-kpi-${id}`}><div className="aic-metric-l">{label}</div><div className="aic-metric-v">{value}</div>{sub ? <div className="aic-muted">{sub}</div> : null}</div>;
}

export function POSAICallsScreen() {
  const nav = useNavigate(); const can = useCan(); const canManage = can('ai.manage');
  const [sp, setSp] = useSearchParams();
  const initial = useMemo<AicCallsQuery>(() => {
    const o: AicCallsQuery = { page: 1, pageSize: 10, sort: 'newest', dateBasis: 'call_started' };
    for (const k of QKEYS) { const v = sp.get(k); if (v) (o as Record<string, unknown>)[k] = k === 'page' || k === 'pageSize' || k === 'minSeconds' || k === 'maxSeconds' ? Number(v) : v; }
    if (![10, 20, 50].includes(Number(o.pageSize))) o.pageSize = 10;
    return o;
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- read the URL once; later changes are written back
  const [f, setF] = useState<AicCallsQuery>(initial);
  const [period, setPeriod] = useState<{ period: string; from?: string; to?: string }>({ period: 'month' });
  const [kpi, setKpi] = useState<any>(null); const [kpiErr, setKpiErr] = useState<string | null>(null);
  const [scope, setScope] = useState<typeof SCOPES[number]>('calls');
  const [search, setSearch] = useState(''); const dq = useDebounced(search, 300);
  const [list, setList] = useState<any>(null); const [listErr, setListErr] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [cal, setCal] = useState<null | 'kpi' | 'calls'>(null);
  const [asst, setAsst] = useState<any>(null); const [asstPage, setAsstPage] = useState(1); const [asstErr, setAsstErr] = useState<string | null>(null);
  // ?call=<id> (from Reception Copilot) opens that call's details
  const [open, setOpen] = useState<string | null>(() => { const c = sp.get('call'); return c && /^[0-9a-f-]{36}$/i.test(c) ? c : null; });
  const [dialog, setDialog] = useState<null | 'health' | 'recon'>(null);
  const [lastCheck, setLastCheck] = useState<any>(null);

  const loadKpi = useCallback(() => { setKpiErr(null); posAiCallsCenterApi.kpis(period).then(setKpi).catch((e) => setKpiErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, [period]);
  const loadAsst = useCallback(() => { setAsstErr(null); posAiCallsCenterApi.assistant({ page: asstPage, pageSize: 10 }).then(setAsst).catch((e) => setAsstErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, [asstPage]);
  const loadList = useCallback(async () => {
    setLoading(true); setListErr(null);
    try {
      if (scope === 'calls') setList(await posAiCallsCenterApi.calls({ ...f, q: dq }));
      else setList(await posAiCallsCenterApi.search({ scope, q: dq, page: f.page, pageSize: f.pageSize }));
    } catch (e) { setListErr(errorTextOf(e, tx('pos.something_went_wrong'))); setList(null); } finally { setLoading(false); }
  }, [scope, dq, f]);
  const loadLast = useCallback(() => { posAiCallsCenterApi.lastHealth().then(setLastCheck).catch(() => setLastCheck(null)); }, []);
  useEffect(() => { loadLast(); }, [loadLast]);
  useEffect(() => { loadKpi(); }, [loadKpi]);
  useEffect(() => { loadAsst(); }, [loadAsst]);
  useEffect(() => { void loadList(); }, [loadList]);
  // a NEW search / scope goes back to page 1 — but not on mount, or the page restored from the URL is lost (Nov 3 audit)
  const firstSearch = useRef(true);
  useEffect(() => { if (firstSearch.current) { firstSearch.current = false; return; } setF((x) => (x.page === 1 ? x : { ...x, page: 1 })); }, [dq, scope]);
  // non-private filter state in the URL (the search text never goes there)
  useEffect(() => {
    const next = new URLSearchParams();
    for (const k of QKEYS) { const v = (f as Record<string, unknown>)[k]; if (v != null && v !== '' && !(k === 'page' && v === 1) && !(k === 'pageSize' && v === 10) && !(k === 'sort' && v === 'newest') && !(k === 'dateBasis' && v === 'call_started')) next.set(k, String(v)); }
    if (next.toString() !== sp.toString()) setSp(next, { replace: true });
  }, [f]);   // eslint-disable-line react-hooks/exhaustive-deps
  const setFilter = (patch: Partial<AicCallsQuery>) => setF((x) => ({ ...x, ...patch, page: 1 }));
  const refreshAll = () => { loadKpi(); loadAsst(); loadLast(); void loadList(); };
  const filtered = !!(dq || f.status || f.outcome || f.period || f.from);

  return (
    <div className="work aic" data-testid="aic-screen">
      <div className="vh aic-head">
        <div><h1>{t('aic.title')}</h1><div className="sub">{t('aic.subtitle')}</div></div>
        <div className="aic-actions">
          <button className="btn" data-testid="aic-check" onClick={() => setDialog('health')}>{t('aic.check')}</button>
          <button className="btn ghost" data-testid="aic-refresh" onClick={refreshAll}>{t('aic.refresh')}</button>
          <button className="btn ghost" onClick={() => setDialog('recon')} data-testid="aic-recon-open">{t('aic.recon')}</button>
          <button className="btn ghost" onClick={() => nav('/tenant/ai/receptionist')}>{t('aic.toReceptionist')}</button>
        </div>
      </div>
      {lastCheck ? <div className="aic-muted" data-testid="aic-last-check">{t('aic.lastCheck', { when: when(lastCheck.ranAt) })} · <Badge tone={TONE[lastCheck.overall] ?? 'muted'} label={t(`aic.state.${lastCheck.overall}`)} /></div> : null}

      {/* summary strip — verified counters only; "—" means unknown, never 0 */}
      <section className="panel aic-card" data-testid="aic-kpis">
        <div className="aic-card-head"><h2>{t('aic.summary')}</h2>
          <select aria-label={t('aic.period')} value={period.period} onChange={(e) => (e.target.value === 'custom' ? setCal('kpi') : setPeriod({ period: e.target.value }))} data-testid="aic-kpi-period">
            {PERIODS.map((p) => <option key={p} value={p}>{t(`aic.period.${p}`)}</option>)}
          </select>
          {kpi?.window ? <span className="aic-muted">{kpi.window.from} – {kpi.window.to}</span> : null}
        </div>
        {kpiErr ? <ErrorRetry message={kpiErr} onRetry={loadKpi} /> : !kpi ? <div className="state">{t('aic.loading')}</div> : (
          <>
            <div className="aic-metrics">
              <Metric id="total" label={t('aic.k.total')} value={num(kpi.total)} sub={kpi.inProgress ? t('aic.k.inProgress', { n: kpi.inProgress }) : undefined} />
              <Metric id="completed" label={t('aic.k.completed')} value={num(kpi.completed)} />
              <Metric id="failed" label={t('aic.k.failedMissed')} value={num(kpi.failedOrMissed)} sub={kpi.stale ? t('aic.k.stale', { n: kpi.stale }) : undefined} />
              <Metric id="bookings" label={t('aic.k.verifiedBookings')} value={num(kpi.bookings.verified)} sub={t('aic.k.aiReported', { n: kpi.bookings.aiReported })} />
              <Metric id="handoffs" label={t('aic.k.handoffs')} value={`${kpi.handoffs.requested} / ${kpi.handoffs.connected}`} sub={t('aic.k.handoffsSub')} />
              <Metric id="unresolved" label={t('aic.k.unresolved')} value={num(kpi.unresolved)} sub={kpi.followUpsCreated == null ? undefined : t('aic.k.followUps', { n: kpi.followUpsCreated })} />
              <Metric id="avg" label={t('aic.k.avgDuration')} value={dur(kpi.avgDurationSeconds)} sub={kpi.voiceMinutes == null ? undefined : t('aic.k.minutes', { n: kpi.voiceMinutes })} />
            </div>
            <details className="aic-defs"><summary>{t('aic.definitions')}</summary><ul>{Object.entries(kpi.definitions ?? {}).map(([k, v]) => <li key={k}><b>{t(`aic.def.${k}`)}</b> — {String(v)}</li>)}</ul></details>
            <div className="aic-muted" data-testid="aic-last-sync">{kpi.lastSyncedAt ? t('aic.lastSync', { when: when(kpi.lastSyncedAt) }) : t('aic.neverSynced')}</div>
          </>
        )}
      </section>

      {/* missed-call / unresolved assistant — suggestions only */}
      <section className="panel aic-card" data-testid="aic-assistant">
        <div className="aic-card-head"><h2>{t('aic.assistant')}</h2><span className="aic-muted">{t('aic.assistantNote')}</span></div>
        {asstErr ? <ErrorRetry message={asstErr} onRetry={loadAsst} /> : !asst ? <div className="state">{t('aic.loading')}</div> : asst.items.length === 0 ? <Empty title={t('aic.assistantEmpty')} /> : (
          <>
            <table className="tbl aic-tbl"><thead><tr><th>{t('aic.col.item')}</th><th>{t('aic.col.when')}</th><th>{t('aic.col.why')}</th><th /></tr></thead>
              <tbody>{asst.items.map((p: any) => (
                <tr key={`${p.sourceType}-${p.sourceRef}-${p.kind}`} data-testid="aic-assistant-row">
                  <td><Badge tone={p.urgency <= 2 ? 'bad' : 'warn'} label={t(`aic.kind.${p.kind}`)} /></td>
                  <td>{when(p.at)}</td><td className="aic-muted">{p.detail || '—'}{p.recommendation ? <div>{t('aic.suggestion')}: {p.recommendation}</div> : null}</td>
                  <td>{p.sourceType === 'call' ? <button className="btn ghost" onClick={() => setOpen(p.sourceRef)}>{t('aic.open')}</button> : null}</td>
                </tr>
              ))}</tbody></table>
            <Pager info={asst.pagination} onPage={setAsstPage} />
          </>
        )}
      </section>

      {/* Recent Calls → full history */}
      <section className="panel aic-card" data-testid="aic-calls">
        <div className="aic-card-head"><h2>{t('aic.recent')}</h2></div>
        <div className="aic-toolbar">
          <select aria-label={t('aic.scope')} value={scope} onChange={(e) => setScope(e.target.value as typeof SCOPES[number])} data-testid="aic-scope">
            {SCOPES.map((s) => <option key={s} value={s}>{t(`aic.scope.${s}`)}</option>)}
          </select>
          <input className="aic-search" data-testid="aic-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('aic.searchPh')} aria-label={t('aic.searchPh')} />
          {scope === 'calls' ? <>
            <select aria-label={t('aic.f.status')} value={f.status ?? ''} onChange={(e) => setFilter({ status: e.target.value || undefined })} data-testid="aic-f-status">
              <option value="">{t('aic.f.allStatus')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`aic.cstat.${s}`)}</option>)}
            </select>
            <select aria-label={t('aic.f.outcome')} value={f.outcome ?? ''} onChange={(e) => setFilter({ outcome: e.target.value || undefined })} data-testid="aic-f-outcome">
              <option value="">{t('aic.f.allOutcome')}</option>{OUTCOMES.map((s) => <option key={s} value={s}>{t(`aic.out.${s}`)}</option>)}
            </select>
            <select aria-label={t('aic.f.basis')} value={f.dateBasis} onChange={(e) => setFilter({ dateBasis: e.target.value })} data-testid="aic-f-basis">
              {BASES.map((b) => <option key={b} value={b}>{t(`aic.basis.${b}`)}</option>)}
            </select>
            <select aria-label={t('aic.period')} value={f.period ?? ''} onChange={(e) => (e.target.value === 'custom' ? setCal('calls') : setFilter({ period: e.target.value || undefined, from: undefined, to: undefined }))} data-testid="aic-f-period">
              <option value="">{t('aic.period.any')}</option>{PERIODS.map((p) => <option key={p} value={p}>{t(`aic.period.${p}`)}</option>)}
            </select>
            <button className="btn ghost" data-testid="aic-cal" onClick={() => setCal('calls')}>{f.from || f.to ? `${f.from ?? '…'} – ${f.to ?? '…'}` : t('aic.fromTo')}</button>
            {list?.agents?.length ? (
              <select aria-label={t('aic.f.agent')} value={f.agent ?? ''} onChange={(e) => setFilter({ agent: e.target.value || undefined })} data-testid="aic-f-agent">
                <option value="">{t('aic.f.allAgents')}</option>{list.agents.map((a: any) => <option key={a.ref} value={a.ref}>{a.name}</option>)}
              </select>) : null}
            <select aria-label={t('aic.f.direction')} value={f.direction ?? ''} onChange={(e) => setFilter({ direction: e.target.value || undefined })} data-testid="aic-f-direction">
              <option value="">{t('aic.f.allDirections')}</option>{['inbound', 'outbound'].map((d) => <option key={d} value={d}>{t(`aic.dir.${d}`)}</option>)}
            </select>
            <select aria-label={t('aic.f.length')} value={f.minSeconds === 300 ? 'long' : f.maxSeconds === 59 ? 'short' : f.minSeconds === 60 ? 'medium' : ''} data-testid="aic-f-length"
              onChange={(e) => { const r: Record<string, [number | undefined, number | undefined]> = { short: [undefined, 59], medium: [60, 299], long: [300, undefined] }; const x = r[e.target.value]; setFilter({ minSeconds: x?.[0], maxSeconds: x?.[1] }); }}>
              <option value="">{t('aic.f.anyLength')}</option>{['short', 'medium', 'long'].map((k) => <option key={k} value={k}>{t(`aic.len.${k}`)}</option>)}
            </select>
            <select aria-label={t('aic.sort')} value={f.sort} onChange={(e) => setFilter({ sort: e.target.value })}>{['newest', 'oldest', 'longest'].map((s) => <option key={s} value={s}>{t(`aic.sort.${s}`)}</option>)}</select>
          </> : null}
          <select aria-label={t('aic.pageSize')} value={f.pageSize} onChange={(e) => setFilter({ pageSize: Number(e.target.value) })} data-testid="aic-pagesize">{[10, 20, 50].map((n) => <option key={n} value={n}>{t('aic.perPage', { n })}</option>)}</select>
          <button className="btn ghost" data-testid="aic-clear" onClick={() => { setSearch(''); setF({ page: 1, pageSize: f.pageSize, sort: 'newest', dateBasis: 'call_started' }); }}>{t('aic.clear')}</button>
        </div>
        {scope === 'calls' && (f.period || f.from) ? <div className="aic-muted" data-testid="aic-basis-note">{t('aic.basisNote', { basis: t(`aic.basis.${f.dateBasis}`) })}</div> : null}
        {listErr ? <ErrorRetry message={listErr} onRetry={() => void loadList()} /> : loading && !list ? <div className="state">{t('aic.loading')}</div>
          : !list || list.items.length === 0 ? (
            <Empty title={filtered ? t('aic.noMatch') : scope === 'calls' ? t('aic.noCalls') : t('aic.typeToSearch')}>
              {!filtered && scope === 'calls' ? <><div className="aic-muted">{t('aic.noCallsWhy')}</div><button className="btn" onClick={() => setDialog('health')}>{t('aic.check')}</button></> : null}
            </Empty>
          ) : scope === 'calls' ? (
            <div className="aic-scroll"><table className="tbl aic-tbl" data-testid="aic-call-table"><thead><tr>
              <th>{t('aic.col.received')}</th><th>{t('aic.col.caller')}</th><th>{t('aic.col.duration')}</th><th>{t('aic.col.status')}</th><th>{t('aic.col.outcome')}</th>
              <th>{t('aic.col.booking')}</th><th>{t('aic.col.flags')}</th><th /></tr></thead>
              <tbody>{list.items.map((c: any) => (
                <tr key={c.id} data-testid="aic-call-row">
                  <td>{when(c.startedAt)}<div className="aic-muted">{c.callRef.slice(0, 14)}</div></td>
                  <td>{c.callerMasked ?? '—'}<div className="aic-muted">{t(`aic.identity.${c.identity}`)}{c.dialedNumber ? ` · ${t('aic.dialed', { n: c.dialedNumber })}` : ''}</div></td>
                  <td>{dur(c.durationSeconds)}</td>
                  <td><Badge tone={STAT_TONE[c.status] ?? 'muted'} label={t(`aic.cstat.${c.status}`)} testId={`aic-status-${c.status}`} /></td>
                  <td>{(c.intents ?? []).join(', ') || '—'}</td>
                  <td>{c.linkedAppointments ? <Badge tone="ok" label={t('aic.bookingVerified')} /> : c.bookingOutcome === 'booked' ? <Badge tone="warn" label={t('aic.bookingReported')} /> : c.bookingOutcome ?? '—'}</td>
                  <td>{c.handoffOutcome && c.handoffOutcome !== 'none' ? <Badge tone="warn" label={t('aic.flagHandoff')} /> : null}{c.followUpRequired ? <Badge tone="warn" label={t('aic.flagFollowUp')} /> : null}
                    {c.tools?.failed ? <Badge tone="bad" label={t('aic.flagToolFailed', { n: c.tools.failed })} /> : null}</td>
                  <td><button className="btn ghost" data-testid="aic-open" onClick={() => setOpen(c.callRef)}>{t('aic.details')}</button></td>
                </tr>
              ))}</tbody></table></div>
          ) : scope === 'customers' ? (
            <table className="tbl aic-tbl"><thead><tr><th>{t('aic.col.customer')}</th><th>{t('aic.col.phone')}</th><th>{t('aic.col.aiBookings')}</th><th /></tr></thead>
              <tbody>{list.items.map((c: any) => <tr key={c.id}><td>{c.name}{c.sharedPhone ? <div className="aic-warn-t">{t('aic.sharedPhone')}</div> : null}</td><td>{c.phoneMasked ?? '—'}</td><td>{c.aiBookings}</td>
                <td><button className="btn ghost" onClick={() => nav(`/booking/new?customerId=${encodeURIComponent(c.id)}&from=ai-calls`)}>{t('aic.openBooking')}</button></td></tr>)}</tbody></table>
          ) : scope === 'appointments' ? (
            <table className="tbl aic-tbl"><thead><tr><th>{t('aic.col.customer')}</th><th>{t('aic.col.when')}</th><th>{t('aic.col.status')}</th><th>{t('aic.col.verification')}</th></tr></thead>
              <tbody>{list.items.map((a: any) => <tr key={a.id}><td>{a.customerName ?? '—'}</td><td>{a.date} {a.startTime}</td><td>{statusLabel(['appointment', 'state'], a.status)}</td><td>{a.verification ?? '—'}</td></tr>)}</tbody></table>
          ) : (
            <table className="tbl aic-tbl"><thead><tr><th>{t('aic.col.when')}</th><th>{t('aic.col.item')}</th><th>{t('aic.col.detail')}</th></tr></thead>
              <tbody>{list.items.map((a: any) => <tr key={a.id}><td>{when(a.at)}</td><td>{t(`aic.activity.${a.kind}`)}</td><td>{a.detail}</td></tr>)}</tbody></table>
          )}
        {list ? <Pager info={list.pagination?.totalItems == null ? { ...list.pagination, totalItems: list.pagination.totalPages * list.pagination.pageSize } : list.pagination} onPage={(p) => setF((x) => ({ ...x, page: p }))} /> : null}
      </section>

      {cal ? (
        <FitDialog title={t('aic.fromTo')} onClose={() => setCal(null)} testId="aic-calendar">
          <RangeCalendar today={today()} initial={cal === 'kpi' ? { from: period.from, to: period.to } : { from: f.from, to: f.to }}
            onApply={(r) => { if (cal === 'kpi') setPeriod({ period: 'custom', from: r.from, to: r.to }); else setFilter({ period: 'custom', from: r.from, to: r.to }); setCal(null); }}
            onCancel={() => setCal(null)} onClear={() => { if (cal === 'kpi') setPeriod({ period: 'month' }); else setFilter({ period: undefined, from: undefined, to: undefined }); setCal(null); }} />
        </FitDialog>
      ) : null}
      {open ? <CallOverlay callRef={open} canManage={canManage} onClose={() => setOpen(null)} nav={nav} /> : null}
      {dialog === 'health' ? <HealthDialog onClose={() => { setDialog(null); loadLast(); }} /> : null}
      {dialog === 'recon' ? <ReconDialog onClose={() => setDialog(null)} onOpen={(ref) => { setDialog(null); setOpen(ref); }} /> : null}
    </div>
  );
}

function HealthDialog({ onClose }: { onClose: () => void }) {
  const [r, setR] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  // a check that ran in the last few seconds is SHOWN (with its time), not re-run — the server allows one run per 30 s
  const run = useCallback(() => {
    setErr(null); setR(null);
    posAiCallsCenterApi.health().then(setR).catch((e: any) => {
      if ((e?.code ?? e?.body?.code ?? e?.details?.code) !== 'AI_CALLS_CHECK_RATE_LIMITED') { setErr(errorTextOf(e, tx('pos.something_went_wrong'))); return; }
      posAiCallsCenterApi.lastHealth().then((x) => (x ? setR({ ...x, cached: true }) : setErr(errorTextOf(e, tx('pos.something_went_wrong'))))).catch(() => setErr(errorTextOf(e, tx('pos.something_went_wrong'))));
    });
  }, []);
  useEffect(() => { run(); }, [run]);
  const groups = useMemo(() => { const m = new Map<string, any[]>(); for (const c of r?.checks ?? []) m.set(c.group, [...(m.get(c.group) ?? []), c]); return [...m.entries()]; }, [r]);
  return (
    <FitDialog title={t('aic.check')} subtitle={t('aic.checkNote')} onClose={onClose} wide testId="aic-health">
      {err ? <ErrorRetry message={err} onRetry={run} /> : !r ? <div className="state">{t('aic.checking')}</div> : (
        <div className="aic-health">
          <div>{t('aic.overall')} <Badge tone={TONE[r.overall] ?? 'muted'} label={t(`aic.state.${r.overall}`)} testId="aic-health-overall" /></div>
          {r.cached ? <div className="aic-muted" data-testid="aic-health-cached">{t('aic.cachedCheck', { when: when(r.ranAt) })}</div> : null}
          {groups.map(([g, cs]) => (
            <div key={g} className="aic-hgroup"><h3>{g}</h3>
              {cs.map((c: any) => (
                <div key={c.id} className="aic-hrow" data-testid={`aic-check-${c.id}`}>
                  <Badge tone={TONE[c.state] ?? 'muted'} label={t(`aic.state.${c.state}`)} />
                  <div><b>{c.label}</b><div>{c.detail}</div><div className="aic-muted">{t('aic.evidence')}: {c.evidence}</div>
                    {c.impact ? <div className="aic-muted">{t('aic.impact')}: {c.impact}</div> : null}
                    {c.remedy ? <div className="aic-muted">{t('aic.next')}: {c.remedy}{c.roleRequired ? ` (${c.roleRequired})` : ''}</div> : null}
                    <div className="aic-muted">{when(c.checkedAt)} · {c.traceId}</div></div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </FitDialog>
  );
}

function ReconDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (ref: string) => void }) {
  const [r, setR] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); posAiCallsCenterApi.reconciliation().then(setR).catch((e) => setErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <FitDialog title={t('aic.recon')} subtitle={t('aic.reconNote')} onClose={onClose} wide testId="aic-recon">
      {err ? <ErrorRetry message={err} onRetry={load} /> : !r ? <div className="state">{t('aic.loading')}</div> : (
        <div className="aic-health">
          <h3>{t('aic.recon.orphans')}</h3>
          {r.eventsWithoutCall.length === 0 ? <div className="aic-muted">{t('aic.recon.none')}</div>
            : <table className="tbl aic-tbl"><tbody>{r.eventsWithoutCall.map((x: any) => <tr key={x.callRef} data-testid="aic-recon-orphan"><td>{x.callRef}</td><td>{when(x.firstReceivedAt)}</td><td>{x.events}</td><td className="aic-muted">{x.reason}</td></tr>)}</tbody></table>}
          <h3>{t('aic.recon.stale')}</h3>
          {r.staleInProgress.length === 0 ? <div className="aic-muted">{t('aic.recon.none')}</div>
            : <table className="tbl aic-tbl"><tbody>{r.staleInProgress.map((x: any) => <tr key={x.callRef}><td>{x.callRef}</td><td>{when(x.startedAt)}</td><td><button className="btn ghost" onClick={() => onOpen(x.callRef)}>{t('aic.open')}</button></td></tr>)}</tbody></table>}
          <div className="aic-muted">{t('aic.recon.postOnly', { n: r.callsWithoutProviderEvents30d })}</div>
          <div className="aic-muted">{r.providerSideComparison}</div>
        </div>
      )}
    </FitDialog>
  );
}

function CallOverlay({ callRef, canManage, onClose, nav }: { callRef: string; canManage: boolean; onClose: () => void; nav: (r: string) => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<typeof TABS[number]>('overview');
  const load = useCallback(() => { setErr(null); posAiCallsCenterApi.call(callRef).then(setD).catch((e) => setErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, [callRef]);
  useEffect(() => { load(); }, [load]);
  const c = d?.call;
  return (
    <FitDialog title={t('aic.callTitle')} subtitle={c ? `${when(c.startedAt)} · ${callRef}` : callRef} onClose={onClose} wide testId="aic-overlay"
      footer={<div className="aic-ov-foot">
        {d?.customer ? <button className="btn" onClick={() => nav(`/booking/new?customerId=${encodeURIComponent(d.customer.id)}&from=ai-calls`)} data-testid="aic-ov-booking">{t('aic.openBooking')}</button> : null}
        {d?.customer ? <button className="btn ghost" onClick={() => nav(`/customers?customerId=${encodeURIComponent(d.customer.id)}`)}>{t('aic.viewCustomer')}</button> : null}
        {d?.followUps?.length ? <button className="btn ghost" onClick={() => nav('/tenant/ai/receptionist/follow-ups')}>{t('aic.viewFollowUps')}</button> : null}
        <button className="btn ghost" onClick={onClose} data-testid="aic-ov-close">{t('aic.close')}</button></div>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="state">{t('aic.loading')}</div> : (
        <div className="aic-ov">
          <div className="aic-tabs" role="tablist">{TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className={'aic-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)} data-testid={`aic-tab-${k}`}>{t(`aic.tab.${k}`)}</button>)}</div>
          <div className="aic-ov-body" data-testid={`aic-pane-${tab}`}>
            {tab === 'overview' ? <dl className="aic-dl">
              <dt>{t('aic.ov.callId')}</dt><dd>{c.callRef}</dd><dt>{t('aic.ov.provider')}</dt><dd>{c.provider ?? '—'} · {d.overview.agentRef ?? '—'}</dd>
              <dt>{t('aic.ov.direction')}</dt><dd>{d.overview.direction ?? '—'}</dd><dt>{t('aic.ov.started')}</dt><dd>{when(c.startedAt)}</dd><dt>{t('aic.ov.ended')}</dt><dd>{when(c.endedAt)}</dd>
              <dt>{t('aic.ov.duration')}</dt><dd>{dur(c.durationSeconds)}</dd><dt>{t('aic.ov.disconnect')}</dt><dd>{d.overview.disconnectionReason ?? '—'}</dd>
              <dt>{t('aic.ov.error')}</dt><dd>{c.errorCategory ?? '—'}</dd><dt>{t('aic.ov.lastSync')}</dt><dd>{when(d.overview.lastSyncedAt)}</dd>
              {d.overview.statusNote ? <><dt>{t('aic.ov.note')}</dt><dd className="aic-warn-t">{d.overview.statusNote}</dd></> : null}
            </dl> : null}
            {tab === 'customer' ? <div>
              <div>{d.caller.masked ?? '—'} · {t(`aic.identity.${d.caller.identity}`)}</div><div className="aic-muted">{d.caller.explanation}</div>
              {d.customer ? <div className="aic-block"><b>{d.customer.name}</b> · {d.customer.phoneMasked ?? '—'}
                {d.customerPermissions ? <div className="aic-muted">{t('aic.perm', { sms: d.customerPermissions.smsMarketing ? t('aic.yes') : t('aic.no'), email: d.customerPermissions.emailMarketing ? t('aic.yes') : t('aic.no') })}</div> : null}</div> : null}
              {d.appointments.length ? <table className="tbl aic-tbl"><tbody>{d.appointments.map((a: any) => <tr key={a.id}><td>{a.date} {a.startTime}</td><td>{statusLabel(['appointment', 'state'], a.status)}</td><td>{a.verification ?? '—'}</td></tr>)}</tbody></table> : null}
            </div> : null}
            {tab === 'summary' ? <div>
              {c.summary ? <><div className="aic-muted">{t('aic.generated')}</div><p>{c.summary.text}</p></> : <div className="aic-muted">{t('aic.noSummary')}</div>}
              {d.transcript ? (d.transcript.restricted ? <div className="aic-muted" data-testid="aic-transcript-restricted">{t('aic.transcriptRestricted')}</div>
                : canManage && d.transcript.route ? <button className="btn ghost" onClick={() => nav(d.transcript.route)} data-testid="aic-transcript-link">{t('aic.openTranscript')}</button> : null)
                : <div className="aic-muted">{t('aic.noTranscript')}</div>}
            </div> : null}
            {tab === 'recording' ? <div data-testid="aic-recording"><Badge tone="muted" label={t(`aic.rec.${d.recording.state}`)} /><p>{d.recording.note}</p>
              {d.recording.consent ? <div className="aic-muted">{t('aic.consent', { s: d.recording.consent.status })}</div> : null}</div> : null}
            {tab === 'tools' ? <div><div className="aic-muted">{d.toolNote}</div>
              {d.toolActivity.length ? <table className="tbl aic-tbl" data-testid="aic-tools"><thead><tr><th>{t('aic.col.when')}</th><th>{t('aic.col.tool')}</th><th>{t('aic.col.status')}</th><th>{t('aic.col.result')}</th><th>{t('aic.col.error')}</th></tr></thead>
                <tbody>{d.toolActivity.map((x: any) => <tr key={x.id}><td>{when(x.requestedAt)}</td><td>{x.tool}</td><td><Badge tone={x.status === 'succeeded' ? 'ok' : x.status === 'requested' ? 'warn' : 'bad'} label={t(`aic.tstat.${x.status}`)} /></td>
                  <td>{x.businessResult ?? '—'}{x.requests > 1 ? <div className="aic-muted">{t('aic.retried', { n: x.requests })}</div> : null}</td><td>{x.errorCategory ?? '—'}</td></tr>)}</tbody></table> : null}</div> : null}
            {tab === 'booking' ? <div>
              <div>{t('aic.aiReportedLabel')}: <b>{d.booking.aiReported ?? '—'}</b></div>
              {d.booking.note ? <div className="aic-warn-t" data-testid="aic-booking-note">{d.booking.note}</div> : null}
              {d.booking.verified.length ? <table className="tbl aic-tbl"><tbody>{d.booking.verified.map((a: any) => <tr key={a.id}><td>{a.date} {a.startTime}</td><td>{statusLabel(['appointment', 'state'], a.status)}</td>
                <td><Badge tone={a.confirmed ? 'ok' : 'warn'} label={a.confirmed ? t('aic.confirmed') : t('aic.notConfirmed')} /></td></tr>)}</tbody></table> : null}
            </div> : null}
            {tab === 'handoff' ? <div>
              {d.handoffs.length === 0 && d.followUps.length === 0 ? <div className="aic-muted">{t('aic.noHandoff')}</div> : null}
              {d.handoffs.map((h: any) => <div key={h.id} className="aic-block"><Badge tone={h.state === 'completed' ? 'ok' : h.state === 'failed' ? 'bad' : 'warn'} label={t(`aic.hstate.${h.state}`)} /> {h.reason ?? ''} · {when(h.requestedAt)}{h.failureReason ? <div className="aic-muted">{h.failureReason}</div> : null}</div>)}
              {d.followUps.map((x: any) => <div key={x.id} className="aic-block">{t('aic.followUp')}: {statusLabel('state', x.status)} · {x.reason ?? ''} · {when(x.createdAt)}</div>)}
            </div> : null}
            {tab === 'audit' ? <div>
              <table className="tbl aic-tbl" data-testid="aic-events"><thead><tr><th>{t('aic.col.event')}</th><th>{t('aic.col.when')}</th><th>{t('aic.col.auth')}</th><th>{t('aic.col.result')}</th></tr></thead>
                <tbody>{d.events.map((e: any, i: number) => <tr key={i}><td>{statusLabel(['callEvent', 'state'], e.type)}</td><td>{when(e.occurredAt ?? e.receivedAt)}</td><td>{t(`aic.auth.${e.auth}`)}</td>
                  <td>{e.disposition}{e.deliveries > 1 ? ` · ${t('aic.deliveries', { n: e.deliveries })}` : ''}{e.failureReason ? ` · ${e.failureReason}` : ''}</td></tr>)}</tbody></table>
              {d.actions.length ? <div className="aic-muted">{t('aic.actionsCount', { n: d.actions.length })}</div> : null}
            </div> : null}
          </div>
        </div>
      )}
    </FitDialog>
  );
}
