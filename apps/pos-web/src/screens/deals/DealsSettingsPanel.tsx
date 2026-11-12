// DealsSettingsPanel.tsx — BUILD_PLAN Phase 5: how offers combine at this salon (the stacking policy the pricing engine
// applies), the price floor, whether deals may sit on a member discount or a loyalty reward, editing after use, the
// salon's own switch — and the technician-deal policy. The platform's switch and the plan's live-deal limit are shown,
// not editable here (bug 19: half of these columns existed and nothing read them).
import { useState } from 'react';
import { posDealsApi, type DealSettings } from '../../api/posDealsApi';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';

const POLICIES = (): [string, string][] => [
  ['best_single', t('growth.deals.policy.best_single')],
  ['stack_all', t('growth.deals.policy.stack_all')],
  ['stack_groups', t('growth.deals.policy.stack_groups')],
  ['exclusive', t('growth.deals.policy.exclusive')],
];

export function DealsSettingsPanel({ settings, onSaved }: { settings: DealSettings; onSaved: (s: DealSettings) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const save = async (patch: Partial<DealSettings>) => {
    setBusy(true); setNote(null);
    try { onSaved(await posDealsApi.updateSettings(patch) as DealSettings); setNote(t('pos.saved_2')); } catch (e: any) { setNote(e?.message || t('pos.could_not_save_2')); } finally { setBusy(false); }
  };
  const s: any = settings;
  return (
    <section className="panel" data-testid="deals-settings">
      <div className="p-h">{t('pos.deal_settings')}</div>
      {s.platformDisabled && <div role="status" style={{ background: '#FDECEA', padding: 8, borderRadius: 8, fontSize: 13 }}>{t('pos.deals_are_switched_off_for_this_1ttq')}{' '}{s.platformDisabledReason || t('pos.by_the_platform')}.</div>}
      {s.platformMaxActiveDeals != null && <div className="sub" style={{ fontSize: 12 }}>{t('pos.your_plan_allows')}{' '}{s.platformMaxActiveDeals} {t('pos.live_deal')}{enPlural(s.platformMaxActiveDeals === 1 ? '' : 's')} {t('pos.at_a_time')}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
        <label style={{ fontSize: 13 }}><input type="checkbox" aria-label={t('pos.deals_on')} checked={s.dealsEnabled !== false} disabled={busy} onChange={(e) => void save({ dealsEnabled: e.target.checked } as any)} /> {t('pos.deals_are_on_at_this_salon')}</label>
        <div className="lf md:col-span-2"><label>{t('pos.how_offers_combine')}</label>
          <select aria-label={t('pos.stacking_policy')} value={s.stackingPolicy ?? 'best_single'} disabled={busy} onChange={(e) => void save({ stackingPolicy: e.target.value } as any)} style={{ width: '100%' }}>
            {POLICIES().map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <label style={{ fontSize: 13 }}><input type="checkbox" aria-label={t('pos.with_member_discount')} checked={!!s.allowStackMembership} disabled={busy} onChange={(e) => void save({ allowStackMembership: e.target.checked } as any)} /> {t('pos.a_deal_may_combine_with_a_1y5h')}</label>
        <label style={{ fontSize: 13 }}><input type="checkbox" aria-label={t('pos.with_loyalty_reward')} checked={s.allowStackLoyalty !== false} disabled={busy} onChange={(e) => void save({ allowStackLoyalty: e.target.checked } as any)} /> {t('pos.a_deal_may_combine_with_a_11dm')}</label>
        <div className="lf"><label>{t('pos.price_floor_the_customer_always_pays')}</label><input aria-label={t('pos.price_floor')} defaultValue={s.priceFloorPercent ?? 0} inputMode="numeric" onBlur={(e) => void save({ priceFloorPercent: Number(e.target.value) || 0 } as any)} /></div>
        <div className="lf"><label>{t('pos.most_a_ticket_can_be_discounted')}</label><input aria-label={t('pos.max_total_discount')} defaultValue={s.maxTotalDiscountPercent ?? ''} placeholder={t('pos.no_cap')} inputMode="numeric" onBlur={(e) => void save({ maxTotalDiscountPercent: e.target.value === '' ? null : Number(e.target.value) } as any)} /></div>
        <label style={{ fontSize: 13 }}><input type="checkbox" aria-label={t('pos.editable_after_use')} checked={!!s.editableAfterRedemption} disabled={busy} onChange={(e) => void save({ editableAfterRedemption: e.target.checked } as any)} /> {t('pos.allow_changing_a_deal_s_terms_10u7')}</label>
        <div className="lf"><label>{t('pos.technician_deals')}</label>
          <select aria-label={t('pos.technician_deals')} value={s.allowTechnicianDeals} disabled={busy} onChange={(e) => void save({ allowTechnicianDeals: e.target.value as any })}>
            <option value="off">{t('pos.off')}</option><option value="on_with_approval">{t('pos.on_manager_approval_required')}</option><option value="on_auto">{t('pos.on_live_at_once_within_limits')}</option>
          </select>
        </div>
        <div className="lf"><label>{t('pos.technician_max_discount')}</label><input aria-label={t('pos.technician_max_discount_2')} defaultValue={s.maxDiscountPercent ?? ''} placeholder={t('pos.no_cap')} inputMode="numeric" onBlur={(e) => void save({ maxDiscountPercent: e.target.value === '' ? null : Math.round(Number(e.target.value)) })} /></div>
        <label style={{ fontSize: 13 }}><input type="checkbox" aria-label={t('pos.new_customer_deals_allowed')} checked={s.allowedNewCustomer !== false} disabled={busy} onChange={(e) => void save({ allowedNewCustomer: e.target.checked })} /> {t('pos.deals_for_new_customers')}</label>
        <label style={{ fontSize: 13 }}><input type="checkbox" aria-label={t('pos.returning_customer_deals_allowed')} checked={s.allowedExistingCustomer !== false} disabled={busy} onChange={(e) => void save({ allowedExistingCustomer: e.target.checked })} /> {t('pos.deals_for_returning_customers')}</label>
      </div>
      {note && <div className="sub" style={{ marginTop: 8, fontSize: 13 }}>{note}</div>}
      <StackingExplorer settings={s} />
    </section>
  );
}

/** Deals 10 — read-only: which offers combine on one ticket under the settings above. The rows are the SERVER's answer
 *  (the same stacking inspector Check Coupon uses, tested against the pricing engine) — nothing is re-derived here. */
export function StackingExplorer({ settings }: { settings: DealSettings }) {
  const x = settings.stackingExplained;
  const tone = (c: string) => (c === 'yes' ? 'ok' : c === 'no' ? 'warn' : '');
  const row = (r: { benefit: string; combines: string; reason: string; value?: number | null }, key: string) => (
    <tr key={key} data-testid={'stack-' + key}>
      <td>{t('cp.stk.b.' + r.benefit)}</td>
      <td><span className={'fk-chip ' + tone(r.combines)} data-testid="stack-verdict">{t('cp.stk.a.' + r.combines)}</span></td>
      <td style={{ fontSize: 12 }}>{t('cp.stk.r.' + r.benefit + '.' + r.reason, { v: r.value == null ? '—' : String(r.value) })}</td>
    </tr>);
  return (
    <div data-testid="stacking-explorer" style={{ marginTop: 12 }}>
      <div className="p-h">{t('do.stack.title')}</div>
      <div className="sub" style={{ fontSize: 12 }}>{t('do.stack.note')}</div>
      {!x ? <div className="sub" data-testid="stack-unavailable">—</div> : (
        <table className="fk-table" style={{ width: '100%', marginTop: 6 }}>
          <thead><tr><th>{t('do.stack.combination')}</th><th>{t('do.stack.result')}</th><th>{t('do.stack.why')}</th></tr></thead>
          <tbody>
            <tr><td colSpan={3} className="sub" style={{ fontSize: 12 }}>{t('do.stack.c')}</td></tr>
            {x.combinable.map((r) => row(r, r.benefit))}
            <tr><td colSpan={3} className="sub" style={{ fontSize: 12 }}>{t('do.stack.nc')}</td></tr>
            {x.notCombinable.map((r) => row(r, 'nc-' + r.benefit))}
          </tbody>
        </table>)}
    </div>
  );
}
