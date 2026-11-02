// pos-referrals.service.ts — salon referral program: view the program state, record a referral (a code
// bringing in a new customer), and mark a referral rewarded. Guards against self-referral and referring the
// same customer twice.
import {
  buildReferralKpis, validateRecordReferral,
  type ReferralsContext, type ReferralsState, type ReferralRedemption, type RecordReferralInput,
} from './pos-referrals.dto';
import type { ReferralsRepositoryPort } from './pos-referrals.repository';
import type { ReferralProgram } from './referral-program';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ReferralForbiddenError extends Error {}
export class ReferralValidationError extends Error {}

export class ReferralsService {
  /** `rp` (the Referral Program, migration 751) is present with Postgres: the legacy record route then goes through the ONE canonical
   *  record path (eligibility, idempotent duplicate, history), and the legacy hand-typed "reward" toggle is retired. */
  constructor(private readonly repo: ReferralsRepositoryPort, private readonly rp: ReferralProgram | null = null) {}

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
    if (this.rp) {
      try {
        const d = await this.rp.record({ ...ctx, branchId: ctx.branchId ?? '' }, { code: input.code, referredCustomerId: input.referredCustomerId, idempotencyKey: `legacy:${input.referredCustomerId}:${String(input.code).toLowerCase()}` });
        return { id: d.id, referrerCustomerId: d.referrer.customerId, referrerName: d.referrer.name, referredCustomerId: d.referred?.customerId ?? null, referredName: d.referred?.name ?? null,
          code: d.code, status: 'pending', rewardCents: 0, redeemedAt: d.recordedAt ?? '', rewardedAt: null };
      } catch (e: any) { if (e?.code && e?.message) throw withCode(new ReferralValidationError(e.message), e.code); throw e; }
    }
    const owner = await this.repo.findCodeOwner(ctx, input.code);
    if (!owner) throw withCode(new ReferralValidationError('No referral code matches that code'), 'REFERRAL_CODE_UNKNOWN');
    if (owner.customerId === input.referredCustomerId) throw withCode(new ReferralValidationError('A customer cannot refer themselves'), 'SELF_REFERRAL');
    if (await this.repo.hasReferred(ctx, input.referredCustomerId)) throw withCode(new ReferralValidationError('That customer has already been referred'), 'REFERRAL_EXISTS');
    const referredName = await this.repo.customerName(ctx, input.referredCustomerId);
    return this.repo.record(ctx, {
      referrerCustomerId: owner.customerId, referrerName: owner.customerName,
      referredCustomerId: input.referredCustomerId, referredName, code: input.code,
    });
  }

  async reward(ctx: ReferralsContext, id: string, rewardCents: number): Promise<ReferralRedemption> {
    this.auth(ctx);
    // Referral Program guide §10: "Do not claim paid based on a manager status toggle". With the program center present the
    // hand-typed reward is refused; rewards are approved and issued (once, through a ledger) in /pos/referral-program.
    if (this.rp) throw withCode(new ReferralValidationError('Rewards are now approved and issued in Referral Program → Pending Reward Reviews.'), 'REFERRAL_REWARD_TOGGLE_RETIRED');
    if (!id) throw new ReferralValidationError('Referral id is required');
    const cents = Math.round(Number(rewardCents));
    if (!Number.isFinite(cents) || cents < 0) throw withCode(new ReferralValidationError('Reward must be zero or more cents'), 'AMOUNT_INVALID');
    const row = await this.repo.markRewarded(ctx, id, cents);
    if (!row) throw withCode(new ReferralValidationError('Referral not found'), 'REFERRAL_NOT_FOUND');
    return row;
  }
}
