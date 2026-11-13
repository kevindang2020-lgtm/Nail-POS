// LoyaltyIntegrityTab.tsx — Super Admin → Loyalty Network → Integrity (Final Completion guide §08, Recommendation #1).
// Ledger-backed figures from GET /super-admin/loyalty-network/integrity: prepaid token funding, outstanding customer points,
// active holds, reward liability vs points, reimbursements OWED (separate from payouts pending), provider-confirmed payouts
// and open discrepancies. Drilldowns: findings (review / resolve with a reason — never changes a ledger), payables (eligible,
// hold, payout → PAYOUT_PROVIDER_UNAVAILABLE while BLOCKED_EXTERNAL), fraud alerts (review-first), and the lineage of a
// redemption (funding → earning → hold → redemption → payable → payout). CSV export is audit-logged on the server.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { StatusBadge, ErrorState, LoadingSkeleton, Modal, Pagination, type Tone } from '@aipowersalon/ui';
import type { RewardsIdempotencyPage } from '@aipowersalon/api-contracts/platform';
import { superAdminLoyaltyNetworkApi as netApi, type Integrity, type LoyaltyNetFinding, type Payable, type FraudAlert, type Lineage, type LoyaltyNetPaged } from '../api/superAdminLoyaltyNetworkApi';

const usd = (c: number | null | undefined) => (c == null ? '—' : (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const pts = (t: number) => (t / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const errText = (e: any, fb: string) => (e?.message && e.message !== 'Request failed.' ? e.message : fb);
const TONE: Record<string, Tone> = { PASS: 'success', WARNING: 'warning', FAILED: 'danger', UNKNOWN: 'neutral', ERROR: 'danger', RUNNING: 'info', critical: 'danger', warning: 'warning', info: 'neutral',
  ACCRUED_OWED: 'warning', PAYOUT_ELIGIBLE: 'info', PAYOUT_PENDING: 'info', PAID: 'success', PAYOUT_FAILED: 'danger', ON_HOLD: 'warning', ADJUSTED: 'neutral', OFFSET: 'purple', high: 'danger', medium: 'warning', low: 'neutral',
  OPEN: 'warning', INVESTIGATING: 'info', RESOLVED: 'success', ACCEPTED: 'neutral', DISMISSED: 'neutral', CONFIRMED: 'danger' };
const card = 'rounded-2xl border border-[#e8dcc8] bg-white p-5 shadow-sm';
const btn = (k: 'primary' | 'ghost' | 'danger' = 'ghost') => k === 'primary' ? 'rounded-lg bg-[#b98224] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50' : k === 'danger' ? 'rounded-lg border border-[#e7b9a9] bg-white px-3 py-1.5 text-sm font-semibold text-[#9a3b1e] disabled:opacity-50' : 'rounded-lg border border-[#e2d5c1] bg-white px-3 py-1.5 text-sm font-semibold text-[#5e4d3b] disabled:opacity-50';
const label = (s: string) => s.replace(/_/g, ' ').toLowerCase();
const rid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function Kpi({ title, value, sub, tone, testId }: { title: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' | 'warn'; testId?: string }) {
  return <div className={'rounded-xl border p-4 ' + (tone === 'bad' ? 'border-[#efc2b4] bg-[#fff6f2]' : tone === 'warn' ? 'border-[#f0d9a6] bg-[#fff9ec]' : 'border-[#eee5d8] bg-[#fffdf9]')} data-testid={testId}>
    <div className="text-xs font-semibold uppercase tracking-wide text-[#9a8876]">{title}</div><div className="mt-1 text-xl font-bold text-[#30291f]">{value}</div>{sub ? <div className="mt-1 text-xs text-[#857566]">{sub}</div> : null}</div>;
}

function ReasonDialog({ title, options, onSubmit, onClose }: { title: string; options?: string[]; onSubmit: (to: string, note: string) => Promise<void>; onClose: () => void }) {
  const [to, setTo] = useState(options?.[0] ?? ''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  return <Modal open onClose={busy ? () => undefined : onClose} title={title}><div className="space-y-3 text-sm" data-testid="sa-ln-int-dialog">
    {options ? <label className="block"><span className="mb-1 block text-xs font-semibold">Move to</span><select className="w-full rounded-lg border border-[#e2d5c1] px-3 py-2" value={to} onChange={(e) => setTo(e.target.value)}>{options.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></label> : null}
    <label className="block"><span className="mb-1 block text-xs font-semibold">Note / reason (at least 10 characters, audit-logged)</span><textarea className="w-full rounded-lg border border-[#e2d5c1] px-3 py-2" rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="sa-ln-int-note" /></label>
    {err ? <div role="alert" className="text-[#9a3b1e]">{err}</div> : null}
    <div className="flex justify-end gap-2"><button type="button" className={btn()} onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className={btn('primary')} disabled={busy || note.trim().length < 10} data-testid="sa-ln-int-save" onClick={async () => { setBusy(true); setErr(null); try { await onSubmit(to, note.trim()); onClose(); } catch (e: any) { setErr(errText(e, 'Not saved.')); setBusy(false); } }}>Save</button></div>
  </div></Modal>;
}

function LineageDialog({ redemptionId, onClose }: { redemptionId: string; onClose: () => void }) {
  const [l, setL] = useState<Lineage | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { netApi.lineage(redemptionId).then(setL).catch((e) => setErr(errText(e, 'Could not load the lineage.'))); }, [redemptionId]);
  return <Modal open onClose={onClose} title="Redemption lineage" width={720}><div className="space-y-3 text-sm" data-testid="sa-ln-lineage">
    {err ? <ErrorState message={err} /> : !l ? <LoadingSkeleton lines={4} /> : <ol className="space-y-2">
      <li><b>Funding & earning</b> — {l.funding.length ? l.funding.map((f) => `${pts(f.pointTenths)} pts at salon ${f.earningSalonId.slice(0, 8)} (${usd(f.backingCents)} tokens, ${label(f.ruleSource)})`).join(' · ') : 'no earn rows before this redemption'}</li>
      <li><b>Hold</b> — {pts(l.redemption.pointTenths)} pts / {usd(l.redemption.valueCents)} at salon {l.redemption.redeemingSalonId.slice(0, 8)}, held {when(l.redemption.heldAt)}</li>
      <li><b>Redemption</b> — <StatusBadge tone={TONE[l.redemption.status] ?? 'neutral'}>{label(l.redemption.status)}</StatusBadge> {l.redemption.confirmedAt ? `confirmed ${when(l.redemption.confirmedAt)}` : ''} {l.redemption.reversedCents ? `· reversed ${usd(l.redemption.reversedCents)}` : ''}</li>
      <li><b>Payable</b> — {l.payable ? <><StatusBadge tone={TONE[l.payable.status] ?? 'neutral'}>{label(l.payable.status)}</StatusBadge> {usd(l.payable.amountCents - l.payable.adjustedCents)} owed of {usd(l.payable.amountCents)}</> : 'none'}</li>
      <li><b>Payouts</b> — {l.payouts.length ? l.payouts.map((p) => `${label(p.status)} ${usd(p.amountCents)} via ${p.provider}${p.settlementRef ? ` (settlement ${p.settlementRef})` : ''}`).join(' · ') : 'none (no payout provider approved)'}</li>
      {l.adjustments.length ? <li><b>Adjustments</b> — {l.adjustments.map((a) => `${label(a.kind)} ${usd(a.amountCents)}`).join(' · ')}</li> : null}
      <li><b>Journal</b> — {l.journal.map((j) => label(j.entryType)).join(' → ') || '—'}</li>
    </ol>}
  </div></Modal>;
}

export function LoyaltyIntegrityTab({ onNote }: { onNote: (tone: 'ok' | 'bad', text: string) => void }) {
  const [i, setI] = useState<Integrity | null>(null); const [err, setErr] = useState<string | null>(null);
  const [fp, setFp] = useState(1); const [findings, setFindings] = useState<LoyaltyNetPaged<LoyaltyNetFinding> | null>(null);
  const [pp, setPp] = useState(1); const [payables, setPayables] = useState<LoyaltyNetPaged<Payable> | null>(null);
  const [alerts, setAlerts] = useState<LoyaltyNetPaged<FraudAlert> | null>(null);
  const [dlg, setDlg] = useState<null | { kind: 'finding'; f: LoyaltyNetFinding } | { kind: 'fraud'; a: FraudAlert } | { kind: 'acct'; a: FraudAlert } | { kind: 'hold'; p: Payable } | { kind: 'lineage'; id: string }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    setErr(null);
    netApi.integrity().then(setI).catch((e) => setErr(errText(e, 'Could not load the integrity dashboard.')));
    netApi.findings({ page: fp, pageSize: 10 }).then(setFindings).catch(() => setFindings(null));
    netApi.payables({ page: pp, pageSize: 10 }).then(setPayables).catch(() => setPayables(null));
    netApi.fraudAlerts({ page: 1, pageSize: 10 }).then(setAlerts).catch(() => setAlerts(null));
  }, [fp, pp]);
  useEffect(() => { load(); }, [load]);
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); try { await fn(); onNote('ok', ok); load(); } catch (e: any) { onNote('bad', errText(e, 'That action was refused.')); } finally { setBusy(null); } };
  const exportCsv = async () => {
    try { const text = await netApi.findingsCsv(); const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = 'rewards-books-findings.csv'; a.click(); URL.revokeObjectURL(url); }
    catch (e: any) { onNote('bad', errText(e, 'Export failed.')); }
  };
  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!i) return <LoadingSkeleton lines={6} />;
  const openCritical = i.discrepancies.find((d) => d.severity === 'critical')?.open ?? 0;
  const last = i.books.lastRun;
  return (
    <div className="space-y-5" data-testid="sa-ln-integrity">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi testId="sa-ln-kpi-funding" title="Prepaid token funding" value={usd(i.funding.verifiedCents)} sub={`${usd(i.funding.walletAvailableCents)} unspent · ${usd(i.funding.consumedCents)} consumed · ${usd(i.funding.pendingCents)} pending`} tone={i.funding.deficitCents ? 'bad' : undefined} />
        <Kpi testId="sa-ln-kpi-points" title="Outstanding customer points" value={`${pts(i.points.availableTenths + i.points.heldTenths)} pts`} sub={`${usd(i.points.redemptionValueCents)} redemption value · ${i.points.accounts} accounts`} />
        <Kpi testId="sa-ln-kpi-holds" title="Active point holds" value={i.holds.count} sub={`${pts(i.holds.pointTenths)} pts · ${usd(i.holds.valueCents)} · ${i.holds.pastDeadline} past deadline`} tone={i.holds.pastDeadline ? 'warn' : undefined} />
        <Kpi testId="sa-ln-kpi-liability" title="Reward liability" value={usd(i.liability.journalCents)} sub={i.liability.deltaCents === 0 ? 'Matches outstanding points' : `Δ ${usd(i.liability.deltaCents)} vs points`} tone={i.liability.deltaCents ? 'bad' : undefined} />
        <Kpi testId="sa-ln-kpi-owed" title="Reimbursements owed" value={usd(i.payables.owedCents)} sub={`${usd(i.payables.pendingPayoutCents)} payout pending (separate)`} />
        <Kpi testId="sa-ln-kpi-paid" title="Provider-confirmed payouts" value={usd(i.payouts.settledCents)} sub={i.payouts.providerConfigured ? `${i.payouts.settledCount} settled` : 'BLOCKED_EXTERNAL — no payout provider approved'} tone={i.payouts.providerConfigured ? undefined : 'warn'} />
        <Kpi testId="sa-ln-kpi-discrepancies" title="Discrepancies" value={i.discrepancies.reduce((s, d) => s + d.open, 0)} sub={`${openCritical} critical · ${i.fraud.reduce((s, f) => s + f.open, 0)} fraud alerts open`} tone={openCritical ? 'bad' : undefined} />
      </div>

      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-bold text-[#2f2a24]">Daily books check</h2>
            <div className="text-xs text-[#857566]" data-testid="sa-ln-books-status">Last run: {last ? <><StatusBadge tone={TONE[last.status] ?? 'neutral'}>{last.status}</StatusBadge> {last.runKey} · {when(last.finishedAt ?? last.startedAt)} · {last.checks} checks · {last.failed} failed · {last.warnings} warnings{last.durationMs != null ? ` · ${last.durationMs} ms` : ''}{last.attempts > 1 ? ` · ${last.attempts} attempts` : ''}</> : 'never'} · Last daily: {i.books.lastDaily ? `${i.books.lastDaily.runKey} ${i.books.lastDaily.status}` : 'none yet'} · Next daily: {when(i.books.nextDailyAt)}</div></div>
          <div className="flex gap-2"><button type="button" className={btn()} onClick={() => void exportCsv()}>Export CSV</button>
            <button type="button" className={btn('primary')} disabled={busy === 'run'} data-testid="sa-ln-run-check" onClick={() => void act('run', () => netApi.runBooksCheck(), 'Books check finished.')}>{busy === 'run' ? 'Running…' : 'Run check now'}</button></div>
        </div>
        {!findings ? <LoadingSkeleton lines={3} /> : findings.items.length === 0 ? <div className="py-4 text-sm text-[#857566]">No open findings.</div> : <>
          <table className="w-full text-sm" data-testid="sa-ln-findings"><thead><tr className="text-left text-xs uppercase text-[#9a8876]"><th className="py-2">Check</th><th>Outcome</th><th>Salon</th><th>Expected / actual</th><th>Detail</th><th>Review</th><th /></tr></thead>
            <tbody>{findings.items.map((f) => <tr key={f.id} className="border-t border-[#f0e6d5]"><td className="py-2 font-semibold">{label(f.checkType)}<div className="text-xs font-normal text-[#9a8876]">{f.runKey}</div></td>
              <td><StatusBadge tone={TONE[f.outcome] ?? 'neutral'}>{f.outcome}</StatusBadge></td><td>{f.salon ?? (f.tenantId ? f.tenantId.slice(0, 8) : 'platform')}</td>
              <td className="text-xs">{f.expectedCents == null && f.actualCents == null ? '—' : `${f.expectedCents ?? '—'} / ${f.actualCents ?? '—'}${f.deltaCents ? ` (Δ ${f.deltaCents})` : ''}`}</td>
              <td className="max-w-[340px] text-xs">{f.detail}{f.recommendedAction ? <div className="text-[#9a6817]">{f.recommendedAction}</div> : null}</td>
              <td><StatusBadge tone={TONE[f.reviewStatus] ?? 'neutral'}>{label(f.reviewStatus)}</StatusBadge></td>
              <td><button type="button" className={btn()} onClick={() => setDlg({ kind: 'finding', f })}>Review</button></td></tr>)}</tbody></table>
          <Pagination page={findings.page} pageCount={findings.pageCount} onPage={setFp} /></>}
      </section>

      <section className={card}>
        <h2 className="mb-1 text-base font-bold text-[#2f2a24]">Reimbursements owed to salons</h2>
        <p className="mb-3 text-xs text-[#857566]">Owed is not paid. A payable becomes PAID only from a payout provider’s verified settlement — never by a click here. No payout provider is approved: payouts are BLOCKED_EXTERNAL.</p>
        {!payables ? <LoadingSkeleton lines={3} /> : payables.items.length === 0 ? <div className="py-4 text-sm text-[#857566]">Nothing owed yet.</div> : <>
          <table className="w-full text-sm" data-testid="sa-ln-payables"><thead><tr className="text-left text-xs uppercase text-[#9a8876]"><th className="py-2">Accrued</th><th>Salon</th><th>Points</th><th>Owed</th><th>Status</th><th /></tr></thead>
            <tbody>{payables.items.map((p) => <tr key={p.id} className="border-t border-[#f0e6d5]" data-testid="sa-ln-payable-row"><td className="py-2">{when(p.createdAt)}</td><td>{p.salon ?? p.tenantId.slice(0, 8)}</td><td>{pts(p.pointTenths)}</td>
              <td>{usd(p.owedCents)}{p.adjustedCents ? <div className="text-xs text-[#857566]">of {usd(p.amountCents)}</div> : null}</td>
              <td><StatusBadge tone={TONE[p.status] ?? 'neutral'}>{label(p.status)}</StatusBadge>{p.holdReason ? <div className="text-xs text-[#9a3b1e]">{p.holdReason}</div> : null}</td>
              <td className="space-x-1 text-right">
                <button type="button" className={btn()} onClick={() => setDlg({ kind: 'lineage', id: p.redemptionId })}>Lineage</button>
                {['ACCRUED_OWED', 'PAYOUT_FAILED', 'ON_HOLD'].includes(p.status) ? <button type="button" className={btn()} disabled={busy === p.id} onClick={() => void act(p.id, () => netApi.markEligible(p.id), 'Payable is eligible for payout.')}>Eligible</button> : null}
                {['ACCRUED_OWED', 'PAYOUT_ELIGIBLE', 'PAYOUT_FAILED'].includes(p.status) ? <button type="button" className={btn('danger')} onClick={() => setDlg({ kind: 'hold', p })}>Hold</button> : null}
                {p.status === 'PAYOUT_ELIGIBLE' ? <button type="button" className={btn('primary')} disabled={busy === p.id} data-testid="sa-ln-payout" onClick={() => void act(p.id, () => netApi.requestPayout(p.id, rid()), 'Payout requested.')}>Pay out</button> : null}
              </td></tr>)}</tbody></table>
          <Pagination page={payables.page} pageCount={payables.pageCount} onPage={setPp} /></>}
      </section>

      <section className={card}>
        <h2 className="mb-1 text-base font-bold text-[#2f2a24]">Fraud alerts (review-first)</h2>
        <p className="mb-3 text-xs text-[#857566]">Signals with evidence and confidence — not findings of fraud. Nothing is taken from a customer or a salon automatically.</p>
        {!alerts ? <LoadingSkeleton lines={2} /> : alerts.items.length === 0 ? <div className="py-4 text-sm text-[#857566]">No open alerts.</div> :
          <table className="w-full text-sm" data-testid="sa-ln-fraud"><thead><tr className="text-left text-xs uppercase text-[#9a8876]"><th className="py-2">Signal</th><th>Severity</th><th>Confidence</th><th>Customer</th><th>Evidence</th><th>Status</th><th /></tr></thead>
            <tbody>{alerts.items.map((a) => <tr key={a.id} className="border-t border-[#f0e6d5]"><td className="py-2 font-semibold">{label(a.signal)}</td><td><StatusBadge tone={TONE[a.severity] ?? 'neutral'}>{a.severity}</StatusBadge></td>
              <td>{Math.round(a.confidence * 100)}%</td><td className="font-mono text-xs">{a.customerRef ?? '—'}</td><td className="max-w-[320px] truncate font-mono text-xs">{JSON.stringify(a.evidence)}</td>
              <td><StatusBadge tone={TONE[a.status] ?? 'neutral'}>{label(a.status)}</StatusBadge></td><td className="flex gap-1"><button type="button" className={btn()} onClick={() => setDlg({ kind: 'fraud', a })}>Review</button>{a.hasAccount ? <button type="button" className={btn()} onClick={() => setDlg({ kind: 'acct', a })} data-testid="sa-ln-acct">Account</button> : null}</td></tr>)}</tbody></table>}
      </section>

      {dlg?.kind === 'finding' ? <ReasonDialog title={`Review: ${label(dlg.f.checkType)}`} options={['INVESTIGATING', 'RESOLVED', 'ACCEPTED', 'OPEN'].filter((o) => o !== dlg.f.reviewStatus)} onClose={() => setDlg(null)}
        onSubmit={async (to, note) => { await netApi.reviewFinding(dlg.f.id, to, note); onNote('ok', 'Finding updated. No ledger was changed.'); load(); }} /> : null}
      {dlg?.kind === 'fraud' ? <ReasonDialog title={`Review alert: ${label(dlg.a.signal)}`} options={['INVESTIGATING', 'DISMISSED', 'CONFIRMED', 'OPEN'].filter((o) => o !== dlg.a.status)} onClose={() => setDlg(null)}
        onSubmit={async (to, note) => { await netApi.reviewFraud(dlg.a.id, to, note); onNote('ok', 'Alert updated.'); load(); }} /> : null}
      {dlg?.kind === 'acct' ? <ReasonDialog title={`Rewards account ${dlg.a.customerRef ?? ''}`} options={['suspended', 'active']} onClose={() => setDlg(null)}
        onSubmit={async (to, note) => { await netApi.alertAccountStatus(dlg.a.id, to as 'suspended' | 'active', note); onNote('ok', to === 'suspended' ? 'Account suspended: it cannot earn or redeem until reactivated. Points are kept.' : 'Account reactivated.'); load(); }} /> : null}
      {dlg?.kind === 'hold' ? <ReasonDialog title="Put payable on hold" onClose={() => setDlg(null)} onSubmit={async (_to, note) => { await netApi.holdPayable(dlg.p.id, note); onNote('ok', 'Payable on hold.'); load(); }} /> : null}
      {dlg?.kind === 'lineage' ? <LineageDialog redemptionId={dlg.id} onClose={() => setDlg(null)} /> : null}
      <IdempotencyCenter />
    </div>
  );
}

/** extras GLOBAL LOYALTY REWARDS 11 (round 10): every repeated rewards request key — read only. A replay was answered with the
 *  first result (no second charge or redemption); a conflict was refused. */
export function IdempotencyCenter() {
  const [outcome, setOutcome] = useState(''); const [page, setPage] = useState(1);
  const [d, setD] = useState<RewardsIdempotencyPage | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setErr(null); netApi.idempotency({ ...(outcome ? { outcome } : {}), page, pageSize: 10 }).then(setD).catch((e: unknown) => setErr(String((e as Error)?.message ?? 'Could not load.'))); }, [outcome, page]);
  return (
    <section className={card} data-testid="sa-ln-idem">
      <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-base font-bold text-[#2f2a24]">Repeated request keys</h2>
        <select value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(1); }} data-testid="sa-ln-idem-outcome" className="rounded-lg border border-[#e2d5c1] px-2 py-1 text-sm">
          <option value="">All</option><option value="conflict">Conflicts (refused)</option><option value="replay">Replays (no second effect)</option></select></div>
      <p className="mb-2 text-xs text-[#7a6a58]">Read only. A replay was answered with the first result — nothing was charged or redeemed twice. A conflict reused a key for a different request and was refused.</p>
      {err ? <div role="alert" className="text-sm text-[#9a3b1e]">{err}</div> : !d ? <LoadingSkeleton /> : d.items.length === 0 ? <div className="text-sm text-[#7a6a58]">No repeated keys.</div> : <>
        <div className="mb-1 text-sm" data-testid="sa-ln-idem-total">{d.total} repeated · {d.conflicts} conflict(s)</div>
        <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-[#9a8876]"><th className="py-2">When</th><th>Salon</th><th>What</th><th>Outcome</th><th>Key</th><th>Times seen</th></tr></thead>
          <tbody>{d.items.map((x) => <tr key={x.id} className="border-t border-[#f0e6d5]" data-testid="sa-ln-idem-row"><td className="py-2">{new Date(x.at).toLocaleString()}</td><td>{x.salon ?? '—'}</td>
            <td>{x.scope === 'token_purchase' ? 'Token purchase' : 'Redemption'}</td><td><StatusBadge tone={x.outcome === 'conflict' ? 'danger' : 'neutral'}>{x.outcome === 'conflict' ? 'Conflict — refused' : 'Replay — same result'}</StatusBadge></td>
            <td className="font-mono">{x.keyRef}</td><td>{x.repeats}</td></tr>)}</tbody></table>
        {d.pageCount > 1 ? <Pagination page={d.page} pageCount={d.pageCount} onPage={setPage} /> : null}</>}
    </section>
  );
}
