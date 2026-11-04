// loyalty.kysely.repository.ts — Kysely adapter. customer_loyalty_profiles is tenant+branch scoped;
// loyalty_rewards and loyalty_redemptions are tenant-only (no branch_id column). Scoping is always
// server-derived from ctx, never client-supplied.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { LoyaltyContext, LoyaltyProfile, LoyaltyReward, LoyaltyRedemption } from './loyalty.dto';
import type { LoyaltyRepositoryPort } from './loyalty.repository';

/** a date column (Date or text) as YYYY-MM-DD, or null */
const ymdOf = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

export class KyselyLoyaltyRepository implements LoyaltyRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  private byTenant(qb: any, ctx: LoyaltyContext): any { return qb.where('tenant_id', '=', ctx.tenantId); }
  private byTenantBranch(qb: any, ctx: LoyaltyContext): any {
    let q = qb.where('tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]));
    return q;
  }

  async listProfiles(ctx: LoyaltyContext): Promise<LoyaltyProfile[]> {
    const rows = await this.byTenantBranch(this.db.selectFrom('customer_loyalty_profiles'), ctx)
      .select(['customer_id', 'loyalty_tier', 'points_balance', 'total_earned_points', 'total_redeemed_points'])
      .limit(5000).execute().catch(() => [] as any[]);
    return (rows as any[]).map((r) => ({
      customerId: String(r.customer_id), tier: String(r.loyalty_tier || 'Regular'),
      pointsBalance: Number(r.points_balance || 0), totalEarned: Number(r.total_earned_points || 0), totalRedeemed: Number(r.total_redeemed_points || 0),
    }));
  }

  async getProfile(ctx: LoyaltyContext, customerId: string): Promise<LoyaltyProfile | null> {
    const r: any = await this.byTenantBranch(this.db.selectFrom('customer_loyalty_profiles'), ctx)
      .select(['customer_id', 'loyalty_tier', 'points_balance', 'total_earned_points', 'total_redeemed_points'])
      .where('customer_id', '=', customerId).executeTakeFirst().catch(() => null);
    if (!r) return null;
    return { customerId: String(r.customer_id), tier: String(r.loyalty_tier || 'Regular'), pointsBalance: Number(r.points_balance || 0), totalEarned: Number(r.total_earned_points || 0), totalRedeemed: Number(r.total_redeemed_points || 0) };
  }
  private static readonly REWARD_COLS = ['id', 'title', 'description', 'points_cost', 'active', 'reward_type', 'value_cents', 'percent', 'valid_days', 'starts_on', 'ends_on', 'stock_total', 'per_member_limit', 'eligible_tiers'] as const;
  private static rewardRow(r: any): LoyaltyReward {
    return { id: String(r.id), title: String(r.title), description: String(r.description ?? ''), pointsCost: Number(r.points_cost || 0), active: !!r.active,
      rewardType: (r.reward_type === 'percent_off' ? 'percent_off' : 'amount_off'), valueCents: Number(r.value_cents || 0), percent: Number(r.percent || 0), validDays: r.valid_days == null ? null : Number(r.valid_days),
      startsOn: ymdOf(r.starts_on), endsOn: ymdOf(r.ends_on), stockTotal: r.stock_total == null ? null : Number(r.stock_total), perMemberLimit: r.per_member_limit == null ? null : Number(r.per_member_limit),
      eligibleTiers: Array.isArray(r.eligible_tiers) && r.eligible_tiers.length ? r.eligible_tiers.map(String) : null };
  }
  async listRewards(ctx: LoyaltyContext): Promise<LoyaltyReward[]> {
    const rows = await this.byTenant(this.db.selectFrom('loyalty_rewards'), ctx)
      .select(KyselyLoyaltyRepository.REWARD_COLS as any).orderBy('sort_order', 'asc').orderBy('created_at', 'asc').limit(500).execute().catch(() => [] as any[]);
    return rows.map(KyselyLoyaltyRepository.rewardRow);
  }
  async getReward(ctx: LoyaltyContext, id: string): Promise<LoyaltyReward | null> {
    const r = await this.byTenant(this.db.selectFrom('loyalty_rewards'), ctx).select(KyselyLoyaltyRepository.REWARD_COLS).where('id', '=', id).executeTakeFirst().catch(() => null);
    return r ? KyselyLoyaltyRepository.rewardRow(r) : null;
  }
  private static values(r: Omit<LoyaltyReward, 'id'>) {
    return { title: r.title, description: r.description ?? '', points_cost: r.pointsCost, active: r.active, reward_type: r.rewardType ?? 'amount_off', value_cents: r.valueCents ?? 0, percent: r.percent ?? 0, valid_days: r.validDays ?? null,
      starts_on: r.startsOn ?? null, ends_on: r.endsOn ?? null, stock_total: r.stockTotal ?? null, per_member_limit: r.perMemberLimit ?? null, eligible_tiers: r.eligibleTiers ?? null };
  }
  async createReward(ctx: LoyaltyContext, r: Omit<LoyaltyReward, 'id'>): Promise<LoyaltyReward> {
    const row = await (this.db as any).insertInto('loyalty_rewards').values({ tenant_id: ctx.tenantId, ...KyselyLoyaltyRepository.values(r) }).returning(KyselyLoyaltyRepository.REWARD_COLS as any).executeTakeFirstOrThrow();
    return KyselyLoyaltyRepository.rewardRow(row);
  }
  async updateReward(ctx: LoyaltyContext, id: string, r: Omit<LoyaltyReward, 'id'>): Promise<LoyaltyReward | null> {
    const row = await this.db.updateTable('loyalty_rewards').set({ ...KyselyLoyaltyRepository.values(r), updated_at: new Date() })
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).returning(KyselyLoyaltyRepository.REWARD_COLS).executeTakeFirst();
    return row ? KyselyLoyaltyRepository.rewardRow(row) : null;
  }

  async listRedemptions(ctx: LoyaltyContext): Promise<LoyaltyRedemption[]> {
    const rows = await this.byTenant(this.db.selectFrom('loyalty_redemptions'), ctx)
      .select(['id', 'customer_id', 'reward_title', 'points_spent', 'created_at']).orderBy('created_at', 'desc').limit(500).execute().catch(() => [] as any[]);
    return (rows as any[]).map((r) => ({
      id: String(r.id), customerId: String(r.customer_id), rewardTitle: String(r.reward_title || ''),
      pointsSpent: Number(r.points_spent || 0), createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    }));
  }
}
