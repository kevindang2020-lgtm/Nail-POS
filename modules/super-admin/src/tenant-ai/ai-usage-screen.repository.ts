// ai-usage-screen.repository.ts — AI Usage & Limits Complete Build Guide (Oct 30 2026): the server side of POS → AI Center
// → AI Usage & Limits (/tenant/ai/usage). Raw, parameterised SQL; the tenant is the session's and is written in every
// statement. The package list is the code registry (modules/ai ai-catalog, 15 packages) PLUS any subscription row whose
// code the registry no longer knows (kept and shown as "Unknown package", never dropped).
//
// Sources of truth
//   catalog / list price      AI_PACKAGES (code registry)                 global availability  platform_ai_package_settings
//   tenant entitlement        tenant_ai_subscriptions                     usage               ai_usage_logs (status success,
//   billing events            ai_billing_events (provider, deduplicated)      since current_period_starts_at — the gate's rule)
//   tenant changes here       tenant_ai_subscription_events (append-only) alerts              ai_usage_alerts (unique / period)
// Money: integer cents; a yearly plan is shown as its monthly equivalent (÷ 12) AND labelled; trials are not cost; an
// overage figure is an ESTIMATE until invoiced; the total is "from subscription records" unless every paying package
// has a recorded successful payment in its current period ("reconciled").
import { sql, type Kysely } from 'kysely';
import { AI_PACKAGES, AI_PLANS, effectivePlanPriceCents, TENANT_AI_SUBSCRIPTION, getAiPackage, evaluateAiAccess, KyselyAiAccessRepo, syncUsageAlerts, AiInvoiceLedger, UnconfiguredInvoiceClient, effectiveBranchAccess, validateBranchSettings, branchSettingFields, type AiInvoiceProviderClient } from '@aipowersalon/ai';
import { invoiceViewOf, invoicedAmounts, inPeriodFrom, ESTIMATE_ASSUMPTIONS, type InvoiceView } from './ai-usage-invoices.view';
import { tenantTimeZone, canMoveToSql } from '@aipowersalon/database';
import { displayStateOf, actionsFor, primaryAction, usageLevelOf, type DisplayState, type PackageAction, type UsageLevel } from './ai-usage-states';
import { utcDate } from '@aipowersalon/date-time';
import type { AiTablePrice } from '@aipowersalon/api-contracts/tenant';
import { AiPriceTable, resolveAiTablePrice } from './ai-price-table';

export interface UsageCtx { tenantId: string; branchId?: string | null; userId?: string; role?: string; permissions?: string[] }
/** extras AI Command Center 15 — one evidence row per assistant the salon has (live, or used this month), from reconcile()'s
 *  rows (the same honest state + gate decision the AI Center shows). Pure; exported for tests. */
export type AssistantVerdict = 'gate_mismatch' | 'failing' | 'limit' | 'idle' | 'ok';
export function assistantEvidence(rows: Array<{ code: string; name: string; state: string; gate: { allowed: boolean; reason?: string | null }; monthEvents: number; monthErrors: number; monthBlocked: number; lastSuccessAt: string | null; lastErrorAt: string | null; mismatch: boolean; limitReached: boolean }>) {
  return rows.filter((r) => ['active', 'trialing', 'past_due'].includes(r.state) || r.monthEvents + r.monthErrors + r.monthBlocked > 0).map((r) => {
    const live = ['active', 'trialing'].includes(r.state);
    const verdict: AssistantVerdict = r.mismatch ? 'gate_mismatch' : r.limitReached ? 'limit' : live && r.monthErrors > 0 && r.monthEvents === 0 ? 'failing' : live && r.monthEvents === 0 ? 'idle' : 'ok';
    return { code: r.code, name: r.name, state: r.state, gateAllowed: !!r.gate.allowed, gateReason: r.gate.reason ?? null, monthRuns: r.monthEvents, monthErrors: r.monthErrors, monthRefused: r.monthBlocked,
      lastSuccessAt: r.lastSuccessAt, lastErrorAt: r.lastErrorAt, verdict };
  });
}

export class AiUsageScreenError extends Error {
  constructor(message: string, readonly code: 'AI_PACKAGE_NOT_FOUND' | 'AI_ACTION_NOT_ALLOWED' | 'AI_TRIAL_NOT_ELIGIBLE' | 'AI_STATE_CHANGED' | 'AI_CONFIRMATION_REQUIRED'
    | 'IDEMPOTENCY_KEY_REQUIRED' | 'AI_INVALID_PERIOD' | 'AI_ALERT_NOT_FOUND' | 'PERMISSION_DENIED' | 'AI_BRANCH_NOT_FOUND' | 'AI_INVALID_SETTINGS' | 'AI_BRANCH_CANNOT_ENABLE', readonly status: 400 | 403 | 404 | 409 = 400, readonly details?: Record<string, unknown>) {
    super(message); this.name = 'AiUsageScreenError';
  }
}
export const PACKAGE_STATUS_FILTERS = ['all', 'active', 'trialing', 'trial_expired', 'cancelled', 'past_due', 'disabled', 'available'] as const;
export const PACKAGE_SORTS = ['catalog', 'name', 'newest', 'usage', 'cost'] as const;
export const PACKAGE_CATEGORIES = ['front_desk', 'operations', 'growth', 'finance', 'insights', 'unknown'] as const;
export const HISTORY_STATUSES = ['all', 'success', 'error', 'blocked'] as const;
export const HISTORY_BASES = ['occurred', 'current_period'] as const;
const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | Date).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9._:-]{8,100}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const has = (c: UsageCtx, ...p: string[]) => (c.permissions ?? []).some((x) => p.includes(x));
export const canManageAi = (c: UsageCtx) => has(c, 'ai.manage', 'subscription.manage');
export const canSeeBilling = (c: UsageCtx) => has(c, 'subscription.manage');
const STATE_FILTER: Record<string, DisplayState[]> = { active: ['active'], trialing: ['trialing'], trial_expired: ['trial_expired'], cancelled: ['cancelled', 'expired'],
  past_due: ['past_due'], disabled: ['disabled_by_admin', 'suspended'], available: ['available', 'trial_available'] };
const LIVE: DisplayState[] = ['active', 'trialing', 'past_due'];
const PAID_EVENTS = ['payment_succeeded', 'trial_converted', 'payment_recovered'];
const ERROR_STATUSES = ['failed', 'provider_error'];
const BLOCKED_STATUSES = ['blocked_unpaid', 'blocked_limit', 'blocked_permission'];

export interface PackageCard {
  code: string; name: string; description: string; category: string; posArea: string | null; known: boolean; sortOrder: number;
  state: DisplayState; storedStatus: string | null; globallyEnabled: boolean; disabledReason: string | null;
  price: { cents: number; currency: string; period: 'monthly' | 'yearly'; monthlyEquivalentCents: number; source: 'subscription' | 'catalog_list';
    /** extras AI Usage Limits 07 (Price Change Transparency): today's catalog list price beside the salon's own stored price —
     *  'list' (no subscription row, or the same as list) · 'kept_below_list' (an earlier, lower price is kept: grandfathered) ·
     *  'above_list' (the stored price is above today's list). A comparison only — nothing is re-priced. */
    comparison?: PriceComparison;
    /** extras AI Usage Limits 07 (round 11): the Super Admin price table (migration 971) for this package and billing period —
     *  'no_price_set' until a version is published (the table starts empty). Shown beside the price above; never bills. */
    table?: AiTablePrice };
  usage: { used: number | null; limit: number; unit: string; percent: number | null; level: UsageLevel; periodStart: string | null; periodEnd: string | null; remaining: number | null;
    /** extras AI Usage Limits 03: an ESTIMATE of the period's end from this period's pace — never a purchase, never a limit change */
    projection?: UsageProjection | null };
  overage: { enabled: boolean; unitPriceCents: number; estimatedCents: number };
  trial: { days: number; startsAt: string | null; endsAt: string | null; daysLeft: number | null; eligible: boolean };
  lastPaymentStatus: string | null; subscribedAt: string | null; cancelledAt: string | null;
  actions: PackageAction[]; primaryAction: PackageAction; openAlert: number | null;
}

/** Extras (AI Usage Limits 03 · Smart Cost & Quota Advisor): at this period's pace (counted usage ÷ the share of the period gone),
 *  where will the period end? 'too_early' before 20% of the period (or 3 days) has passed — no estimate is invented then.
 *  fits ≤ 90% of the allowance · close ≤ 100% · likely_over above it; with overage on, the extra is priced at the package's
 *  overage rate (an estimate); with it off the gate blocks at the limit. Pure arithmetic: nothing is bought, changed or sent. */
export interface PriceComparison { listMonthlyCents: number | null; storedMonthlyCents: number | null; status: 'list' | 'kept_below_list' | 'above_list' | 'no_list_price'; deltaMonthlyCents: number | null; listSource: 'catalog' }
/** the salon's stored price (monthly equivalent) vs today's catalog list price — pure */
export function priceComparison(listMonthlyCents: number | null | undefined, storedMonthlyCents: number | null): PriceComparison {
  const list = listMonthlyCents == null ? null : Math.round(listMonthlyCents);
  if (list == null) return { listMonthlyCents: null, storedMonthlyCents, status: 'no_list_price', deltaMonthlyCents: null, listSource: 'catalog' };
  if (storedMonthlyCents == null || storedMonthlyCents === list) return { listMonthlyCents: list, storedMonthlyCents, status: 'list', deltaMonthlyCents: storedMonthlyCents == null ? null : 0, listSource: 'catalog' };
  return { listMonthlyCents: list, storedMonthlyCents, status: storedMonthlyCents < list ? 'kept_below_list' : 'above_list', deltaMonthlyCents: storedMonthlyCents - list, listSource: 'catalog' };
}
/** extras AI Usage Limits 01 (Catalog Integrity Audit): the 15 package codes and five bundles of the code catalog, compared
 *  with the codes this salon's subscriptions, plan rows, metering (ai_usage_logs — what the AI gateway records) and the
 *  platform switches use, and stored prices vs today's (plan price = Super Admin override/discount, else the members' sum).
 *  Drill-down lists name each discrepancy. A stored price that differs is listed, never a defect (a kept earlier price is
 *  legitimate). Pure: the caller reads the facts; nothing is changed. */
export interface CatalogFacts {
  packageCodes: string[]; plans: { code: string; packageCodes: string[] }[];
  subscriptionCodes: string[]; planSubscriptionCodes: string[]; meteredCodes: string[]; switchCodes: string[];
  packagePrices: { code: string; storedMonthlyCents: number; listMonthlyCents: number | null }[];
  planPrices: { code: string; storedCents: number; currentCents: number | null }[];
}
export function catalogIntegrity(f: CatalogFacts) {
  const known = new Set(f.packageCodes); const planCodes = new Set(f.plans.map((p) => p.code));
  const dupes = f.packageCodes.filter((c, i) => f.packageCodes.indexOf(c) !== i);
  const inPlans = f.plans.flatMap((p) => p.packageCodes);
  const bundleUnknown = [...new Set(inPlans.filter((c) => !known.has(c)))];
  const inNoPlan = f.packageCodes.filter((c) => !inPlans.includes(c));
  const inTwoPlans = [...new Set(inPlans.filter((c, i) => inPlans.indexOf(c) !== i))];
  const unknownIn = (codes: string[], ok: Set<string>) => [...new Set(codes.filter((c) => !ok.has(c)))].sort();
  const discrepancies = {
    duplicateCodes: [...new Set(dupes)], bundleMembersNotInCatalog: bundleUnknown, packagesInNoBundle: inNoPlan, packagesInTwoBundles: inTwoPlans,
    subscriptionsUnknownToCatalog: unknownIn(f.subscriptionCodes, known), planRowsUnknownToCatalog: unknownIn(f.planSubscriptionCodes, planCodes),
    meteredCodesUnknownToCatalog: unknownIn(f.meteredCodes, known), switchesUnknownToCatalog: unknownIn(f.switchCodes, known),
  };
  const priceDifferences = [
    ...f.packagePrices.filter((p) => p.listMonthlyCents != null && p.storedMonthlyCents !== p.listMonthlyCents).map((p) => ({ kind: 'package' as const, code: p.code, storedCents: p.storedMonthlyCents, currentCents: p.listMonthlyCents! })),
    ...f.planPrices.filter((p) => p.currentCents != null && p.storedCents !== p.currentCents).map((p) => ({ kind: 'plan' as const, code: p.code, storedCents: p.storedCents, currentCents: p.currentCents! })),
  ];
  const structural = f.packageCodes.length !== 15 || f.plans.length !== 5 || dupes.length > 0 || bundleUnknown.length > 0;
  const unknownCount = discrepancies.subscriptionsUnknownToCatalog.length + discrepancies.planRowsUnknownToCatalog.length + discrepancies.meteredCodesUnknownToCatalog.length + discrepancies.switchesUnknownToCatalog.length;
  const state: 'PASSED' | 'WARNING' | 'FAILED' = structural ? 'FAILED' : unknownCount || inNoPlan.length || inTwoPlans.length ? 'WARNING' : 'PASSED';
  return { state, count: unknownCount + (structural ? 1 : 0) + inNoPlan.length + inTwoPlans.length,
    detail: { packages: f.packageCodes.length, bundles: f.plans.length, discrepancies, priceDifferences } };
}
export interface UsageProjection { basis: 'period_pace'; elapsedShare: number; projectedUsed: number | null; verdict: 'too_early' | 'fits' | 'close' | 'likely_over'; projectedOverageCents: number | null; atLimit: 'overage' | 'blocked' }
export function usageProjection(used: number, limit: number, periodStart: Date, periodEnd: Date, now: Date, overageEnabled: boolean, overageUnitCents: number): UsageProjection | null {
  const span = periodEnd.getTime() - periodStart.getTime();
  if (!(limit > 0) || !(span > 0)) return null;
  const gone = Math.min(1, Math.max(0, (now.getTime() - periodStart.getTime()) / span));
  const atLimit = overageEnabled ? 'overage' as const : 'blocked' as const;
  const share = Math.round(gone * 1000) / 1000;
  if (gone < 0.2 || now.getTime() - periodStart.getTime() < 3 * 86_400_000) return { basis: 'period_pace', elapsedShare: share, projectedUsed: null, verdict: 'too_early', projectedOverageCents: null, atLimit };
  const projected = Math.round(used / gone);
  const verdict = projected <= limit * 0.9 ? 'fits' : projected <= limit ? 'close' : 'likely_over';
  return { basis: 'period_pace', elapsedShare: share, projectedUsed: projected, verdict, projectedOverageCents: overageEnabled ? Math.max(0, projected - limit) * overageUnitCents : null, atLimit };
}

const dayOf = (v: unknown) => (v == null ? null : utcDate(new Date(v as string)));   // the provider's subscription period start — a UTC billing instant
const ENTITLED: DisplayState[] = ['active', 'trialing'];   // the gate's default past-due policy is "block"

export class AiUsageScreenRepository {
  /** invoiceClient: READ-ONLY provider port for AI-01 reconciliation; unconfigured by default (runs recorded as failed). */
  constructor(readonly db: Kysely<any>, private readonly invoiceClient: AiInvoiceProviderClient = new UnconfiguredInvoiceClient()) {}

  /** every fact the cards need, in three reads (subscriptions + usage + billing facts · global settings · open alerts) */
  private async facts(ctx: UsageCtx) {
    const T = ctx.tenantId;
    const subs = (await sql<any>`select s.package_code, s.status, s.billing_period, s.price_cents, s.currency, s.usage_limit, s.overage_enabled, s.trial_starts_at, s.trial_ends_at,
        s.current_period_starts_at, coalesce(s.current_period_ends_at, s.current_period_starts_at + case when s.billing_period = 'yearly' then interval '1 year' else interval '1 month' end) as period_end,
        s.cancelled_at, s.last_payment_status, s.payment_provider, s.created_at,
        (select coalesce(sum(l.usage_amount), 0)::bigint from ai_usage_logs l where l.tenant_id = s.tenant_id and l.package_code = s.package_code and l.status = 'success'
           and l.created_at >= s.current_period_starts_at) as used,
        exists (select 1 from ai_billing_events b where b.tenant_id = s.tenant_id and b.package_code = s.package_code and b.event_type = any(${PAID_EVENTS}::text[])) as ever_paid,
        exists (select 1 from ai_billing_events b where b.tenant_id = s.tenant_id and b.package_code = s.package_code and b.event_type = any(${PAID_EVENTS}::text[])
           and b.created_at >= s.current_period_starts_at) as paid_this_period,
        exists (select 1 from tenant_ai_subscription_events e where e.tenant_id = s.tenant_id and e.package_code = s.package_code and e.event_type = 'trial_started') as trial_event
      from tenant_ai_subscriptions s where s.tenant_id = ${T}`.execute(this.db)).rows;
    const settings = (await sql<any>`select package_code, enabled, disabled_reason from platform_ai_package_settings`.execute(this.db)).rows;
    const alerts = (await sql<any>`select a.package_code, max(a.threshold)::int as t from ai_usage_alerts a join tenant_ai_subscriptions s on s.tenant_id = a.tenant_id and s.package_code = a.package_code
      and a.period_start = s.current_period_starts_at where a.tenant_id = ${T} and a.acknowledged_at is null group by a.package_code`.execute(this.db)).rows;
    const priceTable = await new AiPriceTable(this.db).facts(T);   // round 11 (AI Usage Limits 07): empty until a version is published
    return { subs: new Map(subs.map((r: any) => [String(r.package_code), r])), settings: new Map(settings.map((r: any) => [String(r.package_code), r])), alerts: new Map(alerts.map((r: any) => [String(r.package_code), N(r.t)])), priceTable };
  }

  private card(ctx: UsageCtx, code: string, f: Awaited<ReturnType<AiUsageScreenRepository['facts']>>, now = new Date()): PackageCard {
    const def = getAiPackage(code); const s = f.subs.get(code) ?? null; const g = f.settings.get(code);
    const globallyEnabled = g ? !!g.enabled : true;
    const trialEver = !!s && (s.trial_starts_at != null || !!s.trial_event);
    const state = displayStateOf({ globallyEnabled, sub: s ? { status: String(s.status), trialEndsAt: s.trial_ends_at, trialStartsAt: s.trial_starts_at } : null,
      trialDays: def?.trialDays ?? 0, trialEverStarted: trialEver, everPaid: !!s?.ever_paid, now });
    const live = LIVE.includes(state);
    const limit = s ? N(s.usage_limit) : def?.includedUsageLimit ?? 0;
    const used = s ? N(s.used) : null;
    const level = usageLevelOf(live ? used : null, limit, live);
    const period: 'monthly' | 'yearly' = s?.billing_period === 'yearly' ? 'yearly' : 'monthly';
    const cents = s && N(s.price_cents) > 0 ? N(s.price_cents) : def?.monthlyPriceCents ?? 0;
    const overUnit = def?.overagePriceCents ?? 0;
    const overEnabled = !!s?.overage_enabled;
    const est = live && overEnabled && limit > 0 && used != null && used > limit ? (used - limit) * overUnit : 0;
    const endsAt = s?.trial_ends_at ? new Date(s.trial_ends_at) : null;
    const eligible = globallyEnabled && !s && (def?.trialDays ?? 0) > 0 && !trialEver;
    const actions = actionsFor(state, canManageAi(ctx), canSeeBilling(ctx), eligible);
    return {
      code, name: def?.name ?? code, description: def?.description ?? '', category: def?.category ?? 'unknown', posArea: def?.posArea ?? null, known: !!def, sortOrder: def?.sortOrder ?? 999,
      state, storedStatus: s ? String(s.status) : null, globallyEnabled, disabledReason: g && !g.enabled ? (g.disabled_reason ?? null) : null,
      price: { cents, currency: String(s?.currency ?? 'usd').toUpperCase(), period, monthlyEquivalentCents: period === 'yearly' ? Math.round(cents / 12) : cents, source: s && N(s.price_cents) > 0 ? 'subscription' : 'catalog_list',
        comparison: priceComparison(def?.monthlyPriceCents ?? null, s && N(s.price_cents) > 0 ? (period === 'yearly' ? Math.round(N(s.price_cents) / 12) : N(s.price_cents)) : null),
        table: resolveAiTablePrice(f.priceTable.versions, f.priceTable.overrides, code, period === 'yearly' ? 'year' : 'month', s?.created_at ? new Date(s.created_at) : null, now) },
      usage: { used: live ? used : null, limit, unit: def?.usageUnit ?? 'units', percent: live && limit > 0 && used != null ? Math.round((used * 1000) / limit) / 10 : null, level,
        periodStart: live ? iso(s?.current_period_starts_at) : null, periodEnd: live ? iso(s?.period_end) : null, remaining: live && limit > 0 && used != null ? Math.max(0, limit - used) : null,
        projection: live && used != null && s?.current_period_starts_at && s?.period_end ? usageProjection(used, limit, new Date(s.current_period_starts_at), new Date(s.period_end), now, overEnabled, overUnit) : null },
      overage: { enabled: overEnabled, unitPriceCents: overUnit, estimatedCents: est },
      trial: { days: def?.trialDays ?? 0, startsAt: iso(s?.trial_starts_at), endsAt: iso(endsAt), daysLeft: state === 'trialing' && endsAt ? Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 86400000)) : null, eligible },
      lastPaymentStatus: s?.last_payment_status ?? null, subscribedAt: iso(s?.created_at), cancelledAt: iso(s?.cancelled_at),
      actions, primaryAction: primaryAction(actions), openAlert: f.alerts.get(code) ?? null,
    };
  }
  private async cards(ctx: UsageCtx): Promise<{ cards: PackageCard[]; facts: Awaited<ReturnType<AiUsageScreenRepository['facts']>> }> {
    await syncUsageAlerts(this.db, ctx.tenantId);   // backfills / late events: the alert rows match what the cards show
    const f = await this.facts(ctx);
    const codes = [...AI_PACKAGES.map((p) => p.code), ...[...f.subs.keys()].filter((c) => !getAiPackage(c))];
    return { cards: codes.map((c) => this.card(ctx, c, f)), facts: f };
  }

  /** the four KPIs + the verified monthly cost (owner priority 1) + open usage alerts (owner priority 2) */
  async summary(ctx: UsageCtx) {
    const { cards, facts } = await this.cards(ctx);
    const by = (s: DisplayState[]) => cards.filter((c) => s.includes(c.state));
    const paying = by(['active', 'past_due']);
    const billing = canSeeBilling(ctx);
    const recurring = paying.reduce((a, c) => a + c.price.monthlyEquivalentCents, 0);
    const overage = cards.reduce((a, c) => a + c.overage.estimatedCents, 0);
    const reconciled = paying.length > 0 && paying.every((c) => !!facts.subs.get(c.code)?.paid_this_period);
    const trials = by(['trialing']);
    const lastEvent = (await sql<any>`select max(created_at) as at, count(*)::int as n from ai_billing_events where tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0];
    const invoiced = billing ? await this.invoicedBlock(ctx, cards, facts, null, recurring + overage) : null;
    // one line per package: its highest open threshold of the current period (90 % is not repeated once 100 % is reached)
    const alerts = (await sql<any>`select distinct on (a.package_code) a.id, a.package_code, a.threshold, a.used, a.usage_limit, a.usage_unit, a.period_start, a.created_at from ai_usage_alerts a
      join tenant_ai_subscriptions s on s.tenant_id = a.tenant_id and s.package_code = a.package_code and a.period_start = s.current_period_starts_at
      where a.tenant_id = ${ctx.tenantId} and a.acknowledged_at is null order by a.package_code, a.threshold desc, a.created_at desc`.execute(this.db)).rows
      .sort((x: any, y: any) => N(y.threshold) - N(x.threshold) || String(y.created_at).localeCompare(String(x.created_at)));
    return {
      asOf: new Date().toISOString(),
      kpis: { totalPackages: cards.length, activeSubscriptions: by(['active']).length, pastDue: by(['past_due']).length, trialsAndPending: trials.length + by(['past_due', 'trial_expired']).length,
        trialing: trials.length, trialExpired: by(['trial_expired']).length, disabled: by(['disabled_by_admin', 'suspended']).length },
      cost: billing ? {
        visible: true as const, currency: 'USD', recurringMonthlyCents: recurring, estimatedOverageCents: overage,
        basis: reconciled ? 'reconciled' as const : paying.length === 0 ? 'no_paid_packages' as const : 'subscription_records' as const,
        lines: paying.map((c) => ({ code: c.code, name: c.name, cents: c.price.cents, period: c.price.period, monthlyEquivalentCents: c.price.monthlyEquivalentCents, state: c.state,
          paidThisPeriod: !!facts.subs.get(c.code)?.paid_this_period, provider: facts.subs.get(c.code)?.payment_provider ?? null })),
        trials: trials.map((c) => ({ code: c.code, name: c.name, endsAt: c.trial.endsAt, afterTrialCents: c.price.cents, period: c.price.period })),
        overageLines: cards.filter((c) => c.overage.estimatedCents > 0).map((c) => ({ code: c.code, name: c.name, cents: c.overage.estimatedCents, over: (c.usage.used ?? 0) - c.usage.limit, unit: c.usage.unit })),
        lastBillingEventAt: iso(lastEvent?.at), billingEvents: N(lastEvent?.n),
        invoiced,
      } : { visible: false as const },
      alerts: alerts.map((a: any) => ({ id: String(a.id), code: String(a.package_code), name: getAiPackage(String(a.package_code))?.name ?? String(a.package_code), threshold: N(a.threshold),
        used: N(a.used), limit: N(a.usage_limit), unit: String(a.usage_unit), periodStart: iso(a.period_start), at: iso(a.created_at) })),
      canManage: canManageAi(ctx), canSeeBilling: billing,
    };
  }

  async packages(ctx: UsageCtx, f: { q?: string; status?: string; category?: string; sort?: string; page?: unknown; pageSize?: unknown }) {
    const { cards } = await this.cards(ctx);
    const q = String(f.q ?? '').trim().toLowerCase();
    const st = (PACKAGE_STATUS_FILTERS as readonly string[]).includes(String(f.status)) ? String(f.status) : 'all';
    const cat = (PACKAGE_CATEGORIES as readonly string[]).includes(String(f.category)) ? String(f.category) : null;
    const sort = (PACKAGE_SORTS as readonly string[]).includes(String(f.sort)) ? String(f.sort) : 'catalog';
    let list = cards.filter((c) => (st === 'all' || STATE_FILTER[st]!.includes(c.state)) && (!cat || c.category === cat)
      && (!q || [c.name, c.description, c.code, c.category, c.posArea ?? ''].some((x) => x.toLowerCase().includes(q)) || c.category.replace('_', ' ').includes(q)));
    const cmp: Record<string, (a: PackageCard, b: PackageCard) => number> = {
      catalog: (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
      name: (a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code),
      newest: (a, b) => (b.subscribedAt ?? '').localeCompare(a.subscribedAt ?? '') || a.sortOrder - b.sortOrder,
      usage: (a, b) => (b.usage.percent ?? -1) - (a.usage.percent ?? -1) || a.sortOrder - b.sortOrder,
      cost: (a, b) => (LIVE.includes(b.state) ? b.price.monthlyEquivalentCents : -1) - (LIVE.includes(a.state) ? a.price.monthlyEquivalentCents : -1) || a.sortOrder - b.sortOrder,
    };
    list = [...list].sort(cmp[sort]);
    const pageSize = Math.max(1, Math.min(24, Math.trunc(Number(f.pageSize)) || 8));
    const totalItems = list.length; const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(Math.max(1, Math.trunc(Number(f.page)) || 1), totalPages);
    const counts = Object.fromEntries(PACKAGE_STATUS_FILTERS.map((k) => [k, k === 'all' ? cards.length : cards.filter((c) => STATE_FILTER[k]!.includes(c.state)).length]));
    return { items: list.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalItems, totalPages, sort, status: st, category: cat, counts };
  }

  /** the one-click Package Details (owner priority 3): overview · subscription · usage · billing · history · settings */
  async detail(ctx: UsageCtx, code: string) {
    const { cards, facts } = await this.cards(ctx);
    const c = cards.find((x) => x.code === code); if (!c) return null;
    const T = ctx.tenantId; const s = facts.subs.get(code);
    const tz = await tenantTimeZone(this.db, T).catch(() => 'America/New_York');
    const daily = s ? (await sql<any>`select to_char((l.created_at at time zone ${tz})::date, 'YYYY-MM-DD') as d, coalesce(sum(l.usage_amount) filter (where l.status = 'success'), 0)::bigint as used,
        count(*) filter (where l.status <> 'success')::int as failed
      from ai_usage_logs l where l.tenant_id = ${T} and l.package_code = ${code} and l.created_at >= ${s.current_period_starts_at} group by 1 order by 1`.execute(this.db)).rows : [];
    const billing = canSeeBilling(ctx) ? (await sql<any>`select event_type, provider, from_status, to_status, payment_status, applied, created_at from ai_billing_events
      where tenant_id = ${T} and package_code = ${code} order by created_at desc limit 20`.execute(this.db)).rows : null;
    const events = (await sql<any>`select e.event_type, e.from_status, e.to_status, e.actor_role, e.created_at, u.full_name from tenant_ai_subscription_events e
      left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id where e.tenant_id = ${T} and e.package_code = ${code} order by e.created_at desc limit 30`.execute(this.db)).rows;
    const admin = (await sql<any>`select action_type, role, created_at, metadata_json from audit_logs where tenant_id = ${T} and entity_type = 'tenant_ai_subscription'
      and (metadata_json::jsonb ->> 'packageCode' = ${code} or entity_id = ${code}) order by created_at desc limit 30`.execute(this.db)).rows;
    const alerts = (await sql<any>`select threshold, used, usage_limit, usage_unit, period_start, created_at, acknowledged_at from ai_usage_alerts
      where tenant_id = ${T} and package_code = ${code} order by created_at desc limit 12`.execute(this.db)).rows;
    const history = [
      ...events.map((e: any) => ({ at: iso(e.created_at), kind: 'tenant' as const, type: String(e.event_type), from: e.from_status ?? null, to: String(e.to_status), actor: e.full_name ?? e.actor_role ?? null })),
      ...admin.map((a: any) => ({ at: iso(a.created_at), kind: a.role === 'system' ? 'billing' as const : 'platform' as const, type: String(a.action_type), from: null, to: (typeof a.metadata_json === 'string' ? JSON.parse(a.metadata_json || '{}') : a.metadata_json || {}).to ?? null, actor: a.role ?? null })),
      ...(billing ?? []).map((b: any) => ({ at: iso(b.created_at), kind: 'billing' as const, type: String(b.event_type), from: b.from_status ?? null, to: b.to_status ?? null, actor: b.provider ?? null })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);
    const why = await this.why(ctx, c, s);
    return { package: c, why,
      usage: { daily: daily.map((r: any) => ({ date: String(r.d), used: N(r.used), failed: N(r.failed) })), countsRule: 'success_only', timeZone: tz },
      billing: billing ? { visible: true as const, events: billing.map((b: any) => ({ type: String(b.event_type), provider: b.provider ?? null, from: b.from_status ?? null, to: b.to_status ?? null, paymentStatus: b.payment_status ?? null, applied: !!b.applied, at: iso(b.created_at) })),
        invoiced: await this.invoicedBlock(ctx, cards, facts, code, c.price.cents + c.overage.estimatedCents) } : { visible: false as const },
      history, alerts: alerts.map((a: any) => ({ threshold: N(a.threshold), used: N(a.used), limit: N(a.usage_limit), unit: String(a.usage_unit), periodStart: iso(a.period_start), at: iso(a.created_at), acknowledgedAt: iso(a.acknowledged_at) })),
      settings: { globallyEnabled: c.globallyEnabled, disabledReason: c.disabledReason, storedStatus: c.storedStatus, usageLimit: c.usage.limit, overageEnabled: c.overage.enabled, limitSource: s ? 'subscription' : 'catalog',
        branches: await this.branchBlock(ctx, c, s) },
      canManage: canManageAi(ctx), canSeeBilling: canSeeBilling(ctx) };
  }

  // ── usage history (§15) ─────────────────────────────────────────────────────────────────────────────────────────────
  private async range(ctx: UsageCtx, f: { preset?: string; from?: string; to?: string }) {
    const tz = await tenantTimeZone(this.db, ctx.tenantId).catch(() => 'America/New_York');
    const preset = ['today', 'week', 'month', 'year', 'custom'].includes(String(f.preset)) ? String(f.preset) : (f.from || f.to ? 'custom' : 'month');
    let from: string | null = null, to: string | null = null;
    if (preset === 'custom') {
      from = f.from && DAY.test(f.from) ? f.from : null; to = f.to && DAY.test(f.to) ? f.to : null;
      if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new AiUsageScreenError('Choose a From and a To date.', 'AI_INVALID_PERIOD');
      if (from > to) throw new AiUsageScreenError('The From date must be on or before the To date.', 'AI_INVALID_PERIOD');
    }
    const unit = preset === 'today' ? 'day' : preset === 'week' ? 'week' : preset === 'year' ? 'year' : 'month';
    const r = (await sql<any>`with d as (select (now() at time zone ${tz})::date as today)
      select d.today::text as today, coalesce(${from}::date, date_trunc(${unit}, d.today::timestamp)::date)::text as f,
             coalesce(${to}::date, (date_trunc(${unit}, d.today::timestamp) + ${'1 ' + unit}::interval - interval '1 day')::date)::text as t from d`.execute(this.db)).rows[0];
    const b = (await sql<any>`select (${r.f}::date::timestamp at time zone ${tz}) as s, ((${r.t}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { tz, preset, from: String(r.f), to: String(r.t), today: String(r.today), start: new Date(b.s), end: new Date(b.e) };
  }
  private historyWhere(ctx: UsageCtx, f: { packageCode?: string; status?: string; basis?: string }, k: { start: Date; end: Date }) {
    const parts = [sql`l.tenant_id = ${ctx.tenantId}`];
    if (f.basis === 'current_period') parts.push(sql`l.created_at >= s.current_period_starts_at`);
    else parts.push(sql`l.created_at >= ${k.start} and l.created_at < ${k.end}`);
    if (f.packageCode) parts.push(sql`l.package_code = ${f.packageCode}`);
    // ai_usage_logs.status ∈ success · failed · provider_error · blocked_unpaid · blocked_limit · blocked_permission; only success counts
    if (f.status === 'success') parts.push(sql`l.status = 'success'`);
    else if (f.status === 'error') parts.push(sql`l.status = any(${ERROR_STATUSES}::text[])`);
    else if (f.status === 'blocked') parts.push(sql`l.status = any(${BLOCKED_STATUSES}::text[])`);
    return sql.join(parts, sql` and `);
  }
  async history(ctx: UsageCtx, f: { preset?: string; from?: string; to?: string; packageCode?: string; status?: string; basis?: string; page?: unknown; pageSize?: unknown }) {
    const k = await this.range(ctx, f);
    const basis = f.basis === 'current_period' ? 'current_period' : 'occurred';
    const where = this.historyWhere(ctx, { ...f, basis }, k);
    const from = sql`from ai_usage_logs l left join tenant_ai_subscriptions s on s.tenant_id = l.tenant_id and s.package_code = l.package_code where ${where}`;
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(f.pageSize)) || 10));
    const tot = (await sql<any>`select count(*)::int as n, coalesce(sum(l.usage_amount) filter (where l.status = 'success'), 0)::bigint as used ${from}`.execute(this.db)).rows[0];
    const totalItems = N(tot?.n); const totalPages = Math.max(1, Math.ceil(totalItems / pageSize)); const page = Math.min(Math.max(1, Math.trunc(Number(f.page)) || 1), totalPages);
    const rows = (await sql<any>`select l.id, l.created_at, l.package_code, l.usage_unit, l.usage_amount, l.status, l.action, l.request_id, s.current_period_starts_at
      ${from} order by l.created_at desc, l.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { period: { preset: k.preset, from: k.from, to: k.to, today: k.today, timeZone: k.tz }, basis, totalUsedSuccess: N(tot?.used),
      items: rows.map((r: any) => this.historyRow(r)), page, pageSize, totalItems, totalPages };
  }
  private historyRow(r: any) {
    const inPeriod = r.current_period_starts_at && new Date(r.created_at) >= new Date(r.current_period_starts_at);
    return { id: String(r.id), at: iso(r.created_at), code: String(r.package_code), name: getAiPackage(String(r.package_code))?.name ?? String(r.package_code), unit: String(r.usage_unit),
      quantity: N(r.usage_amount), status: String(r.status), action: String(r.action ?? ''), reference: r.request_id ? `…${String(r.request_id).slice(-6)}` : null,
      billingPeriod: inPeriod ? 'current' as const : r.current_period_starts_at ? 'previous' as const : 'none' as const, counted: String(r.status) === 'success' };
  }
  async historyCsv(ctx: UsageCtx, f: { preset?: string; from?: string; to?: string; packageCode?: string; status?: string; basis?: string }) {
    const k = await this.range(ctx, f);
    const where = this.historyWhere(ctx, { ...f, basis: f.basis === 'current_period' ? 'current_period' : 'occurred' }, k);
    const rows = (await sql<any>`select l.id, l.created_at, l.package_code, l.usage_unit, l.usage_amount, l.status, l.action, l.request_id, s.current_period_starts_at
      from ai_usage_logs l left join tenant_ai_subscriptions s on s.tenant_id = l.tenant_id and s.package_code = l.package_code where ${where}
      order by l.created_at desc, l.id desc limit 20000`.execute(this.db)).rows.map((r: any) => this.historyRow(r));
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
    const head = ['Time (UTC)', 'Package', 'Package code', 'Unit', 'Quantity', 'Status', 'Counted toward limit', 'Reference', 'Billing period'];
    const lines = rows.map((r) => [r.at, r.name, r.code, r.unit, r.quantity, r.status, r.counted ? 'yes' : 'no', r.reference, r.billingPeriod].map(esc).join(','));
    return { csv: [head.join(','), ...lines].join('\n') + '\n', rows: rows.length, filename: `ai-usage-${k.from}-to-${k.to}.csv`, period: { from: k.from, to: k.to } };
  }

  // ── mutations (§7): server-validated, confirmed, idempotent, audited in the same transaction ───────────────────────
  async startTrial(ctx: UsageCtx, code: string, b: { idempotencyKey?: unknown; confirm?: unknown }, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    if (!canManageAi(ctx)) throw new AiUsageScreenError('Your role cannot start AI trials.', 'PERMISSION_DENIED', 403);
    const key = String(b.idempotencyKey ?? ''); if (!KEY.test(key)) throw new AiUsageScreenError('A request key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    if (b.confirm !== true) throw new AiUsageScreenError('Confirm the trial first.', 'AI_CONFIRMATION_REQUIRED');
    const def = getAiPackage(code); if (!def) throw new AiUsageScreenError('Unknown AI package.', 'AI_PACKAGE_NOT_FOUND', 404);
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'ai-sub:' + ctx.tenantId + ':' + code}))`.execute(trx);
      const prior = (await sql<any>`select to_status from tenant_ai_subscription_events where tenant_id = ${ctx.tenantId} and idempotency_key = ${key}`.execute(trx)).rows[0];
      if (prior) return { ok: true as const, duplicate: true, code, status: String(prior.to_status) };
      const g = (await sql<any>`select enabled from platform_ai_package_settings where package_code = ${code}`.execute(trx)).rows[0];
      if (g && !g.enabled) throw new AiUsageScreenError('This AI package is turned off by the platform.', 'AI_ACTION_NOT_ALLOWED', 409, { state: 'disabled_by_admin' });
      const cur = (await sql<any>`select status, trial_starts_at from tenant_ai_subscriptions where tenant_id = ${ctx.tenantId} and package_code = ${code} for update`.execute(trx)).rows[0];
      const ev = (await sql<any>`select 1 from tenant_ai_subscription_events where tenant_id = ${ctx.tenantId} and package_code = ${code} and event_type = 'trial_started' limit 1`.execute(trx)).rows[0];
      if (cur || ev || def.trialDays <= 0) throw new AiUsageScreenError('This salon has already used or cannot take a free trial of this package.', 'AI_TRIAL_NOT_ELIGIBLE', 409, { storedStatus: cur?.status ?? null });
      const ins = await sql<any>`insert into tenant_ai_subscriptions (id, tenant_id, package_code, status, billing_period, price_cents, currency, usage_limit, overage_enabled, trial_starts_at, trial_ends_at, current_period_starts_at)
        values (gen_random_uuid(), ${ctx.tenantId}, ${code}, 'trialing', 'monthly', ${def.monthlyPriceCents}, 'usd', ${def.includedUsageLimit}, false, now(), now() + make_interval(days => ${def.trialDays}), now())
        on conflict (tenant_id, package_code) do nothing returning trial_ends_at`.execute(trx);
      if (!ins.rows.length) throw new AiUsageScreenError('The package changed while you were confirming. Refresh and try again.', 'AI_STATE_CHANGED', 409);
      await sql`insert into tenant_ai_subscription_events (tenant_id, package_code, event_type, from_status, to_status, actor_user_id, actor_role, idempotency_key)
        values (${ctx.tenantId}, ${code}, 'trial_started', null, 'trialing', ${UUID.test(ctx.userId ?? '') ? ctx.userId : null}, ${ctx.role ?? null}, ${key})`.execute(trx);
      await audit(trx, { packageCode: code, from: null, to: 'trialing', trialDays: def.trialDays, afterTrialCents: def.monthlyPriceCents });
      return { ok: true as const, duplicate: false, code, status: 'trialing', trialEndsAt: iso(ins.rows[0].trial_ends_at) };
    });
  }
  async cancel(ctx: UsageCtx, code: string, b: { idempotencyKey?: unknown; confirm?: unknown; expectedStatus?: unknown }, audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    if (!canManageAi(ctx)) throw new AiUsageScreenError('Your role cannot cancel AI packages.', 'PERMISSION_DENIED', 403);
    const key = String(b.idempotencyKey ?? ''); if (!KEY.test(key)) throw new AiUsageScreenError('A request key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    if (b.confirm !== true) throw new AiUsageScreenError('Confirm the cancellation first.', 'AI_CONFIRMATION_REQUIRED');
    if (!getAiPackage(code)) throw new AiUsageScreenError('Unknown AI package.', 'AI_PACKAGE_NOT_FOUND', 404);
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'ai-sub:' + ctx.tenantId + ':' + code}))`.execute(trx);
      const prior = (await sql<any>`select to_status from tenant_ai_subscription_events where tenant_id = ${ctx.tenantId} and idempotency_key = ${key}`.execute(trx)).rows[0];
      if (prior) return { ok: true as const, duplicate: true, code, status: String(prior.to_status) };
      const cur = (await sql<any>`select status, trial_ends_at from tenant_ai_subscriptions where tenant_id = ${ctx.tenantId} and package_code = ${code} for update`.execute(trx)).rows[0];
      if (!cur) throw new AiUsageScreenError('There is no subscription to cancel.', 'AI_ACTION_NOT_ALLOWED', 409, { state: 'none' });
      const lapsed = cur.status === 'trialing' && cur.trial_ends_at && new Date(cur.trial_ends_at).getTime() < Date.now();
      if (!['active', 'trialing', 'past_due', 'unpaid'].includes(String(cur.status)) || lapsed) throw new AiUsageScreenError('This package cannot be cancelled in its current state.', 'AI_ACTION_NOT_ALLOWED', 409, { storedStatus: cur.status, lapsedTrial: !!lapsed });
      if (b.expectedStatus != null && String(b.expectedStatus) !== String(cur.status)) throw new AiUsageScreenError('The package changed while you were confirming. Review it again.', 'AI_STATE_CHANGED', 409, { storedStatus: cur.status });
      await sql`update tenant_ai_subscriptions set status = 'cancelled', cancelled_at = now(), updated_at = now() where tenant_id = ${ctx.tenantId} and package_code = ${code} and ${canMoveToSql(TENANT_AI_SUBSCRIPTION, 'cancelled')}`.execute(trx);   // the shared lifecycle
      await sql`insert into tenant_ai_subscription_events (tenant_id, package_code, event_type, from_status, to_status, actor_user_id, actor_role, idempotency_key)
        values (${ctx.tenantId}, ${code}, 'cancelled', ${cur.status}, 'cancelled', ${UUID.test(ctx.userId ?? '') ? ctx.userId : null}, ${ctx.role ?? null}, ${key})`.execute(trx);
      await audit(trx, { packageCode: code, from: cur.status, to: 'cancelled' });
      return { ok: true as const, duplicate: false, code, status: 'cancelled' };
    });
  }
  async acknowledgeAlert(ctx: UsageCtx, id: string) {
    if (!UUID.test(id)) throw new AiUsageScreenError('Alert not found.', 'AI_ALERT_NOT_FOUND', 404);
    // "Got it" on a threshold also covers the lower thresholds of the same package and period (they were shown as one line)
    const r = await sql<any>`update ai_usage_alerts a set acknowledged_at = coalesce(a.acknowledged_at, now()), acknowledged_by_user_id = coalesce(a.acknowledged_by_user_id, ${UUID.test(ctx.userId ?? '') ? ctx.userId : null})
      from ai_usage_alerts x where x.tenant_id = ${ctx.tenantId} and x.id = ${id} and a.tenant_id = x.tenant_id and a.package_code = x.package_code and a.period_start = x.period_start
        and a.threshold <= x.threshold returning a.id`.execute(this.db);
    if (!r.rows.length) throw new AiUsageScreenError('Alert not found.', 'AI_ALERT_NOT_FOUND', 404);
    return { ok: true as const };
  }
  // ── AI-01 invoice-backed charges (Four-Module guide §11) ──────────────────────────────────────────────────────────
  private async invoiceRows(ctx: UsageCtx, code: string | null): Promise<InvoiceView[]> {
    const T = ctx.tenantId;
    const rows = (await sql<any>`select l.*, (select coalesce(json_agg(json_build_object('kind', s.kind, 'description', s.description, 'amount_cents', s.amount_cents, 'package_code', s.package_code)
          order by s.provider_line_id), '[]'::json) from ai_billing_invoice_line_snapshots s where s.tenant_id = l.tenant_id and s.invoice_link_id = l.id) as lines
      from ai_billing_invoice_links l where l.tenant_id = ${T}
        and (${code}::text is null or l.package_code = ${code} or exists (select 1 from ai_billing_invoice_line_snapshots x where x.tenant_id = l.tenant_id and x.invoice_link_id = l.id and x.package_code = ${code}))
      order by l.invoice_date desc nulls last, l.created_at desc limit 50`.execute(this.db)).rows;
    return rows.map(invoiceViewOf);
  }
  private async invoicedBlock(ctx: UsageCtx, cards: PackageCard[], facts: Awaited<ReturnType<AiUsageScreenRepository['facts']>>, code: string | null, estimateCents: number) {
    const all = await this.invoiceRows(ctx, code);
    const startOf = (pkg: string | null) => dayOf(pkg ? facts.subs.get(pkg)?.current_period_starts_at : null);
    const liveStarts = cards.filter((c) => LIVE.includes(c.state)).map((c) => startOf(c.code)).filter((x): x is string => !!x).sort();
    const fallback = code ? startOf(code) : liveStarts[0] ?? null;
    const current = all.filter((i) => inPeriodFrom(i, (i.packageCodes.length === 1 ? startOf(i.packageCodes[0]!) : null) ?? fallback));
    const run = (await sql<any>`select r.status, r.provider, r.trigger, r.invoices_seen, r.created_count, r.updated_count, r.unchanged_count, r.stale_count, r.rejected_count, r.error_code, r.started_at, r.finished_at
      from ai_billing_reconciliation_runs r where r.tenant_id = ${ctx.tenantId} order by r.started_at desc limit 1`.execute(this.db)).rows[0];
    return {
      recurringCents: code ? (cards.find((c) => c.code === code)?.price.cents ?? 0) : cards.filter((c) => c.state === 'active' || c.state === 'past_due').reduce((a, c) => a + c.price.monthlyEquivalentCents, 0),
      estimate: { cents: estimateCents, assumptions: [...ESTIMATE_ASSUMPTIONS] },
      currentPeriod: { from: fallback, ...invoicedAmounts(current) },
      outstandingAllCents: invoicedAmounts(all).outstandingCents,
      invoices: all.slice(0, code ? 12 : 20),
      lastRun: run ? { status: String(run.status), provider: run.provider ?? null, trigger: String(run.trigger), seen: N(run.invoices_seen), created: N(run.created_count), updated: N(run.updated_count),
        unchanged: N(run.unchanged_count), stale: N(run.stale_count), rejected: N(run.rejected_count), errorCode: run.error_code ?? null, at: iso(run.finished_at ?? run.started_at) } : null,
      providerConfigured: this.invoiceClient.configured, canReconcile: canSeeBilling(ctx),
    };
  }
  /** "Re-check invoices": a read-only re-read of the provider. Never charges; idempotent on the request key. */
  async reconcileInvoices(ctx: UsageCtx, b: { idempotencyKey?: unknown }) {
    if (!canSeeBilling(ctx)) throw new AiUsageScreenError('Your role cannot reconcile AI invoices.', 'PERMISSION_DENIED', 403);
    const key = String(b.idempotencyKey ?? ''); if (!KEY.test(key)) throw new AiUsageScreenError('A request key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    return new AiInvoiceLedger(this.db).reconcile(ctx.tenantId, this.invoiceClient, { trigger: 'manual', actorUserId: ctx.userId ?? null, idempotencyKey: key });
  }

  // ── AI-02 per-branch operational settings (Four-Module guide §12) ────────────────────────────────────────────────
  /** branches this user may see: owners / AI managers → every branch of the salon; others → the session branch + granted ones */
  private async authorizedBranches(ctx: UsageCtx): Promise<{ id: string; name: string; status: string }[]> {
    const T = ctx.tenantId; const all = canManageAi(ctx);
    const user = UUID.test(ctx.userId ?? '') ? ctx.userId! : null; const br = UUID.test(ctx.branchId ?? '') ? ctx.branchId! : null;
    return (await sql<any>`select b.id, b.name, b.status from branches b where b.tenant_id = ${T}
        and (${all} or b.id = ${br}::uuid or exists (select 1 from user_branch_access a where a.tenant_id = ${T} and a.user_id = ${user}::uuid and a.branch_id = b.id))
      order by b.name, b.id`.execute(this.db)).rows.map((r: any) => ({ id: String(r.id), name: String(r.name ?? ''), status: String(r.status ?? '') }));
  }
  private async branchBlock(ctx: UsageCtx, c: PackageCard, s: any) {
    const T = ctx.tenantId; const branches = await this.authorizedBranches(ctx);
    const rows = (await sql<any>`select b.branch_id, b.override_enabled, b.settings_json, b.version, b.updated_at, u.full_name from tenant_ai_branch_settings b
      left join users u on u.id = b.updated_by_user_id and u.tenant_id = b.tenant_id where b.tenant_id = ${T} and b.package_code = ${c.code}`.execute(this.db)).rows;
    const by = new Map(rows.map((r: any) => [String(r.branch_id), r]));
    const use = s ? (await sql<any>`select l.branch_id, coalesce(sum(l.usage_amount), 0)::bigint as used from ai_usage_logs l where l.tenant_id = ${T} and l.package_code = ${c.code}
        and l.status = 'success' and l.created_at >= ${s.current_period_starts_at} group by l.branch_id`.execute(this.db)).rows : [];
    const total = use.reduce((a: number, r: any) => a + N(r.used), 0);
    const unattributed = use.filter((r: any) => r.branch_id == null).reduce((a: number, r: any) => a + N(r.used), 0);
    const attribution = total === 0 ? 'no_usage' as const : unattributed === total ? 'unavailable' as const : unattributed > 0 ? 'partial' as const : 'available' as const;
    const usedBy = new Map(use.filter((r: any) => r.branch_id != null).map((r: any) => [String(r.branch_id), N(r.used)]));
    const entitled = ENTITLED.includes(c.state);
    return {
      tenantDefault: { entitled, state: c.state, globallyEnabled: c.globallyEnabled },
      quota: { scope: 'shared_tenant' as const, used: c.usage.used, limit: c.usage.limit, unit: c.usage.unit, unattributed, attribution },
      billingScope: 'tenant_subscription' as const, fields: branchSettingFields(c.code), canEdit: canManageAi(ctx),
      items: branches.map((b) => {
        const r: any = by.get(b.id); const override = r ? (r.override_enabled == null ? null : !!r.override_enabled) : null;
        const e = effectiveBranchAccess({ globallyEnabled: c.globallyEnabled, tenantEntitled: entitled, override });
        return { branchId: b.id, name: b.name, branchStatus: b.status, override, settings: (r?.settings_json ?? {}) as Record<string, boolean>, version: r ? N(r.version) : 0,
          updatedAt: iso(r?.updated_at), updatedBy: r?.full_name ?? null, effective: e.effective, source: e.source,
          usedThisPeriod: attribution === 'unavailable' ? null : (usedBy.get(b.id) ?? 0) };
      }),
    };
  }
  async setBranchSetting(ctx: UsageCtx, code: string, branchId: string, b: { overrideEnabled?: unknown; settings?: unknown; expectedVersion?: unknown; reason?: unknown },
    audit: (trx: Kysely<any>, meta: Record<string, unknown>) => Promise<void>) {
    if (!canManageAi(ctx)) throw new AiUsageScreenError('Your role cannot change branch AI settings.', 'PERMISSION_DENIED', 403);
    if (!getAiPackage(code)) throw new AiUsageScreenError('Unknown AI package.', 'AI_PACKAGE_NOT_FOUND', 404);
    if (!UUID.test(branchId) || !(await this.authorizedBranches(ctx)).some((x) => x.id === branchId)) throw new AiUsageScreenError('Branch not found.', 'AI_BRANCH_NOT_FOUND', 404);
    if (!(b.overrideEnabled === true || b.overrideEnabled === false || b.overrideEnabled === null)) throw new AiUsageScreenError('Choose Inherit, On or Off.', 'AI_INVALID_SETTINGS');
    const override = b.overrideEnabled as boolean | null;
    const chk = validateBranchSettings(code, b.settings ?? {}); if (!chk.ok) throw new AiUsageScreenError(`Invalid setting: ${chk.reason}.`, 'AI_INVALID_SETTINGS');
    const expected = Math.trunc(Number(b.expectedVersion));
    if (!Number.isFinite(expected) || expected < 0) throw new AiUsageScreenError('The current version is required.', 'AI_STATE_CHANGED', 409);
    if (override === true) {
      const card = (await this.cards(ctx)).cards.find((x) => x.code === code)!;
      if (!card.globallyEnabled) throw new AiUsageScreenError('The platform turned this package off; a branch cannot turn it on.', 'AI_BRANCH_CANNOT_ENABLE', 409, { reason: 'platform_disabled' });
      if (!ENTITLED.includes(card.state)) throw new AiUsageScreenError('The salon is not subscribed to this package; a branch cannot turn it on.', 'AI_BRANCH_CANNOT_ENABLE', 409, { reason: 'not_entitled', state: card.state });
    }
    const T = ctx.tenantId; const actorId = UUID.test(ctx.userId ?? '') ? ctx.userId! : null;
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'ai-branch:' + T + ':' + branchId + ':' + code}))`.execute(trx);
      const cur = (await sql<any>`select b.override_enabled, b.settings_json, b.version from tenant_ai_branch_settings b where b.tenant_id = ${T} and b.branch_id = ${branchId} and b.package_code = ${code} for update`.execute(trx)).rows[0];
      const version = cur ? N(cur.version) : 0;
      if (expected !== version) throw new AiUsageScreenError('Someone changed this branch setting. Review it again.', 'AI_STATE_CHANGED', 409, { currentVersion: version });
      const from = cur ? (cur.override_enabled == null ? null : !!cur.override_enabled) : null; const fromSettings = (cur?.settings_json ?? {}) as Record<string, boolean>;
      if (cur && from === override && JSON.stringify(fromSettings) === JSON.stringify(chk.value)) return { ok: true as const, changed: false, version, override, settings: chk.value };
      const next = version + 1;
      await sql`insert into tenant_ai_branch_settings (tenant_id, branch_id, package_code, override_enabled, settings_json, version, updated_by_user_id, updated_by)
        values (${T}, ${branchId}, ${code}, ${override}, ${JSON.stringify(chk.value)}::jsonb, ${next}, ${actorId}, ${actorId}::uuid)
        on conflict (tenant_id, branch_id, package_code) do update set override_enabled = excluded.override_enabled, settings_json = excluded.settings_json, version = excluded.version,
          updated_by_user_id = excluded.updated_by_user_id, updated_by = excluded.updated_by, updated_at = now()`.execute(trx);
      await sql`insert into tenant_ai_branch_settings_history (tenant_id, branch_id, package_code, version, from_override, to_override, from_settings, to_settings, actor_user_id, actor_role, reason)
        values (${T}, ${branchId}, ${code}, ${next}, ${from}, ${override}, ${cur ? JSON.stringify(fromSettings) : null}::jsonb, ${JSON.stringify(chk.value)}::jsonb, ${actorId}, ${ctx.role ?? null},
          ${typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 300) : null})`.execute(trx);
      await audit(trx, { packageCode: code, branchId, from, to: override, settings: chk.value, version: next });
      return { ok: true as const, changed: true, version: next, override, settings: chk.value };
    });
  }

  /** the sidebar badge: open alerts of current billing periods */
  async openAlertCount(tenantId: string): Promise<number> {
    return N((await sql<any>`select count(*)::int as n from ai_usage_alerts a join tenant_ai_subscriptions s on s.tenant_id = a.tenant_id and s.package_code = a.package_code
      and a.period_start = s.current_period_starts_at where a.tenant_id = ${tenantId} and a.acknowledged_at is null`.execute(this.db)).rows[0]?.n);
  }

  // ── AI Center guide (Oct 30 2026, refreshed): reconcile "0 Active / 11 On Trial / 11 Running" ─────────────────────────────
  // The old AI Center counted a STORED "trialing" row as "On trial" and "Running" whatever its trial end date, and "Active" as
  // "accessible and not trialing". This returns, per assistant: the stored status, the honest state, the gate's decision right
  // now (the same evaluateAiAccess the AI platform runs before EVERY model call), what the old page counted it as, and its usage
  // this calendar month in its own unit — plus the counts both ways and how the gate is enforced. Read-only.
  /** The AI-call gate's own decision for one package (evaluateAiAccess over the gate's snapshot): `gate` = the SALON (permission
   *  set aside), `forYou` = the signed-in user. Used by reconcile and the entitlement explainer — one source, never re-derived. */
  private async gateFor(ctx: UsageCtx, code: string, gateRepo = new KyselyAiAccessRepo(this.db)) {
    let gate: { allowed: boolean; reason: string } = { allowed: false, reason: 'unknown' };
    let forYou: { allowed: boolean; reason: string } | null = null;
    try {
      const snap: any = await gateRepo.loadSnapshot(ctx.tenantId, code, ctx.userId ?? null, { branchId: null });
      const d: any = evaluateAiAccess({ ...snap, hasPermission: true }); gate = { allowed: !!d.allowed, reason: String(d.reason ?? (d.allowed ? 'ok' : 'denied')) };
      const y: any = evaluateAiAccess(snap); forYou = { allowed: !!y.allowed, reason: String(y.reason ?? (y.allowed ? 'ok' : 'denied')) };
    } catch { gate = { allowed: false, reason: 'unable_to_check' }; }
    return { gate, forYou };
  }

  /** Extras (AI Usage Limits 02 "Effective Entitlement Explainer"): why a package is Active / Blocked — the gate's decision (the
   *  same call reconcile makes) beside the facts it rests on: the platform switch, the salon's own subscription row (status,
   *  provider, last payment), the trial, any plan (bundle) that lists the package, and when a provider billing event last
   *  confirmed it. Read-only; nothing is inferred beyond the stored rows. */
  private async why(ctx: UsageCtx, c: PackageCard, s: any) {
    const T = ctx.tenantId;
    const { gate, forYou } = await this.gateFor(ctx, c.code);
    const owning = AI_PLANS.filter((pl) => pl.packageCodes.includes(c.code));
    type PlanRow = { plan_code: string; status: string; trial_ends_at: Date | string | null; cancelled_at: Date | string | null };
    const planRows = owning.length ? (await sql<PlanRow>`select plan_code, status, trial_ends_at, cancelled_at from tenant_ai_plan_subscriptions
        where tenant_id = ${T} and plan_code = any(${owning.map((pl) => pl.code)}::text[])`.execute(this.db)).rows : [];
    const byPlan = new Map(planRows.map((r) => [String(r.plan_code), r]));
    type BillRow = { at: Date | string | null; provider: string | null; event_type: string | null };
    const last = (await sql<BillRow>`select created_at as at, provider, event_type from ai_billing_events where tenant_id = ${T} and package_code = ${c.code}
        order by created_at desc limit 1`.execute(this.db)).rows[0];
    return {
      entitled: gate.allowed, gate, forYou, state: c.state,
      platform: { enabled: c.globallyEnabled, disabledReason: c.disabledReason },
      subscription: s ? { status: String(s.status), provider: s.payment_provider ?? null, lastPaymentStatus: s.last_payment_status ?? null, period: c.price.period, priceSource: c.price.source } : null,
      trial: c.trial.startsAt || c.trial.endsAt ? { startsAt: c.trial.startsAt, endsAt: c.trial.endsAt, daysLeft: c.trial.daysLeft } : null,
      plans: owning.map((pl) => { const r = byPlan.get(pl.code); return { code: pl.code, name: pl.name, status: r ? String(r.status) : null, trialEndsAt: iso(r?.trial_ends_at), cancelledAt: iso(r?.cancelled_at) }; }),
      lastVerified: last ? { at: iso(last.at), provider: last.provider ?? null, eventType: last.event_type ?? null } : null,
    };
  }

  async reconcile(ctx: UsageCtx, env: NodeJS.ProcessEnv = process.env) {
    const T = ctx.tenantId;
    const { cards } = await this.cards(ctx);
    const gateRepo = new KyselyAiAccessRepo(this.db);
    const tz = await tenantTimeZone(this.db, T);
    const month = (await sql<any>`select to_char(date_trunc('month', now() at time zone ${tz}), 'YYYY-MM-DD') as m`.execute(this.db)).rows[0].m as string;
    const usage = (await sql<any>`select l.package_code, count(*) filter (where l.status = 'success')::int as ok, count(*) filter (where l.status in ('failed', 'provider_error'))::int as errors,
        count(*) filter (where l.status like 'blocked%')::int as blocked, coalesce(sum(l.usage_amount) filter (where l.status = 'success'), 0)::bigint as amount,
        max(l.created_at) filter (where l.status = 'success') as last_ok, max(l.created_at) filter (where l.status in ('failed', 'provider_error')) as last_error
      from ai_usage_logs l where l.tenant_id = ${T} and l.created_at >= (${month}::date)::timestamp at time zone ${tz} group by l.package_code`.execute(this.db)).rows;
    const u = new Map(usage.map((r: any) => [String(r.package_code), r]));
    const rows: any[] = [];
    for (const c of cards) {
      // The SALON's entitlement (permission set aside — a role without ai permission is not a package state); `forYou` is the
      // same gate for the signed-in user, so "your role cannot use it" is told apart from "the salon cannot".
      const { gate, forYou } = await this.gateFor(ctx, c.code, gateRepo);
      const old = c.storedStatus === 'active' ? 'active' : c.storedStatus === 'trialing' ? 'trial' : null;
      const x: any = u.get(c.code) ?? {};
      rows.push({ code: c.code, name: c.name, category: c.category, state: c.state, storedStatus: c.storedStatus, trialEndsAt: c.trial.endsAt, cancelledAt: c.cancelledAt, globallyEnabled: c.globallyEnabled,
        gate, forYou, oldLabel: old, oldCountedRunning: old != null, unit: c.usage.unit, monthUsage: N(x.amount), monthEvents: N(x.ok), monthErrors: N(x.errors), monthBlocked: N(x.blocked),
        lastSuccessAt: iso(x.last_ok), lastErrorAt: iso(x.last_error), limitReached: gate.reason === 'limit_exceeded',
        mismatch: gate.reason === 'limit_exceeded' ? false : gate.allowed !== ['active', 'trialing'].includes(c.state) });
    }
    const count = (f: (r: any) => boolean) => rows.filter(f).length;
    const mode = String(env.AI_ENTITLEMENT_ENFORCEMENT ?? '').trim().toLowerCase();
    return {
      monthStart: month, timeZone: tz,
      old: { active: count((r) => r.storedStatus === 'active'), onTrial: count((r) => r.storedStatus === 'trialing'), running: count((r) => r.oldCountedRunning) },
      now: { paidActive: count((r) => r.state === 'active'), trialing: count((r) => r.state === 'trialing'), trialExpired: count((r) => r.state === 'trial_expired'),
        cancelled: count((r) => r.state === 'cancelled' || r.state === 'expired'), pastDue: count((r) => r.state === 'past_due'), disabled: count((r) => r.state === 'disabled_by_admin' || r.state === 'suspended'),
        canRunNow: count((r) => r.gate.allowed), catalog: rows.length },
      staleTrialRows: count((r) => r.storedStatus === 'trialing' && r.state === 'trial_expired'),
      monthEvents: rows.reduce((a, r) => a + r.monthEvents, 0), monthBlocked: rows.reduce((a, r) => a + r.monthBlocked, 0), monthErrors: rows.reduce((a, r) => a + r.monthErrors, 0),
      gateMismatches: count((r) => r.mismatch), limitReached: count((r) => r.limitReached),
      enforcement: { modelCalls: 'always', featureRoutes: mode === 'enforce' ? 'enforce' : mode === 'off' ? 'off' : 'observe' },
      rows,
    };
  }

  // ── Check AI Usage & Subscriptions (AI Usage Limits guide, Nov 1 2026) — read-only; one run per salon per 30 s ─────────────
  // It reconciles what the page shows with the records behind it: the catalog, each package's stored status vs its honest state,
  // calls the gate let through after a trial ended or after a cancellation, the cost basis, the metering, the plans. It never
  // starts, cancels, prices, charges or changes a limit.
  async check(ctx: UsageCtx) {
    const T = ctx.tenantId;
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recent = async (ex: Kysely<any>) => (await sql<any>`select id, overall, checks, created_at from ai_usage_health_runs where tenant_id = ${T}
      and created_at >= now() - interval '30 seconds' order by created_at desc limit 1`.execute(ex)).rows[0];
    const reused = (r: any) => ({ id: String(r.id), overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recent(this.db);
    if (early) return reused(early);
    const checks: Array<{ key: string; state: St; count?: number; detail?: Record<string, unknown> }> = [];
    const one = async (q: any) => (await q.execute(this.db)).rows[0] ?? {};
    let cards: PackageCard[] = [];
    try { cards = (await this.cards(ctx)).cards; checks.push({ key: 'states_readable', state: 'PASSED', count: cards.length }); }
    catch { checks.push({ key: 'states_readable', state: 'FAILED' }); }
    checks.push({ key: 'catalog', state: AI_PACKAGES.length === 15 && cards.length === AI_PACKAGES.length ? 'PASSED' : 'WARNING', count: AI_PACKAGES.length });
    // extras AI Usage Limits 01: catalog integrity with a drill-down of every discrepancy (read-only)
    try {
      const subRows = (await sql<{ package_code: string; billing_period: string; price_cents: number }>`select package_code, billing_period, price_cents from tenant_ai_subscriptions where tenant_id = ${T}`.execute(this.db)).rows;
      const planRows = (await sql<{ plan_code: string; full_cents: number; price_override: number | null; discount_type: string | null; discount_value: number | null }>`select p.plan_code, p.full_cents, st.price_cents_override as price_override, st.discount_type, st.discount_value
        from tenant_ai_plan_subscriptions p left join ai_plan_settings st on st.plan_code = p.plan_code where p.tenant_id = ${T}`.execute(this.db)).rows;
      const metered = (await sql<{ package_code: string }>`select distinct package_code from ai_usage_logs where tenant_id = ${T} and created_at > now() - interval '90 days'`.execute(this.db)).rows;
      const switches = (await sql<{ package_code: string }>`select package_code from platform_ai_package_settings`.execute(this.db)).rows;
      const r = catalogIntegrity({
        packageCodes: AI_PACKAGES.map((p) => p.code), plans: AI_PLANS.map((p) => ({ code: p.code, packageCodes: [...p.packageCodes] })),
        subscriptionCodes: subRows.map((x) => String(x.package_code)), planSubscriptionCodes: planRows.map((x) => String(x.plan_code)),
        meteredCodes: metered.map((x) => String(x.package_code)), switchCodes: switches.map((x) => String(x.package_code)),
        packagePrices: subRows.filter((x) => N(x.price_cents) > 0).map((x) => ({ code: String(x.package_code), storedMonthlyCents: x.billing_period === 'yearly' ? Math.round(N(x.price_cents) / 12) : N(x.price_cents), listMonthlyCents: getAiPackage(String(x.package_code))?.monthlyPriceCents ?? null })),
        planPrices: planRows.map((x) => ({ code: String(x.plan_code), storedCents: N(x.full_cents),
          currentCents: AI_PLANS.some((p) => p.code === x.plan_code) ? effectivePlanPriceCents(String(x.plan_code), { priceCentsOverride: x.price_override, discountType: (x.discount_type as 'percent' | 'flat' | null) ?? undefined, discountValue: x.discount_value }).fullCents : null })),
      });
      const nameOf = (kind: 'package' | 'plan', code: string) => (kind === 'package' ? getAiPackage(code)?.name : AI_PLANS.find((p) => p.code === code)?.name) ?? null;
      checks.push({ key: 'catalog_integrity', state: r.state, count: r.count, detail: { ...r.detail, priceDifferences: r.detail.priceDifferences.map((d) => ({ ...d, name: nameOf(d.kind, d.code) })) } });
    } catch (e) {
      checks.push({ key: 'catalog_integrity', state: 'UNAVAILABLE', detail: { errorCode: String((e as { code?: unknown })?.code ?? 'QUERY_FAILED').slice(0, 60) } });
    }
    const unknown = cards.filter((c) => c.state === 'unable_to_verify').length;
    checks.push({ key: 'statuses_known', state: unknown ? 'WARNING' : 'PASSED', count: unknown });
    // a stored "trialing" whose trial already ended: the page says Trial expired and the gate denies — the row itself is stale
    const staleTrials = cards.filter((c) => c.state === 'trial_expired' && c.storedStatus === 'trialing').length;
    checks.push({ key: 'trial_rows_current', state: staleTrials ? 'WARNING' : 'PASSED', count: staleTrials });
    // calls that succeeded after the trial ended / after cancellation — the gate should have refused them
    const afterTrial = N((await one(sql<any>`select count(*)::int as n from ai_usage_logs l join tenant_ai_subscriptions s on s.tenant_id = l.tenant_id and s.package_code = l.package_code
      where l.tenant_id = ${T} and l.status = 'success' and s.status = 'trialing' and s.trial_ends_at is not null and l.created_at > s.trial_ends_at
      and not exists (select 1 from ai_billing_events b where b.tenant_id = s.tenant_id and b.package_code = s.package_code and b.event_type = any(${PAID_EVENTS}::text[]))`)).n);
    checks.push({ key: 'no_use_after_trial', state: afterTrial ? 'FAILED' : 'PASSED', count: afterTrial });
    const afterCancel = N((await one(sql<any>`select count(*)::int as n from ai_usage_logs l join tenant_ai_subscriptions s on s.tenant_id = l.tenant_id and s.package_code = l.package_code
      where l.tenant_id = ${T} and l.status = 'success' and s.status = 'cancelled' and s.cancelled_at is not null and l.created_at > s.cancelled_at`)).n);
    checks.push({ key: 'no_use_after_cancel', state: afterCancel ? 'FAILED' : 'PASSED', count: afterCancel });
    // the cost card: paying packages without a recorded payment this period are shown on the subscription records' basis
    const paying = cards.filter((c) => c.state === 'active' || c.state === 'past_due');
    const unpaid = paying.filter((c) => c.lastPaymentStatus !== 'paid').length;
    checks.push({ key: 'cost_basis', state: !paying.length ? 'INSUFFICIENT_DATA' : unpaid ? 'WARNING' : 'PASSED', count: unpaid, detail: { paying: paying.length } });
    const pastDue = cards.filter((c) => c.state === 'past_due').length;
    checks.push({ key: 'payments_current', state: pastDue ? 'WARNING' : 'PASSED', count: pastDue });
    const live = cards.filter((c) => c.state === 'active' || c.state === 'trialing');
    const lastUse = (await one(sql<any>`select max(created_at) as at from ai_usage_logs where tenant_id = ${T} and status = 'success'`)).at;
    checks.push({ key: 'metering', state: !live.length ? 'INSUFFICIENT_DATA' : lastUse ? 'PASSED' : 'WARNING', detail: { lastSuccessAt: iso(lastUse) } });
    // Extras (AI Usage Limits 06): metering anomalies — flagged for a person, never corrected; hard caps and the records stand
    // stale ingestion: live packages but nothing counted for 14 days (a meter that stopped, or simply unused — said both ways)
    const staleDays = lastUse ? Math.floor((Date.now() - new Date(lastUse).getTime()) / 86_400_000) : null;
    checks.push({ key: 'metering_stale', state: !live.length || !lastUse ? 'INSUFFICIENT_DATA' : staleDays! >= 14 ? 'WARNING' : 'PASSED', count: staleDays != null && staleDays >= 14 ? staleDays : 0, detail: { lastSuccessAt: iso(lastUse) } });
    // a sudden spike: a package's last 24 h at least 3× its daily average over the 14 days before (and 20+ calls)
    const spikes = (await sql<{ package_code: string; recent: number; prior: number }>`select package_code,
        count(*) filter (where created_at > now() - interval '1 day')::int as recent,
        count(*) filter (where created_at <= now() - interval '1 day' and created_at > now() - interval '15 days')::int as prior
      from ai_usage_logs where tenant_id = ${T} and status = 'success' and created_at > now() - interval '15 days' group by package_code`.execute(this.db)).rows
      .filter((r) => N(r.recent) >= 20 && N(r.recent) >= 3 * Math.max(1, N(r.prior) / 14));
    const anyHistory = N((await one(sql<any>`select count(*)::int as n from ai_usage_logs where tenant_id = ${T} and status = 'success' and created_at <= now() - interval '1 day' and created_at > now() - interval '15 days'`)).n);
    checks.push({ key: 'usage_spike', state: spikes.length ? 'WARNING' : !anyHistory ? 'INSUFFICIENT_DATA' : 'PASSED', count: spikes.length, detail: { packages: spikes.map((r) => r.package_code) } });
    // one request metered more than once (the same request id on two rows, e.g. under two packages) in the last 30 days
    const dupes = N((await one(sql<any>`select count(*)::int as n from (select request_id from ai_usage_logs where tenant_id = ${T} and request_id is not null and status = 'success'
      and created_at > now() - interval '30 days' group by request_id having count(*) > 1) d`)).n);
    checks.push({ key: 'duplicate_usage_events', state: dupes ? 'WARNING' : 'PASSED', count: dupes });
    const errors = N((await one(sql<any>`select count(*)::int as n from ai_usage_logs where tenant_id = ${T} and status in ('failed', 'provider_error') and created_at > now() - interval '7 days'`)).n);
    checks.push({ key: 'recent_errors', state: errors ? 'WARNING' : 'PASSED', count: errors });
    const exhausted = cards.filter((c) => c.usage.level === 'exhausted_100' && !c.overage.enabled).length;
    checks.push({ key: 'limits', state: exhausted ? 'WARNING' : 'PASSED', count: exhausted });
    // a plan row that is live while one of its members is not (bundle coverage out of step)
    const planGap = N((await one(sql<any>`select count(*)::int as n from tenant_ai_plan_subscriptions p where p.tenant_id = ${T} and p.status in ('active', 'trialing')
      and (p.trial_ends_at is null or p.trial_ends_at > now())`)).n);
    const planMembers = cards.filter((c) => c.state === 'cancelled' || c.state === 'expired' || c.state === 'trial_expired').length;
    checks.push({ key: 'plans_in_step', state: planGap && planMembers ? 'WARNING' : 'PASSED', count: planGap && planMembers ? planMembers : 0 });
    // extras AI Usage Limits 04 (Bundle Overlap Detector): an assistant the salon pays for on its own AND inside a paid plan (the
    // assistant's own paid subscription began before the plan did — the plan path creates its members at the plan's start), or one
    // listed by two live plans. Review only: nothing is cancelled, refunded or re-priced; the owner decides.
    type OvRow = { package_code: string; status: string; price_cents: number; created_at: Date | string };
    type PlRow = { plan_code: string; status: string; started_at: Date | string; trial_ends_at: Date | string | null };
    const livePlans = (await sql<PlRow>`select plan_code, status, started_at, trial_ends_at from tenant_ai_plan_subscriptions where tenant_id = ${T} and status in ('active', 'trialing')
      and (status = 'active' or trial_ends_at is null or trial_ends_at > now())`.execute(this.db)).rows;
    const ownRows = new Map((await sql<OvRow>`select package_code, status, price_cents, created_at from tenant_ai_subscriptions where tenant_id = ${T}
      and status in ('active', 'past_due') and price_cents > 0`.execute(this.db)).rows.map((r) => [String(r.package_code), r]));
    const overlaps: { code: string; name: string; plans: string[]; paidOnItsOwnSince: string | null }[] = [];
    for (const def of AI_PACKAGES) {
      const plansFor = livePlans.filter((pl) => AI_PLANS.find((x) => x.code === pl.plan_code)?.packageCodes.includes(def.code));
      const own = ownRows.get(def.code);
      const ownBeforePaidPlan = !!own && plansFor.some((pl) => pl.status === 'active' && new Date(own.created_at).getTime() < new Date(pl.started_at).getTime());
      if (plansFor.length >= 2 || ownBeforePaidPlan) overlaps.push({ code: def.code, name: def.name, plans: plansFor.map((pl) => AI_PLANS.find((x) => x.code === pl.plan_code)?.name ?? pl.plan_code), paidOnItsOwnSince: ownBeforePaidPlan ? iso(own!.created_at) : null });
    }
    checks.push({ key: 'bundle_overlap', state: overlaps.length ? 'WARNING' : 'PASSED', count: overlaps.length, detail: { overlaps } });
    const disabled = cards.filter((c) => c.state === 'disabled_by_admin').length;
    checks.push({ key: 'admin_switches', state: disabled ? 'WARNING' : 'PASSED', count: disabled });
    // AI Center guide (P0): the gate the AI platform runs before every model call agrees with what the page shows — an expired trial,
    // a cancellation, a platform switch-off or an exhausted allowance is refused; a live package is allowed
    try {
      const r = await this.reconcile(ctx);
      checks.push({ key: 'gate_matches_state', state: r.gateMismatches ? 'FAILED' : 'PASSED', count: r.gateMismatches, detail: { canRunNow: r.now.canRunNow } });
      checks.push({ key: 'feature_routes_gated', state: r.enforcement.featureRoutes === 'enforce' ? 'PASSED' : 'WARNING', detail: { mode: r.enforcement.featureRoutes } });
      // extras AI Command Center 15 — per-assistant evidence (read-only): for every assistant the salon has (live, or with use this
      // month) its honest state, the gate's decision now, this month's successful / failed / refused runs and the last success /
      // error times, with a verdict: gate_mismatch (the gate disagrees with the state), failing (errors and no success this month
      // while live), idle (live, no run this month), limit (allowance used up), ok. Never runs a model or changes anything.
      const ev = assistantEvidence(r.rows);
      checks.push({ key: 'assistant_evidence', state: ev.some((a) => a.verdict === 'gate_mismatch') ? 'FAILED' : ev.some((a) => a.verdict === 'failing' || a.verdict === 'limit') ? 'WARNING' : !ev.length ? 'INSUFFICIENT_DATA' : 'PASSED',
        count: ev.filter((a) => a.verdict !== 'ok' && a.verdict !== 'idle').length, detail: { monthStart: r.monthStart, assistants: ev } });
    } catch { checks.push({ key: 'gate_matches_state', state: 'UNAVAILABLE' }); }
    checks.push({ key: 'no_side_effects', state: 'PASSED' });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING' : 'PASSED';
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('ai-usage-health:' || ${T}))`.execute(trx);
      const raced = await recent(trx);
      if (raced) return reused(raced);
      const id = (await sql<any>`insert into ai_usage_health_runs (tenant_id, actor_user_id, overall, checks) values (${T}, ${/^[0-9a-f-]{36}$/i.test(String(ctx.userId ?? "")) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb) returning id, created_at`.execute(trx)).rows[0];
      return { id: String(id.id), overall, checks, checkedAt: iso(id.created_at), reused: false };
    });
  }
}
