// eligibility.ts — BUILD_PLAN Phase 5: may THIS customer use THIS deal, here, now, for these services — and if not, WHY.
// Pure (no I/O). Every column the deal carries is enforced (bug 5: new-customers-only, members-only, per-customer limit,
// minimum spend, days, hours and lead time were stored and never checked; bug 6: the date window was ignored), plus the
// rule builder's AND/OR groups. The answer always lists EVERY reason (the POS "why not" panel and the customer app show
// them), not just the first.

export type Channel = 'pos' | 'online' | 'customer_app' | 'ai_receptionist';
export const CHANNELS: readonly Channel[] = ['pos', 'online', 'customer_app', 'ai_receptionist'];

export type Rule =
  | { type: 'service_in'; serviceIds: string[] }
  | { type: 'min_spend'; cents: number }
  | { type: 'min_visits'; count: number }
  | { type: 'max_visits'; count: number }
  | { type: 'day_of_week'; days: number[] }
  | { type: 'time_between'; fromMinute: number; toMinute: number }
  | { type: 'birthday_month' }
  | { type: 'member' }
  | { type: 'not_member' }
  | { type: 'channel_in'; channels: Channel[] }
  | { type: 'branch_in'; branchIds: string[] }
  | { type: 'lapsed'; days: number }
  | { type: 'technician_in'; technicianIds: string[] };
export interface RuleGroup { all?: RuleNode[]; any?: RuleNode[] }
export type RuleNode = Rule | RuleGroup;
export const RULE_TYPES = ['service_in', 'min_spend', 'min_visits', 'max_visits', 'day_of_week', 'time_between', 'birthday_month', 'member', 'not_member', 'channel_in', 'branch_in', 'lapsed', 'technician_in'] as const;

export interface DealTerms {
  id: string; kind: string; status: string; branchId: string | null;
  ownerType?: string; technicianId?: string | null;
  startsAt: string | null; endsAt: string | null;
  daysOfWeek?: number[] | null; validFromMinute?: number | null; validToMinute?: number | null;
  newCustomersOnly: boolean; memberOnly: boolean; minSpendCents?: number | null; bookingLeadMinutes?: number | null;
  maxRedemptions?: number | null; maxPerCustomer?: number | null;
  serviceIds: string[]; channels?: string[] | null; requiresCode?: boolean;
  rules?: RuleGroup | null; suspendedAt?: string | null;
  budgetCents?: number | null; budgetReservedCents?: number | null;
  allowTechSubstitution?: boolean;
}
export interface CustomerFacts { id: string | null; paidVisits: number; isMember: boolean; birthdayMonth?: number | null; lastVisitAt?: number | null }
export interface EligibilityFacts {
  now: number;
  channel: Channel;
  branchId: string | null;
  timezone?: string | null;
  serviceIds: string[];
  spendCents: number;
  /** when the service happens (a booking's start); POS: now */
  serviceAt?: number | null;
  technicianId?: string | null;
  customer: CustomerFacts | null;
  /** places already taken (held/consumed/redeemed) and this customer's own */
  usage?: { taken: number; byCustomer: number } | null;
  codeProvided?: boolean;
  techFrozen?: boolean;
  engineOff?: boolean;
  tenantDisabled?: boolean;
  settings?: { allowedNewCustomer?: boolean; allowedExistingCustomer?: boolean } | null;
}
/** V-5 (Oct 27 2026): `params` carry the variable parts (days, minutes, cents, counts) so the POS words a reason in the
 *  cashier's language from its code (errors.dealReason.<code>); `message` stays the English sentence. */
export interface Reason { code: string; message: string; params?: Record<string, number | string | number[]> }
/** An eligibility / refusal reason (the engine's reason vocabulary — not an API error code). */
export const reason = (code: string, message: string, params?: Reason['params']): Reason => (params ? { code, message, params } : { code, message });
export interface EligibilityResult { eligible: boolean; reasons: Reason[]; eligibleServiceIds: string[] }

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 12 || 12)}:${String(m % 60).padStart(2, '0')} ${m >= 720 ? 'PM' : 'AM'}`;
const money = (c: number) => '$' + (c / 100).toFixed(2);

/** Day of week (0=Sun) and minutes past midnight of `at` in the salon's timezone. */
export function localClock(at: number, timezone?: string | null): { dow: number; minute: number; month: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(at));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { dow, minute: Number(get('hour')) * 60 + Number(get('minute')), month: Number(get('month')) };
  } catch {
    const d = new Date(at); return { dow: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes(), month: d.getUTCMonth() + 1 };
  }
}

function inWindow(minute: number, from: number, to: number): boolean { return from <= to ? minute >= from && minute < to : minute >= from || minute < to; }

function evalRule(r: Rule, f: EligibilityFacts): Reason | null {
  const at = f.serviceAt ?? f.now;
  const clock = localClock(at, f.timezone);
  switch (r.type) {
    case 'service_in': return f.serviceIds.some((s) => r.serviceIds.includes(s)) ? null : { code: 'rule_service', message: 'Not valid for the services selected.' };
    case 'min_spend': return f.spendCents >= r.cents ? null : { code: 'rule_min_spend', message: `Spend at least ${money(r.cents)}.`, params: { cents: r.cents } };
    case 'min_visits': return (f.customer?.paidVisits ?? 0) >= r.count ? null : { code: 'rule_min_visits', message: `For customers with at least ${r.count} visit${r.count === 1 ? '' : 's'}.`, params: { count: r.count } };
    case 'max_visits': return (f.customer?.paidVisits ?? 0) <= r.count ? null : { code: 'rule_max_visits', message: `For customers with at most ${r.count} visit${r.count === 1 ? '' : 's'}.`, params: { count: r.count } };
    case 'day_of_week': return r.days.includes(clock.dow) ? null : { code: 'rule_day', message: `Valid on ${r.days.map((d) => DAY_NAMES[d]).join(', ')}.`, params: { days: [...r.days] } };
    case 'time_between': return inWindow(clock.minute, r.fromMinute, r.toMinute) ? null : { code: 'rule_time', message: `Valid ${hhmm(r.fromMinute)}–${hhmm(r.toMinute)}.`, params: { fromMinute: r.fromMinute, toMinute: r.toMinute } };
    case 'birthday_month': return f.customer?.birthdayMonth && f.customer.birthdayMonth === clock.month ? null : { code: 'rule_birthday', message: 'Valid in your birthday month.' };
    case 'member': return f.customer?.isMember ? null : { code: 'rule_member', message: 'For members only.' };
    case 'not_member': return f.customer?.isMember ? { code: 'rule_not_member', message: 'Not for members (they have their own benefits).' } : null;
    case 'channel_in': return r.channels.includes(f.channel) ? null : { code: 'rule_channel', message: 'Not available here.' };
    case 'branch_in': return f.branchId && r.branchIds.includes(f.branchId) ? null : { code: 'rule_branch', message: 'Not valid at this location.' };
    case 'lapsed': {
      const last = f.customer?.lastVisitAt;
      return last == null || f.now - last >= r.days * 86_400_000 ? null : { code: 'rule_lapsed', message: `For customers who haven't visited in ${r.days} days.`, params: { sinceDays: r.days } };
    }
    case 'technician_in': return f.technicianId && r.technicianIds.includes(f.technicianId) ? null : { code: 'rule_technician', message: 'Valid with selected technicians only.' };
  }
}

function isGroup(n: RuleNode): n is RuleGroup { return !!n && typeof n === 'object' && !('type' in n); }

/** Evaluate an AND/OR rule tree. Returns the reasons it fails (empty = passes). */
export function evaluateRules(g: RuleGroup | null | undefined, f: EligibilityFacts): Reason[] {
  if (!g || (!g.all?.length && !g.any?.length)) return [];
  const out: Reason[] = [];
  for (const n of g.all ?? []) out.push(...(isGroup(n) ? evaluateRules(n, f) : [evalRule(n, f)].filter((x): x is Reason => !!x)));
  if (g.any?.length) {
    const branches = g.any.map((n) => (isGroup(n) ? evaluateRules(n, f) : [evalRule(n, f)].filter((x): x is Reason => !!x)));
    if (!branches.some((b) => b.length === 0)) out.push({ code: 'rule_any', message: 'One of these must apply: ' + branches.map((b) => b.map((r) => r.message).join(' and ')).join(' — or — ') });
  }
  return out;
}

/** Validate a rule tree from the builder. Returns problems (empty = valid). Depth ≤ 4, ≤ 40 rules. */
export function validateRules(g: unknown, depth = 0, count = { n: 0 }): string[] {
  if (g == null) return [];
  if (typeof g !== 'object' || Array.isArray(g)) return ['Rules must be a group ({ all: [...] } or { any: [...] }).'];
  if (depth > 3) return ['Rules are nested too deeply (at most 4 levels).'];
  const grp = g as Record<string, unknown>;
  const errs: string[] = [];
  for (const k of Object.keys(grp)) if (k !== 'all' && k !== 'any') errs.push(`Unknown rule group key "${k}".`);
  for (const k of ['all', 'any'] as const) {
    const list = grp[k]; if (list == null) continue;
    if (!Array.isArray(list)) { errs.push(`"${k}" must be a list.`); continue; }
    for (const n of list) {
      if (n && typeof n === 'object' && !('type' in (n as any))) { errs.push(...validateRules(n, depth + 1, count)); continue; }
      count.n++;
      const r = n as any;
      if (!r || !RULE_TYPES.includes(r.type)) { errs.push(`Unknown rule type "${r?.type}".`); continue; }
      const posInt = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
      if (r.type === 'service_in' && (!Array.isArray(r.serviceIds) || !r.serviceIds.length)) errs.push('A service rule needs at least one service.');
      if (r.type === 'branch_in' && (!Array.isArray(r.branchIds) || !r.branchIds.length)) errs.push('A location rule needs at least one location.');
      if (r.type === 'technician_in' && (!Array.isArray(r.technicianIds) || !r.technicianIds.length)) errs.push('A technician rule needs at least one technician.');
      if (r.type === 'channel_in' && (!Array.isArray(r.channels) || !r.channels.length || r.channels.some((c: string) => !CHANNELS.includes(c as Channel)))) errs.push('A channel rule needs valid channels.');
      if (r.type === 'min_spend' && (!posInt(r.cents) || r.cents <= 0)) errs.push('Minimum spend must be a whole number of cents above zero.');
      if ((r.type === 'min_visits' || r.type === 'max_visits') && !posInt(r.count)) errs.push('Visit counts must be whole numbers.');
      if (r.type === 'lapsed' && (!posInt(r.days) || r.days <= 0)) errs.push('Lapsed days must be a whole number above zero.');
      if (r.type === 'day_of_week' && (!Array.isArray(r.days) || !r.days.length || r.days.some((d: number) => !Number.isInteger(d) || d < 0 || d > 6))) errs.push('Days must be 0 (Sunday) to 6 (Saturday).');
      if (r.type === 'time_between' && (![r.fromMinute, r.toMinute].every((m) => Number.isInteger(m) && m >= 0 && m < 1440) || r.fromMinute === r.toMinute)) errs.push('Hours must be two different times of day.');
    }
  }
  if (depth === 0 && count.n > 40) errs.push('Too many rules (at most 40).');
  return errs;
}

/** Every reason this deal cannot be used right now (empty list = eligible). */
export function evaluateEligibility(t: DealTerms, f: EligibilityFacts): EligibilityResult {
  const reasons: Reason[] = [];
  const add = (code: string, message: string, params?: Reason['params']) => reasons.push(params ? { code, message, params } : { code, message });
  if (f.engineOff) add('engine_off', 'Deals are temporarily paused.');
  if (f.tenantDisabled) add('tenant_disabled', 'Deals are not available at this salon right now.');
  if (t.suspendedAt) add('suspended', 'This deal is no longer available.');
  else if (t.status !== 'active') add('not_active', t.status === 'paused' ? 'This deal is paused.' : t.status === 'sold_out' ? 'This deal has sold out.' : t.status === 'expired' ? 'This deal has ended.' : 'This deal is not available.', { status: String(t.status) });
  if (t.kind === 'announcement') add('not_redeemable', 'This is an announcement, not a discount.');
  if (t.startsAt && f.now < Date.parse(t.startsAt)) add('not_started', 'This deal has not started yet.');
  if (t.endsAt && f.now > Date.parse(t.endsAt)) add('ended', 'This deal has ended.');
  // the SERVICE must also fall in the window (a booking made today for after the deal ends does not qualify)
  const at = f.serviceAt ?? f.now;
  if (f.serviceAt != null && t.endsAt && at > Date.parse(t.endsAt) && !(f.now > Date.parse(t.endsAt))) add('service_after_end', 'The appointment is after this deal ends.');
  if (f.serviceAt != null && t.startsAt && at < Date.parse(t.startsAt) && !(f.now < Date.parse(t.startsAt))) add('service_before_start', 'The appointment is before this deal starts.');
  if (t.branchId && f.branchId && t.branchId !== f.branchId) add('wrong_branch', 'Not valid at this location.');
  if (t.channels && t.channels.length && !t.channels.includes(f.channel)) add('wrong_channel', 'Not available here.');
  const clock = localClock(at, f.timezone);
  if (t.daysOfWeek && t.daysOfWeek.length && !t.daysOfWeek.includes(clock.dow)) add('wrong_day', `Valid on ${t.daysOfWeek.map((d) => DAY_NAMES[d]).join(', ')}.`, { days: [...t.daysOfWeek] });
  if (t.validFromMinute != null && t.validToMinute != null && !inWindow(clock.minute, t.validFromMinute, t.validToMinute)) add('wrong_time', `Valid ${hhmm(t.validFromMinute)}–${hhmm(t.validToMinute)}.`, { fromMinute: t.validFromMinute, toMinute: t.validToMinute });
  if (t.bookingLeadMinutes != null && t.bookingLeadMinutes > 0 && f.serviceAt != null && f.serviceAt - f.now < t.bookingLeadMinutes * 60_000) add('lead_time', `Book at least ${t.bookingLeadMinutes >= 60 && t.bookingLeadMinutes % 60 === 0 ? `${t.bookingLeadMinutes / 60} hour${t.bookingLeadMinutes === 60 ? '' : 's'}` : `${t.bookingLeadMinutes} minutes`} ahead.`, { minutes: t.bookingLeadMinutes });
  const visits = f.customer?.paidVisits ?? 0;
  if (t.newCustomersOnly && visits > 0) add('new_customers_only', 'For new customers only.');
  if (f.settings?.allowedExistingCustomer === false && visits > 0) add('new_customers_only', 'For new customers only.');
  if (f.settings?.allowedNewCustomer === false && visits === 0) add('existing_customers_only', 'For returning customers only.');
  if (t.memberOnly && !f.customer?.isMember) add('members_only', 'For members only.');
  if ((t.newCustomersOnly || t.memberOnly || t.maxPerCustomer) && !f.customer?.id) add('customer_required', 'Choose the customer first.');
  const eligibleServiceIds = t.serviceIds.length ? f.serviceIds.filter((s) => t.serviceIds.includes(s)) : [...f.serviceIds];
  if (t.serviceIds.length && !eligibleServiceIds.length) add('no_eligible_service', 'Not valid for the services selected.');
  if (t.minSpendCents != null && t.minSpendCents > 0 && f.spendCents < t.minSpendCents) add('min_spend', `Spend at least ${money(t.minSpendCents)}.`, { cents: t.minSpendCents });
  if (f.usage) {
    if (t.maxRedemptions != null && f.usage.taken >= t.maxRedemptions) add('sold_out', 'This deal has sold out.');
    if (t.maxPerCustomer != null && f.customer?.id && f.usage.byCustomer >= t.maxPerCustomer) add('per_customer_limit', t.maxPerCustomer === 1 ? 'Already used — one per customer.' : `Already used ${t.maxPerCustomer} times — the limit per customer.`, { max: t.maxPerCustomer });
  }
  if (t.budgetCents != null && (t.budgetReservedCents ?? 0) >= t.budgetCents) add('budget_exhausted', 'This deal’s budget has been used up.');
  if (t.requiresCode && !f.codeProvided) add('code_required', 'Enter the coupon code.');
  if (f.techFrozen) add('tech_frozen', 'This technician’s deals are paused by the platform.');
  reasons.push(...evaluateRules(t.rules, f));
  // one reason per code (a setting and a column can say the same thing)
  const uniq = reasons.filter((r, i) => reasons.findIndex((x) => x.code === r.code) === i);
  return { eligible: uniq.length === 0, reasons: uniq, eligibleServiceIds };
}

/** The epoch ms of a wall-clock date + time in a timezone ("2026-10-12", "14:30", "America/New_York"). */
export function zonedEpoch(date: string, time: string, timezone?: string | null): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '')); const tm = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
  if (!dm || !tm) return null;
  const guess = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  if (!timezone) return guess;
  const offsetAt = (t: number) => {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
      const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
      return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - t;
    } catch { return 0; }
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}
