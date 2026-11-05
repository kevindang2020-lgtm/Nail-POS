// PayScreen.tsx — Skip-the-Line Checkout for the customer app.
// Flow: Review Bill → Choose Method → (Card | Apple/Google Pay | Cash to Technician) → Processing → Success.
// All money is backend-authoritative; the screen only displays server totals and sends a tokenized payment (never a PAN).
//
// Fiserv master build §8D (P0, Nov 4 2026): the new-card path used to keep the card number + CVV in React state and send
// the raw digits as the "token"; Apple/Google Pay sent an invented `apple_pay_token_<time>`. Now a new card is entered in
// the salon's Fiserv-hosted iFrame (one-time token, card-not-present), saving a card happens only on Payment Methods with
// its own consent, the wallet buttons are hidden until a real Apple/Google Pay integration exists, and an unconfirmed
// result is shown as "verifying — do not pay again", never as a decline.
import { useCallback, useEffect, useRef, useState } from 'react';
import { HostedCardFrame, type HostedCardToken } from '../payments/HostedCardFrame';
import { useNavigate } from 'react-router-dom';
import { skipLineApi, type ActiveBillResponse, type ConfirmResult } from '../api/skipLineApi';
import { customerApi, type CustomerPaymentMethod } from '../api/customerApi';
import { money2 } from '../lib/appt';
import { parseDollarsToCents } from '@aipowersalon/ui';

type Step = 'loading' | 'empty' | 'bill' | 'method' | 'card' | 'processing' | 'success' | 'cashConfirm' | 'cashWaiting' | 'error';
const METHOD_LABEL: Record<string, string> = { card: 'Credit / Debit Card', apple_pay: 'Apple Pay', google_pay: 'Google Pay', cash_to_technician: 'Cash to Technician' };
const METHOD_ICON: Record<string, string> = { card: '💳', apple_pay: '', google_pay: 'G', cash_to_technician: '💵' };
// apple_pay / google_pay stay out until a real wallet SDK supplies a provider token (no invented tokens).
const APP_METHODS = ['card', 'cash_to_technician'];

function Header({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      {onBack ? <button onClick={onBack} aria-label="Back" style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--customer-border)', background: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>‹</button> : null}
      <h1 className="cust-h1" style={{ fontSize: 22 }}>{title}</h1>
    </div>
  );
}
function SecureNote() {
  return <div className="cust-sub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 }}><span aria-hidden>🔒</span> Encrypted &amp; secure checkout</div>;
}
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: strong ? '12px 0 0' : '5px 0', fontWeight: strong ? 800 : 500, fontSize: strong ? 18 : 14.5, borderTop: strong ? '1px solid var(--customer-border)' : undefined, marginTop: strong ? 8 : 0 }}>
      <span className={strong ? undefined : 'cust-sub'} style={strong ? undefined : { color: 'var(--customer-text-secondary)' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function PayScreen() {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>('loading');
  const [data, setData] = useState<ActiveBillResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [method, setMethod] = useState<string>('card');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Customer-added tip (mobile ecosystem Customer pass): presets + Other, validated server-side by the tenant's
  // existing tip policy. Sent at start; confirm charges the stored choice.
  const [tipChoice, setTipChoice] = useState<'none' | '500' | '1000' | '1500' | 'other'>('none');
  const [tipOther, setTipOther] = useState('');
  const chosenTipCents = tipChoice === 'none' ? 0 : tipChoice === 'other' ? (parseDollarsToCents(tipOther) ?? NaN) : Number(tipChoice);
  const tipValid = tipChoice !== 'other' || (Number.isInteger(chosenTipCents) && chosenTipCents > 0);
  const tipToCharge = Number.isInteger(chosenTipCents) && chosenTipCents > 0 ? chosenTipCents : 0;
  const [result, setResult] = useState<{ amountCents: number; method: string; ref?: string | null } | null>(null);
  const [cash, setCash] = useState<{ technicianName: string; amountCents: number; intentId: string } | null>(null);
  const [newCard, setNewCard] = useState<HostedCardToken | null>(null);
  const onHostedToken = useCallback((t: HostedCardToken | null) => setNewCard(t), []);
  const [savedCards, setSavedCards] = useState<CustomerPaymentMethod[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showNewCard, setShowNewCard] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  const load = () => { 
    setStep('loading'); 
    Promise.all([skipLineApi.activeBill(), customerApi.paymentMethods().catch(() => [])])
      .then(([d, cards]) => { 
        setData(d); 
        setSavedCards(cards);
        if (cards.length > 0) setSelectedCardId(cards.find(c => c.isDefault)?.id || cards[0].id);
        else setShowNewCard(true);
        setStep(d.bill && !d.bill.paid ? 'bill' : 'empty'); 
      })
      .catch((e: any) => { setErr(e?.message || 'Could not load your bill.'); setStep('error'); }); 
  };
  useEffect(() => { load(); return stopPoll; }, []);

  const bill = data?.bill || null;
  const totalWithTip = (bill?.totalDueCents ?? 0) + tipToCharge;
  // Fiserv §9.4 / N.J.S.A. 56:8-156.2: conditional credit-card surcharge, disclosed BEFORE payment. The processor
  // decides per card (credit only) and the receipt shows what was actually charged — no fee is shown as already assessed.
  const surchargeNote = data?.surcharge?.applies && data.surcharge.ratePercent > 0
    ? <div role="note" data-testid="surcharge-disclosure" className="cust-sub" style={{ fontSize: 12, fontWeight: 700 }}>
        Credit cards only: a {data.surcharge.ratePercent}% surcharge may be added by the card processor. Debit and prepaid cards are never surcharged. Your receipt shows the exact amount charged.
      </div>
    : null;
  const methods = (data?.enabledMethods || []).filter((m) => APP_METHODS.includes(m));

  const handleConfirm = (r: ConfirmResult, m: string) => {
    if (r.paid) { setResult({ amountCents: r.amountCents || bill!.totalDueCents, method: m, ref: r.processorTransactionId }); setStep('success'); }
    else if ((r as any).status === 'unknown') { setMsg((r as any).message || 'We could not confirm this payment yet. Please do not pay again — the salon will verify it.'); setStep('error'); setErr((r as any).message || 'We could not confirm this payment yet. Please do not pay again — the salon will verify it.'); }
    else if (r.configured === false) { setMsg(r.disabledReason || 'Card payments aren’t enabled for this salon yet.'); setStep(m === 'card' ? 'card' : 'method'); }
    else { setMsg(r.declineReason ? `Declined — ${r.declineReason}` : 'Your payment was declined. Please try another method.'); setStep(m === 'card' ? 'card' : 'method'); }
  };

  const payCard = async () => {
    if (!bill) return;
    setMsg(null); setBusy(true); setStep('processing');
    try {
      const start = await skipLineApi.startPayment(bill.invoiceId, 'card', Number.isInteger(chosenTipCents) && chosenTipCents > 0 ? chosenTipCents : undefined);
      if (!start.configured) { setMsg('Card payments aren’t enabled for this salon yet.'); setStep('card'); return; }
      
      let r;
      if (!showNewCard && selectedCardId) {
        r = await skipLineApi.confirmPayment(bill.invoiceId, { intentId: start.intentId, method: 'card', paymentMethodId: selectedCardId });
      } else {
        // one-time hosted-iFrame token (card-not-present); the card number / CVV never reached this app
        if (!newCard) throw new Error('Enter your card in the secure card form first.');
        r = await skipLineApi.confirmPayment(bill.invoiceId, { intentId: start.intentId, method: 'card', token: newCard.token, ...(newCard.expiry ? { expiry: newCard.expiry } : {}) });
      }
      handleConfirm(r, 'card');
    } catch (e: any) { setMsg(e?.message || 'Payment failed. Please try again.'); setStep('card'); }
    finally { setBusy(false); }
  };

  const confirmCash = async () => {
    if (!bill) return;
    setBusy(true); setMsg(null);
    try {
      const r = await skipLineApi.payCashToTech(bill.invoiceId);
      setCash({ technicianName: r.technicianName || bill.technicianName, amountCents: r.amountCents, intentId: r.intentId });
      setStep('cashWaiting');
      stopPoll();
      let n = 0;
      pollRef.current = setInterval(async () => {
        n += 1;
        try {
          const s = await skipLineApi.paymentStatus(r.intentId);
          if (s.status === 'cash_confirmed_by_tech') { stopPoll(); setResult({ amountCents: s.amountCents, method: 'cash_to_technician' }); setStep('success'); }
          else if (s.status === 'cash_issue_needs_front_desk') { stopPoll(); setMsg('Please see the front desk to complete your payment.'); setStep('cashConfirm'); }
        } catch { /* transient — keep polling */ }
        if (n > 60) stopPoll(); // ~3 minutes
      }, 3000);
    } catch (e: any) { setMsg(e?.message || 'Could not start the cash payment.'); }
    finally { setBusy(false); }
  };

  // ---------- render ----------
  const wrap = (children: React.ReactNode) => <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>;

  if (step === 'loading') return wrap(
    <>
      <Header title="Your Bill" onBack={() => nav('/')} />
      <div className="cust-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="cust-skel" style={{ width: 100, height: 18 }} />
          <div className="cust-pill cust-pill-purple" style={{ opacity: 0.6 }}>Skip-the-Line</div>
        </div>
        <div className="cust-skel" style={{ width: 140, height: 14, marginTop: 4 }} />
        <div style={{ marginTop: 14 }}>
          {[1, 2].map((i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
              <div className="cust-skel" style={{ width: 120, height: 16 }} />
              <div className="cust-skel" style={{ width: 40, height: 16 }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 0', marginTop: 8, borderTop: '1px solid var(--customer-border)' }}>
          <div className="cust-skel" style={{ width: 80, height: 20 }} />
          <div className="cust-skel" style={{ width: 60, height: 20 }} />
        </div>
      </div>
      <div className="cust-skel" style={{ height: 52, borderRadius: 12 }} />
    </>
  );
  if (step === 'error') return wrap(<><Header title="Pay" onBack={() => nav('/')} /><div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{err}</div><button onClick={load} className="cust-btn cust-btn-ghost" style={{ height: 48 }}>Try again</button></>);
  if (step === 'empty') return wrap(<><Header title="Pay" onBack={() => nav('/')} /><div className="cust-card" style={{ padding: 24, textAlign: 'center' }}><div style={{ fontSize: 34 }} aria-hidden>✅</div><div className="cust-h2" style={{ marginTop: 8 }}>You’re all set</div><div className="cust-sub" style={{ marginTop: 4 }}>There’s no bill waiting to be paid right now.</div></div><button onClick={() => nav('/')} className="cust-btn" style={{ height: 48 }}>Back to Home</button></>);

  if (step === 'success' && result) return wrap(
    <div style={{ textAlign: 'center', paddingTop: 24 }}>
      <div style={{ width: 76, height: 76, borderRadius: '50%', margin: '0 auto', display: 'grid', placeItems: 'center', background: 'var(--customer-green-light)', color: 'var(--customer-green)', fontSize: 38 }} aria-hidden>✓</div>
      <h1 className="cust-h1" style={{ marginTop: 16 }}>Payment Successful!</h1>
      <div className="cust-sub" style={{ marginTop: 6 }}>{result.method === 'cash_to_technician' ? 'Your technician confirmed your cash payment.' : 'Your payment has been processed.'}</div>
      <div className="cust-card" style={{ padding: 16, marginTop: 18, textAlign: 'left' }}>
        <Row label="Total Paid" value={money2(result.amountCents)} />
        {bill ? <Row label="Invoice" value={bill.ticketNumber} /> : null}
        <Row label="Payment Method" value={METHOD_LABEL[result.method] || result.method} />
      </div>
      <button onClick={() => nav('/receipts')} className="cust-btn" style={{ height: 50, marginTop: 16 }}>View Receipt</button>
      <button onClick={() => nav('/')} className="cust-btn cust-btn-ghost" style={{ height: 50, marginTop: 10 }}>Back to Home</button>
    </div>
  );

  if (step === 'processing') return wrap(
    <div style={{ textAlign: 'center', paddingTop: 40 }}>
      <div className="cust-spinner" style={{ width: 46, height: 46, margin: '0 auto', borderRadius: '50%', border: '4px solid var(--customer-primary-light)', borderTopColor: 'var(--customer-primary)', animation: 'spin 0.9s linear infinite' }} aria-hidden />
      <div className="cust-h2" style={{ marginTop: 18 }}>Processing Payment</div>
      <div className="cust-sub" style={{ marginTop: 6 }}>Please do not close this screen.</div>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );

  if (!bill) return wrap(<div className="cust-sub">No bill found.</div>);

  if (step === 'cashConfirm') return wrap(
    <>
      <Header title="Pay Cash to Technician" onBack={() => { setMsg(null); setStep('method'); }} />
      <div className="cust-card" style={{ padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 34 }} aria-hidden>💵</div>
        <div className="cust-h2" style={{ marginTop: 8 }}>Hand {money2(bill.totalDueCents)} to {bill.technicianName || 'your technician'}</div>
        <div className="cust-sub" style={{ marginTop: 6 }}>Your technician will confirm the payment and your ticket will close automatically.</div>
      </div>
      {msg ? <div className="cust-sub" style={{ color: 'var(--customer-red)' }}>{msg}</div> : null}
      <button onClick={confirmCash} disabled={busy} className="cust-btn" style={{ height: 50 }}>{busy ? 'Please wait…' : 'I’ll pay cash now'}</button>
      <button onClick={() => setStep('method')} className="cust-btn cust-btn-ghost" style={{ height: 48 }}>Choose another method</button>
    </>
  );

  if (step === 'cashWaiting' && cash) return wrap(
    <div style={{ textAlign: 'center', paddingTop: 28 }}>
      <div className="cust-spinner" style={{ width: 46, height: 46, margin: '0 auto', borderRadius: '50%', border: '4px solid var(--customer-primary-light)', borderTopColor: 'var(--customer-primary)', animation: 'spin 0.9s linear infinite' }} aria-hidden />
      <h1 className="cust-h1" style={{ marginTop: 16, fontSize: 22 }}>Waiting for {cash.technicianName}</h1>
      <div className="cust-sub" style={{ marginTop: 6 }}>Hand {money2(cash.amountCents)} in cash to your technician. This screen updates the moment they confirm.</div>
      <button onClick={() => { stopPoll(); setStep('cashConfirm'); }} className="cust-btn cust-btn-ghost" style={{ height: 48, marginTop: 20 }}>Cancel</button>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );

  if (step === 'card') return wrap(
    <>
      <Header title="Pay with Card" onBack={() => { setMsg(null); setStep('method'); }} />
      <div className="cust-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        
        {savedCards.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: showNewCard ? 12 : 0 }}>
             {savedCards.map(c => (
               <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: '1px solid var(--customer-border)', borderRadius: 10, background: selectedCardId === c.id && !showNewCard ? 'var(--customer-primary-light)' : '#fff', cursor: 'pointer' }}>
                 <input type="radio" name="payment_card" checked={selectedCardId === c.id && !showNewCard} onChange={() => { setSelectedCardId(c.id); setShowNewCard(false); }} />
                 <span style={{ fontWeight: 700 }}>{c.brand || 'Card'} ending in {c.last4}</span>
               </label>
             ))}
             <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: '1px solid var(--customer-border)', borderRadius: 10, background: showNewCard ? 'var(--customer-primary-light)' : '#fff', cursor: 'pointer' }}>
               <input type="radio" name="payment_card" checked={showNewCard} onChange={() => setShowNewCard(true)} />
               <span style={{ fontWeight: 700 }}>Use a different card</span>
             </label>
          </div>
        )}

        {showNewCard && (
          <>
            <HostedCardFrame onToken={onHostedToken} />
            <div className="cust-sub" style={{ fontSize: 12 }}>To save a card for next time, add it in Profile → Payment Methods.</div>
          </>
        )}
      </div>
      {surchargeNote}
      {msg ? <div className="cust-sub" style={{ color: 'var(--customer-red)' }}>{msg}</div> : null}
      <button onClick={payCard} disabled={busy || (showNewCard && !newCard)} className="cust-btn" style={{ height: 52 }}>{busy ? 'Processing…' : `Pay ${money2(totalWithTip)}`}</button>
      <SecureNote />
    </>
  );

  if (step === 'method') return wrap(
    <>
      <Header title="Choose Payment" onBack={() => { setMsg(null); setStep('bill'); }} />
      <div className="cust-sub" style={{ marginTop: -4 }}>Pick how you’d like to pay {money2(totalWithTip)}.</div>
      {msg ? <div className="cust-sub" style={{ color: 'var(--customer-red)' }}>{msg}</div> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {methods.map((m) => (
          <button key={m} onClick={() => { setMsg(null); if (m === 'card') setStep('card'); else if (m === 'cash_to_technician') setStep('cashConfirm'); }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, height: 56, padding: '0 16px', borderRadius: 14, cursor: 'pointer', textAlign: 'left', border: '1px solid var(--customer-border)', background: '#fff' }}>
            <span aria-hidden style={{ width: 28, textAlign: 'center', fontSize: 20, fontWeight: 800 }}>{METHOD_ICON[m] || '•'}</span>
            <span style={{ flex: 1, fontWeight: 700 }}>{METHOD_LABEL[m] || m}</span>
            <span aria-hidden style={{ color: 'var(--customer-text-secondary)' }}>›</span>
          </button>
        ))}
      </div>
      <SecureNote />
    </>
  );

  // step === 'bill'
  return wrap(
    <>
      <Header title="Your Bill" onBack={() => nav('/')} />
      <div className="cust-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{bill.ticketNumber}</div>
          <div className="cust-pill cust-pill-purple">Skip-the-Line</div>
        </div>
        {bill.technicianName ? <div className="cust-sub" style={{ marginTop: 2 }}>with {bill.technicianName}</div> : null}
        <div style={{ marginTop: 14 }}>
          {bill.services.map((s) => (
            <div key={s.serviceLineId} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 14.5 }}>
              <span>{s.serviceName}</span><span>{money2(s.priceCents)}</span>
            </div>
          ))}
        </div>
        <Row label="Subtotal" value={money2(bill.subtotalCents)} />
        {bill.discountCents > 0 ? <Row label="Discount" value={'−' + money2(bill.discountCents)} /> : null}
        <Row label="Tax" value={money2(bill.taxCents)} />
        {bill.tipCents > 0 ? <Row label="Tip" value={money2(bill.tipCents)} /> : null}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Add a Tip{bill.technicianName ? ` for ${bill.technicianName}` : ''}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([['none', 'No Tip'], ['500', '$5'], ['1000', '$10'], ['1500', '$15'], ['other', 'Other']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTipChoice(k)} aria-pressed={tipChoice === k} style={{ height: 38, padding: '0 14px', borderRadius: 10, border: tipChoice === k ? '2px solid var(--customer-primary)' : '1px solid var(--customer-border)', background: tipChoice === k ? 'var(--customer-primary-soft, #F5EDE0)' : '#fff', fontWeight: 700, cursor: 'pointer' }}>{label}</button>
            ))}
          </div>
          {tipChoice === 'other' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <span style={{ fontWeight: 800 }}>$</span>
              <input inputMode="decimal" placeholder="0.00" aria-label="Tip amount" value={tipOther} onChange={(e) => setTipOther(e.target.value.replace(/[^0-9.]/g, ''))} style={{ height: 40, borderRadius: 10, border: '1px solid var(--customer-border)', padding: '0 10px', width: 110, fontSize: 15 }} />
            </div>
          ) : null}
        </div>
        {Number.isInteger(chosenTipCents) && chosenTipCents > 0 ? <Row label="Your tip" value={money2(chosenTipCents)} /> : null}
        <Row label="Total" value={money2(totalWithTip)} strong />
      </div>
      {surchargeNote}
      {msg ? <div className="cust-sub" style={{ color: 'var(--customer-red)' }}>{msg}</div> : null}
      <button onClick={() => { if (!tipValid) { setMsg('Enter a valid tip amount, or choose a preset.'); return; } setMsg(null); setStep('method'); }} className="cust-btn" style={{ height: 52 }}>Pay Now</button>
      {methods.includes('cash_to_technician') ? <button onClick={() => setStep('cashConfirm')} className="cust-btn cust-btn-ghost" style={{ height: 50 }}>Pay Cash to Technician</button> : null}
      <SecureNote />
    </>
  );
}
