// OwnerApprovalRequestsCard.tsx — BUILD_PLAN Phase 9 (agent D): the Approval Center's list of the salon approvals engine's
// requests (refunds over the limit, deals, purchase orders, anything staff asked for). Approve / Reject with a note
// (expectedVersion; a 409 reloads and says so); the server's why-not replaces the buttons (e.g. the owner asked for it
// themselves). A short summary of the salon's rules underneath (changed on the POS Approvals screen). Hidden when the
// session cannot read approvals (403). Live: approval_updated (and the stream's reconcile) reload it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { networkState } from '@aipowersalon/mobile-sdk';
import { newIdempotencyKey } from '@aipowersalon/api-client';
import { ownerApprovalRequestsApi, type ApprovalPolicyDetail, type ApprovalRequestView } from '../api/ownerApprovalRequestsApi';
import { useOwnerStream } from '../api/useOwnerStream';
import { formatCurrency } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

const money = (c: number | null | undefined) => (c == null ? '' : formatCurrency(c));
const KIND: Record<string, string> = { refund: 'Refund', void: 'Void', discount_override: 'Discount override', deal_publish: 'Deal', purchase_order: 'Purchase order', price_override: 'Price override', payout_adjustment: 'Payout adjustment', loyalty_bonus: 'Bonus loyalty points', other: 'Request' };
const WHY: Record<string, string> = {
  requester_cannot_approve: 'You asked for this — someone else has to approve it.',
  missing_permission: 'Your account cannot approve this kind of request.',
  over_your_limit: 'Over your approval limit.',
};
type Err = { status?: number; code?: string; message?: string } | null;
export function ownerApprovalError(e: unknown, fallback: string): string {
  const x = e as Err;
  if (x?.code === 'version_conflict' || x?.code === 'not_pending' || x?.status === 409) return 'Someone else decided this a moment ago — the list has been refreshed.';
  if (x?.code && WHY[x.code]) return WHY[x.code];
  if (x?.status === 403) return 'You do not have permission for this.';
  return x?.message || fallback;
}
export function ruleLine(p: ApprovalPolicyDetail): string {
  if (!p.enabled) return `${p.label}: off`;
  const when = p.thresholdCents == null ? 'always' : `over ${money(p.thresholdCents)}${p.cashThresholdCents != null ? ` (cash over ${money(p.cashThresholdCents)})` : ''}`;
  return `${p.label}: ${when}${p.requireDifferentApprover ? ', never by the person who asked' : ''}`;
}

/** What happened, in words (an approved request whose action failed says so). */
export function decidedText(r: ApprovalRequestView, decision: 'approve' | 'reject', out: ApprovalRequestView): string {
  if (decision === 'reject') return `Rejected “${r.title}”.`;
  if (out.status === 'execution_failed') {
    const code = (out.payload?.executionResult as { code?: string } | undefined)?.code;
    if (code === 'LOYALTY_BONUS_NEEDS_FUNDING') return `Approved “${r.title}”, but the salon does not have enough reward tokens — no points were added. Buy tokens, then ask for it again.`;
    return `Approved “${r.title}”, but it did not complete.`;
  }
  return `Approved “${r.title}”.`;
}

export function OwnerApprovalRequestsCard() {
  const [items, setItems] = useState<ApprovalRequestView[]>([]);
  const [rules, setRules] = useState<ApprovalPolicyDetail[]>([]);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => Promise.allSettled([ownerApprovalRequestsApi.pending(), ownerApprovalRequestsApi.policies()]).then(([r, p]) => {
    if (r.status === 'rejected' && (r.reason as Err)?.status === 403) { setHidden(true); return; }
    setHidden(false);
    setItems(r.status === 'fulfilled' ? r.value : []);
    setRules(p.status === 'fulfilled' ? p.value.filter((x) => ['refund', 'deal_publish', 'purchase_order'].includes(x.kind)) : []);
    setError(r.status === 'rejected' ? ownerApprovalError(r.reason, 'Could not load approval requests.') : null);
  }).finally(() => setLoading(false)), []);
  useEffect(() => { load(); }, [load]);
  useOwnerStream((ev) => { if (ev === 'reconcile' || ev === 'approval_updated') load(); });

  // BUILD_PLAN Phase 13 (Constitution 6 §14–15, §19): one Idempotency-Key per decision. A tap again after a lost answer
  // (timeout, dropped network) reuses it, so the server answers with the first result; a definitive answer retires it.
  // A decision can execute a refund, so it is never queued offline — offline it is refused up front.
  const keys = useRef(new Map<string, string>());
  const decide = async (r: ApprovalRequestView, decision: 'approve' | 'reject', n: string | null) => {
    setBusy(r.id); setError(null); setNotice(null);
    if (!networkState.isOnline()) { setError('You’re offline. Approvals need a live connection — try again when you’re back online.'); setBusy(null); return; }
    const slot = `${r.id}:${r.version}:${decision}`;
    const key = keys.current.get(slot) ?? newIdempotencyKey();
    keys.current.set(slot, key);
    try {
      const out = await ownerApprovalRequestsApi.decide(r.id, { decision, note: n, expectedVersion: r.version }, { idempotencyKey: key });
      keys.current.delete(slot);
      setNotice(decidedText(r, decision, out));
      setRejecting(null); setNote('');
    } catch (e) {
      if (Number((e as Err)?.status) >= 100) keys.current.delete(slot);   // an ANSWER (not a lost one): the next tap is a new attempt
      setError(ownerApprovalError(e, 'That did not work.'));
    }
    finally { setBusy(null); await load(); }
  };

  if (hidden) return null;
  return (
    <section data-testid="owner-approval-requests" style={{ marginBottom: 18 }}>
      <div className="owner-sechead"><div className="h owner-serif">Requests</div><div className="d">{items.length ? `${items.length} waiting` : 'Nothing waiting'}</div></div>
      {notice ? <div role="status" className="owner-text-muted" style={{ fontSize: 12.5, marginBottom: 8 }} data-testid="owner-approval-notice">{notice}</div> : null}
      {error ? <div role="alert" className="owner-state" style={{ marginBottom: 8 }}>{error}</div> : null}
      {loading ? <div className="owner-state owner-text-muted">Loading…</div> : items.length === 0 ? (
        <div className="owner-state" data-testid="owner-approval-empty">No refunds, deals or orders waiting for approval.</div>
      ) : (
        <div className="owner-drill" aria-label="Requests waiting for approval">
          {items.map((r) => (
            <div className="owner-drillrow" key={r.id} data-testid="owner-approval-request" style={{ display: 'block' }}>
              <div className="nm">{r.title}</div>
              <div className="mt">{KIND[r.kind] ?? r.kind}{r.amountCents != null ? ` · ${money(r.amountCents)}` : ''} · asked by {r.requestedByName ?? 'a team member'}{r.branchName ? ` · ${r.branchName}` : ''}</div>
              <div style={{ fontSize: 13, margin: '6px 0' }}>{r.reason}</div>
              {r.kind === 'loyalty_bonus' ? <BonusFacts p={r.payload} /> : null}
              {r.canDecide ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button className="owner-btn" disabled={busy === r.id} aria-label={`Approve: ${r.title}`} onClick={() => decide(r, 'approve', null)}>Approve</button>
                  <button className="owner-btn" disabled={busy === r.id} aria-label={`Reject: ${r.title}`} onClick={() => { setRejecting(r.id); setNote(''); }}>Reject</button>
                </div>
              ) : <div className="mt" data-testid="owner-approval-why-not">{WHY[r.whyNot ?? ''] ?? 'You cannot decide this request.'}</div>}
              {rejecting === r.id ? (
                <div role="group" aria-label={`Reject ${r.title}`} style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>Why not? (the person who asked sees this)
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ fontFamily: 'inherit', fontSize: 13, padding: 8, borderRadius: 8, border: '1px solid var(--owner-border, #E7DCC8)' }} />
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="owner-btn" disabled={busy === r.id || note.trim().length < 3} onClick={() => decide(r, 'reject', note.trim())}>Reject</button>
                    <button className="owner-btn" onClick={() => setRejecting(null)}>Cancel</button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {rules.length ? (
        <div className="owner-text-muted" style={{ fontSize: 12, marginTop: 8 }} data-testid="owner-approval-rules">
          {rules.map((p) => <div key={p.kind}>{ruleLine(p)}</div>)}
          <div>Change these on the POS → Approvals → Rules.</div>
        </div>
      ) : null}
    </section>
  );
}

/** Customer Profile & Global Loyalty Protection (Nov 4 2026) §04: what the owner sees before approving bonus points —
 *  the customer's current points, the bonus, the balance after, and for a global bonus the token cost against the wallet.
 *  These are the server's figures at request time; approving recomputes them. */
export function BonusFacts({ p }: { p: Record<string, unknown> }) {
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  const cost = num(p.tokenCostCents); const wallet = num(p.walletAvailableCents);
  return (
    <div data-testid="owner-bonus-facts" className="owner-text-muted" style={{ fontSize: 12.5, display: 'grid', gap: 2, margin: '4px 0' }}>
      <div>{String(p.customerName ?? 'Customer')}: {num(p.currentPoints) ?? '—'} points now → <b>{num(p.pointsAfter) ?? '—'}</b> after +{num(p.points) ?? '—'}</div>
      {cost != null ? <div>Salon reward tokens: {(cost / 100).toFixed(2)} of {wallet == null ? '—' : (wallet / 100).toFixed(2)} available{wallet != null && wallet < cost ? ' — not enough; buy tokens first' : ''}</div>
        : <div>Added to this salon&apos;s own points program (no tokens).</div>}
    </div>
  );
}
