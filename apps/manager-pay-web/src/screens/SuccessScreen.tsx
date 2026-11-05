import { useEffect, useState, useCallback } from 'react';
import { mobileCheckoutApi, type MobileTicketDetail, type ReceiptResult } from '../api/mobileCheckoutApi';
import { formatCents } from '../util/format';
import { usePayNav } from '../shell/nav';

// Success screen — the UI for a genuinely completed payment. Reached only when a real capture calls nav.openSuccess;
// nothing in the current build fabricates a success to get here. Receipt delivery reuses the canonical receipt system,
// which is honest about unconfigured channels (it reports a disabledReason rather than pretending to send).
type Channel = 'sms' | 'email' | 'app';

export function SuccessScreen({ ticketId, amountCents }: { ticketId: string; amountCents: number }) {
  const nav = usePayNav();
  const [detail, setDetail] = useState<MobileTicketDetail | null>(null);
  const [sending, setSending] = useState<Channel | null>(null);
  const [result, setResult] = useState<{ channel: Channel; res: ReceiptResult } | null>(null);
  const [activePrompt, setActivePrompt] = useState<'sms' | 'email' | null>(null);
  const [customDestination, setCustomDestination] = useState('');

  useEffect(() => {
    let active = true;
    mobileCheckoutApi.ticket(ticketId).then((d) => { if (active) setDetail(d); }).catch(() => { if (active) setDetail(null); });
    return () => { active = false; };
  }, [ticketId]);

  const send = useCallback(async (channel: Channel, destination?: string) => {
    setSending(channel); setResult(null);
    try {
      const res = destination
        ? await mobileCheckoutApi.sendReceipt(ticketId, channel, destination)
        : await mobileCheckoutApi.sendReceipt(ticketId, channel);
      setResult({ channel, res });
      setActivePrompt(null);
      setCustomDestination('');
    } catch (e: any) {
      setResult({ channel, res: { channel, configured: false, disabledReason: e?.message || 'Could not send the receipt.' } });
    } finally {
      setSending(null);
    }
  }, [ticketId]);

  const opts = detail?.receiptDeliveryOptions;
  const phone = detail?.customer?.phoneLast4 ? `•••• ${detail.customer.phoneLast4}` : 'No phone on file — tap to enter';
  const email = detail?.customer?.emailMasked || 'No email on file — tap to enter';

  const handleSmsClick = () => {
    if (opts?.sms) {
      send('sms');
    } else {
      setActivePrompt(activePrompt === 'sms' ? null : 'sms');
      setCustomDestination('');
    }
  };

  const handleEmailClick = () => {
    if (opts?.email) {
      send('email');
    } else {
      setActivePrompt(activePrompt === 'email' ? null : 'email');
      setCustomDestination('');
    }
  };

  return (
    <>
      <div className="pay-successwrap">
        <div className="pay-checkcircle">✓</div>
        <div className="amt">{formatCents(amountCents)}</div>
        <div className="msg">Payment complete</div>
      </div>

      <div className="pay-receiptcard">
        <div className="rt">Send a receipt</div>
        <div className="pay-rcptbtns">
          <button className="pay-rcptbtn" disabled={sending !== null} onClick={handleSmsClick}>
            <span className="ic" aria-hidden>💬</span>
            <span className="grow">Text message<div className="sub">{phone}</div></span>
            {sending === 'sms' && <span className="sub">Sending…</span>}
          </button>

          {activePrompt === 'sms' && (
            <div className="pay-rcpt-input-box">
              <div className="pay-rcpt-input-title">Enter customer mobile number:</div>
              <div className="pay-rcpt-input-row">
                <input
                  type="tel"
                  className="pay-rcpt-input"
                  placeholder="(555) 000-0000"
                  value={customDestination}
                  onChange={(e) => setCustomDestination(e.target.value)}
                  autoFocus
                />
                <button
                  className="pay-rcpt-send"
                  disabled={!customDestination.trim() || sending !== null}
                  onClick={() => send('sms', customDestination.trim())}
                >
                  Send
                </button>
                <button className="pay-rcpt-cancel" onClick={() => setActivePrompt(null)}>
                  ✕
                </button>
              </div>
            </div>
          )}

          <button className="pay-rcptbtn" disabled={sending !== null} onClick={handleEmailClick}>
            <span className="ic" aria-hidden>✉️</span>
            <span className="grow">Email<div className="sub">{email}</div></span>
            {sending === 'email' && <span className="sub">Sending…</span>}
          </button>

          {activePrompt === 'email' && (
            <div className="pay-rcpt-input-box">
              <div className="pay-rcpt-input-title">Enter customer email address:</div>
              <div className="pay-rcpt-input-row">
                <input
                  type="email"
                  className="pay-rcpt-input"
                  placeholder="customer@example.com"
                  value={customDestination}
                  onChange={(e) => setCustomDestination(e.target.value)}
                  autoFocus
                />
                <button
                  className="pay-rcpt-send"
                  disabled={!customDestination.trim() || sending !== null}
                  onClick={() => send('email', customDestination.trim())}
                >
                  Send
                </button>
                <button className="pay-rcpt-cancel" onClick={() => setActivePrompt(null)}>
                  ✕
                </button>
              </div>
            </div>
          )}

          <button className="pay-rcptbtn" disabled={!opts?.app || sending !== null} onClick={() => send('app')}>
            <span className="ic" aria-hidden>📱</span>
            <span className="grow">Save to customer profile<div className="sub">{detail?.customer?.name || 'Walk-in'}</div></span>
            {sending === 'app' && <span className="sub">Saving…</span>}
          </button>
        </div>

        {result && (
          result.res.configured
            ? <div className="pay-rcptstatus ok">✓ Receipt {result.res.delivery === 'saved' ? 'saved' : 'sent'}{result.res.receiptNumber ? ` · ${result.res.receiptNumber}` : ''}</div>
            : <div className="pay-rcptstatus warn">{result.res.disabledReason || 'That channel isn’t available.'}</div>
        )}
      </div>

      <div className="pay-stickyfoot">
        <button className="pay-btn" onClick={nav.resetToCheckout}>Done</button>
      </div>
    </>
  );
}
