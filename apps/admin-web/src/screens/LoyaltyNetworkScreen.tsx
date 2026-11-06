// LoyaltyNetworkScreen.tsx — Super Admin → Loyalty Network (Global Loyalty & Rewards Network control centre, English only;
// LoyaltyTokens.pdf §4, §7.5, §9; LoyaltyRules.pdf §1–§2, §7). Five tabs:
//   Overview        program switches (earning / redemption / purchases / reimbursements pauses), funding provider, the
//                   network's fixed values (redemption value, token value), health of the books
//   Global rules    every global earning-rule version (published / scheduled / canceled); publish a new one with a
//                   $5–$100 preview against the rule in force and the salons it reaches; cancel one not yet started
//   Salons          enrollment (enroll / suspend / withdraw — reason required), mode, wallet, alert level
//   Token purchases every salon's purchases; SANDBOX ONLY: stand in for the provider's later answers
//   Reconciliation  balanced journal, wallet / points projections = their ledgers, rewards liability = outstanding points
// Views: super_admin.billing.view. Changes: super_admin.billing.manage + a fresh step-up (the API client re-prompts).
// Nothing here moves money: a live provider moves purchases; reimbursements are never marked PAID by hand.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PageHeader, StatusBadge, ErrorState, LoadingSkeleton, Modal, Pagination, type Tone } from '@aipowersalon/ui';
import { LoyaltyIntegrityTab } from './LoyaltyIntegrityTab';
import { superAdminLoyaltyNetworkApi as netApi, type LoyaltyNetOverview, type GlobalVersion, type GlobalPreview, type Enrollment, type Purchase, type LoyaltyNetPaged, type Program, type ProgramPatch, type Reconciliation, type Rate } from '../api/superAdminLoyaltyNetworkApi';

type Tab = 'integrity' | 'overview' | 'rules' | 'salons' | 'purchases' | 'recon';
const TABS: { id: Tab; label: string }[] = [
  { id: 'integrity', label: 'Integrity' }, { id: 'overview', label: 'Overview' }, { id: 'rules', label: 'Global rules' }, { id: 'salons', label: 'Salons' }, { id: 'purchases', label: 'Token purchases' }, { id: 'recon', label: 'Reconciliation' },
];
const usd = (c: number | null | undefined) => (c == null ? '—' : (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const pts = (tenths: number | null | undefined) => (tenths == null ? '—' : (tenths / 10).toLocaleString('en-US', { maximumFractionDigits: 1 }));
const tokens = (cents: number, tv = 100) => (cents / Math.max(1, tv)).toLocaleString('en-US', { maximumFractionDigits: 2 });
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const rateText = (r: Pick<Rate, 'spendIncrementCents' | 'pointTenthsPerIncrement'> | null | undefined) => (r ? `${usd(r.spendIncrementCents)} = ${pts(r.pointTenthsPerIncrement)} ${r.pointTenthsPerIncrement === 10 ? 'point' : 'points'}` : '—');
const errText = (e: any, fb: string) => (e?.message && e.message !== 'Request failed.' ? e.message : fb);
const STATUS_TONE: Record<string, Tone> = { FUNDS_VERIFIED: 'success', PAYMENT_CONFIRMED: 'info', SETTLEMENT_PENDING: 'warning', UNKNOWN: 'warning', REQUESTED: 'info', PROCESSING: 'info',
  FAILED: 'danger', DECLINED: 'danger', REVERSED: 'danger', CHARGED_BACK: 'danger', CANCELED: 'neutral', enrolled: 'success', suspended: 'warning', withdrawn: 'neutral', not_enrolled: 'neutral',
  ok: 'success', low: 'warning', critical: 'danger', empty: 'danger', published: 'success', canceled: 'neutral' };
const SANDBOX_NEXT: Record<string, string[]> = { PAYMENT_CONFIRMED: ['SETTLEMENT_PENDING', 'FUNDS_VERIFIED', 'REVERSED'], SETTLEMENT_PENDING: ['FUNDS_VERIFIED', 'FAILED', 'REVERSED'], PROCESSING: ['DECLINED', 'FAILED'], UNKNOWN: ['FAILED', 'DECLINED'], FUNDS_VERIFIED: ['REVERSED'] };
const card = 'rounded-2xl border border-[#e8dcc8] bg-white p-5 shadow-sm';
const btn = (kind: 'primary' | 'ghost' | 'danger' = 'ghost') => kind === 'primary' ? 'rounded-lg bg-[#b98224] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a5721c] disabled:opacity-50'
  : kind === 'danger' ? 'rounded-lg border border-[#e7b9a9] bg-white px-3 py-2 text-sm font-semibold text-[#9a3b1e] hover:bg-[#fff3ee] disabled:opacity-50'
  : 'rounded-lg border border-[#e2d5c1] bg-white px-3 py-2 text-sm font-semibold text-[#5e4d3b] hover:bg-[#fbf6ee] disabled:opacity-50';
const input = 'w-full rounded-lg border border-[#e2d5c1] bg-white px-3 py-2 text-sm';

export function LoyaltyNetworkScreen() {
  const [tab, setTab] = useState<Tab>('overview');
  const [ov, setOv] = useState<LoyaltyNetOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const load = useCallback(() => { setErr(null); netApi.overview().then(setOv).catch((e) => setErr(errText(e, 'Could not load the rewards network.'))); }, []);
  useEffect(() => { load(); }, [load]);
  const done = (text: string) => { setNote({ tone: 'ok', text }); load(); };
  const fail = (e: any, fb: string) => setNote({ tone: 'bad', text: errText(e, fb) });

  return (
    <div className="work w-full" data-testid="sa-loyalty-network">
      <PageHeader title="Loyalty Network" subtitle="AI PowerSalon Global Loyalty & Rewards Network — earning rules, salons, prepaid token funding and the books."
        actions={<button type="button" className={btn()} onClick={load}>Refresh</button>} />
      {ov ? <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <StatusBadge tone={ov.funding.provider ? (ov.funding.sandbox ? 'warning' : 'success') : 'danger'}>{ov.funding.provider ? (ov.funding.sandbox ? 'Funding: SANDBOX (no real money)' : `Funding: ${ov.funding.provider}`) : 'Funding: no approved provider (Buy Tokens blocked)'}</StatusBadge>
        <StatusBadge tone={ov.reconciliation.healthy ? 'success' : 'danger'}>{ov.reconciliation.healthy ? 'Books reconcile' : 'Reconciliation exceptions'}</StatusBadge>
        {ov.program.earnPaused ? <StatusBadge tone="warning">Earning paused</StatusBadge> : null}
        {ov.program.redeemPaused ? <StatusBadge tone="warning">Redemption paused</StatusBadge> : null}
        {ov.program.purchasesPaused ? <StatusBadge tone="warning">Purchases paused</StatusBadge> : null}
      </div> : null}
      <div role="tablist" aria-label="Loyalty Network sections" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-testid={`sa-ln-tab-${t.id}`} className={tab === t.id ? btn('primary') : btn()} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {note ? <div role="status" className={'mb-4 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ' + (note.tone === 'ok' ? 'border-[#bfe0c4] bg-[#f1faf2] text-[#235a2c]' : 'border-[#efc2b4] bg-[#fff3ee] text-[#8a3418]')}>
        <span>{note.text}</span><button type="button" aria-label="Dismiss" onClick={() => setNote(null)}>✕</button></div> : null}
      {err ? <ErrorState message={err} onRetry={load} /> : !ov ? <LoadingSkeleton lines={6} /> : <>
        {tab === 'overview' ? <OverviewTab ov={ov} onDone={done} onFail={fail} /> : null}
        {tab === 'rules' ? <RulesTab ov={ov} onDone={done} onFail={fail} /> : null}
        {tab === 'salons' ? <SalonsTab ov={ov} onDone={done} onFail={fail} /> : null}
        {tab === 'purchases' ? <PurchasesTab ov={ov} onDone={done} onFail={fail} /> : null}
        {tab === 'recon' ? <ReconTab /> : null}
        {tab === 'integrity' ? <LoyaltyIntegrityTab onNote={(tone, text) => setNote({ tone, text })} /> : null}
      </>}
    </div>
  );
}

type TabProps = { ov: LoyaltyNetOverview; onDone: (t: string) => void; onFail: (e: any, fb: string) => void };

function Stat({ label, value, sub, testId }: { label: string; value: ReactNode; sub?: ReactNode; testId?: string }) {
  return <div className="rounded-xl border border-[#eee5d8] bg-[#fffdf9] p-4" data-testid={testId}><div className="text-xs font-semibold uppercase tracking-wide text-[#9a8876]">{label}</div><div className="mt-1 text-xl font-bold text-[#30291f]">{value}</div>{sub ? <div className="mt-1 text-xs text-[#857566]">{sub}</div> : null}</div>;
}

/** a change needs a written reason (≥ 10 characters) and goes through the step-up prompt */
function ReasonModal({ title, body, confirmLabel, danger, onConfirm, onClose }: { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: (reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={busy ? () => undefined : onClose} title={title}>
      <div className="space-y-3 text-sm" data-testid="sa-ln-reason-modal">
        <div className="text-[#5e4d3b]">{body}</div>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-[#6d5c4b]">Reason (at least 10 characters, recorded in the audit log)</span>
          <textarea className={input} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="sa-ln-reason" /></label>
        {err ? <div role="alert" className="text-[#9a3b1e]">{err}</div> : null}
        <div className="flex justify-end gap-2"><button type="button" className={btn()} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={btn(danger ? 'danger' : 'primary')} disabled={busy || reason.trim().length < 10} data-testid="sa-ln-reason-confirm"
            onClick={async () => { setBusy(true); setErr(null); try { await onConfirm(reason.trim()); onClose(); } catch (e: any) { setErr(errText(e, 'That change was not saved.')); setBusy(false); } }}>{busy ? 'Saving…' : confirmLabel}</button></div>
      </div>
    </Modal>
  );
}

// ── Overview: program switches + limits ────────────────────────────────────────────────────────────────────────────
const LIMITS: { key: keyof ProgramPatch; label: string; read: (p: Program) => number; unit: 'usd' | 'pts' | 'n' | 'tokens' }[] = [
  { key: 'custom_min_spend_increment_cents', label: 'Custom rule: smallest step', read: (p) => p.customMinSpendIncrementCents, unit: 'usd' },
  { key: 'custom_max_spend_increment_cents', label: 'Custom rule: largest step', read: (p) => p.customMaxSpendIncrementCents, unit: 'usd' },
  { key: 'custom_max_point_tenths_per_increment', label: 'Custom rule: most points per step', read: (p) => p.customMaxPointTenthsPerIncrement, unit: 'pts' },
  { key: 'max_point_tenths_per_ticket', label: 'Most points per ticket (network cap)', read: (p) => p.maxPointTenthsPerTicket, unit: 'pts' },
  { key: 'low_balance_cents', label: 'Wallet "running low" alert at', read: (p) => p.lowBalanceCents, unit: 'tokens' },
  { key: 'critical_balance_cents', label: 'Wallet "almost empty" alert at', read: (p) => p.criticalBalanceCents, unit: 'tokens' },
  { key: 'max_purchase_tokens', label: 'Largest single purchase (tokens)', read: (p) => p.maxPurchaseTokens, unit: 'n' },
];
const PAUSES: { key: 'earn_paused' | 'redeem_paused' | 'purchases_paused' | 'reimbursements_paused'; label: string; read: (p: Program) => boolean }[] = [
  { key: 'earn_paused', label: 'Earning', read: (p) => p.earnPaused }, { key: 'redeem_paused', label: 'Redemption', read: (p) => p.redeemPaused },
  { key: 'purchases_paused', label: 'Token purchases', read: (p) => p.purchasesPaused }, { key: 'reimbursements_paused', label: 'Reimbursements', read: (p) => p.reimbursementsPaused },
];
const show = (v: number, unit: string) => (unit === 'usd' ? usd(v) : unit === 'pts' ? `${pts(v)} pts` : unit === 'tokens' ? `${tokens(v)} tokens` : v.toLocaleString('en-US'));
const toRaw = (s: string, unit: string): number | null => { const x = Number(s); if (!Number.isFinite(x) || x < 0) return null; return unit === 'usd' || unit === 'tokens' ? Math.round(x * 100) : unit === 'pts' ? Math.round(x * 10) : Math.round(x); };
const fromRaw = (v: number, unit: string) => (unit === 'usd' || unit === 'tokens' ? (v / 100).toString() : unit === 'pts' ? (v / 10).toString() : String(v));

function OverviewTab({ ov, onDone, onFail }: TabProps) {
  const p = ov.program;
  const [pending, setPending] = useState<null | { title: string; patch: ProgramPatch; body: string }>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const changed = LIMITS.filter((l) => edit[l.key] !== undefined && toRaw(edit[l.key], l.unit) !== l.read(p));
  const bad = changed.some((l) => toRaw(edit[l.key], l.unit) == null);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Reward value" value={`${p.pointsPerRedeemBlock} pts = ${usd(p.redeemBlockValueCents)}`} sub="Fixed network-wide" />
        <Stat label="Token value" value={usd(p.tokenValueCents)} sub="1 token funds this much" />
        <Stat label="Salons on global rule" value={ov.impact.globalModeTenants} testId="sa-ln-impact-global" />
        <Stat label="Salons on custom rule" value={ov.impact.customModeTenants} />
        <Stat label="Rewards liability" value={usd(ov.reconciliation.rewardsLiabilityCents)} sub={ov.reconciliation.liabilityMatchesPoints ? 'Matches outstanding points' : 'Does NOT match outstanding points'} />
        <Stat label="Terms version" value={p.termsVersion} sub={`Program version ${p.version}`} />
      </div>
      <section className={card}>
        <h2 className="mb-1 text-base font-bold text-[#2f2a24]">Network switches</h2>
        <p className="mb-3 text-xs text-[#857566]">A pause stops that part of the network for every salon at once. Nothing already recorded is changed.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PAUSES.map((x) => { const on = x.read(p); return (
            <div key={x.key} className="flex items-center justify-between rounded-xl border border-[#eee5d8] bg-[#fffdf9] p-3" data-testid={`sa-ln-pause-${x.key}`}>
              <div><div className="text-sm font-semibold">{x.label}</div><StatusBadge tone={on ? 'warning' : 'success'}>{on ? 'Paused' : 'Running'}</StatusBadge></div>
              <button type="button" className={btn(on ? 'primary' : 'danger')} onClick={() => setPending({ title: `${on ? 'Resume' : 'Pause'} ${x.label.toLowerCase()}`, patch: { [x.key]: !on }, body: on ? `${x.label} resumes for every enrolled salon.` : `${x.label} stops for every enrolled salon until resumed.` })}>{on ? 'Resume' : 'Pause'}</button>
            </div>); })}
        </div>
      </section>
      <section className={card}>
        <h2 className="mb-1 text-base font-bold text-[#2f2a24]">Limits</h2>
        <p className="mb-3 text-xs text-[#857566]">Custom rules must stay inside these. A tighter limit does not rewrite rules already in force; it applies to new activations.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {LIMITS.map((l) => (
            <label key={l.key} className="block"><span className="mb-1 block text-xs font-semibold text-[#6d5c4b]">{l.label} <span className="font-normal text-[#9a8876]">now {show(l.read(p), l.unit)}</span></span>
              <input className={input} inputMode="decimal" value={edit[l.key] ?? fromRaw(l.read(p), l.unit)} onChange={(e) => setEdit((s) => ({ ...s, [l.key]: e.target.value }))} /></label>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className={btn()} disabled={!changed.length} onClick={() => setEdit({})}>Reset</button>
          <button type="button" className={btn('primary')} disabled={!changed.length || bad} onClick={() => setPending({ title: 'Change network limits', patch: Object.fromEntries(changed.map((l) => [l.key, toRaw(edit[l.key], l.unit)])) as ProgramPatch,
            body: changed.map((l) => `${l.label}: ${show(l.read(p), l.unit)} → ${show(toRaw(edit[l.key], l.unit) ?? 0, l.unit)}`).join(' · ') })}>Review changes</button>
        </div>
      </section>
      {pending ? <ReasonModal title={pending.title} body={pending.body} confirmLabel="Save" onClose={() => setPending(null)}
        onConfirm={async () => { try { await netApi.updateProgram(pending.patch, p.version); setEdit({}); onDone(`${pending.title}: saved.`); } catch (e) { onFail(e, 'The program was not changed.'); throw e; } }} /> : null}
    </div>
  );
}

// ── Global rules: versions + publish with preview / impact ─────────────────────────────────────────────────────────
function RulesTab({ ov, onDone, onFail }: TabProps) {
  const now = Date.now();
  const inForce = useMemo(() => ov.globalVersions.filter((v) => v.status === 'published' && Date.parse(v.effectiveFrom) <= now).sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom) || b.versionNo - a.versionNo)[0] ?? null, [ov, now]);
  const [spend, setSpend] = useState('5'); const [points, setPoints] = useState('0.5'); const [min, setMin] = useState('0'); const [cap, setCap] = useState('');
  const [at, setAt] = useState(''); const [reason, setReason] = useState('');
  const [prev, setPrev] = useState<GlobalPreview | null>(null); const [pErr, setPErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [cancel, setCancel] = useState<GlobalVersion | null>(null);
  const rate = useMemo((): Rate | null => {
    const s = Math.round(Number(spend) * 100), p = Math.round(Number(points) * 10), m = Math.round(Number(min || 0) * 100), c = cap.trim() ? Math.round(Number(cap) * 10) : null;
    return [s, p, m].every((x) => Number.isFinite(x) && x >= 0) && s > 0 && p > 0 && (c == null || (Number.isFinite(c) && c > 0)) ? { spendIncrementCents: s, pointTenthsPerIncrement: p, minEligibleCents: m, perTicketCapTenths: c } : null;
  }, [spend, points, min, cap]);
  const preview = async () => { if (!rate) return; setPErr(null); try { setPrev(await netApi.previewGlobal(rate)); } catch (e: any) { setPrev(null); setPErr(errText(e, 'Could not preview that rule.')); } };
  useEffect(() => { setPrev(null); }, [spend, points, min, cap]);
  const effIso = at ? new Date(at).toISOString() : null;
  const publish = async () => {
    if (!rate) return; setBusy(true);
    try { await netApi.publishGlobal({ ...rate, effectiveFrom: effIso, reason: reason.trim() }); setReason(''); setPrev(null); onDone(effIso ? `Global rule ${rateText(rate)} scheduled for ${when(effIso)}.` : `Global rule ${rateText(rate)} is now in force.`); }
    catch (e) { onFail(e, 'The global rule was not published.'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-5">
      <section className={card}>
        <h2 className="mb-1 text-base font-bold text-[#2f2a24]">Publish a global earning rule</h2>
        <p className="mb-3 text-xs text-[#857566]">In force now: <b>{rateText(inForce)}</b>. A new version reaches every salon on the global rule from its start time; salons on their own custom rule are not changed. Sales already paid keep the rule they were paid under.</p>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <label className="block"><span className="mb-1 block text-xs font-semibold text-[#6d5c4b]">For every ($)</span><input className={input} inputMode="decimal" value={spend} onChange={(e) => setSpend(e.target.value)} data-testid="sa-ln-g-spend" /></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-[#6d5c4b]">Points earned</span><input className={input} inputMode="decimal" value={points} onChange={(e) => setPoints(e.target.value)} data-testid="sa-ln-g-points" /></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-[#6d5c4b]">Minimum sale ($)</span><input className={input} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-[#6d5c4b]">Most points per ticket</span><input className={input} inputMode="decimal" value={cap} placeholder="Network cap" onChange={(e) => setCap(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-semibold text-[#6d5c4b]">Starts (blank = now)</span><input className={input} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
          <div className="flex items-end"><button type="button" className={btn()} disabled={!rate} onClick={() => void preview()} data-testid="sa-ln-g-preview">Preview</button></div>
        </div>
        {pErr ? <div role="alert" className="mt-3 text-sm text-[#9a3b1e]">{pErr}</div> : null}
        {prev ? <div className="mt-4" data-testid="sa-ln-g-preview-panel">
          <div className="mb-2 text-sm text-[#5e4d3b]">Reaches <b>{prev.impact.globalModeTenants}</b> salon(s) on the global rule · <b>{prev.impact.customModeTenants}</b> on a custom rule are not changed.</div>
          <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-[#9a8876]"><th className="py-2">Sale</th><th>New points</th><th>Tokens used</th><th>Now</th><th>Difference</th></tr></thead>
            <tbody>{prev.rows.map((r) => <tr key={r.eligibleCents} className="border-t border-[#f0e6d5]"><td className="py-2 font-semibold">{usd(r.eligibleCents)}</td><td>{pts(r.pointTenths)}</td><td>{tokens(r.tokenCostCents)}</td><td>{pts(r.globalPointTenths)} pts · {tokens(r.globalTokenCostCents)}</td>
              <td className={r.differenceCents > 0 ? 'text-[#9a3b1e]' : r.differenceCents < 0 ? 'text-[#2f6b3a]' : ''}>{r.differenceCents === 0 ? '0' : `${r.differenceCents > 0 ? '+' : '−'}${tokens(Math.abs(r.differenceCents))}`}</td></tr>)}</tbody></table>
          <label className="mt-3 block"><span className="mb-1 block text-xs font-semibold text-[#6d5c4b]">Reason (at least 10 characters, recorded in the audit log)</span><input className={input} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="sa-ln-g-reason" /></label>
          <div className="mt-3 flex justify-end"><button type="button" className={btn('primary')} disabled={busy || reason.trim().length < 10} onClick={() => void publish()} data-testid="sa-ln-g-publish">{busy ? 'Publishing…' : effIso ? 'Schedule global rule' : 'Publish now'}</button></div>
        </div> : null}
      </section>
      <section className={card}>
        <h2 className="mb-3 text-base font-bold text-[#2f2a24]">Versions</h2>
        <table className="w-full text-sm" data-testid="sa-ln-versions"><thead><tr className="text-left text-xs uppercase text-[#9a8876]"><th className="py-2">#</th><th>Rule</th><th>Minimum</th><th>Ticket cap</th><th>Starts</th><th>State</th><th>Reason</th><th /></tr></thead>
          <tbody>{ov.globalVersions.map((v) => { const future = Date.parse(v.effectiveFrom) > now; const state = v.status !== 'published' ? v.status : future ? 'scheduled' : inForce?.versionId === v.versionId ? 'in force' : 'superseded';
            return <tr key={v.versionId} className="border-t border-[#f0e6d5]"><td className="py-2">{v.versionNo}</td><td className="font-semibold">{rateText(v)}</td><td>{usd(v.minEligibleCents)}</td><td>{v.perTicketCapTenths == null ? 'Network cap' : `${pts(v.perTicketCapTenths)} pts`}</td><td>{when(v.effectiveFrom)}</td>
              <td><StatusBadge tone={state === 'in force' ? 'success' : state === 'scheduled' ? 'info' : 'neutral'}>{state}</StatusBadge></td><td className="max-w-[260px] truncate text-xs text-[#857566]">{v.reason ?? ''}</td>
              <td>{v.status === 'published' && future ? <button type="button" className={btn('danger')} onClick={() => setCancel(v)}>Cancel</button> : null}</td></tr>; })}</tbody></table>
      </section>
      {cancel ? <ReasonModal danger title={`Cancel global rule #${cancel.versionNo}`} body={`${rateText(cancel)} from ${when(cancel.effectiveFrom)} will not start. The rule in force stays.`} confirmLabel="Cancel this version" onClose={() => setCancel(null)}
        onConfirm={async () => { try { await netApi.cancelGlobal(cancel.versionId); onDone(`Global rule #${cancel.versionNo} canceled.`); } catch (e) { onFail(e, 'The version was not canceled.'); throw e; } }} /> : null}
    </div>
  );
}

// ── Salons: enrollment ─────────────────────────────────────────────────────────────────────────────────────────────
function SalonsTab({ ov, onDone, onFail }: TabProps) {
  const [q, setQ] = useState(''); const [page, setPage] = useState(1); const [data, setData] = useState<LoyaltyNetPaged<Enrollment> | null>(null); const [err, setErr] = useState<string | null>(null);
  const [act, setAct] = useState<null | { row: Enrollment; to: 'enrolled' | 'suspended' | 'withdrawn' }>(null);
  const load = useCallback(() => { setErr(null); netApi.enrollments({ q: q.trim() || undefined, page, pageSize: 20 }).then(setData).catch((e) => setErr(errText(e, 'Could not load salons.'))); }, [q, page]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const tv = ov.program.tokenValueCents;
  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-bold text-[#2f2a24]">Salons</h2>
        <input className={input + ' max-w-xs'} placeholder="Search salon name or code" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search salons" /></div>
      {err ? <ErrorState message={err} onRetry={load} /> : !data ? <LoadingSkeleton lines={5} /> : <>
        <table className="w-full text-sm" data-testid="sa-ln-salons"><thead><tr className="text-left text-xs uppercase text-[#9a8876]"><th className="py-2">Salon</th><th>Network</th><th>Earning rule</th><th>Wallet</th><th>Alert</th><th /></tr></thead>
          <tbody>{data.items.map((r) => <tr key={r.tenantId} className="border-t border-[#f0e6d5]" data-testid="sa-ln-salon-row">
            <td className="py-2"><div className="font-semibold">{r.name ?? '—'}</div><div className="text-xs text-[#9a8876]">{r.code ?? r.tenantId.slice(0, 8)}</div></td>
            <td><StatusBadge tone={STATUS_TONE[r.enrollment] ?? 'neutral'}>{r.enrollment.replace('_', ' ')}</StatusBadge>{r.purchasingSuspended ? <div className="text-xs text-[#9a3b1e]">purchasing suspended</div> : null}{r.earningSuspended ? <div className="text-xs text-[#9a3b1e]">earning suspended</div> : null}</td>
            <td>{r.enrollment === 'not_enrolled' ? '—' : r.mode === 'CUSTOM' ? 'Custom' : 'Global'}</td>
            <td>{r.enrollment === 'not_enrolled' ? '—' : `${tokens(r.availableCents, tv)} tokens`}{r.deficitCents ? <div className="text-xs text-[#9a3b1e]">deficit {usd(r.deficitCents)}</div> : null}</td>
            <td>{r.enrollment === 'not_enrolled' ? '—' : <StatusBadge tone={STATUS_TONE[r.alertLevel] ?? 'neutral'}>{r.alertLevel}</StatusBadge>}</td>
            <td className="space-x-2 text-right">{r.enrollment !== 'enrolled' ? <button type="button" className={btn('primary')} onClick={() => setAct({ row: r, to: 'enrolled' })} data-testid="sa-ln-enroll">Enroll</button> : <>
              <button type="button" className={btn()} onClick={() => setAct({ row: r, to: 'suspended' })}>Suspend</button><button type="button" className={btn('danger')} onClick={() => setAct({ row: r, to: 'withdrawn' })}>Withdraw</button></>}</td>
          </tr>)}</tbody></table>
        <Pagination page={data.page} pageCount={data.pageCount} onPage={setPage} />
      </>}
      {act ? <ReasonModal danger={act.to !== 'enrolled'} title={`${act.to === 'enrolled' ? 'Enroll' : act.to === 'suspended' ? 'Suspend' : 'Withdraw'} ${act.row.name ?? 'salon'}`}
        body={act.to === 'enrolled' ? 'The salon joins the network: its customers can earn (funded by its own tokens) and use points at any enrolled salon. A wallet is opened at zero.'
          : act.to === 'suspended' ? 'Earning and token purchases stop for this salon. Points already issued stay valid everywhere; its wallet is kept.' : 'The salon leaves the network. Its history, wallet and issued points are kept.'}
        confirmLabel={act.to === 'enrolled' ? 'Enroll' : act.to === 'suspended' ? 'Suspend' : 'Withdraw'} onClose={() => setAct(null)}
        onConfirm={async (reason) => { try { await netApi.setEnrollment(act.row.tenantId, { status: act.to, ...(act.to === 'suspended' ? { earningSuspended: true, purchasingSuspended: true } : {}), reason }); load(); onDone(`${act.row.name ?? 'Salon'}: ${act.to.replace('_', ' ')}.`); } catch (e) { onFail(e, 'The enrollment was not changed.'); throw e; } }} /> : null}
    </section>
  );
}

// ── Token purchases (all salons) + sandbox stand-in for the provider ───────────────────────────────────────────────
function PurchasesTab({ ov, onDone, onFail }: TabProps) {
  const [page, setPage] = useState(1); const [data, setData] = useState<LoyaltyNetPaged<Purchase> | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); netApi.purchases({ page, pageSize: 20 }).then(setData).catch((e) => setErr(errText(e, 'Could not load purchases.'))); }, [page]);
  useEffect(() => { load(); }, [load]);
  const advance = async (p: Purchase, to: string) => { setBusy(p.id); try { await netApi.sandboxAdvance(p.id, to); load(); onDone(`Sandbox purchase moved to ${to}.`); } catch (e) { onFail(e, 'The purchase was not moved.'); } finally { setBusy(null); } };
  const sandbox = ov.funding.sandbox;
  return (
    <section className={card}>
      <h2 className="mb-1 text-base font-bold text-[#2f2a24]">Token purchases</h2>
      <p className="mb-3 text-xs text-[#857566]">Tokens are spendable only at <b>Funds verified</b>. {sandbox ? 'SANDBOX: you can stand in for the provider’s later answers below — no real money moves.' : 'A live provider moves purchases through its signed answers; they cannot be changed here.'}</p>
      {err ? <ErrorState message={err} onRetry={load} /> : !data ? <LoadingSkeleton lines={5} /> : data.items.length === 0 ? <div className="py-6 text-center text-sm text-[#857566]">No token purchases yet.</div> : <>
        <table className="w-full text-sm" data-testid="sa-ln-purchases"><thead><tr className="text-left text-xs uppercase text-[#9a8876]"><th className="py-2">Requested</th><th>Salon</th><th>Tokens</th><th>Amount</th><th>Status</th><th>Provider</th>{sandbox ? <th>Sandbox</th> : null}</tr></thead>
          <tbody>{data.items.map((p) => <tr key={p.id} className="border-t border-[#f0e6d5]" data-testid="sa-ln-purchase-row">
            <td className="py-2">{when(p.createdAt)}</td><td className="font-mono text-xs">{p.tenantId.slice(0, 8)}</td><td>{tokens(p.tokenCents, ov.program.tokenValueCents)}</td><td>{usd(p.amountCents)}</td>
            <td><StatusBadge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status.replace(/_/g, ' ').toLowerCase()}</StatusBadge>{p.failureCode ? <div className="text-xs text-[#9a3b1e]">{p.failureCode}</div> : null}</td>
            <td className="text-xs">{p.provider ?? '—'}{p.providerRefLast6 ? ` …${p.providerRefLast6}` : ''}</td>
            {sandbox ? <td className="space-x-1">{(SANDBOX_NEXT[p.status] ?? []).map((to) => <button key={to} type="button" className={btn(to === 'FUNDS_VERIFIED' ? 'primary' : 'ghost')} disabled={busy === p.id} onClick={() => void advance(p, to)} data-testid={`sa-ln-adv-${to}`}>{to.replace(/_/g, ' ').toLowerCase()}</button>)}</td> : null}
          </tr>)}</tbody></table>
        <Pagination page={data.page} pageCount={data.pageCount} onPage={setPage} />
      </>}
    </section>
  );
}

// ── Reconciliation ─────────────────────────────────────────────────────────────────────────────────────────────────
const ACCOUNTS: Record<string, string> = { settlement_cash: 'Settlement cash', merchant_prepaid_liability: 'Salons’ prepaid tokens (liability)', rewards_liability: 'Customers’ points (liability)', reimbursement_payable: 'Reimbursements payable', funding_deficit_receivable: 'Funding deficit receivable' };
/** the server reports credit balances (liabilities positive); assets are shown as their debit balance */
const ASSETS = new Set(['settlement_cash', 'funding_deficit_receivable']);
function ReconTab() {
  const [r, setR] = useState<Reconciliation | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); netApi.reconciliation().then(setR).catch((e) => setErr(errText(e, 'Could not run reconciliation.'))); }, []);
  useEffect(() => { load(); }, [load]);
  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!r) return <LoadingSkeleton lines={6} />;
  const checks: [string, boolean, string][] = [
    ['Every journal entry balances', r.unbalancedEntries === 0, r.unbalancedEntries ? `${r.unbalancedEntries} unbalanced` : 'all balanced'],
    ['Wallets equal their token ledgers', r.walletMismatches.length === 0, r.walletMismatches.length ? `${r.walletMismatches.length} salon(s) differ` : 'all match'],
    ['Customer balances equal their points ledgers', r.pointsMismatches === 0, r.pointsMismatches ? `${r.pointsMismatches} account(s) differ` : 'all match'],
    ['Points liability equals outstanding points', r.liabilityMatchesPoints, `${usd(r.rewardsLiabilityCents)} vs ${usd(r.outstandingPointsValueCents)}`],
  ];
  return (
    <div className="space-y-5" data-testid="sa-ln-recon">
      <section className={card}>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold text-[#2f2a24]">Checks <span className="text-xs font-normal text-[#9a8876]">run {when(r.generatedAt)}</span></h2><button type="button" className={btn()} onClick={load}>Run again</button></div>
        <ul className="space-y-2">{checks.map(([label, ok, detail]) => <li key={label} className="flex items-center justify-between rounded-xl border border-[#eee5d8] bg-[#fffdf9] px-4 py-3"><span className="text-sm font-semibold">{label}</span><span className="flex items-center gap-2 text-xs text-[#857566]">{detail}<StatusBadge tone={ok ? 'success' : 'danger'}>{ok ? 'OK' : 'Exception'}</StatusBadge></span></li>)}</ul>
        {r.walletMismatches.length ? <div className="mt-3 text-xs text-[#9a3b1e]">{r.walletMismatches.map((m) => `${m.tenantId.slice(0, 8)}: wallet ${usd(m.walletCents)} vs ledger ${usd(m.ledgerCents)}`).join(' · ')}</div> : null}
      </section>
      <div className="grid gap-5 lg:grid-cols-3">
        <section className={card}><h2 className="mb-3 text-base font-bold text-[#2f2a24]">Account balances</h2>
          <ul className="space-y-1 text-sm">{Object.keys(ACCOUNTS).map((k) => <li key={k} className="flex justify-between"><span>{ACCOUNTS[k]}</span><b>{usd((ASSETS.has(k) ? -1 : 1) * (r.balances[k] ?? 0))}</b></li>)}</ul></section>
        <section className={card}><h2 className="mb-3 text-base font-bold text-[#2f2a24]">Purchases by status</h2>
          {r.purchases.length ? <ul className="space-y-1 text-sm">{r.purchases.map((p) => <li key={p.status} className="flex justify-between"><span>{p.status.replace(/_/g, ' ').toLowerCase()} ({p.count})</span><b>{tokens(p.tokenCents)} tokens</b></li>)}</ul> : <div className="text-sm text-[#857566]">None yet.</div>}</section>
        <section className={card}><h2 className="mb-3 text-base font-bold text-[#2f2a24]">Reimbursements payable</h2>
          {r.payables.length ? <ul className="space-y-1 text-sm">{r.payables.map((p) => <li key={p.status} className="flex justify-between"><span>{p.status.toLowerCase()} ({p.count})</span><b>{usd(p.amountCents)}</b></li>)}</ul> : <div className="text-sm text-[#857566]">None yet.</div>}
          <p className="mt-2 text-xs text-[#857566]">A payable is not a payment: nothing is marked paid without a payout provider’s confirmation.</p></section>
      </div>
    </div>
  );
}
