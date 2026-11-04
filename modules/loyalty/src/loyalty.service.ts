// loyalty.service.ts — read-only loyalty program overview for the tenant.
import { buildLoyaltyOverview, normalizeRewardInput, RewardValidationError, type LoyaltyContext, type LoyaltyState, type LoyaltyReward, type RewardInput } from './loyalty.dto';
import { hasPermission } from '@aipowersalon/permissions';
import type { LoyaltyRepositoryPort } from './loyalty.repository';
import { withCode } from '@aipowersalon/api-contracts';
import { logException } from '@aipowersalon/observability';   // V-5: a refusal's registry code beside its English

export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}
export { RewardValidationError };

/** the audit module's recorder (AuditService) — optional so the in-memory dev build runs without it */
export interface RewardAuditRecorder { record(ctx: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null }, input: { module: string; action: string; resourceType?: string | null; resourceId?: string | null; metadata?: Record<string, unknown> }): Promise<unknown> }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Loyalty guide (Nov 4 2026): a reward change is audited with the fields that changed, before → after
const REWARD_AUDIT_FIELDS = ['title', 'pointsCost', 'active', 'rewardType', 'valueCents', 'percent', 'validDays', 'startsOn', 'endsOn', 'stockTotal', 'perMemberLimit', 'eligibleTiers'] as const;
export function rewardChanges(before: Partial<LoyaltyReward> | null, after: Partial<LoyaltyReward>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of REWARD_AUDIT_FIELDS) { const a = before?.[k] ?? null, b = after[k] ?? null; if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a, to: b }; }
  return out;
}

export class LoyaltyService {
  constructor(private readonly repo: LoyaltyRepositoryPort, private readonly audit: RewardAuditRecorder | null = null) {}
  private async auditReward(ctx: LoyaltyContext, action: string, reward: LoyaltyReward, changes: Record<string, unknown>) {
    if (!this.audit) return;
    const c = ctx as LoyaltyContext & { branchId?: string | null; role?: string | null };
    try {
      await this.audit.record({ tenantId: c.tenantId, branchId: UUID_RE.test(String(c.branchId)) ? c.branchId : null, userId: UUID_RE.test(String(c.userId)) ? c.userId : null, role: c.role ?? null },
        { module: 'loyalty', action, resourceType: 'loyalty_reward', resourceId: reward.id, metadata: { title: reward.title, changes } });
    } catch (e) { logException(e, { where: 'loyalty.reward-audit', action, tenantId: c.tenantId }); }
  }

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
    const made = await this.repo.createReward(ctx, normalizeRewardInput(input ?? {}));
    await this.auditReward(ctx, 'reward_created', made, rewardChanges(null, made));
    return made;
  }
  async updateReward(ctx: LoyaltyContext, id: string, input: RewardInput): Promise<LoyaltyReward> {
    this.needManage(ctx);
    const cur = await this.repo.getReward(ctx, id); if (!cur) throw withCode(new NotFoundError('Reward not found.'), 'REWARD_NOT_FOUND');
    const next = await this.repo.updateReward(ctx, id, normalizeRewardInput(input ?? {}, cur));
    if (!next) throw withCode(new NotFoundError('Reward not found.'), 'REWARD_NOT_FOUND');
    const changes = rewardChanges(cur, next);
    if (Object.keys(changes).length) await this.auditReward(ctx, 'reward_updated', next, changes);
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
