// AICheckoutUpsellPanel.tsx — embeddable in-checkout recommendation panel. Shows ranked, transparent recommendation
// cards (price, tax behavior, added time, stock, reason, confidence). NOTHING is added automatically: Approve requires an
// explicit second confirmation tap ("Add $X?") before the charge-producing call, which returns authoritative totals.
// Honest states: loading, error, disabled (kill switch), frozen (payment in progress), and empty. Dismiss suppresses a
// card for this checkout. The panel never computes a price and never touches payment.
import { useCallback, useEffect, useState } from 'react';
import { posAiCheckoutUpsellApi as apiU } from '../api/posAiCheckoutUpsellApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const GOLD = 'var(--aps-orange,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';
const money = (c: number | null) => (c == null ? null : `$${(c / 100).toFixed(2)}`);

const CONF: Record<string, string> = { high: GOLD, medium: '#8a6d3b', low: MUTED };
const STOCK_LABEL: Record<string, string> = { get in_stock() { return t('growth.upsell.stock.inStock'); }, get low_stock() { return t('growth.upsell.stock.low'); }, get out_of_stock() { return t('growth.upsell.stock.out'); }, not_tracked: '' };

/** Checkout Upsell 09: record checks are a DIFFERENT workflow from suggestions — a service asked for but not on the
 *  ticket may have been done and not recorded. Shown apart, with no price and no Add button; a person resolves it. */
function RecordChecks({ checks }: { checks: { serviceId: string | null; serviceName: string }[] }) {
  if (!checks.length) return null;
  return (
    <div role="region" aria-label={t('ucx.rc.region')} data-testid="ucx-record-checks" style={{ border: '1px solid #c9a227', background: '#fff8e6', borderRadius: 10, padding: 12, margin: '4px 8px 10px' }}>
      <div style={{ fontWeight: 700, color: '#7a5a00' }}>{t('ucx.rc.title')}</div>
      <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{t('ucx.rc.lead')}</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
        {checks.map((c) => <li key={(c.serviceId ?? '') + ':' + c.serviceName}>{t('ucx.rc.item', { name: c.serviceName })}</li>)}
      </ul>
    </div>
  );
}

export function AICheckoutUpsellPanel({ checkoutId, onCartChanged }: { checkoutId: string; onCartChanged?: (totals: any) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null); // targetId awaiting explicit confirmation
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await apiU.recommendations(checkoutId)); }
    catch { setError(t('pos.could_not_load_suggestions')); }
    finally { setLoading(false); }
  }, [checkoutId]);
  useEffect(() => { load(); }, [load]);

  const mutate = useCallback(async (card: any) => {
    setBusy(card.targetId); setActionErr(null);
    try {
      let res: any;
      if (card.type === 'service_addon') res = await apiU.addAddon(checkoutId, card.targetId);
      else if (card.type === 'membership') res = await apiU.enrollMembership(checkoutId, card.targetId);
      else if (card.type === 'loyalty_redemption') res = await apiU.redeemLoyalty(checkoutId, card.targetId);
      else if (card.type === 'promotion') res = await apiU.applyPromotion(checkoutId, card.targetId);
      else if (card.type === 'next_appointment') res = await apiU.nextAppointment(checkoutId, card.targetId);
      else return; // gift_card / loyalty_enrollment handled by their own flows
      if (res?.totals) onCartChanged?.(res.totals);
      setConfirming(null);
      await load();
    } catch (e: any) {
      const code = String(e?.message || '');
      // Decision 27: the server refuses an add-on that would run into the technician's next appointment.
      setActionErr(/SCHEDULE_CONFLICT/.test(code) ? t('pos.that_add_on_would_run_into_v2up') : /EDITABLE|IDEMPOTENCY|ELIGIBLE|INSUFFICIENT|DUPLICATE|STOCK|EXPIRED/.test(code) ? t('pos.that_suggestion_is_no_longer_available_zosd') : t('pos.could_not_complete_that_action'));
      await load();
    } finally { setBusy(null); }
  }, [checkoutId, load, onCartChanged]);

  const dismiss = useCallback(async (card: any) => {
    setData((d: any) => ({ ...d, cards: (d?.cards || []).filter((c: any) => c.targetId !== card.targetId) }));
    try { await apiU.dismiss(checkoutId, card.targetId, 'not_relevant'); } catch { /* optimistic */ }
  }, [checkoutId]);

  if (loading) return <div style={{ padding: 12, color: MUTED }}>{t('pos.loading_suggestions')}</div>;
  if (error) return <div style={{ padding: 12, color: '#a12d2d' }}>{error} <button className="seg-btn" onClick={load}>{t('pos.retry')}</button></div>;
  if (!data?.enabled) return null; // kill switch: show nothing, never a broken panel
  const checks = Array.isArray(data.recordChecks) ? data.recordChecks : [];
  if (data.frozen) return <><RecordChecks checks={checks} /><div style={{ padding: 12, color: MUTED, fontSize: 13 }}>{t('pos.suggestions_are_paused_while_payment_is_lnvw')}</div></>;
  if (!data.cards?.length) return <><RecordChecks checks={checks} /><div style={{ padding: 12, color: MUTED, fontSize: 13 }}>{t('pos.no_suggestions_for_this_checkout')}</div></>;

  return (
    <div style={{ padding: 4 }} role="region" aria-label={t('pos.checkout_suggestions')}>
      <RecordChecks checks={checks} />
      <div style={{ fontFamily: 'Playfair Display, serif', color: GOLD, fontSize: 16, margin: '4px 8px 8px' }}>{t('pos.suggestions')}</div>
      {actionErr && <div style={{ margin: '0 8px 8px', color: '#a12d2d', fontSize: 13 }}>{actionErr}</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {data.cards.map((c: any) => {
          const isConfirming = confirming === c.targetId;
          const price = money(c.priceCents);
          const stock = c.inventoryStatus ? STOCK_LABEL[c.inventoryStatus] : '';
          return (
            <li key={`${c.type}:${c.targetId}`} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, margin: '0 8px 8px', background: '#fff' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{c.title}</div>
                {price && <div style={{ color: GOLD, fontWeight: 700 }}>{price}</div>}
              </div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                {c.reason}
                {c.addedDurationMinutes ? t('pos.addeddurationminutes_min', { addedDurationMinutes: String(c.addedDurationMinutes) }) : ''}
                {c.taxBehavior === 'taxable' ? t('pos.taxable_2') : c.taxBehavior === 'not_taxed' ? t('pos.not_taxed') : ''}
                {stock ? ` · ${stock}` : ''}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 11, color: CONF[c.confidence] || MUTED, fontWeight: 600, textTransform: 'uppercase' }}>{c.confidence}</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {!isConfirming ? (
                    <>
                      <button className="seg-btn" aria-label={t('pos.dismiss_suggestion_title', { title: String(c.title) })} onClick={() => dismiss(c)} disabled={busy === c.targetId}>{t('pos.dismiss')}</button>
                      <button className="seg-btn" style={{ background: GOLD, color: '#fff', border: 'none' }} disabled={!c.eligible || busy === c.targetId} aria-label={`${c.type === 'next_appointment' ? t('growth.upsell.book') : t('growth.upsell.add')}: ${c.title}${price ? ', ' + price : ''}`} onClick={() => setConfirming(c.targetId)}>
                        {c.type === 'next_appointment' ? t('pos.book') : t('pos.add')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="seg-btn" aria-label={t('pos.cancel')} onClick={() => setConfirming(null)} disabled={busy === c.targetId}>{t('pos.cancel')}</button>
                      <button className="seg-btn" style={{ background: GOLD, color: '#fff', border: 'none' }} aria-label={t('pos.confirm_title_v1', { title: String(c.title), v1: String(price ? ', ' + price : '') })} disabled={busy === c.targetId} onClick={() => mutate(c)}>
                        {busy === c.targetId ? t('pos.adding') : price ? t('pos.confirm_price', { price: String(price) }) : t('growth.upsell.confirm')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div style={{ fontSize: 11, color: MUTED, margin: '2px 8px 6px' }}>{t('pos.final_price_tax_and_discounts_are_9544')}</div>
    </div>
  );
}
