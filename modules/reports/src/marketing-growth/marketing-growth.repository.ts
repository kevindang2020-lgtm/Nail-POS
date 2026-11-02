// marketing-growth.repository.ts — Marketing & Growth Complete Build Guide (Oct 30 2026). `/pos/marketing-growth/*`.
//
// WHAT THIS IS. The dashboard's five sections keep reading the endpoint that owns each number (Campaign Center overview,
// /pos/discounts/kpis, /pos/loyalty/state, /pos/referrals/state, /pos/gift-cards/state, reviews) — a number computed twice
// drifts. This repository adds only what did not exist:
//   • reconciliation (guide §03 GATE 0)  every published KPI traced to its source rows: the formula, the scope, and a
//                                        check against the ledger it should equal. A gap is returned as a DEFECT with the
//                                        amount and the source, never smoothed over.
//   • search (§05)                       one box over customers / campaigns / offers / loyalty / referrals / gift cards /
//                                        reviews, grouped (never flattened), tenant-scoped, server-side, masked.
//   • activity (§06)                     the marketing history: one normalised event per real source row, newest first,
//                                        numbered pages, salon-local dates, an explicit date basis per event type.
//   • journey (§15)                      the same events for ONE customer + visits/appointments + consent — audited.
//   • economics (§14)                    cost & revenue per campaign rolled up from Campaign Center's own per-campaign
//                                        counts; unknown cost is N/A (never 0), revenue is code-attributed only.
// Every read is tenant-scoped from the session; branch visibility comes from RetentionRepository.branchScope (CR-02);
// salon-local periods from RetentionRepository.window. Nothing here writes a business record; nothing sends.
import { sql, type Kysely } from 'kysely';
import { RetentionRepository, PERIOD_PRESETS, isUuid, type RetentionContext, type BranchScope } from '@aipowersalon/customers';
import type { CampaignCenter } from '@aipowersalon/communications';

export const MG_SCOPES = ['all', 'customers', 'campaigns', 'offers', 'loyalty', 'referrals', 'gift_cards', 'reviews'] as const;
export const MG_EVENT_TYPES = ['campaign', 'message', 'redemption', 'loyalty', 'referral', 'gift_card', 'review', 'visit', 'appointment'] as const;
export const MG_PRESETS = [...PERIOD_PRESETS, 'all'] as const;
export type MgScope = (typeof MG_SCOPES)[number];
export type MgEventType = (typeof MG_EVENT_TYPES)[number];

/** loyalty: the five ledger entry types (migration 540). There is no expiry entry type, so expiry is reported as 0 + why. */
const LOYALTY_ENTRY_TYPES = ['earn', 'redeem', 'adjust', 'reverse', 'merge'] as const;
/** gift cards: the balance-holding statuses — the SAME set the Gift Cards screen sums (gift-cards.kysely.repository). */
const GC_OWED = ['active', 'partially_redeemed', 'frozen'] as const;
const GC_ISSUE = ['issue', 'activate', 'purchase', 'promo_bonus'] as const;
const GC_REDEEM = ['redeem', 'redemption'] as const;
/** deal_redemptions that count: completed at payment (Campaign Center and Discounts use the same two statuses) */
const REDEEMED = ['redeemed', 'partially_reversed'] as const;

export class MarketingGrowthError extends Error {
  constructor(message: string, readonly code: 'MKT_GROWTH_INVALID_FILTER' | 'CUSTOMER_NOT_FOUND' | 'BRANCH_NOT_AUTHORIZED', readonly status = 400, readonly details: Record<string, unknown> = {}) { super(message); this.name = 'MarketingGrowthError'; }
}

const N = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => ((list as readonly string[]).includes(String(v)) ? (v as T) : undefined);
const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
const maskPhone = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 4 ? `••• ${d.slice(-4)}` : null; };
const maskEmail = (e: unknown) => { const s = String(e ?? ''); const [u, d] = s.split('@'); return d ? `${(u || '').slice(0, 1)}•••@${d}` : null; };
const clampPage = (v: unknown) => Math.max(1, Math.min(100000, Math.floor(N(v)) || 1));
const clampSize = (v: unknown, d = 10) => { const n = Math.floor(N(v)); return [10, 20, 50].includes(n) ? n : d; };

export interface MgPeriod { preset: string; from: string | null; to: string | null; tz: string; today: string; start: Date | null; end: Date | null }

export class MarketingGrowthRepository {
  constructor(readonly db: Kysely<any>, private readonly ret: RetentionRepository, private readonly cc: CampaignCenter | null) {}

  // ── shared: period + branch scope ──────────────────────────────────────────────────────────────────────────────────
  async scopeAndPeriod(ctx: RetentionContext, q: { preset?: unknown; from?: unknown; to?: unknown; branch?: unknown }, dflt: 'all' | 'month' = 'all'): Promise<{ per: MgPeriod; scope: BranchScope }> {
    const preset = pick(MG_PRESETS, q.preset) ?? (q.from || q.to ? 'custom' : dflt);
    if (q.preset != null && q.preset !== '' && !pick(MG_PRESETS, q.preset)) throw new MarketingGrowthError('Unknown date preset.', 'MKT_GROWTH_INVALID_FILTER');
    try {
      if (preset === 'all') {
        const scope = await this.ret.branchScope(ctx, q.branch);
        const w = await this.ret.window(ctx, { preset: 'today', branch: q.branch as string | undefined });
        return { per: { preset: 'all', from: null, to: null, tz: w.tz, today: w.today, start: null, end: null }, scope };
      }
      const w = await this.ret.window(ctx, { preset, from: q.from as string | undefined, to: q.to as string | undefined, branch: q.branch as string | undefined });
      return { per: { preset: w.preset, from: w.from, to: w.to, tz: w.tz, today: w.today, start: w.start, end: w.end }, scope: w.scope };
    } catch (e: any) {
      if (e?.code === 'BRANCH_NOT_AUTHORIZED') throw new MarketingGrowthError('You do not have access to that branch.', 'BRANCH_NOT_AUTHORIZED', 403);
      if (e?.code === 'RETENTION_INVALID_PERIOD' || e?.code === 'RETENTION_INVALID_BRANCH') throw new MarketingGrowthError(e.message, 'MKT_GROWTH_INVALID_FILTER');
      throw e;
    }
  }
  /** branch predicate for a row's branch column: tenant mode = every row; branches mode = the authorized branches only */
  private br(scope: BranchScope, col: any) {
    if (scope.selected) return sql`${col} = ${scope.selected}::uuid`;
    if (scope.mode === 'branches') return scope.branchIds && scope.branchIds.length ? sql`${col} in (${sql.join(scope.branchIds.map((b) => sql`${b}::uuid`))})` : sql`false`;
    return sql`true`;
  }
  private inPer(per: MgPeriod, col: any) { return per.start && per.end ? sql`(${col} >= ${per.start} and ${col} < ${per.end})` : sql`true`; }

  // ── GATE 0: reconciliation ─────────────────────────────────────────────────────────────────────────────────────────
  /** Each published Marketing & Growth KPI, its formula + scope, and the ledger check it must pass. Tenant-wide by
   *  definition (the screenshot's numbers are tenant figures); the published scope caveats are listed per section. */
  async reconciliation(ctx: RetentionContext, q: { preset?: unknown; from?: unknown; to?: unknown }) {
    const { per } = await this.scopeAndPeriod(ctx, q, 'month');
    const T = ctx.tenantId;
    const sections = [await this.recLoyalty(T, per, ctx), await this.recGiftCards(T, per), await this.recReferrals(T), await this.recCampaigns(ctx), await this.recPromotions(T), await this.recReviews(T)];
    const defects = sections.flatMap((s) => s.defects.map((d) => ({ section: s.key, ...d })));
    return {
      period: per, generatedAt: new Date().toISOString(),
      overall: sections.some((s) => s.status === 'failed') ? 'failed' : sections.some((s) => s.status === 'attention_required') ? 'attention_required' : sections.some((s) => s.status === 'unknown') ? 'unknown' : 'ready',
      sections, defects,
      note: 'Read-only. Each defect names its source table, the amount and the remediation owner; nothing is corrected automatically.',
    };
  }

  private async recLoyalty(T: string, per: MgPeriod, ctx: RetentionContext) {
    const s = (await sql<any>`with prof as (select customer_id, branch_id, points_balance from customer_loyalty_profiles where tenant_id = ${T}),
        led as (select customer_id, sum(delta)::bigint as s, count(*)::int as n from loyalty_ledger where tenant_id = ${T} group by 1)
      select (select count(*)::int from prof) as members,
             (select coalesce(sum(points_balance), 0)::bigint from prof) as balance_sum,
             (select coalesce(sum(greatest(points_balance, 0)), 0)::bigint from prof) as published_basis,
             (select count(*)::int from prof where points_balance < 0) as negative_profiles,
             (select coalesce(sum(s), 0)::bigint from led) as ledger_total,
             (select count(*)::int from prof p left join led l on l.customer_id = p.customer_id where coalesce(l.s, 0) <> p.points_balance) as mismatched,
             (select coalesce(sum(abs(coalesce(l.s, 0) - p.points_balance)), 0)::bigint from prof p left join led l on l.customer_id = p.customer_id) as mismatch_points,
             (select count(*)::int from led l where not exists (select 1 from prof p where p.customer_id = l.customer_id)) as orphan_ledger_customers,
             (select count(*)::int from prof where branch_id is not null) as branch_profiles,
             (select count(distinct branch_id)::int from prof where branch_id is not null) as profile_branches`.execute(this.db)).rows[0];
    const roll = (await sql<any>`select
        coalesce(sum(delta) filter (where ${per.start ? sql`created_at < ${per.start}` : sql`false`}), 0)::bigint as opening,
        coalesce(sum(delta) filter (where coalesce(entry_type, 'adjust') = 'earn' and ${this.inPer(per, sql`created_at`)}), 0)::bigint as earn,
        coalesce(sum(delta) filter (where coalesce(entry_type, 'adjust') = 'redeem' and ${this.inPer(per, sql`created_at`)}), 0)::bigint as redeem,
        coalesce(sum(delta) filter (where coalesce(entry_type, 'adjust') = 'adjust' and ${this.inPer(per, sql`created_at`)}), 0)::bigint as adjust,
        coalesce(sum(delta) filter (where coalesce(entry_type, 'adjust') = 'reverse' and ${this.inPer(per, sql`created_at`)}), 0)::bigint as reverse,
        coalesce(sum(delta) filter (where coalesce(entry_type, 'adjust') = 'merge' and ${this.inPer(per, sql`created_at`)}), 0)::bigint as merge,
        coalesce(sum(delta) filter (where ${per.end ? sql`created_at < ${per.end}` : sql`true`}), 0)::bigint as closing
      from loyalty_ledger where tenant_id = ${T}`.execute(this.db)).rows[0] ?? {};
    const bySum = LOYALTY_ENTRY_TYPES.reduce((a, t) => a + N(roll[t]), 0);
    const rollOk = N(roll.opening) + bySum === N(roll.closing);
    const top = N(s.mismatched) > 0 ? (await sql<any>`with led as (select customer_id, sum(delta)::bigint as s from loyalty_ledger where tenant_id = ${T} group by 1)
        select p.customer_id, c.full_name, p.points_balance::bigint as balance, coalesce(l.s, 0)::bigint as ledger
        from customer_loyalty_profiles p left join led l on l.customer_id = p.customer_id left join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
        where p.tenant_id = ${T} and coalesce(l.s, 0) <> p.points_balance order by abs(coalesce(l.s, 0) - p.points_balance) desc, p.customer_id limit 10`.execute(this.db)).rows : [];
    const network = (await sql<any>`select coalesce(sum(delta_tenths) filter (where entry_type = 'earn'), 0)::bigint as earned from global_points_ledger where tenant_id = ${T}`.execute(this.db).catch(() => ({ rows: [{ earned: null }] }))).rows[0];
    const defects: any[] = [];
    if (N(s.mismatched) > 0) defects.push({ code: 'loyalty_balance_vs_ledger', severity: 'high', amount: N(s.mismatch_points), unit: 'points', source: 'customer_loyalty_profiles.points_balance vs sum(loyalty_ledger.delta)',
      detail: `${N(s.mismatched)} member balance(s) differ from their ledger by ${N(s.mismatch_points)} point(s) in total.`, owner: 'Loyalty (LoyaltyLedgerService)', remediation: 'Open', examples: top.map((r: any) => ({ customer: r.full_name ?? 'Unknown', balance: N(r.balance), ledger: N(r.ledger) })) });
    if (N(s.negative_profiles) > 0) defects.push({ code: 'loyalty_negative_balance', severity: 'medium', amount: N(s.negative_profiles), unit: 'profiles', source: 'customer_loyalty_profiles.points_balance < 0',
      detail: 'The published Points Outstanding counts a negative balance as 0, so it is higher than the ledger sum.', owner: 'Loyalty', remediation: 'Open' });
    if (N(s.orphan_ledger_customers) > 0) defects.push({ code: 'loyalty_ledger_without_profile', severity: 'medium', amount: N(s.orphan_ledger_customers), unit: 'customers', source: 'loyalty_ledger rows with no customer_loyalty_profiles row',
      detail: 'Ledger points exist for customers with no member profile; they are not in Points Outstanding.', owner: 'Loyalty', remediation: 'Open' });
    if (N(s.members) > 5000) defects.push({ code: 'loyalty_published_truncated', severity: 'high', amount: N(s.members) - 5000, unit: 'profiles', source: 'LoyaltyKyselyRepository.listProfiles limit 5000',
      detail: 'The published loyalty card reads at most 5,000 profiles, so its totals are short.', owner: 'Loyalty', remediation: 'Open' });
    const caveats = ['Published by GET /pos/loyalty/state: profiles of the session branch PLUS profiles with no branch (not tenant-wide when profiles carry branches), at most 5,000 profiles, negative balances counted as 0.'];
    if (N(s.branch_profiles) > 0 && N(s.profile_branches) > 1) caveats.push(`${N(s.branch_profiles)} profile(s) carry a branch across ${N(s.profile_branches)} branches, so the published card differs per branch session; this check is tenant-wide.`);
    void ctx;
    return {
      key: 'loyalty', title: 'Loyalty points outstanding',
      status: defects.some((d) => d.severity === 'high') ? 'failed' : defects.length ? 'attention_required' : 'ready',
      values: { members: N(s.members), pointsOutstandingTenantWide: N(s.balance_sum), publishedBasisTenantWide: N(s.published_basis), ledgerTotal: N(s.ledger_total) },
      formula: 'Points outstanding = Σ customer_loyalty_profiles.points_balance; must equal Σ loyalty_ledger.delta (migration 540 invariant).',
      rollForward: { opening: N(roll.opening), earned: N(roll.earn), redeemed: N(roll.redeem), reversed: N(roll.reverse), adjusted: N(roll.adjust), merged: N(roll.merge), expired: 0, closing: N(roll.closing), balanced: rollOk,
        expiryNote: 'The tenant loyalty ledger has no expiry entry type (earn, redeem, adjust, reverse, merge), so expiry is 0 by construction, not measured.' },
      separateLiabilities: { globalRewardsEarnedTenthsAtThisSalon: network?.earned == null ? null : N(network.earned),
        note: 'AI PowerSalon Rewards (the global network) is a separate, token-funded ledger and is NOT included in these points. Gift cards and promotional discounts are separate liabilities too.' },
      caveats, defects,
    };
  }

  private async recGiftCards(T: string, per: MgPeriod) {
    const owed = sql.join(GC_OWED.map((s) => sql`${s}`));
    const s = (await sql<any>`select
        count(*) filter (where status in ('active', 'partially_redeemed') and balance_cents > 0)::int as active,
        coalesce(sum(balance_cents) filter (where status in (${owed})), 0)::bigint as outstanding,
        count(*) filter (where status in (${owed}) and lt.bal is not null and lt.bal <> balance_cents)::int as mismatched,
        coalesce(sum(abs(lt.bal - balance_cents)) filter (where status in (${owed}) and lt.bal is not null and lt.bal <> balance_cents), 0)::bigint as mismatch_cents,
        count(*) filter (where status in (${owed}) and balance_cents > 0 and lt.bal is null)::int as no_ledger,
        count(*) filter (where balance_cents < 0)::int as negative
      from gift_cards g left join lateral (select t.balance_after_cents as bal from gift_card_transactions t where t.tenant_id = g.tenant_id and t.gift_card_id = g.id and t.balance_after_cents is not null
        order by t.created_at desc, t.id desc limit 1) lt on true
      where g.tenant_id = ${T}`.execute(this.db)).rows[0];
    const act = (await sql<any>`select
        coalesce(sum(abs(amount_cents)) filter (where type in (${sql.join(GC_ISSUE.map((x) => sql`${x}`))})), 0)::bigint as issued,
        coalesce(sum(abs(amount_cents)) filter (where type in (${sql.join(GC_REDEEM.map((x) => sql`${x}`))})), 0)::bigint as redeemed,
        coalesce(sum(amount_cents) filter (where type = 'refund'), 0)::bigint as refunded,
        coalesce(sum(amount_cents) filter (where type = 'adjust'), 0)::bigint as adjusted,
        coalesce(sum(abs(amount_cents)) filter (where type in ('cancel', 'expire', 'chargeback')), 0)::bigint as voided,
        count(*)::int as events
      from gift_card_transactions where tenant_id = ${T} and ${this.inPer(per, sql`created_at`)}`.execute(this.db)).rows[0];
    const defects: any[] = [];
    if (N(s.mismatched) > 0) defects.push({ code: 'gift_card_balance_vs_ledger', severity: 'high', amount: N(s.mismatch_cents), unit: 'cents', source: 'gift_cards.balance_cents vs the latest gift_card_transactions.balance_after_cents',
      detail: `${N(s.mismatched)} card(s) hold a balance that differs from their last ledger entry.`, owner: 'Gift Cards', remediation: 'Open' });
    if (N(s.no_ledger) > 0) defects.push({ code: 'gift_card_without_ledger', severity: 'medium', amount: N(s.no_ledger), unit: 'cards', source: 'gift_cards with a balance and no gift_card_transactions row',
      detail: 'Cards owe a balance but have no ledger history to prove it (imported or legacy cards).', owner: 'Gift Cards', remediation: 'Open' });
    if (N(s.negative) > 0) defects.push({ code: 'gift_card_negative_balance', severity: 'high', amount: N(s.negative), unit: 'cards', source: 'gift_cards.balance_cents < 0', detail: 'A card balance is negative.', owner: 'Gift Cards', remediation: 'Open' });
    return {
      key: 'gift_cards', title: 'Gift card balance and liability',
      status: defects.some((d) => d.severity === 'high') ? 'failed' : defects.length ? 'attention_required' : 'ready',
      values: { activeCards: N(s.active), outstandingCents: N(s.outstanding) },
      formula: `Outstanding = Σ gift_cards.balance_cents where status in (${GC_OWED.join(', ')}) — the same set the Gift Cards screen sums. Active = status active / partially_redeemed with a balance.`,
      activityInPeriod: { issuedCents: N(act.issued), redeemedCents: N(act.redeemed), refundedCents: N(act.refunded), adjustedCents: N(act.adjusted), voidedOrExpiredCents: N(act.voided), events: N(act.events),
        note: 'Issuance (a liability taken on) and a later redemption (service delivered) are two different events; neither is counted twice as revenue here.' },
      caveats: [], defects,
    };
  }

  private async recReferrals(T: string) {
    const s = (await sql<any>`select (select count(*)::int from customer_referrals where tenant_id = ${T}) as codes,
        count(*)::int as total, count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'rewarded')::int as rewarded,
        coalesce(sum(reward_cents) filter (where status = 'rewarded'), 0)::bigint as published_value,
        count(*) filter (where referrer_customer_id = referred_customer_id)::int as self_refs,
        coalesce(sum(reward_cents) filter (where status = 'rewarded' and referrer_customer_id = referred_customer_id), 0)::bigint as self_value,
        count(*) filter (where status = 'rewarded' and coalesce(reward_cents, 0) <= 0)::int as rewarded_without_value,
        count(*) filter (where status = 'rewarded' and rewarded_at is null)::int as rewarded_without_date
      from referral_redemptions where tenant_id = ${T}`.execute(this.db)).rows[0];
    const dup = (await sql<any>`select count(*)::int as groups, coalesce(sum(n - 1), 0)::int as extra, coalesce(sum(extra_value), 0)::bigint as extra_value from (
        select referred_customer_id, count(*) as n,
          coalesce(sum(reward_cents) filter (where status = 'rewarded'), 0) - coalesce(max(reward_cents) filter (where status = 'rewarded'), 0) as extra_value
        from referral_redemptions where tenant_id = ${T} and referrer_customer_id <> referred_customer_id group by 1 having count(*) > 1) x`.execute(this.db)).rows[0];
    const verifiedValue = N(s.published_value) - N(s.self_value) - N(dup.extra_value);
    const defects: any[] = [];
    if (N(s.self_refs) > 0) defects.push({ code: 'referral_self', severity: 'high', amount: N(s.self_value), unit: 'cents', source: 'referral_redemptions where referrer = referred', detail: `${N(s.self_refs)} self-referral(s) are counted in Referrals.`, owner: 'Referrals', remediation: 'Open' });
    if (N(dup.groups) > 0) defects.push({ code: 'referral_duplicate_referred', severity: 'high', amount: N(dup.extra_value), unit: 'cents', source: 'referral_redemptions: the same referred customer more than once', detail: `${N(dup.groups)} customer(s) were referred more than once (${N(dup.extra)} extra row(s)).`, owner: 'Referrals', remediation: 'Open' });
    if (N(s.rewarded_without_value) > 0) defects.push({ code: 'referral_rewarded_without_value', severity: 'medium', amount: N(s.rewarded_without_value), unit: 'referrals', source: 'referral_redemptions status rewarded, reward_cents ≤ 0', detail: 'Marked rewarded with no reward value — the payout cannot be traced.', owner: 'Referrals', remediation: 'Open' });
    if (N(s.rewarded_without_date) > 0) defects.push({ code: 'referral_rewarded_without_date', severity: 'low', amount: N(s.rewarded_without_date), unit: 'referrals', source: 'referral_redemptions status rewarded, rewarded_at null', detail: 'Rewarded without a reward date.', owner: 'Referrals', remediation: 'Open' });
    return {
      key: 'referrals', title: 'Referral rewards',
      status: defects.some((d) => d.severity === 'high') ? 'failed' : defects.length ? 'attention_required' : 'ready',
      values: { codesIssued: N(s.codes), referrals: N(s.total), pending: N(s.pending), rewarded: N(s.rewarded), publishedRewardValueCents: N(s.published_value), verifiedRewardValueCents: verifiedValue },
      formula: 'Reward value = Σ referral_redemptions.reward_cents where status = rewarded. Verified value excludes self-referrals and repeat rewards for the same referred customer.',
      caveats: ['A reward value is a recorded reward on the referral row; no separate payout ledger exists for referrals, so "paid out" means "marked rewarded", not a verified disbursement.'],
      defects,
    };
  }

  private async recCampaigns(ctx: RetentionContext) {
    const T = ctx.tenantId;
    const legacy = (await sql<any>`select coalesce(sum(revenue_cents), 0)::bigint as rev, coalesce(sum(cost_cents), 0)::bigint as cost, count(*) filter (where coalesce(revenue_cents, 0) > 0)::int as typed_rev,
        count(*)::int as campaigns from campaigns where tenant_id = ${T}`.execute(this.db)).rows[0];
    const legacyRoas = N(legacy.cost) > 0 ? Math.round((N(legacy.rev) / N(legacy.cost)) * 10) / 10 : null;
    let verified: any = null; let verifiedNote = 'Campaign Center is not available.';
    if (this.cc) {
      try {
        const ov: any = await this.cc.overview(ctx, { preset: 'all' });
        verified = { revenueCents: N(ov.kpis.campaignRevenueCents), roi: ov.kpis.avgRoi ?? null, roiNote: ov.kpis.avgRoiNote, totalSent: N(ov.kpis.totalSent), campaigns: N(ov.kpis.totalCampaigns) };
        verifiedNote = 'Campaign Center: revenue = paid tickets that redeemed a code issued for the campaign (refunded / voided excluded); ROI only when every sent message has a provider cost.';
      } catch (e: any) { verifiedNote = `Campaign Center could not be read (${String(e?.code ?? e?.message ?? 'error')}).`; }
    }
    const defects: any[] = [];
    defects.push(...(legacyRoas == null ? [{ code: 'campaign_roi_zero_for_unknown', severity: 'high', amount: null, unit: 'ratio', source: 'campaigns.dto avgRoi (0 when no cost)',
      detail: 'The old dashboard showed ROI "0x" when no campaign cost was recorded; an unknown ROI must read N/A.', owner: 'Marketing', remediation: 'Fixed in this build (null → N/A)' }] : []));
    if (N(legacy.typed_rev) > 0) defects.push({ code: 'campaign_revenue_typed', severity: 'medium', amount: N(legacy.rev), unit: 'cents', source: 'campaigns.revenue_cents (hand-entered)',
      detail: `${N(legacy.typed_rev)} campaign(s) carry a typed revenue figure that no ticket proves; Campaign Center ignores it.`, owner: 'Marketing', remediation: 'Shown separately; not counted' });
    return {
      key: 'campaigns', title: 'Campaign revenue and ROI',
      status: verified ? (defects.some((d) => d.severity === 'high' && !/Fixed/.test(d.remediation)) ? 'failed' : defects.length ? 'attention_required' : 'ready') : 'unknown',
      values: { legacyRevenueCents: N(legacy.rev), legacyCostCents: N(legacy.cost), legacyRevenueOverCost: legacyRoas, verifiedRevenueCents: verified?.revenueCents ?? null, verifiedRoi: verified?.roi ?? null, campaigns: N(legacy.campaigns) },
      formula: 'Verified: Campaign Center code-attributed revenue; ROI = (revenue − provider cost) ÷ provider cost, N/A without complete cost. Legacy (old card): revenue ÷ cost from typed campaign fields — that is ROAS, not ROI.',
      caveats: [verifiedNote], defects,
    };
  }

  private async recPromotions(T: string) {
    const red = sql.join(REDEEMED.map((x) => sql`${x}`));
    const s = (await sql<any>`select coalesce(sum(d.redemption_count), 0)::bigint as counter,
        (select count(*)::int from deal_redemptions r where r.tenant_id = ${T} and r.status in (${red})) as ledger,
        (select count(*)::int from (select d2.id from deals d2 where d2.tenant_id = ${T}
           and coalesce(d2.redemption_count, 0) <> (select count(*) from deal_redemptions r where r.tenant_id = d2.tenant_id and r.deal_id = d2.id and r.status in (${red}))) x) as drifted
      from deals d where d.tenant_id = ${T}`.execute(this.db)).rows[0];
    const defects: any[] = [];
    if (N(s.drifted) > 0) defects.push({ code: 'promotion_counter_vs_ledger', severity: 'medium', amount: Math.abs(N(s.counter) - N(s.ledger)), unit: 'redemptions', source: 'deals.redemption_count vs deal_redemptions (redeemed / partially_reversed)',
      detail: `${N(s.drifted)} promotion(s) carry a usage counter that differs from their completed redemption rows (the counter includes reservations still at Checkout).`, owner: 'Deals', remediation: 'Open' });
    return {
      key: 'promotions', title: 'Promotions and redemptions', status: defects.length ? 'attention_required' : 'ready',
      values: { usageCounter: N(s.counter), completedRedemptions: N(s.ledger) },
      formula: 'Redemptions = completed deal_redemptions (redeemed / partially_reversed) — the same rule as Discounts and Campaign Center. A reservation at an unpaid ticket is not a redemption.',
      caveats: [], defects,
    };
  }

  private async recReviews(T: string) {
    const s = (await sql<any>`select count(*)::int as total, count(*) filter (where coalesce(is_spam, false))::int as spam, count(*) filter (where coalesce(is_hidden_by_manager, false))::int as hidden,
        round(avg(rating)::numeric, 1) as avg_all, round(avg(rating) filter (where not coalesce(is_spam, false))::numeric, 1) as avg_clean,
        count(distinct coalesce(source, 'internal'))::int as sources, count(*) filter (where external_review_id is not null)::int as external
      from reviews where tenant_id = ${T}`.execute(this.db)).rows[0];
    const defects: any[] = [];
    if (N(s.total) === 0) defects.push({ code: 'reviews_zero_average', severity: 'low', amount: 0, unit: 'reviews', source: 'reviews (none)', detail: 'With no reviews the old card showed "0 ★"; the average is N/A.', owner: 'Marketing', remediation: 'Fixed in this build (N/A)' });
    if (N(s.spam) > 0) defects.push({ code: 'reviews_spam_in_average', severity: 'medium', amount: N(s.spam), unit: 'reviews', source: 'reviews.is_spam', detail: 'The published average includes reviews marked as spam.', owner: 'Reviews', remediation: 'Open' });
    if (N(s.total) > 1000) defects.push({ code: 'reviews_published_truncated', severity: 'high', amount: N(s.total) - 1000, unit: 'reviews', source: 'ReviewsKyselyRepository.list limit 1000', detail: 'The published review card reads at most 1,000 reviews.', owner: 'Reviews', remediation: 'Open' });
    return {
      key: 'reviews', title: 'Average rating and review count',
      status: defects.some((d) => d.severity === 'high') ? 'failed' : defects.some((d) => !/Fixed/.test(d.remediation)) ? 'attention_required' : 'ready',
      values: { reviews: N(s.total), averageAll: s.avg_all == null ? null : Number(s.avg_all), averageExcludingSpam: s.avg_clean == null ? null : Number(s.avg_clean), spam: N(s.spam), hidden: N(s.hidden), externalSources: N(s.external) },
      formula: 'Average = mean of reviews.rating for the salon (every source, hidden reviews included, spam included in the published card); N/A when there are no reviews.',
      caveats: ['Deduplication: one row per stored review; imported provider reviews are matched by external_review_id.'], defects,
    };
  }

  // ── §05 search ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async search(ctx: RetentionContext, q: { q?: unknown; scope?: unknown; page?: unknown; pageSize?: unknown; branch?: unknown }) {
    const scope = pick(MG_SCOPES, q.scope) ?? 'all';
    if (q.scope != null && q.scope !== '' && !pick(MG_SCOPES, q.scope)) throw new MarketingGrowthError('Unknown search scope.', 'MKT_GROWTH_INVALID_FILTER');
    const raw = typeof q.q === 'string' ? q.q.trim().slice(0, 100) : '';
    const { scope: bs } = await this.scopeAndPeriod(ctx, { branch: q.branch });
    const page = clampPage(q.page), pageSize = clampSize(q.pageSize, 10);
    const empty: { scope: string; q: string; groups: unknown[]; total: number } = { scope, q: raw, groups: [], total: 0 };
    if (raw.length < 2) return { ...empty, hint: 'Type at least 2 characters.' };
    const T = ctx.tenantId; const l = like(raw); const digits = raw.replace(/\D/g, ''); const phoneish = digits.length >= 4 && !/[a-z]/i.test(raw); const isId = isUuid(raw.toLowerCase());
    // one fixed alias (c) for every customer match — no dynamic identifiers
    const custMatch = sql`(c.full_name ilike ${l} or c.first_name ilike ${l} or c.last_name ilike ${l} or coalesce(c.email, '') ilike ${l}
      or (${phoneish} and regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'}) or (${isId} and c.id::text = ${raw.toLowerCase()}))`;
    const groups: Record<Exclude<MgScope, 'all'>, { count: any; rows: any; map: (r: any) => any }> = {
      customers: {
        count: sql`select count(*)::int as n from customers c where c.tenant_id = ${T} and c.status <> 'archived' and ${custMatch}`,
        rows: sql`select c.id, c.full_name, c.normalized_phone, c.email, c.created_at from customers c where c.tenant_id = ${T} and c.status <> 'archived' and ${custMatch}`,
        map: (r) => ({ id: String(r.id), title: r.full_name ?? 'Unknown', sub: [maskPhone(r.normalized_phone), maskEmail(r.email)].filter(Boolean).join(' · '), at: iso(r.created_at), link: { kind: 'journey', customerId: String(r.id) } }),
      },
      campaigns: {
        count: sql`select count(*)::int as n from campaigns c where c.tenant_id = ${T} and (c.branch_id is null or ${this.br(bs, sql`c.branch_id`)}) and (c.name ilike ${l} or coalesce(c.offer, '') ilike ${l} or coalesce(c.audience_label, '') ilike ${l} or c.status ilike ${l} or c.channel ilike ${l} or (${isId} and c.id::text = ${raw.toLowerCase()}))`,
        rows: sql`select c.id, c.name, c.channel, c.status, c.created_at from campaigns c where c.tenant_id = ${T} and (c.branch_id is null or ${this.br(bs, sql`c.branch_id`)}) and (c.name ilike ${l} or coalesce(c.offer, '') ilike ${l} or coalesce(c.audience_label, '') ilike ${l} or c.status ilike ${l} or c.channel ilike ${l} or (${isId} and c.id::text = ${raw.toLowerCase()}))`,
        map: (r) => ({ id: String(r.id), title: r.name, sub: `${String(r.channel).toUpperCase()} · ${r.status}`, at: iso(r.created_at), link: { kind: 'route', to: '/tenant/marketing/campaigns' } }),
      },
      offers: {
        count: sql`select count(*)::int as n from deals d where d.tenant_id = ${T} and (d.title ilike ${l} or coalesce(d.short_description, '') ilike ${l} or (${isId} and d.id::text = ${raw.toLowerCase()})
          or exists (select 1 from deal_coupon_codes k where k.tenant_id = d.tenant_id and k.deal_id = d.id and ${raw.length >= 2} and k.code_hint ilike ${'%' + raw.toUpperCase().replace(/[^A-Z0-9]/g, '') + '%'}))`,
        rows: sql`select d.id, d.title, d.kind, d.created_at, d.discount_type from deals d where d.tenant_id = ${T} and (d.title ilike ${l} or coalesce(d.short_description, '') ilike ${l} or (${isId} and d.id::text = ${raw.toLowerCase()})
          or exists (select 1 from deal_coupon_codes k where k.tenant_id = d.tenant_id and k.deal_id = d.id and ${raw.length >= 2} and k.code_hint ilike ${'%' + raw.toUpperCase().replace(/[^A-Z0-9]/g, '') + '%'}))`,
        map: (r) => ({ id: String(r.id), title: r.title, sub: String(r.kind ?? 'deal'), at: iso(r.created_at), link: { kind: 'route', to: r.kind === 'coupon' ? '/tenant/marketing/coupons' : '/tenant/marketing/deals' } }),
      },
      loyalty: {
        count: sql`select count(*)::int as n from customer_loyalty_profiles p join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id where p.tenant_id = ${T} and ${custMatch}`,
        rows: sql`select p.customer_id as id, c.full_name, p.loyalty_tier, p.points_balance, p.created_at from customer_loyalty_profiles p join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id where p.tenant_id = ${T} and ${custMatch}`,
        map: (r) => ({ id: String(r.id), title: r.full_name ?? 'Unknown', sub: `${r.loyalty_tier ?? 'Regular'} · ${N(r.points_balance)} pts`, at: iso(r.created_at), link: { kind: 'journey', customerId: String(r.id) } }),
      },
      referrals: {
        count: sql`select count(*)::int as n from referral_redemptions x left join customers a on a.id = x.referrer_customer_id and a.tenant_id = x.tenant_id left join customers b on b.id = x.referred_customer_id and b.tenant_id = x.tenant_id
          where x.tenant_id = ${T} and (x.code ilike ${l} or coalesce(a.full_name, '') ilike ${l} or coalesce(b.full_name, '') ilike ${l})`,
        rows: sql`select x.id, x.code, x.status, x.reward_cents, x.redeemed_at as created_at, a.full_name as referrer, b.full_name as referred from referral_redemptions x left join customers a on a.id = x.referrer_customer_id and a.tenant_id = x.tenant_id left join customers b on b.id = x.referred_customer_id and b.tenant_id = x.tenant_id
          where x.tenant_id = ${T} and (x.code ilike ${l} or coalesce(a.full_name, '') ilike ${l} or coalesce(b.full_name, '') ilike ${l})`,
        map: (r) => ({ id: String(r.id), title: `${r.referrer ?? 'Unknown'} → ${r.referred ?? 'Unknown'}`, sub: `${r.code} · ${r.status}`, at: iso(r.created_at), link: { kind: 'route', to: '/tenant/marketing/referrals' } }),
      },
      // gift cards: masked references only, never a balance, and only an EXACT last-4 / exact reference — no enumeration
      gift_cards: {
        count: sql`select count(*)::int as n from gift_cards g where g.tenant_id = ${T} and g.status not in ('draft', 'pending_payment') and ((${/^\d{4}$/.test(raw)} and g.card_number_last4 = ${raw}) or (${raw.length >= 6} and upper(coalesce(g.reference, '')) = ${raw.toUpperCase()}))`,
        rows: sql`select g.id, g.card_number_last4, g.status, g.created_at from gift_cards g where g.tenant_id = ${T} and g.status not in ('draft', 'pending_payment') and ((${/^\d{4}$/.test(raw)} and g.card_number_last4 = ${raw}) or (${raw.length >= 6} and upper(coalesce(g.reference, '')) = ${raw.toUpperCase()}))`,
        map: (r) => ({ id: String(r.id), title: `Gift card •••• ${r.card_number_last4 ?? '????'}`, sub: String(r.status), at: iso(r.created_at), link: { kind: 'route', to: '/tenant/customers/gift-cards' } }),
      },
      reviews: {
        count: sql`select count(*)::int as n from reviews v left join customers c on c.id = v.customer_id and c.tenant_id = v.tenant_id where v.tenant_id = ${T} and ${this.br(bs, sql`v.branch_id`)} and (coalesce(v.comment, '') ilike ${l} or coalesce(v.reviewer_name, '') ilike ${l} or coalesce(c.full_name, '') ilike ${l} or coalesce(v.source, '') ilike ${l})`,
        rows: sql`select v.id, v.rating, coalesce(v.reviewer_name, c.full_name) as who, v.source, v.response_status, coalesce(v.review_date, v.created_at) as created_at from reviews v left join customers c on c.id = v.customer_id and c.tenant_id = v.tenant_id where v.tenant_id = ${T} and ${this.br(bs, sql`v.branch_id`)} and (coalesce(v.comment, '') ilike ${l} or coalesce(v.reviewer_name, '') ilike ${l} or coalesce(c.full_name, '') ilike ${l} or coalesce(v.source, '') ilike ${l})`,
        map: (r) => ({ id: String(r.id), title: `${Number(r.rating)} ★ · ${r.who ?? 'Anonymous'}`, sub: `${r.source ?? 'internal'} · ${r.response_status ?? 'no reply'}`, at: iso(r.created_at), link: { kind: 'route', to: '/tenant/marketing/reviews' } }),
      },
    };
    const keys = (scope === 'all' ? (Object.keys(groups) as (keyof typeof groups)[]) : [scope as keyof typeof groups]);
    const out: any[] = [];
    for (const k of keys) {
      const g = groups[k];
      const count = N((await sql<any>`${g.count}`.execute(this.db)).rows[0]?.n);
      const size = scope === 'all' ? 5 : pageSize; const off = scope === 'all' ? 0 : (page - 1) * pageSize;
      const rows = count ? (await sql<any>`select * from (${g.rows}) z order by z.created_at desc nulls last, z.id desc limit ${size} offset ${off}`.execute(this.db)).rows : [];
      out.push({ scope: k, count, items: rows.map(g.map), ...(scope === 'all' ? {} : { pagination: { page, pageSize, totalItems: count, totalPages: Math.max(1, Math.ceil(count / pageSize)) } }) });
    }
    return { scope, q: raw, groups: out, total: out.reduce((a, g) => a + g.count, 0), sensitive: keys.includes('gift_cards') || keys.includes('customers') };
  }

  // ── §06 activity (and §15 journey) ─────────────────────────────────────────────────────────────────────────────────
  /** ONE normalised event per real source row. Date basis per type is fixed and reported (`basisByType`). */
  private events(T: string, scope: BranchScope, customerId: string | null) {
    const cust = (col: any) => (customerId ? sql`${col} = ${customerId}::uuid` : sql`true`);
    const b = (col: any) => this.br(scope, col);
    return sql`
      select 'campaign:' || c.id as id, 'campaign' as type, c.created_at as at, null::uuid as customer_id, c.branch_id, c.name as title, c.channel || ' · ' || c.status as detail, null::bigint as amount_cents, null::bigint as points, 'campaigns' as source, c.id::text as source_id
        from campaigns c where c.tenant_id = ${T} and ${customerId ? sql`false` : sql`true`} and (c.branch_id is null or ${b(sql`c.branch_id`)})
      union all
      select 'message:' || s.id, 'message', s.created_at, s.customer_id, s.branch_id, coalesce(c.name, 'Campaign message'), s.channel || ' · ' || s.status || coalesce(' · ' || s.skip_reason, ''), null, null, 'ai_marketing_campaign_sends', s.id::text
        from ai_marketing_campaign_sends s left join campaigns c on c.id = s.campaign_id and c.tenant_id = s.tenant_id where s.tenant_id = ${T} and ${cust(sql`s.customer_id`)} and ${b(sql`s.branch_id`)}
      union all
      select 'redemption:' || r.id, 'redemption', coalesce(r.redeemed_at, r.created_at), r.customer_id, r.branch_id, coalesce(d.title, 'Promotion'), r.status, r.amount_discounted_cents - coalesce(r.reversed_cents, 0), null, 'deal_redemptions', r.id::text
        from deal_redemptions r left join deals d on d.id = r.deal_id and d.tenant_id = r.tenant_id where r.tenant_id = ${T} and r.status in ('redeemed', 'partially_reversed', 'reversed') and ${cust(sql`r.customer_id`)} and ${b(sql`r.branch_id`)}
      union all
      select 'loyalty:' || x.id, 'loyalty', x.created_at, x.customer_id, x.branch_id, 'Loyalty ' || coalesce(x.entry_type, 'adjust'), coalesce(x.reason, x.description, ''), null, coalesce(x.delta, x.amount), 'loyalty_ledger', x.id::text
        from loyalty_ledger x where x.tenant_id = ${T} and ${cust(sql`x.customer_id`)} and ${b(sql`x.branch_id`)}
      union all
      select 'referral:' || f.id, 'referral', f.redeemed_at, f.referred_customer_id, null::uuid, 'Referral ' || f.code, f.status, case when f.status = 'rewarded' then f.reward_cents else null end, null, 'referral_redemptions', f.id::text
        from referral_redemptions f where f.tenant_id = ${T} and ${customerId ? sql`(f.referred_customer_id = ${customerId}::uuid or f.referrer_customer_id = ${customerId}::uuid)` : sql`true`} and ${scope.mode === 'tenant' && !scope.selected ? sql`true` : sql`false`}
      union all
      select 'gift_card:' || t.id, 'gift_card', t.created_at, g.customer_id, t.branch_id, 'Gift card •••• ' || coalesce(g.card_number_last4, '????'), t.type, t.amount_cents::bigint, null, 'gift_card_transactions', t.id::text
        from gift_card_transactions t join gift_cards g on g.id = t.gift_card_id and g.tenant_id = t.tenant_id where t.tenant_id = ${T} and ${cust(sql`g.customer_id`)} and ${b(sql`t.branch_id`)}
      union all
      select 'review:' || v.id, 'review', coalesce(v.review_date, v.created_at), v.customer_id, v.branch_id, round(v.rating, 1)::text || ' ★', coalesce(v.source, 'internal') || ' · ' || coalesce(v.response_status, 'no reply'), null, null, 'reviews', v.id::text
        from reviews v where v.tenant_id = ${T} and ${cust(sql`v.customer_id`)} and ${b(sql`v.branch_id`)}
      union all
      select 'visit:' || k.id, 'visit', coalesce(k.paid_at, k.created_at), k.customer_id, k.branch_id, 'Completed visit #' || coalesce(k.ticket_number, ''), k.status, k.total_cents::bigint, null, 'tickets', k.id::text
        from tickets k where k.tenant_id = ${T} and k.status in ('paid', 'closed') and k.removed_at is null and ${customerId ? sql`k.customer_id = ${customerId}::uuid` : sql`false`} and ${b(sql`k.branch_id`)}
      union all
      select 'appointment:' || p.id, 'appointment', p.created_at, p.customer_id, p.branch_id, 'Appointment ' || coalesce(p.appt_date::text, ''), p.status, null, null, 'pos_tech_appointments', p.id::text
        from pos_tech_appointments p where p.tenant_id = ${T} and ${customerId ? sql`p.customer_id = ${customerId}::uuid` : sql`false`} and ${b(sql`p.branch_id`)}`;
  }

  async activity(ctx: RetentionContext, q: { type?: unknown; preset?: unknown; from?: unknown; to?: unknown; branch?: unknown; page?: unknown; pageSize?: unknown }, customerId: string | null = null) {
    const types = typeof q.type === 'string' && q.type.trim() ? q.type.split(',').map((s) => s.trim()).filter(Boolean) : [];
    for (const t of types) if (!pick(MG_EVENT_TYPES, t)) throw new MarketingGrowthError('Unknown activity type.', 'MKT_GROWTH_INVALID_FILTER');
    const { per, scope } = await this.scopeAndPeriod(ctx, q, 'all');
    const page = clampPage(q.page), pageSize = clampSize(q.pageSize, 10);
    const T = ctx.tenantId;
    const where = sql`${types.length ? sql`e.type in (${sql.join(types.map((t) => sql`${t}`))})` : sql`true`} and ${this.inPer(per, sql`e.at`)}`;
    const total = N((await sql<any>`select count(*)::int as n from (${this.events(T, scope, customerId)}) e where ${where}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<any>`select e.*, c.full_name as customer_name from (${this.events(T, scope, customerId)}) e
        left join customers c on c.id = e.customer_id and c.tenant_id = ${T}
        where ${where} order by e.at desc nulls last, e.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      period: per, scope: { label: scope.label, selected: scope.selected, branches: scope.authorized }, types: types.length ? types : [...MG_EVENT_TYPES],
      basisByType: { campaign: 'created', message: 'send record created', redemption: 'redeemed (paid)', loyalty: 'ledger entry', referral: 'referral recorded', gift_card: 'ledger event', review: 'review date', visit: 'paid', appointment: 'booked' },
      items: rows.map((r: any) => ({ id: String(r.id), type: r.type, at: iso(r.at), customerId: r.customer_id ? String(r.customer_id) : null, customerName: r.customer_name ?? null,
        title: r.title, detail: r.detail ?? null, amountCents: r.amount_cents == null ? null : N(r.amount_cents), points: r.points == null ? null : N(r.points), source: r.source, sourceId: r.source_id })),
      pagination: { page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      note: 'Chronology is not causation: an event after a campaign message is shown in order, never as caused by it.',
    };
  }

  async journey(ctx: RetentionContext, customerId: string, q: Record<string, unknown>) {
    if (!isUuid(customerId)) throw new MarketingGrowthError('That customer could not be found.', 'CUSTOMER_NOT_FOUND', 404);
    const T = ctx.tenantId;
    const c = (await sql<any>`select c.id, c.full_name, c.normalized_phone, c.email, c.status, c.created_at, c.marketing_sms_opt_in, c.marketing_email_opt_in, c.birthday,
        (select count(*)::int from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.status in ('paid', 'closed') and t.removed_at is null) as visits,
        (select max(coalesce(t.paid_at, t.created_at)) from tickets t where t.tenant_id = c.tenant_id and t.customer_id = c.id and t.status in ('paid', 'closed') and t.removed_at is null) as last_visit,
        (select loyalty_tier from customer_loyalty_profiles p where p.tenant_id = c.tenant_id and p.customer_id = c.id limit 1) as tier,
        (select points_balance from customer_loyalty_profiles p where p.tenant_id = c.tenant_id and p.customer_id = c.id limit 1) as points,
        (select vip_since is not null from customer_loyalty_profiles p where p.tenant_id = c.tenant_id and p.customer_id = c.id limit 1) as vip,
        exists (select 1 from notification_opt_outs oo where oo.tenant_id = c.tenant_id and oo.channel = 'sms' and oo.address = c.normalized_phone) as sms_opted_out,
        exists (select 1 from notification_opt_outs oo where oo.tenant_id = c.tenant_id and oo.channel = 'email' and lower(oo.address) = lower(coalesce(c.email, ''))) as email_opted_out,
        (select count(*)::int from customers sib where sib.tenant_id = c.tenant_id and sib.id <> c.id and sib.status <> 'archived' and c.normalized_phone is not null and sib.normalized_phone = c.normalized_phone) as shared_phone
      from customers c where c.tenant_id = ${T} and c.id = ${customerId}::uuid`.execute(this.db)).rows[0];
    if (!c) throw new MarketingGrowthError('That customer could not be found.', 'CUSTOMER_NOT_FOUND', 404);
    const visits = N(c.visits);
    const timeline = await this.activity(ctx, q, customerId);
    return {
      customer: { id: String(c.id), name: c.full_name ?? 'Unknown', phone: maskPhone(c.normalized_phone), email: maskEmail(c.email), status: c.status, createdAt: iso(c.created_at),
        visits, lastVisitAt: iso(c.last_visit), segment: visits === 0 ? 'never_visited' : visits === 1 ? 'new' : 'returning', vip: !!c.vip, loyaltyTier: c.tier ?? null, loyaltyPoints: c.points == null ? null : N(c.points),
        birthday: c.birthday ? 'recorded' : 'not_recorded', sharedPhoneProfiles: N(c.shared_phone) },
      consent: {
        sms: c.sms_opted_out ? 'opted_out' : c.marketing_sms_opt_in ? 'opted_in' : 'no_consent',
        email: c.email_opted_out ? 'opted_out' : c.marketing_email_opt_in ? 'opted_in' : 'no_consent',
        note: 'Marketing consent only. A booking or verification text is transactional and never counts as marketing consent.',
      },
      timeline,
      booking: { route: `/booking/new?customerId=${encodeURIComponent(String(c.id))}&from=marketing`, note: 'Opens Booking with this customer preselected (the same handoff Customer Segments uses).' },
      privacy: N(c.shared_phone) > 0 ? `${N(c.shared_phone)} other profile(s) share this phone number. They are separate people and are NOT merged or shown here.` : null,
    };
  }

  // ── §14 economics ──────────────────────────────────────────────────────────────────────────────────────────────────
  async economics(ctx: RetentionContext, q: { preset?: unknown; from?: unknown; to?: unknown; basis?: unknown }) {
    const { per } = await this.scopeAndPeriod(ctx, q, 'all');
    const T = ctx.tenantId;
    const rows: any[] = [];
    if (this.cc) {
      const cq: Record<string, unknown> = { preset: per.preset === 'all' ? 'all' : 'custom', from: per.from ?? undefined, to: per.to ?? undefined, basis: q.basis === 'completed' ? 'completed' : 'created', pageSize: 50 };
      for (let page = 1; page <= 200; page++) {
        const r: any = await this.cc.list(ctx, { ...cq, page });
        rows.push(...(r.items ?? []));
        if (page >= N(r.pagination?.totalPages)) break;
      }
    }
    const camp = rows.map((r: any) => {
      const c = r.counts ?? {};
      const sent = N(c.submitted);
      const cost: number | null = c.actualCostCents == null ? (sent > 0 ? null : 0) : N(c.actualCostCents);
      const revenue = N(c.associatedRevenueCents); const discount = N(c.discountCents);
      const costState = sent === 0 ? 'no_spend' : cost == null ? 'missing' : 'recorded';
      return { id: r.id, name: r.name, channel: r.channel, status: r.displayStatus ?? r.status, budgetCents: N(r.budgetCents) || null, sent, spendCents: cost, costState, discountCents: discount, attributedRevenueCents: revenue,
        redemptions: N(c.redemptions), roi: cost && cost > 0 ? Math.round(((revenue - cost) / cost) * 100) / 100 : null, roas: cost && cost > 0 ? Math.round((revenue / cost) * 100) / 100 : null };
    });
    const sum = (f: (r: any) => number | null) => camp.reduce((a, r) => a + (f(r) ?? 0), 0);
    const missing = camp.filter((r) => r.costState === 'missing').length;
    const spend = missing ? null : sum((r) => r.spendCents);
    const revenue = sum((r) => r.attributedRevenueCents);
    const red = sql.join(REDEEMED.map((x) => sql`${x}`));
    const promo = (await sql<any>`select coalesce(sum(r.amount_discounted_cents - coalesce(r.reversed_cents, 0)), 0)::bigint as discount, count(*)::int as n,
        coalesce(sum(coalesce(r.reversed_cents, 0)), 0)::bigint as reversed
      from deal_redemptions r where r.tenant_id = ${T} and r.status in (${red}) and ${this.inPer(per, sql`coalesce(r.redeemed_at, r.created_at)`)}`.execute(this.db)).rows[0];
    const ref = (await sql<any>`select coalesce(sum(reward_cents), 0)::bigint as v, count(*)::int as n from referral_redemptions where tenant_id = ${T} and status = 'rewarded' and referrer_customer_id <> referred_customer_id
      and ${this.inPer(per, sql`coalesce(rewarded_at, redeemed_at)`)}`.execute(this.db)).rows[0];
    const loy = (await sql<any>`select coalesce(sum(value_cents) filter (where value_cents is not null), 0)::bigint as v, count(*) filter (where value_cents is null)::int as unvalued, count(*)::int as n
      from loyalty_redemptions where tenant_id = ${T} and coalesce(status, '') not in ('void', 'voided', 'cancelled') and ${this.inPer(per, sql`created_at`)}`.execute(this.db)).rows[0];
    const totals = { campaigns: camp.length, sent: sum((r) => r.sent), spendCents: spend, spendRecordedCents: sum((r) => r.spendCents), campaignsMissingCost: missing,
      campaignDiscountCents: sum((r) => r.discountCents), attributedRevenueCents: revenue,
      roi: spend && spend > 0 ? Math.round(((revenue - spend) / spend) * 100) / 100 : null, roas: spend && spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null };
    // reconciliation test (§14): the headline equals the sum of its rows
    const reconciled = totals.attributedRevenueCents === camp.reduce((a, r) => a + r.attributedRevenueCents, 0) && totals.campaignDiscountCents === camp.reduce((a, r) => a + r.discountCents, 0);
    return {
      period: per, generatedAt: new Date().toISOString(), totals, campaigns: camp,
      programCosts: {
        promotionDiscountCents: N(promo.discount), promotionRedemptions: N(promo.n), promotionReversedCents: N(promo.reversed),
        referralRewardCents: N(ref.v), referralRewards: N(ref.n),
        loyaltyRewardValueCents: N(loy.v), loyaltyRedemptions: N(loy.n), loyaltyRedemptionsWithoutValue: N(loy.unvalued),
        note: 'Discounts are revenue given up at Checkout, not cash expense. AI PowerSalon Rewards tokens are prefunded and are NOT counted again here.',
      },
      formulas: {
        spend: 'Provider cost recorded on each sent message (Campaign Center). Campaigns with sends but no recorded cost make total spend N/A — never 0.',
        attributedRevenue: 'Paid tickets that redeemed a code issued for the campaign; refunded / voided tickets excluded. Associated revenue without a code is not measured.',
        roi: 'ROI = (attributed revenue − spend) ÷ spend. Gross-revenue ROI, not profit: service labour, materials and processing costs are not recorded, so no margin or profit is shown.',
        roas: 'ROAS = attributed revenue ÷ spend.',
        margin: 'Not available: service cost data does not exist. Shown as N/A, never estimated.',
      },
      reconciliation: { reconciled, rule: 'Σ campaign rows = headline totals (cents, no rounding).' },
      excludes: ['Platform marketing subscriptions (AI PowerSalon billing) are not tenant campaign spend.'],
    };
  }
}
