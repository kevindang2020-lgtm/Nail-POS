// messagingSetupCenter.tsx — Text Messaging Setup & SMS Readiness guide (Oct 31 2026), the owner's three priorities on the
// existing Text Messaging Setup page (every original card stays; these are additions):
//   SmsReadinessPanel  §11 six independent parts (Account · Sender · Registration · Inbound · Delivery · Booking Verify),
//                      each with state, evidence, source, time and the exact next action — never one green "Connected"
//   SetupWizard        §12 seven steps derived from the same evidence; resumes at the first unfinished step; each step
//                      opens the EXISTING card (Advanced/manual setup is untouched); nothing is bought, registered or sent
//   BranchSenders      §13 the sender each branch would actually use (inherited vs its own Twilio), masked account
//   SetupActivity      §14–§16 server search, kind / status / branch filters, Today…Custom month calendar with a date basis,
//                      newest first, Page 1 2 3 with 10 / 20 / 50 rows and an exact total, and a View detail overlay
// The search text and filters live in component state only (never in the URL or a log).
import { useCallback, useEffect, useState } from 'react';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtDateTime } from '../i18n/format';
import { FitDialog, FitPanel, Pager, Empty, ErrorRetry, useDebounced } from '../components/FitKit';
import { PeriodBar, type PeriodState, type ServerPeriod } from '../components/FinanceKit';
import { posMessagingSetupApi as api, type SetupOverview, type MsgSetupPartState, type MsgSetupPartKey, type MsgSetupWizardKey, type BranchSenders as BranchSendersView, type MsgSetupActivityPage, type ActivityDetail, type MsgSetupActivityKind } from '../api/posMessagingSetupApi';

/** literal keys (read at render — never translated at import) */
const STATE: Record<MsgSetupPartState, () => string> = {
  ready: () => t('ms.state.ready'), attention_required: () => t('ms.state.attention_required'), pending: () => t('ms.state.pending'),
  failed: () => t('ms.state.failed'), unknown: () => t('ms.state.unknown'), off: () => t('ms.state.off'),
};
const TONE: Record<MsgSetupPartState, string> = { ready: 'ok', attention_required: 'warn', pending: 'info', failed: 'bad', unknown: 'muted', off: 'muted' };
const PART: Record<MsgSetupPartKey, () => string> = {
  account: () => t('ms.part.account'), sender: () => t('ms.part.sender'), registration: () => t('ms.part.registration'),
  inbound: () => t('ms.part.inbound'), delivery: () => t('ms.part.delivery'), booking_verify: () => t('ms.part.booking_verify'),
};
const STEP: Record<MsgSetupWizardKey, () => string> = {
  scope: () => t('ms.wiz.step.scope'), connect: () => t('ms.wiz.step.connect'), number: () => t('ms.wiz.step.number'), registration: () => t('ms.wiz.step.registration'),
  webhooks: () => t('ms.wiz.step.webhooks'), test: () => t('ms.wiz.step.test'), summary: () => t('ms.wiz.step.summary'),
};
const STEP_STATE: Record<string, () => string> = { done: () => t('ms.wiz.state.done'), action: () => t('ms.wiz.state.action'), pending: () => t('ms.wiz.state.pending'), blocked: () => t('ms.wiz.state.blocked') };
const KIND: Record<MsgSetupActivityKind, () => string> = {
  test_sms: () => t('ms.act.kind.test_sms'), health_check: () => t('ms.act.kind.health_check'), registration_check: () => t('ms.act.kind.registration_check'), number_purchase: () => t('ms.act.kind.number_purchase'),
};
const ASTATE: Record<string, () => string> = { ok: () => t('ms.act.state.ok'), pending: () => t('ms.act.state.pending'), failed: () => t('ms.act.state.failed') };
const BASIS: Record<string, () => string> = { created: () => t('ms.act.basis.created'), updated: () => t('ms.act.basis.updated'), delivered: () => t('ms.act.basis.delivered') };
const when = (iso: string | null | undefined) => (iso ? fmtDateTime(iso) : '—');

export function StateChip({ state, testId }: { state: MsgSetupPartState; testId?: string }) {
  return <span className={'ms-chip ' + TONE[state]} data-testid={testId} data-state={state}>{STATE[state]()}</span>;
}

/** §11 the six-part panel */
export function SmsReadinessPanel({ ov, error, onOpen }: { ov: SetupOverview | null; error: string | null; onOpen: (link: string) => void }) {
  if (error) return <div className="pmc-warn" role="status">{t('ms.loadFailed', { msg: error })}</div>;
  if (!ov) return <div className="pmc-muted" role="status">…</div>;
  return (
    <section className="fk-panel ms-ready" data-testid="ms-readiness" aria-label={t('ms.ready.title')}>
      <div className="fk-panel-head"><h2>{t('ms.ready.title')}</h2><span className="ms-overall">{t('ms.ready.overall', { state: STATE[ov.overall]() })}</span></div>
      <div className="ms-note">{t('ms.ready.note')}</div>
      <div className="ms-parts">
        {ov.parts.map((p) => (
          <article key={p.key} className={'ms-part ' + TONE[p.state]} data-testid={'ms-part-' + p.key}>
            <header><b>{PART[p.key]()}</b><StateChip state={p.state} testId={'ms-state-' + p.key} /></header>
            <p className="ms-sum">{p.summary}</p>
            <p className="ms-ev">{p.evidence}</p>
            <p className="ms-meta">{t('ms.part.source', { source: p.source })} · {p.checkedAt ? t('ms.part.checked', { when: when(p.checkedAt) }) : t('ms.part.never')}</p>
            {p.nextAction ? <p className="ms-next">{t('ms.part.next', { action: p.nextAction })}</p> : null}
            {p.state !== 'ready' && p.state !== 'off' ? <button type="button" className="fk-btn sm" onClick={() => onOpen(p.fixLink)}>{t('ms.part.open')}</button> : null}
          </article>
        ))}
      </div>
      <div className="pmc-hint" data-testid="ms-schedule">{ov.schedule.enabled ? t('ms.schedule.on', { when: ov.schedule.runsAt, last: when(ov.schedule.lastScheduledAt) }) : t('ms.schedule.off', { last: when(ov.schedule.lastCheckAt) })}</div>
    </section>
  );
}

/** §12 the guided wizard */
export function SetupWizard({ ov, onClose, onOpen }: { ov: SetupOverview; onClose: () => void; onOpen: (link: string) => void }) {
  const [sel, setSel] = useState<MsgSetupWizardKey>(ov.wizard.resumeAt);
  const step = ov.wizard.steps.find((s) => s.key === sel) ?? ov.wizard.steps[0];
  return (
    <FitDialog title={t('ms.wiz.title')} subtitle={t('ms.wiz.sub')} onClose={onClose} wide testId="ms-wizard"
      footer={<button type="button" className="fk-btn" onClick={onClose}>{t('ms.wiz.close')}</button>}>
      <div className="ms-wiz">
        <ol className="ms-steps" aria-label={t('ms.wiz.title')}>
          {ov.wizard.steps.map((s) => (
            <li key={s.key}>
              <button type="button" className={'ms-step ' + s.state + (s.key === sel ? ' on' : '')} aria-current={s.key === sel ? 'step' : undefined} onClick={() => setSel(s.key)} data-testid={'ms-step-' + s.key} data-state={s.state}>
                <span>{STEP[s.key]()}</span><small>{STEP_STATE[s.state]()}{s.key === ov.wizard.resumeAt ? ` · ${t('ms.wiz.resume')}` : ''}</small>
              </button>
            </li>
          ))}
        </ol>
        <div className="ms-step-body" data-testid="ms-step-body">
          <h3>{STEP[step.key]()}</h3>
          <p>{step.summary}</p>
          {step.key !== 'summary' && step.key !== 'scope' ? <button type="button" className="fk-btn primary" onClick={() => { onClose(); onOpen(step.fixLink); }} data-testid="ms-step-go">{t('ms.wiz.go')}</button> : null}
        </div>
      </div>
    </FitDialog>
  );
}

/** §13 per-branch effective senders */
export function BranchSenders({ onConfigure }: { onConfigure: (branchId: string) => void }) {
  const [v, setV] = useState<BranchSendersView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); api.branches().then(setV).catch((e) => setErr((e as Error)?.message || 'error')); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <FitPanel title={t('ms.br.title')} testId="ms-branches" className="ms-full">
      <div className="pmc-hint">{t('ms.br.sub')}</div>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !v ? <div className="pmc-muted">…</div> : (
        <div className="ms-table-wrap">
          <table className="tbl ms-table">
            <thead><tr><th>{t('ms.br.col.branch')}</th><th>{t('ms.br.col.source')}</th><th>{t('ms.br.col.account')}</th><th>{t('ms.br.col.sender')}</th><th>{t('ms.br.col.registration')}</th><th>{t('ms.br.col.ready')}</th><th /></tr></thead>
            <tbody>
              <tr data-testid="ms-br-default"><td><b>{t('ms.br.default')}</b></td><td>—</td><td>{v.salonDefault.accountSidMasked ?? '—'}</td><td>{v.salonDefault.sender ?? '—'}</td><td>—</td><td>—</td><td /></tr>
              {v.branches.length === 0 ? <tr><td colSpan={7}>{t('ms.br.none')}</td></tr> : v.branches.map((b) => (
                <tr key={b.branchId} data-testid={'ms-br-' + b.branchId}>
                  <td>{b.name ?? '—'}</td>
                  <td>{b.inherits ? t('ms.br.inherits') : t('ms.br.own')}</td>
                  <td>{b.accountSidMasked ?? '—'}</td>
                  <td>{b.sender ?? '—'}{b.senderType ? <span className="pmc-r">{b.senderType}</span> : null}</td>
                  <td><StateChip state={b.registration} /></td>
                  <td className="ms-dots">{b.parts.map((p) => <span key={p.key} className={'ms-dot ' + TONE[p.state]} title={`${PART[p.key]()}: ${STATE[p.state]()}`} aria-label={`${PART[p.key]()}: ${STATE[p.state]()}`} />)}</td>
                  <td><button type="button" className="fk-btn sm" onClick={() => onConfigure(b.branchId)}>{t('ms.br.manage')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pmc-hint">{v?.rule}</div>
    </FitPanel>
  );
}

type View = { kind: string; state: string; branchId: string; basis: string; preset: PeriodState['preset']; from?: string; to?: string; page: number; size: number };
const START: View = { kind: '', state: '', branchId: '', basis: 'created', preset: 'all', page: 1, size: 10 };

/** §14–§16 the setup history */
export function SetupActivity({ branches, refreshKey }: { branches: { id: string; name: string }[]; refreshKey: number }) {
  const [qText, setQText] = useState('');
  const q = useDebounced(qText.trim(), 300);
  const [v, setV] = useState<View>(START);
  const [page, setPage] = useState<MsgSetupActivityPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const set = (p: Partial<View>) => setV((o) => ({ ...o, ...p, page: p.page ?? 1 }));   // any filter change → Page 1
  useEffect(() => { setV((o) => ({ ...o, page: 1 })); }, [q]);
  const load = useCallback(() => {
    setBusy(true); setErr(null);
    api.activity({ q, kind: v.kind, state: v.state, branchId: v.branchId, basis: v.basis, preset: v.preset, from: v.from, to: v.to, page: v.page, pageSize: v.size })
      .then(setPage).catch((e) => setErr((e as Error)?.message || 'error')).finally(() => setBusy(false));
  }, [q, v]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const period: PeriodState = v.preset === 'custom' ? { preset: 'custom', from: v.from, to: v.to } : { preset: v.preset };
  const filtersOn = !!(q || v.kind || v.state || v.branchId || v.preset !== 'all' || v.basis !== 'created');
  const open = (r: { kind: MsgSetupActivityKind; id: string }) => { api.detail(r.kind, r.id).then(setDetail).catch((e) => setErr((e as Error)?.message || 'error')); };
  return (
    <FitPanel title={t('ms.act.title')} testId="ms-activity" className="ms-full">
      <div className="pmc-hint">{t('ms.act.sub')}</div>
      <div className="ms-filters">
        <input className="fk-input ms-search" type="search" value={qText} onChange={(e) => setQText(e.target.value)} placeholder={t('ms.act.search')} aria-label={t('ms.act.search')} data-testid="ms-search" />
        <select className="fk-select" value={v.kind} onChange={(e) => set({ kind: e.target.value })} aria-label={t('ms.act.kind')} data-testid="ms-kind">
          <option value="">{t('ms.act.kind.all')}</option>{(Object.keys(KIND) as MsgSetupActivityKind[]).map((k) => <option key={k} value={k}>{KIND[k]()}</option>)}
        </select>
        <select className="fk-select" value={v.state} onChange={(e) => set({ state: e.target.value })} aria-label={t('ms.act.state')} data-testid="ms-state">
          <option value="">{t('ms.act.state.all')}</option>{Object.keys(ASTATE).map((k) => <option key={k} value={k}>{ASTATE[k]()}</option>)}
        </select>
        {branches.length ? (
          <select className="fk-select" value={v.branchId} onChange={(e) => set({ branchId: e.target.value })} aria-label={t('ms.act.branchFilter')} data-testid="ms-branch">
            <option value="">{t('ms.act.branch.all')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : null}
        <label className="ms-size">{t('ms.act.size')}
          <select className="fk-select" value={v.size} onChange={(e) => set({ size: Number(e.target.value) })} data-testid="ms-size">{[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        {filtersOn ? <button type="button" className="btn ghost" onClick={() => { setQText(''); setV(START); }} data-testid="ms-clear">{t('ms.act.clear')}</button> : null}
      </div>
      <PeriodBar compact allowAll value={period} server={(page?.period ?? null) as ServerPeriod | null} basis={v.basis}
        basisOptions={Object.keys(BASIS).map((b) => ({ value: b, label: BASIS[b]() }))} onBasis={(b) => set({ basis: b })}
        onChange={(p) => set({ preset: p.preset, from: p.from, to: p.to })} />
      {err ? <ErrorRetry message={err} onRetry={load} /> : !page ? <div className="state" role="status">…</div> : page.items.length === 0 ? <Empty title={t('ms.act.empty')} /> : (
        <div className="ms-table-wrap" aria-busy={busy}>
          <div className="sub" data-testid="ms-total">{t('ms.act.total', { n: String(page.totalItems) })}</div>
          <table className="tbl ms-table" data-testid="ms-act-table">
            <thead><tr><th>{t('ms.act.col.when')}</th><th>{t('ms.act.col.record')}</th><th>{t('ms.act.col.status')}</th><th>{t('ms.act.col.number')}</th><th>{t('ms.act.col.to')}</th><th>{t('ms.act.col.ref')}</th><th>{t('ms.act.col.branch')}</th><th>{t('ms.act.col.reason')}</th><th /></tr></thead>
            <tbody>
              {page.items.map((r) => (
                <tr key={r.kind + r.id} data-testid="ms-act-row" data-kind={r.kind}>
                  <td>{when(v.basis === 'updated' ? r.updatedAt : v.basis === 'delivered' ? r.deliveredAt : r.createdAt)}</td>
                  <td>{KIND[r.kind]()}</td>
                  <td><span className={'ms-chip ' + (r.state === 'ok' ? 'ok' : r.state === 'failed' ? 'bad' : 'info')}>{ASTATE[r.state]?.() ?? r.state}</span> <small className="pmc-r">{r.rawStatus}</small></td>
                  <td>{r.number ?? '—'}</td><td>{r.recipient ?? '—'}</td><td>{r.providerRef ?? '—'}</td>
                  <td>{r.branchName ?? t('ms.act.salon')}</td><td>{r.reason ?? '—'}</td>
                  <td><button type="button" className="fk-btn sm" onClick={() => open(r)} data-testid="ms-act-view">{t('ms.act.view')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager info={page} onPage={(p) => set({ page: p })} />
        </div>
      )}
      {detail ? <ActivityDetailDialog d={detail} onClose={() => setDetail(null)} /> : null}
    </FitPanel>
  );
}

function ActivityDetailDialog({ d, onClose }: { d: ActivityDetail; onClose: () => void }) {
  const skip = new Set(['kind', 'id', 'branchId', 'branchName', 'createdAt', 'updatedAt', 'deliveredAt', 'state', 'rawStatus', 'number', 'recipient', 'providerRef', 'reason', 'detail', 'actor', 'meaning', 'configSource']);
  // timestamps inside the details are shown in the salon's format, never as raw ISO strings
  const tidy = (x: unknown): unknown => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:/.test(x) ? fmtDateTime(x) : Array.isArray(x) ? x.map(tidy) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, tidy(v)])) : x;
  const extra = Object.entries(d).filter(([k, x]) => !skip.has(k) && x !== null && x !== undefined && !(Array.isArray(x) && x.length === 0)).map(([k, x]) => [k, tidy(x)] as const);
  return (
    <FitDialog title={t('ms.det.title')} subtitle={`${KIND[d.kind]()} · …${d.id.slice(-6)}`} onClose={onClose} side testId="ms-detail"
      footer={<button type="button" className="fk-btn" onClick={onClose} data-testid="ms-detail-close">{t('ms.det.close')}</button>}>
      <dl className="pmc-dl">
        <dt>{t('ms.act.col.status')}</dt><dd>{ASTATE[d.state]?.() ?? d.state}</dd>
        <dt>{t('ms.det.raw')}</dt><dd>{d.rawStatus || '—'}</dd>
        {d.meaning ? <><dt>{t('ms.det.meaning')}</dt><dd>{String(d.meaning)}</dd></> : null}
        <dt>{t('ms.det.created')}</dt><dd>{when(d.createdAt)}</dd>
        <dt>{t('ms.det.updated')}</dt><dd>{when(d.updatedAt)}</dd>
        {d.deliveredAt ? <><dt>{t('ms.det.delivered')}</dt><dd>{when(d.deliveredAt)}</dd></> : null}
        <dt>{t('ms.act.col.branch')}</dt><dd>{d.branchName ?? t('ms.act.salon')}</dd>
        <dt>{t('ms.det.actor')}</dt><dd>{String(d.actor ?? '—')}</dd>
        {d.configSource ? <><dt>{t('ms.det.config')}</dt><dd>{String(d.configSource)}</dd></> : null}
        {d.number ? <><dt>{t('ms.act.col.number')}</dt><dd>{d.number}</dd></> : null}
        {d.recipient ? <><dt>{t('ms.act.col.to')}</dt><dd>{d.recipient}</dd></> : null}
        {d.providerRef ? <><dt>{t('ms.act.col.ref')}</dt><dd>{d.providerRef}</dd></> : null}
        {d.reason ? <><dt>{t('ms.act.col.reason')}</dt><dd>{d.reason}</dd></> : null}
      </dl>
      {extra.length ? (<><div className="pmc-sub">{t('ms.det.extra')}</div><pre className="ms-pre">{JSON.stringify(Object.fromEntries(extra), null, 2)}</pre></>) : null}
    </FitDialog>
  );
}
