// POSAiUsageScreen.tsx — AI → Usage. The tenant's AI package subscriptions and real usage (from
// ai_usage_logs), reusing GET /tenant/ai/packages. Shows each package's subscription status, usage vs
// limit, and access state, and allows starting a free trial or cancelling (ai.manage). This is the
// subscription/usage management surface — real data, distinct from each package's runtime behavior.
import { useCallback, useEffect, useState } from 'react';
import { posAiUsageApi } from '../api/posAiUsageApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Sub = { status: string; usageLimit: number; overageEnabled: boolean; trialEndsAt: string | null };
type Pkg = {
  code: string; name: string; description: string | null; category: string | null; posArea: string | null;
  monthlyPriceCents: number; includedUsageLimit: number; usageUnit: string | null; trialDays: number;
  subscription: Sub | null; used: number; remainingUsage: number | null;
  accessible: boolean; lockReason: string | null; lockLabel: string | null; upgradeRequired: boolean; trialAvailable: boolean;
};

const subChip = (status: string | null) => {
  const m: Record<string, { t: string; bg: string; fg: string }> = {
    active: { t: t('pos.active_3'), bg: '#E9F6EC', fg: '#2E9E54' }, trialing: { t: t('pos.trial'), bg: '#EAF2FB', fg: '#2D6CBF' },
    past_due: { t: t('pos.past_due'), bg: '#FDEEEE', fg: '#C0392B' }, cancelled: { t: t('pos.cancelled'), bg: '#F0F0F0', fg: '#777' },
    expired: { t: t('pos.expired_2'), bg: '#F0F0F0', fg: '#777' },
  };
  const s = status ? (m[status] || { t: status, bg: '#F0F0F0', fg: '#666' }) : { t: t('pos.not_subscribed'), bg: '#F7F2E9', fg: '#8A7418' };
  return <span style={{ padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: s.bg, color: s.fg }}>{s.t}</span>;
};

export function POSAiUsageScreen() {
  const [packages, setPackages] = useState<Pkg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await posAiUsageApi.packages(); setPackages((r?.packages || []) as Pkg[]); }
    catch (e: any) { setError(reportError(e, t('growth.noun.aiUsage'))); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const startTrial = async (code: string) => {
    setBusy(code); setNote(null);
    try { await posAiUsageApi.startTrial(code); await load(); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_start_the_trial')); }
    finally { setBusy(null); }
  };
  const cancel = async (code: string) => {
    setBusy(code); setNote(null);
    try { await posAiUsageApi.cancel(code); await load(); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_cancel')); }
    finally { setBusy(null); }
  };

  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!packages) return <div className="work"><div className="state">{t('pos.loading_ai_usage')}</div></div>;

  const active = packages.filter((p) => p.subscription && ['active', 'trialing'].includes(p.subscription.status));
  const monthlyCost = active.reduce((a, p) => a + (p.subscription?.status === 'active' ? p.monthlyPriceCents : 0), 0);

  return (
    <div className="work">
      <div className="vh"><h1>{t('pos.ai_usage')}</h1>
        <div className="sub mb-3">{t('pos.your_ai_add_ons_usage_and_677h')}</div></div>

      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.active_ai_add_ons')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{active.length}</div></div>
        <div className="kpi"><div className="l">{t('pos.monthly_ai_cost')}</div><div className="v" style={{ fontSize: 18 }}>{money(monthlyCost)}</div></div>
        <div className="kpi"><div className="l">{t('pos.available')}</div><div className="v">{packages.length}</div></div>
      </div>
      {note ? <div className="err" style={{ marginTop: 10 }}>{note}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" style={{gap: 12, marginTop: 12 }}>
        {packages.map((p) => {
          const limit = p.subscription?.usageLimit ?? p.includedUsageLimit ?? 0;
          const pct = limit > 0 ? Math.min(100, Math.round((p.used / limit) * 100)) : null;
          const subscribed = !!p.subscription && ['active', 'trialing'].includes(p.subscription.status);
          return (
            <div key={p.code} className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                <div><div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>{p.category ? <div className="sub" style={{ fontSize: 11.5 }}>{p.category}</div> : null}</div>
                {subChip(p.subscription?.status ?? null)}
              </div>
              {p.description ? <div className="sub" style={{ fontSize: 12.5 }}>{p.description}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span className="sub">{p.monthlyPriceCents > 0 ? `${money(p.monthlyPriceCents)}/mo` : t('pos.included_2')}</span>
                <span className="sub">{p.used.toLocaleString('en-US')}{limit > 0 ? ` / ${limit.toLocaleString('en-US')}` : ''} {p.usageUnit || 'uses'}</span>
              </div>
              {pct !== null ? (
                <div style={{ background: '#EEE6D8', borderRadius: 6, height: 7, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#C0392B' : 'var(--aps-orange)' }} />
                </div>
              ) : null}
              {/* Functional Decision 30: warn at 80%, warn again at 90%, and say plainly what happens at 100%. */}
              {subscribed && limit > 0 && p.used / limit >= 0.8 ? (
                <div role="status" style={{ fontSize: 12, color: p.used >= limit ? '#C0392B' : '#B5651D', fontWeight: 600 }}>
                  {p.used >= limit
                    ? t('pos.usage_limit_reached_this_ai_assistant_1ggf')
                    : p.used / limit >= 0.9 ? t('pos.90_of_this_month_s_limit_1c84', { v0: String(Math.max(0, limit - p.used).toLocaleString('en-US')), v1: String(p.usageUnit || 'uses') })
                    : t('pos.80_of_this_month_s_limit_w6v9', { v0: String(Math.max(0, limit - p.used).toLocaleString('en-US')), v1: String(p.usageUnit || 'uses') })}
                </div>
              ) : null}
              {!p.accessible && p.lockLabel ? <div style={{ fontSize: 12, color: '#B5651D' }}>{p.lockLabel}</div> : null}
              <div style={{ marginTop: 'auto', paddingTop: 6 }}>
                {subscribed ? <button className="btn ghost" disabled={busy === p.code} onClick={() => cancel(p.code)}>{busy === p.code ? '…' : t('pos.cancel')}</button>
                  : p.trialAvailable ? <button className="btn w-fit whitespace-nowrap" disabled={busy === p.code} onClick={() => startTrial(p.code)}>{busy === p.code ? '…' : t('pos.start_trialdays_day_trial', { trialDays: String(p.trialDays) })}</button>
                  : <span className="sub" style={{ fontSize: 12 }}>{p.upgradeRequired ? t('pos.upgrade_required') : '—'}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="sub" style={{ fontSize: 12, marginTop: 12 }}>{t('pos.usage_reflects_successful_ai_calls_this_1xez')}</div>
    </div>
  );
}
