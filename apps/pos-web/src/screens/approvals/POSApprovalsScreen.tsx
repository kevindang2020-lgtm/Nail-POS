// POSApprovalsScreen.tsx — /approvals: the salon's ONE approvals inbox (BUILD_PLAN Phase 9, contract §5).
//
//   To decide   pending requests — Approve / Reject (a note is required to reject). The server says per request whether
//               THIS person may decide it and why not (they asked for it, they lack the key, it is over their limit).
//   Mine        what I asked for — withdraw while it is pending.
//   History     everything decided, executed, expired.
//   Rules       the salon's approval rules per kind (owners change them — a step-up route).
//   Ask         ask for an approval (e.g. a refund the front desk cannot do itself: the payment, the amount, why).
//
// Every decision carries the request's version; a 409 (someone decided first / it changed) reloads. Realtime: the
// approval_updated event (refetch key "approvals") refreshes the lists. Nothing is computed here — the server decides.
import { useCallback, useEffect, useState } from 'react';
import type { ApprovalPolicyDetail, ApprovalRequestView, TenantApprovalKind } from '@aipowersalon/api-contracts/tenant';
import { parseDollarsToCents } from '@aipowersalon/money';
import { useCan } from '../../components/usePermissions';
import { useRealtime } from '../../realtime/useRealtime';
import { posApprovalsApi as api, WHY_NOT, approvalErrorText, isConflict } from '../../api/posApprovalsApi';
import { useStepUp, Tabs } from '../access/accessUi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney, fmtInZone, fmtNumber } from '../../i18n/format';
import { KpiCard } from '../../components/FitKit';

/** Approvals SUNMI guide (Nov 9 2026): the four summary categories, each from the server's own list and status —
 *   Pending Decisions  every pending request this person may see
 *   Awaiting Owner     pending requests this person cannot decide because they need a higher approver (over the limit /
 *                      missing the approval key) — the server's own canDecide / whyNot
 *   Urgent             pending requests that expire within 24 hours
 *   Completed          requests carried out (executed)
 *  Counted over the newest 100 pending (the server's page cap); more than that is said, never hidden. */
type Summary = { pending: number; awaitingOwner: number; urgent: number; completed: number | null; capped: boolean };
async function readSummary(now = Date.now()): Promise<Summary> {
  const [p, done] = await Promise.all([api.list({ status: 'pending', pageSize: 100 }), api.list({ status: 'executed', pageSize: 1 }).catch(() => null)]);
  const items = p.items;
  return {
    pending: p.total,
    awaitingOwner: items.filter((r) => !r.canDecide && (r.whyNot === 'over_your_limit' || r.whyNot === 'missing_permission')).length,
    urgent: items.filter((r) => r.expiresAt && Date.parse(r.expiresAt) - now <= 24 * 3600_000).length,
    completed: done ? done.total : null, capped: p.total > items.length,
  };
}

type Tab = 'inbox' | 'mine' | 'history' | 'rules' | 'ask';
const money = (c: number | null | undefined) => (c == null ? '' : fmtMoney(c));
const when = (iso: string | null | undefined) => { if (!iso) return ''; try { return fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
// labels are getters (read at render — an instant language switch re-labels in place); the codes stay the keys
export const KIND_LABEL: Record<TenantApprovalKind, string> = {
  get refund() { return tx('glossary.term.refund'); }, get void() { return tx('glossary.term.void'); },
  get discount_override() { return tx('admin.approvals.kind.discountOverride'); }, get deal_publish() { return tx('status.source.deal'); },
  get purchase_order() { return tx('admin.approvals.kind.purchaseOrder'); }, get price_override() { return tx('admin.approvals.kind.priceOverride'); },
  get payout_adjustment() { return tx('admin.approvals.kind.payoutAdjustment'); }, get loyalty_bonus() { return tx('lb.kind'); }, get other() { return tx('pos.other'); },
};
export const STATUS_LABEL: Record<string, string> = {
  get pending() { return tx('glossary.queue.waiting'); }, get approved() { return tx('pos.approved'); }, get rejected() { return tx('pos.rejected_2'); },
  get cancelled() { return tx('admin.approvals.status.withdrawn'); }, get expired() { return tx('pos.expired_2'); }, get executed() { return tx('pos.done'); },
  get execution_failed() { return tx('admin.approvals.status.executionFailed'); },
};
const ASKABLE: TenantApprovalKind[] = ['refund', 'void', 'discount_override', 'price_override', 'payout_adjustment', 'other'];

export function POSApprovalsScreen() {
  const can = useCan();
  const canDecideAny = can('approvals.decide');
  const canAsk = can('approvals.request');
  const canRules = can('approvals.manage_policies');
  const [tab, setTab] = useState<Tab>(canDecideAny ? 'inbox' : 'mine');
  const [items, setItems] = useState<ApprovalRequestView[] | null>(null);
  const [policies, setPolicies] = useState<ApprovalPolicyDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; decision: 'approve' | 'reject' | 'cancel' } | null>(null);
  const [note, setNote] = useState('');
  const stepUp = useStepUp();
  const [sum, setSum] = useState<Summary | null>(null); const [sumErr, setSumErr] = useState(false);
  const loadSummary = useCallback(() => { setSumErr(false); readSummary().then(setSum).catch(() => setSumErr(true)); }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useRealtime(['approvals'], loadSummary);

  const load = useCallback(async () => {
    try {
      if (tab === 'rules') { setPolicies(await api.policies()); return; }
      if (tab === 'ask') return;
      const q = tab === 'inbox' ? { status: 'pending' as const, pageSize: 50 } : tab === 'mine' ? { mine: true, status: 'all' as const, pageSize: 50 } : { status: 'all' as const, pageSize: 50 };
      setItems((await api.list(q)).items);
    } catch (e) { setError(approvalErrorText(e, tx('admin.approvals.error.load'))); }
  }, [tab]);
  useEffect(() => { setItems(null); setError(null); void load(); }, [load]);
  useRealtime(['approvals'], load);

  /** after a 409 the one request is re-read so its new status shows at once (then the list refreshes) */
  const refreshOne = async (id: string) => {
    try { const fresh = await api.one(id); setItems((xs) => (xs ? xs.map((x) => (x.id === id ? fresh : x)) : xs)); } catch { /* the list reload below covers it */ }
  };
  const decide = async (r: ApprovalRequestView, decision: 'approve' | 'reject', n: string | null) => {
    setBusy(r.id); setError(null); setNotice(null);
    try {
      const out = await api.decide(r.id, { decision, note: n, expectedVersion: r.version });
      setNotice(decision === 'reject' ? tx('pos.rejected_title', { title: String(out.title) }) : out.status === 'execution_failed' ? tx('pos.approved_but_it_did_not_complete_19xn', { v0: String(String((out.payload?.executionResult as any)?.error ?? tx('pos.see_the_request'))) }) : out.status === 'executed' ? tx('pos.approved_and_done_title', { title: String(out.title) }) : tx('pos.approved_title', { title: String(out.title) }));
      setNoteFor(null); setNote('');
    } catch (e) { if (isConflict(e)) await refreshOne(r.id); setError(approvalErrorText(e, tx('pos.that_did_not_work'))); }
    finally { setBusy(null); await load(); }
  };
  const withdraw = async (r: ApprovalRequestView, reason: string) => {
    setBusy(r.id); setError(null); setNotice(null);
    try { await api.cancel(r.id, reason); setNotice(tx('admin.approvals.notice.withdrawn', { title: r.title })); setNoteFor(null); setNote(''); }
    catch (e) { if (isConflict(e)) await refreshOne(r.id); setError(approvalErrorText(e, tx('pos.that_did_not_work'))); }
    finally { setBusy(null); await load(); }
  };

  const tabs: { id: Tab; label: string }[] = [
    ...(canDecideAny ? [{ id: 'inbox' as const, label: tx('pos.to_decide') }] : []),
    { id: 'mine', label: tx('pos.mine') }, { id: 'history', label: tx('pos.history') }, { id: 'rules', label: tx('pos.rules') },
    ...(canAsk ? [{ id: 'ask' as const, label: tx('pos.ask_for_approval') }] : []),
  ];

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{tx('pos.approvals')}</h1><div className="sub">{tx('pos.refunds_over_the_limit_deals_purchase_14qh')}</div></div>
      <div className="rvw-kpis apx-kpis" data-testid="apx-kpis">
        {([['pending', 'apx.kpi.pending', sum?.pending, 'inbox'], ['owner', 'apx.kpi.owner', sum?.awaitingOwner, 'inbox'], ['urgent', 'apx.kpi.urgent', sum?.urgent, 'inbox'], ['completed', 'apx.kpi.completed', sum?.completed, 'history']] as const).map(([k, label, v, go]) =>
          <KpiCard key={k} testId={`apx-kpi-${k}`} label={tx(label)} loading={!sum && !sumErr} tone={k === 'urgent' && v ? 'bad' : k === 'owner' && v ? 'warn' : k === 'completed' ? 'ok' : undefined}
            value={sum ? (v == null ? '—' : `${fmtNumber(v)}${sum.capped && k !== 'pending' && k !== 'completed' ? '+' : ''}`) : sumErr ? '—' : ''}
            sub={tx(label + 'Sub')} onClick={tabs.some((x) => x.id === go) ? () => { setTab(go); setNotice(null); } : undefined} />)}
      </div>
      <Tabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setNotice(null); }} label={tx('pos.approvals')} />
      {notice ? <div role="status" className="s" style={{ marginBottom: 8, fontWeight: 600 }} data-testid="approval-notice">{notice}</div> : null}
      {error ? <div role="alert" className="err" style={{ marginBottom: 8 }}>{error}</div> : null}

      {tab === 'rules' ? <RulesPanel policies={policies} canEdit={canRules} run={stepUp.run} onSaved={(p) => { setNotice(tx('admin.approvals.notice.ruleSaved', { kind: KIND_LABEL[p.kind].toLowerCase() })); void load(); }} onError={(e) => setError(e)} />
        : tab === 'ask' ? <AskPanel onDone={(r, created) => { setNotice(created ? tx('pos.sent_for_approval_title', { title: String(r.title) }) : tx('pos.already_waiting_for_approval_title', { title: String(r.title) })); setTab('mine'); }} onError={(e) => setError(e)} />
        : !items ? <div className="state">{tx('pos.loading')}</div>
        : items.length === 0 ? <div className="state" data-testid="approvals-empty">{tab === 'inbox' ? tx('pos.nothing_is_waiting_for_a_decision') : tx('pos.no_requests_here')}</div>
        : (
          <ul aria-label={tx('pos.approval_requests')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {items.map((r) => (
              <li key={r.id} className="panel" style={{ padding: 12 }} data-testid="approval-row">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <strong>{r.title}</strong>
                  <span className="s">{KIND_LABEL[r.kind] ?? r.kind} · {STATUS_LABEL[r.status] ?? r.status}</span>
                </div>
                <div className="s muted" style={{ marginTop: 4 }}>
                  {r.amountCents != null ? `${money(r.amountCents)} · ` : ''}{tx('pos.asked_by')}{' '}{r.requestedByName ?? tx('pos.a_team_member')} {when(r.createdAt)}{r.branchName ? ` · ${r.branchName}` : ''}
                  {r.status === 'pending' && r.expiresAt ? tx('pos.expires_expiresat', { expiresAt: String(when(r.expiresAt)) }) : ''}
                </div>
                <div className="s" style={{ marginTop: 6 }}>{r.reason}</div>
                {r.decidedByName || r.decisionNote ? <div className="s muted" style={{ marginTop: 4 }}>{r.decidedByName ? tx('pos.v0_by_decidedbyname_decidedat', { v0: String(STATUS_LABEL[r.status] ?? r.status), decidedByName: String(r.decidedByName), decidedAt: String(when(r.decidedAt)) }) : ''}{r.decisionNote ? ` — “${r.decisionNote}”` : ''}</div> : null}
                {r.status === 'pending' && tab === 'inbox' ? (
                  r.canDecide ? (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn primary" disabled={busy === r.id} aria-label={tx('pos.approve_title', { title: String(r.title) })} onClick={() => void decide(r, 'approve', null)}>{tx('pos.approve')}</button>
                      <button className="btn ghost" disabled={busy === r.id} aria-label={tx('pos.reject_title_2', { title: String(r.title) })} onClick={() => { setNoteFor({ id: r.id, decision: 'reject' }); setNote(''); }}>{tx('pos.reject')}</button>
                    </div>
                  ) : <div className="s muted" style={{ marginTop: 8 }} data-testid="approval-why-not">{WHY_NOT[r.whyNot ?? ''] ?? tx('pos.you_cannot_decide_this_request')}</div>
                ) : null}
                {r.status === 'pending' && tab === 'mine' ? (
                  <div style={{ marginTop: 8 }}><button className="btn ghost" disabled={busy === r.id} aria-label={tx('pos.withdraw_title_2', { title: String(r.title) })} onClick={() => { setNoteFor({ id: r.id, decision: 'cancel' }); setNote(''); }}>{tx('pos.withdraw')}</button></div>
                ) : null}
                {noteFor?.id === r.id ? (
                  <div role="group" aria-label={noteFor.decision === 'reject' ? tx('pos.reject_title', { title: String(r.title) }) : tx('pos.withdraw_title', { title: String(r.title) })} style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                    <label className="s">{noteFor.decision === 'reject' ? tx('pos.why_not_the_person_who_asked_ahkc') : tx('pos.why_are_you_withdrawing_it')}
                      <textarea aria-label={tx('pos.note')} value={note} onChange={(e) => setNote(e.target.value)} style={{ display: 'block', width: '100%' }} />
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" disabled={busy === r.id || note.trim().length < 3} onClick={() => void (noteFor.decision === 'reject' ? decide(r, 'reject', note.trim()) : withdraw(r, note.trim()))}>{noteFor.decision === 'reject' ? tx('pos.reject') : tx('pos.withdraw')}</button>
                      <button className="btn ghost" onClick={() => setNoteFor(null)}>{tx('pos.cancel')}</button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      {stepUp.prompt}
    </div>
  );
}

/** The salon's rules per kind. Owners edit (step-up); everyone with approvals.view reads. */
function RulesPanel({ policies, canEdit, run, onSaved, onError }: { policies: ApprovalPolicyDetail[] | null; canEdit: boolean; run: <T>(a: () => Promise<T>) => Promise<T>; onSaved: (p: ApprovalPolicyDetail) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState<TenantApprovalKind | null>(null);
  const [form, setForm] = useState<{ enabled: boolean; threshold: string; cash: string; limit: string; different: boolean; hours: string; reason: string }>({ enabled: true, threshold: '', cash: '', limit: '', different: true, hours: '24', reason: '' });
  if (!policies) return <div className="state">{tx('pos.loading')}</div>;
  const start = (p: ApprovalPolicyDetail) => {
    setEditing(p.kind);
    setForm({ enabled: p.enabled, threshold: p.thresholdCents == null ? '' : (p.thresholdCents / 100).toFixed(2), cash: p.cashThresholdCents == null ? '' : (p.cashThresholdCents / 100).toFixed(2),
      limit: p.approverLimitCents == null ? '' : (p.approverLimitCents / 100).toFixed(2), different: p.requireDifferentApprover, hours: String(p.expiresAfterHours), reason: '' });
  };
  const cents = (s: string) => (s.trim() === '' ? null : parseDollarsToCents(s));
  const save = async (p: ApprovalPolicyDetail) => {
    const threshold = cents(form.threshold); const cash = cents(form.cash); const limit = cents(form.limit);
    if ((form.threshold.trim() && threshold == null) || (form.cash.trim() && cash == null) || (form.limit.trim() && limit == null)) { onError(tx('admin.approvals.error.amountFormat')); return; }
    try {
      const out = await run(() => api.updatePolicy({ kind: p.kind, expectedVersion: p.version, enabled: form.enabled, thresholdCents: threshold, approverLimitCents: limit,
        ...(p.kind === 'refund' ? { cashThresholdCents: cash } : {}), requireDifferentApprover: form.different, expiresAfterHours: Number(form.hours), reason: form.reason.trim() }));
      setEditing(null); onSaved(out);
    } catch (e: any) { if (e?.code !== 'STEP_UP_CANCELLED') onError(approvalErrorText(e, tx('admin.approvals.error.saveRule'))); }
  };
  return (
    <ul aria-label={tx('pos.approval_rules')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
      {policies.map((p) => (
        <li key={p.kind} className="panel" style={{ padding: 12 }} data-testid="approval-rule">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{p.label}</strong><span className="s">{p.enabled ? tx('pos.on') : tx('pos.off')}</span></div>
          <div className="s muted" style={{ marginTop: 4 }}>
            {p.thresholdCents == null ? tx('pos.every_request_needs_an_approver') : tx('pos.needs_an_approver_over_thresholdcents', { thresholdCents: String(money(p.thresholdCents)) })}
            {p.cashThresholdCents != null ? tx('pos.cash_over_cashthresholdcents', { cashThresholdCents: String(money(p.cashThresholdCents)) }) : ''}
            {' · '}{p.requireDifferentApprover ? tx('pos.never_the_person_who_asked') : tx('pos.the_person_who_asked_may_approve')}
            {p.approverLimitCents != null ? tx('pos.managers_up_to_approverlimitcents', { approverLimitCents: String(money(p.approverLimitCents)) }) : ''} {tx('pos.expires_after')}{' '}{p.expiresAfterHours} h
          </div>
          {canEdit && editing !== p.kind ? <button className="btn ghost" style={{ marginTop: 8 }} aria-label={tx('pos.change_rule_label', { label: String(p.label) })} onClick={() => start(p)}>{tx('pos.change')}</button> : null}
          {editing === p.kind ? (
            <div role="group" aria-label={tx('pos.edit_rule_label', { label: String(p.label) })} style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {p.kind !== 'refund' ? <label className="s"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> {tx('pos.use_approvals_for_this')}</label> : null}
              <label className="s">{p.kind === 'refund' ? tx('pos.any_refund_over') : tx('pos.only_over_empty_always')}<input aria-label={tx('pos.threshold')} inputMode="decimal" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></label>
              {p.kind === 'refund' ? <label className="s">{tx('pos.cash_refund_over')}<input aria-label={tx('pos.cash_threshold')} inputMode="decimal" value={form.cash} onChange={(e) => setForm({ ...form, cash: e.target.value })} /></label> : null}
              <label className="s">{tx('pos.managers_may_approve_up_to_empty_11p5')}<input aria-label={tx('pos.approver_limit')} inputMode="decimal" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} /></label>
              <label className="s"><input type="checkbox" checked={form.different} onChange={(e) => setForm({ ...form, different: e.target.checked })} /> {tx('pos.someone_other_than_the_person_who_1yql')}</label>
              <label className="s">{tx('pos.expires_after_hours')}<input aria-label={tx('pos.expires_after_hours_2')} inputMode="numeric" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></label>
              <label className="s">{tx('pos.why_are_you_changing_it')}<input aria-label={tx('pos.reason_for_change')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" disabled={form.reason.trim().length < 5} onClick={() => void save(p)}>{tx('pos.save_2')}</button>
                <button className="btn ghost" onClick={() => setEditing(null)}>{tx('pos.cancel')}</button>
              </div>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Ask for an approval. A refund names the payment (on the receipt / the ticket's payments) — the server checks it. */
function AskPanel({ onDone, onError }: { onDone: (r: ApprovalRequestView, created: boolean) => void; onError: (m: string) => void }) {
  const [kind, setKind] = useState<TenantApprovalKind>('refund');
  const [subject, setSubject] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = amount.trim() === '' ? null : parseDollarsToCents(amount);
  const ok = reason.trim().length >= 3 && (kind !== 'refund' || subject.trim().length > 0) && (amount.trim() === '' || cents != null);
  const send = async () => {
    setBusy(true);
    try {
      const subjectType = kind === 'refund' ? 'payment' : 'request';
      const r = await api.create({ kind, subjectType, subjectId: subject.trim() || null, amountCents: cents, reason: reason.trim() });
      onDone(r.request, r.created);
    } catch (e) { onError(approvalErrorText(e, tx('admin.approvals.error.send'))); }
    finally { setBusy(false); }
  };
  return (
    <div className="panel" style={{ padding: 12, display: 'grid', gap: 8, maxWidth: 520 }} role="form" aria-label={tx('pos.ask_for_approval')}>
      <label className="s">{tx('pos.what_needs_approval')}
        <select aria-label={tx('pos.kind')} value={kind} onChange={(e) => setKind(e.target.value as TenantApprovalKind)} style={{ display: 'block', width: '100%' }}>
          {ASKABLE.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="s">{kind === 'refund' ? tx('pos.payment_the_payment_reference_on_the_w5uy') : tx('pos.reference_optional')}
        <input aria-label={tx('pos.reference')} value={subject} onChange={(e) => setSubject(e.target.value)} style={{ display: 'block', width: '100%' }} />
      </label>
      <label className="s">{kind === 'refund' ? tx('pos.amount_empty_everything_still_refundable') : tx('pos.amount_optional')}
        <input aria-label={tx('pos.amount_2')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ display: 'block', width: '100%' }} />
      </label>
      <label className="s">{tx('pos.why_2')}
        <textarea aria-label={tx('pos.why')} value={reason} onChange={(e) => setReason(e.target.value)} style={{ display: 'block', width: '100%' }} />
      </label>
      <button className="btn primary" disabled={!ok || busy} onClick={() => void send()}>{busy ? tx('pos.sending') : tx('pos.send_for_approval')}</button>
    </div>
  );
}
