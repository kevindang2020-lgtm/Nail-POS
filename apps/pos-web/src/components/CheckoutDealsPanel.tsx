// CheckoutDealsPanel.tsx — BUILD_PLAN Phase 5: deals and coupons at the register.
//
// What is on the ticket (itemized — a manual discount is a manual discount, never a fake "DISCOUNT" coupon: bug 14),
// what else this customer could have with its value on THIS ticket, what they can't have and WHY, the best combination
// under the salon's stacking policy ("Apply best deal"), and the coupon field. Everything is decided by the server (the
// deals engine): this screen never computes a discount. A refusal shows the server's reasons — including a missing
// permission, which the old auto-apply swallowed so the customer silently paid full price (bug 2).
import { useCallback, useEffect, useState } from 'react';
import { posCheckoutApi, type TicketOffers, type OfferSummary } from '../api/posCheckoutApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { dealReasonText, dealReasonsLine } from '../i18n/deal-reason-text';

const money = (c: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// the category is a code; its words come from ns/payment at render (WP-D2)
const CATEGORY_KEY: Record<string, string> = { deal: 'payment.discount.deal', coupon: 'payment.discount.coupon', manual: 'payment.discount.manual', membership: 'payment.discount.membership', loyalty: 'payment.discount.loyalty', bundle: 'payment.discount.bundle' };
// V-5: each reason is worded from its code + params in the cashier's language (English keeps the server's sentence)
const errText = (e: any): string => dealReasonsLine(e?.body?.reasons, String(e?.message ?? t('pos.not_applied')));
const terms = (o: OfferSummary) => (o.discountType === 'percent' ? t('pos.discountpercent_off', { discountPercent: String(o.discountPercent) }) : o.discountType === 'fixed_price' ? t('pos.for_v0', { v0: String(money(o.discountCents ?? 0)) }) : t('pos.v0_off', { v0: String(money(o.discountCents ?? 0)) }));

export interface DiscountItem { category: string; label: string; amountCents: number; dealId: string | null; redemptionId: string | null }

export function CheckoutDealsPanel({ ticketId, isPaid, discounts, onChanged, onNote, onClearManual }: {
  ticketId: string; isPaid: boolean; discounts: DiscountItem[]; onChanged: () => Promise<unknown> | void; onNote: (m: string) => void; onClearManual?: () => void;
}) {
  const [offers, setOffers] = useState<TicketOffers | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [why, setWhy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setOffers(await posCheckoutApi.offers(ticketId)); }
    catch (e: any) { setOffers(null); if (e?.status !== 403) setError(errText(e)); }
  }, [ticketId]);
  // re-read the offers whenever what is on the ticket changes (count or amount)
  const discountKey = `${discounts.length}:${discounts.reduce((n, d) => n + d.amountCents, 0)}`;
  useEffect(() => { void load(); }, [load, discountKey]);

  const act = async (key: string, fn: () => Promise<any>, done: (r: any) => string) => {
    setBusy(key); setError(null);
    try { const r = await fn(); onNote(done(r)); await onChanged(); await load(); }
    catch (e: any) { setError(e?.status === 403 ? t('pos.you_don_t_have_permission_to_1fpk') : errText(e)); }
    finally { setBusy(null); }
  };
  const apply = (o: OfferSummary) => act('apply:' + o.dealId, () => posCheckoutApi.applyOffer(ticketId, o.couponId ? { couponId: o.couponId } : { dealId: o.dealId }),
    (r) => t('pos.title_applied_v1', { title: String(o.title), v1: String(r?.replaced ? t('pos.it_replaced_a_smaller_offer') : '') }));
  const remove = (d: DiscountItem) => d.redemptionId && act('rm:' + d.redemptionId, () => posCheckoutApi.removeOffer(ticketId, d.redemptionId!), () => t('pos.label_removed', { label: String(d.label) }));
  const best = () => act('best', () => posCheckoutApi.applyBestOffers(ticketId), (r) => (r?.applied?.length ? t('pos.best_deal_applied') : t('pos.this_ticket_already_has_the_best_4x1z')));
  const applyCode = () => { const c = code.trim(); if (!c) return; act('code', () => posCheckoutApi.applyOffer(ticketId, { code: c }), () => { setCode(''); return t('pos.coupon_applied'); }); };

  if (offers && !offers.available && !discounts.length) return null;
  return (
    <div data-testid="checkout-deals" className="mt-2 rounded-lg border border-[var(--line)] p-2.5" style={{ fontSize: 12 }}>
      {discounts.length ? (
        <ul data-testid="applied-discounts" className="m-0 p-0" style={{ listStyle: 'none' }}>
          {discounts.map((d, i) => (
            <li key={(d.redemptionId ?? d.category) + i} className="flex items-center justify-between py-0.5">
              <span><b>{CATEGORY_KEY[d.category] ? t(CATEGORY_KEY[d.category]) : d.category}</b> · {d.label.replace(/^(Deal|Coupon): /, '')}</span>
              <span className="flex items-center gap-1.5">
                <span style={{ color: '#2E9E54', fontWeight: 700 }}>−{money(d.amountCents)}</span>
                {!isPaid && (d.category === 'deal' || d.category === 'coupon') && d.redemptionId ? (
                  <button aria-label={t('pos.remove_label', { label: String(d.label) })} disabled={!!busy} onClick={() => void remove(d)} className="border-none bg-transparent cursor-pointer font-extrabold" style={{ color: '#2E9E54' }}>×</button>
                ) : null}
                {!isPaid && d.category === 'manual' && onClearManual ? (
                  <button aria-label={t('pos.clear_manual_discount')} disabled={!!busy} onClick={onClearManual} className="border-none bg-transparent cursor-pointer font-extrabold" style={{ color: '#2E9E54' }}>×</button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {!isPaid && offers?.available ? (
        <>
          {offers.best?.better ? (
            <button data-testid="best-deal" disabled={!!busy} onClick={() => void best()} className="mt-1.5 w-full rounded-md border-none cursor-pointer font-bold py-1.5" style={{ background: '#2E9E54', color: '#fff' }}>
              {t('pos.apply_best_deal_saves')}{' '}{money(offers.best.savingsCents)}{offers.best.currentCents ? t('pos.now_currentcents', { currentCents: String(money(offers.best.currentCents)) }) : ''}
            </button>
          ) : null}
          {offers.eligible.length ? (
            <div className="mt-1.5" data-testid="eligible-offers">
              <div className="font-bold text-[var(--muted)]">{t('pos.can_use')}</div>
              {offers.eligible.map((o) => (
                <div key={o.dealId + (o.couponId ?? '')} className="flex items-center justify-between py-0.5">
                  <span>{o.booked ? t('pos.booked_2') : o.couponId ? '🎟 ' : ''}{o.title} <span className="text-[var(--muted)]">({terms(o)}{o.codeHint ? ` · …${o.codeHint}` : ''})</span></span>
                  <button disabled={!!busy} onClick={() => void apply(o)} className="rounded border border-[var(--line)] bg-transparent cursor-pointer px-2 py-0.5">{t('pos.apply')}{money(o.estimatedCents)}</button>
                </div>
              ))}
            </div>
          ) : null}
          {offers.notEligible.length ? (
            <div className="mt-1.5" data-testid="not-eligible-offers">
              <div className="font-bold text-[var(--muted)]">{t('pos.not_for_this_ticket')}</div>
              {offers.notEligible.map((o) => (
                <div key={o.dealId + (o.couponId ?? '')}>
                  <button className="border-none bg-transparent cursor-pointer p-0 text-left" style={{ color: 'var(--soft)' }} onClick={() => setWhy(why === o.dealId ? null : o.dealId)} aria-expanded={why === o.dealId}>
                    {o.title} {t('pos.why_not')}
                  </button>
                  {why === o.dealId ? <ul data-testid={'why-' + o.dealId} className="my-0.5 pl-4">{o.reasons.map((r) => <li key={r.code}>{dealReasonText(r)}</li>)}</ul> : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex gap-1.5 mt-1.5">
            <input aria-label={t('pos.deal_or_coupon_code')} value={code} placeholder={t('pos.coupon_code_or_qr')} onChange={(e) => setCode(e.target.value)} className="flex-1 rounded border border-[var(--line)] px-2 py-1" />
            <button disabled={busy === 'code' || !code.trim()} onClick={applyCode} className="rounded border border-[var(--line)] bg-transparent cursor-pointer px-2">{t('pos.apply_code')}</button>
          </div>
        </>
      ) : null}
      {error ? <div role="alert" data-testid="deals-error" className="mt-1.5" style={{ color: '#B42318' }}>{error}</div> : null}
    </div>
  );
}
