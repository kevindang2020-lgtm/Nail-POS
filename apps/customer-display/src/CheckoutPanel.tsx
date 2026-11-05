// CheckoutPanel.tsx — the customer's checkout on the display (23-inch spec §29–§46, §79–§80, §91–§98).
//
// rightPanelMode() decides, deterministically, what the dynamic right panel shows (§79–§80 "checkout has the highest
// display priority"): an active checkout → the live ticket and the tip; a payment in flight → the ticket and its status
// (an advertisement never covers an active payment); a confirmed payment → the receipt choice when there is one, then
// the 3-second completed summary; a dead session → a short message; nothing → the salon's advertising. The display never
// asks for a signature (Kevin, Oct 6 2026): the cardholder signs once, on the Clover card terminal.
//
// The pieces below are shared by the 23-inch right panel and the single-column (portrait / one-off) screen, so both show
// the same ticket, the same tip choices and the same words. Nothing here computes money (§35): every amount is the
// server's — the tip buttons carry the server's own amounts, and a choice is sent back as a choice.
import { useState } from 'react';
import type { CustomerDisplayReceipt, CustomerDisplayState, DisplayReceiptChannel, TipOption } from '@aipowersalon/api-contracts/customer';
import { parseDollarsToCents, keypadPress } from '@aipowersalon/ui';
import { usd } from './types';
import { CheckoutTicket } from './CheckoutTicket';
import { translate, useT } from './i18n';

export type RightPanelMode = 'ads' | 'checkout' | 'payment' | 'receipt' | 'completed' | 'message';

/** §79–§80, §98: what the dynamic right panel shows for this server state. Pure. After payment: the receipt choice (when
 *  there is one to make), then the completed summary. */
export function rightPanelMode(s: CustomerDisplayState | null): RightPanelMode {
  switch (s?.state) {
    case 'ticket_review': case 'tip_selected': return 'checkout';
    case 'payment_processing': case 'payment_verifying': case 'payment_failed': return 'payment';
    case 'payment_success': return s.receipt?.status === 'choose' ? 'receipt' : 'completed';
    case 'expired': return 'message';
    default: return 'ads';   // idle, disconnected (the POS ended the session), unknown — no customer on this display
  }
}

export interface CheckoutActions {
  submitting: boolean; actionError: string | null; rated: number | null;
  onTip: (o: TipOption) => void; onMethod: (m: 'card' | 'cash') => void; onPay: () => void;
  onRate: (n: number) => void; onClearError: () => void;
  /** §97: the customer's receipt choice */
  onReceipt?: (choice: DisplayReceiptChannel) => void;
}

// ── the ticket (§30–§33): the full customer-safe projection; the old service-list form only for a legacy session ──────
function Row({ label, value }: { label: string; value: string }) {
  return <div className="kiosk-row"><span>{label}</span><span>{value}</span></div>;
}
function LegacyTotals({ t: tot, surchargeLabel }: { t: CustomerDisplayState['totals']; surchargeLabel?: string }) {
  const t = useT();
  return (
    <div className="kiosk-totals">
      <Row label={t('ck.subtotal')} value={usd(tot.subtotalCents)} />
      {tot.tipCents > 0 && <Row label={t('ck.tip')} value={usd(tot.tipCents)} />}
      <Row label={t('ck.tax')} value={usd(tot.taxCents)} />
      {(tot.giftCardChargeCents ?? 0) > 0 && <Row label={t('ck.giftCard')} value={usd(tot.giftCardChargeCents ?? 0)} />}
      {tot.surchargeCents > 0 && <Row label={surchargeLabel || t('ck.cardSurcharge')} value={usd(tot.surchargeCents)} />}
      <div className="kiosk-row total"><span>{t('ck.total')}</span><span>{usd(tot.totalDueCents)}</span></div>
    </div>
  );
}
export function TicketView({ s }: { s: CustomerDisplayState }) {
  const t = useT();
  if (s.checkout) return <CheckoutTicket c={s.checkout} firstName={s.customer?.firstName} />;
  return (
    <section className="kiosk-ticket">
      {s.customer?.firstName && <div className="kiosk-hi serif">{t('ck.hiLegacy', { name: s.customer.firstName })}</div>}
      {s.ticket?.ticketNumber && <div className="kiosk-order">{t('ck.order', { n: s.ticket.ticketNumber })}</div>}
      <ul className="kiosk-lines">
        {(s.ticket?.services || []).map((svc, i) => (
          <li key={i}><span>{svc.serviceName}</span><span>{usd(svc.priceCents)}</span></li>
        ))}
      </ul>
      <LegacyTotals t={s.totals} />
    </section>
  );
}

// ── the tip (§34–§35): large buttons with the server's amounts, Custom, No Tip ──────────────────────────────────────────
function CustomTip({ onConfirm, onCancel, disabled }: { onConfirm: (cents: number) => void; onCancel: () => void; disabled: boolean }) {
  const t = useT();
  const [raw, setRaw] = useState('');
  const cents = parseDollarsToCents(raw) ?? 0;   // the ONE shared exact parser — no float money math
  const press = (k: string) => setRaw((r) => keypadPress(r, k, 1000));   // shared keystroke rules (one dot, 2 decimals, ≤$1000)
  return (
    <div className="kiosk-custom">
      <div className="kiosk-amount serif">{raw === '' ? '$0.00' : usd(cents)}</div>
      <div className="kiosk-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
          <button key={k} className="kiosk-key" onClick={() => press(k)} disabled={disabled}>{k}</button>
        ))}
      </div>
      <div className="kiosk-custom-actions">
        <button className="kiosk-btn ghost" onClick={onCancel} disabled={disabled}>{t('tip.back')}</button>
        <button className="kiosk-btn solid" onClick={() => onConfirm(cents)} disabled={disabled || cents <= 0}>{raw ? t('tip.add', { amount: usd(cents) }) : t('tip.addTip')}</button>
      </div>
    </div>
  );
}

export function TipAndPay({ s, a }: { s: CustomerDisplayState; a: CheckoutActions }) {
  const t = useT();
  const [customOpen, setCustomOpen] = useState(false);
  const tipped = s.selectedTipCents > 0 || s.state === 'tip_selected';
  if (customOpen) {
    return (
      <section className="kiosk-tip">
        <CustomTip disabled={a.submitting} onCancel={() => setCustomOpen(false)} onConfirm={(c) => { a.onTip({ label: 'Custom', tipType: 'custom', amountCents: c, selected: false }); setCustomOpen(false); }} />
      </section>
    );
  }
  return (
    <section className={`kiosk-tip${s.payButtonEnabled ? ' with-pay' : ''}`}>
      <div className="kiosk-tip-title serif">{t('tip.title')}</div>
      <div className="kiosk-tip-sub">{t('tip.sub')}</div>
      <div className="kiosk-tip-grid">
        {s.tipOptions.filter((o) => o.tipType === 'percent').map((o) => (
          <button key={o.label} className={`kiosk-tip-opt${o.selected ? ' on' : ''}`} disabled={a.submitting} onClick={() => a.onTip(o)}>
            <span className="pct">{o.label}</span>
            <span className="amt">{usd(o.amountCents)}</span>
          </button>
        ))}
      </div>
      <div className="kiosk-tip-row">
        <button className="kiosk-btn ghost" disabled={a.submitting} onClick={() => setCustomOpen(true)}>{t('tip.custom')}</button>
        <button className={`kiosk-btn ghost${s.selectedTipCents === 0 && tipped ? ' on' : ''}`} disabled={a.submitting}
          onClick={() => a.onTip({ label: 'No Tip', tipType: 'none', amountCents: 0, selected: false })}>{t('tip.none')}</button>
      </div>
      {s.payButtonEnabled ? (
        <div className="kiosk-pay-wrap">
          <div className="kiosk-method-title serif">{t('pay.how')}</div>
          <div className="kiosk-method-grid">
            <button className={`kiosk-method${s.totals.paymentMethod === 'card' ? ' on' : ''}`} disabled={a.submitting} onClick={() => a.onMethod('card')}>
              <span className="m-name">{t('pay.card')}</span>
              <span className="m-hint">{t('pay.cardHint')}</span>
            </button>
            <button className={`kiosk-method${s.totals.paymentMethod === 'cash' ? ' on' : ''}`} disabled={a.submitting} onClick={() => a.onMethod('cash')}>
              <span className="m-name">{t('pay.cash')}</span>
              <span className="m-hint">{t('pay.cashHint')}</span>
            </button>
          </div>
          {s.totals.surchargeCents > 0 && <div className="kiosk-method-note">{t('pay.surcharge', { amount: usd(s.totals.surchargeCents) })}</div>}
          <button className="kiosk-pay" disabled={a.submitting} onClick={a.onPay}>
            {a.submitting ? t('pay.starting') : t('pay.pay', { amount: usd(s.totals.totalDueCents) })}
          </button>
        </div>
      ) : tipped ? (
        <div className="kiosk-confirm">
          <div className="kiosk-confirm-line">{t('tip.totalLine', { tip: s.selectedTipCents > 0 ? t('tip.added', { amount: usd(s.selectedTipCents) }) : t('tip.noneAdded'), total: usd(s.totals.totalDueCents) })}</div>
          <div className="kiosk-confirm-sub">{t('tip.frontDeskCompletes')}</div>
        </div>
      ) : null}
      {a.actionError && <div className="kiosk-err" onClick={a.onClearError}>{a.actionError}</div>}
    </section>
  );
}

// ── payment status (§40–§42), the completed summary (§44), a dead session ─────────────────────────────
export function StatusCard({ s }: { s: CustomerDisplayState }) {
  const t = useT();
  const method = s.totals.paymentMethod === 'cash' ? 'cash' : 'card';
  if (s.state === 'payment_verifying') {
    // §41: the charge's answer did not come back in time — never invite a second payment
    return (
      <div className="kiosk-status" role="status" aria-live="polite">
        <div className="kiosk-spinner" />
        <div className="kiosk-h serif">{t('pay.verifying.h')}</div>
        <div className="kiosk-sub">{t('pay.verifying.s')}</div>
      </div>
    );
  }
  if (s.state === 'payment_failed') {
    return (
      <div className="kiosk-status" role="status" aria-live="polite">
        <div className="kiosk-glyph bad">!</div>
        <div className="kiosk-h serif">{t('pay.failed.h')}</div>
        <div className="kiosk-sub">{t('pay.failed.s')}</div>
      </div>
    );
  }
  if (s.state === 'expired') {
    return (
      <div className="kiosk-status">
        <div className="kiosk-glyph muted">◷</div>
        <div className="kiosk-h serif">{t('app.expired.h')}</div>
        <div className="kiosk-sub">{t('app.expired.s')}</div>
      </div>
    );
  }
  // §40: processing
  return (
    <div className="kiosk-status" role="status" aria-live="polite">
      <div className="kiosk-spinner" />
      <div className="kiosk-h serif">{t('pay.processing.h')}</div>
      <div className="kiosk-sub">{t(method === 'cash' ? 'pay.processing.cash' : 'pay.processing.card', { amount: usd(s.totals.totalDueCents) })}</div>
    </div>
  );
}

/** §97: what happened to the receipt, in the customer's words (the destination is already masked by the server). */
export function receiptLine(r: CustomerDisplayReceipt | undefined, lang = 'en'): string | null {
  if (!r || r.status === 'choose') return null;
  const to = r.destination ? translate(lang, 'rc.to', { dest: r.destination }) : '';
  if (r.status === 'skipped' || r.channel === 'none') return translate(lang, 'rc.none');
  if (r.status === 'sending') return translate(lang, r.channel === 'sms' ? 'rc.texting' : 'rc.emailing', { to });
  if (r.status === 'sent') return translate(lang, r.channel === 'sms' ? 'rc.texted' : 'rc.emailed', { to });
  return translate(lang, 'rc.failed');
}

/** §97–§98: the receipt choice, between payment and the 3-second screen. Masked destinations only; no typing. */
export function ReceiptCard({ s, a }: { s: CustomerDisplayState; a: Pick<CheckoutActions, 'submitting' | 'actionError' | 'onReceipt' | 'onClearError'> }) {
  const t = useT();
  const r = s.receipt;
  if (!r || r.status !== 'choose') return null;
  const to = (d?: string) => (d ? t('rc.to', { dest: d }) : '');
  const label = (c: DisplayReceiptChannel, d?: string) => (c === 'sms' ? t('rc.text', { to: to(d) }) : c === 'email' ? t('rc.email', { to: to(d) }) : t('rc.noReceipt'));
  const auto = r.automatic === 'none' ? null : r.options.find((o) => o.channel === r.automatic);
  return (
    <div className="kiosk-status kiosk-receipt" data-testid="receipt-choice">
      <div className="kiosk-glyph ok">✓</div>
      <div className="kiosk-done">{t('rc.complete')}</div>
      <div className="kiosk-h serif">{t('rc.how')}</div>
      <div className="kiosk-receipt-opts" role="group" aria-label={t('rc.aria')}>
        {r.options.map((o) => (
          <button key={o.channel} type="button" className={`kiosk-receipt-opt ${o.channel === 'none' ? 'none' : ''}`} disabled={a.submitting} onClick={() => a.onReceipt?.(o.channel)}>
            {label(o.channel, o.destination)}
          </button>
        ))}
      </div>
      {auto ? <div className="kiosk-receipt-auto">{t(auto.channel === 'sms' ? 'rc.autoText' : 'rc.autoEmail', { to: to(auto.destination) })}</div> : null}
      {a.actionError && <div className="kiosk-err" onClick={a.onClearError}>{a.actionError}</div>}
    </div>
  );
}

/** §44: keep it simple — payment complete, thank you, what was paid, the points earned, and (optionally) a rating. */
export function SuccessCard({ s, a }: { s: CustomerDisplayState; a: Pick<CheckoutActions, 'rated' | 'submitting' | 'onRate'> }) {
  const t = useT();
  const name = s.customer?.firstName;
  const total = s.checkout?.totalCents ?? s.totals.totalDueCents;
  const points = s.checkout?.loyaltyPointsEarned;
  const receipt = receiptLine(s.receipt, t.lang);
  return (
    <div className="kiosk-status" role="status" aria-live="polite">
      <div className="kiosk-glyph ok">✓</div>
      <div className="kiosk-done">{t('rc.complete')}</div>
      <div className="kiosk-h serif">{t('done.thanks', { who: name ? `, ${name}` : '' })}</div>
      <div className="kiosk-paid"><span>{t('ck.totalPaid')}</span><span className="serif">{usd(total)}</span></div>
      {points && points > 0 ? <div className="kiosk-points">{t('done.points', { n: points.toLocaleString(t.locale) })}</div> : null}
      {receipt ? <div className="kiosk-receipt-done" data-testid="receipt-result">{receipt}</div> : null}
      {a.rated == null ? (
        <div className="kiosk-rate">
          <div className="kiosk-rate-q">{t('done.rateQ')}</div>
          <div className="kiosk-rate-stars" role="group" aria-label={t('done.rateAria')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className="kiosk-star" disabled={a.submitting} aria-label={t(n === 1 ? 'done.star' : 'done.stars', { n })} onClick={() => a.onRate(n)}>★</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="kiosk-rate-thanks">{t('done.rated')}</div>
      )}
    </div>
  );
}

/**
 * The 23-inch right panel while a customer owns it (every mode except 'ads'). Rendered INSTEAD of the advertising —
 * never on top of it — and destroyed when the checkout ends (§46: clear, do not merely cover).
 */
export function CheckoutPanel({ s, a }: { s: CustomerDisplayState; a: CheckoutActions }) {
  const mode = rightPanelMode(s);
  return (
    <div className={`d23-checkout d23-checkout-${mode}`} data-testid="checkout-panel" data-mode={mode}>
      {mode === 'checkout' ? (<><TicketView s={s} /><TipAndPay s={s} a={a} /></>) : null}
      {mode === 'payment' ? (<><TicketView s={s} /><section className="d23-pay-status"><StatusCard s={s} /></section></>) : null}
      {mode === 'receipt' ? <section className="d23-center"><ReceiptCard s={s} a={a} /></section> : null}
      {mode === 'completed' ? <section className="d23-center"><SuccessCard s={s} a={a} /></section> : null}
      {mode === 'message' ? <section className="d23-center"><StatusCard s={s} /></section> : null}
    </div>
  );
}
