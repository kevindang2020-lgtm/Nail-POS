// DealsSettingsPanel.tsx — BUILD_PLAN Phase 5: how offers combine at this salon (the stacking policy the pricing engine
// applies), the price floor, whether deals may sit on a member discount or a loyalty reward, editing after use, the
// salon's own switch — and the technician-deal policy. The platform's switch and the plan's live-deal limit are shown,
// not editable here (bug 19: half of these columns existed and nothing read them).
import { useState } from 'react';
import { posDealsApi, type DealSettings } from '../../api/posDealsApi';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { stackingMatrix, stackingLimits, type StackingInputs } from './stackingExplorer';

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

const VERDICT_TONE: Record<string, string> = { allowed: 'ok', conditional: 'warn', blocked: 'bad' };

/** Deals 10 — read-only: which offer types combine on one ticket under the settings above (the pricing engine's rules). */
export function StackingExplorer({ settings }: { settings: StackingInputs }) {
  const rows = stackingMatrix(settings);
  const lim = stackingLimits(settings);
  return (
    <div data-testid="stacking-explorer" style={{ marginTop: 12 }}>
      <div className="p-h">{t('do.stack.title')}</div>
      <div className="sub" style={{ fontSize: 12 }}>{t('do.stack.note')}</div>
      <table className="fk-table" style={{ width: '100%', marginTop: 6 }}>
        <thead><tr><th>{t('do.stack.combination')}</th><th>{t('do.stack.result')}</th><th>{t('do.stack.why')}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.pair} data-testid={'stack-' + r.pair}>
            <td>{t('do.stack.pair.' + r.pair)}</td>
            <td><span className={'fk-chip ' + VERDICT_TONE[r.verdict]} data-testid="stack-verdict">{t('do.stack.verdict.' + r.verdict)}</span></td>
            <td style={{ fontSize: 12 }}>{t('do.stack.reason.' + r.reason)}</td>
          </tr>))}
        </tbody>
      </table>
      {lim.floorPercent != null || lim.maxPercent != null ? <div className="sub" style={{ fontSize: 12, marginTop: 4 }} data-testid="stack-limits">
        {lim.floorPercent != null ? t('do.stack.floor', { v: lim.floorPercent }) : null}{' '}{lim.maxPercent != null ? t('do.stack.max', { v: lim.maxPercent }) : null}</div> : null}
    </div>
  );
}
