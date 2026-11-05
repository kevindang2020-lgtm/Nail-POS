// CheckoutTicket.tsx — 23-inch dual-screen spec §30–§33, §91–§95: the customer's live checkout ticket.
//
// Renders ONLY the server's customer-safe projection (CustomerDisplayCheckout) — every number is the checkout module's;
// nothing here adds, subtracts or rounds money (§35, §38). Layout rule (§93–§95): the line list is a bounded region that
// scrolls internally on an unusually long ticket, while the totals and TOTAL DUE stay pinned and always visible — the
// page itself never scrolls. Reused by the 23-inch right panel.
import type { CustomerDisplayCheckout, CustomerDisplayLine } from '@aipowersalon/api-contracts/customer';
import { usd } from './types';
import { useT } from './i18n';

function when(iso: string, locale = 'en-US'): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Line({ l }: { l: CustomerDisplayLine }) {
  const t = useT();
  const qty = l.kind === 'product' || l.quantity > 1 ? ` ×${l.quantity}` : '';
  return (
    <li className={`ck-line ck-${l.kind}`}>
      <div className="ck-line-main">
        <span className="ck-line-name">{l.kind === 'add_on' ? '+ ' : ''}{l.name}{qty}</span>
        {l.technicianName ? <span className="ck-line-tech">{t('ci.with', { name: l.technicianName })}</span> : null}
      </div>
      <div className="ck-line-amt">
        {l.originalCents != null ? <s className="ck-was" aria-label={t('ck.was', { amount: usd(l.originalCents) })}>{usd(l.originalCents)}</s> : null}
        <span>{usd(l.amountCents)}</span>
      </div>
    </li>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'save' | 'paid' }) {
  return <div className={`ck-row${tone ? ' ck-' + tone : ''}`}><span>{label}</span><span>{value}</span></div>;
}

export function CheckoutTicket({ c, firstName }: { c: CustomerDisplayCheckout; firstName?: string }) {
  const t = useT();
  const paid = c.paymentStatus === 'paid';
  const date = when(c.date, t.locale);
  const partly = !paid && c.paidCents > 0;
  return (
    <section className="kiosk-ticket ck" aria-label={t('d23.yourCheckout')}>
      <header className="ck-head">
        <div className="kiosk-hi serif">{firstName ? t('ck.hi', { name: firstName }) : t('ck.hello')}</div>
        <div className="ck-intro">{t('ck.review')}</div>
        <div className="kiosk-order">{t('ck.order', { n: c.ticketNumber })}{date ? ` · ${date}` : ''}</div>
      </header>

      <ul className="ck-lines" aria-label={t('ck.completedServices')}>
        {c.lines.map((l, i) => <Line key={i} l={l} />)}
      </ul>

      <div className="ck-totals">
        <Row label={t('ck.subtotal')} value={usd(c.itemsSubtotalCents)} />
        {c.adjustments.map((a, i) => <Row key={i} label={a.label} value={'−' + usd(a.amountCents)} tone="save" />)}
        {c.giftCardSaleCents > 0 ? <Row label={t('ck.giftCardPurchase')} value={usd(c.giftCardSaleCents)} /> : null}
        <Row label={t('ck.tax')} value={usd(c.taxCents)} />
        {c.customerFeeCents > 0 ? <Row label={c.customerFeeLabel || t('ck.cardSurcharge')} value={usd(c.customerFeeCents)} /> : null}
        {c.tipCents > 0 ? <Row label={t('ck.tip')} value={usd(c.tipCents)} /> : null}
        {partly ? c.payments.map((p, i) => <Row key={i} label={t('ck.paidVia', { label: p.label })} value={'−' + usd(p.amountCents)} tone="paid" />) : null}
        <div className="ck-due" role="status" aria-live="polite">
          <span>{paid ? t('ck.totalPaid') : partly ? t('ck.balanceDue') : t('ck.totalDue')}</span>
          <span className="ck-due-amt serif">{usd(paid ? c.totalCents : partly ? c.balanceDueCents : c.totalCents)}</span>
        </div>
      </div>
    </section>
  );
}
