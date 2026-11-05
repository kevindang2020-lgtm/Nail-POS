// POSAIPlansScreen.tsx — tenant storefront for the five AI plans (bundles of the 15 assistants). Each plan shows its
// full price struck through with the new (discounted) price Super Admin set, the assistants it unlocks, and a
// Start-trial action. Subscribing activates the plan's assistants through the same per-assistant access gate; paid
// activation runs through billing / Super Admin. Bound to /tenant/ai/plans. Money is integer cents.
import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { posAiApi, type PosAiPlan } from '../api/posAiApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

export function POSAIPlansScreen() {
  const nav = useNavigate();
  const [plans, setPlans] = useState<PosAiPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () => {
    posAiApi.plans().then((d) => { setPlans(d?.plans || []); setError(null); }).catch((e: any) => setError(e?.message || t('pos.failed_to_load_ai_plans')));
  };
  useEffect(load, []);

  const startTrial = (p: PosAiPlan) => {
    setBusy(p.code); setNote(null); setError(null);
    posAiApi.startPlanTrial(p.code)
      .then((r) => { setNote(t('pos.name_trial_started_v1', { name: String(p.name), v1: String(r?.activated ? t('pos.activated_assistant_plural_activated', { activated: String(r.activated), plural: String(r.activated === 1 ? '' : 's') }) : '') })); load(); })
      .catch((e: any) => setError(e?.message || t('pos.could_not_start_trial')))
      .finally(() => setBusy(null));
  };
  const cancel = (p: PosAiPlan) => {
    setBusy(p.code); setNote(null); setError(null);
    posAiApi.cancelPlan(p.code).then(() => { setNote(t('pos.name_cancelled', { name: String(p.name) })); load(); }).catch((e: any) => setError(e?.message || t('pos.could_not_cancel'))).finally(() => setBusy(null));
  };

  if (error && !plans) return <div className="work"><div className="err">{error}</div></div>;
  if (!plans) return <div className="work"><div className="state">{t('pos.loading_ai_plans')}</div></div>;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
        <div>
          <h1>{t('pos.ai_plans')}</h1>
        <div className="sub mb-3">{t('pos.bundle_the_assistants_and_save_each_m4up')}</div>
        </div></div>
        <button className="btn w-fit whitespace-nowrap"   onClick={() => nav('/tenant/ai/command-center')}>{t('pos.ai_center_2')}</button>
      </div>
      {error ? <div className="err">{error}</div> : null}
      {note ? <div className="state" style={{ color: '#1B7E4B' }}>{note}</div> : null}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" style={{gap: 14 }}>
        {plans.map((p) => {
          const discounted = p.discountCents > 0;
          return (
            <section key={p.code} style={card}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 19, fontWeight: 700, color: '#2B2118' }}>{p.name}</div>
                {p.essential ? <span style={essTag}>{t('pos.daily_essential')}</span> : null}
                {p.subscribed ? <span className="pill ok" >{p.status === 'trialing' ? t('pos.on_trial_2') : t('pos.active_3')}</span> : null}
              </div>
              <div style={{ fontSize: 12.5, color: '#6F6253', marginTop: 4 }}>{p.description}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, margin: '12px 0 2px' }}>
                {discounted ? <span style={{ fontSize: 15, color: '#9b8b73', textDecoration: 'line-through' }}>{money(p.fullCents)}</span> : null}
                <span style={{ fontSize: 26, fontWeight: 700, color: '#2B2118' }}>{money(p.effectiveCents)}</span>
                <span style={{ fontSize: 13, color: '#6F6253' }}>{t('pos.mo_2')}</span>
                {discounted ? <span style={saveChip}>{t('pos.save')}{' '}{money(p.discountCents)}</span> : null}
              </div>
              <div style={{ borderTop: '1px solid #EFE4D2', margin: '12px 0', paddingTop: 10 }}>
                {p.packages.map((pk) => (
                  <div key={pk.code} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#4A4034', padding: '3px 0' }}>
                    <span style={{ color: '#A96F22' }}>✦</span>{pk.name}
                    <span style={{ color: '#9b8b73', fontSize: 11.5 }}>{money(pk.monthlyPriceCents)}</span>
                  </div>
                ))}
              </div>
              {p.subscribed ? (
                <button className="btn ghost" disabled={busy === p.code} onClick={() => cancel(p)}>{busy === p.code ? '…' : t('pos.cancel_plan')}</button>
              ) : p.trialAvailable ? (
                <button className="btn w-fit whitespace-nowrap" disabled={busy === p.code} onClick={() => startTrial(p)} style={goldBtn}>{busy === p.code ? t('pos.starting') : t('pos.start_plan_trial')}</button>
              ) : (
                <button className="btn w-fit whitespace-nowrap" disabled >{t('pos.contact_to_activate')}</button>
              )}
            </section>
          );
        })}
      </div>
      <div className="s" style={{ color: '#8A7A66' }}>{t('pos.starting_a_plan_trial_activates_its_ewp9')}</div>
    </div>
  );
}

const card: CSSProperties = { background: '#fff', border: '1px solid #ECE0CD', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column' };
const essTag: CSSProperties = { fontSize: 11, background: '#FBF3E5', color: '#A96F22', padding: '2px 9px', borderRadius: 8, fontWeight: 600 };
const saveChip: CSSProperties = { fontSize: 12, background: '#E8F5EC', color: '#1B7E4B', padding: '3px 10px', borderRadius: 8, fontWeight: 600 };
const goldBtn: CSSProperties = { background: '#A96F22', color: '#fff', border: 'none' };
