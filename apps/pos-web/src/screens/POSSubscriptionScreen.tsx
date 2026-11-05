// POSSubscriptionScreen.tsx — /tenant/account/subscription. Linked from the Account screen ("Upgrade Plan",
// Subscription Plan KPI). Real data throughout:
//   • Current plan — settings.subscriptionPlan (Super-Admin-controlled, read-only): tier, billing status, AI package,
//     customer / technician / SMS-this-month counts.
//   • AI add-ons   — GET /tenant/ai/packages: per-package subscription status, usage (used / limit), live monthly
//     price, and the gate state (accessible / lock label / trial).
// Honest gap: base-plan price, renewal date, payment method and invoice history have no tenant-facing source yet, so
// they're shown as "managed by your account team" rather than invented.
import { useEffect, useMemo, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { useNavigate } from 'react-router-dom';
import { posSettingsApi } from '../api/posSettingsApi';
import { posAccountApi, type PosAccountOverview } from '../api/posAccountApi';
import { posAiApi, type PosAiPackage } from '../api/posAiApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';

const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' }); };

const G = '#A96F22';
const grid2 = "grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3";
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
const money = (c?: number) => (c == null ? '—' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
const headRow = (title: string, right?: React.ReactNode) => (<div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}><div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>{right ? <div style={{ marginLeft: 'auto' }}>{right}</div> : null}</div>);
const kvRow = (label: string, value: React.ReactNode) => (<div className="row" key={label}><div className="t" style={{ flex: 1, color: 'var(--muted)', fontWeight: 600 }}>{label}</div><div style={{ marginLeft: 'auto', textAlign: 'right', fontWeight: 700 }}>{value}</div></div>);

type Sub = { plan?: string; tier?: string; billingStatus?: string; aiPackageIncluded?: boolean; aiPackage?: string; aiFeatures?: Record<string, boolean>; customerCount?: number; technicianCount?: number; smsThisMonth?: number };

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const warn = pct >= 90;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ height: 6, borderRadius: 4, background: 'var(--line)', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: warn ? '#C0392B' : G }} /></div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{used.toLocaleString()} / {limit.toLocaleString()} {t('pos.used_3')}{pct}%)</div>
    </div>
  );
}

export function POSSubscriptionScreen() {
  const nav = useNavigate();
  const [sub, setSub] = useState<Sub | null>(null);
  const [pkgs, setPkgs] = useState<PosAiPackage[] | null>(null);
  const [subErr, setSubErr] = useState(false);
  const [overview, setOverview] = useState<PosAccountOverview | null>(null);

  useEffect(() => {
    posSettingsApi.getState().then((s) => setSub(((s as any)?.subscriptionPlan ?? null))).catch(() => setSubErr(true));
    posAccountApi.overview().then(setOverview).catch(() => setOverview(null));
    posAiApi.packages().then((d) => setPkgs(d?.packages || [])).catch(() => setPkgs([]));
  }, []);

  const active = useMemo(() => (pkgs || []).filter((p) => p.subscription?.status === 'active'), [pkgs]);
  const available = useMemo(() => (pkgs || []).filter((p) => p.subscription?.status !== 'active'), [pkgs]);
  const aiSpend = useMemo(() => active.reduce((sum, p) => sum + (p.monthlyPriceCents || 0), 0), [active]);

  const tier = sub?.tier || sub?.plan || '';
  const billing = sub?.billingStatus || '';
  const billActive = billing === 'active';

  const kpis = [
    { l: t('pos.current_plan'), v: tier ? cap(tier) : '—', d: sub?.plan && sub?.tier ? t('pos.plan_plan', { plan: String(sub.plan) }) : t('pos.managed_by_admin'), ok: true },
    { l: t('pos.billing_status'), v: billing ? (billActive ? t('pos.active_3') : statusLabel(['payment', 'invoice'], billing)) : '—', d: billActive ? t('pos.in_good_standing') : t('pos.see_account_team'), ok: billActive || !billing },
    { l: t('pos.ai_add_ons_active'), v: pkgs === null ? '…' : String(active.length), d: t('pos.of_v0_available', { v0: String(pkgs?.length ?? 0) }), ok: true },
    { l: t('pos.est_ai_spend'), v: pkgs === null ? '…' : `${money(aiSpend)}`, d: t('pos.per_month'), ok: true },
  ];

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh " style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div><h1>{t('pos.subscription')}</h1><div className="sub mb-3">{t('pos.your_plan_usage_this_period_and_3ia8')}</div></div>
        <button className="btn ghost whitespace-nowrap w-fit" onClick={() => nav('/tenant/account/overview')}>{t('pos.back_to_account')}</button>
      </div>

      <div className="kpis" style={{ margin: 0 }}>
        {kpis.map((k) => (
          <div className="kpi" key={k.l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="l">{k.l}</div>
            <div className="v" style={{ color: k.ok ? G : '#C0392B', fontSize: 20 }}>{k.v}</div>
            <div className="d" style={{ color: k.ok ? G : '#9a6a12' }}>{k.d}</div>
          </div>
        ))}
      </div>

      <div className={grid2}>
        <section className="panel">
          {headRow(t('pos.current_plan'))}
          {sub === null && !subErr ? <div className="muted">{t('pos.loading')}</div> : (
            <>
              <div className="row" style={{ marginBottom: 6 }}><div style={{ flex: 1, fontWeight: 800, fontSize: 15 }}>{tier ? t('pos.tier_plan', { tier: String(cap(tier)) }) : t('pos.plan')}</div><span className={'pill ' + (billActive ? 'ok' : 'warn')}>{billActive ? t('pos.active_3') : billing ? statusLabel(['payment', 'invoice'], billing) : t('pos.unknown')}</span></div>
              <div className="list" style={{ maxHeight: 'none' }}>
                {kvRow(t('pos.plan'), sub?.plan ? cap(sub.plan) : '—')}
                {kvRow(t('pos.tier'), tier ? cap(tier) : '—')}
                {kvRow(t('pos.ai_package'), sub?.aiPackageIncluded ? (sub?.aiPackage ? cap(sub.aiPackage) : t('pos.included_2')) : t('pos.not_included'))}
                {kvRow(t('pos.active_ai_add_ons'), pkgs === null ? '…' : String(active.length))}
              </div>
              {overview && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                  <div style={{ fontWeight: 800, fontSize: 11, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('pos.billing_details')}</div>
                  {kvRow(t('pos.base_plan_fee'), overview.billing.fee ?? '—')}
                  {kvRow(t('pos.next_renewal'), overview.billing.renewal ? fmtDate(overview.billing.renewal) : t('pos.not_set'))}
                  {/* card details stay with the processor — the API sends null, never print it (wave 4 UI sweep) */}
                  {kvRow(t('pos.payment_method_2'), overview.billing.method ? t('pos.method_exp_v1', { method: String(overview.billing.method), v1: String(overview.billing.expires ?? '—') }) : t('pos.held_by_the_card_processor'))}
                </div>
              )}
            </>
          )}
        </section>

        <section className="panel">
          {headRow(t('pos.usage_this_period'))}
          {sub === null && !subErr ? <div className="muted">{t('pos.loading')}</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                { l: t('pos.customers'), v: sub?.customerCount },
                { l: t('pos.technicians'), v: sub?.technicianCount },
                { l: t('pos.sms_this_month'), v: sub?.smsThisMonth },
              ].map((s) => (
                <div key={s.l} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, color: G }}>{typeof s.v === 'number' ? s.v.toLocaleString() : '—'}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{s.l}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 10 }}>{t('pos.counts_come_from_your_live_account_16ud')}</div>
        </section>
      </div>

      <div className={grid2}>
        <section className="panel">
          {headRow(t('pos.your_ai_add_ons'), <span className="pill ok" style={{ fontSize: 10 }}>{money(aiSpend)}{t('pos.mo_2')}</span>)}
          {pkgs === null ? <div className="muted">{t('pos.loading')}</div> : active.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '8px 0' }}>{t('pos.no_ai_add_ons_are_active_s80a')}</div>
          ) : (
            <div className="list" style={{ maxHeight: 320 }}>
              {active.map((p) => {
                const limit = p.subscription?.usageLimit ?? p.includedUsageLimit ?? 0;
                return (
                  <div key={p.code} style={{ borderBottom: '1px solid var(--line)', padding: '10px 2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ flex: 1, fontWeight: 700, fontSize: 12.5 }}>{p.name}</div><span style={{ fontSize: 11, fontWeight: 700, color: G }}>{money(p.monthlyPriceCents)}{t('pos.mo_2')}</span><span className="pill ok">{t('pos.active_3')}</span></div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{p.posArea || p.category}</div>
                    {limit > 0 ? <UsageBar used={p.used || 0} limit={limit} /> : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel">
          {headRow(t('pos.available_ai_add_ons'))}
          {pkgs === null ? <div className="muted">{t('pos.loading')}</div> : available.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '8px 0' }}>{t('pos.you_re_using_every_available_ai_10j5')}</div>
          ) : (
            <div className="list" style={{ maxHeight: 320 }}>
              {available.map((p) => (
                <div key={p.code} style={{ borderBottom: '1px solid var(--line)', padding: '10px 2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ flex: 1, fontWeight: 700, fontSize: 12.5 }}>{p.name}</div><span style={{ fontSize: 11, fontWeight: 700, color: G }}>{money(p.monthlyPriceCents)}{t('pos.mo_2')}</span>{p.trialAvailable ? <span className="pill warn" style={{ fontSize: 9.5 }}>{t('pos.trial_available')}</span> : null}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{p.description}</div>
                  {p.includedUsageLimit ? <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{t('pos.includes')}{' '}{p.includedUsageLimit.toLocaleString()} {p.usageUnit}{t('pos.mo_2')}</div> : null}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 10 }}>{t('pos.to_activate_an_add_on_or_j1yk')}</div>
        </section>
      </div>
    </div>
  );
}
