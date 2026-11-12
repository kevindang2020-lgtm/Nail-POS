// POSFollowUpsScreen.tsx — Communications → Follow-Up Queue (/follow-ups), rebuilt in place (Follow-Up Queue Complete
// Build Guide, Oct 30 2026). Keeps the five counters, the date, the status tabs, Generate Now and the task list, and adds:
// server search, filters, an explicit date basis with a month From/To calendar, numbered pages (10/20/50), the
// operational order (due → priority → completed) vs newest-first history, task details with the message preview, a
// contact check, Send / Approve / Skip-with-reason / Retry / Return, Open Customer and Book Appointment, the Missed Call
// type (its own source), health and results. Every write goes through the existing server send path.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posFollowUpQueueApi as qa, type FollowUpQueueKpis, type FollowUpQueueRow, type QueuePage, type FollowUpQueueQuery, type ContactCheck, type MissedCallRow, type QueueResults, type CustomerFollowUp, type GenerateOutcome, type FollowUpPriorityReason } from '../api/posFollowUpQueueApi';
import { posEodFollowUpsApi as eod, type EodTaskDetail, type EodHealthRow, type EodHealthState } from '../api/posEodFollowUpsApi';
import { posFollowUpApi, type FollowUpTaskView } from '../api/posFollowUpApi';
import { posCustomerNotificationsApi as cnApi, type CnTimelineItem } from '../api/posCustomerNotificationsApi';
import { statusLabel } from '../i18n/status-label';
import { FollowUpTechnicianSummary } from '../components/FollowUpTechnicianSummary';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { money } from './reportsCommon';
import { errorTextOf } from '../i18n/error-text';
import { useRealtime } from '../realtime/useRealtime';
import { deviceToday } from '../lib/deviceToday';

/** Extras (Follow-Up Queue row 11): the contact cooldown window shown in the task details */
const COOLDOWN_TIMELINE_DAYS = 14;
const NOT_SENT = new Set(['pending', 'pending_manager_approval', 'skipped', 'expired', 'rejected', 'cancelled', 'canceled']);
/** what actually went OUT to this customer recently, across every tool that writes the customer timeline (SMS / email ledger,
 *  reminders, receipts, follow-ups) — unsent follow-up drafts and this task itself are not "contact" */
function recentContact(items: readonly CnTimelineItem[], taskId: string, nowMs: number): CnTimelineItem[] {
  const since = nowMs - COOLDOWN_TIMELINE_DAYS * 86_400_000;
  return items.filter((it) => it.direction === 'outbound' && it.id !== taskId && !!it.at && Date.parse(it.at) >= since && !(it.kind === 'follow_up' && NOT_SENT.has(it.status)));
}
const when = (iso: string | null | undefined, tz?: string) => (iso ? new Date(iso).toLocaleString(undefined, { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const stText = (s: string) => tx(`eod.st.${s}`);
const errText = (e: unknown) => errorTextOf(e, tx('fuq.loadError'));
const SKIP_REASONS = ['customer_declined', 'contacted_another_way', 'already_booked', 'no_follow_up_needed', 'wrong_customer', 'other'] as const;
type Filters = { view: 'queue' | 'history'; status: string; technicianId: string; priority: string; due: string; basis: string; from?: string; to?: string; page: number; pageSize: number };
const DEFAULTS: Filters = { view: 'queue', status: '', technicianId: '', priority: '', due: '', basis: 'due', page: 1, pageSize: 20 };

function ymdAdd(ymd: string, days: number) { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function presetRange(p: string, today: string): { from: string; to: string } {
  if (p === 'week') { const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); return { from: ymdAdd(today, -((dow + 6) % 7)), to: today }; }
  if (p === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (p === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: today, to: today };
}
// non-sensitive view state only (guide §06): no phone numbers, no message text in the URL
function readUrl(): Partial<Filters> & { type?: string } {
  try {
    const u = new URLSearchParams(window.location.search); const o: Partial<Filters> & { type?: string } = {};
    for (const k of ['status', 'technicianId', 'priority', 'due', 'basis', 'from', 'to'] as const) { const v = u.get(k); if (v) (o as Record<string, string>)[k] = v; }
    const v = u.get('view'); if (v === 'history' || v === 'queue') o.view = v;
    const tp = u.get('type'); if (tp === 'missed_call') o.type = tp;
    return o;
  } catch { return {}; }
}

export function POSFollowUpsScreen() {
  const nav = useNavigate();
  const fromUrl = useMemo(readUrl, []);
  const [type, setType] = useState<'after_service' | 'missed_call'>(fromUrl.type === 'missed_call' ? 'missed_call' : 'after_service');
  const [filters, setFilters] = useState<Filters>({ ...DEFAULTS, ...fromUrl });
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const [kpis, setKpis] = useState<FollowUpQueueKpis | null>(null);
  const [kpiErr, setKpiErr] = useState<unknown>(null);
  const [rows, setRows] = useState<(QueuePage<FollowUpQueueRow> & { view: string; basis: string }) | null>(null);
  const [missed, setMissed] = useState<QueuePage<MissedCallRow> | null>(null);
  const [mcState, setMcState] = useState('');
  const [listErr, setListErr] = useState<unknown>(null);
  const [health, setHealth] = useState<{ overall: EodHealthState; rows: EodHealthRow[] } | null>(null);
  const [results, setResults] = useState<QueueResults | null>(null);
  const [techs, setTechs] = useState<{ id: string; name: string }[]>([]);
  const [todayTasks, setTodayTasks] = useState<FollowUpTaskView[]>([]);
  const [calOpen, setCalOpen] = useState(false);
  const [gen, setGen] = useState<GenerateOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const today = kpis?.date ?? deviceToday();
  const tz = kpis?.timezone;
  const setF = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p, page: 'page' in p ? p.page! : 1 }));

  useEffect(() => {
    try {
      const u = new URLSearchParams();
      if (type === 'missed_call') u.set('type', type);
      for (const [k, v] of Object.entries(filters)) if (v && !['page', 'pageSize'].includes(k) && !(k === 'view' && v === 'queue') && !(k === 'basis' && v === 'due')) u.set(k, String(v));
      const s = u.toString(); window.history.replaceState(null, '', `${window.location.pathname}${s ? `?${s}` : ''}`);
    } catch { /* URL state is a convenience only */ }
  }, [filters, type]);

  const loadKpis = useCallback(async () => { try { setKpis(await qa.kpis()); setKpiErr(null); } catch (e) { setKpiErr(e); } }, []);
  const loadList = useCallback(async () => {
    try {
      if (type === 'missed_call') { setMissed(await qa.missedCalls({ q: q || undefined, from: filters.from, to: filters.to, state: mcState || undefined, page: filters.page, pageSize: filters.pageSize })); }
      else {
        const f: FollowUpQueueQuery = { ...filters, q: q || undefined };
        const r = await qa.tasks(f); setRows(r);
        setTechs((cur) => { const m = new Map(cur.map((x) => [x.id, x.name])); for (const i of r.items) m.set(i.technicianId, i.technicianName); return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)); });
      }
      setListErr(null);
    } catch (e) { setListErr(e); }
  }, [type, filters, q, mcState]);
  const loadSide = useCallback(async () => {
    const r = presetRange('month', today);
    const [h, res, day] = await Promise.allSettled([eod.health(), qa.results({ from: filters.from ?? r.from, to: filters.to ?? r.to, technicianId: filters.technicianId || undefined }), posFollowUpApi.list({ date: today })]);
    if (h.status === 'fulfilled') setHealth(h.value);
    if (day.status === 'fulfilled') setTodayTasks(day.value.tasks ?? []);
    if (res.status === 'fulfilled') {
      setResults(res.value);
      setTechs((cur) => { const m = new Map(cur.map((x) => [x.id, x.name])); for (const t of res.value.byTechnician) m.set(t.technicianId, t.name); return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)); });
    }
  }, [today, filters.from, filters.to, filters.technicianId]);
  useEffect(() => { void loadKpis(); }, [loadKpis]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { void loadSide(); }, [loadSide]);
  const refresh = useCallback(() => { void loadKpis(); void loadList(); void loadSide(); }, [loadKpis, loadList, loadSide]);
  useRealtime('follow-ups', refresh);

  const generate = async () => {
    setBusy(true); setNote(null);
    try { const g = await qa.generate(); setGen(g); setFilters((f) => ({ ...f, page: 1 })); refresh(); }
    catch (e) { setNote(errText(e)); } finally { setBusy(false); }
  };

  const anyFilter = !!(q || filters.status || filters.technicianId || filters.priority || filters.due || filters.from || mcState || filters.basis !== 'due' || filters.view !== 'queue');
  const clearAll = () => { setSearch(''); setMcState(''); setFilters({ ...DEFAULTS, pageSize: filters.pageSize }); };
  const pageInfo = type === 'missed_call'
    ? (missed ? { page: missed.page, pageSize: missed.pageSize, totalItems: missed.total, totalPages: missed.totalPages } : null)
    : (rows ? { page: rows.page, pageSize: rows.pageSize, totalItems: rows.total, totalPages: rows.totalPages } : null);
  const kv = (n: number | undefined) => (kpiErr ? tx('fuq.unknown') : kpis ? String(n ?? 0) : '…');

  return (
    <div className="work" data-testid="fuq-screen">
      <div className="eod-head">
        <div className="vh"><h1>{tx('fuq.title')}</h1><div className="sub">{tx('fuq.sub')}</div></div>
        <div className="eod-head-actions">
          <button type="button" className="btn ghost" onClick={refresh} data-testid="fuq-refresh">{tx('fuq.refresh')}</button>
          <button type="button" className="btn ghost" onClick={() => nav('/settings/follow-ups')}>{tx('fuq.settings')}</button>
          <button type="button" className="btn" disabled={busy} onClick={generate} data-testid="fuq-generate">{busy ? tx('fuq.generating') : tx('fuq.generate')}</button>
        </div>
      </div>

      <div className="fuq-kpis" data-testid="fuq-kpis">
        <KpiCard label={tx('fuq.kpi.pending')} value={kv(kpis?.pending)} sub={kpis ? tx('fuq.kpi.pendingSub', { n: String(kpis.awaitingApproval) }) : undefined} tone={(kpis?.pending ?? 0) > 0 ? 'warn' : undefined} testId="fuq-kpi-pending" onClick={() => { setType('after_service'); setF({ view: 'queue', status: 'unsent' }); }} />
        <KpiCard label={tx('fuq.kpi.sent')} value={kv(kpis?.sent)} sub={tx('fuq.kpi.sentSub')} testId="fuq-kpi-sent" onClick={() => { setType('after_service'); setF({ view: 'history', status: 'sent' }); }} />
        <KpiCard label={tx('fuq.kpi.skipped')} value={kv(kpis?.skipped)} sub={kpis ? tx('fuq.kpi.skippedSub', { n: String(kpis.expired) }) : undefined} testId="fuq-kpi-skipped" onClick={() => { setType('after_service'); setF({ view: 'history', status: 'skipped' }); }} />
        <KpiCard label={tx('fuq.kpi.rebooked')} value={kv(kpis?.rebooked)} sub={tx('fuq.kpi.rebookedSub')} tone="ok" testId="fuq-kpi-rebooked" onClick={() => { setType('after_service'); setF({ view: 'history', status: 'rebooked' }); }} />
        <KpiCard label={tx('fuq.kpi.total')} value={kv(kpis?.total)} sub={kpis ? tx('fuq.kpi.totalSub', { date: kpis.date }) : undefined} testId="fuq-kpi-total" />
      </div>
      <div className="s fuq-basis" data-testid="fuq-basis">
        {kpiErr ? <span className="err">{tx('fuq.kpi.error')}</span> : kpis ? <>
          {tx('fuq.kpi.basis', { date: kpis.date, tz: kpis.timezone })} · {tx('fuq.kpi.extra', { overdue: String(kpis.overdueEarlier), missed: String(kpis.missedCalls) })} · {tx('fuq.updated', { time: when(kpis.updatedAt, tz) })}
        </> : null}
      </div>

      {note ? <div className="err" role="alert">{note}</div> : null}
      {gen ? (
        <section className="panel fuq-gen" data-testid="fuq-gen-result" role="status">
          <div className="eod-panel-head"><b>{tx('fuq.gen.title')}</b><button type="button" className="btn ghost sm" onClick={() => setGen(null)}>{tx('fuq.a.close')}</button></div>
          {gen.summary ? <>
            {gen.summary.failed ? <div className="err">{tx('fuq.gen.failed', { error: gen.summary.error ?? '—' })}</div> : null}
            {gen.summary.eligible === 0 ? <div className="s">{tx('fuq.gen.none', { date: gen.summary.businessDate })}</div>
              : <div className="s" data-testid="fuq-gen-line">{tx('fuq.gen.line', { date: gen.summary.businessDate, eligible: String(gen.summary.eligible), created: String(gen.summary.created), existing: String(gen.summary.alreadyExisted), total: String(gen.summary.createdToday) })}</div>}
            {Object.values(gen.summary.skippedByReason).some((n) => n > 0) ? <div className="s">{tx('fuq.gen.skipped', { list: Object.entries(gen.summary.skippedByReason).filter(([, n]) => n > 0).map(([k, n]) => `${tx(`eod.why.${k}`)} ${n}`).join(' · ') })}</div> : null}
          </> : <div className="s">{tx('fuq.gen.none', { date: gen.result.businessDate })}</div>}
          <div className="s">{tx('fuq.gen.note')}</div>
        </section>
      ) : null}

      <section className="panel" data-testid="fuq-list">
        <div className="fuq-tabs" role="tablist">
          {(['after_service', 'missed_call'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={type === k} className={'btn' + (type === k ? '' : ' ghost')} onClick={() => { setType(k); setF({}); }} data-testid={`fuq-type-${k}`}>{tx(`fuq.type.${k}`)}</button>))}
          {type === 'after_service' ? (['queue', 'history'] as const).map((v) => (
            <button key={v} type="button" className={'btn sm' + (filters.view === v ? '' : ' ghost')} onClick={() => setF({ view: v, basis: v === 'queue' ? 'due' : 'created' })} data-testid={`fuq-view-${v}`}>{tx(`fuq.view.${v}`)}</button>)) : null}
        </div>
        {/* Follow-Up Queue guide + SUNMI addendum §03 (Nov 7 2026): the original status tabs All / Pending / Sent / Skipped stay as
            tabs (the same filters the KPI cards apply); the select beside the search keeps the full status list */}
        {type === 'after_service' ? <div className="fk-seg fuq-status-tabs" role="tablist" aria-label={tx('fuq.f.status')} data-testid="fuq-status-tabs">
          {([['', 'fuq.f.allStatuses', null], ['unsent', 'fuq.kpi.pending', 'queue'], ['sent', 'fuq.kpi.sent', 'history'], ['skipped', 'fuq.kpi.skipped', 'history']] as const).map(([v, label, view]) => (
            <button key={v || 'all'} type="button" role="tab" aria-selected={filters.status === v} className={filters.status === v ? 'on' : ''}
              onClick={() => setF(view ? { view, status: v, basis: view === 'queue' ? 'due' : 'created' } : { status: v })} data-testid={`fuq-tab-${v || 'all'}`}>{tx(label)}</button>))}
        </div> : null}
        <div className="eod-filters">
          <input className="fk-input eod-search" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setF({}); }} placeholder={tx('fuq.searchPh')} aria-label={tx('fuq.searchPh')} data-testid="fuq-search" />
          {type === 'after_service' ? <>
            <select className="fk-select" aria-label={tx('fuq.f.status')} value={filters.status} onChange={(e) => setF({ status: e.target.value })} data-testid="fuq-f-status">
              <option value="">{tx('fuq.f.allStatuses')}</option>
              {['unsent', 'sent', 'skipped', 'closed', 'rebooked'].map((v) => <option key={v} value={v}>{tx(`fuq.f.${v}`)}</option>)}
              {['pending', 'pending_manager_approval', 'rejected', 'expired', 'customer_not_available'].map((v) => <option key={v} value={v}>{stText(v)}</option>)}
            </select>
            <select className="fk-select" aria-label={tx('fuq.f.tech')} value={filters.technicianId} onChange={(e) => setF({ technicianId: e.target.value })} data-testid="fuq-f-tech">
              <option value="">{tx('fuq.f.allTechs')}</option>{techs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select className="fk-select" aria-label={tx('fuq.f.priority')} value={filters.priority} onChange={(e) => setF({ priority: e.target.value })} data-testid="fuq-f-priority">
              <option value="">{tx('fuq.f.anyPriority')}</option>{['high', 'normal', 'low'].map((v) => <option key={v} value={v}>{tx(`fuq.pr.${v}`)}</option>)}
            </select>
            <select className="fk-select" aria-label={tx('fuq.f.due')} value={filters.due} onChange={(e) => setF({ due: e.target.value })} data-testid="fuq-f-due">
              <option value="">{tx('fuq.f.anyDue')}</option>{['overdue', 'due_today', 'upcoming'].map((v) => <option key={v} value={v}>{tx(`fuq.f.${v}`)}</option>)}
            </select>
            <select className="fk-select" aria-label={tx('fuq.f.basis')} value={filters.basis} onChange={(e) => setF({ basis: e.target.value })} data-testid="fuq-f-basis">
              {['created', 'due', 'sent', 'last_visit', 'rebooked'].map((v) => <option key={v} value={v}>{tx(`fuq.basis.${v}`)}</option>)}
            </select>
          </> : (
            <select className="fk-select" aria-label={tx('fuq.f.state')} value={mcState} onChange={(e) => { setMcState(e.target.value); setF({}); }} data-testid="fuq-f-mcstate">
              <option value="">{tx('fuq.f.anyState')}</option>{['awaiting_callback', 'replied', 'recovered'].map((v) => <option key={v} value={v}>{tx(`fuq.mc.${v}`)}</option>)}
            </select>
          )}
          <div className="fuq-presets">
            {(['today', 'week', 'month', 'year'] as const).map((p) => <button key={p} type="button" className="btn ghost sm" onClick={() => setF(presetRange(p, today))} data-testid={`fuq-preset-${p}`}>{tx(`fuq.preset.${p}`)}</button>)}
            <span className="fuq-dates">
              <button type="button" className="btn ghost sm" aria-expanded={calOpen} onClick={() => setCalOpen((o) => !o)} data-testid="fuq-f-dates">{filters.from && filters.to ? `${filters.from} – ${filters.to}` : tx('fuq.preset.custom')}</button>
              {calOpen ? (
                <span data-testid="fuq-cal">
                  <RangeCalendar initial={{ from: filters.from, to: filters.to }} today={today}
                    onApply={(r) => { setF({ from: r.from, to: r.to }); setCalOpen(false); }} onCancel={() => setCalOpen(false)} onClear={() => { setF({ from: undefined, to: undefined }); setCalOpen(false); }} />
                </span>
              ) : null}
            </span>
          </div>
          {anyFilter ? <button type="button" className="btn ghost" onClick={clearAll} data-testid="fuq-f-clear">{tx('fuq.f.clear')}</button> : null}
        </div>
        {type === 'after_service' ? <FollowUpTechnicianSummary tasks={todayTasks} activeTech={filters.technicianId || undefined} onPick={(id) => setF({ technicianId: id ?? '' })} /> : null}
        {filters.from ? <div className="s" data-testid="fuq-basis-note">{tx('fuq.basisNote', { basis: type === 'missed_call' ? tx('fuq.col.time') : tx(`fuq.basis.${filters.basis}`) })} · {filters.from} – {filters.to}</div> : null}

        {listErr ? <ErrorRetry message={errText(listErr)} onRetry={loadList} />
          : type === 'missed_call' ? (
            <>
              <div className="s" style={{ margin: '4px 0' }}>{tx('fuq.mc.note')}</div>
              {!missed ? <div className="muted">…</div> : missed.items.length === 0 ? <Empty title={tx('fuq.emptyMissed')} /> : (
                <div className="eod-table-wrap"><table className="tbl" data-testid="fuq-mc-table">
                  <thead><tr><th>{tx('fuq.col.time')}</th><th>{tx('fuq.col.caller')}</th><th>{tx('fuq.col.callback')}</th><th>{tx('fuq.col.actions')}</th></tr></thead>
                  <tbody>{missed.items.map((m) => (
                    <tr key={m.id} data-testid="fuq-mc-row">
                      <td>{when(m.at, tz)}{m.aiHandled ? <div className="s">{tx('fuq.mc.ai')}</div> : null}</td>
                      <td><b>{m.customerName ?? tx('fuq.mc.unknownCaller')}</b>{m.callerLast4 ? <div className="s">•••{m.callerLast4}</div> : null}</td>
                      <td><span className={`eod-chip ${m.state === 'awaiting_callback' ? 'warn' : 'ok'}`}>{tx(`fuq.mc.${m.state}`)}</span></td>
                      <td className="fuq-actions">
                        <button type="button" className="btn ghost sm" onClick={() => nav('/tenant/communications/sms')}>{tx('fuq.a.inbox')}</button>
                        {m.customerId ? <button type="button" className="btn ghost sm" onClick={() => nav(`/booking/new?customerId=${encodeURIComponent(m.customerId!)}&from=follow-up-queue`)}>{tx('fuq.a.book')}</button> : null}
                      </td>
                    </tr>))}</tbody>
                </table></div>
              )}
            </>
          ) : !rows ? <div className="muted">…</div> : rows.items.length === 0 ? <Empty title={anyFilter ? tx('fuq.empty') : tx('fuq.emptyQueue')} /> : (
            <div className="eod-table-wrap"><table className="tbl" data-testid="fuq-table">
              <thead><tr><th>{tx('fuq.col.due')}</th><th>{tx('fuq.col.customer')}</th><th>{tx('fuq.col.tech')}</th><th>{tx('fuq.col.service')}</th><th>{tx('fuq.col.status')}</th><th>{tx('fuq.col.actions')}</th></tr></thead>
              <tbody>{rows.items.map((r) => (
                <tr key={r.id} data-testid="fuq-row">
                  <td>{r.dueDate}{r.overdue ? <span className="eod-chip bad fuq-od">{tx('fuq.overdue')}</span> : null}
                    <div><span className={`fuq-pr pr-${r.priority}`} title={r.priorityReasons.map((x) => reasonText(x, tz)).join(' · ') || tx('fuq.pr.none')} data-testid="fuq-row-priority">{tx(`fuq.pr.${r.priority}`)}</span></div></td>
                  <td><b>{r.customerName}</b>{r.customerPhoneLast4 ? <div className="s">•••{r.customerPhoneLast4}</div> : null}</td>
                  <td>{r.technicianName}</td>
                  <td>{r.serviceName}{r.ticketNumber ? <div className="s">#{r.ticketNumber}</div> : null}</td>
                  <td><span className={`eod-chip st-${r.status}`}>{stText(r.status)}</span>{r.reason ? <div className="s">{r.reason}</div> : null}</td>
                  <td><button type="button" className="btn ghost sm" onClick={() => setDetailId(r.id)} data-testid="fuq-row-details">{tx('fuq.details')}</button></td>
                </tr>))}</tbody>
            </table></div>
          )}
        <div className="eod-pagerow">
          <Pager info={pageInfo} onPage={(p) => setFilters((f) => ({ ...f, page: p }))} />
          <label className="s">{tx('fuq.f.rows')} <select className="fk-select" value={filters.pageSize} onChange={(e) => setF({ pageSize: Number(e.target.value) })} data-testid="fuq-f-rows">{[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        </div>
      </section>

      <div className="eod-grid">
        <section className="panel" data-testid="fuq-health">
          <h3 className="eod-h3">{tx('fuq.health')}</h3>
          {!health ? <div className="muted">…</div> : (
            <ul className="fuq-health">{health.rows.map((r) => (
              <li key={r.key}><span className={`eod-chip ${r.state === 'ready' ? 'ok' : r.state === 'failed' ? 'bad' : r.state === 'attention_required' ? 'warn' : ''}`}>{tx(`eod.state.${r.state}`)}</span> <b>{tx(`eod.hk.${r.key}`)}</b>
                <div className="s">{r.detail}</div></li>))}</ul>
          )}
        </section>
        <section className="panel" data-testid="fuq-results">
          <h3 className="eod-h3">{tx('fuq.results')}</h3>
          {!results ? <div className="muted">…</div> : <ResultsView r={results} />}
        </section>
      </div>

      {detailId ? <QueueDetail id={detailId} tz={tz} onClose={() => setDetailId(null)} onChanged={refresh}
        openCustomer={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)}
        book={(id) => nav(`/booking/new?customerId=${encodeURIComponent(id)}&from=follow-up-queue`)} /> : null}
    </div>
  );
}

function reasonText(r: FollowUpPriorityReason, tz?: string) {
  const base = tx(`fuq.pr.${r.code}`, { detail: r.detail ?? '' });
  return r.at ? `${base} (${when(r.at, tz)})` : base;
}

function ResultsView({ r }: { r: QueueResults }) {
  const f = r.funnel;
  const steps: [string, number][] = [['eligible', f.eligible], ['generated', f.generated], ['sent', f.sent], ['delivered', f.deliveredToApp], ['viewed', f.viewed], ['booked', f.bookedAfter], ['returned', f.returnVisits]];
  return (
    <div>
      <div className="s">{tx('fuq.r.range', { from: r.from, to: r.to })}</div>
      <div className="fuq-funnel" data-testid="fuq-funnel">{steps.map(([k, n]) => <div key={k} className="fuq-step"><div className="v">{n}</div><div className="s">{tx(`fuq.r.${k}`)}</div></div>)}</div>
      <div className="s" data-testid="fuq-revenue">{tx('fuq.r.revenue', { amount: money(r.associatedRevenueCents) })}</div>
      <div className="s fuq-caution">{tx('fuq.r.causation', { days: String(r.windowDays) })}</div>
      <div className="s">{tx('fuq.r.age', { a: String(r.queueAge.under1Day), b: String(r.queueAge.oneToThreeDays), c: String(r.queueAge.overThreeDays) })}</div>
      {r.byTechnician.length ? (
        <div className="eod-table-wrap" style={{ marginTop: 6 }}><table className="tbl">
          <thead><tr><th>{tx('fuq.r.col.tech')}</th><th>{tx('fuq.r.col.generated')}</th><th>{tx('fuq.r.col.sent')}</th><th>{tx('fuq.r.col.skipped')}</th><th>{tx('fuq.r.col.booked')}</th></tr></thead>
          <tbody>{r.byTechnician.map((t) => <tr key={t.technicianId}><td>{t.name}{t.smallSample ? <div className="s">{tx('fuq.r.small')}</div> : null}</td><td>{t.generated}</td><td>{t.sent}</td><td>{t.skipped}</td><td>{t.bookedAfter}</td></tr>)}</tbody>
        </table></div>
      ) : null}
      {r.skipReasons.length ? <div className="s" style={{ marginTop: 6 }}>{tx('fuq.r.reasons')}: {r.skipReasons.map((x) => `${x.reason} ${x.count}`).join(' · ')}</div> : null}
    </div>
  );
}

function QueueDetail({ id, tz, onClose, onChanged, openCustomer, book }: { id: string; tz?: string; onClose: () => void; onChanged: () => void; openCustomer: (id: string, name: string) => void; book: (id: string) => void }) {
  const [d, setD] = useState<EodTaskDetail | null>(null);
  const [cc, setCc] = useState<ContactCheck | null>(null);
  const [hist, setHist] = useState<QueuePage<CustomerFollowUp> | null>(null);
  const [recent, setRecent] = useState<CnTimelineItem[] | 'unavailable' | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState<string>(SKIP_REASONS[0]);
  const [rejectNote, setRejectNote] = useState('');
  const [needOverride, setNeedOverride] = useState(false);
  const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    try {
      const det = await eod.task(id); setD(det);
      const [c, h, tl] = await Promise.allSettled([qa.contactCheck(id), qa.customerHistory(det.customerId), cnApi.timeline(det.customerId, { channel: 'all', page: 1, pageSize: 50 })]);
      if (c.status === 'fulfilled') setCc(c.value);
      if (h.status === 'fulfilled') setHist(h.value);
      // read-only; a role without Communications access (or a failed read) says "not available" — never an empty "no contact"
      setRecent(tl.status === 'fulfilled' ? recentContact(tl.value.items ?? [], det.id, Date.now()) : 'unavailable');
      setErr(null);
    } catch (e) { setErr(e); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(tx('fuq.a.done')); setNeedOverride(false); setReason(''); await load(); onChanged(); }
    catch (e) { const code = (e as { code?: string })?.code; if (code === 'FOLLOWUP_ALREADY_BOOKED' || code === 'FOLLOWUP_RECENTLY_CONTACTED') setNeedOverride(true); setMsg(errorTextOf(e, tx('fuq.loadError'))); }
    finally { setBusy(false); }
  };
  const ov = needOverride && reason.trim().length >= 5 ? { reason: reason.trim() } : null;
  const unsent = d && ['pending', 'pending_manager_approval', 'rejected'].includes(d.status);
  const retryable = d?.status === 'customer_not_available' && d.customerHasApp;
  const blocked = cc ? cc.categories.some((c) => c === 'blocked' || c === 'already_sent' || c === 'missing_contact') : false;
  const body = d ? (d.sentMessage ?? d.draft) : '';
  const footer = d ? (
    <div className="eod-dfoot">
      <button type="button" className="btn ghost" onClick={() => openCustomer(d.customerId, d.customerName)} data-testid="fuq-d-customer">{tx('fuq.a.openCustomer')}</button>
      <button type="button" className="btn ghost" onClick={() => book(d.customerId)} data-testid="fuq-d-book">{tx('fuq.a.book')}</button>
      {d.status === 'pending_manager_approval' ? <button type="button" className="btn" disabled={busy || blocked || (needOverride && !ov)} onClick={() => act(() => eod.approve(d.id, { override: ov }))} data-testid="fuq-d-approve">{needOverride ? tx('fuq.a.sendAnyway') : tx('fuq.a.approve')}</button>
        : d.status === 'pending' ? <button type="button" className="btn" disabled={busy || blocked || (needOverride && !ov)} onClick={() => act(() => eod.send(d.id, { override: ov }))} data-testid="fuq-d-send">{needOverride ? tx('fuq.a.sendAnyway') : tx('fuq.a.send')}</button>
        : retryable ? <button type="button" className="btn" disabled={busy || (needOverride && !ov)} onClick={() => act(() => eod.send(d.id, { override: ov }))} data-testid="fuq-d-retry">{tx('fuq.a.retry')}</button> : null}
      <button type="button" className="btn ghost" onClick={onClose} data-testid="fuq-d-close">{tx('fuq.a.close')}</button>
    </div>
  ) : <button type="button" className="btn ghost" onClick={onClose}>{tx('fuq.a.close')}</button>;
  return (
    <FitDialog title={tx('fuq.d.title')} subtitle={d ? `${d.customerName} · ${stText(d.status)}` : undefined} onClose={onClose} busy={busy} wide testId="fuq-detail" footer={footer}>
      {err ? <ErrorRetry message={errText(err)} onRetry={load} /> : !d ? <div className="muted">…</div> : (
        <div className="eod-detail">
          {msg ? <div className="muted" role="status" data-testid="fuq-d-msg">{msg}</div> : null}
          <dl className="eod-dl">
            <dt>{tx('fuq.d.customer')}</dt><dd>{d.customerName}{d.customerPhone ? ` · ${d.customerPhone}` : ''}</dd>
            <dt>{tx('fuq.d.tech')}</dt><dd>{d.technicianName}</dd>
            <dt>{tx('fuq.d.service')}</dt><dd>{d.serviceName}</dd>
            <dt>{tx('fuq.d.ticket')}</dt><dd>{d.ticketNumber ?? '—'}</dd>
            <dt>{tx('fuq.d.due')}</dt><dd>{d.businessDate}</dd>
            {d.sentAt ? <><dt>{tx('fuq.d.sent')}</dt><dd>{when(d.sentAt, tz)}</dd></> : null}
            <dt>{tx('fuq.d.delivery')}</dt><dd data-testid="fuq-d-delivery">{d.delivery ? `${tx('fuq.d.deliveredInbox', { time: when(d.delivery.deliveredToInboxAt, tz) })} · ${d.delivery.readAt ? tx('fuq.d.read', { time: when(d.delivery.readAt, tz) }) : tx('fuq.d.unread')}` : tx('fuq.d.noDelivery')}</dd>
          </dl>
          {cc ? (
            <div className="fuq-cc" data-testid="fuq-d-contact">
              <h4>{tx('fuq.cc.title')}</h4>
              <div>{cc.categories.map((c) => <span key={c} className={`eod-chip ${c === 'eligible' ? 'ok' : c === 'needs_approval' || c === 'recently_contacted' ? 'warn' : 'bad'}`} data-testid="fuq-d-category">{tx(`fuq.cc.${c}`)}</span>)}</div>
              <div className="s">{tx('fuq.cc.channel')} {tx('fuq.cc.cooldown', { h: String(cc.cooldownHours) })}</div>
              {cc.lastFollowUp ? <div className="s">{tx('fuq.cc.lastFollowUp', { time: when(cc.lastFollowUp.at, tz), tech: cc.lastFollowUp.technicianName })}</div> : null}
              {cc.otherChannel ? <div className="s" data-testid="fuq-d-other">{tx('fuq.cc.other', { channel: cc.otherChannel.channel, purpose: cc.otherChannel.purpose ?? '', time: when(cc.otherChannel.at, tz) })}</div> : null}
              {cc.optOuts.map((o) => <div key={o.channel} className="s">{tx('fuq.cc.optOut', { channel: o.channel, time: when(o.at, tz) })}</div>)}
              <h4>{tx('fuq.pr.why')} · <span className={`fuq-pr pr-${cc.priority}`}>{tx(`fuq.pr.${cc.priority}`)}</span></h4>
              <ul className="fuq-reasons" data-testid="fuq-d-reasons">{cc.priorityReasons.length ? cc.priorityReasons.map((r, i) => <li key={i}>{reasonText(r, tz)}</li>) : <li>{tx('fuq.pr.none')}</li>}</ul>
              <div className="s">{tx('fuq.pr.note')}</div>
            </div>
          ) : null}
          <div className="fuq-cooldown" data-testid="fuq-d-recent">
            <h4>{tx('fuq.cd.title', { n: String(COOLDOWN_TIMELINE_DAYS) })}</h4>
            {recent === null ? <div className="s">…</div> : recent === 'unavailable' ? <div className="s" data-testid="fuq-d-recent-na">{tx('fuq.cd.unavailable')}</div>
              : recent.length === 0 ? <div className="s" data-testid="fuq-d-recent-none">{tx('fuq.cd.none', { n: String(COOLDOWN_TIMELINE_DAYS) })}</div>
              : <ul className="fuq-hist" data-testid="fuq-d-recent-list">{recent.slice(0, 10).map((it) => (
                <li key={it.kind + it.id} data-testid="fuq-d-recent-row">{when(it.at, tz)} · {tx('cn.t.kind.' + it.kind)} · {tx('cn.ch.' + (['sms', 'email', 'follow_up', 'receipt'].includes(it.channel) ? it.channel : 'sms'))} · <span className={`eod-chip ${it.failed ? 'bad' : ''}`}>{statusLabel('state', it.status)}</span>{it.summary ? <span className="s"> · {it.summary}</span> : null}</li>))}</ul>}
            {Array.isArray(recent) && recent.length > 10 ? <div className="s">{tx('fuq.cd.more', { n: String(recent.length - 10) })}</div> : null}
            <div className="s">{tx('fuq.cd.note')}</div>
          </div>
          <h4>{d.sentMessage ? tx('fuq.d.sentMessage') : tx('fuq.d.message')}</h4>
          <div className="eod-msg" data-testid="fuq-d-preview">{body}</div>
          <div className="s">{tx('fuq.d.chars', { n: String(body.length) })}</div>
          {needOverride ? <label className="eod-field">{tx('fuq.a.overrideReason')}<input className="fk-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="fuq-d-override" /></label> : null}
          {unsent ? (
            <div className="fuq-skip">
              <label className="eod-field">{tx('fuq.a.skipReason')}
                <select className="fk-select" value={skipReason} onChange={(e) => setSkipReason(e.target.value)} data-testid="fuq-d-skip-reason">{SKIP_REASONS.map((r) => <option key={r} value={r}>{tx(`fuq.skip.${r}`)}</option>)}</select></label>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => act(() => posFollowUpApi.skip(d.id, skipReason))} data-testid="fuq-d-skip">{tx('fuq.a.skip')}</button>
            </div>
          ) : null}
          {d.status === 'pending_manager_approval' ? (
            <div className="eod-reject">
              <label className="eod-field">{tx('fuq.a.rejectNote')}<input className="fk-input" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} maxLength={1000} data-testid="fuq-d-reject-note" /></label>
              <button type="button" className="btn ghost" disabled={busy || rejectNote.trim().length < 3} onClick={() => act(() => eod.reject(d.id, rejectNote.trim()))} data-testid="fuq-d-reject">{tx('fuq.a.reject')}</button>
            </div>
          ) : null}
          <h4>{tx('fuq.d.history')}</h4>
          {!hist || hist.items.filter((h) => h.id !== d.id).length === 0 ? <div className="s">{tx('fuq.d.noHistory')}</div> : (
            <ul className="fuq-hist" data-testid="fuq-d-history">{hist.items.filter((h) => h.id !== d.id).map((h) => (
              <li key={h.id}><span className={`eod-chip st-${h.status}`}>{stText(h.status)}</span> {h.dueDate} · {h.serviceName} · {h.technicianName}
                {h.bookedAfterAt ? <span className="s"> · {tx('fuq.d.bookedAfter')} {when(h.bookedAfterAt, tz)}</span> : null}</li>))}</ul>
          )}
        </div>
      )}
    </FitDialog>
  );
}
