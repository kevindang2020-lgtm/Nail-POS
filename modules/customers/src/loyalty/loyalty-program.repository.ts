// loyalty-program.repository.ts — Loyalty & Rewards mandate (Oct 29 2026): the server side of the POS
// Customers → Loyalty & Rewards screen (/tenant/customers/loyalty).
//
// Everything here is raw, parameterised SQL over the tables the platform already has — no parallel store:
//   customer_loyalty_profiles  one enrolment per (tenant, customer); points_balance is kept equal to the ledger
//   loyalty_ledger             the append-only points history (applyLoyaltyEntry is the ONE writer of balances)
//   loyalty_rewards            the salon's catalogue (create / edit / activate stay in modules/loyalty)
//   loyalty_redemptions        issued reward codes: issued → applied (reserved to a ticket) → used; or void
// The tenant is ALWAYS the session's (`ctx.tenantId`), written literally in every statement. Points move only through
// applyLoyaltyEntry (per-customer advisory lock, a business source applied at most once). Every list is newest first
// with a unique-id tie-break (spec §09) and server-side numbered pages; a page past the end is clamped.
import { sql, type Kysely } from 'kysely';
import { tenantTimeZone, canMoveToSql } from '@aipowersalon/database';
import { applyLoyaltyEntry, lockLoyaltyCustomer } from './loyalty-ledger.service';
import { secureString } from '@aipowersalon/security';
import { logException } from '@aipowersalon/observability';
import { LOYALTY_REDEMPTION } from './loyalty-redemption-machine';

/** The audit writer this repository records through (modules/audit AuditService.record). */
export interface AuditRecorder { record(ctx: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null }, input: { module: string; action: string; resourceType?: string | null; resourceId?: string | null; metadata?: Record<string, unknown> }): Promise<unknown> }
type AuditItem = { action: string; resourceType: string; resourceId: string; metadata: Record<string, unknown> };

export interface TierRow { id: string; name: string; rank: number; minPoints: number | null; benefits: string; active: boolean; members: number }
export interface LoyaltyProgramContext { tenantId: string; branchId?: string; userId: string; role: string; permissions: string[] }
export interface Page<T> { items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number }

/** The tier every new enrolment starts in — the label the ledger has always used for a new profile. Not invented here. */
export const DEFAULT_TIER = 'Regular';
export const MAX_PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const NO_ROWS: { rows: never[] } = { rows: [] };

export function clampPaging(page: unknown, pageSize: unknown, def = 10): { page: number; pageSize: number } {
  const ps = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(Number(pageSize)) || def));
  const p = Math.max(1, Math.trunc(Number(page)) || 1);
  return { page: p, pageSize: ps };
}
/** Total → the page actually served: a page past the last one is clamped to the last (spec §09 "clamp page index"). */
export function servedPage(page: number, pageSize: number, totalItems: number) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const p = Math.min(page, totalPages);
  return { page: p, totalPages, offset: (p - 1) * pageSize };
}

/** a reward's availability rules and what they leave, for the catalog and the redeem picker */
function rewardRules(r: any, today: string) {
  const stockTotal = r.stock_total == null ? null : N(r.stock_total);
  const stockLeft = stockTotal == null ? null : Math.max(0, stockTotal - N(r.redemptions));
  const startsOn = r.starts_on ? String(r.starts_on) : null, endsOn = r.ends_on ? String(r.ends_on) : null;
  const availability = !r.active ? 'inactive' as const : startsOn && today < startsOn ? 'upcoming' as const : endsOn && today > endsOn ? 'expired' as const : stockLeft === 0 ? 'out_of_stock' as const : 'available' as const;
  return { startsOn, endsOn, stockTotal, stockLeft, perMemberLimit: r.per_member_limit == null ? null : N(r.per_member_limit),
    eligibleTiers: Array.isArray(r.eligible_tiers) && r.eligible_tiers.length ? r.eligible_tiers.map(String) : null, availability };
}

/** THE redemption rules, in the order the front desk has always checked them (dates → stock → per-member limit → active
 *  and worth something → enrolled → tier → points). One function: redeem() refuses with it inside the locked transaction,
 *  and redeemOptions() (Checkout Upsell Assistant Settings 05) explains with it, read-only — never a second copy. */
export type RedeemBlockCode = 'REWARD_NOT_STARTED' | 'REWARD_EXPIRED' | 'REWARD_OUT_OF_STOCK' | 'REWARD_MEMBER_LIMIT' | 'REWARD_NOT_AVAILABLE' | 'LOYALTY_NOT_ENROLLED' | 'REWARD_TIER_NOT_ELIGIBLE' | 'LOYALTY_INSUFFICIENT_POINTS';
export function redeemBlock(
  reward: { starts_on?: unknown; ends_on?: unknown; stock_total?: unknown; per_member_limit?: unknown; active?: unknown; reward_type?: unknown; percent?: unknown; value_cents?: unknown; eligible_tiers?: unknown; points_cost?: unknown },
  member: { pointsBalance: number; tier: string | null } | null,
  used: { stockUsed: number; memberUsed: number },
  today: string,
): { code: RedeemBlockCode; message: string } | null {
  if (reward.starts_on && today < String(reward.starts_on)) return { code: 'REWARD_NOT_STARTED', message: 'This reward is not available yet.' };
  if (reward.ends_on && today > String(reward.ends_on)) return { code: 'REWARD_EXPIRED', message: 'This reward has ended.' };
  if (reward.stock_total != null && used.stockUsed >= N(reward.stock_total)) return { code: 'REWARD_OUT_OF_STOCK', message: 'This reward is out of stock.' };
  if (reward.per_member_limit != null && used.memberUsed >= N(reward.per_member_limit)) return { code: 'REWARD_MEMBER_LIMIT', message: 'This member has reached the limit for this reward.' };
  const worth = (reward.reward_type === 'percent_off' && N(reward.percent) > 0) || (reward.reward_type !== 'percent_off' && N(reward.value_cents) > 0);
  if (!reward.active || !worth) return { code: 'REWARD_NOT_AVAILABLE', message: 'That reward is not available right now.' };
  if (!member) return { code: 'LOYALTY_NOT_ENROLLED', message: 'Enrol the customer before redeeming.' };
  if (Array.isArray(reward.eligible_tiers) && reward.eligible_tiers.length && !reward.eligible_tiers.map(String).includes(String(member.tier || DEFAULT_TIER)))
    return { code: 'REWARD_TIER_NOT_ELIGIBLE', message: "This reward is not available for the member's tier." };
  if (member.pointsBalance < N(reward.points_cost)) return { code: 'LOYALTY_INSUFFICIENT_POINTS', message: 'Not enough points for this reward.' };
  return null;
}

/** One customer's redeem picker (Checkout Upsell Assistant Settings 05): the AUTHORITATIVE balance and tier from the
 *  loyalty profile, and every reward the salon funds with the redeem rule's answer for this member. Read-only. */
export interface RedeemOption { rewardId: string; title: string; pointsCost: number; rewardType: 'amount_off' | 'percent_off'; valueCents: number; percent: number; blockedBy: RedeemBlockCode | null }
export interface RedeemOptions { enrolled: boolean; balancePoints: number; tier: string | null; rewards: RedeemOption[] }

export class LoyaltyProgramError extends Error {
  constructor(message: string, readonly code: 'CUSTOMER_NOT_FOUND' | 'LOYALTY_ALREADY_ENROLLED' | 'LOYALTY_NOT_ENROLLED' | 'REWARD_NOT_FOUND' | 'REWARD_NOT_AVAILABLE'
    | 'LOYALTY_INSUFFICIENT_POINTS' | 'REDEMPTION_NOT_FOUND' | 'REDEMPTION_NOT_VOIDABLE' | 'IDEMPOTENCY_KEY_REQUIRED' | 'LOYALTY_INVALID_ENTRY'
    | 'REWARD_NOT_STARTED' | 'REWARD_EXPIRED' | 'REWARD_OUT_OF_STOCK' | 'REWARD_MEMBER_LIMIT' | 'REWARD_TIER_NOT_ELIGIBLE'
    | 'LOYALTY_TIER_INVALID' | 'LOYALTY_TIER_EXISTS' | 'LOYALTY_TIER_IN_USE' | 'LOYALTY_TIER_NOT_FOUND' | 'LOYALTY_DIRECT_EDIT_REFUSED', readonly status: 400 | 404 | 409 = 400) {
    super(message); this.name = 'LoyaltyProgramError';
  }
}

export interface LoyaltyOverview {
  period: { label: 'this_month'; start: string; timeZone: string };
  kpis: {
    loyaltyMembers: number; newMembersThisMonth: number;
    pointsOutstanding: number; ledgerBalance: number; balanceReconciled: boolean;
    activeRewards: number; totalRewards: number;
    redemptionsThisMonth: number; redemptionsPendingThisMonth: number; redemptionsUsedThisMonth: number; redemptionsVoidedThisMonth: number;
    pointsRedeemedThisMonth: number;
  };
  tiers: { tier: string; members: number; pct: number; points: number; minPoints?: number | null; benefits?: string; configured?: boolean }[];
}
export interface RewardRow { id: string; title: string; description: string; pointsCost: number; active: boolean; rewardType: 'amount_off' | 'percent_off'; valueCents: number; percent: number; validDays: number | null; createdAt: string | null; updatedAt: string | null; redemptions: number; redemptionsThisMonth: number 
  /** Loyalty guide (Nov 4 2026): availability rules and what they leave */
  startsOn: string | null; endsOn: string | null; stockTotal: number | null; stockLeft: number | null; perMemberLimit: number | null; eligibleTiers: string[] | null;
  availability: 'available' | 'inactive' | 'upcoming' | 'expired' | 'out_of_stock';}
export interface MemberRow { customerId: string; profileId: string; customerName: string; avatarUrl: string | null; maskedPhone: string | null; tier: string; pointsBalance: number; totalEarned: number; totalRedeemed: number; enrolledAt: string | null; lastActivityAt: string | null; customerStatus: string }
export interface RedemptionRow { id: string; customerId: string; customerName: string; rewardId: string; rewardTitle: string; pointsSpent: number; status: 'issued' | 'applied' | 'used' | 'void'; createdAt: string | null; appliedAt: string | null; usedAt: string | null; voidedAt: string | null; ticketId: string | null; expiresAt: string | null; valueCents: number; percent: number; rewardType: string }
export interface LedgerRow { id: string; customerId: string; customerName: string; entryType: string; delta: number; balanceAfter: number; reason: string | null; sourceTable: string | null; sourceId: string | null; actorUserId: string | null; createdAt: string | null }

const maskPhone = (p: string | null) => { if (!p) return null; const d = p.replace(/\D/g, ''); return d.length >= 4 ? `••• ${d.slice(-4)}` : '•••'; };

export class LoyaltyProgramRepository {
  constructor(private readonly db: Kysely<any>, private readonly auditor: AuditRecorder | null = null) {}

  private async monthStart(ctx: LoyaltyProgramContext): Promise<{ start: Date; tz: string }> {
    const tz = await tenantTimeZone(this.db, ctx.tenantId).catch(() => 'America/New_York');
    const r = await sql<{ m: Date }>`select (date_trunc('month', now() at time zone ${tz}) at time zone ${tz}) as m`.execute(this.db);
    return { start: new Date(r.rows[0]!.m), tz };
  }

  /** The five KPIs + tier distribution. One labelled period (this month, salon time) for every transaction count. */
  async overview(ctx: LoyaltyProgramContext): Promise<LoyaltyOverview> {
    const T = ctx.tenantId;
    const { start, tz } = await this.monthStart(ctx);
    const [m, l, rw, rd, tiers] = await Promise.all([
      sql<any>`select count(*)::int as members, count(*) filter (where p.created_at >= ${start})::int as new_month,
                      coalesce(sum(greatest(p.points_balance, 0)), 0)::bigint as outstanding
               from customer_loyalty_profiles p join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
               where p.tenant_id = ${T} and c.status <> 'archived'`.execute(this.db),
      // the reconciliation the daily loyalty.reconcile job enforces: Σ ledger deltas per live enrolment
      sql<any>`select coalesce(sum(greatest(x.bal, 0)), 0)::bigint as ledger from (
                 select l.customer_id, sum(l.delta) as bal from loyalty_ledger l
                 join customer_loyalty_profiles p on p.tenant_id = l.tenant_id and p.customer_id = l.customer_id
                 join customers c on c.id = l.customer_id and c.tenant_id = l.tenant_id
                 where l.tenant_id = ${T} and c.status <> 'archived' group by l.customer_id) x`.execute(this.db),
      sql<any>`select count(*) filter (where active)::int as active, count(*)::int as total from loyalty_rewards where tenant_id = ${T}`.execute(this.db),
      // Loyalty guide (Nov 4 2026): Redemptions and Points Redeemed are COMPLETED redemptions (the code was used at checkout);
      // issued / applied codes are pending and shown beside them — they used to be counted as done
      sql<any>`select count(*) filter (where status = 'used')::int as completed,
                      count(*) filter (where status in ('issued', 'applied'))::int as pending,
                      count(*) filter (where status = 'used')::int as used,
                      count(*) filter (where status = 'void')::int as voided,
                      coalesce(sum(points_spent) filter (where status = 'used'), 0)::bigint as points
               from loyalty_redemptions where tenant_id = ${T} and created_at >= ${start}`.execute(this.db),
      sql<any>`select p.loyalty_tier as tier, count(*)::int as members, coalesce(sum(greatest(p.points_balance, 0)), 0)::bigint as points
               from customer_loyalty_profiles p join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
               where p.tenant_id = ${T} and c.status <> 'archived' group by p.loyalty_tier order by members desc, p.loyalty_tier`.execute(this.db),
    ]);
    const conf = await this.configuredTiers(T);
    const mm = m.rows[0] || {}; const members = N(mm.members);
    const r = rd.rows[0] || {};
    const outstanding = N(mm.outstanding), ledger = N(l.rows[0]?.ledger);
    return {
      period: { label: 'this_month', start: start.toISOString(), timeZone: tz },
      kpis: {
        loyaltyMembers: members, newMembersThisMonth: N(mm.new_month),
        pointsOutstanding: outstanding, ledgerBalance: ledger, balanceReconciled: outstanding === ledger,
        activeRewards: N(rw.rows[0]?.active), totalRewards: N(rw.rows[0]?.total),
        redemptionsThisMonth: N(r.completed), redemptionsPendingThisMonth: N(r.pending), redemptionsUsedThisMonth: N(r.used), redemptionsVoidedThisMonth: N(r.voided),
        pointsRedeemedThisMonth: N(r.points),
      },
      // Loyalty guide (Nov 4 2026): a configured tier shows its threshold / benefits; a configured tier nobody holds yet is
      // still listed (0 members) — a label in use that was never configured shows as it always did
      tiers: [...tiers.rows.map((t: any) => { const name = String(t.tier || DEFAULT_TIER); const cf = conf.find((x) => x.name.toLowerCase() === name.toLowerCase());
          return { tier: name, members: N(t.members), pct: members ? Math.round((N(t.members) / members) * 1000) / 10 : 0, points: N(t.points), minPoints: cf?.minPoints ?? null, benefits: cf?.benefits ?? '', configured: !!cf }; }),
        ...conf.filter((cf) => cf.active && !tiers.rows.some((t: any) => String(t.tier || DEFAULT_TIER).toLowerCase() === cf.name.toLowerCase()))
          .map((cf) => ({ tier: cf.name, members: 0, pct: 0, points: 0, minPoints: cf.minPoints, benefits: cf.benefits, configured: true }))],
    };
  }

  async rewards(ctx: LoyaltyProgramContext, f: { page?: unknown; pageSize?: unknown; status?: string }): Promise<Page<RewardRow>> {
    const T = ctx.tenantId; const { page, pageSize } = clampPaging(f.page, f.pageSize, 5);
    const st = f.status === 'active' ? sql`and r.active` : f.status === 'inactive' ? sql`and not r.active` : sql``;
    const total = N((await sql<any>`select count(*)::int as n from loyalty_rewards r where r.tenant_id = ${T} ${st}`.execute(this.db)).rows[0]?.n);
    const sp = servedPage(page, pageSize, total);
    const { start } = await this.monthStart(ctx);
    const today = (await sql<{ d: string }>`select to_char((now() at time zone ${(await this.monthStart(ctx)).tz})::date, 'YYYY-MM-DD') as d`.execute(this.db)).rows[0]!.d;
    const rows = (await sql<any>`select r.id, r.title, r.description, r.points_cost, r.active, r.reward_type, r.value_cents, r.percent, r.valid_days, r.created_at, r.updated_at,
        to_char(r.starts_on, 'YYYY-MM-DD') as starts_on, to_char(r.ends_on, 'YYYY-MM-DD') as ends_on, r.stock_total, r.per_member_limit, r.eligible_tiers,
        (select count(*) from loyalty_redemptions d where d.tenant_id = r.tenant_id and d.reward_id = r.id and d.status <> 'void')::int as redemptions,
        (select count(*) from loyalty_redemptions d where d.tenant_id = r.tenant_id and d.reward_id = r.id and d.status <> 'void' and d.created_at >= ${start})::int as redemptions_month
      from loyalty_rewards r where r.tenant_id = ${T} ${st}
      order by r.created_at desc, r.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => ({ id: String(r.id), title: String(r.title), description: String(r.description ?? ''), pointsCost: N(r.points_cost), active: !!r.active,
      rewardType: r.reward_type === 'percent_off' ? 'percent_off' : 'amount_off', valueCents: N(r.value_cents), percent: N(r.percent), validDays: r.valid_days == null ? null : N(r.valid_days),
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), redemptions: N(r.redemptions), redemptionsThisMonth: N(r.redemptions_month),
      ...rewardRules(r, today) })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  async members(ctx: LoyaltyProgramContext, f: { page?: unknown; pageSize?: unknown; tier?: string; q?: string; status?: string; sort?: string }): Promise<Page<MemberRow>> {
    const T = ctx.tenantId; const { page, pageSize } = clampPaging(f.page, f.pageSize, 5);
    const tier = f.tier ? sql`and p.loyalty_tier = ${f.tier}` : sql``;
    // Loyalty guide (Nov 4 2026) "filter tier / status, sort newest enrolment first": status is the customer's own status
    // (active / inactive); sort is newest enrolment (default), highest balance, or most recent activity — ties break on id
    const status = f.status === 'active' || f.status === 'inactive' ? sql`and c.status = ${f.status}` : sql``;
    const order = f.sort === 'balance' ? sql`p.points_balance desc, p.created_at desc, p.id desc`
      : f.sort === 'activity' ? sql`last_activity desc nulls last, p.created_at desc, p.id desc` : sql`p.created_at desc, p.id desc`;
    const raw = String(f.q ?? '').trim(); const digits = raw.replace(/\D/g, '');
    const lk = '%' + raw.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';   // a typed % or _ is a literal, not a wildcard
    const search = raw ? sql`and (c.full_name ilike ${lk} or coalesce(c.email, '') ilike ${lk}${digits.length >= 3 ? sql` or coalesce(c.normalized_phone, '') like ${'%' + digits + '%'}` : sql``})` : sql``;
    const base = sql`from customer_loyalty_profiles p join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
                     where p.tenant_id = ${T} and c.status <> 'archived' ${tier} ${status} ${search}`;
    const total = N((await sql<any>`select count(*)::int as n ${base}`.execute(this.db)).rows[0]?.n);
    const sp = servedPage(page, pageSize, total);
    const rows = (await sql<any>`select p.id as profile_id, p.customer_id, c.full_name, c.avatar_url, c.phone_display, c.status as customer_status, p.loyalty_tier, p.points_balance,
        p.total_earned_points, p.total_redeemed_points, p.created_at,
        (select max(l.created_at) from loyalty_ledger l where l.tenant_id = p.tenant_id and l.customer_id = p.customer_id) as last_activity
      ${base} order by ${order} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => ({ customerId: String(r.customer_id), profileId: String(r.profile_id), customerName: String(r.full_name || ''), avatarUrl: r.avatar_url ?? null,
      maskedPhone: maskPhone(r.phone_display ?? null), tier: String(r.loyalty_tier || DEFAULT_TIER), pointsBalance: N(r.points_balance), totalEarned: N(r.total_earned_points),
      totalRedeemed: N(r.total_redeemed_points), enrolledAt: iso(r.created_at), lastActivityAt: iso(r.last_activity), customerStatus: String(r.customer_status) })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  private redemptionSelect() {
    return sql`select d.id, d.customer_id, c.full_name, d.reward_id, d.reward_title, d.points_spent, d.status, d.created_at, d.applied_at, d.used_at, d.voided_at,
      d.ticket_id, d.expires_at, d.value_cents, d.percent, d.reward_type
      from loyalty_redemptions d left join customers c on c.id = d.customer_id and c.tenant_id = d.tenant_id`;
  }
  private redemptionRow(r: any): RedemptionRow {
    return { id: String(r.id), customerId: String(r.customer_id), customerName: String(r.full_name || ''), rewardId: String(r.reward_id), rewardTitle: String(r.reward_title || ''),
      pointsSpent: N(r.points_spent), status: r.status, createdAt: iso(r.created_at), appliedAt: iso(r.applied_at), usedAt: iso(r.used_at), voidedAt: iso(r.voided_at),
      ticketId: r.ticket_id ? String(r.ticket_id) : null, expiresAt: iso(r.expires_at), valueCents: N(r.value_cents), percent: N(r.percent), rewardType: String(r.reward_type || 'amount_off') };
  }
  async redemptions(ctx: LoyaltyProgramContext, f: { page?: unknown; pageSize?: unknown; status?: string; rewardId?: string; customerId?: string }): Promise<Page<RedemptionRow>> {
    const T = ctx.tenantId; const { page, pageSize } = clampPaging(f.page, f.pageSize, 5);
    const conds = [sql`d.tenant_id = ${T}`];
    if (f.status === 'pending') conds.push(sql`d.status in ('issued', 'applied')`);
    else if (f.status && ['issued', 'applied', 'used', 'void'].includes(f.status)) conds.push(sql`d.status = ${f.status}`);
    if (isUuid(f.rewardId)) conds.push(sql`d.reward_id = ${f.rewardId}`);
    if (isUuid(f.customerId)) conds.push(sql`d.customer_id = ${f.customerId}`);
    const where = sql.join(conds, sql` and `);
    const total = N((await sql<any>`select count(*)::int as n from loyalty_redemptions d where d.tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
    const sp = servedPage(page, pageSize, total);
    const rows = (await sql<any>`${this.redemptionSelect()} where d.tenant_id = ${ctx.tenantId} and ${where} order by d.created_at desc, d.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => this.redemptionRow(r)), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  async redemptionDetail(ctx: LoyaltyProgramContext, id: string): Promise<{ redemption: RedemptionRow; ledger: LedgerRow[] } | null> {
    if (!isUuid(id)) return null;
    const r = (await sql<any>`${this.redemptionSelect()} where d.tenant_id = ${ctx.tenantId} and d.id = ${id}`.execute(this.db)).rows[0];
    if (!r) return null;
    const ledger = (await sql<any>`select l.id, l.customer_id, c.full_name, l.entry_type, l.delta, l.balance_after, l.reason, l.source_table, l.source_id, l.actor_user_id, l.created_at
      from loyalty_ledger l left join customers c on c.id = l.customer_id and c.tenant_id = l.tenant_id
      where l.tenant_id = ${ctx.tenantId} and l.source_id = ${id} order by l.created_at desc, l.id desc`.execute(this.db)).rows;
    return { redemption: this.redemptionRow(r), ledger: ledger.map((x: any) => this.ledgerRow(x)) };
  }

  private ledgerRow(r: any): LedgerRow {
    return { id: String(r.id), customerId: String(r.customer_id), customerName: String(r.full_name || ''), entryType: String(r.entry_type), delta: N(r.delta), balanceAfter: N(r.balance_after),
      reason: r.reason ?? null, sourceTable: r.source_table ?? null, sourceId: r.source_id ? String(r.source_id) : null, actorUserId: r.actor_user_id ? String(r.actor_user_id) : null, createdAt: iso(r.created_at) };
  }
  async ledger(ctx: LoyaltyProgramContext, f: { page?: unknown; pageSize?: unknown; entryType?: string; customerId?: string }): Promise<Page<LedgerRow>> {
    const T = ctx.tenantId; const { page, pageSize } = clampPaging(f.page, f.pageSize, 10);
    const conds = [sql`l.tenant_id = ${T}`];
    if (f.entryType && ['earn', 'redeem', 'adjust', 'reverse', 'merge'].includes(f.entryType)) conds.push(sql`l.entry_type = ${f.entryType}`);
    if (isUuid(f.customerId)) conds.push(sql`l.customer_id = ${f.customerId}`);
    const where = sql.join(conds, sql` and `);
    const total = N((await sql<any>`select count(*)::int as n from loyalty_ledger l where l.tenant_id = ${ctx.tenantId} and ${where}`.execute(this.db)).rows[0]?.n);
    const sp = servedPage(page, pageSize, total);
    const rows = (await sql<any>`select l.id, l.customer_id, c.full_name, l.entry_type, l.delta, l.balance_after, l.reason, l.source_table, l.source_id, l.actor_user_id, l.created_at
      from loyalty_ledger l left join customers c on c.id = l.customer_id and c.tenant_id = l.tenant_id
      where l.tenant_id = ${ctx.tenantId} and ${where} order by l.created_at desc, l.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { items: rows.map((x: any) => this.ledgerRow(x)), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** The customer must belong to this salon and be live (not archived). */
  private async liveCustomer(db: Kysely<any>, ctx: LoyaltyProgramContext, customerId: string): Promise<{ id: string; branch_id: string | null; full_name: string } | null> {
    if (!isUuid(customerId)) return null;
    return ((await sql<any>`select id, branch_id, full_name from customers where tenant_id = ${ctx.tenantId} and id = ${customerId} and status <> 'archived'`.execute(db)).rows[0]) ?? null;
  }
  private async branchFor(db: Kysely<any>, ctx: LoyaltyProgramContext, customerBranch: string | null): Promise<string | null> {
    if (isUuid(ctx.branchId)) return ctx.branchId;
    if (customerBranch) return customerBranch;
    return ((await sql<any>`select id from branches where tenant_id = ${ctx.tenantId} order by created_at limit 1`.execute(db)).rows[0]?.id) ?? null;
  }

  // ── Manage Tiers (Loyalty guide Nov 4 2026): the salon's own tier list; renaming relabels members and reward rules in
  //    the same transaction; a tier members still hold cannot be retired (never silently reset); every change is audited ──
  private async configuredTiers(T: string, db: any = this.db): Promise<TierRow[]> {
    const rows = (await sql<any>`select id, name, rank, min_points, benefits, active from loyalty_tiers where tenant_id = ${T} order by rank, lower(name), id`.execute(db).catch((e: unknown) => {
      logException(e, { where: 'loyalty-program.tiers', tenantId: T }); return NO_ROWS; })).rows;
    return rows.map((r: any) => ({ id: String(r.id), name: String(r.name), rank: N(r.rank), minPoints: r.min_points == null ? null : N(r.min_points), benefits: String(r.benefits || ''), active: !!r.active, members: 0 }));
  }
  /** every configured tier (retired too) with its live member count, then labels in use that were never configured */
  async tierList(ctx: LoyaltyProgramContext): Promise<{ items: TierRow[]; unconfigured: { name: string; members: number }[] }> {
    const T = ctx.tenantId;
    const conf = await this.configuredTiers(T);
    const counts = (await sql<any>`select p.loyalty_tier as tier, count(*)::int as n from customer_loyalty_profiles p join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
        where p.tenant_id = ${T} and c.status <> 'archived' group by p.loyalty_tier`.execute(this.db)).rows;
    const n = (name: string) => counts.filter((c: any) => String(c.tier || DEFAULT_TIER).toLowerCase() === name.toLowerCase()).reduce((a: number, c: any) => a + N(c.n), 0);
    return { items: conf.map((t) => ({ ...t, members: n(t.name) })),
      unconfigured: counts.map((c: any) => String(c.tier || DEFAULT_TIER)).filter((name: string, i: number, all: string[]) => all.indexOf(name) === i && !conf.some((t) => t.name.toLowerCase() === name.toLowerCase())).map((name: string) => ({ name, members: n(name) })) };
  }
  async saveTier(ctx: LoyaltyProgramContext, b: { id?: string | null; name: string; rank?: number | null; minPoints?: number | null; benefits?: string | null; active?: boolean | null }): Promise<TierRow> {
    const T = ctx.tenantId; const name = String(b.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 40) throw new LoyaltyProgramError('A tier needs a name of up to 40 characters.', 'LOYALTY_TIER_INVALID');
    const rank = b.rank == null ? 0 : Math.trunc(Number(b.rank)); const minPoints = b.minPoints == null ? null : Math.trunc(Number(b.minPoints));
    if (!Number.isFinite(rank) || rank < 0 || rank > 1000) throw new LoyaltyProgramError('The order must be a whole number from 0 to 1000.', 'LOYALTY_TIER_INVALID');
    if (minPoints != null && (!Number.isFinite(minPoints) || minPoints < 0 || minPoints > 100_000_000)) throw new LoyaltyProgramError('The points threshold must be a whole number of 0 or more.', 'LOYALTY_TIER_INVALID');
    const benefits = String(b.benefits ?? '').trim(); if (benefits.length > 500) throw new LoyaltyProgramError('Benefits can be up to 500 characters.', 'LOYALTY_TIER_INVALID');
    if (b.id != null && !isUuid(b.id)) throw new LoyaltyProgramError('Tier not found.', 'LOYALTY_TIER_NOT_FOUND', 404);
    const actor = isUuid(ctx.userId) ? ctx.userId : null;
    const audits: AuditItem[] = [];
    const id = await this.db.transaction().execute(async (trx) => {
      const clash = (await sql<any>`select id from loyalty_tiers where tenant_id = ${T} and lower(name) = lower(${name}) ${b.id ? sql`and id <> ${b.id}` : sql``}`.execute(trx)).rows[0];
      if (clash) throw new LoyaltyProgramError('A tier with that name already exists.', 'LOYALTY_TIER_EXISTS', 409);
      if (!b.id) {
        const row = (await sql<any>`insert into loyalty_tiers (tenant_id, name, rank, min_points, benefits, active, created_by, updated_by) values (${T}, ${name}, ${rank}, ${minPoints}, ${benefits}, ${b.active ?? true}, ${actor}, ${actor}) returning id`.execute(trx)).rows[0];
        audits.push({ action: 'loyalty.tier_created', resourceType: 'loyalty_tier', resourceId: String(row.id), metadata: { name, rank, minPoints, benefits } });
        return String(row.id);
      }
      const cur = (await sql<any>`select id, name, rank, min_points, benefits, active from loyalty_tiers where tenant_id = ${T} and id = ${b.id} for update`.execute(trx)).rows[0];
      if (!cur) throw new LoyaltyProgramError('Tier not found.', 'LOYALTY_TIER_NOT_FOUND', 404);
      const active = b.active ?? !!cur.active;
      const holders = N((await sql<any>`select count(*)::int as n from customer_loyalty_profiles where tenant_id = ${T} and lower(loyalty_tier) = lower(${String(cur.name)})`.execute(trx)).rows[0]?.n);
      if (!active && cur.active && holders > 0) throw new LoyaltyProgramError(`${holders} member(s) are in this tier. Move them to another tier before retiring it.`, 'LOYALTY_TIER_IN_USE', 409);
      let relabelled = 0;
      if (String(cur.name) !== name) {
        relabelled = N((await sql<any>`with u as (update customer_loyalty_profiles set loyalty_tier = ${name}, updated_at = now() where tenant_id = ${T} and lower(loyalty_tier) = lower(${String(cur.name)}) returning 1) select count(*)::int as n from u`.execute(trx)).rows[0]?.n);
        await sql`update loyalty_rewards set eligible_tiers = array_replace(eligible_tiers, ${String(cur.name)}, ${name}), updated_at = now() where tenant_id = ${T} and ${String(cur.name)} = any(eligible_tiers)`.execute(trx);
      }
      await sql`update loyalty_tiers set name = ${name}, rank = ${rank}, min_points = ${minPoints}, benefits = ${benefits}, active = ${active}, updated_by = ${actor}, updated_at = now() where tenant_id = ${T} and id = ${b.id}`.execute(trx);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const before = { name: String(cur.name), rank: N(cur.rank), minPoints: cur.min_points == null ? null : N(cur.min_points), benefits: String(cur.benefits || ''), active: !!cur.active };
      const after = { name, rank, minPoints, benefits, active };
      for (const k of Object.keys(after) as (keyof typeof after)[]) if (before[k] !== after[k]) changes[k] = { from: before[k], to: after[k] };
      if (Object.keys(changes).length) audits.push({ action: 'loyalty.tier_updated', resourceType: 'loyalty_tier', resourceId: String(b.id), metadata: { changes, membersRelabelled: relabelled } });
      return String(b.id);
    });
    await this.flush(ctx, audits);
    return (await this.tierList(ctx)).items.find((t) => t.id === id)!;
  }
  /** move one member to another tier: an active configured tier, or the default every enrolment starts in */
  async setMemberTier(ctx: LoyaltyProgramContext, b: { customerId: string; tier: string; reason: string }): Promise<MemberRow> {
    const T = ctx.tenantId; const tier = String(b.tier ?? '').trim(); const reason = String(b.reason ?? '').trim();
    if (!isUuid(b.customerId)) throw new LoyaltyProgramError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    if (reason.length < 3) throw new LoyaltyProgramError('Say why the tier is changing (at least 3 characters).', 'LOYALTY_TIER_INVALID');
    const conf = await this.configuredTiers(T);
    const target = conf.find((t) => t.active && t.name.toLowerCase() === tier.toLowerCase())?.name ?? (tier.toLowerCase() === DEFAULT_TIER.toLowerCase() ? DEFAULT_TIER : null);
    if (!target) throw new LoyaltyProgramError('Pick one of the salon\'s tiers.', 'LOYALTY_TIER_NOT_FOUND', 404);
    const audits: AuditItem[] = [];
    await this.db.transaction().execute(async (trx) => {
      const prof = (await sql<any>`select loyalty_tier from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${b.customerId} for update`.execute(trx)).rows[0];
      if (!prof) throw new LoyaltyProgramError('Enrol the customer before changing the tier.', 'LOYALTY_NOT_ENROLLED', 409);
      const from = String(prof.loyalty_tier || DEFAULT_TIER);
      if (from === target) return;
      await sql`update customer_loyalty_profiles set loyalty_tier = ${target}, updated_at = now() where tenant_id = ${T} and customer_id = ${b.customerId}`.execute(trx);
      audits.push({ action: 'loyalty.member_tier_changed', resourceType: 'customer', resourceId: b.customerId, metadata: { from, to: target, reason } });
    });
    await this.flush(ctx, audits);
    return this.memberById(ctx, b.customerId);
  }
  private async memberById(ctx: LoyaltyProgramContext, customerId: string): Promise<MemberRow> {
    const r = (await sql<any>`select p.id as profile_id, p.customer_id, c.full_name, c.avatar_url, c.phone_display, c.status as customer_status, p.loyalty_tier, p.points_balance,
        p.total_earned_points, p.total_redeemed_points, p.created_at, (select max(l.created_at) from loyalty_ledger l where l.tenant_id = p.tenant_id and l.customer_id = p.customer_id) as last_activity
      from customer_loyalty_profiles p join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id where p.tenant_id = ${ctx.tenantId} and p.customer_id = ${customerId}`.execute(this.db)).rows[0];
    if (!r) throw new LoyaltyProgramError('Customer not found.', 'CUSTOMER_NOT_FOUND', 404);
    return { customerId: String(r.customer_id), profileId: String(r.profile_id), customerName: String(r.full_name || ''), avatarUrl: r.avatar_url ?? null,
      maskedPhone: maskPhone(r.phone_display ?? null), tier: String(r.loyalty_tier || DEFAULT_TIER), pointsBalance: N(r.points_balance), totalEarned: N(r.total_earned_points),
      totalRedeemed: N(r.total_redeemed_points), enrolledAt: iso(r.created_at), lastActivityAt: iso(r.last_activity), customerStatus: String(r.customer_status) };
  }

  /** Enrol a salon customer (one profile per tenant + customer). Never creates a customer; a second enrol is a 409. */
  async enroll(ctx: LoyaltyProgramContext, customerId: string): Promise<MemberRow> {
    const audits: AuditItem[] = [];
    return this.db.transaction().execute(async (trx) => {
      const c = await this.liveCustomer(trx, ctx, customerId);
      if (!c) throw new LoyaltyProgramError('That customer is not in this salon.', 'CUSTOMER_NOT_FOUND', 404);
      await lockLoyaltyCustomer(trx, ctx.tenantId, customerId);
      const has = (await sql<any>`select 1 from customer_loyalty_profiles where tenant_id = ${ctx.tenantId} and customer_id = ${customerId}`.execute(trx)).rows.length > 0;
      if (has) throw new LoyaltyProgramError('This customer is already a loyalty member.', 'LOYALTY_ALREADY_ENROLLED', 409);
      const branch = await this.branchFor(trx, ctx, c.branch_id);
      if (!branch) throw new LoyaltyProgramError('The salon has no branch to enrol into.', 'LOYALTY_INVALID_ENTRY', 400);
      await sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, total_redeemed_points, updated_by)
        values (${ctx.tenantId}, ${branch}, ${customerId}, ${DEFAULT_TIER}, 0, 0, 0, ${isUuid(ctx.userId) ? ctx.userId : null})`.execute(trx);
      audits.push({ action: 'loyalty.member_enrolled', resourceType: 'customer', resourceId: customerId, metadata: {} });
      return customerId;
    }).then(async (id) => { await this.flush(ctx, audits); return id; }).then(async (id) => (await this.members(ctx, { page: 1, pageSize: MAX_PAGE_SIZE })).items.find((m) => m.customerId === id) ?? (() => { throw new LoyaltyProgramError('Enrolment not found after commit.', 'LOYALTY_INVALID_ENTRY'); })());
  }

  /** Retired Nov 5 2026 — see below. */
  async adjust(_ctx: LoyaltyProgramContext, _b: { customerId: string; delta: number; reason: string; idempotencyKey: string }): Promise<{ balanceAfter: number; duplicate: boolean; ledgerId: string | null }> {
    // Customer Profile & Global Loyalty Protection (Nov 4 2026): salon staff never set, add to or lower points directly — a
    // bonus is asked for (POST /pos/loyalty/bonus-requests) and the owner approves it; a redemption goes through /redeem.
    // The route stays (old POS builds get this answer instead of a 404) and refuses every change.
    throw new LoyaltyProgramError("A customer's points can't be changed by hand. Ask for bonus points instead — the owner approves them.", 'LOYALTY_DIRECT_EDIT_REFUSED');
  }

  /** Redeem a reward at the front desk: the same rules as the customer app (active, worth something, enough points),
   *  under the per-customer lock, exactly once — the client's idempotency key IS the redemption id, so a double tap or a
   *  retry returns the code already issued and never takes points twice. */
  async redeem(ctx: LoyaltyProgramContext, b: { customerId: string; rewardId: string; idempotencyKey: string }): Promise<{ redemption: RedemptionRow; code: string; balanceAfter: number; duplicate: boolean }> {
    if (!isUuid(b.idempotencyKey)) throw new LoyaltyProgramError('A request id is required.', 'IDEMPOTENCY_KEY_REQUIRED');
    if (!isUuid(b.rewardId)) throw new LoyaltyProgramError('That reward is not available.', 'REWARD_NOT_FOUND', 404);
    const audits: AuditItem[] = [];
    const out = await this.db.transaction().execute(async (trx) => {
      const c = await this.liveCustomer(trx, ctx, b.customerId);
      if (!c) throw new LoyaltyProgramError('That customer is not in this salon.', 'CUSTOMER_NOT_FOUND', 404);
      await lockLoyaltyCustomer(trx, ctx.tenantId, b.customerId);
      const prior = (await sql<any>`select id, tenant_id, customer_id, reward_id, code from loyalty_redemptions where id = ${b.idempotencyKey}`.execute(trx)).rows[0];
      if (prior) {
        if (String(prior.tenant_id) !== ctx.tenantId || String(prior.customer_id) !== b.customerId || String(prior.reward_id) !== b.rewardId) throw new LoyaltyProgramError('That request id was already used for a different redemption.', 'LOYALTY_INVALID_ENTRY', 409);
        const bal = N((await sql<any>`select points_balance from customer_loyalty_profiles where tenant_id = ${ctx.tenantId} and customer_id = ${b.customerId}`.execute(trx)).rows[0]?.points_balance);
        return { id: String(prior.id), code: String(prior.code), balanceAfter: bal, duplicate: true };
      }
      // the reward row is locked: two redemptions of the last unit in stock cannot both pass the stock check
      const reward = (await sql<any>`select id, title, points_cost, active, reward_type, value_cents, percent, valid_days, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on,
          stock_total, per_member_limit, eligible_tiers from loyalty_rewards where tenant_id = ${ctx.tenantId} and id = ${b.rewardId} for update`.execute(trx)).rows[0];
      if (!reward) throw new LoyaltyProgramError('That reward is not available.', 'REWARD_NOT_FOUND', 404);
      // Loyalty guide (Nov 4 2026): dates, stock, the per-member limit and the eligible tiers are checked here, atomically
      const tz = await tenantTimeZone(trx as unknown as Kysely<any>, ctx.tenantId).catch(() => 'America/New_York');
      const today = (await sql<{ d: string }>`select to_char((now() at time zone ${tz})::date, 'YYYY-MM-DD') as d`.execute(trx)).rows[0]!.d;
      const stockUsed = reward.stock_total != null ? N((await sql<any>`select count(*)::int as n from loyalty_redemptions where tenant_id = ${ctx.tenantId} and reward_id = ${b.rewardId} and status <> 'void'`.execute(trx)).rows[0]?.n) : 0;
      const memberUsed = reward.per_member_limit != null ? N((await sql<any>`select count(*)::int as n from loyalty_redemptions where tenant_id = ${ctx.tenantId} and reward_id = ${b.rewardId} and customer_id = ${b.customerId} and status <> 'void'`.execute(trx)).rows[0]?.n) : 0;
      const prof = (await sql<any>`select points_balance, loyalty_tier from customer_loyalty_profiles where tenant_id = ${ctx.tenantId} and customer_id = ${b.customerId}`.execute(trx)).rows[0];
      const block = redeemBlock(reward, prof ? { pointsBalance: N(prof.points_balance), tier: prof.loyalty_tier ?? null } : null, { stockUsed, memberUsed }, today);
      if (block) throw new LoyaltyProgramError(block.message, block.code, 409);
      const cost = N(reward.points_cost);
      const code = 'RDM' + secureString(8);
      const pct = reward.reward_type === 'percent_off';
      await sql`insert into loyalty_redemptions (id, tenant_id, customer_id, reward_id, reward_title, points_spent, code, status, reward_type, value_cents, percent, expires_at)
        values (${b.idempotencyKey}, ${ctx.tenantId}, ${b.customerId}, ${b.rewardId}, ${reward.title}, ${cost}, ${code}, 'issued', ${pct ? 'percent_off' : 'amount_off'},
                ${pct ? 0 : N(reward.value_cents)}, ${pct ? N(reward.percent) : 0}, ${reward.valid_days ? sql`now() + make_interval(days => ${N(reward.valid_days)})` : null})`.execute(trx);
      const r = await applyLoyaltyEntry(trx, { tenantId: ctx.tenantId, branchId: isUuid(ctx.branchId) ? ctx.branchId : c.branch_id, customerId: b.customerId, entryType: 'redeem', delta: -cost,
        reason: `Redeemed reward: ${reward.title}`, sourceTable: 'loyalty_redemptions', sourceId: b.idempotencyKey, actorUserId: isUuid(ctx.userId) ? ctx.userId : null, legacyType: 'redeem_reward', legacySource: 'pos' });
      audits.push({ action: 'loyalty.reward_redeemed', resourceType: 'loyalty_redemption', resourceId: b.idempotencyKey, metadata: { customerId: b.customerId, rewardId: b.rewardId, pointsSpent: cost } });
      return { id: b.idempotencyKey, code, balanceAfter: r.balanceAfter, duplicate: false };
    });
    await this.flush(ctx, audits);
    const d = await this.redemptionDetail(ctx, out.id);
    return { redemption: d!.redemption, code: out.code, balanceAfter: out.balanceAfter, duplicate: out.duplicate };
  }

  /** Read-only: what this customer could redeem right now and, for each reward, which redeem rule would refuse it. Uses
   *  the SAME redeemBlock() the redemption transaction enforces, so a suggestion never promises what redeem() refuses. */
  async redeemOptions(ctx: LoyaltyProgramContext, customerId: string): Promise<RedeemOptions> {
    const T = ctx.tenantId;
    if (!isUuid(customerId)) return { enrolled: false, balancePoints: 0, tier: null, rewards: [] };
    const prof = (await sql<{ points_balance: number; loyalty_tier: string | null }>`select points_balance, loyalty_tier from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${customerId}`.execute(this.db)).rows[0];
    const member = prof ? { pointsBalance: N(prof.points_balance), tier: prof.loyalty_tier ?? null } : null;
    const tz = await tenantTimeZone(this.db, T).catch(() => 'America/New_York');
    const today = (await sql<{ d: string }>`select to_char((now() at time zone ${tz})::date, 'YYYY-MM-DD') as d`.execute(this.db)).rows[0]!.d;
    const rows = (await sql<{ id: string; title: string; points_cost: number; active: boolean; reward_type: string; value_cents: number; percent: number; starts_on: string | null; ends_on: string | null;
        stock_total: number | null; per_member_limit: number | null; eligible_tiers: string[] | null; stock_used: number; member_used: number }>`select r.id, r.title, r.points_cost, r.active, r.reward_type, r.value_cents, r.percent,
        to_char(r.starts_on, 'YYYY-MM-DD') as starts_on, to_char(r.ends_on, 'YYYY-MM-DD') as ends_on, r.stock_total, r.per_member_limit, r.eligible_tiers,
        (select count(*) from loyalty_redemptions d where d.tenant_id = r.tenant_id and d.reward_id = r.id and d.status <> 'void')::int as stock_used,
        (select count(*) from loyalty_redemptions d where d.tenant_id = r.tenant_id and d.reward_id = r.id and d.customer_id = ${customerId} and d.status <> 'void')::int as member_used
      from loyalty_rewards r where r.tenant_id = ${T} and r.active order by r.points_cost asc, r.id asc limit 100`.execute(this.db)).rows;
    return {
      enrolled: !!member, balancePoints: member?.pointsBalance ?? 0, tier: member ? String(member.tier || DEFAULT_TIER) : null,
      rewards: rows.map((r) => ({ rewardId: String(r.id), title: String(r.title), pointsCost: N(r.points_cost), rewardType: r.reward_type === 'percent_off' ? 'percent_off' as const : 'amount_off' as const,
        valueCents: N(r.value_cents), percent: N(r.percent), blockedBy: redeemBlock(r, member, { stockUsed: N(r.stock_used), memberUsed: N(r.member_used) }, today)?.code ?? null })),
    };
  }

  /** Void an ISSUED code (not yet on a ticket): the status moves to void and the points come back through ONE ledger
   *  entry sourced to the void (applied once). History is never deleted. An applied / used code cannot be voided here —
   *  it belongs to a ticket (refund that ticket instead). */
  async voidRedemption(ctx: LoyaltyProgramContext, id: string, reason: string): Promise<{ redemption: RedemptionRow; balanceAfter: number }> {
    const why = String(reason ?? '').trim();
    if (why.length < 3) throw new LoyaltyProgramError('Give a reason for voiding the redemption.', 'LOYALTY_INVALID_ENTRY');
    if (!isUuid(id)) throw new LoyaltyProgramError('Redemption not found.', 'REDEMPTION_NOT_FOUND', 404);
    const audits: AuditItem[] = [];
    const bal = await this.db.transaction().execute(async (trx) => {
      const d = (await sql<any>`select id, customer_id, points_spent, status from loyalty_redemptions where tenant_id = ${ctx.tenantId} and id = ${id} for update`.execute(trx)).rows[0];
      if (!d) throw new LoyaltyProgramError('Redemption not found.', 'REDEMPTION_NOT_FOUND', 404);
      await lockLoyaltyCustomer(trx, ctx.tenantId, String(d.customer_id));
      if (d.status !== 'issued') throw new LoyaltyProgramError(d.status === 'void' ? 'This redemption is already void.' : 'This code is on a ticket; refund the ticket instead.', 'REDEMPTION_NOT_VOIDABLE', 409);
      const upd = await sql`update loyalty_redemptions set status = 'void', voided_at = now() where tenant_id = ${ctx.tenantId} and id = ${id} and ${canMoveToSql(LOYALTY_REDEMPTION, 'void')}`.execute(trx);
      if (!N(upd.numAffectedRows)) throw new LoyaltyProgramError('This redemption changed; reload it.', 'REDEMPTION_NOT_VOIDABLE', 409);
      const r = await applyLoyaltyEntry(trx, { tenantId: ctx.tenantId, branchId: isUuid(ctx.branchId) ? ctx.branchId : null, customerId: String(d.customer_id), entryType: 'adjust', delta: N(d.points_spent),
        reason: `Redemption voided: ${why}`, sourceTable: 'loyalty_redemption_voids', sourceId: id, actorUserId: isUuid(ctx.userId) ? ctx.userId : null, legacyType: 'redeem_reversal', legacySource: 'pos' });
      // a positive `adjust` counts as earned; a void is the redemption UNDONE, so the lifetime totals say so
      if (r.applied) await sql`update customer_loyalty_profiles set total_earned_points = greatest(0, total_earned_points - ${N(d.points_spent)}),
          total_redeemed_points = greatest(0, total_redeemed_points - ${N(d.points_spent)}) where tenant_id = ${ctx.tenantId} and customer_id = ${String(d.customer_id)}`.execute(trx);
      audits.push({ action: 'loyalty.redemption_voided', resourceType: 'loyalty_redemption', resourceId: id, metadata: { reason: why, pointsRestored: N(d.points_spent) } });
      return r.balanceAfter;
    });
    await this.flush(ctx, audits);
    return { redemption: (await this.redemptionDetail(ctx, id))!.redemption, balanceAfter: bal };
  }

  /** The audit trail (spec: every mutation auditable) through the ONE audit writer, after the change committed — an audit
   *  failure is logged, never turned into a failed (and then retried) points change. */
  private async flush(ctx: LoyaltyProgramContext, items: AuditItem[]) {
    if (!this.auditor) return;
    for (const it of items) {
      try {
        await this.auditor.record({ tenantId: ctx.tenantId, branchId: isUuid(ctx.branchId) ? ctx.branchId : null, userId: isUuid(ctx.userId) ? ctx.userId : null, role: ctx.role ?? null },
          { module: 'loyalty', action: it.action.replace(/^loyalty\./, ''), resourceType: it.resourceType, resourceId: it.resourceId, metadata: it.metadata });
      } catch (e) { logException(e, { where: 'loyalty-program.audit', action: it.action, tenantId: ctx.tenantId }); }
    }
  }

}
export { NO_ROWS };
