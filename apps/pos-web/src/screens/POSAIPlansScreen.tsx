// POSAIPlansScreen.tsx — tenant storefront for the five AI plans (bundles of the 15 assistants). Each plan shows its
// full price struck through with the new (discounted) price Super Admin set, the assistants it unlocks, and a
// Start-trial action. Subscribing activates the plan's assistants through the same per-assistant access gate; paid
// activation runs through billing / Super Admin. Bound to /tenant/ai/plans. Money is integer cents.
import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { posAiApi, type PosAiPlan } from '../api/posAiApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtInZone } from '../i18n/format';
import { errorTextOf } from '../i18n/error-text';

const PLAN_TABS: Array<[string, string | null]> = [['packages', null], ['individual', '/tenant/ai/usage?view=catalog'], ['subscriptions', '/tenant/ai/usage?view=subscriptions'],
  ['billing', '/tenant/ai/usage?view=billing'], ['usage', '/tenant/ai/usage']];
const money = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

export function POSAIPlansScreen() {
  const nav = useNavigate();
  const [plans, setPlans] = useState<PosAiPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // AI Plans guide (Nov 2 2026): Start trial / Cancel ask first (they used to fire on one tap)
  const [confirm, setConfirm] = useState<null | { plan: PosAiPlan; action: 'trial' | 'cancel' }>(null);

  const load = () => {
    posAiApi.plans().then((d) => { setPlans(d?.plans || []); setError(null); }).catch((e: any) => setError(errorTextOf(e, t('pos.failed_to_load_ai_plans'))));
  };
  useEffect(load, []);

  const startTrial = (p: PosAiPlan) => {
    setBusy(p.code); setNote(null); setError(null);
    posAiApi.startPlanTrial(p.code)
      .then((r) => { setNote(t('pos.name_trial_started_v1', { name: String(p.name), v1: String(r?.activated ? t('pos.activated_assistant_plural_activated', { activated: String(r.activated), plural: String(r.activated === 1 ? '' : 's') }) : '') })); load(); })
      .catch((e: any) => setError(e?.body?.message === 'trial_already_used' || e?.message === 'trial_already_used' ? t('plx.trialUsed') : errorTextOf(e, t('pos.could_not_start_trial'))))
      .finally(() => setBusy(null));
  };
  const cancel = (p: PosAiPlan) => {
    setBusy(p.code); setNote(null); setError(null);
    posAiApi.cancelPlan(p.code).then(() => { setNote(t('pos.name_cancelled', { name: String(p.name) })); load(); }).catch((e: any) => setError(errorTextOf(e, t('pos.could_not_cancel')))).finally(() => setBusy(null));
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost w-fit whitespace-nowrap" data-testid="plx-individual" onClick={() => nav('/tenant/ai/usage')}>{t('plx.individual')}</button>
          <button className="btn w-fit whitespace-nowrap"   onClick={() => nav('/tenant/ai/command-center')}>{t('pos.ai_center_2')}</button>
        </div>
      </div>
      {/* SUNMI addendum (Nov 8 2026) §07: the guide's five tabs. Packages is this page; the other four are views of the ONE
          authoritative AI Usage & Limits screen (catalog of the 15 assistants, subscriptions, cost & invoices, usage) — opened
          at that view, never a second copy of billing data. */}
      <div className="rvw-tabs" role="tablist" aria-label={t('plx.tabs')} data-testid="plx-tabs">
        {PLAN_TABS.map(([k, to]) => <button key={k} type="button" role="tab" aria-selected={k === 'packages'} className={'btn ghost' + (k === 'packages' ? ' on' : '')}
          data-testid={`plx-tab-${k}`} onClick={() => { if (to) nav(to); }}>{t('plx.tab.' + k)}</button>)}
      </div>
      {error ? <div className="err">{error}</div> : null}
      {note ? <div className="state" style={{ color: '#1B7E4B' }}>{note}</div> : null}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" style={{gap: 14 }} data-testid="plx-cards">
        {plans.map((p) => {
          const discounted = p.discountCents > 0;
          return (
            <section key={p.code} style={card} data-testid={`plan-card-${p.code}`}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 19, fontWeight: 700, color: '#2B2118' }}>{p.name}</div>
                {p.essential ? <span style={essTag}>{t('pos.daily_essential')}</span> : null}
                {p.state && p.state !== 'available' && p.state !== 'trial_available' ? <span className={'pill ' + (p.state === 'active' || p.state === 'trialing' ? 'ok' : '')} data-testid={`plan-state-${p.code}`}>{t('aiu.state.' + p.state)}</span> : null}
              </div>
              {/* extras AI Plans #05: Access (commercial — may the salon use it) vs Setup (technical — can it work now), never merged */}
              {p.readiness ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, fontSize: 12 }} data-testid={`plan-split-${p.code}`}>
                  <span className="pill" data-testid={`plan-access-${p.code}`}>{t('plx.rd.access', { s: t('aiu.state.' + (p.state || 'available')) })}</span>
                  <span className={'pill ' + (p.readiness.state === 'ready' ? 'ok' : '')} data-testid={`plan-ready-${p.code}`} data-state={p.readiness.state}>{t('plx.rd.setup', { s: t('plx.rd.st.' + p.readiness.state) })}</span>
                </div>) : null}
              {p.readiness && p.readiness.state !== 'ready' ? (
                <div className="warn" style={{ marginTop: 4, fontSize: 12.5 }} data-testid={`plan-ready-why-${p.code}`}>
                  {p.readiness.packages.filter((x) => x.state !== 'ready').map((x) => `${p.packages.find((pk) => pk.code === x.code)?.name ?? x.code}: ${t('plx.rd.why.' + (x.reason ?? 'unknown'))}`).join(' · ')}
                  {' '}{p.subscribed ? t('plx.rd.paidNote') : null}
                </div>) : null}
              <div style={{ fontSize: 12.5, color: '#6F6253', marginTop: 4 }}>{p.description}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, margin: '12px 0 2px' }}>
                {discounted ? <span style={{ fontSize: 15, color: '#9b8b73', textDecoration: 'line-through' }}>{money(p.fullCents)}</span> : null}
                <span style={{ fontSize: 26, fontWeight: 700, color: '#2B2118' }}>{money(p.effectiveCents)}</span>
                <span style={{ fontSize: 13, color: '#6F6253' }}>{t('pos.mo_2')}</span>
                {discounted ? <span style={saveChip}>{t('pos.save')}{' '}{money(p.discountCents)}</span> : null}
              </div>
              {p.state === 'trialing' && p.trialEndsAt ? <div className="sub" data-testid={`plan-trial-${p.code}`}>{t('plx.trialEnds', { d: fmtInZone(p.trialEndsAt, { month: 'short', day: 'numeric', year: 'numeric' }) })}</div> : null}
              {p.state === 'trial_expired' && p.trialEndsAt ? <div className="sub" data-testid={`plan-trial-${p.code}`}>{t('plx.trialEnded', { d: fmtInZone(p.trialEndsAt, { month: 'short', day: 'numeric', year: 'numeric' }) })} {t('aiu.nextStep.trial_expired')}</div> : null}
              {!discounted ? <div className="sub" data-testid={`plan-nodiscount-${p.code}`}>{t('plx.noDiscount')}</div> : null}
              {/* extras AI Plans #03: the server's price check — the members' own prices added up, and whether "Save" is the real saving */}
              {p.priceCheck && p.priceCheck.state !== 'unknown' ? (
                <div className={p.priceCheck.state === 'verified' ? 'sub' : 'warn'} style={{ marginTop: 4, fontSize: 12.5 }} data-testid={`plan-pricecheck-${p.code}`} data-state={p.priceCheck.state}>
                  {t('plx.pc.separately', { price: money(p.priceCheck.standaloneCents) })}{' · '}
                  {p.priceCheck.state === 'no_saving' ? (p.priceCheck.realSavingsCents === 0 ? t('plx.pc.same') : t('plx.pc.noSaving', { price: money(-p.priceCheck.realSavingsCents) }))
                    : p.priceCheck.state === 'overstated' ? t('plx.pc.overstated', { real: money(p.priceCheck.realSavingsCents), claimed: money(p.priceCheck.claimedSavingsCents) })
                    : t('plx.pc.verified', { real: money(p.priceCheck.realSavingsCents) })}
                </div>) : null}
              {p.overlap?.owned.length ? <div className="warn" data-testid={`plan-overlap-${p.code}`} style={{ marginTop: 8, fontSize: 12.5 }}>
                {t('plx.overlap', { n: String(p.overlap.owned.length), names: p.overlap.owned.map((x) => x.name).join(', ') })}
                {p.overlap.ownedMonthlyCents ? ` ${t('plx.overlapPaid', { price: money(p.overlap.ownedMonthlyCents) })}` : ''}
              </div> : null}
              <div style={{ borderTop: '1px solid #EFE4D2', margin: '12px 0', paddingTop: 10 }}>
                {p.packages.map((pk) => (
                  <div key={pk.code} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#4A4034', padding: '3px 0' }}>
                    <span style={{ color: '#A96F22' }}>✦</span>{pk.name}
                    <span style={{ color: '#9b8b73', fontSize: 11.5 }}>{money(pk.monthlyPriceCents)}</span>
                  </div>
                ))}
              </div>
              {confirm?.plan.code === p.code ? (
                <div className="panel" style={{ padding: 10 }} data-testid={`plan-confirm-${p.code}`}>
                  <p style={{ fontSize: 13 }}>{confirm.action === 'cancel' ? t('plx.confirmCancel', { name: p.name }) : t('plx.confirmTrial', { name: p.name, price: money(p.effectiveCents) })}</p>
                  {confirm.action === 'trial' && p.overlap?.owned.length ? <p className="warn" style={{ fontSize: 13 }} data-testid={`plan-confirm-overlap-${p.code}`}>{t('plx.overlapConfirm')}</p> : null}
                  <div style={{ display: 'flex', gap: 8 }}><button className="btn ghost" onClick={() => setConfirm(null)}>{t('pos.cancel')}</button>
                    <button className="btn" data-testid={`plan-confirm-go-${p.code}`} disabled={busy === p.code} onClick={() => { setConfirm(null); if (confirm.action === 'cancel') cancel(p); else startTrial(p); }}>{confirm.action === 'cancel' ? t('pos.cancel_plan') : t('pos.start_plan_trial')}</button></div>
                </div>
              ) : p.canCancel ? (
                <button className="btn ghost" data-testid={`plan-cancel-${p.code}`} disabled={busy === p.code} onClick={() => setConfirm({ plan: p, action: 'cancel' })}>{busy === p.code ? '…' : t('pos.cancel_plan')}</button>
              ) : p.trialAvailable ? (
                <button className="btn w-fit whitespace-nowrap" data-testid={`plan-trial-start-${p.code}`} disabled={busy === p.code} onClick={() => setConfirm({ plan: p, action: 'trial' })} style={goldBtn}>{busy === p.code ? t('pos.starting') : t('pos.start_plan_trial')}</button>
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
