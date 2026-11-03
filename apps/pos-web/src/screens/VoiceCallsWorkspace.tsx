// VoiceCallsWorkspace.tsx — Voice Transcription Search + Call History guides (Nov 3 2026). ONE workspace both pages use:
// Search starts empty ("Enter a search term to find calls.") and searches; Call History lists every call newest first. Both have the
// same filters (status · direction · what the caller wanted · follow-up · language), which-date + presets + From/To month
// calendars, sort, numbered pages, the same details overlay and "Check Voice Transcription System". Read-only.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { posAIVoiceTranscriptionApi } from '../api/posAIVoiceTranscriptionApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const vc = posAIVoiceTranscriptionApi.calls;
const STATUSES = ['all', 'completed', 'processing', 'review', 'failed', 'not_transcribed'] as const;
const DIRS = ['all', 'inbound', 'outbound'] as const;
const FOLLOW = ['all', 'open', 'in_task', 'resolved', 'none'] as const;
const INTENTS = ['all', 'new_booking', 'reschedule', 'cancellation', 'confirmation', 'availability', 'pricing', 'service_info', 'technician_request', 'hours_location',
  'promotion', 'membership', 'loyalty', 'payment_issue', 'refund', 'complaint', 'repair', 'health_safety', 'manager_request', 'callback', 'general_question', 'other'] as const;
const DATES = ['call', 'summary', 'followup'] as const;
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year'] as const;
const ITEMS = ['callback_requested', 'manager_requested', 'health_safety', 'refund_requested', 'complaint', 'pricing_unanswered'];
const SPEAKERS = ['customer', 'ai_receptionist', 'human_receptionist', 'technician', 'manager', 'additional_caller'];
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const STATUS_TONE: Record<string, string> = { completed: 'ok', processing: 'warn', review: 'warn', failed: 'bad', not_transcribed: '' };
const FOLLOW_TONE: Record<string, string> = { open: 'warn', in_task: '', resolved: 'ok', none: '' };
const known = (list: readonly string[], k: string) => (list.includes(k) ? k : 'other');
const codeOf = (e: unknown) => { const x = e as { code?: string; details?: { code?: string } } | null; return x?.code ?? x?.details?.code; };
function errText(e: unknown) {
  const c = codeOf(e);
  if (c === 'VC_INVALID_PERIOD' || c === 'VC_CALL_NOT_FOUND') return t('vcx.err.' + c);
  if (isForbidden(e)) return t('vcx.err.forbidden');
  return errorTextOf(e, t('vcx.loadFailed'));
}
type Period = { preset?: string; from?: string; to?: string };
type F = { q?: string; status: string; direction: string; intent: string; followUp: string; dateField: string; sort: string; page: number; pageSize: number };
type Row = { id: string; callRef: string | null; callAt: string | null; direction: string; durationSeconds: number | null; statusGroup: string; hasSummary: boolean;
  customer: string | null; customerLinked: boolean; phoneLast4: string | null; matchType: string | null; excerpt: string | null; intents: string[];
  followUp: { state: string; open: number; inTask: number; items: number } };

export function VoiceCallsWorkspace({ mode }: { mode: 'search' | 'history' }) {
  const [sum, setSum] = useState<any>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<F>({ status: 'all', direction: 'all', intent: 'all', followUp: 'all', dateField: 'call', sort: 'newest', page: 1, pageSize: 25 });
  const [period, setPeriod] = useState<Period>({});
  const [cal, setCal] = useState(false);
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [tick, setTick] = useState(0);
  const loadSum = useCallback(() => { setSumErr(null); vc.summary().then(setSum).catch((e) => setSumErr(errText(e))); }, []);
  useEffect(() => { loadSum(); }, [loadSum, tick]);
  // Search waits for a term (its original first state); Call History lists from the start
  const started = mode === 'history' || !!f.q;
  const load = useCallback(() => {
    if (!started) { setList(null); return; }
    setErr(null); vc.list({ ...f, ...period }).then(setList).catch((e) => setErr(errText(e)));
  }, [f, period, started]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (p: Partial<F>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));
  const setPer = (p: Period) => { setPeriod(p); setF((x) => ({ ...x, page: 1 })); };
  const submit = () => { const q = draft.trim() || undefined; set({ q, sort: q && f.sort === 'newest' && mode === 'search' ? 'best' : f.sort }); };
  const runCheck = () => { setHealth('loading'); vc.check().then(setHealth).catch((e) => setHealth({ error: errText(e) })); };
  const rows: Row[] = Array.isArray(list?.items) ? list.items : [];
  const filtered = !!(f.q || f.status !== 'all' || f.direction !== 'all' || f.intent !== 'all' || f.followUp !== 'all' || period.preset);
  const c = sum?.counters;
  const customersVisible = sum?.customersVisible !== false;
  const emptyTitle = filtered ? t('vcx.empty.noMatch') : sum?.emptyReason ? t('vcx.empty.' + sum.emptyReason) : t('vcx.empty.noMatch');
  return (
    <div className="work" data-testid={`vcx-${mode}`}>
      <div className="vh" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1>{mode === 'search' ? tx('pos.voice_transcription_search') : tx('pos.voice_transcription_call_history')}</h1>
          <div className="sub mb-3">{mode === 'search' ? tx('pos.search_redacted_transcripts_summaries_and_intents_6udn') : tx('pos.authorized_redacted_call_transcripts_tenant_scoped_1u9u')}</div>
        </div>
        <button className="btn ghost" data-testid="vcx-refresh" onClick={() => setTick((n) => n + 1)}>{t('vcx.refresh')}</button>
        <button className="btn ghost" data-testid="vcx-check" onClick={runCheck}>{t('vcx.check')}</button>
      </div>
      <p className="sub" data-testid="vcx-privacy">{t('vcx.privacy')} {t('vcx.safety')}</p>
      {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSum} /> : null}
      <div className="rvw-kpis" data-testid="vcx-kpis">
        <KpiCard testId="vcx-kpi-calls" label={t('vcx.kpi.calls')} value={c ? fmtNumber(c.calls) : '—'} loading={!sum && !sumErr} />
        <KpiCard testId="vcx-kpi-7" label={t('vcx.kpi.calls7')} value={c ? fmtNumber(c.calls7d) : '—'} loading={!sum && !sumErr} />
        <KpiCard testId="vcx-kpi-processing" label={t('vcx.kpi.processing')} value={c ? fmtNumber(c.processing) : '—'} loading={!sum && !sumErr} tone={c?.processing ? 'warn' : undefined} onClick={() => set({ status: 'processing' })} />
        <KpiCard testId="vcx-kpi-failed" label={t('vcx.kpi.failed')} value={c ? fmtNumber(c.failed7d) : '—'} loading={!sum && !sumErr} tone={c?.failed7d ? 'bad' : undefined} onClick={() => set({ status: 'failed' })} />
        <KpiCard testId="vcx-kpi-nottx" label={t('vcx.kpi.notTranscribed')} value={c ? fmtNumber(c.notTranscribed) : '—'} loading={!sum && !sumErr} onClick={() => set({ status: 'not_transcribed' })} />
      </div>

      <section className="panel rvw-feed" style={{ padding: 12, marginTop: 10 }}>
        <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input className="rvw-search" type="search" enterKeyHint="search" data-testid="vcx-search" value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder={customersVisible ? t('vcx.searchPh') : t('vcx.searchPhNoCustomer')} aria-label={tx('pos.search_transcripts')} />
          <button className="btn" type="submit" data-testid="vcx-search-btn">{t('vcx.search')}</button>
          {filtered || draft ? <button className="btn ghost" type="button" data-testid="vcx-clear" onClick={() => { setDraft(''); setPeriod({}); set({ q: undefined, status: 'all', direction: 'all', intent: 'all', followUp: 'all' }); }}>{t('vcx.clear')}</button> : null}
        </form>
        <div className="rvw-filters">
          <select data-testid="vcx-status" aria-label={t('vcx.statusLabel')} value={f.status} onChange={(e) => set({ status: e.target.value })}>{STATUSES.map((k) => <option key={k} value={k}>{t('vcx.status.' + k)}</option>)}</select>
          <select data-testid="vcx-direction" aria-label={t('vcx.directionLabel')} value={f.direction} onChange={(e) => set({ direction: e.target.value })}>{DIRS.map((k) => <option key={k} value={k}>{t('vcx.dir.' + k)}</option>)}</select>
          <select data-testid="vcx-intent" aria-label={t('vcx.intentLabel')} value={f.intent} onChange={(e) => set({ intent: e.target.value })}>{INTENTS.map((k) => <option key={k} value={k}>{t('vcx.intent.' + k)}</option>)}</select>
          <select data-testid="vcx-follow" aria-label={t('vcx.followLabel')} value={f.followUp} onChange={(e) => set({ followUp: e.target.value })}>{FOLLOW.map((k) => <option key={k} value={k}>{t('vcx.follow.' + k)}</option>)}</select>
          <select data-testid="vcx-datefield" aria-label={t('vcx.dateLabel')} value={f.dateField} onChange={(e) => set({ dateField: e.target.value })}>{DATES.map((k) => <option key={k} value={k}>{t('vcx.date.' + k)}</option>)}</select>
          <select data-testid="vcx-sort" aria-label={t('vcx.sortLabel')} value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{(['newest', 'oldest', 'best'] as const).map((k) => <option key={k} value={k}>{t('vcx.sort.' + k)}</option>)}</select>
        </div>
        <div className="rvw-dates">
          <button className={'btn ghost' + (!period.preset ? ' on' : '')} onClick={() => setPer({})}>{t('vcx.preset.all')}</button>
          {PRESETS.map((p) => <button key={p} className={'btn ghost' + (period.preset === p ? ' on' : '')} data-testid={`vcx-preset-${p}`} onClick={() => setPer({ preset: p })}>{t('vcx.preset.' + p)}</button>)}
          <button className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} data-testid="vcx-custom" onClick={() => setCal(true)}>{period.preset === 'custom' ? `${period.from} → ${period.to}` : t('vcx.preset.custom')}</button>
        </div>
        {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={list?.period?.today ?? new Date().toISOString().slice(0, 10)}
          onApply={(r) => { setPer({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setPer({}); setCal(false); }} /></div> : null}

        {!started ? <div className="state" data-testid="vcx-not-started">{tx('pos.enter_a_search_term_to_find_1hj7')}</div>
          : err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('vcx.loading')}</div> : rows.length === 0
            ? <Empty title={emptyTitle}>{c?.processing ? t("vcx.empty.processingHint", { n: fmtNumber(c.processing) }) : null}</Empty> : (
              <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>
                <th>{t('vcx.col.when')}</th><th>{t('vcx.col.customer')}</th><th>{t('vcx.col.call')}</th><th>{t('vcx.col.status')}</th>{f.q ? <th>{t('vcx.col.match')}</th> : null}<th>{t('vcx.col.follow')}</th><th /></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id} data-testid="vcx-row">
                    <td className="nowrap">{when(r.callAt)}</td>
                    <td>{r.customer ?? (r.customerLinked ? t('vcx.customerHidden') : t('vcx.unknownCaller'))}{r.phoneLast4 ? <div className="sub">•••{r.phoneLast4}</div> : null}</td>
                    <td>{t('vcx.dir.' + known(DIRS, r.direction))}{r.durationSeconds != null ? <span className="sub"> · {t('vcx.d.duration', { n: fmtNumber(r.durationSeconds) })}</span> : null}
                      {r.intents.length ? <div className="sub">{r.intents.map((i) => t('vcx.intent.' + known(INTENTS, i))).join(' · ')}</div> : null}</td>
                    <td><span className={'chip ' + (STATUS_TONE[r.statusGroup] ?? '')} data-testid="vcx-status-chip">{t('vcx.status.' + known(STATUSES, r.statusGroup))}</span>
                      <div className="sub">{r.hasSummary ? t('vcx.summaryReady') : t('vcx.noSummary')}</div></td>
                    {f.q ? <td>{r.matchType ? <span className="chip">{t('vcx.match.' + r.matchType)}</span> : null}{r.excerpt ? <div className="sub" data-testid="vcx-excerpt">“{r.excerpt}”</div> : null}</td> : null}
                    <td><span className={'chip ' + (FOLLOW_TONE[r.followUp.state] ?? '')}>{t('vcx.follow.' + known(FOLLOW, r.followUp.state))}</span></td>
                    <td><button className="btn ghost sm" data-testid="vcx-view" onClick={() => setOpen(r.id)}>{t('vcx.view')}</button></td>
                  </tr>))}</tbody></table></div>)}
        {started ? <div className="rvw-pager">
          <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
          <label className="rvw-f"><span>{t('vcx.rows')}</span><select data-testid="vcx-rows" value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div> : null}
      </section>

      {open ? <CallDialog id={open} terms={f.q ?? ''} onClose={() => setOpen(null)} /> : null}
      {health ? <FitDialog wide testId="vcx-health" title={t('vcx.check')} onClose={() => setHealth(null)}
        subtitle={health !== 'loading' && !health.error ? t('vcx.health.overall', { s: t('vcx.health.' + health.overall), at: when(health.checkedAt) }) : undefined}
        footer={<button className="btn ghost" onClick={() => setHealth(null)}>{t('vcx.close')}</button>}>
        {health === 'loading' ? <div className="state">{t('vcx.health.running')}</div> : health.error ? <div className="err">{health.error}</div> : <>
          <p className="sub">{t('vcx.health.readOnly')}{health.reused ? ` ${t('vcx.health.recent')}` : ''}</p>
          {(health.checks ?? []).map((x: any) => (
            <div key={x.key} className="rvw-check" data-testid={`vcx-chk-${x.key}`}>
              <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')}>{t('vcx.health.' + x.state)}</span> <b>{t('vcx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
              <div className="sub">{t('vcx.health.d.' + x.key + '.' + x.state)}</div>
              <div className="sub">{t('vcx.health.part', { c: t('vcx.comp.' + x.component) })} · {x.lastPassedAt ? t('vcx.health.lastPassed', { at: when(x.lastPassedAt) }) : t('vcx.health.neverPassed')}</div>
            </div>))}
        </>}
      </FitDialog> : null}
    </div>
  );
}

/** the same details overlay from Search and Call History; Close keeps the list, its filters and its page */
function CallDialog({ id, terms, onClose }: { id: string; terms: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [find, setFind] = useState(terms);
  const load = useCallback(() => { setErr(null); vc.detail(id).then(setD).catch((e) => setErr(errText(e))); }, [id]);
  useEffect(() => { load(); }, [load]);
  const needle = find.trim().toLowerCase();
  const lines: any[] = Array.isArray(d?.transcript) ? d.transcript : [];
  const shown = needle ? lines.filter((l) => String(l.text).toLowerCase().includes(needle)) : lines;
  return (
    <FitDialog wide testId="vcx-call" title={t('vcx.d.title')} onClose={onClose}
      subtitle={d ? `${when(d.call.callAt)} · ${t('vcx.dir.' + known(DIRS, d.call.direction))}${d.call.branch ? ` · ${d.call.branch}` : ''}` : undefined}
      footer={<><button className="btn ghost" onClick={onClose} data-testid="vcx-call-close">{t('vcx.close')}</button>
        {d ? <Link className="btn ghost" to={`/tenant/ai/voice-transcription/transcripts/${id}`}>{t('vcx.d.fullPage')}</Link> : null}
        {d?.followUps?.length ? <Link className="btn" to="/tenant/ai/voice-transcription/unresolved">{t('vcx.d.openFollow')}</Link> : null}</>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="state">{t('vcx.loading')}</div> : <>
        <div className="sub" data-testid="vcx-call-head">
          <span className={'chip ' + (STATUS_TONE[d.call.statusGroup] ?? '')}>{t('vcx.status.' + known(STATUSES, d.call.statusGroup))}</span>
          {d.call.durationSeconds != null ? ` · ${t('vcx.d.duration', { n: fmtNumber(d.call.durationSeconds) })}` : ''}{d.call.language ? ` · ${t('vcx.d.lang', { l: d.call.language })}` : ''}
          {d.call.callRef ? ` · ${d.call.callRef}` : ''}
        </div>
        <div className="sub" data-testid="vcx-call-customer" style={{ marginTop: 6 }}>
          {d.customer.linked ? <>{t('vcx.d.linked')}: <b>{d.customer.name ?? t('vcx.customerHidden')}</b>{d.customer.phoneLast4 ? ` •••${d.customer.phoneLast4}` : ''}
            {d.customer.id ? <> · <Link to={`/customers?customerId=${encodeURIComponent(d.customer.id)}`}>{t('vcx.d.openCustomer')}</Link></> : null}</> : t('vcx.d.notLinked')}
        </div>
        {d.summary ? <section style={{ marginTop: 10 }}><div className="p-h">{t('vcx.d.summary')}</div><p data-testid="vcx-call-summary">{d.summary.detailed ?? d.summary.quick}</p>
          <div className="sub">{t('vcx.d.generated', { at: when(d.summary.generatedAt) })}</div></section> : null}
        {d.request ? <section style={{ marginTop: 10 }} data-testid="vcx-call-request"><div className="p-h">{t('vcx.d.request')}</div>
          <div>{d.request.services?.length ? `${t('vcx.d.services')}: ${d.request.services.join(', ')}` : ''}{d.request.technician ? ` · ${t('vcx.d.tech')}: ${d.request.technician}` : ''}
            {d.request.date ? ` · ${t('vcx.d.day')}: ${d.request.date}` : ''}{d.request.time ? ` · ${t('vcx.d.time')}: ${d.request.time}` : ''}</div>
          <div className="sub">{t('vcx.d.requestNote')}</div></section> : null}
        <section style={{ marginTop: 10 }} data-testid="vcx-call-follow"><div className="p-h">{t('vcx.d.follow')}</div>
          {d.followUps.length ? d.followUps.map((u: any) => <div key={u.type} className="rvw-ev"><b>{t('vcx.item.' + known(ITEMS, u.type))}</b> <span className={'chip ' + (FOLLOW_TONE[u.state] ?? '')}>{t('vcx.follow.' + known(FOLLOW, u.state))}</span></div>)
            : <div className="sub">{t('vcx.d.noFollow')}</div>}</section>
        <section style={{ marginTop: 10 }}><div className="p-h">{t('vcx.d.transcript')}</div>
          <input className="rvw-search" data-testid="vcx-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('vcx.d.find')} aria-label={t('vcx.d.find')} />
          {!lines.length ? <div className="sub">{t('vcx.d.noTranscript')}</div> : <div data-testid="vcx-call-lines" style={{ maxHeight: '40vh', overflowY: 'auto', marginTop: 6 }}>
            {shown.map((l) => <div key={l.seq} className="rvw-ev" data-testid="vcx-line"><b>{t('vcx.speaker.' + (SPEAKERS.includes(l.speaker) ? l.speaker : 'unknown'))}</b> {l.text}
              {l.uncertain ? <span className="chip warn"> {t('vcx.d.uncertain')}</span> : null}</div>)}</div>}
        </section>
        <p className="sub" style={{ marginTop: 8 }}>{t('vcx.d.audited')}</p>
      </>}
    </FitDialog>
  );
}
