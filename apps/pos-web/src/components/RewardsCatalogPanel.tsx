// RewardsCatalogPanel.tsx — Functional Decision 15, loyalty step: the salon's rewards catalog. Owners and managers add,
// edit and archive rewards; everyone else sees the list. Before Oct 2 2026 nothing could create a reward, and a reward
// had no value — a customer who spent points got a code that took nothing off. Every reward is now an amount off or a
// percent off; the server checks the same rules (normalizeRewardInput) and its message is shown as-is.
import { useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/money';
import { posLoyaltyApi, type LoyaltyRewardRow, type RewardType } from '../api/posLoyaltyApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { errorTextOf } from '../i18n/error-text';

const money = (c: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const rewardValueLabel = (r: Pick<LoyaltyRewardRow, 'rewardType' | 'valueCents' | 'percent'>) =>
  r.rewardType === 'percent_off' ? t('pos.v0_off_2', { v0: String(r.percent ?? 0) }) : (r.valueCents ?? 0) > 0 ? t('pos.v0_off', { v0: String(money(r.valueCents ?? 0)) }) : t('pos.no_value_set');
const errText = (e: any) => errorTextOf(e, t('pos.could_not_save'));   // §22

type Draft = { title: string; pointsCost: string; rewardType: RewardType; amount: string; percent: string; validDays: string };
const empty: Draft = { title: '', pointsCost: '', rewardType: 'amount_off', amount: '', percent: '', validDays: '' };
const toDraft = (r: LoyaltyRewardRow): Draft => ({ title: r.title, pointsCost: String(r.pointsCost), rewardType: r.rewardType ?? 'amount_off',
  amount: r.valueCents ? (r.valueCents / 100).toFixed(2) : '', percent: r.percent ? String(r.percent) : '', validDays: r.validDays ? String(r.validDays) : '' });

export function RewardsCatalogPanel({ rewards, canManage, onChanged }: { rewards: LoyaltyRewardRow[]; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [d, setD] = useState<Draft>(empty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (r?: LoyaltyRewardRow) => { setError(null); setD(r ? toDraft(r) : empty); setEditing(r ? r.id : 'new'); };
  const save = async () => {
    setError(null);
    const pointsCost = Number(d.pointsCost);
    const valueCents = d.rewardType === 'amount_off' ? parseDollarsToCents(d.amount) : 0;
    const percent = d.rewardType === 'percent_off' ? Number(d.percent) : 0;
    if (d.rewardType === 'amount_off' && valueCents === null) { setError(t('pos.enter_the_amount_in_dollars_and_o3e2')); return; }
    const body = { title: d.title, pointsCost, rewardType: d.rewardType, valueCents: valueCents ?? 0, percent, validDays: d.validDays.trim() ? Number(d.validDays) : null };
    setBusy(true);
    try { if (editing === 'new') await posLoyaltyApi.createReward(body); else if (editing) await posLoyaltyApi.updateReward(editing, body); setEditing(null); onChanged(); }
    catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  };
  const setActive = async (r: LoyaltyRewardRow, active: boolean) => {
    setError(null);
    try { await posLoyaltyApi.updateReward(r.id, { active }); onChanged(); } catch (e) { setError(errText(e)); }
  };

  return (
    <section className="panel">
      <div className="p-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{t('pos.rewards_catalog')}</span>
        {canManage && editing === null && <button className="btn ghost" onClick={() => open()}>{t('pos.add_reward')}</button>}
      </div>
      {editing !== null && (
        <div role="form" aria-label={editing === 'new' ? t('pos.new_reward') : t('pos.edit_reward')} style={{ display: 'grid', gap: 8, padding: '8px 0 12px' }}>
          <label className="s">{t('pos.name')}<input aria-label={t('pos.reward_name')} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder={t('pos.e_g_10_off_any_service')} style={{ display: 'block', width: '100%' }} /></label>
          <label className="s">{t('pos.points_it_costs')}<input aria-label={t('pos.points_cost')} inputMode="numeric" value={d.pointsCost} onChange={(e) => setD({ ...d, pointsCost: e.target.value })} style={{ display: 'block', width: '100%' }} /></label>
          <div className="s" role="radiogroup" aria-label={t('pos.reward_type')}>
            <label style={{ marginRight: 12 }}><input type="radio" name="rtype" checked={d.rewardType === 'amount_off'} onChange={() => setD({ ...d, rewardType: 'amount_off' })} /> {t('pos.amount_off')}</label>
            <label><input type="radio" name="rtype" checked={d.rewardType === 'percent_off'} onChange={() => setD({ ...d, rewardType: 'percent_off' })} /> {t('pos.percent_off')}</label>
          </div>
          {d.rewardType === 'amount_off'
            ? <label className="s">{t('pos.amount_off_2')}<input aria-label={t('pos.dollars_off')} inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} style={{ display: 'block', width: '100%' }} /></label>
            : <label className="s">{t('pos.percent_off')}<input aria-label={t('pos.percent_value')} inputMode="numeric" value={d.percent} onChange={(e) => setD({ ...d, percent: e.target.value })} style={{ display: 'block', width: '100%' }} /></label>}
          <label className="s">{t('pos.code_valid_for_days_blank_no_1neq')}<input aria-label={t('pos.valid_days')} inputMode="numeric" value={d.validDays} onChange={(e) => setD({ ...d, validDays: e.target.value })} style={{ display: 'block', width: '100%' }} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={busy} onClick={save}>{busy ? t('pos.saving_2') : t('pos.save_reward')}</button>
            <button className="btn ghost" onClick={() => setEditing(null)}>{t('pos.cancel')}</button>
          </div>
          <div className="s muted">{t('pos.codes_customers_already_hold_keep_the_moqy')}</div>
        </div>
      )}
      {error && <div className="err" style={{ margin: '6px 0' }}>{error}</div>}
      {rewards.length === 0 ? <div className="state">{t('pos.no_rewards_yet')}{canManage ? t('pos.add_one_so_customers_can_spend_fu2m') : ''}</div> : (
        <div className="overflow-x-auto">
          <div className="min-w-[460px]">
            <table className="tbl">
              <thead><tr><th>{t('pos.reward')}</th><th>{t('pos.value')}</th><th style={{ textAlign: 'right' }}>{t('pos.points_2')}</th><th>{t('pos.status')}</th>{canManage && <th />}</tr></thead>
              <tbody>{rewards.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td><td>{rewardValueLabel(r)}</td><td style={{ textAlign: 'right' }}>{(r.pointsCost || 0).toLocaleString('en-US')}</td>
                  <td style={{ fontWeight: 700, color: r.active ? 'var(--ok)' : 'var(--muted)' }}>{r.active ? t('pos.active_3') : t('pos.archived_2')}</td>
                  {canManage && <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost" onClick={() => open(r)}>{t('pos.edit')}</button>
                    {r.active ? <button className="btn ghost" onClick={() => setActive(r, false)}>{t('pos.archive')}</button> : <button className="btn ghost" onClick={() => setActive(r, true)}>{t('pos.restore')}</button>}
                  </td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
