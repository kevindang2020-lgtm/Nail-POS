// SmsVerificationPanel.tsx — the tenant's §10 usage widget + §9 self-service upgrade (sms-packages P5).
// Rendered inside Account. Shows ONLY what the tenant may see (§43): their package, usage, overage terms, and
// the packages Super Admin marked self-service. §38 honesty: a package alone is "entitled", not "ready" —
// Twilio connection status lives in Communications and is pointed to, never fabricated here.
import { useCallback, useEffect, useState } from 'react';
import { posSmsPlanApi, type SmsMessagingUsage, type SmsBalance, type SmsSelfServicePackage } from '../api/posSmsPlanApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtInZone } from '../i18n/format';   // the location's clock (not the device's)

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function SmsVerificationPanel() {
  const [balance, setBalance] = useState<SmsBalance | null>(null);
  const [messaging, setMessaging] = useState<SmsMessagingUsage | null>(null);   // wave 3 PAYI §77: segments this month
  const [packages, setPackages] = useState<SmsSelfServicePackage[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [choice, setChoice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await posSmsPlanApi.plan(); setBalance(r.balance); setPackages(r.packages); setMessaging(r.messaging ?? null); if (!choice && r.packages[0]) setChoice(r.packages[0].id); }
    catch { setErr(t('pos.could_not_load_your_sms_verification_wr0g')); }
  }, [choice]);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await posSmsPlanApi.upgrade(choice);
      if ('ok' in r && r.ok === false) { setErr(r.message || t('pos.change_failed')); }
      else { setNote(t('pos.package_change_requested_v0', { v0: String((r as any).effective === 'next_cycle' ? t('pos.starts_next_billing_cycle') : t('pos.effective_immediately')) })); await load(); }
    } catch { setErr(t('pos.change_failed_nothing_was_updated')); }
    finally { setBusy(false); setConfirming(false); }
  };

  if (!balance) return <section className="panel" aria-label={t('pos.sms_verification')}><h2>{t('pos.sms_verification')}</h2><div className="loading">{t('pos.loading')}</div></section>;

  return (
    <section className="panel sms-verification-panel" aria-label={t('pos.sms_verification')}>
      <h2>{t('pos.sms_verification')}</h2>
      {note && <div className="inline-note" role="status">{note}</div>}
      {err && <div className="inline-note error" role="alert">{err}</div>}
      {!balance.hasPackage ? (
        <p className="cell-sub">{t('pos.no_sms_verification_package_is_assigned_1f7y')}{packages.length > 0 ? t('pos.or_pick_one_below') : ''}.</p>
      ) : (
        <UsageBlock b={balance} />
      )}
      {packages.length > 0 && (
        <div className="upgrade-block" aria-label={t('pos.change_package')}>
          <h3>{balance.hasPackage ? t('pos.change_package_2') : t('pos.choose_a_package')}</h3>
          <select value={choice} onChange={(e) => { setChoice(e.target.value); setConfirming(false); }} aria-label={t('pos.package_choice')}>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {usd(p.monthlyPriceCents)}{t('pos.mo')}{' '}{p.includedVerificationCount.toLocaleString()} {t('pos.included')}{p.overageEnabled ? ` · ${usd(p.overageUnitPriceCents)}/extra` : p.hardLimitEnabled ? t('pos.hard_limit') : ''}
              </option>
            ))}
          </select>
          {!confirming ? (
            <button className="btn" onClick={() => setConfirming(true)}>{t('pos.review_change')}</button>
          ) : (
            <div className="confirm-inline">
              <span>{t('pos.downgrades_start_next_billing_cycle_upgrades_lbc4')}</span>
              <button className="btn" disabled={busy} onClick={() => void submit()}>{t('pos.confirm_change')}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>{t('pos.cancel')}</button>
            </div>
          )}
        </div>
      )}
      {messaging ? (
        <div className="usage-block" aria-label={t('pos.text_messages_this_month')}>
          <h3>{t('pos.text_messages_this_month')}</h3>
          <p className="cell-sub">{messaging.messages.toLocaleString()} {t('pos.messages')}{' '}<b>{messaging.segments.toLocaleString()} {t('pos.segments')}</b> {t('pos.the_billable_unit')}{' '}{messaging.delivered.toLocaleString()} {t('pos.delivered')}{' '}{messaging.failed.toLocaleString()} {t('pos.failed')}{messaging.unknownSegments > 0 ? t('pos.v0_not_sized_by_the_carrier', { v0: String(messaging.unknownSegments.toLocaleString()) }) : ''}</p>
        </div>
      ) : null}
      <p className="cell-sub">{t('pos.sending_also_requires_your_twilio_connection_tgfj')}</p>
    </section>
  );
}

function UsageBlock({ b }: { b: Extract<SmsBalance, { hasPackage: true }> }) {
  const pct = Math.min(100, Math.round((b.usedIncluded / Math.max(1, b.includedAllowance)) * 100));
  const over = b.overageCount > 0;
  // §31 threshold alerts — the spec's texts, one tier at a time, from the CURRENT package's thresholds.
  const atLimit = b.remainingIncluded === 0;
  const banner = atLimit
    ? (b.hardLimitEnabled && !b.overageEnabled
        ? { cls: 'critical', text: t('pos.sms_verification_limit_reached') }
        : { cls: 'critical', text: t('pos.overage_charges_now_apply') })
    : pct >= b.criticalThresholdPercent
      ? { cls: 'critical', text: t('pos.you_are_approaching_your_sms_verification_22js') }
      : pct >= b.warningThresholdPercent
        ? { cls: 'warning', text: t('pos.you_have_used_pct_of_your_j457', { pct: String(pct) }) }
        : null;
  return (
    <div className="usage-block">
      {banner && <div className={`inline-note ${banner.cls}`} role="alert">{banner.text}</div>}
      <div className="usage-head"><strong>{b.packageName}</strong><span>{fmtInZone(b.cycleStart, { month: 'short', day: 'numeric', year: 'numeric' })} – {fmtInZone(b.cycleEnd, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="usage-line">{b.usedIncluded.toLocaleString()} / {b.includedAllowance.toLocaleString()} {t('pos.used')}{' '}{pct}% · {b.remainingIncluded.toLocaleString()} {t('pos.remaining')}</div>
      {over && (
        <div className="usage-line overage">{t('pos.overage')}{' '}{b.overageCount.toLocaleString()} × {usd(b.overageUnitPriceCents)} = {usd(b.estimatedOverageCents)} {t('pos.estimated')}</div>
      )}
      {!over && b.hardLimitEnabled && <div className="cell-sub">{t('pos.hard_limit_sending_pauses_when_the_1huj')}</div>}
      <div className="usage-line">{t('pos.next_reset')}{' '}{fmtInZone(b.cycleEnd, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
      <div className="usage-line">{t('pos.base')}{' '}{usd(b.monthlyPriceCents)}{t('pos.mo_2')}{b.estimatedOverageCents > 0 ? t('pos.estimatedoveragecents_overage', { estimatedOverageCents: String(usd(b.estimatedOverageCents)) }) : ''} {t('pos.estimated_total')}{' '}{usd(b.monthlyPriceCents + b.estimatedOverageCents)}</div>
    </div>
  );
}
