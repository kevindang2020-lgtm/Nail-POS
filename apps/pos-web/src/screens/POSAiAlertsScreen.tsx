// POSAiAlertsScreen.tsx — AI Center → AI Business Alerts (/tenant/ai/business/alerts). AI Business Alerts guide (Nov 3 2026).
// Keeps the photographed page — the New Alert row (name · metric · comparison · amount · period · Create Alert) and the rule table
// (Alert · Condition · Period · Status · Actions with Evaluate now and Delete) — and finishes it:
//   • Evaluate now is RECORDED: the value, the threshold, the sample, the exact salon days and what changed (triggered / recovered /
//     unchanged / not evaluated because the sample was too small) — an alert has a history now, newest first, with search, state,
//     date presets + From/To month calendar and numbered pages; a triggered alert can be acknowledged (who, when, note);
//   • Explain: the measured price × volume bridge for money metrics, the appointment funnel otherwise — correlation, not proof;
//   • an opt-in anomaly check: yesterday against the same weekday over the previous 8 weeks (median and spread), only with enough
//     comparable days;
//   • Check AI Business Alerts System (read-only); Pause / Resume and Delete (with confirmation) report their errors.
// Honest about what does not exist yet: rules are not evaluated automatically and nothing is sent by SMS or email.
// Before: every "today" / "week" value was the last 7 days (the canonical report ignored the period) — fixed at the source.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KpiCard, Pager, Empty, ErrorRetry, FitDialog } from '../components/FitKit';
import { BzPeriodBar, BzHealthButton, bt, bzErr, bzWhen, bzNum, bzValue, bzDays, type BzPeriod } from '../components/BusinessKit';
import { posAiBusinessApi } from '../api/posAiBusinessApi';
import { IncidentsPanel, DeliveryDialog } from './ai-business/AlertIncidents';

type Metric = 'net_sales' | 'average_ticket' | 'completed_appointments' | 'cancellation_rate' | 'no_show_rate' | 'customer_retention';
const METRICS: Metric[] = ['net_sales', 'average_ticket', 'completed_appointments', 'cancellation_rate', 'no_show_rate', 'customer_retention'];
const UNIT: Record<string, string> = { net_sales: 'cents', average_ticket: 'cents', completed_appointments: 'count', cancellation_rate: 'percent', no_show_rate: 'percent', customer_retention: 'percent' };
const PRESETS = ['today', 'yesterday', 'week', 'last7', 'month', 'last30', 'last_month', 'quarter', 'year'];
const RULE_STATUSES = ['all', 'active', 'paused', 'triggered', 'needs_review', 'never_evaluated'];
const EVENT_STATES = ['all', 'triggered', 'unacknowledged', 'recovered', 'unchanged', 'not_evaluated', 'failed'];
const STATE_TONE: Record<string, string> = { triggered: 'bad', recovered: 'ok', unchanged: '', not_evaluated: 'warn', failed: 'bad' };

export function POSAiAlertsScreen() {
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  const [sum, setSum] = useState<any>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [histAlert, setHistAlert] = useState<{ id: string; title: string } | null>(null);
  const loadSum = useCallback(() => { setSumErr(null); posAiBusinessApi.center.alertSummary().then(setSum).catch((e) => setSumErr(bzErr(e))); }, []);
  useEffect(() => { loadSum(); }, [loadSum, tick]);
  return (
    <div className="work rvw" data-testid="bzx-alerts">
      <div className="rvw-head">
        <div className="vh"><h1>{bt('bzx.a.title')}</h1><div className="sub">{bt('bzx.a.sub')}</div></div>
        <div className="rvw-actions">
          <button type="button" className="btn ghost" data-testid="bzx-refresh" onClick={refresh}>{bt('bzx.refresh')}</button>
          <BzHealthButton area="alerts" run={posAiBusinessApi.center.alertCheck} />
        </div>
      </div>
      {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSum} /> : null}
      <div className="rvw-kpis" data-testid="bzx-a-kpis">
        <KpiCard testId="bzx-a-active" label={bt('bzx.a.kpi.active')} value={sum ? bzNum(sum.activeRules) : '—'} sub={sum?.pausedRules ? bt('bzx.a.kpi.paused', { n: sum.pausedRules }) : undefined} loading={!sum && !sumErr} />
        <KpiCard testId="bzx-a-triggered" label={bt('bzx.a.kpi.triggered')} value={sum ? bzNum(sum.triggeredUnacknowledged) : '—'} tone={sum?.triggeredUnacknowledged ? 'bad' : undefined} loading={!sum && !sumErr} />
        <KpiCard testId="bzx-a-review" label={bt('bzx.a.kpi.review')} value={sum ? bzNum(sum.needsReview) : '—'} tone={sum?.needsReview ? 'warn' : undefined} loading={!sum && !sumErr} />
        <KpiCard testId="bzx-a-never" label={bt('bzx.a.kpi.never')} value={sum ? bzNum(sum.neverEvaluated) : '—'} loading={!sum && !sumErr} />
        <KpiCard testId="bzx-a-failed" label={bt('bzx.a.kpi.failed')} value={sum ? bzNum(sum.failedEvaluations ?? 0) : '—'} tone={sum?.failedEvaluations ? 'bad' : undefined} loading={!sum && !sumErr} />
        <KpiCard testId="bzx-a-last" label={bt('bzx.a.kpi.last')} value={sum ? (sum.lastEvaluatedAt ? bzWhen(sum.lastEvaluatedAt) : bt('bzx.a.never')) : '—'} loading={!sum && !sumErr} />
      </div>
      {sum && !sum.automaticEvaluation ? <p className="sub" data-testid="bzx-a-manual">{bt('bzx.a.manualNote')}</p> : null}
      {msg ? <div className={msg.tone === 'err' ? 'err' : 'sub'} role="status" data-testid="bzx-a-msg">{msg.text}</div> : null}
      <NewAlert onCreated={() => { setMsg({ tone: 'ok', text: bt('bzx.a.created') }); refresh(); }} onError={(t) => setMsg({ tone: 'err', text: t })} />
      <Rules tick={tick} onChanged={refresh} onMsg={setMsg} onHistory={(a) => { setHistAlert(a); setTimeout(() => document.querySelector('[data-testid="bzx-a-history"]')?.scrollIntoView({ block: 'start' }), 0); }} />
      <IncidentsPanel tick={tick} onChanged={refresh} />
      <History tick={tick} onChanged={refresh} alert={histAlert} onAll={() => setHistAlert(null)} />
      <Anomaly />
    </div>
  );
}

function NewAlert({ onCreated, onError }: { onCreated: () => void; onError: (t: string) => void }) {
  const [title, setTitle] = useState('');
  const [metricId, setMetricId] = useState<Metric>('net_sales');
  const [operator, setOperator] = useState<'lt' | 'gt'>('lt');
  const [amount, setAmount] = useState('');
  const [preset, setPreset] = useState('today');
  const [minSample, setMinSample] = useState('5');
  const [busy, setBusy] = useState(false);
  const unit = UNIT[metricId];
  // extras (Nov 11 2026) — rule collision warning: an ACTIVE rule already watches the same metric, comparison and period, so the
  // two would fire overlapping alerts. A warning only — creating stays allowed.
  const [same, setSame] = useState<{ title: string } | null>(null);
  useEffect(() => {
    let live = true;
    posAiBusinessApi.center.rules({ metric: metricId, status: 'active', page: 1, pageSize: 100 })
      .then((r: unknown) => {
        type RuleLite = { title: string; active?: boolean; metricId?: string; operator?: string; preset?: string };
        const items = ((r as { items?: RuleLite[] } | null)?.items ?? []);
        if (live) setSame(items.find((a) => a.active && a.metricId === metricId && a.operator === operator && a.preset === preset) ?? null);
      })
      .catch(() => { if (live) setSame(null); });   // the warning is advice; without it the form still works
    return () => { live = false; };
  }, [metricId, operator, preset]);
  const create = () => {
    const raw = Number(amount); const ms = Math.trunc(Number(minSample));
    if (!title.trim() || amount.trim() === '' || !Number.isFinite(raw) || raw < 0) { onError(bt('bzx.a.formInvalid')); return; }
    if (!Number.isFinite(ms) || ms < 1) { onError(bt('bzx.a.sampleInvalid')); return; }
    setBusy(true);
    posAiBusinessApi.alertCreate({ title: title.trim(), metricId, operator, threshold: unit === 'cents' ? Math.round(raw * 100) : raw, preset, minSampleSize: ms })
      .then(() => { setTitle(''); setAmount(''); onCreated(); }).catch((e) => onError(bzErr(e))).finally(() => setBusy(false));
  };
  return (
    <section className="panel" style={{ padding: 12 }} data-testid="bzx-a-new">
      <div className="p-h">{bt('bzx.a.new')}</div>
      <div className="rvw-filters">
        <label className="rvw-f"><span>{bt('bzx.a.name')}</span><input data-testid="bzx-a-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="rvw-f"><span>{bt('bzx.a.metric')}</span><select data-testid="bzx-a-metric" value={metricId} onChange={(e) => setMetricId(e.target.value as Metric)}>{METRICS.map((m) => <option key={m} value={m}>{bt('bzx.metric.' + m)}</option>)}</select></label>
        <label className="rvw-f"><span>{bt('bzx.a.comparison')}</span><select data-testid="bzx-a-op" value={operator} onChange={(e) => setOperator(e.target.value as 'lt' | 'gt')}><option value="lt">{bt('bzx.op.lt')}</option><option value="gt">{bt('bzx.op.gt')}</option></select></label>
        <label className="rvw-f"><span>{bt('bzx.a.amount.' + unit)}</span><input data-testid="bzx-a-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="rvw-f"><span>{bt('bzx.a.period')}</span><select data-testid="bzx-a-preset" value={preset} onChange={(e) => setPreset(e.target.value)}>{PRESETS.map((p) => <option key={p} value={p}>{bt('bzx.period.' + p)}</option>)}</select></label>
        <label className="rvw-f"><span>{bt('bzx.a.minSample')}</span><input data-testid="bzx-a-min" inputMode="numeric" value={minSample} onChange={(e) => setMinSample(e.target.value)} /></label>
        <button type="button" className="btn" data-testid="bzx-a-create" disabled={busy} onClick={create}>{bt('bzx.a.create')}</button>
      </div>
      {same ? <div className="sub" role="status" style={{ color: 'var(--aps-orange)', marginTop: 6 }} data-testid="bzx-a-collision">{bt('bzx.a.collision', { t: same.title })}</div> : null}
    </section>
  );
}

function Rules({ tick, onChanged, onMsg, onHistory }: { tick: number; onChanged: () => void; onMsg: (m: { tone: 'ok' | 'err'; text: string }) => void; onHistory: (a: { id: string; title: string }) => void }) {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; status: string; metric: string; page: number; pageSize: number }>({ status: 'all', metric: 'all', page: 1, pageSize: 25 });
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [evals, setEvals] = useState<Record<string, any>>({});
  const [del, setDel] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [notify, setNotify] = useState<any>(null);
  // Duplicate (Business Alerts guide): same condition, a new name, created PAUSED so it never fires twice by surprise
  const duplicate = (a: any) => { setBusy(a.id); posAiBusinessApi.alertCreate({ title: bt('bzx.a.copyOf', { t: a.title }).slice(0, 120), metricId: a.metricId, operator: a.operator, threshold: a.threshold, preset: a.preset, minSampleSize: a.minSampleSize })
    .then((c: any) => posAiBusinessApi.alertUpdate(c.id, { active: false })).then(() => { onMsg({ tone: 'ok', text: bt('bzx.a.duplicated', { t: a.title }) }); onChanged(); }).catch((e) => onMsg({ tone: 'err', text: bzErr(e) })).finally(() => setBusy(null)); };
  const load = useCallback(() => { setErr(null); posAiBusinessApi.center.rules({ q: f.q, status: f.status, metric: f.metric, page: f.page, pageSize: f.pageSize }).then(setList).catch((e) => setErr(bzErr(e))); }, [f]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (x: Partial<typeof f>) => setF((y) => ({ ...y, ...x, page: x.page ?? 1 }));
  const evaluate = (id: string) => { setBusy(id); posAiBusinessApi.center.evaluate(id).then((r) => { setEvals((m) => ({ ...m, [id]: r })); onChanged(); }).catch((e) => onMsg({ tone: 'err', text: bzErr(e) })).finally(() => setBusy(null)); };
  const toggle = (a: any) => { setBusy(a.id); posAiBusinessApi.alertUpdate(a.id, { active: !a.active }).then(() => onChanged()).catch((e) => onMsg({ tone: 'err', text: bzErr(e) })).finally(() => setBusy(null)); };
  const remove = () => { const a = del; setBusy(a.id); posAiBusinessApi.alertDelete(a.id).then(() => { setDel(null); onMsg({ tone: 'ok', text: bt('bzx.a.deleted', { t: a.title }) }); onChanged(); }).catch((e) => onMsg({ tone: 'err', text: bzErr(e) })).finally(() => setBusy(null)); };
  const rows: any[] = list?.items ?? [];
  const filtered = !!(f.q || f.status !== 'all' || f.metric !== 'all');
  return (
    <section className="panel rvw-feed" style={{ padding: 12, marginTop: 12 }} data-testid="bzx-a-rules">
      <div className="p-h">{bt('bzx.a.rules')}</div>
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" type="search" data-testid="bzx-a-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={bt('bzx.a.searchPh')} aria-label={bt('bzx.a.searchPh')} />
        <button className="btn" type="submit">{bt('bzx.search')}</button>
        <select data-testid="bzx-a-status" aria-label={bt('bzx.a.status')} value={f.status} onChange={(e) => set({ status: e.target.value })}>{RULE_STATUSES.map((x) => <option key={x} value={x}>{bt('bzx.rst.' + x)}</option>)}</select>
        <select data-testid="bzx-a-mfilter" aria-label={bt('bzx.a.metric')} value={f.metric} onChange={(e) => set({ metric: e.target.value })}>{['all', ...METRICS].map((x) => <option key={x} value={x}>{x === 'all' ? bt('bzx.a.allMetrics') : bt('bzx.metric.' + x)}</option>)}</select>
        {filtered ? <button className="btn ghost" type="button" onClick={() => { setDraft(''); setF({ status: 'all', metric: 'all', page: 1, pageSize: f.pageSize }); }}>{bt('bzx.clear')}</button> : null}
      </form>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{bt('bzx.loading')}</div> : rows.length === 0 ? <Empty title={filtered ? bt('bzx.noMatch') : bt('bzx.a.none')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>
          <th>{bt('bzx.a.col.alert')}</th><th>{bt('bzx.a.col.condition')}</th><th>{bt('bzx.a.col.period')}</th><th>{bt('bzx.a.col.status')}</th><th>{bt('bzx.a.col.actions')}</th></tr></thead>
          <tbody>{rows.map((a) => {
            const ev = evals[a.id];
            return (
              <tr key={a.id} data-testid="bzx-a-row">
                <td><b>{a.title}</b>{a.createdBy ? <div className="sub">{a.createdBy}</div> : null}</td>
                <td>{bt('bzx.cond', { m: bt('bzx.metric.' + a.metricId), op: bt('bzx.op.' + a.operator), v: bzValue(a.threshold, UNIT[a.metricId]) })}<div className="sub">{bt('bzx.a.minSampleN', { n: a.minSampleSize })}</div></td>
                <td>{bt('bzx.period.' + a.preset)}</td>
                <td><span className={'chip ' + (a.active ? 'ok' : '')}>{a.active ? bt('bzx.a.active') : bt('bzx.a.pausedOne')}</span>
                  {a.latest ? <div className="sub" data-testid="bzx-a-latest">{bt('bzx.es.' + a.latest.stateChange)} · {bzWhen(a.latest.evaluatedAt)}{a.latest.triggered && !a.latest.acknowledgedAt ? ` · ${bt('bzx.a.unack')}` : ''}</div> : <div className="sub">{bt('bzx.a.never')}</div>}</td>
                <td>
                  <div className="rvw-actions">
                    <button type="button" className="btn ghost" data-testid="bzx-a-eval" disabled={busy === a.id} onClick={() => evaluate(a.id)}>{bt('bzx.a.evaluate')}</button>
                    <button type="button" className="btn ghost" data-testid="bzx-a-toggle" disabled={busy === a.id} onClick={() => toggle(a)}>{a.active ? bt('bzx.a.pause') : bt('bzx.a.resume')}</button>
                    <button type="button" className="btn ghost" data-testid="bzx-a-edit" disabled={busy === a.id} onClick={() => setEdit(a)}>{bt('bzx.a.edit')}</button>
                    <button type="button" className="btn ghost" data-testid="bzx-a-dup" disabled={busy === a.id} onClick={() => duplicate(a)}>{bt('bzx.a.duplicate')}</button>
                    <button type="button" className="btn ghost" data-testid="bzx-a-hist" onClick={() => onHistory({ id: a.id, title: a.title })}>{bt('bzx.a.viewHistory')}</button>
                    <button type="button" className="btn ghost" data-testid="bzx-a-notify" onClick={() => setNotify(a)}>{bt('bzx.d.open')}</button>
                    <button type="button" className="btn ghost" data-testid="bzx-a-del" disabled={busy === a.id} onClick={() => setDel(a)}>{bt('bzx.a.delete')}</button>
                  </div>
                  {ev && ev.stateChange === 'failed' ? <div className="err" data-testid="bzx-a-result">{bt('bzx.es.failed')}</div> : ev ? <div className="sub" data-testid="bzx-a-result"><b>{bt('bzx.es.' + ev.stateChange)}</b> · {bt('bzx.a.valueVs', { v: bzValue(ev.value, UNIT[ev.metricId]), t: bzValue(ev.threshold, UNIT[ev.metricId]) })} · {bt('bzx.a.sample', { n: bzNum(ev.sampleSize) })} · {bzDays(ev.period)}</div> : null}
                </td>
              </tr>);
          })}</tbody></table></div>)}
      <div className="rvw-pager">
        <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(n) => set({ page: n })} />
        <label className="rvw-f"><span>{bt('bzx.rows')}</span><select value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
      {del ? <FitDialog testId="bzx-a-confirm" title={bt('bzx.a.deleteTitle', { t: del.title })} onClose={() => setDel(null)} busy={busy === del.id}
        footer={<><button className="btn" data-testid="bzx-a-del-yes" onClick={remove}>{bt('bzx.a.delete')}</button><button className="btn ghost" onClick={() => setDel(null)}>{bt('bzx.cancel')}</button></>}>
        <p>{bt('bzx.a.deleteNote')}</p></FitDialog> : null}
      {edit ? <EditDialog alert={edit} onClose={() => setEdit(null)} onSaved={(t) => { setEdit(null); onMsg({ tone: 'ok', text: bt('bzx.a.saved', { t }) }); onChanged(); }} /> : null}
      {notify ? <DeliveryDialog alert={notify} onClose={() => setNotify(null)} onSaved={() => { const t = notify.title; setNotify(null); onMsg({ tone: 'ok', text: bt('bzx.d.saved', { t }) }); }} /> : null}
    </section>
  );
}

function History({ tick, onChanged, alert, onAll }: { tick: number; onChanged: () => void; alert: { id: string; title: string } | null; onAll: () => void }) {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; state: string; page: number; pageSize: number }>({ state: 'all', page: 1, pageSize: 25 });
  const [period, setPeriod] = useState<BzPeriod>({});
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ack, setAck] = useState<any>(null);
  const [note, setNote] = useState('');
  const [ackErr, setAckErr] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); posAiBusinessApi.center.history({ q: f.q, state: f.state, page: f.page, pageSize: f.pageSize, ...period, ...(alert ? { alertId: alert.id } : {}) }).then(setList).catch((e) => setErr(bzErr(e))); }, [f, period, alert]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (x: Partial<typeof f>) => setF((y) => ({ ...y, ...x, page: x.page ?? 1 }));
  const doAck = () => { setAckErr(null); posAiBusinessApi.center.acknowledge(ack.id, note.trim() || undefined).then(() => { setAck(null); setNote(''); onChanged(); }).catch((e) => setAckErr(bzErr(e))); };
  const rows: any[] = list?.items ?? [];
  const filtered = !!(f.q || f.state !== 'all' || period.preset);
  return (
    <section className="panel rvw-feed" style={{ padding: 12, marginTop: 12 }} data-testid="bzx-a-history">
      <div className="p-h">{bt('bzx.a.history')}</div>
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" type="search" data-testid="bzx-h-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={bt('bzx.a.hSearchPh')} aria-label={bt('bzx.a.hSearchPh')} />
        <button className="btn" type="submit">{bt('bzx.search')}</button>
        <select data-testid="bzx-h-state" aria-label={bt('bzx.a.state')} value={f.state} onChange={(e) => set({ state: e.target.value })}>{EVENT_STATES.map((x) => <option key={x} value={x}>{bt('bzx.est.' + x)}</option>)}</select>
        {filtered ? <button className="btn ghost" type="button" onClick={() => { setDraft(''); setPeriod({}); setF({ state: 'all', page: 1, pageSize: f.pageSize }); }}>{bt('bzx.clear')}</button> : null}
      </form>
      {alert ? <div className="rvw-filters" data-testid="bzx-h-one"><span className="chip">{bt('bzx.a.oneAlert', { t: alert.title })}</span><button type="button" className="btn ghost" onClick={onAll}>{bt('bzx.a.showAll')}</button></div> : null}
      <BzPeriodBar value={period} onChange={(p) => { setPeriod(p); set({}); }} today={list?.period?.today} />
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{bt('bzx.loading')}</div> : rows.length === 0 ? <Empty title={filtered ? bt('bzx.noMatch') : bt('bzx.a.noHistory')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>
          <th>{bt('bzx.a.col.when')}</th><th>{bt('bzx.a.col.alert')}</th><th>{bt('bzx.a.col.result')}</th><th>{bt('bzx.a.col.days')}</th><th>{bt('bzx.a.col.state')}</th><th>{bt('bzx.a.col.actions')}</th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id} data-testid="bzx-h-row">
              <td>{bzWhen(e.evaluatedAt)}</td>
              <td>{e.title}</td>
              <td>{e.stateChange === 'failed' ? <span className="err">{e.reason ?? bt('bzx.es.failed')}</span> : <>{bt('bzx.a.valueVs', { v: bzValue(e.value, UNIT[e.metricId]), t: bzValue(e.threshold, UNIT[e.metricId]) })}<div className="sub">{bt('bzx.a.sampleOf', { n: bzNum(e.sampleSize), m: bzNum(e.minSampleSize) })}</div></>}</td>
              <td>{bzDays({ from: e.periodFrom, to: e.periodTo })}</td>
              <td><span className={'chip ' + (STATE_TONE[e.stateChange] ?? '')}>{bt('bzx.es.' + e.stateChange)}</span>
                {e.acknowledgedAt ? <div className="sub">{bt('bzx.a.ackBy', { who: e.acknowledgedBy ?? '—', at: bzWhen(e.acknowledgedAt) })}{e.ackNote ? ` · ${e.ackNote}` : ''}</div> : null}</td>
              <td><div className="rvw-actions">
                {e.triggered && !e.acknowledgedAt ? <button type="button" className="btn ghost" data-testid="bzx-h-ack" onClick={() => { setAck(e); setAckErr(null); }}>{bt('bzx.a.ack')}</button> : null}
                {e.sampleOk ? <button type="button" className="btn ghost" data-testid="bzx-h-why" onClick={() => setWhy(e.id)}>{bt('bzx.a.explain')}</button> : null}
              </div></td>
            </tr>))}</tbody></table></div>)}
      <div className="rvw-pager">
        <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(n) => set({ page: n })} />
        <label className="rvw-f"><span>{bt('bzx.rows')}</span><select value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
      {ack ? <FitDialog testId="bzx-ack" title={bt('bzx.a.ackTitle', { t: ack.title })} onClose={() => setAck(null)}
        footer={<><button className="btn" data-testid="bzx-ack-yes" onClick={doAck}>{bt('bzx.a.ack')}</button><button className="btn ghost" onClick={() => setAck(null)}>{bt('bzx.cancel')}</button></>}>
        <label className="rvw-f block"><span>{bt('bzx.a.ackNote')}</span><textarea data-testid="bzx-ack-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {ackErr ? <div className="err">{ackErr}</div> : null}
      </FitDialog> : null}
      {why ? <ExplainDialog eventId={why} onClose={() => setWhy(null)} /> : null}
    </section>
  );
}

function EditDialog({ alert, onClose, onSaved }: { alert: any; onClose: () => void; onSaved: (title: string) => void }) {
  const unit = UNIT[alert.metricId];
  const [title, setTitle] = useState<string>(alert.title);
  const [amount, setAmount] = useState(String(unit === 'cents' ? alert.threshold / 100 : alert.threshold));
  const [preset, setPreset] = useState<string>(alert.preset);
  const [minSample, setMinSample] = useState(String(alert.minSampleSize));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    const raw = Number(amount); const ms = Math.trunc(Number(minSample));
    if (!title.trim() || amount.trim() === '' || !Number.isFinite(raw) || raw < 0) { setErr(bt('bzx.a.formInvalid')); return; }
    if (!Number.isFinite(ms) || ms < 1) { setErr(bt('bzx.a.sampleInvalid')); return; }
    setBusy(true); setErr(null);
    posAiBusinessApi.alertUpdate(alert.id, { title: title.trim(), threshold: unit === 'cents' ? Math.round(raw * 100) : raw, preset, minSampleSize: ms })
      .then(() => onSaved(title.trim())).catch((e) => setErr(bzErr(e))).finally(() => setBusy(false));
  };
  return (
    <FitDialog testId="bzx-edit" title={bt('bzx.a.editTitle', { t: alert.title })} onClose={onClose} busy={busy}
      footer={<><button className="btn" data-testid="bzx-edit-save" disabled={busy} onClick={save}>{bt('bzx.a.save')}</button><button className="btn ghost" onClick={onClose}>{bt('bzx.cancel')}</button></>}>
      <div className="rvw-filters">
        <label className="rvw-f"><span>{bt('bzx.a.name')}</span><input data-testid="bzx-edit-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="rvw-f"><span>{bt('bzx.a.amount.' + unit)}</span><input data-testid="bzx-edit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="rvw-f"><span>{bt('bzx.a.period')}</span><select data-testid="bzx-edit-preset" value={preset} onChange={(e) => setPreset(e.target.value)}>{PRESETS.map((p) => <option key={p} value={p}>{bt('bzx.period.' + p)}</option>)}</select></label>
        <label className="rvw-f"><span>{bt('bzx.a.minSample')}</span><input data-testid="bzx-edit-min" inputMode="numeric" value={minSample} onChange={(e) => setMinSample(e.target.value)} /></label>
      </div>
      {err ? <div className="err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function ExplainDialog({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let on = true; posAiBusinessApi.center.explain(eventId).then((x) => on && setD(x)).catch((e) => on && setErr(bzErr(e))); return () => { on = false; }; }, [eventId]);
  const x = d?.explanation;
  return (
    <FitDialog wide testId="bzx-explain" title={bt('bzx.a.explainTitle')} onClose={onClose} footer={<>{d ? <Link className="btn ghost" to={d.sourceRoute}>{bt('bzx.a.openSource')}</Link> : null}<button className="btn ghost" onClick={onClose}>{bt('bzx.close')}</button></>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{bt('bzx.loading')}</div> : <>
        <p><b>{bt('bzx.cond', { m: bt('bzx.metric.' + d.metricId), op: bt('bzx.op.' + d.operator), v: bzValue(d.threshold, UNIT[d.metricId]) })}</b> — {bt('bzx.a.valueWas', { v: bzValue(d.value, UNIT[d.metricId]) })} · {bzDays(d.period)}</p>
        {d.kind === 'revenue_bridge' && x ? <table className="tbl" data-testid="bzx-bridge"><tbody>
          <tr><td>{bt('bzx.x.current')}</td><td className="num">{bzValue(x.currentNetCents, 'cents')}</td></tr>
          <tr><td>{bt('bzx.x.previous')}</td><td className="num">{bzValue(x.previousNetCents, 'cents')}</td></tr>
          <tr><td><b>{bt('bzx.x.netChange')}</b></td><td className="num"><b>{bzValue(x.changeCents, 'cents')}</b>{x.changePercent != null ? ` (${x.changePercent}%)` : ''}</td></tr>
          {(x.contributors ?? []).map((c: any, i: number) => <tr key={i} data-testid="bzx-contrib"><td>{c.factor}<div className="sub">{c.note}</div></td><td className="num">{bzValue(c.deltaCents, 'cents')}</td></tr>)}
          {(x.caveats ?? []).map((c: string, i: number) => <tr key={'c' + i}><td colSpan={2} className="sub">{c}</td></tr>)}
        </tbody></table> : null}
        {d.kind === 'appointment_funnel' && x?.funnel ? <table className="tbl" data-testid="bzx-funnel"><tbody>
          {['totalBookings', 'completed', 'cancelled', 'noShow', 'cancelledPercent', 'noShowPercent'].filter((k) => x.funnel[k] != null).map((k) => <tr key={k}><td>{bt('bzx.x.' + k)}</td><td className="num">{k.endsWith('Percent') ? `${x.funnel[k]}%` : bzNum(x.funnel[k])}</td></tr>)}
        </tbody></table> : null}
        <p className="sub">{bt('bzx.a.notProof')}</p>
      </>}
    </FitDialog>
  );
}

function Anomaly() {
  const [d, setD] = useState<any | 'loading' | null>(null);
  const run = () => { setD('loading'); posAiBusinessApi.center.anomaly().then(setD).catch((e) => setD({ error: bzErr(e) })); };
  return (
    <section className="panel" style={{ padding: 12, marginTop: 12 }} data-testid="bzx-anomaly">
      <div className="p-h">{bt('bzx.an.title')}</div>
      <p className="sub">{bt('bzx.an.sub')}</p>
      <button type="button" className="btn ghost" data-testid="bzx-an-run" onClick={run}>{bt('bzx.an.run')}</button>
      {d === 'loading' ? <div className="state">{bt('bzx.loading')}</div> : d?.error ? <div className="err">{d.error}</div> : d ? (
        <table className="tbl" style={{ marginTop: 8 }}><thead><tr><th>{bt('bzx.an.metric', { day: d.weekday })}</th><th className="num">{bt('bzx.an.actual')}</th><th className="num">{bt('bzx.an.baseline')}</th><th>{bt('bzx.an.result')}</th></tr></thead>
          <tbody>{d.items.map((x: any) => (
            <tr key={x.metric} data-testid={`bzx-an-${x.metric}`}><td>{bt('bzx.vm.' + x.metric)}</td><td className="num">{bzValue(x.actual, x.metric === 'ticketsCount' ? 'count' : 'cents')}</td>
              <td className="num">{x.baseline == null ? '—' : bzValue(x.baseline, x.metric === 'ticketsCount' ? 'count' : 'cents')}</td>
              <td>{bt('bzx.an.st.' + x.status, { n: x.comparableDays })}</td></tr>))}</tbody></table>) : null}
      {d && d !== 'loading' && !d.error ? <p className="sub">{bt('bzx.an.note')}</p> : null}
    </section>
  );
}
