// loyalty.service.ts — read-only loyalty program overview for the tenant.
import { buildLoyaltyOverview, normalizeRewardInput, RewardValidationError, type LoyaltyContext, type LoyaltyState, type LoyaltyReward, type RewardInput } from './loyalty.dto';
import { hasPermission } from '@aipowersalon/permissions';
import type { LoyaltyRepositoryPort } from './loyalty.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}
export { RewardValidationError };

export class LoyaltyService {
  constructor(private readonly repo: LoyaltyRepositoryPort) {}

  /** Per-customer loyalty snapshot (enrollment + balance). Read-only; used by checkout/upsell surfaces. */
  async getCustomerLoyalty(ctx: LoyaltyContext, customerId: string): Promise<{ enrolled: boolean; pointsBalance: number; tier: string | null }> {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    const p = await this.repo.getProfile(ctx, customerId);
    return p ? { enrolled: true, pointsBalance: p.pointsBalance, tier: p.tier } : { enrolled: false, pointsBalance: 0, tier: null };
  }

  // Decision 15: owners and managers (settings.edit) create, edit and archive rewards. Archiving (active: false) stops new
  // redemptions; codes already issued keep their value and can still be used.
  private needManage(ctx: LoyaltyContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!hasPermission(ctx as any, 'pos.settings.edit')) throw new ForbiddenError('Only an owner or manager can change rewards.');
  }
  async createReward(ctx: LoyaltyContext, input: RewardInput): Promise<LoyaltyReward> {
    this.needManage(ctx);
    return this.repo.createReward(ctx, normalizeRewardInput(input ?? {}));
  }
  async updateReward(ctx: LoyaltyContext, id: string, input: RewardInput): Promise<LoyaltyReward> {
    this.needManage(ctx);
    const cur = await this.repo.getReward(ctx, id); if (!cur) throw withCode(new NotFoundError('Reward not found.'), 'REWARD_NOT_FOUND');
    const next = await this.repo.updateReward(ctx, id, normalizeRewardInput(input ?? {}, cur));
    if (!next) throw withCode(new NotFoundError('Reward not found.'), 'REWARD_NOT_FOUND');
    return next;
  }

  async getState(ctx: LoyaltyContext): Promise<LoyaltyState> {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    const [profiles, rewards, redemptions] = await Promise.all([
      this.repo.listProfiles(ctx), this.repo.listRewards(ctx), this.repo.listRedemptions(ctx),
    ]);
    const { kpis, tiers } = buildLoyaltyOverview(profiles, rewards, redemptions);
    return { kpis, tiers, rewards, recentRedemptions: redemptions.slice(0, 10) };
  }
}
