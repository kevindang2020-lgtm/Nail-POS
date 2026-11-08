// POSAiReportsScreen.tsx — AI Center → AI Business Reports (/tenant/ai/business/reports). AI Business Reports guide (Nov 3 2026).
// Keeps the photographed page — the title, "the numbers match your reports", the four gold buttons (Daily brief · Weekly summary ·
// Monthly review · Branch comparison) and the Report / Generated / Status history — and makes it usable:
//   • each button asks which period (today / yesterday, this week, this month / quarter / year …) and the report records the EXACT
//     salon days it covers and the Sales Report's figures for them;
//   • "completed" and "expired" are two different things: generation (queued / running / completed / failed) and the 7-day content
//     window (the report is kept, its content is no longer shown — regenerate for current figures);
//   • history: search · type · status · generated-date presets + From/To month calendar · numbered pages, newest first;
//   • View (labelled headline figures, the period, the sections), Verify Numbers (the report's figures vs the Sales Report now, same
//     days), Regenerate (a new report; the old one is kept);
//   • Check AI Business Reports System (read-only).
// Before: the canonical Sales Report ignored the period, so every report showed the last 7 days — fixed at the source.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KpiCard, Pager, Empty, ErrorRetry, FitDialog } from '../components/FitKit';
import { BzPeriodBar, BzHealthButton, bt, bzErr, bzWhen, bzNum, bzValue, bzDays, type BzPeriod } from '../components/BusinessKit';
import { posAiBusinessApi } from '../api/posAiBusinessApi';

const TYPES = ['daily_brief', 'weekly_summary', 'monthly_review', 'branch_comparison'] as const;
const PERIODS: Record<string, string[]> = { daily_brief: ['today', 'yesterday'], weekly_summary: ['week'], monthly_review: ['month', 'quarter', 'year'], branch_comparison: ['week', 'month', 'quarter'] };
const STATUSES = ['all', 'viewable', 'content_expired', 'queued', 'running', 'completed', 'failed'];
const TONE: Record<string, string> = { completed: 'ok', failed: 'bad', queued: '', running: '' };

export function POSAiReportsScreen() {
  const [tick, setTick] = useState(0);
  const [sum, setSum] = useState<any>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; type: string; status: string; sort: string; page: number; pageSize: number }>({ type: 'all', status: 'all', sort: 'newest', page: 1, pageSize: 25 });
  const [period, setPeriod] = useState<BzPeriod>({});
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gen, setGen] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const loadSum = useCallback(() => { setSumErr(null); posAiBusinessApi.center.reportSummary().then(setSum).catch((e) => setSumErr(bzErr(e))); }, []);
  useEffect(() => { loadSum(); }, [loadSum, tick]);
  const load = useCallback(() => {
    setErr(null);
    posAiBusinessApi.center.reports({ q: f.q, type: f.type === 'all' ? undefined : f.type, status: f.status, sort: f.sort, page: f.page, pageSize: f.pageSize, ...period }).then(setList).catch((e) => setErr(bzErr(e)));
  }, [f, period]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (x: Partial<typeof f>) => setF((y) => ({ ...y, ...x, page: x.page ?? 1 }));
  const refresh = () => setTick((n) => n + 1);
  const rows: any[] = list?.items ?? [];
  const filtered = !!(f.q || f.type !== 'all' || f.status !== 'all' || period.preset);
  return (
    <div className="work rvw" data-testid="bzx-reports">
      <div className="rvw-head">
        <div className="vh"><h1>{bt('bzx.r.title')}</h1><div className="sub">{bt('bzx.r.sub')}</div></div>
        <div className="rvw-actions">
          <button type="button" className="btn ghost" data-testid="bzx-refresh" onClick={refresh}>{bt('bzx.refresh')}</button>
          <BzHealthButton area="reports" run={posAiBusinessApi.center.reportCheck} />
        </div>
      </div>
      {sumErr ? <ErrorRetry message={sumErr} onRetry={loadSum} /> : null}
      <div className="rvw-kpis" data-testid="bzx-r-kpis">
        <KpiCard testId="bzx-r-total" label={bt('bzx.r.kpi.total')} value={sum ? bzNum(sum.total) : '—'} loading={!sum && !sumErr} />
        <KpiCard testId="bzx-r-processing" label={bt('bzx.r.kpi.processing')} value={sum ? bzNum(sum.queued + sum.running) : '—'} sub={sum?.stuck ? bt('bzx.r.kpi.stuck', { n: sum.stuck }) : undefined} tone={sum?.stuck ? 'bad' : undefined} loading={!sum && !sumErr} />
        <KpiCard testId="bzx-r-failed" label={bt('bzx.r.kpi.failed')} value={sum ? bzNum(sum.failed) : '—'} tone={sum?.failed ? 'warn' : undefined} loading={!sum && !sumErr} />
        <KpiCard testId="bzx-r-viewable" label={bt('bzx.r.kpi.viewable')} value={sum ? bzNum(sum.viewable) : '—'} loading={!sum && !sumErr} />
        <KpiCard testId="bzx-r-expired" label={bt('bzx.r.kpi.expired')} value={sum ? bzNum(sum.contentExpired) : '—'} sub={bt('bzx.r.kpi.expiredSub', { n: sum?.contentDays ?? 7 })} loading={!sum && !sumErr} />
      </div>

      <section className="panel" style={{ padding: 12 }}>
        <div className="p-h">{bt('bzx.r.generate')}</div>
        <div className="rvw-actions" data-testid="bzx-gen-types">{TYPES.map((t) => <button key={t} type="button" className="btn" data-testid={`bzx-gen-${t}`} onClick={() => setGen(t)}>{bt('bzx.type.' + t)}</button>)}</div>
      </section>

      <section className="panel rvw-feed" style={{ padding: 12, marginTop: 12 }} data-testid="bzx-r-history">
        <div className="p-h">{bt('bzx.r.history')}{list ? <span className="sub"> · {bt('bzx.matching', { n: bzNum(list.total) })}</span> : null}</div>
        <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
          <input className="rvw-search" type="search" data-testid="bzx-r-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={bt('bzx.r.searchPh')} aria-label={bt('bzx.r.searchPh')} />
          <button className="btn" type="submit">{bt('bzx.search')}</button>
          <select data-testid="bzx-r-type" aria-label={bt('bzx.r.type')} value={f.type} onChange={(e) => set({ type: e.target.value })}>
            {['all', ...TYPES].map((x) => <option key={x} value={x}>{x === 'all' ? bt('bzx.r.allTypes') : bt('bzx.type.' + x)}</option>)}</select>
          <select data-testid="bzx-r-status" aria-label={bt('bzx.r.status')} value={f.status} onChange={(e) => set({ status: e.target.value })}>
            {STATUSES.map((x) => <option key={x} value={x}>{bt('bzx.rs.' + x)}</option>)}</select>
          <select data-testid="bzx-r-sort" aria-label={bt('bzx.sort')} value={f.sort} onChange={(e) => set({ sort: e.target.value })}>
            {['newest', 'oldest'].map((x) => <option key={x} value={x}>{bt('bzx.sort.' + x)}</option>)}</select>
          {filtered ? <button className="btn ghost" type="button" data-testid="bzx-r-clear" onClick={() => { setDraft(''); setPeriod({}); setF({ type: 'all', status: 'all', sort: 'newest', page: 1, pageSize: f.pageSize }); }}>{bt('bzx.clear')}</button> : null}
        </form>
        <div className="sub">{bt('bzx.r.generatedFilter')}</div>
        <BzPeriodBar value={period} onChange={(p) => { setPeriod(p); set({}); }} today={list?.period?.today} />
        {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{bt('bzx.loading')}</div> : rows.length === 0 ? <Empty title={filtered ? bt('bzx.noMatch') : bt('bzx.r.none')} /> : (
          <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>
            <th>{bt('bzx.r.col.report')}</th><th>{bt('bzx.r.col.generated')}</th><th>{bt('bzx.r.col.status')}</th><th>{bt('bzx.r.col.actions')}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} data-testid="bzx-r-row">
                <td><b>{bt('bzx.type.' + r.reportType)}</b><div className="sub">{r.period ? bzDays(r.period) : bt('bzx.period.' + r.preset)}{r.requestedBy ? ` · ${r.requestedBy}` : ''}</div></td>
                <td>{bzWhen(r.completedAt ?? r.createdAt)}</td>
                <td><span className={'chip ' + (TONE[r.status] ?? '')}>{bt('bzx.rs.' + r.status)}</span>
                  <div className="sub" data-testid="bzx-r-avail">{bt('bzx.avail.' + r.availability)}</div>{r.error ? <div className="sub">{r.error}</div> : null}</td>
                <td><button type="button" className="btn ghost" data-testid="bzx-r-open" onClick={() => setOpen(r.id)}>{bt('bzx.r.view')}</button></td>
              </tr>))}</tbody></table></div>)}
        <div className="rvw-pager">
          <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(n) => set({ page: n })} />
          <label className="rvw-f"><span>{bt('bzx.rows')}</span><select data-testid="bzx-r-rows" value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
      </section>
      {gen ? <GenerateDialog type={gen} onClose={() => setGen(null)} onDone={(id) => { setGen(null); refresh(); setOpen(id); }} /> : null}
      {open ? <ReportDialog id={open} onClose={() => setOpen(null)} onNew={(id) => { refresh(); setOpen(id); }} /> : null}
    </div>
  );
}

function GenerateDialog({ type, onClose, onDone }: { type: string; onClose: () => void; onDone: (id: string) => void }) {
  const [preset, setPreset] = useState(PERIODS[type][0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = () => { setBusy(true); setErr(null); posAiBusinessApi.center.generate(type, preset).then((r) => onDone(r.id)).catch((e) => setErr(bzErr(e))).finally(() => setBusy(false)); };
  return (
    <FitDialog testId="bzx-gen" title={bt('bzx.type.' + type)} onClose={onClose} busy={busy}
      footer={<><button className="btn" data-testid="bzx-gen-go" disabled={busy} onClick={go}>{busy ? bt('bzx.r.generating') : bt('bzx.r.generateNow')}</button><button className="btn ghost" onClick={onClose}>{bt('bzx.close')}</button></>}>
      <p className="sub">{bt('bzx.r.genNote')}</p>
      <div className="rvw-dates">{PERIODS[type].map((p) => <button key={p} type="button" className={'btn ghost' + (preset === p ? ' on' : '')} data-testid={`bzx-gen-p-${p}`} onClick={() => setPreset(p)}>{bt('bzx.period.' + p)}</button>)}</div>
      {err ? <div className="err" data-testid="bzx-gen-err">{err}</div> : null}
    </FitDialog>
  );
}

function ReportDialog({ id, onClose, onNew }: { id: string; onClose: () => void; onNew: (id: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState<any | 'loading' | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => { let on = true; setD(null); setErr(null); setV(null); posAiBusinessApi.center.report(id).then((x) => on && setD(x)).catch((e) => on && setErr(bzErr(e))); return () => { on = false; }; }, [id, tick]);
  const verify = () => { setV('loading'); posAiBusinessApi.center.verify(id).then(setV).catch((e) => setV({ error: bzErr(e) })); };
  const regen = () => { setBusy(true); posAiBusinessApi.center.regenerate(id).then((r) => onNew(r.id)).catch((e) => setErr(bzErr(e))).finally(() => setBusy(false)); };
  return (
    <FitDialog wide testId="bzx-report" title={d ? bt('bzx.type.' + d.reportType) : bt('bzx.loading')} onClose={onClose} busy={busy}
      footer={<>
        {d?.status === 'completed' ? <button className="btn ghost" data-testid="bzx-verify" onClick={verify}>{bt('bzx.r.verify')}</button> : null}
        {d ? <button className="btn ghost" data-testid="bzx-regen" disabled={busy} onClick={regen}>{bt('bzx.r.regenerate')}</button> : null}
        <button className="btn ghost" onClick={onClose}>{bt('bzx.close')}</button></>}>
      {err ? <ErrorRetry message={err} onRetry={() => setTick((n) => n + 1)} /> : !d ? <div className="state">{bt('bzx.loading')}</div> : <>
        <p className="sub" data-testid="bzx-report-meta">{d.period ? bt('bzx.r.covers', { d: bzDays(d.period), tz: d.period.timeZone }) : bt('bzx.r.noPeriod', { p: bt('bzx.period.' + d.preset) })}
          {d.period?.partial ? ` ${bt('bzx.r.partial')}` : ''} · {bt('bzx.rs.' + d.status)} · {bzWhen(d.completedAt ?? d.createdAt)}</p>
        {d.availability === 'content_expired' ? <div className="sub" data-testid="bzx-expired">{bt('bzx.r.expiredNote')}</div> : null}
        {d.availability === 'failed' ? <div className="err">{d.error ?? bt('bzx.avail.failed')}</div> : null}
        {d.headline?.length ? <table className="tbl" data-testid="bzx-headline"><tbody>{d.headline.map((h: any) => (
          <tr key={h.key}><td>{bt('bzx.m.' + h.key)}</td><td className="num"><b>{bzValue(h.value, h.unit)}</b></td></tr>))}</tbody></table> : null}
        {d.content ? <details style={{ marginTop: 8 }}><summary className="sub">{bt('bzx.r.fullData', { s: d.sections.join(', ') })}</summary>
          <pre className="panel" style={{ padding: 10, overflow: 'auto', fontSize: 12, maxHeight: 320 }}>{JSON.stringify(d.content, null, 2)}</pre></details> : null}
        {v ? (v === 'loading' ? <div className="state">{bt('bzx.r.verifying')}</div> : v.error ? <div className="err">{v.error}</div> : (
          <div data-testid="bzx-verify-result" style={{ marginTop: 10 }}>
            <p><b>{bt('bzx.vs.' + v.status)}</b>{v.reason ? ` — ${bt('bzx.vr.' + v.reason)}` : ''}</p>
            {v.items?.length ? <table className="tbl"><thead><tr><th>{bt('bzx.r.metric')}</th><th className="num">{bt('bzx.r.inReport')}</th><th className="num">{bt('bzx.r.now')}</th><th className="num">{bt('bzx.r.diff')}</th></tr></thead>
              <tbody>{v.items.map((x: any) => (
                <tr key={x.metric} data-testid={`bzx-v-${x.metric}`}><td>{bt('bzx.vm.' + x.metric)}</td><td className="num">{bzValue(x.inReport, x.metric === 'ticketsCount' ? 'count' : 'cents')}</td>
                  <td className="num">{bzValue(x.salesReportNow, x.metric === 'ticketsCount' ? 'count' : 'cents')}</td><td className="num">{x.matched ? '✓' : bzValue(x.difference, x.metric === 'ticketsCount' ? 'count' : 'cents')}</td></tr>))}</tbody></table> : null}
            {v.sourceRoute ? <Link to="/tenant/reports/sales">{bt('bzx.r.openSales')}</Link> : null}
          </div>)) : null}
        <p className="sub">{bt('bzx.r.matchNote')}</p>
      </>}
    </FitDialog>
  );
}
