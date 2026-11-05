import { parseDollarsToCents } from '@aipowersalon/ui';
import { useEffect, useState, useCallback, useRef } from 'react';
import { mobileCheckoutApi, type MobileTicketDetail, type TipPreset, type ProceedResult, type BalanceSummary, type TicketPayment } from '../api/mobileCheckoutApi';
import { formatCents, titleCase, computeTipCents } from '../util/format';
import { SESSION_ID, DEVICE_ID } from '../util/session';
import { usePayNav } from '../shell/nav';
import { useInlineAsk } from '../components/InlineAsk';
import { useInlineConfirm } from '../components/InlineConfirm';

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
  const nav = usePayNav();
  const [detail, setDetail] = useState<MobileTicketDetail | null>(null);
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
      await mobileCheckoutApi.refundPayment(p.paymentId, {
        reason: refundReason.trim(), amountCents: cents,
        ...(partial && lineIds.length ? { serviceLineIds: lineIds, tipRefunded: refundTip } : {}),
      });
      setRefundMsg(`Refund submitted for ${formatCents(cents)}.${partial && !lineIds.length ? ' No services were selected, so technician commission was not adjusted.' : ''}`);
      setRefundFor(null); reloadPayments();
    } catch (e: any) { setRefundMsg(e?.message || 'Refund failed.'); }
    finally { setRefundBusy(null); }
  }, [refundFor, refundReason, refundAmount, refundLines, refundTip, reloadPayments]);
  const voidPayment = useCallback((p: TicketPayment) => {
    ask(`Reason for voiding ${formatCents(p.amountCents)} (${titleCase(p.method)})?`, (reason) => { void (async () => {
      setRefundBusy(p.paymentId); setRefundMsg(null);
      try { await mobileCheckoutApi.voidPayment(p.paymentId, { reason: reason.trim() }); setRefundMsg(`Void submitted for ${formatCents(p.amountCents)}.`); reloadPayments(); }
      catch (e: any) { setRefundMsg(e?.message || 'Void failed.'); }
      finally { setRefundBusy(null); }
    })(); }, { minLength: 2 });
  }, [ask, reloadPayments]);

  // Load the canonical ticket detail (read-only; shown even if the lock is held elsewhere). Reusable so
  // composition changes (retail line, discount) can re-pull the SAME canonical detail after a write.
  const loadDetail = useCallback(() => {
    mobileCheckoutApi.ticket(ticketId)
      .then((d) => setDetail(d))
      .catch((e: any) => setDetailError(e?.message || 'Could not load the ticket.'));
    // Remaining-balance breakdown (confirmed / in-flight / remaining). Optional + defensive: a missing or failing
    // balance read never blocks the ticket. Surfaces a collected/remaining split once any partial has been captured.
    mobileCheckoutApi.ticketBalance?.(ticketId)?.then(setBalance).catch(() => {});
    mobileCheckoutApi.ticketPayments?.(ticketId)?.then(setPayments).catch(() => {});
  }, [ticketId]);
  useEffect(() => { setDetail(null); setDetailError(null); loadDetail(); }, [loadDetail]);

  // Acquire the checkout lock on open; heartbeat while held; release on leave.
  const proceedingRef = useRef(false);

  useEffect(() => {
    let active = true;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    (async () => {
      try {
        await mobileCheckoutApi.acquireLock(ticketId, SESSION_ID, DEVICE_ID);
        if (!active) return;
        setLock('owned');
        heartbeat = setInterval(() => { mobileCheckoutApi.refreshLock(ticketId, SESSION_ID).catch(() => {}); }, 30_000);
      } catch (e: any) {
        if (!active) return;
        setLock(e?.status === 409 ? 'elsewhere' : 'error');
      }
    })();
    return () => {
      active = false;
      if (heartbeat) clearInterval(heartbeat);
      if (!proceedingRef.current) {
        mobileCheckoutApi.releaseLock(ticketId, SESSION_ID, 'left').catch(() => {});
      }
    };
  }, [ticketId]);

  const subtotal = detail?.totals.subtotalCents ?? 0;
  const tipCents = previewTipCents(tip, subtotal, (parseDollarsToCents(customTip) ?? 0));
  const baseTotal = detail?.totals.totalDueCents ?? 0;
  const previewTotal = baseTotal + (tipCents - (detail?.totals.tipCents ?? 0)); // swap any existing tip for the chosen one

  const onProceed = useCallback(async () => {
    setProceeding(true); setProceed(null);
    try {
      await mobileCheckoutApi.acquireLock(ticketId, SESSION_ID, DEVICE_ID);
      const res = await mobileCheckoutApi.proceed(ticketId, { sessionId: SESSION_ID, deviceId: DEVICE_ID, tip: tipToApi(tip, (parseDollarsToCents(customTip) ?? 0)) });
      if (res.canProceed && res.idempotencyKey) {
        proceedingRef.current = true;
        const finalAmount = res.balanceCents || previewTotal;
        nav.openTapToPay(ticketId, res.idempotencyKey, finalAmount);
      } else {
        setProceed(res); // blocked — show the honest reason inline
      }
    } catch (e: any) {
      setProceed({ canProceed: false, reason: 'error', message: e?.message || 'Could not start payment.', balanceCents: baseTotal });
    } finally {
      setProceeding(false);
    }
  }, [ticketId, tip, customTip, baseTotal, previewTotal, nav]);

  return (
    <>
      <div className="pay-sechead">
        <button className="pay-back" onClick={nav.back} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="t pay-serif">Ticket{detail?.ticketNumber ? ` #${detail.ticketNumber.replace(/^#+/, '')}` : ''}</div>
      </div>

      {lock === 'acquiring' && <div className="pay-lockbar acquiring">Opening ticket…</div>}
      {lock === 'owned' && <div className="pay-lockbar owned">✓ You have this ticket open</div>}
      {lock === 'elsewhere' && <div className="pay-lockbar elsewhere">This ticket is open elsewhere — you can view it but not charge it.</div>}
      {lock === 'error' && <div className="pay-lockbar elsewhere">Couldn’t lock this ticket. Try going back and reopening.</div>}

      {detail === null && !detailError && <div className="pay-skel" style={{ height: 220 }} />}
      {detailError && <div className="pay-state"><div className="big">Couldn’t load the ticket</div><div className="muted">{detailError}</div></div>}

      {detail && (
        <>
          <div className="pay-card">
            <div className="pay-custrow">
              <span className="av">{initials(detail.customer?.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nm">{detail.customer?.name || 'Walk-in'}{detail.customer?.isVip && <span className="pay-vip">VIP</span>}</div>
                <div className="sub">
                  {detail.customer?.phoneLast4 ? `•••• ${detail.customer.phoneLast4}` : '—'}
                  {typeof detail.customer?.loyaltyPoints === 'number' ? ` · ${detail.customer.loyaltyPoints} pts` : ''}
                </div>
              </div>
              <span className={`pay-badge ${detail.status === 'ready' ? 'ready' : 'neutral'}`}>{titleCase(detail.status)}</span>
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
            {balance && balance.confirmedCents > 0 && (
              <>
                <div className="pay-totrow"><span className="l">Collected</span><span className="v">−{formatCents(balance.confirmedCents)}</span></div>
                <div className="pay-totrow"><span className="l">Remaining</span><span className="v">{formatCents(balance.remainingCents)}</span></div>
              </>
            )}
            <div className="pay-totrow grand"><span className="l">Total</span><span className="v">{formatCents(previewTotal)}</span></div>
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
              {askUi}{confirmUi}
            </div>
          )}

          {proceed && !proceed.canProceed && (
            <div className="pay-proceedresult block">{proceed.message || 'Payment can’t start yet.'}</div>
          )}

          <div className="pay-stickyfoot">
            <button className="pay-btn" disabled={lock !== 'owned' || proceeding} onClick={onProceed}>
              {proceeding ? 'Checking…' : `Proceed to Payment · ${formatCents(previewTotal)}`}
            </button>
          </div>
        </>
      )}
    </>
  );
}
