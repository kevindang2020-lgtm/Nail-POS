// POSAiPackageScreen.tsx — one shared screen for the individual AI add-on pages (booking, queue,
// scheduling, fraud, reviews, etc.). Each route passes a package `code`; the screen pulls that package's
// REAL entry from the AI catalog (subscription status + usage from tenant_ai_subscriptions / ai_usage_logs)
// and offers the real trial/cancel actions. It shows what the add-on does and where it works, but never
// fabricates runtime output — when a package's live behavior needs the AI service, that is stated plainly.
import { useCallback, useEffect, useState } from 'react';
import { posAiUsageApi } from '../api/posAiUsageApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Sub = { status: string; usageLimit: number; trialEndsAt: string | null };
type Pkg = {
  code: string; name: string; description: string | null; category: string | null; posArea: string | null;
  monthlyPriceCents: number; includedUsageLimit: number; usageUnit: string | null; trialDays: number;
  subscription: Sub | null; used: number; remainingUsage: number | null;
  accessible: boolean; lockLabel: string | null; upgradeRequired: boolean; trialAvailable: boolean;
};

const subChip = (status: string | null) => {
  const m: Record<string, { t: string; bg: string; fg: string }> = {
    active: { t: t('pos.active_3'), bg: '#E9F6EC', fg: '#2E9E54' }, trialing: { t: t('pos.on_trial_2'), bg: '#EAF2FB', fg: '#2D6CBF' },
    past_due: { t: t('pos.past_due'), bg: '#FDEEEE', fg: '#C0392B' }, cancelled: { t: t('pos.cancelled'), bg: '#F0F0F0', fg: '#777' }, expired: { t: t('pos.expired_2'), bg: '#F0F0F0', fg: '#777' },
  };
  const s = status ? (m[status] || { t: status, bg: '#F0F0F0', fg: '#666' }) : { t: t('pos.not_subscribed'), bg: '#F7F2E9', fg: '#8A7418' };
  return <span style={{ padding: '3px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: s.bg, color: s.fg }}>{s.t}</span>;
};

export function POSAiPackageScreen({ code, title }: { code: string; title: string }) {
  const [pkg, setPkg] = useState<Pkg | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const r = await posAiUsageApi.packages(); setPkg(((r?.packages || []) as Pkg[]).find((p) => p.code === code) ?? null); }
    catch (e: any) { setError(reportError(e, title)); }
  }, [code, title]);
  useEffect(() => { load(); }, [load]);

  const startTrial = async () => { setBusy(true); setNote(null); try { await posAiUsageApi.startTrial(code); await load(); } catch (e: any) { setNote(e?.message || t('pos.could_not_start_the_trial')); } finally { setBusy(false); } };
  const cancel = async () => { setBusy(true); setNote(null); try { await posAiUsageApi.cancel(code); await load(); } catch (e: any) { setNote(e?.message || t('pos.could_not_cancel')); } finally { setBusy(false); } };

  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (pkg === undefined) return <div className="work"><div className="state">{t('pos.loading')}</div></div>;
  if (pkg === null) return <div className="work"><div className="vh"><h1>{title}</h1></div><div className="state" style={{ marginTop: 12 }}>{t('pos.this_ai_add_on_isn_t_1if4')}</div></div>;

  const subscribed = !!pkg.subscription && ['active', 'trialing'].includes(pkg.subscription.status);
  const limit = pkg.subscription?.usageLimit ?? pkg.includedUsageLimit ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((pkg.used / limit) * 100)) : null;

  return (
    <div className="work">
      <div className="vh">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><h1>{pkg.name}</h1>{subChip(pkg.subscription?.status ?? null)}</div>
        {pkg.category ? <div className="sub">{pkg.category}</div> : null}
      </div>
      {note ? <div className="err" style={{ marginTop: 6, marginBottom: 6 }}>{note}</div> : null}

      {pkg.description ? <section className="panel" style={{ marginTop: 6 }}><div style={{ fontSize: 14, lineHeight: 1.5 }}>{pkg.description}</div>{pkg.posArea ? <div className="sub" style={{ fontSize: 12.5, marginTop: 8 }}>{t('pos.works_in')}{' '}{pkg.posArea}</div> : null}</section> : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mt-3.5 mb-3.5">
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.price')}</div><div className="v" style={{ fontSize: 18 }}>{pkg.monthlyPriceCents > 0 ? `${money(pkg.monthlyPriceCents)}/mo` : t('pos.included_2')}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.usage_this_period')}</div><div className="v ">{pkg.used.toLocaleString('en-US')}{limit > 0 ? <span className="sub" style={{ fontSize: 13, fontWeight: 400 }}> / {limit.toLocaleString('en-US')} {pkg.usageUnit || ''}</span> : ''}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.status')}</div><div className="v" style={{ fontSize: 16 }}>{subscribed ? (pkg.accessible ? t('pos.active_3') : t('growth.aiPackage.limited')) : t('pos.off')}</div></div>
      </div>

      {pct !== null ? <div style={{ background: '#EEE6D8', borderRadius: 6, height: 8, overflow: 'hidden', marginTop: 10 }}><div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#C0392B' : 'var(--aps-orange)' }} /></div> : null}

      {!pkg.accessible && pkg.lockLabel ? <div className="sub" style={{ marginTop: 10, color: '#B5651D', fontSize: 13 }}>{pkg.lockLabel}</div> : null}

      <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        {subscribed ? <button className="btn ghost" disabled={busy} onClick={cancel}>{busy ? '…' : t('pos.cancel_add_on')}</button>
          : pkg.trialAvailable ? <button className="btn w-fit whitespace-nowrap" disabled={busy} onClick={startTrial}>{busy ? '…' : t('pos.start_trialdays_day_free_trial', { trialDays: String(pkg.trialDays) })}</button>
          : <span className="sub" style={{ fontSize: 13 }}>{pkg.upgradeRequired ? t('pos.upgrade_your_plan_to_enable_this_1l2y') : t('pos.contact_support_to_enable_this_add_1b0c')}</span>}
      </div>

      <div className="sub" style={{ fontSize: 12, marginTop: 16 }}>
        {t('pos.this_page_manages_the_add_on_1dv3')}{' '}{pkg.posArea || t('pos.the_relevant_pos_areas')} {t('pos.its_live_activity_appears_there_and_dtu6')}
      </div>
    </div>
  );
}
