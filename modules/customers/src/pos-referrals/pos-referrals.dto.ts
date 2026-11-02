// pos-referrals.dto.ts — salon referral program. The referral CODES live in customer_referrals (each customer
// can have one); this slice tracks REDEMPTIONS (a code bringing in a new customer) and the referrer's reward.
// Money is integer cents. KPI + validation logic is pure so it is unit-testable and reusable.

export interface ReferralsContext {
  tenantId: string;
  branchId?: string;
  userId: string;
  role: string;
  permissions: string[];
}

export type ReferralStatus = 'pending' | 'rewarded' | 'void';
export const REFERRAL_STATUSES: ReferralStatus[] = ['pending', 'rewarded', 'void'];

export interface ReferralRedemption {
  id: string;
  referrerCustomerId: string;
  referrerName: string | null;
  referredCustomerId: string | null;
  referredName: string | null;
  code: string;
  status: ReferralStatus;
  rewardCents: number;
  redeemedAt: string;
  rewardedAt: string | null;
}

export interface ReferralKpis {
  codesIssued: number;
  totalReferrals: number;
  pendingReferrals: number;
  rewardedReferrals: number;
  rewardValueCents: number;
}

export interface ReferralsState {
  kpis: ReferralKpis;
  redemptions: ReferralRedemption[];
}

export interface RecordReferralInput {
  code: string;
  referredCustomerId: string;
}

// Pure: build the header KPIs from the redemptions list + a codes-issued count.
export function buildReferralKpis(redemptions: ReferralRedemption[], codesIssued: number): ReferralKpis {
  const rewarded = redemptions.filter((r) => r.status === 'rewarded');
  return {
    codesIssued,
    totalReferrals: redemptions.length,
    pendingReferrals: redemptions.filter((r) => r.status === 'pending').length,
    rewardedReferrals: rewarded.length,
    rewardValueCents: rewarded.reduce((a, r) => a + (r.rewardCents || 0), 0),
  };
}

// Pure: validate a record-referral request (excluding existence checks, which need the repo).
export function validateRecordReferral(input: RecordReferralInput): { ok: boolean; error?: string } {
  if (!input?.code || !String(input.code).trim()) return { ok: false, error: 'A referral code is required' };
  if (!input?.referredCustomerId || !String(input.referredCustomerId).trim()) return { ok: false, error: 'The referred customer is required' };
  return { ok: true };
}
