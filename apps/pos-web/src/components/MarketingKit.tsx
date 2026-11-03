// MarketingKit.tsx — shared parts of the AI Marketing Assistant family (Nov 3 2026 guides): the period bar (presets + From/To month
// calendar, salon time), Check AI Marketing System, the eligibility funnel, the cost / budget estimate and the status chips. Every
// number comes from /pos/ai-marketing/center or Campaign Center; nothing here sends, schedules or approves a campaign.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog, ErrorRetry, Pager, Empty } from './FitKit';
import { RangeCalendar, isForbidden } from './FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtMoney, fmtInZone } from '../i18n/format';
import { posAIMarketingApi, type MkKind } from '../api/posAIMarketingApi';
import { posCampaignCenterApi } from '../api/posCampaignCenterApi';

export const mt = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
export const mkWhen = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const mkMoney = (c: number | null | undefined) => (c == null ? '—' : fmtMoney(c));
export const mkNum = (n: number | null | undefined) => (n == null ? '—' : fmtNumber(n));
export function mkErr(e: unknown): string {
  if (isForbidden(e)) return mt('amk.err.forbidden');
  return errorTextOf(e, mt('amk.loadFailed'));
}
const TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
export const MK_PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year', 'all'] as const;
export type MkPeriod = { preset: string; from?: string; to?: string };

export function MkPeriodBar({ value, onChange, today, testId = 'amk-period' }: { value: MkPeriod; onChange: (p: MkPeriod) => void; today?: string; testId?: string }) {
  const [cal, setCal] = useState(false);
  return (
    <div className="rvw-dates" data-testid={testId} style={{ position: 'relative' }}>
      {MK_PRESETS.map((x) => <button key={x} type="button" className={'btn ghost' + (value.preset === x ? ' on' : '')} data-testid={`amk-preset-${x}`} onClick={() => onChange({ preset: x })}>{mt('amk.preset.' + x)}</button>)}
      <button type="button" className={'btn ghost' + (value.preset === 'custom' ? ' on' : '')} data-testid="amk-custom" onClick={() => setCal(true)}>
        {value.preset === 'custom' ? `${value.from} → ${value.to}` : mt('amk.preset.custom')}</button>
      {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: value.from, to: value.to }} today={today ?? new Date().toISOString().slice(0, 10)}
        onApply={(r) => { onChange({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { onChange({ preset: 'month' }); setCal(false); }} /></div> : null}
    </div>
  );
}

/** "Check AI Marketing System" — read-only; each check says what it looked at, its state and when it last passed */
export function MkHealthButton({ label }: { label?: string }) {
  const [h, setH] = useState<any | 'loading' | null>(null);
  const run = () => { setH('loading'); posAIMarketingApi.center.check().then(setH).catch((e) => setH({ error: mkErr(e) })); };
  return (<>
    <button type="button" className="btn ghost" data-testid="amk-check" onClick={run}>{label ?? mt('amk.check')}</button>
    {h ? <FitDialog wide testId="amk-health" title={mt('amk.check')} onClose={() => setH(null)}
      subtitle={h !== 'loading' && !h.error ? mt('amk.health.overall', { s: mt('amk.health.' + h.overall), at: mkWhen(h.checkedAt) }) : undefined}
      footer={<><button className="btn ghost" onClick={run}>{mt('amk.health.retry')}</button><button className="btn ghost" onClick={() => setH(null)}>{mt('amk.close')}</button></>}>
      {h === 'loading' ? <div className="state">{mt('amk.health.running')}</div> : h.error ? <div className="err">{h.error}</div> : <>
        <p className="sub">{mt('amk.health.readOnly')}{h.reused ? ` ${mt('amk.health.recent')}` : ''}</p>
        {(h.checks ?? []).map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`amk-chk-${x.key}`}>
            <div><span className={'chip ' + (TONE[x.state] ?? '')}>{mt('amk.health.' + x.state)}</span> <b>{mt('amk.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{mt(`amk.health.d.${x.key}.${x.state}`)}</div>
            <div className="sub">{[mt('amk.health.part', { c: mt('amk.comp.' + x.component) }), x.lastPassedAt ? mt('amk.health.lastPassed', { at: mkWhen(x.lastPassedAt) }) : mt('amk.health.neverPassed')].join(' · ')}</div>
          </div>))}
      </>}
    </FitDialog> : null}
  </>);
}

/** the eligibility funnel: matched → each exclusion reason → eligible, per channel; unique people when both channels */
export function MkFunnel({ kind, channel }: { kind: MkKind; channel: 'sms' | 'email' | 'both' }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { let on = true; setD(null); setErr(null); posAIMarketingApi.center.eligibility(kind, channel).then((x) => on && setD(x)).catch((e) => on && setErr(mkErr(e))); return () => { on = false; }; }, [kind, channel, tick]);
  if (err) return <ErrorRetry message={err} onRetry={() => setTick((n) => n + 1)} />;
  if (!d) return <div className="state">{mt('amk.loading')}</div>;
  return (
    <div data-testid="amk-funnel">
      {(d.channels ?? []).map((c: any) => (
        <div key={c.channel} className="amk-funnel" data-testid={`amk-funnel-${c.channel}`}>
          <div className="p-h">{mt('amk.channel.' + c.channel)}</div>
          <div className="sub">{c.criteria}</div>
          <table className="tbl"><tbody>
            <tr><td>{mt('amk.f.matched')}</td><td className="num">{mkNum(c.matched)}</td></tr>
            {Object.entries(c.excluded ?? {}).map(([r, n]) => <tr key={r} data-testid={`amk-ex-${r}`}><td className="sub">− {mt('amk.reason.' + r)}</td><td className="num">{mkNum(n as number)}</td></tr>)}
            <tr><td><b>{mt('amk.f.eligible')}</b></td><td className="num"><b data-testid={`amk-eligible-${c.channel}`}>{mkNum(c.eligible)}</b></td></tr>
          </tbody></table>
        </div>))}
      {d.uniqueEligible != null ? <p data-testid="amk-unique"><b>{mt('amk.f.unique', { n: fmtNumber(d.uniqueEligible) })}</b></p> : null}
      <p className="sub">{mt('amk.f.recheck')}</p>
    </div>
  );
}

/** characters · encoding · segments · price · estimated cost · budget check (the same formula Campaign Center previews) */
export function MkEstimate({ channel, body, recipients, budgetCents, onResult }: { channel: 'sms' | 'email'; body: string; recipients: number; budgetCents?: number | null; onResult?: (r: any) => void }) {
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const cb = useRef(onResult); cb.current = onResult;
  useEffect(() => {
    let on = true;
    const h = setTimeout(() => {
      posAIMarketingApi.center.estimate({ channel, body, recipients, budgetCents: budgetCents ?? null })
        .then((x) => { if (on) { setR(x); setErr(null); cb.current?.(x); } }).catch((e) => on && setErr(mkErr(e)));
    }, 300);
    return () => { on = false; clearTimeout(h); };
  }, [channel, body, recipients, budgetCents]);
  if (err) return <div className="err">{err}</div>;
  if (!r) return null;
  return (
    <div className="amk-est" data-testid="amk-estimate">
      {channel === 'sms' ? <span>{mt('amk.est.sms', { c: fmtNumber(r.characters), e: r.encoding ?? '—', s: fmtNumber(r.segmentsPerMessage ?? 0) })}</span> : null}
      <span>{mt('amk.est.recipients', { n: fmtNumber(r.recipients) })}</span>
      <span data-testid="amk-est-cost">{r.estimatedCostCents != null ? mt('amk.est.cost', { m: mkMoney(r.estimatedCostCents), s: fmtNumber(r.estimatedSegments ?? 0) }) : mt('amk.est.note.' + r.costNote)}</span>
      {r.withinBudget === false ? <span className="chip bad" data-testid="amk-over-budget">{mt('amk.est.overBudget', { b: mkMoney(r.budgetCents) })}</span> : r.withinBudget === true ? <span className="chip ok">{mt('amk.est.withinBudget')}</span> : null}
      {r.unresolved?.length ? <div className="err" data-testid="amk-unresolved">{mt('amk.est.unresolved', { t: r.unresolved.join(', ') })}</div> : null}
      {r.offerFilledAtApproval ? <div className="sub">{mt('amk.est.offer')}</div> : null}
    </div>
  );
}

const CC_PRESET: Record<string, string> = { today: 'today', week: 'week', month: 'month', year: 'year', all: 'all' };
const STATUSES = ['', 'draft', 'awaiting_approval', 'approved', 'scheduled', 'sending', 'completed', 'cancelled'];
/** Campaign Center's own list — search · status · channel · period · numbered pages, newest first; rows open in Campaign Center */
export function CampaignLibrary({ tick = 0, title, onOpen }: { tick?: number; title?: string; onOpen?: (c: any) => void }) {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; status: string; channel: string; preset: string; from?: string; to?: string; page: number; pageSize: number }>({ status: '', channel: '', preset: 'all', page: 1, pageSize: 10 });
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setErr(null);
    posCampaignCenterApi.list({ q: f.q, status: f.status || undefined, channel: f.channel || undefined, preset: f.preset, from: f.from, to: f.to, page: f.page, pageSize: f.pageSize, sort: 'newest' })
      .then(setList).catch((e) => setErr(mkErr(e)));
  }, [f]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (x: Partial<typeof f>) => setF((y) => ({ ...y, ...x, page: x.page ?? 1 }));
  const rows: any[] = list?.items ?? [];
  const filtered = !!(f.q || f.status || f.channel || f.preset !== 'all');
  return (
    <section className="panel rvw-feed" style={{ padding: 12, marginTop: 12 }} data-testid="amk-campaigns">
      <div className="p-h">{title ?? mt('amk.lib.title')}</div>
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" type="search" data-testid="amk-lib-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={mt('amk.lib.searchPh')} aria-label={mt('amk.lib.searchPh')} />
        <button className="btn" type="submit">{mt('amk.search')}</button>
        <select data-testid="amk-lib-status" aria-label={mt('amk.lib.status')} value={f.status} onChange={(e) => set({ status: e.target.value })}>
          {STATUSES.map((x) => <option key={x} value={x}>{mt('amk.cst.' + (x || 'all'))}</option>)}</select>
        <select data-testid="amk-lib-channel" aria-label={mt('amk.lib.channel')} value={f.channel} onChange={(e) => set({ channel: e.target.value })}>
          {['', 'sms', 'email'].map((x) => <option key={x} value={x}>{mt('amk.channel.' + (x || 'all'))}</option>)}</select>
        {filtered ? <button className="btn ghost" type="button" data-testid="amk-lib-clear" onClick={() => { setDraft(''); setF({ status: '', channel: '', preset: 'all', page: 1, pageSize: f.pageSize }); }}>{mt('amk.clear')}</button> : null}
      </form>
      <div className="rvw-dates">
        {Object.keys(CC_PRESET).map((x) => <button key={x} type="button" className={'btn ghost' + (f.preset === x ? ' on' : '')} data-testid={`amk-lib-preset-${x}`} onClick={() => set({ preset: x, from: undefined, to: undefined })}>{mt('amk.preset.' + x)}</button>)}
        <LibCustom value={f} onApply={(from, to) => set({ preset: 'custom', from, to })} today={list?.period?.today} />
      </div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{mt('amk.loading')}</div> : rows.length === 0 ? <Empty title={filtered ? mt('amk.lib.noMatch') : mt('amk.lib.none')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr>
          <th>{mt('amk.lib.col.name')}</th><th>{mt('amk.lib.col.status')}</th><th>{mt('amk.lib.col.channel')}</th><th>{mt('amk.lib.col.audience')}</th>
          <th>{mt('amk.lib.col.sent')}</th><th>{mt('amk.lib.col.booked')}</th><th>{mt('amk.lib.col.cost')}</th><th>{mt('amk.lib.col.created')}</th></tr></thead>
          <tbody>{rows.map((c) => (
            <tr key={c.id} data-testid="amk-lib-row">
              <td>{onOpen ? <button type="button" className="linkish" data-testid="amk-lib-open" onClick={() => onOpen(c)}>{c.name}</button> : <Link to={`/tenant/marketing/campaigns?q=${encodeURIComponent(c.id)}`}>{c.name}</Link>}{c.origin === 'assistant' ? <span className="chip" style={{ marginLeft: 6 }}>{mt('amk.lib.assistant')}</span> : null}</td>
              <td>{mt('amk.cst.' + c.displayStatus)}{c.outcome ? <div className="sub">{mt('amk.outcome.' + c.outcome)}</div> : null}</td>
              <td>{mt('amk.channel.' + c.channel)}</td>
              <td>{c.counts.selected == null ? '—' : c.counts.selectedIsEstimate ? mt('amk.lib.estimate', { n: mkNum(c.counts.selected) }) : mt('amk.lib.eligibleOf', { e: mkNum(c.counts.eligible), n: mkNum(c.counts.selected) })}</td>
              <td>{mt('amk.lib.sentCell', { s: mkNum(c.counts.submitted), d: mkNum(c.counts.delivered) })}</td>
              <td>{mkNum(c.counts.booked)}</td>
              <td>{c.counts.actualCostCents == null ? (c.counts.submitted ? mt('amk.notReported') : mkMoney(0)) : mkMoney(c.counts.actualCostCents)}{c.budgetCents ? <div className="sub">{mt('amk.lib.budget', { b: mkMoney(c.budgetCents) })}</div> : null}</td>
              <td>{mkWhen(c.createdAt)}</td>
            </tr>))}</tbody></table></div>)}
      <div className="rvw-pager">
        <Pager info={list?.pagination ?? null} onPage={(n) => set({ page: n })} />
        <label className="rvw-f"><span>{mt('amk.rows')}</span><select data-testid="amk-lib-rows" value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '20', '50'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
    </section>
  );
}
function LibCustom({ value, onApply, today }: { value: { preset: string; from?: string; to?: string }; onApply: (from: string, to: string) => void; today?: string }) {
  const [open, setOpen] = useState(false);
  return (<span style={{ position: 'relative' }}>
    <button type="button" className={'btn ghost' + (value.preset === 'custom' ? ' on' : '')} data-testid="amk-lib-custom" onClick={() => setOpen(true)}>{value.preset === 'custom' ? `${value.from} → ${value.to}` : mt('amk.preset.custom')}</button>
    {open ? <div className="rvw-cal"><RangeCalendar initial={{ from: value.from, to: value.to }} today={today ?? new Date().toISOString().slice(0, 10)}
      onApply={(r) => { onApply(r.from, r.to); setOpen(false); }} onCancel={() => setOpen(false)} onClear={() => setOpen(false)} /></div> : null}
  </span>);
}
