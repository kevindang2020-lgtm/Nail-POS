import { parseDollarsToCents } from '@aipowersalon/ui';
import { useEffect, useState, useCallback, useRef } from 'react';
import { createIntentKeys } from '@aipowersalon/api-client';
import { authApi } from '../api/authApi';
import { mobileCheckoutApi, type MobileTicketDetail, type TipPreset, type ProceedResult, type BalanceSummary, type TicketPayment } from '../api/mobileCheckoutApi';
import { formatCents, titleCase, computeTipCents } from '../util/format';
import { SESSION_ID, DEVICE_ID } from '../util/session';
import { usePayNav } from '../shell/nav';
import { useInlineAsk } from '@aipowersalon/ui';
import { useInlineConfirm } from '@aipowersalon/ui';
import { useT } from '@aipowersalon/mobile-sdk';
import { checkoutRealtime } from '../lib/useCheckoutStream';
import { rememberActiveAttempt } from '../util/activeAttempt';
import { useSessionPrincipal } from '../lib/principal';
import { useStepUp, isStepUpCancelled } from '../lib/stepUp';

type LockState = 'acquiring' | 'owned' | 'elsewhere' | 'error';
type TipChoice = 'none' | 'p15' | 'p20' | 'p25' | 'custom';

const TIP_CHIPS: { key: TipChoice; label: string }[] = [
  { key: 'none', label: 'No Tip' }, { key: 'p15', label: '15%' }, { key: 'p20', label: '20%' }, { key: 'p25', label: '25%' }, { key: 'custom', label: 'Custom' },
];

function initials(name?: string): string {
  if (!name) return '–';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '–';
}

// Map the UI tip choice + custom amount to the backend TipPreset, and to a client-side preview of the tip cents.
function tipToApi(choice: TipChoice, customCents: number): TipPreset {
  if (choice === 'custom') return { customCents };
  return choice;
}
function previewTipCents(choice: TipChoice, subtotalCents: number, customCents: number): number {
  if (choice === 'none') return 0;
  if (choice === 'custom') return Math.max(0, customCents);
  return computeTipCents(subtotalCents, choice === 'p15' ? 15 : choice === 'p20' ? 20 : 25);
}

export function TicketScreen({ ticketId }: { ticketId: string }) {
  const tr = useT();
  const principal = useSessionPrincipal();
  const intentKeys = useRef(createIntentKeys());   // Constitution 5 §61–66: one key per refund/void action
  const nav = usePayNav();
  const [detail, setDetail] = useState<MobileTicketDetail | null>(null);
  // mandate §55: the checkout VERSION the screen was loaded on; every money action sends it back and a change at the
  // front desk is surfaced before the card is ever presented (CHECKOUT_VERSION_CONFLICT → the ticket is refreshed)
  const [versionNotice, setVersionNotice] = useState<string | null>(null);
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [cashMsg, setCashMsg] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceSummary | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [lock, setLock] = useState<LockState>('acquiring');
  const [tip, setTip] = useState<TipChoice>('none');
  const [customTip, setCustomTip] = useState('');
  const [proceeding, setProceeding] = useState(false);
  // Ticket composition (TapPay prototype pass): retail add-on + discount, both via the canonical engines.
  const [retailOpen, setRetailOpen] = useState(false);
  const [retailList, setRetailList] = useState<{ productId: string; name: string; retailPriceCents: number }[] | null | undefined>(undefined);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [composeMsg, setComposeMsg] = useState<string | null>(null);
  const [proceed, setProceed] = useState<ProceedResult | null>(null);
  const [payments, setPayments] = useState<TicketPayment[]>([]);
  const [refundBusy, setRefundBusy] = useState<string | null>(null);
  const [refundMsg, setRefundMsg] = useState<string | null>(null);

  const reloadPayments = useCallback(() => { mobileCheckoutApi.ticketPayments?.(ticketId)?.then(setPayments).catch(() => {}); }, [ticketId]);
  // Refund is an INLINE PANEL (no native dialogs — platform invariant): reason + amount (defaults to full), and when
  // the amount is partial, a line picker naming which services this refund covers so technician commission on exactly
  // those lines reverses (the API shipped Jul 29). Void stays a simple reason ask.
  const { ask, askUi } = useInlineAsk();
  // Security Deep Scan C7: refund / void are step-up routes — STEP_UP_REQUIRED opens the password (+ code) prompt and the
  // SAME request (same idempotency key) is retried once; Cancel → nothing moved, no error shown.
  const stepUp = useStepUp();
  const { confirm, confirmUi } = useInlineConfirm();   // Jul 29: money-moving Submit Refund now confirms inline (this hook was mirrored in but never consumed)
  const [refundFor, setRefundFor] = useState<TicketPayment | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundLines, setRefundLines] = useState<Set<string>>(new Set());
  const [refundTip, setRefundTip] = useState(false);
  const openRefund = useCallback((p: TicketPayment) => {
    setRefundMsg(null); setRefundFor(p); setRefundReason('');
    setRefundAmount((p.amountCents / 100).toFixed(2)); setRefundLines(new Set()); setRefundTip(false);
  }, []);
  const submitRefund = useCallback(async () => {
    const p = refundFor; if (!p) return;
    if (!refundReason.trim()) { setRefundMsg('A reason is required for every refund.'); return; }
    const cents = parseDollarsToCents(refundAmount) ?? NaN;   // invalid input must BLOCK, never become $0.00
    if (!Number.isInteger(cents) || cents <= 0 || cents > p.amountCents) { setRefundMsg(`Enter a refund amount between $0.01 and ${formatCents(p.amountCents)}.`); return; }
    const partial = cents < p.amountCents;
    const lineIds = partial ? Array.from(refundLines) : [];
    setRefundBusy(p.paymentId); setRefundMsg(null);
    try {
      // Constitution 5 §61–66: a retry of THIS refund (same details) reuses its key — it can never refund twice.
      const body = { reason: refundReason.trim(), amountCents: cents, ...(partial && lineIds.length ? { serviceLineIds: lineIds, tipRefunded: refundTip } : {}) };
      await stepUp.run(() => mobileCheckoutApi.refundPayment(p.paymentId, body, intentKeys.current.keyFor(`refund:${p.paymentId}`, body)));
      intentKeys.current.done(`refund:${p.paymentId}`);
      setRefundMsg(`Refund submitted for ${formatCents(cents)}.${partial && !lineIds.length ? ' No services were selected, so technician commission was not adjusted.' : ''}`);
      setRefundFor(null); reloadPayments();
    } catch (e: any) { if (!isStepUpCancelled(e)) setRefundMsg(e?.message || 'Refund failed.'); }
    finally { setRefundBusy(null); }
  }, [refundFor, refundReason, refundAmount, refundLines, refundTip, reloadPayments, stepUp]);
  // Functional Decision 20: refund an AMOUNT from the ticket; the backend splits it across the original payments
  // proportionally and returns each part to its own method. Preview first, then confirm.
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitAmount, setSplitAmount] = useState('');
  const [splitReason, setSplitReason] = useState('');
  const [splitPreview, setSplitPreview] = useState<{ method: string; amountToRefundCents: number }[] | null>(null);
  const [splitBusy, setSplitBusy] = useState(false);
  const previewSplit = useCallback(async () => {
    const cents = parseDollarsToCents(splitAmount) ?? NaN;
    if (!Number.isInteger(cents) || cents <= 0) { setRefundMsg('Enter a refund amount.'); setSplitPreview(null); return; }
    setSplitBusy(true); setRefundMsg(null);
    try { const r = await mobileCheckoutApi.refundPreview(ticketId, cents); setSplitPreview(r.allocations); }
    catch (e: any) { setSplitPreview(null); setRefundMsg(e?.message || 'Could not calculate the refund split.'); }
    finally { setSplitBusy(false); }
  }, [splitAmount, ticketId]);
  const submitSplit = useCallback(async () => {
    const cents = parseDollarsToCents(splitAmount) ?? NaN;
    if (!splitReason.trim()) { setRefundMsg('A reason is required for every refund.'); return; }
    if (!Number.isInteger(cents) || cents <= 0) { setRefundMsg('Enter a refund amount.'); return; }
    setSplitBusy(true); setRefundMsg(null);
    try {
      const body = { reason: splitReason.trim(), amountCents: cents };
      const r = await stepUp.run(() => mobileCheckoutApi.refundTicket(ticketId, body, intentKeys.current.keyFor(`ticket-refund:${ticketId}`, body)));
      intentKeys.current.done(`ticket-refund:${ticketId}`);
      const parts = r.tenders.map((t) => `${titleCase(t.method)} ${formatCents(t.amountCents)} ${t.status === 'refunded' ? 'refunded' : `— ${t.error || t.status}`}`).join(' · ');
      setRefundMsg(r.complete ? `Refund of ${formatCents(r.refundedCents)} complete: ${parts}.` : `Refunded ${formatCents(r.refundedCents)} of ${formatCents(r.requestedCents)} — stopped: ${parts}.`);
      setSplitOpen(false); setSplitPreview(null); reloadPayments();
    } catch (e: any) { if (!isStepUpCancelled(e)) setRefundMsg(e?.message || 'Refund failed.'); }
    finally { setSplitBusy(false); }
  }, [splitAmount, splitReason, ticketId, reloadPayments, stepUp]);
  const voidPayment = useCallback((p: TicketPayment) => {
    ask(`Reason for voiding ${formatCents(p.amountCents)} (${titleCase(p.method)})?`, (reason) => { void (async () => {
      setRefundBusy(p.paymentId); setRefundMsg(null);
      try { const body = { reason: reason.trim() }; await stepUp.run(() => mobileCheckoutApi.voidPayment(p.paymentId, body, intentKeys.current.keyFor(`void:${p.paymentId}`, body))); intentKeys.current.done(`void:${p.paymentId}`); setRefundMsg(`Void submitted for ${formatCents(p.amountCents)}.`); reloadPayments(); }
      catch (e: any) { if (!isStepUpCancelled(e)) setRefundMsg(e?.message || 'Void failed.'); }
      finally { setRefundBusy(null); }
    })(); }, { minLength: 2 });
  }, [ask, reloadPayments, stepUp]);

  // Load the canonical ticket detail (read-only; shown even if the lock is held elsewhere). Reusable so
  // composition changes (retail line, discount) can re-pull the SAME canonical detail after a write.
  const trRef = useRef(tr); trRef.current = tr;   // the version notice's text, without making loadDetail (and its effect) re-run per render
  const loadDetail = useCallback(() => {
    mobileCheckoutApi.ticket(ticketId, SESSION_ID)
      .then((d) => { setDetail((prev) => { if (prev && prev.version !== d.version) setVersionNotice(trRef.current('pay.ticket.versionChanged')); return d; }); })
      .catch((e: any) => setDetailError(e?.message || 'Could not load the ticket.'));
    // Remaining-balance breakdown (confirmed / in-flight / remaining). Optional + defensive: a missing or failing
    // balance read never blocks the ticket. Surfaces a collected/remaining split once any partial has been captured.
    mobileCheckoutApi.ticketBalance?.(ticketId)?.then(setBalance).catch(() => {});
    mobileCheckoutApi.ticketPayments?.(ticketId)?.then(setPayments).catch(() => {});
  }, [ticketId]);
  useEffect(() => { setDetail(null); setDetailError(null); loadDetail(); }, [loadDetail]);
  // §39–§40: the POS changed THIS ticket (a line, a discount, a payment, a claim) → re-pull the canonical detail; the
  // version comparison above tells the manager what happened. The 15-second safety sync is the stream's fallback poller.
  useEffect(() => {
    const off = checkoutRealtime.onEvent((d: { event: string; payload?: any }) => {
      const tid = d.payload?.ticketId;
      if (tid && tid !== ticketId) return;
      if (['checkout_total_recalculated', 'ticket_total_recalculated', 'ticket_service_line_added', 'ticket_service_line_updated', 'ticket_service_line_removed', 'payment_approved', 'ticket_paid', 'checkout_payment_claimed', 'checkout_payment_claim_released', 'payment_recovered'].includes(d.event)) loadDetail();
    });
    return () => { off(); };
  }, [ticketId, loadDetail]);

  // Acquire the checkout lock on open; heartbeat while held; release on leave.
  useEffect(() => {
    let active = true;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    (async () => {
      try {
        await mobileCheckoutApi.acquireLock(ticketId, SESSION_ID, DEVICE_ID);
        if (!active) { mobileCheckoutApi.releaseLock(ticketId, SESSION_ID, 'unmounted').catch(() => {}); return; }
        setLock('owned');
        heartbeat = setInterval(() => { mobileCheckoutApi.refreshLock(ticketId, SESSION_ID).catch(() => {}); }, 30_000);
      } catch (e: any) {
        if (!active) return;
        setLock(e?.status === 409 ? 'elsewhere' : 'error');
      }
    })();
    return () => { active = false; if (heartbeat) clearInterval(heartbeat); mobileCheckoutApi.releaseLock(ticketId, SESSION_ID, 'left').catch(() => {}); };
  }, [ticketId]);

  const subtotal = detail?.totals.subtotalCents ?? 0;
  const tipCents = previewTipCents(tip, subtotal, (parseDollarsToCents(customTip) ?? 0));
  // §48/§85: the balance is what the canonical payments do not yet cover (server-derived), never the raw total
  const baseTotal = detail?.balanceDueCents ?? detail?.totals.totalDueCents ?? 0;
  const previewTotal = baseTotal + (tipCents - (detail?.totals.tipCents ?? 0)); // swap any existing tip for the chosen one
  const claim = detail?.claim ?? null;
  const canTakeOver = !!principal?.permissions?.includes('checkout.manage_overrides');

  // M6-6 (§31): re-open = re-claim at the version the screen now shows — after the phone's own edit, or a CHECKOUT_STALE
  const reclaim = useCallback(() => mobileCheckoutApi.acquireLock(ticketId, SESSION_ID, DEVICE_ID).then(() => undefined, () => undefined), [ticketId]);

  const onProceed = useCallback(async () => {
    setProceeding(true); setProceed(null); setVersionNotice(null);
    try {
      const res = await mobileCheckoutApi.proceed(ticketId, { sessionId: SESSION_ID, deviceId: DEVICE_ID, tip: tipToApi(tip, (parseDollarsToCents(customTip) ?? 0)), expectedVersion: detail?.version });
      if (res.canProceed && res.idempotencyKey) {
        rememberActiveAttempt({ ticketId, idempotencyKey: res.idempotencyKey, amountCents: res.balanceCents });
        nav.openTapToPay(ticketId, res.idempotencyKey, res.balanceCents);
      } else if (res.reason === 'CHECKOUT_VERSION_CONFLICT' || res.reason === 'CHECKOUT_STALE') {
        // §155 / §31: refresh, never charge the stale amount — a stale CLAIM is re-made at the current version first
        setVersionNotice(tr('pay.ticket.versionChanged'));
        if (res.reason === 'CHECKOUT_STALE') await reclaim();
        loadDetail();
      } else {
        setProceed(res); // blocked — show the honest reason inline (step-up, not ready, lock…)
      }
    } catch (e: any) {
      setProceed({ canProceed: false, reason: 'error', message: e?.message || 'Could not start payment.', balanceCents: baseTotal });
    } finally {
      setProceeding(false);
    }
  }, [ticketId, tip, customTip, baseTotal, nav, detail?.version, loadDetail, tr, reclaim]);

  // §17 / §184: step-up for a high-value charge — confirm the password, then proceed again (the server re-checks freshness)
  const [stepUpPw, setStepUpPw] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [stepUpErr, setStepUpErr] = useState<string | null>(null);
  const onStepUp = useCallback(async () => {
    setStepUpBusy(true); setStepUpErr(null);
    try { await (stepUpCode ? authApi.stepUp(stepUpPw, stepUpCode) : authApi.stepUp(stepUpPw)); setStepUpPw(''); setStepUpCode(''); await onProceed(); }
    catch (e: any) { setStepUpErr(e?.message || tr('pay.ticket.stepUpFailed')); }
    finally { setStepUpBusy(false); }
  }, [stepUpPw, stepUpCode, onProceed, tr]);

  // §57: hand the phone to the customer — tip + Tap to Pay on the locked customer screen
  const onHandoff = useCallback(() => {
    if (!detail) return;
    nav.openHandoff({ ticketId, version: detail.version, subtotalCents: detail.totals.subtotalCents, balanceCents: detail.balanceDueCents, tipCents: detail.totals.tipCents });
  }, [detail, nav, ticketId]);

  // §46: authorized takeover of a claim held at the POS / another phone
  const onTakeover = useCallback(() => {
    ask(tr('pay.ticket.takeoverReason'), (reason) => { void (async () => {
      setTakeoverBusy(true);
      try { await mobileCheckoutApi.takeoverLock(ticketId, SESSION_ID, DEVICE_ID, reason.trim()); setLock('owned'); loadDetail(); }
      catch (e: any) { setComposeMsg(e?.message || 'Could not take over this checkout.'); }
      finally { setTakeoverBusy(false); }
    })(); }, { minLength: 3 });
  }, [ask, ticketId, loadDetail, tr]);

  // §83–§84: the cash part of a split — recorded on the canonical checkout; the card part is its own intent
  const onCashTender = useCallback(async () => {
    const cents = parseDollarsToCents(cashAmount) ?? NaN;
    if (!Number.isInteger(cents) || cents <= 0) { setCashMsg('Enter a cash amount greater than zero.'); return; }
    const body = { sessionId: SESSION_ID, idempotencyKey: intentKeys.current.keyFor(`cash:${ticketId}`, { cents }), amountCents: cents, deviceId: DEVICE_ID };
    try {
      const r = await mobileCheckoutApi.cashTender(ticketId, body);
      intentKeys.current.done(`cash:${ticketId}`);
      setCashMsg(tr('pay.ticket.cashRecorded', { amount: formatCents(cents), remaining: formatCents(r.remainingCents) }));
      setCashOpen(false); setCashAmount(''); loadDetail();
    } catch (e: any) { setCashMsg(e?.message || 'Could not record the cash tender.'); }
  }, [cashAmount, ticketId, loadDetail, tr]);

  return (
    <>
      <div className="pay-sechead">
        <button className="pay-back" onClick={nav.back} aria-label="Back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg></button>
        <div className="t pay-serif">Ticket{detail?.ticketNumber ? ` #${detail.ticketNumber}` : ''}</div>
      </div>

      {lock === 'acquiring' && <div className="pay-lockbar acquiring">{tr('pay.ticket.opening')}</div>}
      {lock === 'owned' && <div className="pay-lockbar owned">{tr('pay.ticket.open')}</div>}
      {lock === 'elsewhere' && (
        <div className="pay-lockbar elsewhere" role="status">
          {tr('pay.ticket.elsewhere', { where: claim?.source === 'pos' ? 'the front desk POS' : claim?.source === 'display' ? 'the customer display' : claim?.deviceLabel || claim?.userName || 'another payment device' })}
          {claim?.userName && claim.source === 'mobile' ? ` (${claim.userName})` : ''}
          {canTakeOver && <button className="pay-chip" style={{ marginLeft: 8 }} disabled={takeoverBusy} onClick={onTakeover}>{tr('pay.ticket.takeover')}</button>}
        </div>
      )}
      {lock === 'error' && <div className="pay-lockbar elsewhere">Couldn’t lock this ticket. Try going back and reopening.</div>}
      {versionNotice && <div className="pay-proceedresult block" role="alert">{versionNotice}</div>}

      {detail === null && !detailError && <div className="pay-skel" style={{ height: 220 }} />}
      {detailError && <div className="pay-state"><div className="big">Couldn’t load the ticket</div><div className="muted">{detailError}</div></div>}

      {detail && (
        <>
          <div className="pay-card">
            <div className="pay-custrow">
              <span className="av">{detail.customer?.initials || initials(detail.customer?.fullName)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nm">{detail.customer?.fullName || 'Walk-in'}{detail.customer?.isVip && <span className="pay-vip">VIP</span>}</div>
                <div className="sub">
                  {detail.customer?.phoneMasked || '—'}
                  {typeof detail.customer?.loyaltyPoints === 'number' ? ` · ${detail.customer.loyaltyPoints} pts` : ''}
                </div>
              </div>
              {/* The wire has no status: a ticket here is either still owing or fully paid. */}
              <span className={`pay-badge ${(detail.balanceDueCents ?? detail.totals.totalDueCents) > 0 ? 'ready' : 'neutral'}`}>{(detail.balanceDueCents ?? detail.totals.totalDueCents) > 0 ? 'Ready' : 'Paid'}</span>
            </div>
          </div>

          <div className="pay-card">
            <div className="pay-cardtitle">Services</div>
            {detail.services.length === 0 && <div className="sub" style={{ color: 'var(--pay-text-muted)' }}>—</div>}
            {detail.services.map((s, i) => (
              <div className="pay-svcrow" key={i}>
                <span className="sn">{s.serviceName}</span>
                <span className="sp">{formatCents(s.priceCents)}</span>
                {s.technicianName && <span className="st">{s.technicianName}</span>}
              </div>
            ))}
            <button className="pay-ghostbtn" onClick={() => {
              setComposeMsg(null);
              setRetailOpen((v) => !v);
              if (retailList === undefined) mobileCheckoutApi.retailCatalog?.()?.then((r) => setRetailList(r.products || [])).catch(() => setRetailList(null));
            }}>+ Add Retail Product</button>
            {retailOpen && (
              <div className="pay-composepanel">
                {retailList === undefined && <div className="pay-note">Loading products…</div>}
                {retailList === null && <div className="pay-note">The retail catalog could not be loaded.</div>}
                {retailList && retailList.length === 0 && <div className="pay-note">No retail products are available for sale.</div>}
                {retailList && retailList.slice(0, 8).map((pr) => (
                  <button key={pr.productId} className="pay-composerow" onClick={async () => {
                    try {
                      await mobileCheckoutApi.addRetail(ticketId, { productId: pr.productId, quantity: 1 });
                      setComposeMsg(`Added ${pr.name}.`);
                      setRetailOpen(false);
                      await reclaim();   // M6-6: this phone changed the ticket — its claim moves to the new version
                      loadDetail();
                    } catch (e: any) { setComposeMsg(e?.message || 'Could not add that product.'); }
                  }}>
                    <span>{pr.name}</span><span>{formatCents(pr.retailPriceCents)}</span>
                  </button>
                ))}
              </div>
            )}
            <button className="pay-ghostbtn" onClick={() => { setComposeMsg(null); setDiscountOpen((v) => !v); }}>+ Add Discount</button>
            {discountOpen && (
              <div className="pay-composepanel">
                <div className="pay-customtip"><span style={{ fontWeight: 800 }}>$</span>
                  <input inputMode="decimal" placeholder="0.00" aria-label="Discount amount" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
                <input className="pay-reasoninput" placeholder="Reason (optional)" aria-label="Discount reason" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
                <button className="pay-ghostbtn" onClick={async () => {
                  const cents = parseDollarsToCents(discountAmount) ?? NaN;   // invalid input must BLOCK, never become $0.00
                  if (!Number.isInteger(cents) || cents <= 0) { setComposeMsg('Enter a discount amount greater than zero.'); return; }
                  try {
                    await mobileCheckoutApi.applyDiscount(ticketId, { discountCents: cents, reason: discountReason.trim() || undefined });
                    setComposeMsg('Discount applied.');
                    setDiscountOpen(false); setDiscountAmount(''); setDiscountReason('');
                    await reclaim();   // M6-6: this phone changed the ticket — its claim moves to the new version
                    loadDetail();
                  } catch (e: any) { setComposeMsg(e?.message || 'Could not apply that discount.'); }
                }}>Apply Discount</button>
              </div>
            )}
            {composeMsg && <div className="pay-note" role="status">{composeMsg}</div>}
          </div>

          <div className="pay-card">
            <div className="pay-cardtitle">Add a Tip</div>
            <div className="pay-tipchips">
              {TIP_CHIPS.map((c) => (
                <button key={c.key} className={`pay-tipchip ${tip === c.key ? 'active' : ''}`} onClick={() => setTip(c.key)}>{c.label}</button>
              ))}
            </div>
            {tip === 'custom' && (
              <div className="pay-customtip">
                <span style={{ fontWeight: 800 }}>$</span>
                <input inputMode="decimal" placeholder="0.00" value={customTip} onChange={(e) => setCustomTip(e.target.value.replace(/[^0-9.]/g, ''))} />
              </div>
            )}
          </div>

          <div className="pay-card">
            <div className="pay-totrow"><span className="l">Subtotal</span><span className="v">{formatCents(detail.totals.subtotalCents)}</span></div>
            {detail.totals.discountCents > 0 && <div className="pay-totrow"><span className="l">Discount</span><span className="v">−{formatCents(detail.totals.discountCents)}</span></div>}
            <div className="pay-totrow"><span className="l">Tax</span><span className="v">{formatCents(detail.totals.taxCents)}</span></div>
            {detail.totals.surchargeCents > 0 && <div className="pay-totrow"><span className="l">Card surcharge</span><span className="v">{formatCents(detail.totals.surchargeCents)}</span></div>}
            <div className="pay-totrow"><span className="l">Tip</span><span className="v">{formatCents(tipCents)}</span></div>
            {(detail.paidCents > 0 || (balance && balance.confirmedCents > 0)) && (
              <>
                <div className="pay-totrow"><span className="l">{tr('pay.ticket.paid')}</span><span className="v">−{formatCents(detail.paidCents || balance?.confirmedCents || 0)}</span></div>
                <div className="pay-totrow"><span className="l">{tr('pay.ticket.balance')}</span><span className="v">{formatCents(detail.balanceDueCents)}</span></div>
              </>
            )}
            <div className="pay-totrow grand"><span className="l">{tr('pay.ticket.total')}</span><span className="v">{formatCents(previewTotal)}</span></div>
            {lock === 'owned' && baseTotal > 0 && (principal?.permissions?.includes('mobile_checkout.split_payment') ?? true) && (
              <>
                <button className="pay-linkbtn" style={{ marginTop: 6 }} onClick={() => { setCashMsg(null); setCashOpen((v) => !v); }}>{tr('pay.ticket.splitCash')}</button>
                {cashOpen && (
                  <div className="pay-composepanel">
                    <div className="pay-customtip"><span style={{ fontWeight: 800 }}>$</span>
                      <input inputMode="decimal" placeholder="0.00" aria-label={tr('pay.ticket.splitCash')} value={cashAmount} onChange={(e) => setCashAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                    </div>
                    <button className="pay-ghostbtn" onClick={() => confirm('Record this cash tender? The remaining balance stays due on the card.', () => void onCashTender())}>{tr('pay.ticket.recordCash')}</button>
                  </div>
                )}
                {cashMsg && <div className="pay-note" role="status">{cashMsg}</div>}
              </>
            )}
          </div>

          {payments.length > 0 && (
            <div className="pay-card">
              <div className="pay-cardtitle">Payments</div>
              {payments.map((p) => (
                <div key={p.paymentId} className="pay-totrow" style={{ alignItems: 'center' }}>
                  <span className="l">{titleCase(p.method)} · {formatCents(p.amountCents)}</span>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button className="pay-linkbtn" disabled={refundBusy === p.paymentId} onClick={() => openRefund(p)}>Refund</button>
                    <button className="pay-linkbtn" disabled={refundBusy === p.paymentId} onClick={() => voidPayment(p)}>Void</button>
                  </span>
                </div>
              ))}
              {payments.length > 1 && !splitOpen && (
                <button className="pay-linkbtn" style={{ marginTop: 6 }} onClick={() => { setSplitOpen(true); setRefundFor(null); setSplitPreview(null); setSplitAmount(''); setSplitReason(''); setRefundMsg(null); }}>Refund across payments</button>
              )}
              {splitOpen && (
                <div className="pay-composepanel" style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Refund across payments</div>
                  <input className="pay-reasoninput" placeholder="Reason (required)" aria-label="Split refund reason" value={splitReason} onChange={(e) => setSplitReason(e.target.value)} />
                  <div className="pay-customtip" style={{ marginTop: 6 }}><span style={{ fontWeight: 800 }}>$</span>
                    <input inputMode="decimal" aria-label="Split refund amount" value={splitAmount} onChange={(e) => { setSplitAmount(e.target.value.replace(/[^0-9.]/g, '')); setSplitPreview(null); }} />
                  </div>
                  {splitPreview && (
                    <div style={{ marginTop: 8 }} aria-label="Refund split">
                      <div className="muted" style={{ marginBottom: 4 }}>Goes back to each original payment:</div>
                      {splitPreview.map((a, i) => <div key={i} className="pay-totrow"><span className="l">{titleCase(a.method)}</span><span className="v">{formatCents(a.amountToRefundCents)}</span></div>)}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {!splitPreview
                      ? <button className="pay-ghostbtn" disabled={splitBusy} onClick={() => void previewSplit()}>Preview split</button>
                      : <button className="pay-ghostbtn" disabled={splitBusy} onClick={() => confirm('Submit this refund? Money moves back to the customer on each original payment.', () => void submitSplit())}>Submit refund</button>}
                    <button className="pay-ghostbtn" onClick={() => { setSplitOpen(false); setSplitPreview(null); }}>Cancel</button>
                  </div>
                </div>
              )}
              {refundFor && (
                <div className="pay-composepanel" style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Refund {titleCase(refundFor.method)} · {formatCents(refundFor.amountCents)}</div>
                  <input className="pay-reasoninput" placeholder="Reason (required)" aria-label="Refund reason" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
                  <div className="pay-customtip" style={{ marginTop: 6 }}><span style={{ fontWeight: 800 }}>$</span>
                    <input inputMode="decimal" aria-label="Refund amount" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                  </div>
                  {(() => { const c = parseDollarsToCents(refundAmount); const partial = Number.isInteger(c) && (c as number) > 0 && (c as number) < refundFor.amountCents; return partial ? (
                    <div style={{ marginTop: 8 }}>
                      <div className="muted" style={{ marginBottom: 4 }}>Partial refund — which services does it cover? Technician commission on the selected services will be reversed for review.</div>
                      {(detail?.services ?? []).map((sv) => (
                        <label key={sv.serviceLineId} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                          <input type="checkbox" checked={refundLines.has(sv.serviceLineId)} onChange={(e) => setRefundLines((prev) => { const n = new Set(prev); if (e.target.checked) n.add(sv.serviceLineId); else n.delete(sv.serviceLineId); return n; })} />
                          <span>{sv.serviceName} · {formatCents(sv.priceCents)}</span>
                        </label>
                      ))}
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                        <input type="checkbox" checked={refundTip} onChange={(e) => setRefundTip(e.target.checked)} />
                        <span>The tip on these services was also refunded</span>
                      </label>
                    </div>
                  ) : null; })()}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="pay-ghostbtn" disabled={refundBusy === refundFor.paymentId} onClick={() => confirm('Submit this refund? Money moves back to the customer.', () => void submitRefund())}>Submit Refund</button>
                    <button className="pay-ghostbtn" onClick={() => setRefundFor(null)}>Cancel</button>
                  </div>
                </div>
              )}
              {refundMsg && <div className="muted" style={{ marginTop: 6 }} role="status">{refundMsg}</div>}
            </div>
          )}
          {/* the inline ask/confirm render once, outside any conditional card — the cash-tender confirm needs it with no payments yet */}
          {askUi}{confirmUi}{stepUp.prompt}

          {proceed && !proceed.canProceed && (
            <div className="pay-proceedresult block">{proceed.message || 'Payment can’t start yet.'}</div>
          )}
          {/* §17 / §184: a high-value charge needs a fresh password confirmation on THIS session, then the same proceed again */}
          {proceed && !proceed.canProceed && proceed.reason === 'STEP_UP_REQUIRED' && (
            <div className="pay-composepanel" aria-label={tr('pay.ticket.stepUpTitle')}>
              <input className="pay-reasoninput" type="password" autoComplete="current-password" aria-label={tr('pay.ticket.stepUpPassword')} placeholder={tr('pay.ticket.stepUpPassword')} value={stepUpPw} onChange={(e) => setStepUpPw(e.target.value)} />
              <input className="pay-reasoninput" inputMode="numeric" autoComplete="one-time-code" aria-label={tr('pay.stepUp.code')} placeholder={tr('pay.stepUp.code')} value={stepUpCode} onChange={(e) => setStepUpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              {stepUpErr && <div className="pay-note" role="alert">{stepUpErr}</div>}
              <button className="pay-ghostbtn" disabled={stepUpBusy || !stepUpPw} onClick={() => void onStepUp()}>{stepUpBusy ? tr('pay.ticket.checking') : tr('pay.ticket.stepUpConfirm')}</button>
            </div>
          )}

          <div className="pay-stickyfoot">
            <button className="pay-btn" disabled={lock !== 'owned' || proceeding || baseTotal <= 0} onClick={onProceed}>
              {proceeding ? tr('pay.ticket.checking') : `${tr('pay.ticket.proceed')} · ${formatCents(previewTotal)}`}
            </button>
            <button className="pay-btn ghost" style={{ marginTop: 8 }} disabled={lock !== 'owned' || proceeding || baseTotal <= 0} onClick={onHandoff}>{tr('pay.ticket.handToCustomer')}</button>
          </div>
        </>
      )}
    </>
  );
}
