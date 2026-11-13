// POSAIFollowUpsScreen.tsx — AI Follow-Ups & Human Handoff Center (AI Follow-Ups Complete Build Guide, Oct 31 2026).
// Preserves the original six status chips (Open · Assigned · In Progress · Waiting · Resolved · All), + New Follow-Up and
// Back to Command Center, and adds: live KPI cards, server-side search, filters, a salon-local From/To calendar with a stated
// date basis, numbered pages 10/20/50, the full task overlay (overview · customer · original AI call · contact attempts ·
// booking & messaging · assignments & audit), Check Follow-Up System and the Priority & Escalation Assistant.
// Server: /pos/ai/follow-ups-center/*. A text is prepared, shown, then confirmed — "submitted" is never shown as "delivered".
import { codeLabel } from '../components/codeLabel';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SavedViews, vStr, vNum, vBool, periodToView, periodFromView } from '../components/SavedViews';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posAiFollowUpsApi as fa, type FuDetail, type FuKpis, type FuPage, type FuPrepared, type FuPriority, type FuCheck } from '../api/posAiFollowUpsApi';
import { posCustomersApi } from '../api/posCustomersApi';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, type PeriodState } from '../components/FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtDateTime } from '../i18n/format';

const CHIPS = ['open', 'assigned', 'in_progress', 'waiting', 'resolved', 'all'] as const;
const PRIOS = ['urgent', 'high', 'normal', 'low'] as const;
const REASONS = ['CALLBACK', 'COMPLAINT', 'BOOKING_HELP', 'FAILED_TRANSFER', 'VERIFICATION_ISSUE', 'OTHER'] as const;
const RESOLUTIONS = ['customer_reached', 'booked', 'issue_resolved', 'no_action_needed', 'unreachable', 'duplicate', 'referred_to_manager'] as const;
const OUTCOMES = ['reached', 'no_answer', 'voicemail', 'wrong_number', 'requested_later', 'resolved', 'escalated'] as const;
const BASES = ['created', 'due', 'updated', 'call', 'assigned', 'first_response', 'last_contact', 'resolved'] as const;
const TABS = ['overview', 'timeline', 'customer', 'call', 'attempts', 'booking', 'audit'] as const;
const key = () => `fu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const fmt = (s: string | null | undefined, tz?: string) => (s ? new Date(s).toLocaleString(undefined, { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : tx('aifu.none'));
const label = (group: string, v: string | null | undefined) => (v ? tx(`aifu.${group}.${v}`) : tx('aifu.none'));
const tone = (s: string) => (s === 'READY' ? 'ok' : s === 'FAILED' ? 'bad' : s === 'DISABLED' || s === 'UNKNOWN' ? undefined : 'warn');

export function POSAIFollowUpsScreen() {
  const nav = useNavigate();
  const [status, setStatus] = useState<(typeof CHIPS)[number]>('open');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [priority, setPriority] = useState(''); const [source, setSource] = useState(''); const [assignee, setAssignee] = useState(''); const [overdue, setOverdue] = useState(false);
  const [sort, setSort] = useState('newest'); const [basis, setBasis] = useState('created'); const [period, setPeriod] = useState<PeriodState>({ preset: 'all' });
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<FuPage | null>(null); const [kpis, setKpis] = useState<FuKpis | null>(null); const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<{ id: string; name: string; role: string }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null); const [creating, setCreating] = useState(false); const [prefill, setPrefill] = useState<{ providerCallId: string; reason: string } | null>(null); const [health, setHealth] = useState<null | { overall: string; checks: FuCheck[]; ranAt: string; cached: boolean }>(null);
  const [prios, setPrios] = useState<FuPriority[] | null>(null); const [priosAt, setPriosAt] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);

  const query = useMemo(() => ({ status, q: dq.trim() || undefined, priority: priority || undefined, source: source || undefined, assignee: assignee || undefined, overdue: overdue ? '1' : undefined,
    sort, basis, ...periodQuery(period), page, pageSize }), [status, dq, priority, source, assignee, overdue, sort, basis, period, page, pageSize]);
  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fa.list(query), fa.kpis()]).then(([l, k]) => { setData(l); setKpis(k); setErr(null); }).catch((e) => setErr(errorTextOf(e, tx('aifu.loadFailed')))).finally(() => setLoading(false));
    fa.priorities().then((p) => { setPrios(p.items); setPriosAt(p.asOf ?? null); }).catch(() => setPrios(null));
  }, [query]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const h = setInterval(load, 45_000); return () => clearInterval(h); }, [load]);
  useEffect(() => { fa.staff().then((s) => setStaff(s.items)).catch(() => setStaff([])); }, []);
  useEffect(() => { setPage(1); }, [status, dq, priority, source, assignee, overdue, sort, basis, period, pageSize]);
  const filtered = !!(dq.trim() || priority || source || assignee || overdue || period.preset !== 'all');
  const clearAll = () => { setQ(''); setPriority(''); setSource(''); setAssignee(''); setOverdue(false); setPeriod({ preset: 'all' }); setBasis('created'); };
  const runHealth = () => fa.health().then(setHealth).catch((e) => setNotice(errorTextOf(e, tx('aifu.loadFailed'))));
  // A13 Nov 6: bring in missed calls / Copilot failures now (the 5-minute job also does it); past check runs
  const [importing, setImporting] = useState(false); const [runs, setRuns] = useState<any>(null);
  const runImport = async () => {
    setImporting(true);
    try { const r = await fa.importSources(); setNotice(tx('aifu.imported', { calls: r.createdFromMissedCalls, copilot: r.createdFromCopilot })); load(); }
    catch (e) { setNotice(errorTextOf(e, tx('aifu.loadFailed'))); } finally { setImporting(false); }
  };
  const showRuns = () => fa.healthHistory(1, 10).then(setRuns).catch((e) => setNotice(errorTextOf(e, tx('aifu.loadFailed'))));
  const c = kpis?.cards;
  // round 10 (AI Follow Ups 06 / 02): shift handover and the location's overdue-alert setting
  const [handing, setHanding] = useState(false); const [alerting, setAlerting] = useState(false);

  return (
    <div className="work aifu" data-testid="aifu">
      <div className="aifu-head">
        <div><h1>{tx('aifu.title')}</h1><div className="sub">{tx('aifu.subtitle')}</div></div>
        <div className="aifu-actions">
          <button className="btn" onClick={() => setCreating(true)} data-testid="aifu-new">{tx('aifu.new')}</button>
          <button className="btn ghost" onClick={load} data-testid="aifu-refresh">{tx('aifu.refresh')}</button>
          <button className="btn ghost" onClick={runImport} disabled={importing} data-testid="aifu-import">{tx('aifu.import')}</button>
          <button className="btn ghost" onClick={runHealth} data-testid="aifu-health">{tx('aifu.check')}</button>
          <button className="btn ghost" onClick={showRuns} data-testid="aifu-health-history">{tx('aifu.checkHistory')}</button>
          <button className="btn ghost" onClick={() => setHanding(true)} data-testid="aifu-handover">{tx('aifu.ho.button')}</button>
          <button className="btn ghost" onClick={() => setAlerting(true)} data-testid="aifu-alerts">{tx('aifu.al.button')}</button>
          <button className="btn ghost" onClick={() => nav('/tenant/ai/command-center')} data-testid="aifu-back">{tx('aifu.back')}</button>
        </div>
      </div>
      {runs ? (
        <section className="panel" data-testid="aifu-runs">
          <div className="aifu-head"><h3>{tx('aifu.checkHistory')}</h3><button className="link" onClick={() => setRuns(null)}>{tx('aifu.dismiss')}</button></div>
          {!runs.items.length ? <div className="muted">{tx('aifu.noRuns')}</div> : (
            <table className="tbl"><tbody>{runs.items.map((r: any, i: number) => <tr key={i} data-testid="aifu-run-row"><td>{r.at ? fmtDateTime(r.at) : '—'}</td><td>{r.overall}</td><td>{r.by ?? '—'}</td><td>{r.failed ? tx('aifu.runFailed', { n: r.failed }) : ''}</td></tr>)}</tbody></table>)}
        </section>) : null}
      {handing ? <HandoverDialog staff={staff} onClose={() => setHanding(false)} onDone={(n) => { setHanding(false); setNotice(tx('aifu.ho.done', { n })); load(); }} /> : null}
      {alerting ? <AlertSettingsDialog onClose={() => setAlerting(false)} /> : null}
      {notice ? <div className="aifu-notice" role="status">{notice} <button className="link" onClick={() => setNotice(null)}>{tx('aifu.dismiss')}</button></div> : null}
      <div className="aifu-kpis" data-testid="aifu-kpis">
        <KpiCard label={tx('aifu.k.open')} value={c ? c.open : '—'} onClick={() => setStatus('open')} testId="aifu-k-open" />
        <KpiCard label={tx('aifu.k.assigned')} value={c ? c.assigned : '—'} onClick={() => setStatus('assigned')} testId="aifu-k-assigned" />
        <KpiCard label={tx('aifu.k.in_progress')} value={c ? c.inProgress : '—'} onClick={() => setStatus('in_progress')} testId="aifu-k-in_progress" />
        <KpiCard label={tx('aifu.k.waiting')} value={c ? c.waiting : '—'} onClick={() => setStatus('waiting')} testId="aifu-k-waiting" />
        <KpiCard label={tx('aifu.k.overdue')} value={c ? c.overdue : '—'} tone={c && c.overdue ? 'bad' : undefined} onClick={() => { setStatus('all'); setOverdue(true); }} testId="aifu-k-overdue" />
        <KpiCard label={tx('aifu.k.resolved')} value={c ? c.resolved : '—'} sub={c ? tx('aifu.k.resolvedToday', { n: c.resolvedToday }) : undefined} onClick={() => setStatus('resolved')} testId="aifu-k-resolved" />
      </div>
      <div className="aifu-chips" role="tablist">
        {CHIPS.map((s) => <button key={s} role="tab" aria-selected={status === s} className={'btn' + (status === s ? '' : ' ghost')} onClick={() => setStatus(s)} data-testid={`aifu-chip-${s}`}>{tx(`aifu.chip.${s}`)}</button>)}
      </div>
      <div className="aifu-toolbar">
        <input className="aifu-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('aifu.searchPh')} aria-label={tx('aifu.searchPh')} data-testid="aifu-q" />
        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label={tx('aifu.f.priority')} data-testid="aifu-f-priority"><option value="">{tx('aifu.f.anyPriority')}</option>{PRIOS.map((p) => <option key={p} value={p}>{label('prio', p)}</option>)}</select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={tx('aifu.f.source')} data-testid="aifu-f-source"><option value="">{tx('aifu.f.anySource')}</option>{['ai', 'missed_call', 'copilot', 'manual', 'complaint'].map((s) => <option key={s} value={s}>{label('src', s)}</option>)}</select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label={tx('aifu.f.assignee')} data-testid="aifu-f-assignee"><option value="">{tx('aifu.f.anyone')}</option><option value="unassigned">{tx('aifu.f.unassigned')}</option><option value="me">{tx('aifu.f.me')}</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <label className="aifu-check"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} data-testid="aifu-f-overdue" /> {tx('aifu.f.overdue')}</label>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('aifu.f.sort')} data-testid="aifu-f-sort">{['newest', 'priority', 'due'].map((s) => <option key={s} value={s}>{tx(`aifu.sort.${s}`)}</option>)}</select>
        <PeriodBar compact allowAll value={period} onChange={setPeriod} server={data?.filters.period ? { ...data.filters.period, preset: data.filters.period.preset as PeriodState['preset'] } : null} basis={basis} onBasis={setBasis} basisOptions={BASES.map((b) => ({ value: b, label: tx(`aifu.basis.${b}`) }))} />
        <SavedViews surface="ai.follow-ups" testId="aifu-views" current={{ status, q, priority, source, assignee, overdue, sort, basis, pageSize, ...periodToView(period) }}
          onApply={(v) => { setStatus((CHIPS as readonly string[]).includes(vStr(v, 'status')) ? (vStr(v, 'status') as (typeof CHIPS)[number]) : 'open'); setQ(vStr(v, 'q')); setPriority(vStr(v, 'priority')); setSource(vStr(v, 'source'));
            setAssignee(vStr(v, 'assignee')); setOverdue(vBool(v, 'overdue')); setSort(vStr(v, 'sort', 'newest')); setBasis(vStr(v, 'basis', 'created')); setPageSize(vNum(v, 'pageSize', 20)); setPeriod(periodFromView(v, { preset: 'all' } as PeriodState)); }} />
        {filtered ? <button className="btn ghost" onClick={clearAll} data-testid="aifu-clear">{tx('aifu.clear')}</button> : null}
      </div>
      {data && period.preset !== 'all' ? <div className="sub aifu-basis" data-testid="aifu-basis-note">{tx('aifu.basisNote', { basis: tx(`aifu.basis.${data.filters.basis}`), tz: data.filters.period.tz })}</div> : null}
      <div className="aifu-body">
        <section className="panel aifu-list" aria-busy={loading} data-testid="aifu-list">
          {err ? <ErrorRetry message={err} onRetry={load} />
            : !data ? <div className="state">{tx('aifu.loading')}</div>
            : data.items.length === 0 ? <Empty title={filtered ? tx('aifu.emptyFiltered') : tx('aifu.empty', { status: tx(`aifu.chip.${status}`) })}>
                {filtered ? <button className="btn ghost" onClick={clearAll}>{tx('aifu.clear')}</button> : <><button className="btn" onClick={() => setCreating(true)}>{tx('aifu.new')}</button> <button className="btn ghost" onClick={() => setStatus('all')}>{tx('aifu.chip.all')}</button> <button className="btn ghost" onClick={runHealth}>{tx('aifu.check')}</button></>}
              </Empty>
            : <table className="tbl" data-testid="aifu-table">
                <thead><tr><th>{tx('aifu.col.customer')}</th><th>{tx('aifu.col.reason')}</th><th>{tx('aifu.col.call')}</th><th>{tx('aifu.col.priority')}</th><th>{tx('aifu.col.owner')}</th><th>{tx('aifu.col.due')}</th><th>{tx('aifu.col.status')}</th><th>{tx('aifu.col.lastContact')}</th></tr></thead>
                <tbody>{data.items.map((r) => (
                  <tr key={r.id} onClick={() => setOpenId(r.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id); }} className={r.overdue ? 'aifu-overdue' : ''} data-testid="aifu-row">
                    <td><div className="aifu-name">{r.customer?.name ?? tx('aifu.unmatchedCaller')}</div><div className="sub">{r.caller ?? tx('aifu.none')}{r.customerMatch === 'ambiguous' ? ` · ${tx('aifu.sharedPhone')}` : ''}</div>
                      {r.dataQuality?.length ? <div className="sub warn" data-testid="aifu-dq" title={tx('aifu.dq.why')}>{tx('aifu.dq.check')} {r.dataQuality.map((k) => codeLabel('aifu.dq', k, 'issue')).join(' · ')}</div> : null}</td>
                    <td>{label('reason', r.reason)}<div className="sub aifu-desc">{label('src', r.source === 'ai_receptionist' ? 'ai' : r.source === 'missed_call' ? 'missed_call' : r.source === 'reception_copilot' ? 'copilot' : 'manual')}{r.description ? ` · ${r.description}` : ''}</div></td>
                    <td className="sub">{r.providerCallId ? `${r.providerCallId.slice(0, 12)}…` : tx('aifu.none')}</td>
                    <td><span className={`aifu-pill p-${r.priority}`}>{label('prio', r.priority)}</span>{r.escalationLevel ? <span className="aifu-pill esc">{tx('aifu.escalated')}</span> : null}</td>
                    <td>{r.assignee?.name ?? tx('aifu.f.unassigned')}</td>
                    <td className={r.overdue ? 'aifu-late' : ''}>{fmt(r.dueAt, data.filters.period.tz)}{r.overdue ? ` · ${tx('aifu.overdue')}` : ''}</td>
                    <td><span className={`aifu-pill s-${r.status}`}>{label('st', r.status)}</span></td>
                    <td className="sub">{r.contactAttempts ? `${fmt(r.lastContactAt, data.filters.period.tz)} · ${r.contactAttempts}` : tx('aifu.none')}</td>
                  </tr>))}</tbody>
              </table>}
          {data ? <div className="aifu-foot">
            <span className="sub" data-testid="aifu-count">{tx('aifu.count', { n: data.totalItems })}</span>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label={tx('aifu.pageSize')} data-testid="aifu-pagesize">{[10, 20, 50].map((n) => <option key={n} value={n}>{tx('aifu.rows', { n })}</option>)}</select>
            <Pager info={data} onPage={setPage} />
          </div> : null}
        </section>
        <aside className="panel aifu-side" data-testid="aifu-assistant">
          <h3>{tx('aifu.assistant')}</h3>
          <div className="sub">{tx('aifu.assistantNote')}</div>
          {prios === null ? <div className="sub">{tx('aifu.loading')}</div> : prios.length === 0 ? <div className="sub">{tx('aifu.noRecs')}</div> : prios.slice(0, 6).map((p) => (
            <div key={p.taskId + p.signal} className="aifu-rec" data-testid="aifu-rec">
              <div className="aifu-rec-t">{tx(`aifu.sig.${p.signal}`)}</div>
              <div className="sub" data-testid="aifu-rec-evidence">{p.evidence.join(' · ')}</div>
              {priosAt ? <div className="sub" data-testid="aifu-rec-when">{tx('aifu.rec.when', { opened: fmt(new Date(Date.parse(priosAt) - p.ageMinutes * 60000).toISOString()), at: fmt(priosAt) })}</div> : null}
              <div className="aifu-row-btns">
                <button className="btn ghost" onClick={() => { setOpenId(p.taskId); fa.decide({ taskId: p.taskId, signal: p.signal, decision: 'accept' }).catch(() => undefined); }}>{tx('aifu.accept')}</button>
                <button className="btn ghost" onClick={() => fa.decide({ taskId: p.taskId, signal: p.signal, decision: 'dismiss' }).then(load).catch((e) => setNotice(errorTextOf(e, tx('aifu.loadFailed'))))} data-testid="aifu-rec-dismiss">{tx('aifu.dismiss')}</button>
                <button className="btn ghost" onClick={() => fa.decide({ taskId: p.taskId, signal: p.signal, decision: 'escalate', version: p.version }).then(load).catch((e) => setNotice(errorTextOf(e, tx('aifu.loadFailed'))))}>{tx('aifu.escalate')}</button>
              </div>
            </div>))}
        </aside>
      </div>
      {creating ? <CreateDialog staff={staff} prefill={prefill} onClose={() => { setCreating(false); setPrefill(null); }} onSaved={(id, dup) => { setCreating(false); setPrefill(null); setStatus(dup ? status : 'all'); setPage(1); setNotice(dup ? tx('aifu.created.dup') : tx('aifu.created.ok')); setOpenId(id); load(); }} /> : null}
      {openId ? <TaskDialog id={openId} staff={staff} onClose={() => { setOpenId(null); load(); }} onBooking={(cid) => nav(`/booking/new?customerId=${cid}&from=follow-up`)} /> : null}
      {health ? <FitDialog title={tx('aifu.check')} subtitle={`${label('hs', health.overall)} · ${fmt(health.ranAt)}${health.cached ? ` · ${tx('aifu.cached')}` : ''}`} onClose={() => setHealth(null)} wide testId="aifu-health-dialog">
        <table className="tbl"><thead><tr><th>{tx('aifu.h.domain')}</th><th>{tx('aifu.h.status')}</th><th>{tx('aifu.h.detail')}</th><th>{tx('aifu.h.next')}</th></tr></thead>
          <tbody>{health.checks.map((h) => <tr key={h.domain} data-testid={`aifu-h-${h.domain}`}><td>{tx(`aifu.hd.${h.domain}`)}</td><td><span className={`aifu-pill t-${tone(h.status) ?? 'none'}`}>{label('hs', h.status)}</span></td><td>{h.detail}<div className="sub">{h.evidence}</div></td><td className="sub">{h.nextAction ?? tx('aifu.none')}<div>{h.responsibleRole}</div></td></tr>)}</tbody></table>
        {/* extras #07 — stale event reconciler: each handoff that needed a callback but has no follow-up, for a person to review */}
        {health.checks.flatMap((h) => h.items ?? []).length ? <section data-testid="aifu-orphans" style={{ marginTop: 10 }}>
          <b>{tx('aifu.orph.title')}</b><div className="sub">{tx('aifu.orph.note')}</div>
          <table className="tbl"><tbody>{health.checks.flatMap((h) => h.items ?? []).map((o) => <tr key={o.eventId} data-testid="aifu-orphan">
            <td className="nowrap">{fmt(o.at)}</td><td>{codeLabel('aifu.orph.kind', o.kind, 'event')}{o.reason ? <div className="sub">{o.reason}</div> : null}</td><td className="sub">{o.providerCallId.slice(0, 16)}</td>
            <td><button className="btn ghost sm" data-testid="aifu-orphan-create" onClick={() => { setPrefill({ providerCallId: o.providerCallId, reason: o.kind === 'complaint' ? 'COMPLAINT' : 'CALLBACK' }); setHealth(null); setCreating(true); }}>{tx('aifu.orph.create')}</button></td></tr>)}</tbody></table>
        </section> : null}
      </FitDialog> : null}
    </div>
  );
}

function CreateDialog({ staff, prefill, onClose, onSaved }: { staff: { id: string; name: string }[]; prefill?: { providerCallId: string; reason: string } | null; onClose: () => void; onSaved: (id: string, dup: boolean) => void }) {
  const [reqKey] = useState(key);
  const [f, setF] = useState({ reason: prefill?.reason ?? 'CALLBACK', description: '', priority: 'normal', dueLocal: '', callerPhone: '', assignedUserId: '' });
  const [cq, setCq] = useState(''); const dcq = useDebounced(cq, 300); const [hits, setHits] = useState<any[]>([]); const [cust, setCust] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let live = true; if (dcq.trim().length < 2) { setHits([]); return; } posCustomersApi.quickSearch(dcq.trim()).then((r: any) => { if (live) setHits((r?.items ?? r ?? []).slice(0, 6)); }).catch(() => { if (live) setHits([]); }); return () => { live = false; }; }, [dcq]);
  const save = async () => {
    setBusy(true); setErr(null);
    try { const r = await fa.create({ reason: f.reason, description: f.description, priority: f.priority, dueLocal: f.dueLocal || null, customerId: cust?.id ?? null, callerPhone: cust ? null : (f.callerPhone || null), assignedUserId: f.assignedUserId || null, providerCallId: prefill?.providerCallId ?? null, idempotencyKey: reqKey }); onSaved(r.id, r.duplicate); }
    catch (e) { setErr(errorTextOf(e, tx('aifu.saveFailed'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('aifu.new')} subtitle={tx('aifu.createNote')} onClose={onClose} busy={busy} testId="aifu-create"
      footer={<><button className="btn ghost" onClick={onClose}>{tx('aifu.cancel')}</button><button className="btn" onClick={save} disabled={busy || f.description.trim().length < 3 || (!cust && !f.callerPhone.trim())} data-testid="aifu-create-save">{tx('aifu.save')}</button></>}>
      {err ? <div className="err" role="alert">{err}</div> : null}
      {prefill ? <div className="sub" data-testid="aifu-c-call">{tx('aifu.orph.forCall', { c: prefill.providerCallId.slice(0, 16) })}</div> : null}
      <div className="aifu-form">
        <label>{tx('aifu.c.customer')}{cust ? <div className="aifu-picked">{cust.name} <button className="link" onClick={() => setCust(null)}>{tx('aifu.change')}</button></div>
          : <><input value={cq} onChange={(e) => setCq(e.target.value)} placeholder={tx('aifu.c.customerPh')} data-testid="aifu-c-search" />{hits.length ? <div className="aifu-hits">{hits.map((h: any) => <button key={h.customerId ?? h.id} className="btn ghost" onClick={() => { setCust({ id: h.customerId ?? h.id, name: h.displayName ?? h.fullName ?? `${h.firstName ?? ''} ${h.lastName ?? ''}`.trim() }); setCq(''); }} data-testid="aifu-c-hit">{h.displayName ?? h.fullName ?? `${h.firstName ?? ''} ${h.lastName ?? ''}`}</button>)}</div> : null}</>}</label>
        {!cust ? <label>{tx('aifu.c.caller')}<input value={f.callerPhone} onChange={(e) => setF({ ...f, callerPhone: e.target.value })} placeholder="+1…" inputMode="tel" data-testid="aifu-c-phone" /></label> : null}
        <label>{tx('aifu.c.reason')}<select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} data-testid="aifu-c-reason">{REASONS.map((r) => <option key={r} value={r}>{label('reason', r)}</option>)}</select></label>
        <label>{tx('aifu.c.priority')}<select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIOS.map((p) => <option key={p} value={p}>{label('prio', p)}</option>)}</select></label>
        <label>{tx('aifu.c.due')}<input type="datetime-local" value={f.dueLocal} onChange={(e) => setF({ ...f, dueLocal: e.target.value })} data-testid="aifu-c-due" /></label>
        <label>{tx('aifu.c.assign')}<select value={f.assignedUserId} onChange={(e) => setF({ ...f, assignedUserId: e.target.value })}><option value="">{tx('aifu.f.unassigned')}</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label className="wide">{tx('aifu.c.description')}<textarea value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid="aifu-c-desc" /></label>
      </div>
    </FitDialog>
  );
}

function TaskDialog({ id, staff, onClose, onBooking }: { id: string; staff: { id: string; name: string }[]; onClose: () => void; onBooking: (customerId: string) => void }) {
  const [d, setD] = useState<FuDetail | null>(null); const [err, setErr] = useState<string | null>(null); const [tab, setTab] = useState<(typeof TABS)[number]>('overview');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  // A13 Nov 6: who to give it to (fewest open tasks) — a suggestion; a person still assigns
  const [rec, setRec] = useState<{ userId: string; name: string; reason: string } | null>(null);
  useEffect(() => { fa.recommendedAssignee().then(setRec).catch(() => setRec(null)); }, [id]);
  const [form, setForm] = useState({ note: '', reason: '', resolution: 'customer_reached', channel: 'phone_call', outcome: 'reached', text: '', override: '' });
  const [prep, setPrep] = useState<FuPrepared | null>(null); const [textKey, setTextKey] = useState(key);
  const reload = useCallback(() => fa.detail(id).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(errorTextOf(e, tx('aifu.loadFailed')))), [id]);
  useEffect(() => { reload(); }, [reload]);
  const act = async (fn: () => Promise<unknown>, done?: string) => { setBusy(true); setMsg(null); try { await fn(); if (done) setMsg(done); await reload(); } catch (e) { setMsg(errorTextOf(e, tx('aifu.saveFailed'))); } finally { setBusy(false); } };
  const o = d?.overview; const v = o?.version ?? 1; const can = d?.permissions;
  const active = o ? ['open', 'assigned', 'in_progress', 'waiting'].includes(o.status) : false;
  return (
    <FitDialog title={tx('aifu.d.title')} subtitle={o ? `${o.customer?.name ?? tx('aifu.unmatchedCaller')} · ${label('st', o.status)} · ${label('prio', o.priority)}` : undefined} onClose={onClose} busy={busy} wide testId="aifu-detail"
      footer={<>{o?.customer?.id && can?.canBook ? <button className="btn ghost" onClick={() => onBooking(o.customer!.id)} data-testid="aifu-d-booking">{tx('aifu.openBooking')}</button> : null}<button className="btn" onClick={onClose} data-testid="aifu-d-close">{tx('aifu.close')}</button></>}>
      {err ? <ErrorRetry message={err} onRetry={reload} /> : !d || !o ? <div className="state">{tx('aifu.loading')}</div> : <>
        {msg ? <div className="aifu-notice" role="status" data-testid="aifu-d-msg">{msg}</div> : null}
        {/* extras (AI Follow Ups 05) — Duplicate Contact Guard: reached in the last 7 days by another follow-up task or an
            end-of-day technician follow-up (server-recorded). A warning only; it blocks nothing. */}
        {d.recentContacts?.length ? <div className="aifu-notice warn" role="status" data-testid="aifu-d-recent">{tx('aifu.recent.title', { n: d.recentContacts.length })}
          <ul className="sub" style={{ margin: '2px 0 0', paddingLeft: 18 }}>{d.recentContacts.map((r, i) => <li key={r.ref + i} data-testid="aifu-d-recent-row">
            {tx('aifu.recent.src.' + r.source)} · {fmt(r.at)} · {r.by ?? tx('aifu.none')}{r.source === 'ai_follow_up' && r.outcome ? ` · ${label('out', r.outcome)}` : ''}</li>)}</ul></div> : null}
        <div className="aifu-tabs" role="tablist">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={'btn' + (tab === t ? '' : ' ghost')} onClick={() => setTab(t)} data-testid={`aifu-tab-${t}`}>{tx(`aifu.tab.${t}`)}</button>)}</div>
        <div className="aifu-tabbody">
          {tab === 'overview' ? <div data-testid="aifu-p-overview">
            <dl className="aifu-dl">
              <dt>{tx('aifu.col.reason')}</dt><dd>{label('reason', o.reason)}</dd><dt>{tx('aifu.o.source')}</dt><dd>{o.createdBy}</dd>
              <dt>{tx('aifu.col.status')}</dt><dd>{label('st', o.status)}{o.resolutionCategory ? ` · ${label('res', o.resolutionCategory)}` : ''}</dd>
              <dt>{tx('aifu.col.due')}</dt><dd>{fmt(o.dueAt, o.dueTimeZone ?? undefined)}{o.overdue ? ` · ${tx('aifu.overdue')}` : ''}</dd>
              <dt>{tx('aifu.col.owner')}</dt><dd>{o.assignee?.name ?? tx('aifu.f.unassigned')}</dd><dt>{tx('aifu.o.description')}</dt><dd>{o.description ?? tx('aifu.none')}</dd>
              {o.resolution ? <><dt>{tx('aifu.o.resolution')}</dt><dd>{o.resolution}</dd></> : null}
              <dt>{tx('aifu.o.id')}</dt><dd className="sub">{o.id}</dd>
            </dl>
            {can?.canWork && active ? <EditBlock o={o} busy={busy} onSave={(b) => act(() => fa.edit(id, { ...b, version: v }), tx('aifu.done'))} /> : null}
            {can?.canWork ? <div className="aifu-acts">
              {active ? <label>{tx('aifu.c.assign')}<select value={o.assignee?.id ?? ''} disabled={busy} onChange={(e) => act(() => fa.assign(id, { assignedUserId: e.target.value || null, version: v }), tx('aifu.done'))} data-testid="aifu-d-assign"><option value="">{tx('aifu.f.unassigned')}</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label> : null}
              {active && rec && !o.assignee ? <div className="sub" data-testid="aifu-d-recommend">{tx('aifu.recommend', { name: rec.name })} <button className="link" disabled={busy} onClick={() => act(() => fa.assign(id, { assignedUserId: rec.userId, version: v }), tx('aifu.done'))} data-testid="aifu-d-recommend-assign">{tx('aifu.assignThem')}</button></div> : null}
              <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={tx('aifu.notePh')} data-testid="aifu-d-note" />
              <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={tx('aifu.reasonPh')} data-testid="aifu-d-reason" />
              <div className="aifu-row-btns">
                {['open', 'assigned', 'waiting'].includes(o.status) ? <button className="btn" disabled={busy} onClick={() => act(() => fa.status(id, { to: 'in_progress', version: v, note: form.note || null }), tx('aifu.done'))} data-testid="aifu-d-start">{tx('aifu.start')}</button> : null}
                {o.status === 'in_progress' ? <button className="btn ghost" disabled={busy} onClick={() => act(() => fa.status(id, { to: 'waiting', version: v, note: form.note || null }), tx('aifu.done'))} data-testid="aifu-d-wait">{tx('aifu.wait')}</button> : null}
                <button className="btn ghost" disabled={busy || form.note.trim().length < 2} onClick={() => act(() => fa.note(id, { note: form.note, version: v }).then(() => setForm({ ...form, note: '' })), tx('aifu.done'))} data-testid="aifu-d-addnote">{tx('aifu.addNote')}</button>
                {active ? <button className="btn ghost" disabled={busy || form.reason.trim().length < 3} onClick={() => act(() => fa.priority(id, { escalate: true, reason: form.reason, version: v }), tx('aifu.done'))} data-testid="aifu-d-escalate">{tx('aifu.escalate')}</button> : null}
                {!active ? <button className="btn ghost" disabled={busy || form.reason.trim().length < 3} onClick={() => act(() => fa.status(id, { to: 'in_progress', version: v, reason: form.reason }), tx('aifu.done'))} data-testid="aifu-d-reopen">{tx('aifu.reopen')}</button> : null}
              </div>
              {active ? <div className="aifu-row-btns"><select value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} aria-label={tx('aifu.o.resolution')} data-testid="aifu-d-rescat">{RESOLUTIONS.map((r) => <option key={r} value={r}>{label('res', r)}</option>)}</select>
                <button className="btn" disabled={busy} onClick={() => act(() => fa.status(id, { to: 'resolved', version: v, resolutionCategory: form.resolution, note: form.note || null }), tx('aifu.done'))} data-testid="aifu-d-resolve">{tx('aifu.resolve')}</button></div> : null}
              {can?.canManage && active ? <div className="aifu-row-btns"><span className="sub">{tx('aifu.override')}</span>{PRIOS.map((p) => <button key={p} className="btn ghost" disabled={busy || p === o.priority || form.reason.trim().length < 3} onClick={() => act(() => fa.priority(id, { priority: p, reason: form.reason, version: v }), tx('aifu.done'))}>{label('prio', p)}</button>)}</div> : null}
            </div> : <div className="sub">{tx('aifu.viewOnly')}</div>}
          </div> : null}
          {tab === 'timeline' ? <div data-testid="aifu-p-timeline">{d.timeline?.length ? <table className="tbl"><thead><tr><th>{tx('aifu.at.when')}</th><th>{tx('aifu.tl.what')}</th><th>{tx('aifu.at.by')}</th></tr></thead>
            <tbody>{d.timeline.map((e, i) => <tr key={e.kind + e.at + i} data-testid="aifu-tl-row"><td>{fmt(e.at)}</td><td><span className="chip">{tx('aifu.tl.k.' + e.kind)}</span> {e.kind === 'attempt' ? `${label('ch', e.type)} · ${label('out', e.detail)}`
              : e.kind === 'handoff' ? codeLabel('aifu.hk.' + e.type, e.type) : e.kind === 'task' ? codeLabel('aifu.ev.' + e.type, e.type) : e.kind === 'booking' ? `${tx('aifu.tl.booking')}${e.detail ? ' · ' + codeLabel('aifu.bst.' + e.detail, e.detail) : ''}` : tx('aifu.tl.call.' + e.type)}</td><td>{e.actor ?? tx('aifu.system')}</td></tr>)}</tbody></table>
            : <div className="sub">{tx('aifu.tl.empty')}</div>}</div> : null}
          {tab === 'customer' ? <div data-testid="aifu-p-customer"><dl className="aifu-dl">
            <dt>{tx('aifu.col.customer')}</dt><dd>{d.customer.name ?? `${tx('aifu.unmatchedCaller')} (${label('match', d.customer.match ?? 'unmatched')})`}</dd>
            <dt>{tx('aifu.cu.phone')}</dt><dd>{d.customer.phone ?? tx('aifu.none')}{d.customer.smsOptedOut ? ` · ${tx('aifu.optedOut')}` : ''}</dd>
            {d.customer.sharedPhoneProfiles > 1 ? <><dt>{tx('aifu.sharedPhone')}</dt><dd>{tx('aifu.sharedNote', { n: d.customer.sharedPhoneProfiles })}</dd></> : null}
            {d.customer.email !== undefined ? <><dt>{tx('aifu.cu.email')}</dt><dd>{d.customer.email ?? tx('aifu.none')}</dd></> : null}
            {d.customer.completedVisits !== undefined ? <><dt>{tx('aifu.cu.visits')}</dt><dd>{d.customer.completedVisits}</dd></> : null}
            <dt>{tx('aifu.cu.upcoming')}</dt><dd>{d.customer.upcoming?.length ? d.customer.upcoming.map((u) => `${u.date} ${u.start}`).join(' · ') : tx('aifu.none')}</dd></dl></div> : null}
          {tab === 'call' ? <div data-testid="aifu-p-call">{d.call ? <dl className="aifu-dl">
            <dt>{tx('aifu.ca.id')}</dt><dd className="sub">{d.call.providerCallId}</dd><dt>{tx('aifu.ca.when')}</dt><dd>{fmt(d.call.startedAt)}{d.call.durationSeconds != null ? ` · ${d.call.durationSeconds}s` : ''}</dd>
            <dt>{tx('aifu.ca.transfer')}</dt><dd data-testid="aifu-ca-transfer">{label('tr', d.call.transfer)}</dd><dt>{tx('aifu.ca.summary')}</dt><dd>{d.call.summary ?? tx('aifu.none')}</dd>
            <dt>{tx('aifu.ca.handoffs')}</dt><dd>{d.call.handoffs.map((h) => `${label('hk', h.kind)} (${fmt(h.at)})`).join(' · ') || tx('aifu.none')}</dd></dl> : <div className="sub">{tx('aifu.noCall')}</div>}</div> : null}
          {tab === 'attempts' ? <div data-testid="aifu-p-attempts">
            {d.lastContact ? <dl className="aifu-dl" data-testid="aifu-lastcontact">
              <dt>{tx('aifu.lc.attempted')}</dt><dd data-testid="aifu-lc-counts">{tx('aifu.lc.counts', { a: d.lastContact.attempted, r: d.lastContact.reached })}</dd>
              <dt>{tx('aifu.lc.lastAttempt')}</dt><dd>{d.lastContact.lastAttempt ? `${fmt(d.lastContact.lastAttempt.at)} · ${label('ch', d.lastContact.lastAttempt.channel)} · ${label('out', d.lastContact.lastAttempt.outcome)}${d.lastContact.lastAttempt.attestation ? ` · ${tx('aifu.attestation')}` : ''}` : tx('aifu.none')}</dd>
              <dt>{tx('aifu.lc.lastReached')}</dt><dd>{d.lastContact.lastReached ? `${fmt(d.lastContact.lastReached.at)} · ${label('ch', d.lastContact.lastReached.channel)}` : tx('aifu.lc.neverReached')}</dd>
              <dt>{tx('aifu.lc.texts')}</dt><dd data-testid="aifu-lc-texts">{tx('aifu.lc.textCounts', { t: d.lastContact.texts.total, s: d.lastContact.texts.submitted, p: d.lastContact.texts.providerAccepted, d: d.lastContact.texts.delivered, f: d.lastContact.texts.failed })}</dd>
              <dt>{tx('aifu.lc.verified')}</dt><dd data-testid="aifu-lc-verified">{d.lastContact.lastVerified ? `${fmt(d.lastContact.lastVerified.at)} · ${label('ch', d.lastContact.lastVerified.channel)} · ${label('out', d.lastContact.lastVerified.outcome)}` : tx('aifu.lc.noneVerified')}</dd>
            </dl> : null}
            {d.attempts.length ? <table className="tbl"><thead><tr><th>{tx('aifu.at.when')}</th><th>{tx('aifu.at.channel')}</th><th>{tx('aifu.at.outcome')}</th><th>{tx('aifu.at.by')}</th></tr></thead>
              <tbody>{d.attempts.map((a) => <tr key={a.id} data-testid="aifu-attempt"><td>{fmt(a.at)}</td><td>{label('ch', a.channel)}</td><td>{label('out', a.outcome)}{a.attestation ? <div className="sub">{tx('aifu.attestation')}</div> : null}</td><td>{a.recordedBy ?? tx('aifu.none')}{a.note ? <div className="sub">{a.note}</div> : null}</td></tr>)}</tbody></table> : <div className="sub">{tx('aifu.noAttempts')}</div>}
            {can?.canWork && active ? <div className="aifu-acts">
              <div className="aifu-row-btns"><select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} data-testid="aifu-at-channel">{['phone_call', 'in_person', 'email'].map((c) => <option key={c} value={c}>{label('ch', c)}</option>)}</select>
                <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} data-testid="aifu-at-outcome">{OUTCOMES.map((x) => <option key={x} value={x}>{label('out', x)}</option>)}</select>
                <button className="btn" disabled={busy} onClick={() => act(() => fa.attempt(id, { channel: form.channel, outcome: form.outcome, note: form.note || null, idempotencyKey: key() }), tx('aifu.done'))} data-testid="aifu-at-record">{tx('aifu.recordAttempt')}</button></div>
              {can.canText ? <div className="aifu-text">
                <textarea value={form.text} maxLength={640} onChange={(e) => { setForm({ ...form, text: e.target.value }); setPrep(null); }} placeholder={tx('aifu.textPh')} data-testid="aifu-tx-body" />
                {can.canManage ? <input value={form.override} onChange={(e) => setForm({ ...form, override: e.target.value })} placeholder={tx('aifu.overridePh')} /> : null}
                {!prep ? <button className="btn ghost" disabled={busy || form.text.trim().length < 2} onClick={() => act(() => fa.prepareText(id, { body: form.text, overrideReason: form.override || null }).then((p) => { setPrep(p); setTextKey(key()); }))} data-testid="aifu-tx-prepare">{tx('aifu.prepareText')}</button>
                  : <div className="aifu-prep" data-testid="aifu-tx-preview">
                      {prep.blocked.length ? <div className="err">{prep.blocked.join(' ')}</div> : <><div>{tx('aifu.previewTo', { to: String((prep.proposed as { to?: unknown } | null)?.to ?? '') })}</div><div className="aifu-bubble">{form.text}</div>{[...prep.warnings, ...prep.notices].map((w) => <div key={w} className="sub">{w}</div>)}
                        <button className="btn" disabled={busy || !prep.token} onClick={() => act(() => fa.confirmText(id, { body: form.text, token: prep.token!, idempotencyKey: textKey, overrideReason: form.override || null }).then((r) => { setPrep(null); setForm({ ...form, text: '' }); setMsg(tx('aifu.textResult', { state: label('out', r.state) })); }))} data-testid="aifu-tx-confirm">{tx('aifu.confirmText')}</button></>}
                      <button className="btn ghost" onClick={() => setPrep(null)}>{tx('aifu.cancel')}</button></div>}
              </div> : null}
            </div> : null}
          </div> : null}
          {tab === 'booking' ? <div data-testid="aifu-p-booking"><dl className="aifu-dl">
            <dt>{tx('aifu.b.linked')}</dt><dd>{d.booking.linked ? `${d.booking.linked.date} ${d.booking.linked.start} · ${d.booking.linked.status}` : tx('aifu.none')}</dd>
            <dt>{tx('aifu.cu.upcoming')}</dt><dd>{d.booking.upcoming}</dd>
            <dt>{tx('aifu.b.messages')}</dt><dd>{d.attempts.filter((a) => a.channel === 'sms').map((a) => `${fmt(a.at)} · ${label('out', a.outcome)}`).join(' · ') || tx('aifu.none')}</dd></dl>
            <div className="sub">{tx('aifu.bookingNote')}</div></div> : null}
          {tab === 'audit' ? <div data-testid="aifu-p-audit"><table className="tbl"><thead><tr><th>{tx('aifu.at.when')}</th><th>{tx('aifu.au.what')}</th><th>{tx('aifu.at.by')}</th></tr></thead>
            <tbody>{d.activity.map((a, i) => <tr key={i}><td>{fmt(a.at)}</td><td>{label('ev', a.type)}{a.from || a.to ? ` · ${a.from ?? ''} → ${a.to ?? ''}` : ''}{a.note ? <div className="sub">{a.note}</div> : null}</td><td>{a.actor ?? tx('aifu.system')}</td></tr>)}</tbody></table></div> : null}
        </div>
      </>}
    </FitDialog>
  );
}

/** edit description / due time (salon-local) of an open task; sends the row version so a newer change is never overwritten */
function EditBlock({ o, busy, onSave }: { o: { description: string | null; dueAt: string | null; dueTimeZone?: string | null }; busy: boolean; onSave: (b: { description?: string; dueLocal?: string | null }) => void }) {
  const toLocal = (s: string | null, tz?: string | null) => {
    if (!s) return '';
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(s)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState(o.description ?? ''); const [due, setDue] = useState(toLocal(o.dueAt, o.dueTimeZone));
  if (!open) return <button className="btn ghost" onClick={() => { setDesc(o.description ?? ''); setDue(toLocal(o.dueAt, o.dueTimeZone)); setOpen(true); }} data-testid="aifu-d-edit">{tx('aifu.edit')}</button>;
  const changes: { description?: string; dueLocal?: string | null } = {};
  if (desc.trim() !== (o.description ?? '')) changes.description = desc.trim();
  if (due !== toLocal(o.dueAt, o.dueTimeZone)) changes.dueLocal = due || null;
  const none = Object.keys(changes).length === 0;
  return (
    <div className="aifu-acts" data-testid="aifu-edit">
      <label>{tx('aifu.c.description')}<textarea value={desc} maxLength={1000} onChange={(e) => setDesc(e.target.value)} data-testid="aifu-e-desc" /></label>
      <label>{tx('aifu.c.due')}<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} data-testid="aifu-e-due" /></label>
      <div className="aifu-row-btns">
        <button className="btn" disabled={busy || none || (changes.description !== undefined && changes.description.length < 3)} onClick={() => { onSave(changes); setOpen(false); }} data-testid="aifu-e-save">{tx('aifu.save')}</button>
        <button className="btn ghost" onClick={() => setOpen(false)}>{tx('aifu.cancel')}</button>
      </div>
    </div>
  );
}

/** round 10 (AI Follow Ups 06): hand every open follow-up of mine to one colleague at shift change (server: same rules as a
 *  reassignment, one alert to them, an activity + audit row per task) */
function HandoverDialog({ staff, onClose, onDone }: { staff: { id: string; name: string }[]; onClose: () => void; onDone: (moved: number) => void }) {
  const [to, setTo] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const go = async () => { setBusy(true); setErr(null); try { const r = await fa.handover({ toUserId: to, note }); onDone(r.moved); } catch (e) { setErr(errorTextOf(e, tx('aifu.saveFailed'))); } finally { setBusy(false); } };
  return (
    <FitDialog title={tx('aifu.ho.title')} subtitle={tx('aifu.ho.sub')} onClose={onClose} busy={busy} testId="aifu-ho"
      footer={<><button className="btn ghost" onClick={onClose}>{tx('aifu.cancel')}</button><button className="btn" disabled={busy || !to || note.trim().length < 3} onClick={go} data-testid="aifu-ho-go">{tx('aifu.ho.go')}</button></>}>
      {err ? <div className="err" data-testid="aifu-ho-err">{err}</div> : null}
      <label>{tx('aifu.ho.to')}<select value={to} onChange={(e) => setTo(e.target.value)} data-testid="aifu-ho-to"><option value="">{tx('aifu.ho.choose')}</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label>{tx('aifu.ho.note')}<textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} data-testid="aifu-ho-note" /></label>
    </FitDialog>
  );
}

/** round 10 (AI Follow Ups 02): this location's overdue-callback manager alert — on/off and minutes of grace after the due
 *  time. Read by anyone who sees follow-ups; saved by an owner / manager (the server refuses others and audits the change). */
function AlertSettingsDialog({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState<{ enabled: boolean; graceMinutes: number; scope: string } | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  useEffect(() => { fa.alertSettings().then(setV).catch((e) => setErr(errorTextOf(e, tx('aifu.loadFailed')))); }, []);
  const save = async () => { if (!v) return; setBusy(true); setErr(null); setSaved(false); try { setV(await fa.saveAlertSettings({ enabled: v.enabled, graceMinutes: v.graceMinutes })); setSaved(true); } catch (e) { setErr(errorTextOf(e, tx('aifu.saveFailed'))); } finally { setBusy(false); } };
  return (
    <FitDialog title={tx('aifu.al.title')} subtitle={tx('aifu.al.sub')} onClose={onClose} busy={busy} testId="aifu-al"
      footer={<><button className="btn ghost" onClick={onClose}>{tx('aifu.close')}</button><button className="btn" disabled={busy || !v} onClick={save} data-testid="aifu-al-save">{tx('aifu.al.save')}</button></>}>
      {err ? <div className="err" data-testid="aifu-al-err">{err}</div> : null}
      {saved ? <div className="aifu-notice" role="status" data-testid="aifu-al-saved">{tx('aifu.done')}</div> : null}
      {!v ? (err ? null : <div className="state">{tx('aifu.loading')}</div>) : <>
        <label><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} data-testid="aifu-al-on" /> {tx('aifu.al.on')}</label>
        <label>{tx('aifu.al.grace')}<input type="number" min={0} max={1440} step={5} value={v.graceMinutes} disabled={!v.enabled} onChange={(e) => setV({ ...v, graceMinutes: Math.max(0, Math.min(1440, Math.trunc(Number(e.target.value) || 0))) })} data-testid="aifu-al-grace" /></label>
        <div className="sub" data-testid="aifu-al-scope">{tx('aifu.al.scope.' + v.scope)}</div>
      </>}
    </FitDialog>
  );
}

