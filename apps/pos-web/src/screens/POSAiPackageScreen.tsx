// POSAiPackageScreen.tsx — one shared screen for the individual AI add-on pages (booking, queue, scheduling, fraud, reviews,
// receipt scanner, …). Each route passes a package `code`.
//
// AI OCR Receipt Scanner guide (Nov 2 2026): the page showed three answers at once — "On trial" (the stored row still said
// trialing), "Limited" and "Your free trial has ended" — because it read the raw subscription status next to the access
// gate's denial. It now reads the ONE honest package state the AI Usage screen already computes
// (/tenant/ai/usage-screen/packages/:code: Trial expired is never shown as Trial; Cancelled offers no Cancel; Disabled by
// admin does not suggest an upgrade; an unknown status is "Unable to verify"), shows the price the salon actually pays
// (its plan, or the catalog list price — labelled), the usage of the CURRENT period with its reset date, the trial end
// date and the next step. Start trial and Cancel ask for confirmation and go through the audited, idempotent actions.
// A failed read is an error, never "not subscribed".
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { posAiUsageScreenApi } from '../api/posAiUsageApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtInZone } from '../i18n/format';

type Card = {
  code: string; name: string; description: string; category: string; posArea: string | null; state: string; storedStatus: string | null;
  price: { cents: number; period: 'monthly' | 'yearly'; source: 'subscription' | 'catalog_list' };
  usage: { used: number | null; limit: number; unit: string; percent: number | null; level: string; periodStart: string | null; periodEnd: string | null; remaining: number | null };
  trial: { days: number; endsAt: string | null; daysLeft: number | null; eligible: boolean };
  actions: string[]; disabledReason: string | null;
};
const TONE: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#E9F6EC', fg: '#2E9E54' }, trialing: { bg: '#EAF2FB', fg: '#2D6CBF' }, trial_available: { bg: '#F7F2E9', fg: '#8A7418' },
  trial_expired: { bg: '#FDF3E7', fg: '#B5651D' }, past_due: { bg: '#FDEEEE', fg: '#C0392B' }, suspended: { bg: '#FDEEEE', fg: '#C0392B' }, unable_to_verify: { bg: '#FDF3E7', fg: '#B5651D' },
};
const LIVE = ['active', 'trialing', 'past_due'];
const date = (iso: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `k${Date.now()}${Math.random()}`);

/** the add-on's subscription, usage and trial — honest state; `children` render below it (the module's own workspace) */
export function AiPackagePanel({ code, title, children, actionsSlot }: { code: string; title: string; children?: ReactNode; actionsSlot?: ReactNode }) {
  const [c, setC] = useState<Card | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'start_trial' | 'cancel'>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());

  const load = useCallback(async () => {
    setError(null);
    try { const r = await posAiUsageScreenApi.detail(code); setC((r?.package as Card) ?? null); }
    catch (e: any) {
      if (e?.status === 404 || e?.body?.code === 'AI_PACKAGE_NOT_FOUND') { setC(null); return; }
      setError(reportError(e, title));
    }
  }, [code, title]);
  useEffect(() => { void load(); }, [load]);

  const act = async () => {
    if (!c || !confirm) return;
    setBusy(true); setNote(null);
    try {
      if (confirm === 'start_trial') { await posAiUsageScreenApi.startTrial(c.code, { idempotencyKey: key.current, confirm: true }); setNote(t('aiu.trialStarted', { name: c.name })); }
      else { await posAiUsageScreenApi.cancel(c.code, { idempotencyKey: key.current, confirm: true, expectedStatus: c.storedStatus }); setNote(t('aiu.cancelled', { name: c.name })); }
      key.current = newKey(); setConfirm(null); await load();
    } catch (e: any) { setNote(reportError(e, t('aiu.actionFailed'))); }
    finally { setBusy(false); }
  };

  if (error) return <div className="work"><div className="vh"><h1>{title}</h1></div><div className="err" role="alert" style={{ marginTop: 12 }}>{error}</div></div>;
  if (c === undefined) return <div className="work"><div className="state">{t('pos.loading')}</div></div>;
  if (c === null) return <div className="work"><div className="vh"><h1>{title}</h1></div><div className="state" style={{ marginTop: 12 }}>{t('pos.this_ai_add_on_isn_t_1if4')}</div></div>;

  const live = LIVE.includes(c.state);
  const tone = TONE[c.state] ?? { bg: '#F0F0F0', fg: '#666' };
  const u = c.usage;
  const pct = live && u.limit > 0 && u.used != null ? Math.min(100, Math.round((u.used / u.limit) * 100)) : null;
  const priceText = c.price.cents > 0 ? `${money(c.price.cents)}/${c.price.period === 'yearly' ? t('pkgx.yr') : 'mo'}` : t('pos.included_2');

  return (
    <div className="work" data-testid={`ai-package-${c.code}`}>
      <div className="vh" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><h1>{c.name}</h1>
            <span data-testid="pkg-state" style={{ padding: '3px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: tone.bg, color: tone.fg }}>{t('aiu.state.' + c.state)}</span></div>
          {c.category ? <div className="sub">{c.category}</div> : null}
        </div>
        {actionsSlot ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{actionsSlot}</div> : null}
      </div>
      {note ? <div className="panel" role="status" data-testid="pkg-note" style={{ marginTop: 6, marginBottom: 6, padding: 10 }}>{note}</div> : null}

      {c.description ? <section className="panel" style={{ marginTop: 6 }}><div style={{ fontSize: 14, lineHeight: 1.5 }}>{c.description}</div>{c.posArea ? <div className="sub" style={{ fontSize: 12.5, marginTop: 8 }}>{t('pos.works_in')}{' '}{c.posArea}</div> : null}</section> : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-3.5 mb-3.5" data-testid="pkg-cards">
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.price')}</div><div className="v" style={{ fontSize: 18 }} data-testid="pkg-price">{priceText}</div>
          <div className="sub">{t('aiu.priceSource.' + c.price.source)}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.usage_this_period')}</div>
          <div className="v" data-testid="pkg-usage">{live && u.used != null ? u.used.toLocaleString('en-US') : '—'}{u.limit > 0 ? <span className="sub" style={{ fontSize: 13, fontWeight: 400 }}> / {u.limit.toLocaleString('en-US')} {u.unit}</span> : ''}</div>
          <div className="sub">{live ? (u.periodEnd ? t('pkgx.resets', { d: date(u.periodEnd) }) : u.periodStart ? t('pkgx.since', { d: date(u.periodStart) }) : '') : t('pkgx.notMetered')}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.status')}</div><div className="v" style={{ fontSize: 16 }} data-testid="pkg-access">{live && c.state !== 'past_due' ? (u.level === 'exhausted_100' ? t('pkgx.quotaUsed') : t('pkgx.available')) : t('pkgx.notAvailable')}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pkgx.trial')}</div><div className="v" style={{ fontSize: 15 }} data-testid="pkg-trial">
          {c.state === 'trialing' && c.trial.endsAt ? t('pkgx.trialEnds', { d: date(c.trial.endsAt), n: String(c.trial.daysLeft ?? 0) }) : c.state === 'trial_expired' && c.trial.endsAt ? t('pkgx.trialEnded', { d: date(c.trial.endsAt) })
            : c.trial.eligible ? t('pkgx.trialDays', { n: String(c.trial.days) }) : '—'}</div></div>
      </div>

      {pct !== null ? <div style={{ background: '#EEE6D8', borderRadius: 6, height: 8, overflow: 'hidden', marginTop: 10 }}><div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#C0392B' : 'var(--aps-orange)' }} /></div> : null}
      <div className="sub" style={{ marginTop: 10, fontSize: 13 }} data-testid="pkg-next">{t('aiu.nextStep.' + c.state)}</div>

      <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        {confirm ? <div className="panel" style={{ padding: 12, width: '100%' }} data-testid="pkg-confirm">
          <p>{confirm === 'cancel' ? t('aiu.confirmCancel', { name: c.name, state: t('aiu.state.' + c.state) }) : t('aiu.confirmTrial', { days: String(c.trial.days), name: c.name, price: priceText })}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" disabled={busy} onClick={() => setConfirm(null)}>{t('pos.cancel')}</button>
            <button className="btn" data-testid="pkg-confirm-go" disabled={busy} onClick={() => void act()}>{busy ? '…' : t('aiu.confirm.' + confirm)}</button>
          </div></div>
          : c.actions.includes('cancel') ? <button className="btn ghost" data-testid="pkg-cancel" onClick={() => setConfirm('cancel')}>{t('pos.cancel_add_on')}</button>
          : c.actions.includes('start_trial') ? <button className="btn w-fit whitespace-nowrap" data-testid="pkg-trial-start" onClick={() => setConfirm('start_trial')}>{t('pos.start_trialdays_day_free_trial', { trialDays: String(c.trial.days) })}</button>
          : null}
      </div>
      {children ?? <div className="sub" style={{ fontSize: 12, marginTop: 16 }}>{t('pos.this_page_manages_the_add_on_1dv3')}{' '}{c.posArea || t('pos.the_relevant_pos_areas')} {t('pos.its_live_activity_appears_there_and_dtu6')}</div>}
    </div>
  );
}

export function POSAiPackageScreen({ code, title }: { code: string; title: string }) {
  return <AiPackagePanel code={code} title={title} />;
}
