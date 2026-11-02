// DealWizard.tsx — BUILD_PLAN Phase 5: create (or edit) a deal, a coupon, an automatic promotion or an announcement in
// five steps: what it is → the offer → who and when → rules → review. The review step runs the SIMULATOR (the server's
// eligibility engine + the real pricing engine under the salon's stacking policy) on a sample visit before anything is
// saved. Nothing about money is computed here — prices come from the catalog, the discount from the server.
import { useEffect, useMemo, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posDealsApi, type DealView, type DealPreview } from '../../api/posDealsApi';
import { posServicesApi } from '../../api/posServicesApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney, displayLocale } from '../../i18n/format';
import { dealReasonText } from '../../i18n/deal-reason-text';   // V-5 (Oct 27 2026)

const money = (c: number) => fmtMoney(c || 0);
// weekdays (Jan 4 2026 is a Sunday): the stored rule text keeps the English short codes ("Mon,Tue"); the screen shows and also
// accepts the POS language's short names
const dayNames = (locale: string) => [0, 1, 2, 3, 4, 5, 6].map((i) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + i))));
const DAYS = dayNames('en-US');
const dayIndex = (x: string) => { const s = x.trim().toLowerCase(); const i = DAYS.findIndex((d) => d.toLowerCase() === s); return i >= 0 ? i : dayNames(displayLocale()).findIndex((d) => d.toLowerCase() === s); };
const CHANNELS = (): [string, string][] => [['pos', t('growth.deals.channel.pos')], ['online', t('growth.deals.channel.online')], ['customer_app', t('growth.deals.channel.customer_app')], ['ai_receptionist', t('growth.deals.channel.ai_receptionist')]];
const RULES = (): [string, string][] => [['min_visits', t('growth.deals.rule.min_visits')], ['max_visits', t('growth.deals.rule.max_visits')], ['lapsed', t('growth.deals.rule.lapsed')], ['birthday_month', t('growth.deals.rule.birthday_month')], ['member', t('growth.deals.rule.member')], ['not_member', t('growth.deals.rule.not_member')], ['min_spend', t('growth.deals.rule.min_spend')], ['day_of_week', t('growth.deals.rule.day_of_week')], ['time_between', t('growth.deals.rule.time_between')]];
const STEPS = (): string[] => [t('growth.deals.step.what'), t('growth.deals.step.offer'), t('growth.deals.step.who'), t('growth.deals.step.rules'), t('growth.deals.step.review')];

type RuleRow = { type: string; value: string };
export interface WizardDraft {
  kind: 'deal' | 'coupon' | 'automatic' | 'announcement'; title: string; shortDescription: string; terms: string; code: string;
  discountType: 'percent' | 'fixed' | 'fixed_price'; value: string; maxDiscount: string; serviceIds: string[]; stackable: boolean; stackGroup: string; priority: string;
  startsAt: string; endsAt: string; daysOfWeek: number[]; fromTime: string; toTime: string; newCustomersOnly: boolean; memberOnly: boolean;
  minSpend: string; maxRedemptions: string; maxPerCustomer: string; budget: string; bookingLeadHours: string; channels: string[];
  ruleMode: 'all' | 'any'; rules: RuleRow[];
}
export const BLANK_DRAFT: WizardDraft = { kind: 'deal', title: '', shortDescription: '', terms: '', code: '', discountType: 'percent', value: '', maxDiscount: '', serviceIds: [], stackable: false, stackGroup: '', priority: '100',
  startsAt: '', endsAt: '', daysOfWeek: [], fromTime: '', toTime: '', newCustomersOnly: false, memberOnly: false, minSpend: '', maxRedemptions: '', maxPerCustomer: '', budget: '', bookingLeadHours: '', channels: [], ruleMode: 'all', rules: [] };

const minutes = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const intOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const centsOrNull = (s: string) => (s.trim() === '' ? null : parseDollarsToCents(s));

/** The draft as the API takes it (the server validates every field again — bug 21). */
export function toBody(d: WizardDraft): Record<string, unknown> {
  const rules = d.rules.filter((r) => r.type).map((r) => {
    if (r.type === 'min_spend') return { type: r.type, cents: parseDollarsToCents(r.value) ?? 0 };
    if (r.type === 'min_visits' || r.type === 'max_visits') return { type: r.type, count: Number(r.value) || 0 };
    if (r.type === 'lapsed') return { type: r.type, days: Number(r.value) || 0 };
    if (r.type === 'day_of_week') return { type: r.type, days: r.value.split(',').map(dayIndex).filter((x) => x >= 0) };
    if (r.type === 'time_between') { const [a, b] = r.value.split('-').map((x) => minutes(x.trim())); return { type: r.type, fromMinute: a, toMinute: b }; }
    return { type: r.type };
  });
  const body: Record<string, unknown> = {
    kind: d.kind, title: d.title.trim(), shortDescription: d.shortDescription.trim() || null, terms: d.terms.trim() || null, discountType: d.discountType,
    serviceIds: d.serviceIds, stackable: d.stackable, stackGroup: d.stackGroup.trim() || null, priority: Number(d.priority) || 100,
    startsAt: d.startsAt ? new Date(d.startsAt).toISOString() : null, endsAt: d.endsAt ? new Date(d.endsAt).toISOString() : null,
    daysOfWeek: d.daysOfWeek.length ? d.daysOfWeek : null, validFromMinute: minutes(d.fromTime), validToMinute: minutes(d.toTime),
    newCustomersOnly: d.newCustomersOnly, memberOnly: d.memberOnly, minSpendCents: centsOrNull(d.minSpend), maxRedemptions: intOrNull(d.maxRedemptions),
    maxPerCustomer: intOrNull(d.maxPerCustomer), budgetCents: centsOrNull(d.budget), bookingLeadMinutes: d.bookingLeadHours.trim() === '' ? null : Math.round(Number(d.bookingLeadHours) * 60),
    channels: d.channels.length ? d.channels : null, maxDiscountCents: centsOrNull(d.maxDiscount), rules: rules.length ? { [d.ruleMode]: rules } : {},
  };
  if (d.kind === 'announcement') { body.discountType = 'fixed'; body.discountCents = 0; }
  else if (d.discountType === 'percent') body.discountPercent = d.value.trim() === '' ? null : Number(d.value);
  else body.discountCents = parseDollarsToCents(d.value);
  if (d.kind === 'coupon' && d.code.trim()) body.code = d.code.trim();
  return body;
}

export function fromDeal(v: DealView): WizardDraft {
  const r: any = v.rules ?? {}; const mode: 'all' | 'any' = Array.isArray(r.any) && r.any.length ? 'any' : 'all';
  const hhmm = (m: number | null | undefined) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return { ...BLANK_DRAFT, kind: (v.kind ?? 'deal') as any, title: v.title, shortDescription: v.shortDescription ?? '', terms: v.terms ?? '', discountType: v.discountType as any,
    value: v.discountType === 'percent' ? String(v.discountPercent ?? '') : ((v.discountCents ?? 0) / 100).toFixed(2), maxDiscount: v.maxDiscountCents ? (v.maxDiscountCents / 100).toFixed(2) : '',
    serviceIds: v.serviceIds ?? [], stackable: v.stackable, stackGroup: v.stackGroup ?? '', priority: String(v.priority ?? 100),
    startsAt: v.startsAt ? v.startsAt.slice(0, 16) : '', endsAt: v.endsAt ? v.endsAt.slice(0, 16) : '', daysOfWeek: v.daysOfWeek ?? [], fromTime: hhmm(v.validFromMinute), toTime: hhmm(v.validToMinute),
    newCustomersOnly: v.newCustomersOnly, memberOnly: v.memberOnly, minSpend: v.minSpendCents ? (v.minSpendCents / 100).toFixed(2) : '', maxRedemptions: v.maxRedemptions != null ? String(v.maxRedemptions) : '',
    maxPerCustomer: v.maxPerCustomer != null ? String(v.maxPerCustomer) : '', budget: v.budgetCents ? (v.budgetCents / 100).toFixed(2) : '', bookingLeadHours: v.bookingLeadMinutes ? String(v.bookingLeadMinutes / 60) : '',
    channels: v.channels ?? [], ruleMode: mode, rules: ((r[mode] ?? []) as any[]).map((x) => ({ type: x.type, value: x.cents != null ? (x.cents / 100).toFixed(2) : x.count != null ? String(x.count) : x.days != null && !Array.isArray(x.days) ? String(x.days) : Array.isArray(x.days) ? x.days.map((n: number) => dayNames(displayLocale())[n]).join(',') : x.fromMinute != null ? `${hhmm(x.fromMinute)}-${hhmm(x.toMinute)}` : '' })) };
}

/** onActivate (Marketing → Promotions, guide §08 "Save Draft and authorized Activate"): a second final button saves the draft and
 *  then runs the normal, permission-checked Publish — the server's lifecycle rules decide (scheduled when it starts later). */
export function DealWizard({ editing, onDone, onCancel, initialKind, heading, onActivate }: { editing?: DealView | null; onDone: (v: DealView) => void; onCancel: () => void; initialKind?: WizardDraft['kind']; heading?: string; onActivate?: (v: DealView) => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<WizardDraft>(editing ? fromDeal(editing) : { ...BLANK_DRAFT, kind: initialKind ?? BLANK_DRAFT.kind });
  const [services, setServices] = useState<{ id: string; name: string; priceCents: number }[]>([]);
  const [sample, setSample] = useState({ serviceIds: [] as string[], paidVisits: '0', isMember: false, date: '', time: '' });
  const [preview, setPreview] = useState<DealPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<WizardDraft>) => { setD((x) => ({ ...x, ...p })); setPreview(null); };

  useEffect(() => { (posServicesApi.list() as Promise<any>).then((r) => setServices((Array.isArray(r) ? r : r?.items ?? r?.services ?? []).map((s: any) => ({ id: String(s.id ?? s.serviceId), name: String(s.name), priceCents: Number(s.priceCents ?? s.price_cents ?? 0) })))).catch(() => setServices([])); }, []);
  const catalogCents = useMemo(() => services.filter((s) => d.serviceIds.includes(s.id)).reduce((n, s) => n + s.priceCents, 0), [services, d.serviceIds]);

  const runPreview = async () => {
    setError(null);
    try {
      setPreview(await posDealsApi.preview({ ...toBody(d), ...(editing ? { dealId: editing.id } : {}) }, { serviceIds: sample.serviceIds.length ? sample.serviceIds : d.serviceIds, paidVisits: Number(sample.paidVisits) || 0, isMember: sample.isMember, ...(sample.date && sample.time ? { date: sample.date, startTime: sample.time } : {}), channel: 'pos' }) as DealPreview);
    } catch (e: any) { setError(e?.message || t('pos.the_simulator_could_not_run')); }
  };
  const save = async (activate = false) => {
    setBusy(true); setError(null);
    let saved: DealView | null = null;
    try {
      const body = toBody(d);
      saved = (editing ? await posDealsApi.update(editing.id, (({ kind: _kind, code: _code, ...rest }) => rest)(body as any)) : await posDealsApi.create(body)) as DealView;
    } catch (e: any) { setError(e?.message || t('pos.could_not_save_the_deal')); }
    finally { setBusy(false); }
    if (!saved) return;
    // the host runs Publish and reports its own outcome (a refusal leaves the saved DRAFT and says so — never "live")
    if (activate && onActivate) await onActivate(saved);
    onDone(saved);
  };
  const valueOk = d.kind === 'announcement' || d.value.trim() !== '';
  const canNext = step === 0 ? d.title.trim().length > 0 : step === 1 ? valueOk : true;

  return (
    <section className="panel" data-testid="deal-wizard" style={{ marginBottom: 16 }}>
      <div className="p-h">{editing ? t('pos.edit_title', { title: String(editing.title) }) : (heading ?? t('pos.new_deal_2'))}</div>
      <ol className="flex gap-3 m-0 p-0 mt-1" style={{ listStyle: 'none', fontSize: 12 }}>
        {STEPS().map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} style={{ fontWeight: i === step ? 800 : 500, color: i === step ? 'var(--ink)' : 'var(--muted)' }}>{i + 1}. {s}</li>)}
      </ol>

      {step === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <div className="lf"><label>{t('pos.type')}</label>
            <select aria-label={t('pos.deal_type')} value={d.kind} onChange={(e) => set({ kind: e.target.value as any })} style={{ width: '100%' }} disabled={!!editing}>
              <option value="deal">{t('pos.deal_customers_book_it_or_staff_znug')}</option>
              <option value="coupon">{t('pos.coupon_needs_a_code')}</option>
              <option value="automatic">{t('pos.automatic_promotion_offered_at_checkout_when_5jyp')}</option>
              <option value="announcement">{t('pos.announcement_shown_to_customers_no_discount')}</option>
            </select>
          </div>
          <div className="lf"><label>{t('pos.title')}</label><input aria-label={t('pos.title')} value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder={t('pos.spring_gel_special')} style={{ width: '100%' }} /></div>
          <div className="lf"><label>{t('pos.short_description')}</label><input aria-label={t('pos.short_description')} value={d.shortDescription} onChange={(e) => set({ shortDescription: e.target.value })} style={{ width: '100%' }} /></div>
          <div className="lf"><label>{t('pos.terms_customers_see_these')}</label><input aria-label={t('pos.terms')} value={d.terms} onChange={(e) => set({ terms: e.target.value })} placeholder={t('pos.one_per_customer_not_valid_with_110n')} style={{ width: '100%' }} /></div>
          {d.kind === 'coupon' && !editing && <div className="lf"><label>{t('pos.shared_code_optional_or_generate_single_158d')}</label><input aria-label={t('pos.coupon_code')} value={d.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder={t('pos.spring10')} style={{ width: '100%' }} /></div>}
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          {d.kind !== 'announcement' && <>
            <div className="lf"><label>{t('pos.discount_2')}</label>
              <select aria-label={t('pos.discount_type_2')} value={d.discountType} onChange={(e) => set({ discountType: e.target.value as any })} style={{ width: '100%' }}>
                <option value="percent">{t('pos.percent_off')}</option><option value="fixed">{t('pos.amount_off_2')}</option><option value="fixed_price">{t('pos.fixed_price')}</option>
              </select>
            </div>
            <div className="lf"><label>{d.discountType === 'percent' ? t('pos.percent_whole_number_1_100') : t('pos.amount')}</label><input aria-label={t('pos.discount_value')} value={d.value} onChange={(e) => set({ value: e.target.value })} inputMode="decimal" style={{ width: '100%' }} /></div>
            {d.discountType === 'percent' && <div className="lf"><label>{t('pos.cap_optional')}</label><input aria-label={t('pos.discount_cap')} value={d.maxDiscount} onChange={(e) => set({ maxDiscount: e.target.value })} inputMode="decimal" style={{ width: '100%' }} /></div>}
            <div className="lf"><label>{t('pos.combines_with_other_deals')}</label>
              <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" aria-label={t('pos.stackable')} checked={d.stackable} onChange={(e) => set({ stackable: e.target.checked })} /> {t('pos.stackable_if_the_salon_s_policy_1du2')}</label>
              <input aria-label={t('pos.stack_group')} value={d.stackGroup} onChange={(e) => set({ stackGroup: e.target.value })} placeholder={t('pos.stack_group_offers_in_one_group_ek6d')} style={{ width: '100%', marginTop: 4 }} />
            </div>
          </>}
          <div className="lf md:col-span-2"><label>{t('pos.services_empty_the_whole_ticket')}</label>
            <div className="flex flex-wrap gap-2" data-testid="wizard-services">
              {services.map((s) => (
                <label key={s.id} style={{ display: 'flex', gap: 4, fontSize: 12 }}>
                  <input type="checkbox" aria-label={s.name} checked={d.serviceIds.includes(s.id)} onChange={(e) => set({ serviceIds: e.target.checked ? [...d.serviceIds, s.id] : d.serviceIds.filter((x) => x !== s.id) })} /> {s.name} ({money(s.priceCents)})
                </label>
              ))}
            </div>
            {d.serviceIds.length > 0 && <div className="sub" style={{ fontSize: 12, marginTop: 4 }}>{t('pos.catalog_price_2')}{' '}{money(catalogCents)} {t('pos.the_deal_price_is_computed_by_1hbu')}</div>}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <div className="lf"><label>{t('pos.starts')}</label><input aria-label={t('pos.starts')} type="datetime-local" value={d.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></div>
          <div className="lf"><label>{t('pos.ends_2')}</label><input aria-label={t('pos.ends_2')} type="datetime-local" value={d.endsAt} onChange={(e) => set({ endsAt: e.target.value })} /></div>
          <div className="lf"><label>{t('pos.book_at_least_hours_ahead')}</label><input aria-label={t('pos.lead_time')} value={d.bookingLeadHours} onChange={(e) => set({ bookingLeadHours: e.target.value })} inputMode="decimal" /></div>
          <div className="lf md:col-span-2"><label>{t('pos.days_2')}</label>
            <div className="flex gap-2">{dayNames(displayLocale()).map((x, i) => <label key={i} style={{ fontSize: 12 }}><input type="checkbox" aria-label={x} checked={d.daysOfWeek.includes(i)} onChange={(e) => set({ daysOfWeek: e.target.checked ? [...d.daysOfWeek, i] : d.daysOfWeek.filter((n) => n !== i) })} /> {x}</label>)}</div>
          </div>
          <div className="lf"><label>{t('pos.hours')}</label><div className="flex gap-1"><input aria-label={t('pos.from_time')} type="time" value={d.fromTime} onChange={(e) => set({ fromTime: e.target.value })} /><input aria-label={t('pos.to_time')} type="time" value={d.toTime} onChange={(e) => set({ toTime: e.target.value })} /></div></div>
          <label style={{ display: 'flex', gap: 6, fontSize: 13 }}><input type="checkbox" aria-label={t('pos.new_customers_only')} checked={d.newCustomersOnly} onChange={(e) => set({ newCustomersOnly: e.target.checked })} /> {t('pos.new_customers_only')}</label>
          <label style={{ display: 'flex', gap: 6, fontSize: 13 }}><input type="checkbox" aria-label={t('pos.members_only')} checked={d.memberOnly} onChange={(e) => set({ memberOnly: e.target.checked })} /> {t('pos.members_only')}</label>
          <div className="lf"><label>{t('pos.minimum_spend')}</label><input aria-label={t('pos.minimum_spend_2')} value={d.minSpend} onChange={(e) => set({ minSpend: e.target.value })} inputMode="decimal" /></div>
          <div className="lf"><label>{t('pos.total_uses_cap')}</label><input aria-label={t('pos.total_uses')} value={d.maxRedemptions} onChange={(e) => set({ maxRedemptions: e.target.value })} inputMode="numeric" /></div>
          <div className="lf"><label>{t('pos.per_customer')}</label><input aria-label={t('pos.per_customer')} value={d.maxPerCustomer} onChange={(e) => set({ maxPerCustomer: e.target.value })} inputMode="numeric" /></div>
          <div className="lf"><label>{t('pos.budget_of_discounts')}</label><input aria-label={t('pos.budget')} value={d.budget} onChange={(e) => set({ budget: e.target.value })} inputMode="decimal" /></div>
          <div className="lf md:col-span-3"><label>{t('pos.where_it_can_be_used_none_1y44')}</label>
            <div className="flex gap-3 flex-wrap">{CHANNELS().map(([k, l]) => <label key={k} style={{ fontSize: 12 }}><input type="checkbox" aria-label={l} checked={d.channels.includes(k)} onChange={(e) => set({ channels: e.target.checked ? [...d.channels, k] : d.channels.filter((x) => x !== k) })} /> {l}</label>)}</div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-3" data-testid="rule-builder">
          <div className="flex gap-2 items-center" style={{ fontSize: 13 }}>
            {t('pos.customers_qualify_when')}
            <select aria-label={t('pos.rule_mode')} value={d.ruleMode} onChange={(e) => set({ ruleMode: e.target.value as any })}><option value="all">{t('pos.all_of_these_hold')}</option><option value="any">{t('pos.any_of_these_holds')}</option></select>
          </div>
          {d.rules.map((r, i) => (
            <div key={i} className="flex gap-2 mt-2">
              <select aria-label={t('pos.rule_v0', { v0: String(i + 1) })} value={r.type} onChange={(e) => set({ rules: d.rules.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)) })}>
                {RULES().map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {!['birthday_month', 'member', 'not_member'].includes(r.type) && <input aria-label={t('pos.rule_v0_value', { v0: String(i + 1) })} value={r.value} placeholder={r.type === 'day_of_week' ? dayNames(displayLocale()).slice(1, 3).join(',') : r.type === 'time_between' ? '10:00-14:00' : ''} onChange={(e) => set({ rules: d.rules.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />}
              <button className="btn ghost" onClick={() => set({ rules: d.rules.filter((_, j) => j !== i) })}>{t('pos.remove')}</button>
            </div>
          ))}
          <button className="btn" style={{ marginTop: 8 }} onClick={() => set({ rules: [...d.rules, { type: 'min_visits', value: '' }] })}>{t('pos.add_rule')}</button>
        </div>
      )}

      {step === 4 && (
        <div className="mt-3" data-testid="simulator">
          <div className="sub" style={{ fontSize: 13 }}>{t('pos.try_it_on_a_sample_visit_lasa')}</div>
          <div className="flex flex-wrap gap-3 mt-2 items-end">
            <div className="lf"><label>{t('pos.sample_services')}</label>
              <select aria-label={t('pos.sample_services')} multiple value={sample.serviceIds} onChange={(e) => setSample({ ...sample, serviceIds: Array.from(e.target.selectedOptions).map((o) => o.value) })} style={{ minWidth: 180 }}>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="lf"><label>{t('pos.visits_so_far')}</label><input aria-label={t('pos.sample_visits')} value={sample.paidVisits} onChange={(e) => setSample({ ...sample, paidVisits: e.target.value })} style={{ width: 70 }} /></div>
            <label style={{ fontSize: 13 }}><input type="checkbox" aria-label={t('pos.sample_is_a_member')} checked={sample.isMember} onChange={(e) => setSample({ ...sample, isMember: e.target.checked })} /> {t('pos.member')}</label>
            <div className="lf"><label>{t('pos.visit_date_time')}</label><div className="flex gap-1"><input aria-label={t('pos.sample_date')} type="date" value={sample.date} onChange={(e) => setSample({ ...sample, date: e.target.value })} /><input aria-label={t('pos.sample_time')} type="time" value={sample.time} onChange={(e) => setSample({ ...sample, time: e.target.value })} /></div></div>
            <button className="btn" onClick={() => void runPreview()}>{t('pos.run_simulator')}</button>
          </div>
          {preview && (
            <div data-testid="simulator-result" style={{ marginTop: 10, fontSize: 13 }}>
              {preview.problems.length > 0 && <div style={{ color: '#B4453C' }}>{t('pos.fix_first')}{' '}{preview.problems.join(' ')}</div>}
              {preview.eligibility.eligible
                ? <div>{t('pos.eligible_takes')}{' '}<strong>{money(preview.pricing.totalDiscountCents)}</strong> {t('pos.off_2')}{' '}{money(preview.pricing.subtotalCents)} {t('pos.pays_2')}{' '}{money(preview.pricing.subtotalCents - preview.pricing.totalDiscountCents)}).</div>
                : <div>{t('pos.not_eligible')}{' '}{preview.eligibility.reasons.map((r) => dealReasonText(r)).join(' ')}</div>}
              {preview.originalPriceCents != null && <div className="sub">{t('pos.deal_price')}{' '}{money(preview.originalPriceCents)} → {money(preview.finalPriceCents ?? 0)}</div>}
            </div>
          )}
        </div>
      )}

      {error && <div role="alert" style={{ color: '#B4453C', marginTop: 8, fontSize: 13 }}>{error}</div>}
      <div className="mt-4 pt-3 flex gap-2" style={{ borderTop: '1px solid var(--line)' }}>
        <button className="btn ghost" onClick={onCancel}>{t('pos.cancel')}</button>
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>{t('pos.back')}</button>}
        {step < STEPS().length - 1 ? <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>{t('pos.next')}</button>
          : <><button className={'btn' + (onActivate && !editing ? '' : ' primary')} disabled={busy || !d.title.trim() || !valueOk} onClick={() => void save()} data-testid="wiz-save">{busy ? t('pos.saving_2') : editing ? t('pos.save_changes') : t('pos.create_draft')}</button>
            {onActivate && !editing ? <button className="btn primary" disabled={busy || !d.title.trim() || !valueOk} onClick={() => void save(true)} data-testid="wiz-activate">{t('promo.saveActivate')}</button> : null}</>}
      </div>
    </section>
  );
}
