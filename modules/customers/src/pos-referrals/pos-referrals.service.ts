// pos-referrals.service.ts — salon referral program: view the program state, record a referral (a code
// bringing in a new customer), and mark a referral rewarded. Guards against self-referral and referring the
// same customer twice.
import {
  buildReferralKpis, validateRecordReferral,
  type ReferralsContext, type ReferralsState, type ReferralRedemption, type RecordReferralInput,
} from './pos-referrals.dto';
import type { ReferralsRepositoryPort } from './pos-referrals.repository';

export class ReferralForbiddenError extends Error {}
export class ReferralValidationError extends Error {}

export class ReferralsService {
  constructor(private readonly repo: ReferralsRepositoryPort) {}

  private auth(ctx: ReferralsContext) { if (!ctx?.userId || !ctx?.tenantId) throw new ReferralForbiddenError('Not authenticated'); }

  async getState(ctx: ReferralsContext): Promise<ReferralsState> {
    this.auth(ctx);
    const [redemptions, codesIssued] = await Promise.all([this.repo.listRedemptions(ctx), this.repo.countCodes(ctx)]);
    return { kpis: buildReferralKpis(redemptions, codesIssued), redemptions };
  }

  async record(ctx: ReferralsContext, input: RecordReferralInput): Promise<ReferralRedemption> {
    this.auth(ctx);
    const v = validateRecordReferral(input);
    if (!v.ok) throw new ReferralValidationError(v.error || 'Invalid referral');
    const owner = await this.repo.findCodeOwner(ctx, input.code);
    if (!owner) throw new ReferralValidationError('No referral code matches that code');
    if (owner.customerId === input.referredCustomerId) throw new ReferralValidationError('A customer cannot refer themselves');
    if (await this.repo.hasReferred(ctx, input.referredCustomerId)) throw new ReferralValidationError('That customer has already been referred');
    const referredName = await this.repo.customerName(ctx, input.referredCustomerId);
    return this.repo.record(ctx, {
      referrerCustomerId: owner.customerId, referrerName: owner.customerName,
      referredCustomerId: input.referredCustomerId, referredName, code: input.code,
    });
  }

  async reward(ctx: ReferralsContext, id: string, rewardCents: number): Promise<ReferralRedemption> {
    this.auth(ctx);
    if (!id) throw new ReferralValidationError('Referral id is required');
    const cents = Math.round(Number(rewardCents));
    if (!Number.isFinite(cents) || cents < 0) throw new ReferralValidationError('Reward must be zero or more cents');
    const row = await this.repo.markRewarded(ctx, id, cents);
    if (!row) throw new ReferralValidationError('Referral not found');
    return row;
  }
}
