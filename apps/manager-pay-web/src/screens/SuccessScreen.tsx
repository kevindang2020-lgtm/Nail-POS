import { useEffect, useState, useCallback } from 'react';
import { useT, fmtTime } from '@aipowersalon/mobile-sdk';
import { mobileCheckoutApi, type MobileTicketDetail, type ReceiptResult } from '../api/mobileCheckoutApi';
import { formatCents, titleCase } from '../util/format';
import { usePayNav } from '../shell/nav';
import { checkoutRealtime } from '../lib/useCheckoutStream';
import { ReturnToStaff } from './ReturnToStaff';

// Success screen (mandate §79–§80, §97–§102) — the UI for a genuinely completed payment: reached only when the backend
// answered 'confirmed' (the processor verified, the money recorded). Shows the amount, the card as "Visa •••• 4242" at
// most, the authorization as a safe reference (the payment id — never a processor credential) and the time. Receipt
// delivery is ASYNCHRONOUS through the canonical receipt system: a queued receipt reports "queued", and the
// `receipt_sent` realtime event flips it to "sent" when the tenant's messenger delivered it. Twilio being down never
// touches the payment (§102). In handoff mode the customer sees this screen too; "Done" goes through Return to Staff.
type Channel = 'sms' | 'email' | 'app';

export function SuccessScreen({ ticketId, amountCents, handoff, cardBrand, cardLast4, paymentId }: { ticketId: string; amountCents: number; handoff?: boolean; cardBrand?: string | null; cardLast4?: string | null; paymentId?: string }) {
  const tr = useT();
  const nav = usePayNav();
  const [detail, setDetail] = useState<MobileTicketDetail | null>(null);
  const [sending, setSending] = useState<Channel | null>(null);
  const [result, setResult] = useState<{ channel: Channel; res: ReceiptResult & { queued?: boolean } } | null>(null);
  const [staffAsk, setStaffAsk] = useState(false);
  const [at] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    mobileCheckoutApi.ticket(ticketId).then((d) => { if (active) setDetail(d); }).catch(() => { if (active) setDetail(null); });
    return () => { active = false; };
  }, [ticketId]);

  // a queued receipt becomes "sent" when the messenger delivered it (realtime receipt_sent for this ticket)
  useEffect(() => {
    const off = checkoutRealtime.onEvent((d: { event: string; payload?: any }) => {
      if (d.event === 'receipt_sent' && d.payload?.ticketId === ticketId) setResult((r) => (r ? { ...r, res: { ...r.res, configured: true, delivery: 'sent', queued: false } } : r));
    });
    return () => { off(); };
  }, [ticketId]);

  const send = useCallback(async (channel: Channel) => {
    setSending(channel); setResult(null);
    try {
      const res = await mobileCheckoutApi.sendReceipt(ticketId, channel);
      setResult({ channel, res });
    } catch (e: any) {
      setResult({ channel, res: { channel, configured: false, disabledReason: e?.message || 'Could not send the receipt.' } });
    } finally {
      setSending(null);
    }
  }, [ticketId]);

  const opts = detail?.receiptDeliveryOptions;
  const phone = detail?.customer?.phoneMasked || 'No phone on file';
  const email = detail?.customer?.emailMasked || 'No email on file';
  const done = () => { if (handoff) setStaffAsk(true); else nav.resetToCheckout(); };

  return (
    <>
      <div className="pay-successwrap" role="status" aria-live="polite">
        <div className="pay-checkcircle">✓</div>
        <div className="amt">{formatCents(amountCents)}</div>
        <div className="msg">{tr('pay.success.title')}</div>
        {(cardBrand || cardLast4) && <div className="card">{titleCase(cardBrand || 'Card')}{cardLast4 ? ` •••• ${cardLast4}` : ''}</div>}
        <div className="meta">
          {paymentId && <span>{tr('pay.success.authorization')}: <span className="pay-mono">{paymentId.slice(0, 8).toUpperCase()}</span></span>}
          <span>{tr('pay.success.time')}: {fmtTime(at)}</span>
        </div>
        {handoff && <div className="pay-handoff-thanks">{tr('pay.handoff.thanks')}</div>}
      </div>

      <div className="pay-receiptcard">
        <div className="rt">{tr('pay.success.receipt')}</div>
        <div className="pay-rcptbtns">
          <button className="pay-rcptbtn" disabled={!opts?.sms || sending !== null} onClick={() => send('sms')}>
            <span className="ic" aria-hidden>💬</span>
            <span className="grow">{tr('pay.success.text')}<div className="sub">{phone}</div></span>
            {sending === 'sms' && <span className="sub">Sending…</span>}
          </button>
          <button className="pay-rcptbtn" disabled={!opts?.email || sending !== null} onClick={() => send('email')}>
            <span className="ic" aria-hidden>✉️</span>
            <span className="grow">{tr('pay.success.email')}<div className="sub">{email}</div></span>
            {sending === 'email' && <span className="sub">Sending…</span>}
          </button>
          {!handoff && (
            <button className="pay-rcptbtn" disabled={!opts?.app || sending !== null} onClick={() => send('app')}>
              <span className="ic" aria-hidden>📱</span>
              <span className="grow">{tr('pay.success.save')}<div className="sub">{detail?.customer?.fullName || 'Walk-in'}</div></span>
              {sending === 'app' && <span className="sub">Saving…</span>}
            </button>
          )}
        </div>

        {result && (
          result.res.queued || result.res.delivery === 'queued'
            ? <div className="pay-rcptstatus ok" role="status">⏳ {tr('pay.success.queued')}</div>
            : result.res.configured
              ? <div className="pay-rcptstatus ok" role="status">✓ Receipt {result.res.delivery === 'saved' ? 'saved' : 'sent'}{result.res.receiptNumber ? ` · ${result.res.receiptNumber}` : ''}</div>
              : <div className="pay-rcptstatus warn" role="status">{result.res.disabledReason || 'That channel isn’t available.'}</div>
        )}
      </div>

      <div className="pay-stickyfoot">
        <button className="pay-btn" onClick={done}>{handoff ? tr('pay.success.noReceipt') + ' · ' + tr('pay.handoff.returnToStaff') : tr('pay.success.done')}</button>
      </div>
      {staffAsk && <ReturnToStaff onDone={() => nav.returnToStaff()} onDismiss={() => setStaffAsk(false)} />}
    </>
  );
}
