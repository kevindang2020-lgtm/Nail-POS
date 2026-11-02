// pos-referrals.repository.ts — repository port + in-memory adapter (dev/offline/tests default).
import type { ReferralsContext, ReferralRedemption } from './pos-referrals.dto';

export interface CodeOwner { customerId: string; customerName: string | null }

export interface ReferralsRepositoryPort {
  countCodes(ctx: ReferralsContext): Promise<number>;
  listRedemptions(ctx: ReferralsContext): Promise<ReferralRedemption[]>;
  findCodeOwner(ctx: ReferralsContext, code: string): Promise<CodeOwner | null>;
  customerName(ctx: ReferralsContext, customerId: string): Promise<string | null>;
  hasReferred(ctx: ReferralsContext, referredCustomerId: string): Promise<boolean>;
  record(ctx: ReferralsContext, input: { referrerCustomerId: string; referrerName: string | null; referredCustomerId: string; referredName: string | null; code: string }): Promise<ReferralRedemption>;
  markRewarded(ctx: ReferralsContext, id: string, rewardCents: number): Promise<ReferralRedemption | null>;
}

// In-memory adapter. `codes` seeds the referral-code registry (customerId -> {code, name}); `rows` seeds
// existing redemptions. Used for offline/dev and unit tests.
export class InMemoryReferralsRepository implements ReferralsRepositoryPort {
  private rows: ReferralRedemption[];
  private codes: { customerId: string; customerName: string | null; code: string }[];
  constructor(seedRedemptions: ReferralRedemption[] = [], seedCodes: { customerId: string; customerName: string | null; code: string }[] = []) {
    this.rows = seedRedemptions.slice();
    this.codes = seedCodes.slice();
  }
  async countCodes(_ctx: ReferralsContext): Promise<number> { return this.codes.length; }
  async listRedemptions(_ctx: ReferralsContext): Promise<ReferralRedemption[]> {
    return this.rows.slice().sort((a, b) => (a.redeemedAt < b.redeemedAt ? 1 : -1));
  }
  async findCodeOwner(_ctx: ReferralsContext, code: string): Promise<CodeOwner | null> {
    const c = this.codes.find((x) => x.code.toLowerCase() === (code || '').toLowerCase());
    return c ? { customerId: c.customerId, customerName: c.customerName } : null;
  }
  async customerName(_ctx: ReferralsContext, customerId: string): Promise<string | null> {
    return this.codes.find((x) => x.customerId === customerId)?.customerName ?? null;
  }
  async hasReferred(_ctx: ReferralsContext, referredCustomerId: string): Promise<boolean> {
    return this.rows.some((r) => r.referredCustomerId === referredCustomerId);
  }
  async record(_ctx: ReferralsContext, input: { referrerCustomerId: string; referrerName: string | null; referredCustomerId: string; referredName: string | null; code: string }): Promise<ReferralRedemption> {
    const row: ReferralRedemption = {
      id: 'ref_' + (this.rows.length + 1), referrerCustomerId: input.referrerCustomerId, referrerName: input.referrerName,
      referredCustomerId: input.referredCustomerId, referredName: input.referredName, code: input.code,
      status: 'pending', rewardCents: 0, redeemedAt: new Date().toISOString(), rewardedAt: null,
    };
    this.rows.push(row); return row;
  }
  async markRewarded(_ctx: ReferralsContext, id: string, rewardCents: number): Promise<ReferralRedemption | null> {
    const r = this.rows.find((x) => x.id === id); if (!r) return null;
    r.status = 'rewarded'; r.rewardCents = rewardCents; r.rewardedAt = new Date().toISOString(); return r;
  }
}
