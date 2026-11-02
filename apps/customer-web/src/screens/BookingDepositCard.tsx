// BookingDepositCard.tsx — D11 (Oct 21 2026): the salon asked for a deposit with this booking. The booking already stands;
// here the guest pays the deposit with the salon's hosted card entry (CardSecure iFrame → a token; a card number never
// reaches us). Says plainly what is refundable until when, and what happens on a no-show. A declined card can be retried;
// a salon without card payments set up takes the deposit in person.
import { useEffect, useState } from 'react';
import { customerApi, type BookingDepositView } from '../api/customerApi';

const money = (c: number) => '$' + (c / 100).toFixed(2);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null);

export function BookingDepositCard({ appointmentId, initial }: { appointmentId: string; initial: BookingDepositView }) {
  const [dep, setDep] = useState<BookingDepositView>(initial);
  const [tok, setTok] = useState<{ available: boolean; url?: string; origin?: string; reason?: string } | null>(null);
  const [pending, setPending] = useState<{ token: string; expiry?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const owed = dep.status === 'pending' || dep.status === 'failed';

  useEffect(() => { if (owed && !tok) customerApi.paymentTokenizer().then(setTok).catch(() => setTok({ available: false })); }, [owed, tok]);
  // CardSecure posts {"message": "<token>", "expiry": "YYYYMM"} — accepted ONLY from the gateway origin
  useEffect(() => {
    if (!owed || !tok?.available || !tok.origin) return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== tok.origin) return;
      let d: any = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      const token = String(d?.message ?? ''); if (!/^9\d{12,18}$/.test(token)) return;
      const m = /^(\d{4})(\d{2})$/.exec(String(d?.expiry ?? ''));
      setMsg(null); setPending({ token, ...(m ? { expiry: m[2] + m[1].slice(2) } : {}) });   // MMYY for the gateway
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [owed, tok]);

  const pay = async () => {
    if (!pending) return;
    setBusy(true); setMsg(null);
    try { setDep(await customerApi.payBookingDeposit(appointmentId, { cardToken: pending.token, ...(pending.expiry ? { expiry: pending.expiry } : {}) })); setPending(null); }
    catch (e: any) {
      const code = e?.body?.code || e?.code;
      setMsg(code === 'DEPOSIT_DECLINED' ? (e?.body?.message || e?.message || 'Your card was declined — try another card.')
        : code === 'PAYMENTS_NOT_CONFIGURED' ? 'This salon takes the deposit in person — your booking still stands.'
        : code === 'DEPOSIT_STATUS_UNKNOWN' ? 'The card processor did not answer. Try again in a moment — you will not be charged twice.'
        : e?.message || 'The deposit could not be paid right now.');
      try { setDep(await customerApi.bookingDeposit(appointmentId)); } catch { /* keep what we have */ }
    } finally { setBusy(false); }
  };

  return (
    <div className="cust-card" style={{ padding: 16 }} data-testid="booking-deposit">
      <div style={{ fontWeight: 800, fontSize: 16 }}>{dep.status === 'captured' || dep.status === 'applied' ? `Deposit paid — ${money(dep.amountCents)}` : `Deposit — ${money(dep.amountCents)}`}</div>
      <div className="cust-sub" style={{ marginTop: 6 }} data-testid="booking-deposit-terms">
        {dep.status === 'captured' ? `Paid${dep.cardLast4 ? ` with the card ending ${dep.cardLast4}` : ''}. It comes off your bill at checkout.` : 'This salon asks for a deposit to hold your time. It comes off your bill at checkout.'}
        {dep.refundableUntil ? ` Cancel before ${when(dep.refundableUntil)} for a full refund; after that it is kept.` : ''}
        {dep.forfeitOnNoShow ? ' A no-show keeps the deposit.' : ''}
      </div>
      {owed ? (
        <div style={{ marginTop: 12 }}>
          {dep.status === 'failed' && dep.failureReason ? <div className="cust-sub" style={{ color: '#9B2C2C', marginBottom: 6 }}>Declined — {dep.failureReason}. Try another card.</div> : null}
          {tok === null ? <div className="cust-sub">Loading secure card entry…</div>
            : !tok.available ? <div className="cust-sub" data-testid="booking-deposit-in-person">Card payments aren’t set up online for this salon yet — the salon will take the deposit in person. Your booking stands.</div>
            : <iframe title="Secure card entry" src={tok.url} sandbox="allow-scripts allow-same-origin allow-forms" style={{ width: '100%', height: 150, border: 0 }} />}
          {tok?.available ? <button className="cust-btn" style={{ marginTop: 10 }} disabled={!pending || busy} onClick={pay} data-testid="booking-deposit-pay">{busy ? 'Paying…' : pending ? `Pay ${money(dep.amountCents)} deposit` : 'Enter your card above'}</button> : null}
        </div>
      ) : null}
      {msg ? <div className="cust-sub" style={{ marginTop: 8 }} role="status">{msg}</div> : null}
    </div>
  );
}
