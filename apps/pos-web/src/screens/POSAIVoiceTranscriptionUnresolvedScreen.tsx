// POSAIVoiceTranscriptionUnresolvedScreen.tsx — AI Center → AI Voice Transcription → Follow-ups
// (/tenant/ai/voice-transcription/unresolved). Calls with open items (callbacks, manager requests, health / safety, refunds,
// complaints, unanswered pricing), highest priority first. Redacted-safe: no transcript text is shown here.
//
// Voice Transcription Follow-Ups guide (Nov 2 2026) — over /pos/ai-voice-transcription/follow-ups/*:
//   • the old list (the 100 newest flagged calls, re-sorted after the cut, no way to act) is a REVIEW queue: each extracted
//     item can become a follow-up task in the ONE task board (/tenant/ai/receptionist/follow-ups — assignment, contact
//     attempts, escalation and resolution live there), be dismissed with a reason, or be reopened;
//   • counters with one definition each, an urgent lane, tabs Open / In task / Resolved / All, search, type, which date,
//     presets + month calendar, sort, numbered pages;
//   • the empty state says WHY it is empty — "every call is resolved" only when calls arrive, nothing is processing and
//     nothing failed; Check Voice Follow-Up System (read-only). Nothing here calls, texts, books or refunds.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { posAIVoiceTranscriptionApi } from '../api/posAIVoiceTranscriptionApi';
import { posAiFollowUpsApi } from '../api/posAiFollowUpsApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const fu = posAIVoiceTranscriptionApi.followUps;
const BOARD = '/tenant/ai/receptionist/follow-ups';
const TYPES = ['all', 'callback_requested', 'manager_requested', 'health_safety', 'refund_requested', 'complaint', 'pricing_unanswered'] as const;
const TABS = ['open', 'in_task', 'resolved', 'all'] as const;
const DATE_FIELDS = ['call', 'reviewed', 'due'] as const;
const SORTS = ['newest', 'priority', 'oldest'] as const;
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year'] as const;
const PRIOS = ['urgent', 'high', 'normal', 'low'] as const;
const PRIO_TONE: Record<string, string> = { urgent: 'bad', high: 'warn', normal: '', low: '' };
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const typeLabel = (k: string) => t('vfx.type.' + ((TYPES as readonly string[]).includes(k) ? k : 'other'));
const codeOf = (e: unknown) => { const x = e as { code?: string; details?: { code?: string } } | null; return x?.code ?? x?.details?.code; };
function errText(e: unknown) {
  const c = codeOf(e);
  if (c && ['VF_INVALID_PERIOD', 'VF_REASON_REQUIRED', 'VF_NOT_OPEN', 'VF_NOT_RESOLVED', 'FOLLOWUP_ASSIGNEE_INVALID'].includes(c)) return t('vfx.err.' + c);
  if (isForbidden(e)) return t('vfx.err.forbidden');
  return errorTextOf(e, t('vfx.loadFailed'));
}
type Period = { preset?: string; from?: string; to?: string };
type Item = { transcriptId: string; type: string; priority: string; state: string; callAt: string | null; customer: string | null; customerPhoneLast4: string | null; customerLinked: boolean;
  review: { decision: string; reason: string | null; by: string | null; at: string | null } | null; task: { id: string; status: string | null; dueAt: string | null; assignee: string | null; overdue: boolean } | null };
type Act = { kind: 'task' | 'dismiss' | 'reopen' | 'history'; item: { transcriptId: string; type: string; priority: string } };

export function POSAIVoiceTranscriptionUnresolvedScreen() {
  const [sum, setSum] = useState<any>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<(typeof TABS)[number]>('open');
  const [act, setAct] = useState<Act | null>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadSum = useCallback(() => { setSumErr(null); fu.summary().then(setSum).catch((e) => setSumErr(errText(e))); }, []);
  useEffect(() => { loadSum(); }, [loadSum, tick]);
  const done = (msg: string) => { setAct(null); setNotice(msg); setTick((n) => n + 1); };
  const c = sum?.counters;
  const runCheck = () => { setHealth('loading'); fu.check().then(setHealth).catch((e) => setHealth({ error: errText(e) })); };

  return (
    <div className="work" data-testid="vfx-page">
      <div className="vh" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1>{tx('pos.voice_transcription_follow_ups')}</h1>
          <div className="sub mb-3">{tx('pos.calls_with_open_items_callbacks_manager_148t')}</div>
        </div>
        <button className="btn ghost" data-testid="vfx-refresh" onClick={() => setTick((n) => n + 1)}>{t('vfx.refresh')}</button>
        <button className="btn ghost" data-testid="vfx-check" onClick={runCheck}>{t('vfx.check')}</button>
        <Link className="btn" to={BOARD} data-testid="vfx-board">{t('vfx.board')}</Link>
      </div>
      <p className="sub" data-testid="vfx-safety">{t('vfx.safety')}</p>
      {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSum} /> : null}
      {notice ? <div className="ok" role="status" style={{ marginBottom: 8 }}>{notice}</div> : null}
      <div className="rvw-kpis" data-testid="vfx-kpis">
        <KpiCard testId="vfx-kpi-open" label={t('vfx.kpi.open')} value={c ? fmtNumber(c.open) : '—'} loading={!sum && !sumErr} tone={c?.open ? 'gold' : undefined} onClick={() => setTab('open')} />
        <KpiCard testId="vfx-kpi-urgent" label={t('vfx.kpi.urgent')} value={c ? fmtNumber(c.urgent) : '—'} loading={!sum && !sumErr} tone={c?.urgent ? 'bad' : undefined} onClick={() => setTab('open')} />
        <KpiCard testId="vfx-kpi-intask" label={t('vfx.kpi.inTask')} value={c ? fmtNumber(c.inTask) : '—'} loading={!sum && !sumErr} onClick={() => setTab('in_task')} />
        <KpiCard testId="vfx-kpi-overdue" label={t('vfx.kpi.overdue')} value={c ? fmtNumber(c.overdue) : '—'} loading={!sum && !sumErr} tone={c?.overdue ? 'warn' : undefined} onClick={() => setTab('in_task')} />
        <KpiCard testId="vfx-kpi-resolved" label={t('vfx.kpi.resolved')} value={c ? fmtNumber(c.resolved30d) : '—'} loading={!sum && !sumErr} onClick={() => setTab('resolved')} />
      </div>
      {sum?.pipeline && (sum.pipeline.processing || sum.pipeline.errors24h) ? <div className="panel" data-testid="vfx-pipeline" style={{ padding: 10, marginTop: 8 }}>
        {sum.pipeline.processing ? <span className="chip warn">{t('vfx.pl.processing', { n: fmtNumber(sum.pipeline.processing) })}</span> : null}{' '}
        {sum.pipeline.errors24h ? <span className="chip bad">{t('vfx.pl.errors', { n: fmtNumber(sum.pipeline.errors24h) })}</span> : null}
      </div> : null}

      {sum?.urgent?.length ? <section className="panel" data-testid="vfx-urgent" style={{ padding: 12, marginTop: 12, borderColor: '#B3261E' }}>
        <div className="p-h">{t('vfx.urgentLane')}</div>
        {sum.urgent.map((u: any) => (
          <div key={u.transcriptId + u.type} className="rvw-ev" data-testid="vfx-urgent-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span className={'chip ' + PRIO_TONE[u.priority]}>{t('vfx.prio.' + u.priority)}</span> <b>{typeLabel(u.type)}</b> <span className="sub">{when(u.callAt)}</span>
            <Link to={`/tenant/ai/voice-transcription/transcripts/${u.transcriptId}`}>{t('vfx.viewCall')}</Link>
            {sum.canWork ? <button className="btn sm" onClick={() => setAct({ kind: 'task', item: u })}>{t('vfx.createTask')}</button> : null}
          </div>))}
      </section> : null}

      <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'nowrap', overflowX: 'auto' }} role="tablist" aria-label={t('vfx.tabs')}>
        {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className={'btn ghost' + (tab === k ? ' on' : '')} data-testid={`vfx-tab-${k}`} onClick={() => setTab(k)}>{t('vfx.tab.' + k)}</button>)}
      </div>
      <ItemsCard tab={tab} tick={tick} canWork={!!sum?.canWork} emptyReason={sum?.emptyReason ?? null} onAct={setAct} />

      {act?.kind === 'task' ? <TaskDialog item={act.item} onClose={() => setAct(null)} onDone={() => done(t('vfx.ok.task'))} /> : null}
      {act?.kind === 'dismiss' || act?.kind === 'reopen' ? <ReasonDialog kind={act.kind} item={act.item} onClose={() => setAct(null)} onDone={() => done(t(act.kind === 'dismiss' ? 'vfx.ok.dismissed' : 'vfx.ok.reopened'))} /> : null}
      {act?.kind === 'history' ? <HistoryDialog item={act.item} onClose={() => setAct(null)} /> : null}
      {health ? <FitDialog wide testId="vfx-health" title={t('vfx.check')} onClose={() => setHealth(null)}
        subtitle={health !== 'loading' && !health.error ? t('vfx.health.overall', { s: t('vfx.health.' + health.overall), at: when(health.checkedAt) }) : undefined}
        footer={<button className="btn ghost" onClick={() => setHealth(null)}>{t('vfx.close')}</button>}>
        {health === 'loading' ? <div className="state">{t('vfx.health.running')}</div> : health.error ? <div className="err">{health.error}</div> : <>
          <p className="sub">{t('vfx.health.readOnly')}{health.reused ? ` ${t('vfx.health.recent')}` : ''}</p>
          {(health.checks ?? []).map((x: any) => (
            <div key={x.key} className="rvw-check" data-testid={`vfx-chk-${x.key}`}>
              <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')}>{t('vfx.health.' + x.state)}</span> <b>{t('vfx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
              <div className="sub">{t('vfx.health.d.' + x.key + '.' + x.state)}</div>
            </div>))}
        </>}
      </FitDialog> : null}
    </div>
  );
}

function ItemsCard({ tab, tick, canWork, emptyReason, onAct }: { tab: string; tick: number; canWork: boolean; emptyReason: string | null; onAct: (a: Act) => void }) {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; type: string; dateField: string; sort: string; page: number; pageSize: number }>({ type: 'all', dateField: 'call', sort: 'newest', page: 1, pageSize: 25 });
  const [period, setPeriod] = useState<Period>({});
  const [cal, setCal] = useState(false);
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setF((x) => ({ ...x, page: 1 })); }, [tab]);
  const load = useCallback(() => { setErr(null); fu.items({ ...f, ...period, tab, q: f.q }).then(setList).catch((e) => setErr(errText(e))); }, [f, period, tab]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (p: Partial<typeof f>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));
  const setPer = (p: Period) => { setPeriod(p); setF((x) => ({ ...x, page: 1 })); };
  const items: Item[] = Array.isArray(list?.items) ? list.items : [];
  const filtered = !!(f.q || f.type !== 'all' || period.preset);
  return (
    <section className="panel rvw-feed" data-testid="vfx-items" style={{ padding: 12, marginTop: 8 }}>
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" data-testid="vfx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t(list?.customersVisible === false ? 'vfx.searchPhNoCustomer' : 'vfx.searchPh')} aria-label={t('vfx.searchPh')} />
        <button className="btn" type="submit">{t('vfx.search')}</button>
        <select data-testid="vfx-type" aria-label={t('vfx.typeLabel')} value={f.type} onChange={(e) => set({ type: e.target.value })}>{TYPES.map((k) => <option key={k} value={k}>{t('vfx.type.' + k)}</option>)}</select>
        <select data-testid="vfx-datefield" aria-label={t('vfx.dateLabel')} value={f.dateField} onChange={(e) => set({ dateField: e.target.value })}>{DATE_FIELDS.map((k) => <option key={k} value={k}>{t('vfx.date.' + k)}</option>)}</select>
        <select data-testid="vfx-sort" aria-label={t('vfx.sortLabel')} value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{SORTS.map((k) => <option key={k} value={k}>{t('vfx.sort.' + k)}</option>)}</select>
        {filtered ? <button className="btn ghost" type="button" onClick={() => { setDraft(''); setPeriod({}); set({ q: undefined, type: 'all' }); }}>{t('vfx.clear')}</button> : null}
      </form>
      <div className="rvw-dates">
        <button className={'btn ghost' + (!period.preset ? ' on' : '')} onClick={() => setPer({})}>{t('vfx.preset.all')}</button>
        {PRESETS.map((p) => <button key={p} className={'btn ghost' + (period.preset === p ? ' on' : '')} data-testid={`vfx-preset-${p}`} onClick={() => setPer({ preset: p })}>{t('vfx.preset.' + p)}</button>)}
        <button className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} onClick={() => setCal(true)}>{period.preset === 'custom' ? `${period.from} → ${period.to}` : t('vfx.preset.custom')}</button>
      </div>
      {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={list?.period?.today ?? deviceToday()}
        onApply={(r) => { setPer({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setPer({}); setCal(false); }} /></div> : null}
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('vfx.loading')}</div> : items.length === 0
        ? <Empty title={filtered ? t('vfx.noMatch') : tab === 'open' ? t('vfx.empty.' + (emptyReason ?? 'none_open')) : t('vfx.noneHere')} /> : (
          <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('vfx.col.call')}</th><th>{t('vfx.col.customer')}</th><th>{t('vfx.col.item')}</th><th>{t('vfx.col.status')}</th><th /></tr></thead>
            <tbody>{items.map((r) => (
              <tr key={r.transcriptId + r.type} data-testid="vfx-row">
                <td className="nowrap">{when(r.callAt)}</td>
                <td>{r.customer ?? (r.customerLinked ? t('vfx.customerHidden') : t('vfx.unknownCaller'))}{r.customerPhoneLast4 ? <div className="sub">•••{r.customerPhoneLast4}</div> : null}</td>
                <td><b>{typeLabel(r.type)}</b> <span className={'chip ' + (PRIO_TONE[r.priority] ?? '')}>{t('vfx.prio.' + r.priority)}</span></td>
                <td><span className="chip" data-testid="vfx-state">{t('vfx.state.' + r.state)}</span>
                  {r.task ? <div className="sub">{t('vfx.taskLine', { status: t('vfx.taskStatus.' + (r.task.status ?? 'open')), who: r.task.assignee ?? t('vfx.unassigned') })}{r.task.dueAt ? ` · ${t('vfx.due', { at: when(r.task.dueAt) })}` : ''}
                    {r.task.overdue ? <span className="chip bad"> {t('vfx.overdue')}</span> : null}</div> : null}
                  {r.review?.decision === 'dismissed' ? <div className="sub">{t('vfx.dismissedBy', { who: r.review.by ?? '—' })}{r.review.reason ? ` · ${r.review.reason}` : ''}</div> : null}</td>
                <td className="nowrap">
                  <Link className="btn ghost sm" to={`/tenant/ai/voice-transcription/transcripts/${r.transcriptId}`}>{t('vfx.viewCall')}</Link>{' '}
                  {canWork && r.state === 'open' ? <><button className="btn sm" data-testid="vfx-act-task" onClick={() => onAct({ kind: 'task', item: r })}>{t('vfx.createTask')}</button>{' '}
                    <button className="btn ghost sm" data-testid="vfx-act-dismiss" onClick={() => onAct({ kind: 'dismiss', item: r })}>{t('vfx.dismiss')}</button></> : null}
                  {r.task ? <Link className="btn ghost sm" to={BOARD}>{t('vfx.openTask')}</Link> : null}{' '}
                  {canWork && r.state === 'resolved' ? <button className="btn ghost sm" data-testid="vfx-act-reopen" onClick={() => onAct({ kind: 'reopen', item: r })}>{t('vfx.reopen')}</button> : null}{' '}
                  <button className="btn ghost sm" onClick={() => onAct({ kind: 'history', item: r })}>{t('vfx.history')}</button>
                </td>
              </tr>))}</tbody></table></div>)}
      <div className="rvw-pager">
        <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
        <label className="rvw-f"><span>{t('vfx.rows')}</span><select value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
    </section>
  );
}

function TaskDialog({ item, onClose, onDone }: { item: Act['item']; onClose: () => void; onDone: () => void }) {
  const [priority, setPriority] = useState(item.priority);
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [staff, setStaff] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { posAiFollowUpsApi.staff().then((r) => setStaff(Array.isArray(r?.items) ? r.items : [])).catch(() => setStaff(null)); }, []);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await fu.task({ transcriptId: item.transcriptId, type: item.type, priority, dueLocal: due || null, assignedUserId: assignee || null, note: note.trim() || null }); onDone(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <FitDialog testId="vfx-task" title={t('vfx.createTask')} subtitle={typeLabel(item.type)} onClose={onClose} busy={busy}
      footer={<><button className="btn ghost" onClick={onClose}>{t('vfx.cancel')}</button><button className="btn" data-testid="vfx-task-save" disabled={busy} onClick={go}>{t('vfx.createTask')}</button></>}>
      <p className="sub">{t('vfx.taskNote')}</p>
      <label className="rvw-f"><span>{t('vfx.f.priority')}</span><select data-testid="vfx-task-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIOS.map((p) => <option key={p} value={p}>{t('vfx.prio.' + p)}</option>)}</select></label>
      <label className="rvw-f"><span>{t('vfx.f.due')}</span><input type="datetime-local" data-testid="vfx-task-due" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      {staff ? <label className="rvw-f"><span>{t('vfx.f.assignee')}</span><select data-testid="vfx-task-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
        <option value="">{t('vfx.unassigned')}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : null}
      <label className="rvw-f" style={{ display: 'block' }}><span>{t('vfx.f.note')}</span><textarea data-testid="vfx-task-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} rows={3} style={{ width: '100%' }} /></label>
      {err ? <div className="err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function ReasonDialog({ kind, item, onClose, onDone }: { kind: 'dismiss' | 'reopen'; item: Act['item']; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await (kind === 'dismiss' ? fu.dismiss : fu.reopen)({ transcriptId: item.transcriptId, type: item.type, reason: reason.trim() }); onDone(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <FitDialog testId={`vfx-${kind}`} title={t('vfx.' + kind)} subtitle={typeLabel(item.type)} onClose={onClose} busy={busy}
      footer={<><button className="btn ghost" onClick={onClose}>{t('vfx.cancel')}</button><button className="btn" data-testid={`vfx-${kind}-save`} disabled={busy || reason.trim().length < 3} onClick={go}>{t('vfx.' + kind)}</button></>}>
      <label className="rvw-f" style={{ display: 'block' }}><span>{t(kind === 'dismiss' ? 'vfx.f.dismissReason' : 'vfx.f.reopenReason')}</span>
        <textarea data-testid={`vfx-${kind}-reason`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} rows={3} style={{ width: '100%' }} /></label>
      {err ? <div className="err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function HistoryDialog({ item, onClose }: { item: Act['item']; onClose: () => void }) {
  const [h, setH] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fu.history(item.transcriptId, item.type).then(setH).catch((e) => setErr(errText(e))); }, [item]);
  return (
    <FitDialog testId="vfx-history" title={t('vfx.history')} subtitle={typeLabel(item.type)} onClose={onClose} footer={<button className="btn ghost" onClick={onClose}>{t('vfx.close')}</button>}>
      {err ? <div className="err">{err}</div> : !h ? <div className="state">{t('vfx.loading')}</div> : !h.items?.length ? <p className="sub">{t('vfx.noHistory')}</p>
        : h.items.map((x: any, i: number) => <div key={i} className="rvw-ev">{when(x.at)} · <b>{t('vfx.decision.' + x.decision)}</b>{x.by ? ` · ${x.by}` : ''}{x.reason ? ` · ${x.reason}` : ''}</div>)}
      <p className="sub">{t('vfx.historyNote')}</p>
    </FitDialog>
  );
}
