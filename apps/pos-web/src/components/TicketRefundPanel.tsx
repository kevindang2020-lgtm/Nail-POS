// TicketRefundPanel.tsx — Functional Decision 20 on the POS. Until Oct 2 2026 the POS had no refund screen at all; a
// split refund could only be done from Manager Pay. Opened from Payments → Transactions.
//
// Flow: the server says what the ticket can still return → staff enter an amount (default: all of it) and a reason →
// "Preview split" shows how the server will divide it across the original payments (proportional; never more than a
// payment took) → "Refund" sends it. The server refunds cards first and stops at the first payment that does not
// complete, so the result is shown per payment, and a partial outcome is said plainly. Nothing is computed here.
import { useEffect, useRef, useState } from 'react';
import { createIntentKeys } from '@aipowersalon/api-client';
import { parseDollarsToCents } from '@aipowersalon/money';
import { posCheckoutApi, type TicketRefundPreview, type TicketRefundResult, type UnsettledRefunds } from '../api/posCheckoutApi';
import { useStepUp, isStepUpCancelled } from '../screens/access/accessUi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from './codeLabel';
import { statusLabel } from '../i18n/status-label';
import { fmtMoney } from '../i18n/format';
import { errorTextOf } from '../i18n/error-text';

const money = (c: number) => fmtMoney(c || 0);
// a gift card says which card it goes back to (Oct 6 2026) — four characters, from the server
const method = (m: string, giftCardLast4?: string) => (m === 'gift_card' && giftCardLast4 ? tx('pos.gift_card_ending_giftcardlast4', { giftCardLast4: String(giftCardLast4) }) : statusLabel('paymentMethod', m));
const errText = (e: any) => errorTextOf(e, tx('pos.something_went_wrong'));   // §22: never the server's English on a Vietnamese screen
// a tender's refund outcome → its (lower-case, mid-sentence) text, read at render. mandate P0 §228: 'verifying' = the processor's
// answer was lost — the amount is held, nothing is sent again, it settles from the processor's record
const refundOutcome = (s: string) => codeLabel('admin.refund.outcome', s, 'refund');
const since = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)); return m < 60 ? tx('pos.m_min_ago', { m: String(m) }) : tx('pos.v0_h_v1_min_ago', { v0: String(Math.floor(m / 60)), v1: String(m % 60) }); };

export function TicketRefundPanel({ ticketId, label, onClose, onDone }: { ticketId: string; label?: string; onClose: () => void; onDone?: (r: TicketRefundResult) => void }) {
  const [refundable, setRefundable] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<TicketRefundPreview | null>(null);
  const intentKeys = useRef(createIntentKeys());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TicketRefundResult | null>(null);
  // BUILD_PLAN Phase 5: refund SERVICES — each at what it was actually paid after its discounts (deal-aware), and the
  // deals on those services are given back by the server
  const [lines, setLines] = useState<NonNullable<TicketRefundPreview['lines']>>([]);
  const [picked, setPicked] = useState<string[]>([]);
  // mandate P0 §228: refunds on this ticket still waiting for the processor's answer (server-held; settled by the sweep or here)
  const [unsettled, setUnsettled] = useState<UnsettledRefunds['refunds']>([]);
  const [settleNote, setSettleNote] = useState<Record<string, string>>({});
  const [settleRef, setSettleRef] = useState<Record<string, string>>({});
  const [settleErr, setSettleErr] = useState<Record<string, string>>({});
  const [settleBusy, setSettleBusy] = useState<string | null>(null);
  const stepUp = useStepUp(tx('pos.stepup_settle_refund_needs_password'));
  const loadUnsettled = () => posCheckoutApi.unsettledRefunds(ticketId).then((u) => setUnsettled(u.refunds)).catch(() => undefined);   // read-only; a failure leaves the section empty
  useEffect(() => { void loadUnsettled(); }, [ticketId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const doSettle = async (refundId: string, outcome: 'refunded' | 'not_refunded') => {
    const note = (settleNote[refundId] ?? '').trim();
    if (!note) { setSettleErr((m) => ({ ...m, [refundId]: tx('admin.refund.settleNoteRequired') })); return; }
    setSettleBusy(refundId); setSettleErr((m) => ({ ...m, [refundId]: '' }));
    const body = { outcome, note, ...(outcome === 'refunded' && settleRef[refundId]?.trim() ? { processorRefundId: settleRef[refundId].trim() } : {}) };
    const intent = `refund-settle:${refundId}:${outcome}`;
    try { await stepUp.run(() => posCheckoutApi.settleRefund(ticketId, refundId, body, intentKeys.current.keyFor(intent, body))); intentKeys.current.done(intent); await loadUnsettled(); const p = await posCheckoutApi.refundPreview(ticketId, 1).catch(() => null); if (p) setRefundable(p.refundableCents); }
    catch (e: any) { if (!isStepUpCancelled(e)) setSettleErr((m) => ({ ...m, [refundId]: errText(e) })); }
    finally { setSettleBusy(null); }
  };

  // What can this ticket still return? Ask the server with the smallest amount; a fully refunded ticket says so.
  useEffect(() => {
    let alive = true;
    posCheckoutApi.refundPreview(ticketId, 1)
      .then((p) => { if (!alive) return; setRefundable(p.refundableCents); setAmount((p.refundableCents / 100).toFixed(2)); setLines(p.lines ?? []); })
      .catch((e) => { if (!alive) return; const m = errText(e); setLoadError(/0 cents remain/.test(m) ? tx('pos.this_ticket_has_already_been_fully_3b9c') : m); });
    return () => { alive = false; };
  }, [ticketId]);

  const cents = parseDollarsToCents(amount);
  const amountOk = cents !== null && cents > 0 && refundable !== null && cents <= refundable;
  const reasonOk = reason.trim().length > 0;

  const doPreview = async () => {
    setError(null); setPreview(null);
    if (!amountOk) { setError(refundable !== null ? tx('pos.enter_an_amount_up_to_refundable', { refundable: String(money(refundable)) }) : tx('pos.enter_an_amount')); return; }
    try { setPreview(await posCheckoutApi.refundPreview(ticketId, cents!)); } catch (e) { setError(errText(e)); }
  };
  const doRefund = async () => {
    if (!preview || !reasonOk) return;
    setBusy(true); setError(null);
    // Constitution 5 §61–66: a retry of THIS refund (same amount and reason) reuses its key, so it can never refund twice.
    const body = { reason: reason.trim(), amountCents: preview.amountCents, ...(picked.length ? { serviceLineIds: picked } : {}) }; const intent = `ticket-refund:${ticketId}`;
    // Security Deep Scan C7: a refund is a step-up route — 403 STEP_UP_REQUIRED opens the password prompt and the refund is
    // retried ONCE with the same idempotency key (the guard refused it before anything ran). Cancel: nothing refunded, no error.
    try { const r = await stepUp.run(() => posCheckoutApi.refundTicket(ticketId, body, intentKeys.current.keyFor(intent, body)), tx('pos.stepup_refund_needs_password')); intentKeys.current.done(intent); setResult(r); onDone?.(r); if (r.tenders.some((t) => t.status === 'verifying')) void loadUnsettled(); }
    catch (e) { if (!isStepUpCancelled(e)) setError(errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <div role="dialog" aria-label={tx('pos.refund_ticket')} className="panel" style={{ padding: 16, maxWidth: 520 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{tx('pos.refund')}{label ? ` — ${label}` : ''}</h3>
        <button className="btn ghost" onClick={onClose}>{tx('pos.close')}</button>
      </div>

      {loadError ? <div className="err" style={{ marginTop: 10 }}>{loadError}</div> : refundable === null ? <div className="state" style={{ marginTop: 10 }}>{tx('pos.checking_what_this_ticket_can_return')}</div> : result ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700 }}>{result.complete ? tx('pos.refunded_refundedcents', { refundedCents: String(money(result.refundedCents)) }) : tx('pos.refunded_refundedcents_of_requestedcents', { refundedCents: String(money(result.refundedCents)), requestedCents: String(money(result.requestedCents)) })}</div>
          {!result.complete && result.tenders.some((t) => t.status === 'verifying') && (
            <div className="s" style={{ marginTop: 6 }} data-testid="refund-verifying">{tx('pos.the_card_processor_did_not_answer')}{' '}<strong>{tx('pos.nothing_was_refunded_twice_and_nothing_16yk')}</strong>{tx('pos.the_amount_is_held_while_the_s402')}</div>)}
          {!result.complete && !result.tenders.some((t) => t.status === 'verifying') && (result.tenders.some((t) => t.status === 'approval_pending')
            // BUILD_PLAN Phase 9: past the salon's limit the refund is SENT FOR APPROVAL (not refused) — a manager or the owner approves it on Approvals
            ? <div className="s" style={{ marginTop: 6 }} data-testid="refund-sent-for-approval">{tx('pos.the_rest_is_over_your_refund_vt45')}{' '}<strong>{tx('pos.sent_for_approval')}</strong> {tx('pos.a_manager_or_the_owner_approves_1l4v')}{' '}<a href="/approvals">{tx('pos.approvals')}</a>{tx('pos.and_it_is_refunded_then_nothing_8p0u')}</div>
            : <div className="err" style={{ marginTop: 6 }}>{tx('pos.the_rest_was_not_refunded_it_m5xy')}</div>)}
          <ul style={{ margin: '8px 0 0 18px' }}>
            {result.tenders.map((t) => <li key={t.paymentId}>{method(t.method, t.giftCardLast4)} {money(t.amountCents)} — {refundOutcome(t.status)}{t.error ? ` (${t.error})` : ''}</li>)}
          </ul>
        </div>
      ) : (
        <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
          <div className="s muted">{tx('pos.this_ticket_can_still_return')}{' '}{money(refundable)}.</div>
          {lines.length > 0 && (
            <fieldset data-testid="refund-services" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>
              <legend className="s">{tx('pos.refund_services_optional')}</legend>
              {lines.map((l) => (
                <label key={l.serviceLineId} className="s" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" aria-label={tx('pos.refund_servicename', { serviceName: String(l.serviceName) })} checked={picked.includes(l.serviceLineId)} onChange={(e) => {
                    const next = e.target.checked ? [...picked, l.serviceLineId] : picked.filter((x) => x !== l.serviceLineId);
                    setPicked(next); setPreview(null);
                    if (next.length) setAmount((Math.min(refundable ?? 0, lines.filter((x) => next.includes(x.serviceLineId)).reduce((n, x) => n + (x.paidCents ?? x.netCents), 0)) / 100).toFixed(2));
                  }} />
                  {l.serviceName} {tx('pos.paid')}{' '}{money(l.paidCents ?? l.netCents)}{l.taxCents ? <span className="muted"> {tx('pos.incl')}{' '}{money(l.taxCents)} {tx('pos.tax')}</span> : null}{l.netCents !== l.priceCents ? <span className="muted"> {tx('pos.menu')}{' '}{money(l.priceCents)}{tx('pos.after_discounts')}</span> : null}
                </label>
              ))}
            </fieldset>
          )}
          <label className="s">{tx('pos.amount_to_refund')}
            <input aria-label={tx('pos.refund_amount')} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setPreview(null); }} style={{ display: 'block', width: '100%' }} />
          </label>
          <label className="s">{tx('pos.reason_required')}
            <input aria-label={tx('pos.refund_reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('pos.e_g_customer_unhappy_with_service')} style={{ display: 'block', width: '100%' }} />
          </label>
          <button className="btn" onClick={doPreview} disabled={!amountOk}>{tx('pos.preview_split')}</button>
          {preview && (
            <div>
              <div className="s" style={{ fontWeight: 700 }}>{tx('pos.how')}{' '}{money(preview.amountCents)} {tx('pos.goes_back')}</div>
              <ul style={{ margin: '4px 0 0 18px' }}>{preview.allocations.filter((a) => a.amountToRefundCents > 0).map((a) => <li key={a.paymentId}>{method(a.method, a.giftCardLast4)}: {money(a.amountToRefundCents)}</li>)}</ul>
              <div className="s muted" style={{ marginTop: 4 }}>{tx('pos.each_part_goes_back_to_the_sb2h')}</div>
              <button className="btn" style={{ marginTop: 8 }} onClick={doRefund} disabled={busy || !reasonOk} title={reasonOk ? undefined : tx('pos.enter_a_reason_first')}>{busy ? tx('pos.refunding') : tx('pos.refund_amountcents', { amountCents: String(money(preview.amountCents)) })}</button>
            </div>
          )}
          {error && <div className="err">{error}</div>}
        </div>
      )}
      {unsettled.length > 0 && (
        <section data-testid="refunds-unsettled" style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <div style={{ fontWeight: 700 }}>{tx('pos.refunds_being_verified_with_the_card_1p4k')}</div>
          <div className="s muted" style={{ marginTop: 2 }}>{tx('pos.the_processor_s_answer_was_lost_5fil')}</div>
          <ul style={{ margin: '8px 0 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
            {unsettled.map((u) => (
              <li key={u.refundId} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}>
                <div className="s"><strong>{money(u.amountCents)}</strong> {method(u.method)} {tx('pos.started')}{' '}{since(u.createdAt)}{u.reason ? ` · ${u.reason}` : ''}</div>
                <div className="s muted" style={{ marginTop: 2 }}>{u.reviewReason ? <>{tx('pos.needs_a_person')}{' '}{u.reviewReason}</> : tx('pos.still_being_checked_automatically')}</div>
                {u.canSettle && (
                  <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
                    <input aria-label={tx('pos.processor_record_note')} placeholder={tx('pos.what_the_processor_portal_shows_required')} value={settleNote[u.refundId] ?? ''} onChange={(e) => setSettleNote((m) => ({ ...m, [u.refundId]: e.target.value }))} />
                    <input aria-label={tx('pos.processor_refund_reference')} placeholder={tx('pos.processor_refund_reference_if_it_was_1luw')} value={settleRef[u.refundId] ?? ''} onChange={(e) => setSettleRef((m) => ({ ...m, [u.refundId]: e.target.value }))} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" disabled={settleBusy === u.refundId} onClick={() => doSettle(u.refundId, 'refunded')}>{tx('pos.processor_shows_it_refunded')}</button>
                      <button className="btn ghost" disabled={settleBusy === u.refundId} onClick={() => doSettle(u.refundId, 'not_refunded')}>{tx('pos.processor_shows_no_refund')}</button>
                    </div>
                    {settleErr[u.refundId] ? <div className="err">{settleErr[u.refundId]}</div> : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {stepUp.prompt}
    </div>
  );
}
