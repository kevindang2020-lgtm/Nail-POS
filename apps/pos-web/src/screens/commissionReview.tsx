// commissionReview.tsx — F1 + F2 (Finish the Five, 30 Oct 2026): the PERSISTED Commission Discrepancy Review on the
// Commission Report. Filters / search → findings list (newest first, its own numbered pages) → click a finding → slide-over
// (evidence, source links, investigator, notes, timeline, current status) → only the actions the server's state machine
// allows. Run Check scans the period with every check (incl. rate vs historical configuration and refund reversal) and
// shows the last run. Every action is confirmed by the server (expectedVersion; a stale version reloads); nothing here
// pays, deducts, refunds or edits money — a real correction goes through Payroll, linked separately.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCommissionReviewApi } from '../api/posTeamScreensApi';
import { money } from './reportsCommon';
import { FitDialog, FitPanel, Pager, Empty, useDebounced } from '../components/FitKit';
import { useLoad, StateBlock } from '../components/FinanceKit';
import { codeLabel } from '../components/peopleLabels';
import { pageOf, whenTime } from './technicianScreenParts';
import { nf } from './teamShared';

const STATUS_TABS = ['open_all', 'OPEN', 'ASSIGNED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED', 'all'] as const;
const TYPES = ['', 'RATE_CONFIG', 'REFUND_REVERSAL', 'DUPLICATE_LINE', 'MISSING_TECHNICIAN', 'TIP_MISMATCH', 'EARNINGS_OVER_BASE', 'PAYOUT_MISMATCH'];
const RESOLUTIONS = ['NO_ACTION', 'CORRECTED_SEPARATELY', 'FALSE_POSITIVE'];
const rateStr = (r: { type?: string; value?: number | null } | null | undefined) => (r?.value == null ? '—' : r.type === 'fixed' || r.type === 'flat' ? money(r.value) : `${r.value}%`);
const signed = (c: number | null | undefined) => (c == null ? '—' : (c > 0 ? '+' : c < 0 ? '−' : '') + money(Math.abs(c)));
const statusTone = (s: string) => (s === 'RESOLVED' ? 'ok' : s === 'DISMISSED' ? 'mut' : s === 'INVESTIGATING' ? 'warn' : s === 'ASSIGNED' ? 'info' : 'bad');
const errText = (e: unknown) => {
  const x = e as { status?: number; code?: string; message?: string } | null;
  if (x?.status === 409) return tx('cr.err.conflict');
  if (x?.code === 'OWN_PAY') return tx('cr.err.ownPay');
  if (x?.status === 403) return tx('cr.err.forbidden');
  return x?.message || tx('cr.err.generic');
};

export function DiscrepancyReviewPanel({ pq, onOpenTech }: { pq: Record<string, unknown>; onOpenTech: (t: { technicianId: string; technicianName: string | null; focus?: string }) => void }) {
  const [status, setStatus] = useState<string>('open_all'); const [type, setType] = useState(''); const [sev, setSev] = useState(''); const [who, setWho] = useState('');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300); const [page, setPage] = useState(1); const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null); const [running, setRunning] = useState(false); const [pol, setPol] = useState(''); const [polMsg, setPolMsg] = useState<{ ok: boolean; text: string } | null>(null); const [runMsg, setRunMsg] = useState<any | null>(null); const [runErr, setRunErr] = useState<string | null>(null);
  useEffect(() => setPage(1), [status, type, sev, who, q]);
  const list = useLoad(() => posCommissionReviewApi.list({ status, type: type || undefined, severity: sev || undefined, assignee: who || undefined, q: q || undefined, page, pageSize: 6 }), [status, type, sev, who, q, page, tick]);
  const d: any = list.data; const last = d?.lastRun;
  const run = async () => {
    setRunning(true); setRunErr(null); setRunMsg(null);
    try { setRunMsg(await posCommissionReviewApi.runCheck(pq)); setTick((n) => n + 1); } catch (e) { setRunErr(errText(e)); } finally { setRunning(false); }
  };
  const savePolicy = async () => {
    if (!pol) return; setPolMsg(null);
    try { await posCommissionReviewApi.setRefundPolicy(pol); setPolMsg({ ok: true, text: tx('cr.policySaved') }); setPol(''); setTick((n) => n + 1); }
    catch (e) { setPolMsg({ ok: false, text: (e as { status?: number })?.status === 403 ? tx('cr.policyForbidden') : errText(e) }); }
  };
  return (
    <FitPanel testId="discrepancies" title={<>{tx('cr.title')}{d ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(d.totalItems) })}</span> : null}</>}
      actions={<button type="button" className="fk-btn" onClick={run} disabled={running} aria-busy={running} data-testid="run-check">{running ? tx('cr.running') : tx('cr.runCheck')}</button>}
      footer={<Pager info={pageOf(d)} onPage={setPage} label={tx('cr.title')} />}>
      <div className="cr-meta" data-testid="last-run">
        {last ? <span>{tx('cr.lastRun', { at: whenTime(last.finishedAt ?? last.startedAt), who: last.actor ?? '—', from: last.from ?? '—', to: last.to ?? '—' })}{last.status === 'failed' ? <span className="fk-chip bad">{tx('cr.runFailed')}</span> : null}</span> : <span>{tx('cr.neverRun')}</span>}
        {d && !d.policy ? <span className="fk-chip warn" data-testid="policy-missing">{tx('cr.policyMissing')}</span> : d?.policy ? <span className="fk-chip mut">{tx('cr.policy.' + d.policy)}</span> : null}
        {d ? <span className="cr-policy"><select className="fk-select" value={pol} onChange={(e) => setPol(e.target.value)} aria-label={tx('cr.setPolicy')} data-testid="policy-select">
          <option value="">{tx('cr.setPolicy')}</option>{['PRO_RATA', 'NO_REVERSAL'].map((p) => <option key={p} value={p}>{tx('cr.policy.' + p)}</option>)}</select>
          <button type="button" className="fk-btn ghost sm" disabled={!pol} onClick={savePolicy} data-testid="policy-save">{tx('cr.policySave')}</button></span> : null}
      </div>
      {polMsg ? <div className={'fk-note ' + (polMsg.ok ? 'ok' : 'bad')} role="status"><span>{polMsg.text}</span></div> : null}
      {runErr ? <div className="fk-note bad" role="alert"><span>{runErr}</span></div> : null}
      {runMsg ? <div className="fk-note ok" role="status" data-testid="run-result"><span>{tx('cr.runResult', { n: nf(runMsg.detected), k: nf(runMsg.alreadyKnown), u: nf(runMsg.unableToVerify), l: nf(runMsg.checkedLines) })}{runMsg.truncated ? ' ' + tx('cr.truncated') : ''}</span></div> : null}
      <div className="fk-tabs" role="tablist" aria-label={tx('cr.title')}>{STATUS_TABS.map((s) => <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)} data-testid={'cr-tab-' + s}>
        {tx('cr.st.' + s)}{d?.counts && s !== 'all' && s !== 'open_all' ? <span className="tq-n">{d.counts[s] ?? 0}</span> : s === 'open_all' && d?.counts ? <span className="tq-n">{(d.counts.OPEN ?? 0) + (d.counts.ASSIGNED ?? 0) + (d.counts.INVESTIGATING ?? 0)}</span> : null}</button>)}</div>
      <div className="mos-tools">
        <div className="fn-search mos-search"><input className="fk-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('cr.searchPh')} aria-label={tx('cr.searchPh')} data-testid="cr-search" /></div>
        <select className="fk-select" value={type} onChange={(e) => setType(e.target.value)} aria-label={tx('cr.type')} data-testid="cr-type">{TYPES.map((x) => <option key={x} value={x}>{x ? tx('cr.t.' + x) : tx('cr.allTypes')}</option>)}</select>
        <select className="fk-select" value={sev} onChange={(e) => setSev(e.target.value)} aria-label={tx('cr.severity')} data-testid="cr-sev">{['', 'high', 'medium', 'low'].map((x) => <option key={x} value={x}>{x ? tx('cr.sev.' + x) : tx('cr.allSev')}</option>)}</select>
        <select className="fk-select" value={who} onChange={(e) => setWho(e.target.value)} aria-label={tx('cr.assignee')} data-testid="cr-who">{['', 'me', 'none'].map((x) => <option key={x} value={x}>{tx('cr.who.' + (x || 'all'))}</option>)}</select>
      </div>
      {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div>
        : d.items.length === 0 ? <Empty title={last ? tx('cr.none') : tx('cr.noneYet')} />
        : <div className="tq-scroll"><table className="fk-table fn-table cg-table" data-testid="disc-table"><thead><tr><th>{tx('cr.col.detected')}</th><th>{tx('cr.type')}</th><th>{tx('pos.technician')}</th><th>{tx('cm.l.ticket')}</th>
          <th className="num">{tx('cm.d.expected')}</th><th className="num">{tx('cm.d.recorded')}</th><th className="num">{tx('cr.col.diff')}</th><th>{tx('pos.status')}</th><th className="t-opt">{tx('cr.assignee')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{d.items.map((r: any) => <tr key={r.id} className="inv2-click" onClick={() => setOpen(r.id)} data-testid="disc-row">
            <td>{whenTime(r.detectedAt)}</td>
            <td><span className={'fk-chip ' + (r.severity === 'high' ? 'bad' : r.severity === 'medium' ? 'warn' : 'mut')}>{tx('cr.t.' + r.type)}</span>{r.verification !== 'CONFIRMED' ? <span className="fk-li-s">{tx('cr.v.' + r.verification)}</span> : null}</td>
            <td>{r.technician ?? '—'}</td><td>{r.ticketNumber ? tx('tq.ticketNo', { n: r.ticketNumber }) : '—'}</td>
            <td className="num">{r.expectedCents == null ? '—' : money(r.expectedCents)}</td><td className="num">{r.recordedCents == null ? '—' : money(r.recordedCents)}</td><td className="num"><b>{signed(r.differenceCents)}</b></td>
            <td><span className={'fk-chip ' + statusTone(r.status)}>{tx('cr.st.' + r.status)}</span></td><td className="t-opt">{r.assignee ?? '—'}</td>
            <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }} data-testid="disc-open">{tx('cr.review')}</button></td></tr>)}</tbody></table></div>}
      <p className="fk-hint">{tx('cr.rule')}</p>
      {open ? <ReviewSlideOver id={open} onClose={() => setOpen(null)} onChanged={() => setTick((n) => n + 1)} onOpenTech={onOpenTech} /> : null}
    </FitPanel>
  );
}

type Act = 'assign' | 'investigate' | 'note' | 'resolve' | 'dismiss' | 'reopen';
function ReviewSlideOver({ id, onClose, onChanged, onOpenTech }: { id: string; onClose: () => void; onChanged: () => void; onOpenTech: (t: { technicianId: string; technicianName: string | null; focus?: string }) => void }) {
  const [hp, setHp] = useState(1); const [tick, setTick] = useState(0);
  const r = useLoad(() => posCommissionReviewApi.detail(id, { page: hp, pageSize: 6 }), [id, hp, tick]);
  const x: any = r.data;
  const [act, setAct] = useState<Act | null>(null); const [note, setNote] = useState(''); const [code, setCode] = useState(''); const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const people = useLoad(() => (act === 'assign' ? posCommissionReviewApi.assignees() : Promise.resolve(null)), [act]);
  useEffect(() => { setNote(''); setCode(''); setAssignee(''); setErr(null); }, [act]);
  const ev = x?.evidence ?? {};
  const submit = async () => {
    if (!x || !act) return;
    setBusy(true); setErr(null); setDone(null);
    const v = x.version;
    try {
      if (act === 'assign') await posCommissionReviewApi.assign(id, { assigneeUserId: assignee, expectedVersion: v, ...(note ? { note } : {}) });
      else if (act === 'investigate') await posCommissionReviewApi.investigate(id, { expectedVersion: v, ...(note ? { note } : {}) });
      else if (act === 'note') await posCommissionReviewApi.note(id, { expectedVersion: v, note });
      else if (act === 'resolve') await posCommissionReviewApi.resolve(id, { expectedVersion: v, resolutionCode: code, note });
      else if (act === 'dismiss') await posCommissionReviewApi.dismiss(id, { expectedVersion: v, reason: note });
      else await posCommissionReviewApi.reopen(id, { expectedVersion: v, reason: note });
      setDone(tx('cr.saved.' + act)); setAct(null); setTick((n) => n + 1); onChanged();
    } catch (e) {
      setErr(errText(e));
      if ((e as { status?: number })?.status === 409) setTick((n) => n + 1);   // reload the latest; the typed text stays
    } finally { setBusy(false); }
  };
  const needsText = act === 'resolve' || act === 'dismiss' || act === 'reopen' || act === 'note';
  const valid = act === 'assign' ? !!assignee : act === 'resolve' ? !!code && note.trim().length >= 5 : act === 'dismiss' || act === 'reopen' ? note.trim().length >= 5 : act === 'note' ? note.trim().length > 0 : true;
  const actions: Act[] = (x?.actions ?? []).filter((a: Act) => (a === 'resolve' || a === 'dismiss' ? x?.canClose : x?.canAct));
  return (
    <FitDialog side title={x ? tx('cr.t.' + x.type) : tx('cr.title')} busy={busy} onClose={onClose} testId="review-panel"
      subtitle={x ? <><span className={'fk-chip ' + statusTone(x.status)} data-testid="review-status">{tx('cr.st.' + x.status)}</span> · {tx('cr.detected', { at: whenTime(x.detectedAt) })} · {tx('cr.version', { v: String(x.version) })}</> : null}
      footer={<button type="button" className="fk-btn primary" onClick={onClose} disabled={busy} data-testid="review-close">{tx('pos.close')}</button>}>
      {r.error ? <StateBlock error={r.error} onRetry={r.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <p className="cr-summary">{x.type === 'REFUND_REVERSAL' && ev.kind ? tx('cr.sumR.' + ev.kind) : tx('cr.sum.' + x.type)}</p>
        {x.verification !== 'CONFIRMED' ? <div className="fk-note warn"><span>{tx('cr.vlong.' + x.verification)}</span></div> : null}
        <dl className="fk-dl mo-dl" data-testid="review-evidence">
          <dt>{tx('pos.technician')}</dt><dd>{x.technician ?? '—'}</dd>
          <dt>{tx('cm.l.ticket')}</dt><dd>{x.ticketNumber ? tx('tq.ticketNo', { n: x.ticketNumber }) : '—'}</dd>
          <dt>{tx('cm.d.expected')}</dt><dd>{x.expectedCents == null ? '—' : money(x.expectedCents)}</dd>
          <dt>{tx('cm.d.recorded')}</dt><dd>{x.recordedCents == null ? '—' : money(x.recordedCents)}</dd>
          <dt>{tx('cr.col.diff')}</dt><dd><b>{signed(x.differenceCents)}</b></dd>
          <dt>{tx('cr.severity')}</dt><dd>{tx('cr.sev.' + x.severity)}</dd>
          {ev.expectedRate ? <><dt>{tx('cr.ev.rate')}</dt><dd>{tx('cr.ev.rateV', { exp: rateStr(ev.expectedRate), src: ev.expectedRate.source, ver: String(ev.expectedRate.policyVersion ?? '—'), rec: rateStr(ev.recordedRate) })}</dd></> : null}
          {ev.pricedAt ? <><dt>{tx('cr.ev.pricedAt')}</dt><dd>{whenTime(ev.pricedAt)}</dd></> : null}
          {ev.policy !== undefined ? <><dt>{tx('cr.ev.policy')}</dt><dd>{ev.policy ? tx('cr.policy.' + ev.policy) : tx('cr.policyMissing')}{ev.paidAlready ? <span className="fk-chip bad">{tx('cr.paidAlready')}</span> : null}</dd></> : null}
          {ev.refundIds?.length ? <><dt>{tx('cr.ev.refunds')}</dt><dd>{ev.refundIds.length} · {money(ev.refundedCents ?? 0)} / {money(ev.capturedCents ?? 0)}</dd></> : null}
        </dl>
        {ev.explanation ? <p className="fk-hint" data-testid="review-explanation"><b>{tx('cr.calc')}</b> {ev.explanation}</p> : null}
        {ev.check === 'refund_reversal' ? <p className="fk-hint">{tx('cr.timing')}</p> : null}
        <div className="cr-links">
          {x.technicianId ? <button type="button" className="fk-btn ghost sm" onClick={() => onOpenTech({ technicianId: x.technicianId, technicianName: x.technician, focus: x.ticketNumber ?? undefined })} data-testid="review-source">{tx('cm.viewSource')}</button> : null}
          <Link className="fk-btn ghost sm" to="/tenant/team/payroll" data-testid="review-payroll">{tx('cr.payrollLink')}</Link>
          <span className="fk-hint">{tx('cr.noMoney')}</span>
        </div>
        <div className="cr-who">
          <span>{tx('cr.assignee')}: <b>{x.assignee ?? '—'}</b>{x.assignedAt ? ` · ${whenTime(x.assignedAt)}` : ''}</span>
          {x.resolutionCode ? <span>{tx('cr.resolution')}: <b>{tx('cr.res.' + x.resolutionCode)}</b> — {x.resolutionNote}{x.resolvedBy ? ` (${x.resolvedBy}, ${whenTime(x.resolvedAt)})` : ''}</span> : null}
          {x.dismissReason ? <span>{tx('cr.dismissed')}: {x.dismissReason}{x.dismissedBy ? ` (${x.dismissedBy}, ${whenTime(x.dismissedAt)})` : ''}</span> : null}
        </div>
        {done ? <div className="fk-note ok" role="status" data-testid="review-done"><span>{done}</span></div> : null}
        {err ? <div className="fk-note bad" role="alert" data-testid="review-error"><span>{err}</span></div> : null}
        {x.selfPay && !x.canClose ? <p className="fk-hint">{tx('cr.err.ownPay')}</p> : null}
        <div className="cr-actions" role="group" aria-label={tx('finance.actions')}>
          {actions.map((a) => <button key={a} type="button" className={'fk-btn' + (act === a ? ' primary' : '')} aria-pressed={act === a} onClick={() => setAct(act === a ? null : a)} disabled={busy} data-testid={'act-' + a}>{tx('cr.a.' + a)}</button>)}
        </div>
        {act ? <div className="cr-form" data-testid="review-form">
          {act === 'assign' ? <label className="fk-field"><span>{tx('cr.assignTo')} *</span>
            <select className="fk-select" value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="assignee">{[<option key="" value="">{people.data ? tx('cr.choose') : tx('pos.loading')}</option>, ...(((people.data as { items?: { userId: string; name: string | null }[] } | null)?.items) ?? []).map((u) => <option key={u.userId} value={u.userId}>{u.name ?? u.userId}</option>)]}</select></label> : null}
          {act === 'resolve' ? <label className="fk-field"><span>{tx('cr.resolution')} *</span>
            <select className="fk-select" value={code} onChange={(e) => setCode(e.target.value)} data-testid="resolution">{[<option key="" value="">{tx('cr.choose')}</option>, ...RESOLUTIONS.map((c) => <option key={c} value={c}>{tx('cr.res.' + c)}</option>)]}</select></label> : null}
          <label className="fk-field"><span>{tx(act === 'note' ? 'cr.noteL' : act === 'resolve' || act === 'dismiss' || act === 'reopen' ? 'cr.reasonL' : 'cr.noteOpt')}{needsText ? ' *' : ''}</span>
            <textarea className="fk-input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="review-note" /></label>
          {act === 'resolve' ? <p className="fk-hint">{tx('cr.resolveRule')}</p> : null}
          <div className="cr-form-foot"><button type="button" className="fk-btn" onClick={() => setAct(null)} disabled={busy}>{tx('pos.cancel')}</button>
            <button type="button" className="fk-btn primary" onClick={submit} disabled={busy || !valid} aria-busy={busy} data-testid="review-submit">{busy ? tx('cr.saving') : tx('cr.confirm.' + act)}</button></div>
        </div> : null}
        <h3 className="cr-h">{tx('cr.timeline')}</h3>
        {x.history.items.length === 0 ? <Empty title={tx('cr.noHistory')} /> : <ol className="cr-timeline" data-testid="review-history">{x.history.items.map((h: any) => <li key={h.id} data-testid="history-row">
          <b>{tx('cr.e.' + h.type)}</b>{h.from && h.to && h.from !== h.to ? <span className="fk-li-s">{tx('cr.st.' + h.from)} → {tx('cr.st.' + h.to)}</span> : null}
          <span className="fk-li-s">{whenTime(h.at)} · {h.actor ?? tx('cr.system')}</span>{h.reason ? <p>{h.reason}</p> : null}
          {h.metadata?.resolutionCode ? <span className="fk-li-s">{codeLabel('cr.res.' + h.metadata.resolutionCode, h.metadata.resolutionCode)}</span> : null}</li>)}</ol>}
        <Pager info={pageOf(x.history)} onPage={setHp} compact />
      </>}
    </FitDialog>
  );
}

/** F3: who exported Commission / Team Performance, when and with what result — never the rows themselves */
export function ExportHistory({ load, tick }: { load: (q: Record<string, unknown>) => Promise<any>; tick: number }) {
  const [page, setPage] = useState(1);
  const h = useLoad(() => load({ page, pageSize: 5 }), [page, tick]);
  const d: any = h.data;
  return (
    <FitPanel testId="export-history" title={<>{tx('cm.exportHistory')}{d ? <span className="fk-muted"> · {tx(d.scope === 'own' ? 'cm.ex.own' : 'cm.ex.salon')}</span> : null}</>} footer={<Pager info={pageOf(d)} onPage={setPage} label={tx('cm.exportHistory')} />}>
      {h.error ? <StateBlock error={h.error} onRetry={h.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : !d.items.length ? <Empty title={tx('cm.ex.none')} />
        : <table className="fk-table fn-table cg-table" data-testid="export-history-table"><thead><tr><th>{tx('tm.col.when')}</th><th>{tx('cm.ex.report')}</th><th>{tx('cm.ex.event')}</th><th>{tx('cm.ex.by')}</th><th className="num">{tx('cm.ex.rows')}</th></tr></thead>
          <tbody>{d.items.map((e: any) => <tr key={e.id} data-testid="export-history-row"><td>{whenTime(e.at)}</td><td>{tx('cm.ex.type.' + e.reportType)}</td>
            <td><span className={'fk-chip ' + (e.event === 'succeeded' ? 'ok' : e.event === 'requested' ? 'mut' : 'bad')}>{tx('cm.ex.e.' + e.event)}</span>{e.failureCode ? <span className="fk-li-s">{e.failureCode}</span> : null}</td>
            <td>{e.actor ?? '—'}</td><td className="num">{e.rowCount == null ? '—' : nf(e.rowCount)}</td></tr>)}</tbody></table>}
      <p className="fk-hint">{tx('cm.ex.rule')}</p>
    </FitPanel>
  );
}
