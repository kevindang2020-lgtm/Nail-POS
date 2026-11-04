// loyalty.dto.ts — tenant loyalty-program overview (read model). Reuses existing tables:
// customer_loyalty_profiles (per-member points, tenant+branch scoped), loyalty_rewards and
// loyalty_redemptions (tenant scoped). Points are integer counts; no money here.

export interface LoyaltyContext {
  tenantId: string;
  branchId?: string;
  userId: string;
  role: string;
  permissions: string[];
}

export interface LoyaltyProfile { customerId: string; tier: string; pointsBalance: number; totalEarned: number; totalRedeemed: number; }
// RewardType / LoyaltyReward / RewardInput live in @aipowersalon/api-contracts (tenant realm) — one definition for the server and the apps.
import type { RewardType, LoyaltyReward, RewardInput } from '@aipowersalon/api-contracts/tenant';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English
export type { RewardType, LoyaltyReward, RewardInput };
export class RewardValidationError extends Error {}

/** Validates a create (all fields) or an edit (only the fields given, checked against the current reward). A reward must
 *  be WORTH something — the bug being fixed is codes that took nothing off. */
export type NormalizedReward = { title: string; description: string; pointsCost: number; rewardType: RewardType; valueCents: number; percent: number; validDays: number | null; active: boolean;
  startsOn: string | null; endsOn: string | null; stockTotal: number | null; perMemberLimit: number | null; eligibleTiers: string[] | null };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export function normalizeRewardInput(input: RewardInput, current?: LoyaltyReward): NormalizedReward {
  const m = { title: current?.title ?? '', description: current?.description ?? '', pointsCost: current?.pointsCost ?? 0, rewardType: current?.rewardType ?? 'amount_off',
    valueCents: current?.valueCents ?? 0, percent: current?.percent ?? 0, validDays: current?.validDays ?? null, active: current?.active ?? true,
    startsOn: current?.startsOn ?? null, endsOn: current?.endsOn ?? null, stockTotal: current?.stockTotal ?? null, perMemberLimit: current?.perMemberLimit ?? null, eligibleTiers: current?.eligibleTiers ?? null, ...stripUndefined(input) } as any;
  const title = String(m.title ?? '').trim();
  if (!title) throw withCode(new RewardValidationError('Give the reward a name.'), 'REWARD_NAME_REQUIRED');
  if (title.length > 80) throw withCode(new RewardValidationError('Keep the reward name under 80 characters.'), 'REWARD_NAME_TOO_LONG');
  if (!Number.isInteger(m.pointsCost) || m.pointsCost <= 0) throw withCode(new RewardValidationError('Points cost must be a whole number above zero.'), 'POINTS_COST_INVALID');
  if (m.rewardType !== 'amount_off' && m.rewardType !== 'percent_off') throw withCode(new RewardValidationError('A reward is an amount off or a percent off.'), 'REWARD_TYPE_REQUIRED');
  if (m.rewardType === 'amount_off' && (!Number.isInteger(m.valueCents) || m.valueCents <= 0)) throw withCode(new RewardValidationError('Enter how much the reward takes off.'), 'REWARD_VALUE_REQUIRED');
  if (m.rewardType === 'percent_off' && (!Number.isInteger(m.percent) || m.percent <= 0 || m.percent > 100)) throw withCode(new RewardValidationError('Enter a percent between 1 and 100.'), 'PERCENT_1_100');
  if (m.validDays !== null && m.validDays !== undefined && (!Number.isInteger(m.validDays) || m.validDays <= 0)) throw withCode(new RewardValidationError('Validity must be a whole number of days, or no limit.'), 'VALIDITY_DAYS_INVALID');
  // Loyalty guide (Nov 4 2026): the availability rules
  const day = (v: unknown, field: string) => { if (v == null || v === '') return null; const s = String(v); if (!YMD.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) throw withCode(new RewardValidationError(`Enter the ${field} date as a calendar day.`), 'DATE_INVALID'); return s; };
  const startsOn = day(m.startsOn, 'start'), endsOn = day(m.endsOn, 'end');
  if (startsOn && endsOn && endsOn < startsOn) throw withCode(new RewardValidationError('The end date must be on or after the start date.'), 'DATE_RANGE_INVALID');
  const count = (v: unknown, min: number) => { if (v == null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < min) throw withCode(new RewardValidationError(min === 0 ? 'Stock must be a whole number (0 or more), or no limit.' : 'The per-member limit must be a whole number of 1 or more, or no limit.'), 'REWARD_LIMIT_INVALID'); return n; };
  const stockTotal = count(m.stockTotal, 0), perMemberLimit = count(m.perMemberLimit, 1);
  const tiers = Array.isArray(m.eligibleTiers) ? Array.from(new Set(m.eligibleTiers.map((t: unknown) => String(t ?? '').trim()).filter(Boolean))).slice(0, 20) as string[] : null;
  return { title, description: String(m.description ?? '').trim().slice(0, 300), pointsCost: m.pointsCost, rewardType: m.rewardType,
    valueCents: m.rewardType === 'amount_off' ? m.valueCents : 0, percent: m.rewardType === 'percent_off' ? m.percent : 0, validDays: m.validDays ?? null, active: !!m.active,
    startsOn, endsOn, stockTotal, perMemberLimit, eligibleTiers: tiers && tiers.length ? tiers : null };
}
function stripUndefined<T extends object>(o: T): Partial<T> { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>; }
export interface LoyaltyRedemption { id: string; customerId: string; rewardTitle: string; pointsSpent: number; createdAt: string; }

export interface LoyaltyTierCount { tier: string; members: number; points: number; }
export interface LoyaltySummary {
  memberCount: number;
  pointsOutstanding: number;   // sum of current member balances (the program liability)
  totalEarnedPoints: number;
  totalRedeemedPoints: number;
  activeRewards: number;
  redemptionCount: number;
  pointsRedeemed: number;      // sum of points spent across redemption events
}

export interface LoyaltyState {
  kpis: LoyaltySummary;
  tiers: LoyaltyTierCount[];
  rewards: LoyaltyReward[];
  recentRedemptions: LoyaltyRedemption[];
}

// Pure builder — summary + tier distribution from the three source lists. No DB, unit-testable.
export function buildLoyaltyOverview(
  profiles: LoyaltyProfile[],
  rewards: LoyaltyReward[],
  redemptions: LoyaltyRedemption[],
): { kpis: LoyaltySummary; tiers: LoyaltyTierCount[] } {
  let pointsOutstanding = 0, totalEarnedPoints = 0, totalRedeemedPoints = 0;
  const tierMap = new Map<string, { members: number; points: number }>();
  for (const p of profiles) {
    const bal = Math.max(0, Math.round(p.pointsBalance || 0));
    pointsOutstanding += bal;
    totalEarnedPoints += Math.max(0, Math.round(p.totalEarned || 0));
    totalRedeemedPoints += Math.max(0, Math.round(p.totalRedeemed || 0));
    const tier = p.tier || 'Regular';
    const cur = tierMap.get(tier) || { members: 0, points: 0 };
    cur.members += 1; cur.points += bal;
    tierMap.set(tier, cur);
  }
  const tiers = [...tierMap.entries()]
    .map(([tier, v]) => ({ tier, members: v.members, points: v.points }))
    .sort((a, b) => b.points - a.points);
  const pointsRedeemed = redemptions.reduce((a, r) => a + Math.max(0, Math.round(r.pointsSpent || 0)), 0);
  return {
    kpis: {
      memberCount: profiles.length,
      pointsOutstanding,
      totalEarnedPoints,
      totalRedeemedPoints,
      activeRewards: rewards.filter((r) => r.active).length,
      redemptionCount: redemptions.length,
      pointsRedeemed,
    },
    tiers,
  };
}
