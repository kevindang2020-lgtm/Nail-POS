import { useEscapeToClose } from '../components/FitKit';
import { useEffect, useMemo, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posMembershipsApi } from '../api/posMembershipsApi';
import { posServicesApi } from '../api/posServicesApi';
import { centsToUsd } from '@aipowersalon/money';
import { t } from '@aipowersalon/mobile-sdk/i18n';

// MembershipPlanBuilder — the full guided plan configurator. It walks identity → pricing/billing → term/cancellation →
// benefits/credits → commission, computes a live profitability preview (price − estimated benefit cost per cycle, plus
// the technician's share at full usage), then writes a REAL plan via POST /pos/memberships/plans and publishes its first
// immutable version via POST /pos/memberships/plans/:id/versions. The split is enforced to total 100% (default 60/40)
// both here and server-side, money is integer cents, and eligible services come from the live services catalog.

const GOLD = '#A96F22';
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#6A5A46', margin: '10px 0 0' };
const inp: React.CSSProperties = { display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', border: '1px solid var(--line,#E2D6C2)', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: '#fff' };
const help: React.CSSProperties = { fontSize: 12, color: '#8A7A64', marginTop: 4 };
const dollarsToCents = (s: string): number => (parseDollarsToCents(s || '0') ?? 0);
const centsToDollars = (c: number): string => (c / 100).toFixed(2);
const money = (c: number): string => centsToUsd(c);   // shared formatter: a negative reads −$6.75, never $-6.75 (wave 4 pilot)
const onlyNum = (s: string): string => s.replace(/[^0-9.]/g, '');
const onlyInt = (s: string): string => s.replace(/[^0-9]/g, '');

// label tables are functions: they translate when read, so a language switch re-labels in place (WP-B)
const PRODUCT_TYPES = (): Array<[string, string, string]> => [
  ['recurring', t('people.planBuilder.type.recurring'), t('people.planBuilder.type.recurringDesc')],
  ['fixed_term', t('people.planBuilder.type.fixedTerm'), t('people.planBuilder.type.fixedTermDesc')],
  ['package', t('people.planBuilder.type.package'), t('people.planBuilder.type.packageDesc')],
  ['discount_club', t('people.planBuilder.type.discountClub'), t('people.planBuilder.type.discountClubDesc')],
  ['hybrid', t('people.planBuilder.type.hybrid'), t('people.planBuilder.type.hybridDesc')],
];
const INTERVALS = (): Array<[string, string]> => [['month', t('people.planBuilder.interval.month')], ['quarter', t('people.planBuilder.interval.quarter')], ['six_month', t('people.planBuilder.interval.sixMonth')], ['year', t('people.planBuilder.interval.year')], ['none', t('people.planBuilder.interval.none')], ['custom', t('people.planBuilder.interval.custom')]];
const BENEFIT_TYPES = (): Array<[string, string]> => [['service_credit', t('people.planBuilder.benefit.serviceCredit')], ['dollar_credit', t('people.planBuilder.benefit.dollarCredit')], ['percent_discount', t('people.planBuilder.benefit.percentDiscount')], ['fixed_discount', t('people.planBuilder.benefit.fixedDiscount')], ['product_discount', t('people.planBuilder.benefit.productDiscount')], ['addon', t('people.planBuilder.benefit.addon')], ['priority_booking', t('people.planBuilder.benefit.priorityBooking')]];
const CANCELLATION = (): Array<[string, string]> => [['period_end', t('people.planBuilder.cancel.periodEnd')], ['immediate', t('people.planBuilder.cancel.immediate')], ['term_end', t('people.planBuilder.cancel.termEnd')]];
const ALLOCATION = (): Array<[string, string]> => [['on_redemption', t('people.planBuilder.allocation.onRedemption')], ['on_billing', t('people.planBuilder.allocation.onBilling')], ['hybrid', t('people.planBuilder.allocation.hybrid')]];
const COMMISSION_BASIS = (): Array<[string, string]> => [['allocated', t('people.planBuilder.commissionBasis.allocated')], ['standard', t('people.planBuilder.commissionBasis.standard')], ['fixed', t('people.planBuilder.commissionBasis.fixed')]];
const defaultDisclosure = (): string => t('pos.your_membership_renews_automatically_each_billing_sohn');

interface ServiceOpt { id: string; name: string; priceCents: number }
interface Benefit {
  benefitType: string; label: string; serviceId: string | null; creditsPerCycle: number; valueCents: number; percent: number;
  allocatedValueCents: number; minDaysBetween: number; maxPerCycle: number | null; rolloverAllowed: boolean; servicePriceCents: number;
}
const newBenefit = (): Benefit => ({ benefitType: 'service_credit', label: '', serviceId: null, creditsPerCycle: 1, valueCents: 0, percent: 0, allocatedValueCents: 0, minDaysBetween: 0, maxPerCycle: null, rolloverAllowed: false, servicePriceCents: 0 });

const STEPS = (): string[] => [t('people.planBuilder.step.identity'), t('pos.pricing'), t('people.planBuilder.step.term'), t('pos.benefits'), t('pos.commission')];

export function MembershipPlanBuilder({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceOpt[]>([]);

  // identity
  const [name, setName] = useState('');
  const [planCode, setPlanCode] = useState('');
  const [description, setDescription] = useState('');
  const [badge, setBadge] = useState('');
  const [isPopular, setIsPopular] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);
  const [memberVisible, setMemberVisible] = useState(true);
  const [productType, setProductType] = useState('recurring');
  // pricing
  const [billingInterval, setBillingInterval] = useState('month');
  const [intervalCount, setIntervalCount] = useState('1');
  const [priceDollars, setPriceDollars] = useState('');
  const [isCustomPricing, setIsCustomPricing] = useState(false);
  const [enrollmentFee, setEnrollmentFee] = useState('');
  const [setupFee, setSetupFee] = useState('');
  const [trialDays, setTrialDays] = useState('0');
  const [autoRenew, setAutoRenew] = useState(true);
  const [autoRenewDisclosure, setAutoRenewDisclosure] = useState(defaultDisclosure);
  const [billingCycles, setBillingCycles] = useState('');
  // term
  const [termType, setTermType] = useState('none');
  const [termDays, setTermDays] = useState('');
  const [minCommitmentCycles, setMinCommitmentCycles] = useState('0');
  const [pauseMaxPerYear, setPauseMaxPerYear] = useState('0');
  const [pauseMaxDays, setPauseMaxDays] = useState('0');
  const [cancellationPolicy, setCancellationPolicy] = useState('period_end');
  // benefits & credits
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [creditExpiryDays, setCreditExpiryDays] = useState('');
  const [rolloverAllowed, setRolloverAllowed] = useState(false);
  const [rolloverMaxCycles, setRolloverMaxCycles] = useState('0');
  const [allocationTiming, setAllocationTiming] = useState('on_redemption');
  // commission
  const [techCommissionBasis, setTechCommissionBasis] = useState('allocated');
  const [techSplit, setTechSplit] = useState('60');
  const [techFixed, setTechFixed] = useState('');

  useEffect(() => {
    let alive = true;
    (posServicesApi.list() as Promise<any>)
      .then((rows) => {
        if (!alive) return;
        const list: ServiceOpt[] = (Array.isArray(rows) ? rows : rows?.items || rows?.services || [])
          .map((r: any) => ({ id: r.id, name: r.name, priceCents: Number(r.priceCents ?? r.price_cents ?? 0) || 0 }))
          .filter((r: ServiceOpt) => r.id && r.name);
        setServices(list);
      })
      .catch(() => setServices([]));
    return () => { alive = false; };
  }, []);

  const techPct = Math.max(0, Math.min(100, Math.round(parseFloat(techSplit || '0') || 0)));
  const ownerPct = 100 - techPct;
  const splitOk = techPct + ownerPct === 100 && techPct >= 0 && techPct <= 100;
  const nameOk = name.trim().length > 0;

  const econ = useMemo(() => {
    const priceCents = dollarsToCents(priceDollars);
    let benefitCost = 0, eligibleValue = 0;
    for (const b of benefits) {
      const qty = b.creditsPerCycle > 0 ? b.creditsPerCycle : 1;
      if (b.benefitType === 'service_credit' || b.benefitType === 'addon') {
        benefitCost += (b.allocatedValueCents || 0) * qty;
        eligibleValue += (b.servicePriceCents || b.allocatedValueCents || 0) * qty;
      } else if (b.benefitType === 'dollar_credit') {
        benefitCost += b.valueCents || b.allocatedValueCents || 0;
      } else if (b.benefitType === 'fixed_discount') {
        benefitCost += b.valueCents || 0;
      } else if (b.benefitType === 'percent_discount' || b.benefitType === 'product_discount') {
        benefitCost += b.allocatedValueCents || 0;
      }
    }
    const margin = priceCents - benefitCost;
    const marginPct = priceCents > 0 ? Math.round((margin / priceCents) * 100) : null;
    // ONE-PAY (Oct 13 2026): no technician amount is computed here — payroll prices each redemption (the one split).
    return { priceCents, benefitCost, eligibleValue, margin, marginPct };
  }, [priceDollars, benefits]);

  const updateBenefit = (i: number, patch: Partial<Benefit>) => setBenefits((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const pickService = (i: number, serviceId: string) => {
    const svc = services.find((s) => s.id === serviceId);
    updateBenefit(i, { serviceId: serviceId || null, servicePriceCents: svc?.priceCents ?? 0, label: benefits[i].label || svc?.name || '', allocatedValueCents: benefits[i].allocatedValueCents || svc?.priceCents || 0 });
  };

  const canNext = step !== 0 || nameOk;
  const next = () => { setErr(null); setStep((s) => Math.min(STEPS().length - 1, s + 1)); };
  const back = () => { setErr(null); setStep((s) => Math.max(0, s - 1)); };

  const publish = async () => {
    if (!nameOk) { setStep(0); setErr(t('pos.plan_name_is_required')); return; }
    if (!splitOk) { setErr(t('pos.technician_and_owner_split_must_total_fl31')); return; }
    setBusy(true); setErr(null);
    try {
      const created = await (posMembershipsApi.createPlan({
        name: name.trim(), planCode: planCode.trim() || null, productType, description: description.trim() || null,
        badge: badge.trim() || null, isPopular, isFeatured, memberVisible,
      }) as Promise<{ planId: string }>);
      await posMembershipsApi.publishVersion(created.planId, {
        billingInterval, intervalCount: parseInt(intervalCount || '1', 10) || 1, priceCents: econ.priceCents, isCustomPricing,
        enrollmentFeeCents: dollarsToCents(enrollmentFee), setupFeeCents: dollarsToCents(setupFee), trialDays: parseInt(trialDays || '0', 10) || 0,
        autoRenew, billingCycles: billingCycles ? parseInt(billingCycles, 10) : null,
        termType, termDays: termType === 'fixed' && termDays ? parseInt(termDays, 10) : null,
        rolloverAllowed, rolloverMaxCycles: parseInt(rolloverMaxCycles || '0', 10) || 0, creditExpiryDays: creditExpiryDays ? parseInt(creditExpiryDays, 10) : null,
        techCommissionBasis, techSplitPct: techPct, ownerSplitPct: ownerPct, techFixedCents: techCommissionBasis === 'fixed' ? dollarsToCents(techFixed) : null,
        allocationTiming, cancellationPolicy, minCommitmentCycles: parseInt(minCommitmentCycles || '0', 10) || 0,
        pauseMaxPerYear: parseInt(pauseMaxPerYear || '0', 10) || 0, pauseMaxDays: parseInt(pauseMaxDays || '0', 10) || 0,
        autoRenewDisclosure: autoRenew ? autoRenewDisclosure.trim() || null : null, estMarginCents: econ.margin,
        benefits: benefits.map((b) => ({
          benefitType: b.benefitType, label: b.label.trim() || BENEFIT_TYPES().find(([v]) => v === b.benefitType)?.[1] || t('people.planBuilder.benefit.default'),
          serviceId: b.serviceId, creditsPerCycle: b.creditsPerCycle, valueCents: b.valueCents, percent: b.percent,
          allocatedValueCents: b.allocatedValueCents, minDaysBetween: b.minDaysBetween, maxPerCycle: b.maxPerCycle, rolloverAllowed: b.rolloverAllowed,
        })),
      });
      onCreated();
    } catch (e: any) { setErr(e?.message || t('pos.could_not_publish_the_plan')); setBusy(false); }
  };

  useEscapeToClose(onClose);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,30,20,0.38)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }} onClick={onClose}>
      <div className="panel" role="dialog" aria-modal="true" aria-label={t('pos.plan_builder')} data-testid="dlg-plan-builder" style={{ width: 'min(760px, 97vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--aps-card,#fff)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 style={{ margin: 0 }}>{t('pos.plan_builder')}</h2>
          <span className="muted" style={{ fontSize: 12 }}>{t('pos.step')}{' '}{step + 1} {t('pos.of')}{' '}{STEPS().length} · {STEPS()[step]}</span>
          <button className="btn" style={{ marginLeft: 'auto', padding: '2px 8px' }} onClick={onClose}>{t('pos.close')}</button>
        </div>
        {/* stepper */}
        <div style={{ display: 'flex', gap: 6, margin: '12px 0 6px' }}>
          {STEPS().map((s, i) => (
            <div key={s} onClick={() => i < step && setStep(i)} style={{ flex: 1, cursor: i < step ? 'pointer' : 'default' }}>
              <div style={{ height: 4, borderRadius: 3, background: i <= step ? GOLD : '#EADFCB' }} />
              <div style={{ fontSize: 11, marginTop: 4, color: i === step ? GOLD : '#9A8A74', fontWeight: i === step ? 700 : 500 }}>{s}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 8 }}>
          {step === 0 && (
            <div>
              <label style={lbl}>{t('pos.plan_name')}<input value={name} onChange={(e) => setName(e.target.value)} style={inp} placeholder={t('pos.vip_nail_club')} /></label>
              <label style={lbl}>{t('pos.description')}<input value={description} onChange={(e) => setDescription(e.target.value)} style={inp} placeholder={t('pos.one_gel_manicure_per_month_plus_1pki')} /></label>
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.plan_code_optional')}<input value={planCode} onChange={(e) => setPlanCode(e.target.value)} style={inp} placeholder="VIP" /></label>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.badge_optional')}<input value={badge} onChange={(e) => setBadge(e.target.value)} style={inp} placeholder={t('pos.most_popular')} /></label>
              </div>
              <label style={lbl}>{t('pos.plan_type')}</label>
              <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
                {PRODUCT_TYPES().map(([v, label, desc]) => (
                  <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', border: `1px solid ${productType === v ? GOLD : 'var(--line,#E2D6C2)'}`, borderRadius: 8, cursor: 'pointer', background: productType === v ? '#FBF6EC' : '#fff' }}>
                    <input type="radio" name="ptype" checked={productType === v} onChange={() => setProductType(v)} style={{ marginTop: 2 }} />
                    <span><span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span><span className="muted" style={{ display: 'block', fontSize: 12 }}>{desc}</span></span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={isPopular} onChange={(e) => setIsPopular(e.target.checked)} /> {t('pos.mark_most_popular')}</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} /> {t('pos.featured')}</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={memberVisible} onChange={(e) => setMemberVisible(e.target.checked)} /> {t('pos.visible_to_customers')}</label>
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.billing_interval')}<select value={billingInterval} onChange={(e) => setBillingInterval(e.target.value)} style={inp}>{INTERVALS().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label style={{ ...lbl, width: 120 }}>{t('pos.every')}<input value={intervalCount} onChange={(e) => setIntervalCount(onlyInt(e.target.value))} inputMode="numeric" style={inp} /></label>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.price_usd')}<input value={priceDollars} onChange={(e) => setPriceDollars(onlyNum(e.target.value))} inputMode="decimal" style={inp} placeholder="79.99" disabled={isCustomPricing} /></label>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.trial_days')}<input value={trialDays} onChange={(e) => setTrialDays(onlyInt(e.target.value))} inputMode="numeric" style={inp} /></label>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 8 }}><input type="checkbox" checked={isCustomPricing} onChange={(e) => setIsCustomPricing(e.target.checked)} /> {t('pos.custom_negotiated_pricing_set_per_member')}</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.enrollment_fee_usd')}<input value={enrollmentFee} onChange={(e) => setEnrollmentFee(onlyNum(e.target.value))} inputMode="decimal" style={inp} placeholder="0.00" /></label>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.setup_fee_usd')}<input value={setupFee} onChange={(e) => setSetupFee(onlyNum(e.target.value))} inputMode="decimal" style={inp} placeholder="0.00" /></label>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.billing_cycles')}<input value={billingCycles} onChange={(e) => setBillingCycles(onlyInt(e.target.value))} inputMode="numeric" style={inp} placeholder="∞" /></label>
              </div>
              <p style={help}>{t('pos.leave_billing_cycles_blank_for_open_1kdw')}</p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 8, fontWeight: 600 }}><input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} /> {t('pos.auto_renew_each_cycle')}</label>
              {autoRenew && (
                <>
                  <label style={lbl}>{t('pos.auto_renewal_disclosure_shown_at_enrollment')}<textarea value={autoRenewDisclosure} onChange={(e) => setAutoRenewDisclosure(e.target.value)} style={{ ...inp, minHeight: 56, resize: 'vertical' }} /></label>
                  <p style={help}>{t('pos.required_for_negative_option_auto_renewing_1ckl')}</p>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.term_type')}<select value={termType} onChange={(e) => setTermType(e.target.value)} style={inp}><option value="none">{t('pos.no_fixed_term')}</option><option value="fixed">{t('pos.fixed_term')}</option></select></label>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.term_length_days')}<input value={termDays} onChange={(e) => setTermDays(onlyInt(e.target.value))} inputMode="numeric" style={inp} placeholder={t('admin.form.example', { value: '180' })} disabled={termType !== 'fixed'} /></label>
              </div>
              <label style={lbl}>{t('pos.minimum_commitment_cycles')}<input value={minCommitmentCycles} onChange={(e) => setMinCommitmentCycles(onlyInt(e.target.value))} inputMode="numeric" style={inp} /></label>
              <p style={help}>{t('pos.cancellations_before_the_minimum_may_be_b2yb')}</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.pauses_allowed_year')}<input value={pauseMaxPerYear} onChange={(e) => setPauseMaxPerYear(onlyInt(e.target.value))} inputMode="numeric" style={inp} /></label>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.max_pause_length_days')}<input value={pauseMaxDays} onChange={(e) => setPauseMaxDays(onlyInt(e.target.value))} inputMode="numeric" style={inp} /></label>
              </div>
              <label style={lbl}>{t('pos.cancellation_policy')}<select value={cancellationPolicy} onChange={(e) => setCancellationPolicy(e.target.value)} style={inp}>{CANCELLATION().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            </div>
          )}

          {step === 3 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{t('pos.benefits')}</div>
                <button className="btn" style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => setBenefits((b) => [...b, newBenefit()])}>{t('pos.add_benefit')}</button>
              </div>
              {benefits.length === 0 && <p style={help}>{t('pos.no_benefits_yet_a_discount_club_g4cq')}</p>}
              {benefits.map((b, i) => {
                const isService = b.benefitType === 'service_credit' || b.benefitType === 'addon';
                const isPercent = b.benefitType === 'percent_discount';
                const isDollar = b.benefitType === 'dollar_credit' || b.benefitType === 'fixed_discount';
                return (
                  <div key={i} style={{ border: '1px solid var(--line,#E2D6C2)', borderRadius: 10, padding: 10, marginTop: 8, background: '#FCFAF5' }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <label style={{ ...lbl, margin: 0, flex: 1 }}>{t('pos.type')}<select value={b.benefitType} onChange={(e) => updateBenefit(i, { benefitType: e.target.value })} style={inp}>{BENEFIT_TYPES().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                      <label style={{ ...lbl, margin: 0, flex: 1.4 }}>{t('pos.label')}<input value={b.label} onChange={(e) => updateBenefit(i, { label: e.target.value })} style={inp} placeholder={t('pos.one_gel_manicure')} /></label>
                      <button className="btn" style={{ alignSelf: 'flex-end', padding: '8px 10px', color: '#A33B3B' }} onClick={() => setBenefits((bs) => bs.filter((_, j) => j !== i))}>{t('pos.remove')}</button>
                    </div>
                    {isService && (
                      <div style={{ display: 'flex', gap: 10 }}>
                        <label style={{ ...lbl, flex: 2 }}>{t('pos.service_3')}<select value={b.serviceId || ''} onChange={(e) => pickService(i, e.target.value)} style={inp}><option value="">{services.length ? t('pos.select_a_service') : t('pos.no_services_found')}</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.priceCents)}</option>)}</select></label>
                        <label style={{ ...lbl, width: 110 }}>{t('pos.per_cycle')}<input value={String(b.creditsPerCycle)} onChange={(e) => updateBenefit(i, { creditsPerCycle: parseInt(onlyInt(e.target.value) || '0', 10) })} inputMode="numeric" style={inp} /></label>
                        <label style={{ ...lbl, width: 130 }}>{t('pos.cost_basis_usd')}<input value={centsToDollars(b.allocatedValueCents)} onChange={(e) => updateBenefit(i, { allocatedValueCents: dollarsToCents(onlyNum(e.target.value)) })} inputMode="decimal" style={inp} /></label>
                      </div>
                    )}
                    {isPercent && <label style={lbl}>{t('pos.discount_percent')}<input value={String(b.percent)} onChange={(e) => updateBenefit(i, { percent: parseInt(onlyInt(e.target.value) || '0', 10) })} inputMode="numeric" style={inp} placeholder="15" /></label>}
                    {isDollar && <label style={lbl}>{t('pos.amount_usd')}<input value={centsToDollars(b.valueCents)} onChange={(e) => updateBenefit(i, { valueCents: dollarsToCents(onlyNum(e.target.value)) })} inputMode="decimal" style={inp} /></label>}
                    {b.benefitType === 'product_discount' && <label style={lbl}>{t('pos.est_cost_basis_usd')}<input value={centsToDollars(b.allocatedValueCents)} onChange={(e) => updateBenefit(i, { allocatedValueCents: dollarsToCents(onlyNum(e.target.value)) })} inputMode="decimal" style={inp} /></label>}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                      <label style={{ ...lbl, flex: 1 }}>{t('pos.min_days_between')}<input value={String(b.minDaysBetween)} onChange={(e) => updateBenefit(i, { minDaysBetween: parseInt(onlyInt(e.target.value) || '0', 10) })} inputMode="numeric" style={inp} /></label>
                      <label style={{ ...lbl, flex: 1 }}>{t('pos.max_per_cycle')}<input value={b.maxPerCycle == null ? '' : String(b.maxPerCycle)} onChange={(e) => { const v = onlyInt(e.target.value); updateBenefit(i, { maxPerCycle: v ? parseInt(v, 10) : null }); }} inputMode="numeric" style={inp} placeholder="∞" /></label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 8, flex: 1 }}><input type="checkbox" checked={b.rolloverAllowed} onChange={(e) => updateBenefit(i, { rolloverAllowed: e.target.checked })} /> {t('pos.rolls_over')}</label>
                    </div>
                  </div>
                );
              })}
              <div style={{ borderTop: '1px solid var(--line,#E2D6C2)', marginTop: 14, paddingTop: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{t('pos.credit_rules')}</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <label style={{ ...lbl, flex: 1 }}>{t('pos.credit_expiry_days')}<input value={creditExpiryDays} onChange={(e) => setCreditExpiryDays(onlyInt(e.target.value))} inputMode="numeric" style={inp} placeholder={t('pos.never')} /></label>
                  <label style={{ ...lbl, flex: 1 }}>{t('pos.rollover_max_cycles')}<input value={rolloverMaxCycles} onChange={(e) => setRolloverMaxCycles(onlyInt(e.target.value))} inputMode="numeric" style={inp} /></label>
                  <label style={{ ...lbl, flex: 1.3 }}>{t('pos.allocate_value')}<select value={allocationTiming} onChange={(e) => setAllocationTiming(e.target.value)} style={inp}>{ALLOCATION().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 8 }}><input type="checkbox" checked={rolloverAllowed} onChange={(e) => setRolloverAllowed(e.target.checked)} /> {t('pos.unused_credits_roll_over_to_the_chql')}</label>
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <label style={lbl}>{t('pos.commission_basis')}<select value={techCommissionBasis} onChange={(e) => setTechCommissionBasis(e.target.value)} style={inp}>{COMMISSION_BASIS().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              {techCommissionBasis === 'fixed' && <label style={lbl}>{t('pos.fixed_amount_per_redemption_usd')}<input value={techFixed} onChange={(e) => setTechFixed(onlyNum(e.target.value))} inputMode="decimal" style={inp} placeholder="20.00" /></label>}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <label style={{ ...lbl, flex: 1 }}>{t('pos.technician_split')}<input value={techSplit} onChange={(e) => setTechSplit(onlyInt(e.target.value))} inputMode="numeric" style={inp} /></label>
                <div style={{ flex: 1 }}><div style={lbl}>{t('pos.owner_house')}</div><div style={{ ...inp, background: '#F4ECDD', color: '#6A5A46' }}>{ownerPct}%</div></div>
              </div>
              <p style={help}>{t('pos.tips_always_pass_100_to_the_1ybk')}</p>

              <div style={{ marginTop: 14, border: '1px solid var(--line,#E2D6C2)', borderRadius: 10, padding: 12, background: '#FBF6EC' }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>{t('pos.profitability_preview')}{' '}<span className="muted" style={{ fontWeight: 500 }}>{t('pos.per_cycle_assuming_all_benefits_fully_gb3b')}</span></div>
                <Row k={t('pos.member_price_cycle')} v={money(econ.priceCents)} />
                <Row k={t('pos.estimated_benefit_cost_cycle')} v={`− ${money(econ.benefitCost)}`} />
                <Row k={t('pos.estimated_gross_margin_cycle')} v={`${money(econ.margin)}${econ.marginPct == null ? '' : ` · ${econ.marginPct}%`}`} bold tone={econ.margin < 0 ? 'danger' : 'good'} />
                {econ.eligibleValue > 0 && <Row k={t('pos.eligible_service_value_at_full_usage_a28o', { techPct: String(techPct) })} v={money(econ.eligibleValue)} muted />}
                {econ.eligibleValue > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('pos.the_technician_s_amount_is_calculated_10qs')}</div>}
                {econ.margin < 0 && <div style={{ color: '#A33B3B', fontSize: 12, marginTop: 6, fontWeight: 600 }}>{t('pos.this_plan_loses_money_each_cycle_cm71')}</div>}
                {!splitOk && <div style={{ color: '#A33B3B', fontSize: 12, marginTop: 6, fontWeight: 600 }}>{t('pos.technician_owner_split_must_total_100')}</div>}
              </div>
            </div>
          )}
        </div>

        {err && <div style={{ color: 'var(--danger,#A33B3B)', fontSize: 12, marginTop: 10 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 16 }}>
          <button className="btn" onClick={back} disabled={step === 0 || busy}>{t('pos.back')}</button>
          {step < STEPS().length - 1
            ? <button className="btn" style={{ background: GOLD, color: '#fff', border: 'none', fontWeight: 700 }} onClick={next} disabled={!canNext}>{t('pos.next')}</button>
            : <button className="btn" style={{ background: GOLD, color: '#fff', border: 'none', fontWeight: 700 }} onClick={publish} disabled={busy || !splitOk || !nameOk}>{busy ? t('pos.publishing') : t('pos.publish_plan')}</button>}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, bold, muted, tone }: { k: string; v: string; bold?: boolean; muted?: boolean; tone?: 'good' | 'danger' }) {
  const color = tone === 'danger' ? '#A33B3B' : tone === 'good' ? '#2E7D55' : muted ? '#8A7A64' : '#3A2E20';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', color: muted ? '#8A7A64' : '#5A4A36' }}>
      <span>{k}</span><span style={{ fontWeight: bold ? 800 : 600, color }}>{v}</span>
    </div>
  );
}
