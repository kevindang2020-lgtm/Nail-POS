// gift-card-clearing-core.ts — pure accounting logic for cross-tenant gift-card clearing (spec §15–17). No DB and no
// money movement: just the rules for whether a redemption creates an inter-tenant obligation, how a platform fee splits
// it, how a settlement batch totals up, and which settlement status transitions are allowed. The issuing tenant holds
// the stored-value liability; when a DIFFERENT member tenant redeems the card, the issuer owes that tenant the redeemed
// amount (less any configured platform fee). Same-tenant redemptions never clear. All money is integer cents.

export interface ClearingInput {
  issuingTenantId: string;
  redeemingTenantId: string;
  amountCents: number;
  platformFeeBps?: number; // basis points (1% = 100) applied to the redeemed amount; default 0
}

export interface ClearingObligation {
  applicable: boolean;
  reason?: 'same_tenant' | 'non_positive';
  payerTenantId?: string;    // the issuing tenant (owes)
  payeeTenantId?: string;    // the redeeming tenant (is owed)
  amountCents?: number;      // gross obligation
  platformFeeCents?: number; // retained by the platform
  netToPayeeCents?: number;  // amount - fee
}

// Decide whether a redemption creates a cross-tenant obligation, and split the platform fee if any.
export function clearingObligation(input: ClearingInput): ClearingObligation {
  const amount = Math.trunc(Number(input.amountCents) || 0);
  if (amount <= 0) return { applicable: false, reason: 'non_positive' };
  if (input.issuingTenantId === input.redeemingTenantId) return { applicable: false, reason: 'same_tenant' };
  const bps = Math.max(0, Math.trunc(Number(input.platformFeeBps) || 0));
  const platformFeeCents = Math.floor((amount * bps) / 10000);
  return {
    applicable: true,
    payerTenantId: input.issuingTenantId,
    payeeTenantId: input.redeemingTenantId,
    amountCents: amount,
    platformFeeCents,
    netToPayeeCents: amount - platformFeeCents,
  };
}

export interface ClearingEntryLike { amountCents: number; platformFeeCents?: number }

// Aggregate a set of clearing entries into batch totals (gross, fees retained, net payable to payees).
export function settlementTotals(entries: ClearingEntryLike[]): { count: number; totalCents: number; feeCents: number; netCents: number } {
  let totalCents = 0, feeCents = 0;
  for (const e of entries) {
    totalCents += Math.trunc(Number(e.amountCents) || 0);
    feeCents += Math.max(0, Math.trunc(Number(e.platformFeeCents) || 0));
  }
  return { count: entries.length, totalCents, feeCents, netCents: totalCents - feeCents };
}

// Settlement lifecycle. Funds never move automatically; a person advances a batch through review → approval → settled.
const SETTLEMENT_NEXT: Record<string, string[]> = {
  open: ['pending_review', 'failed'],
  pending_review: ['approved', 'disputed', 'failed'],
  approved: ['settled', 'disputed', 'failed'],
  settled: ['reversed'],
  disputed: ['pending_review', 'reversed', 'failed'],
  reversed: [],
  failed: ['pending_review'],
};

export function canTransitionSettlement(from: string, to: string): boolean {
  return (SETTLEMENT_NEXT[from] || []).includes(to);
}

// Clearing-entry lifecycle (mirrors settlement where it makes sense; a person or the batch drives it).
const CLEARING_NEXT: Record<string, string[]> = {
  pending: ['validated', 'disputed', 'failed'],
  validated: ['ready', 'disputed', 'failed'],
  ready: ['approved', 'disputed', 'failed'],
  approved: ['settled', 'disputed', 'reversed'],
  settled: ['reversed'],
  disputed: ['validated', 'reversed', 'failed'],
  reversed: [],
  failed: ['pending'],
};

export function canTransitionClearing(from: string, to: string): boolean {
  return (CLEARING_NEXT[from] || []).includes(to);
}

// Whether a redemption at `redeemingTenantId` of a card issued by `issuingTenantId` is allowed, and whether it's a
// cross-tenant redemption (which creates a clearing obligation). Same-tenant is always allowed and never clears. A
// cross-tenant redemption is allowed only when the card's program is shared (network / owner_portfolio) AND both the
// issuing and redeeming tenants are active members of that program. Anything else is refused (no silent leakage).
export interface RedeemEligibilityInput {
  issuingTenantId: string;
  redeemingTenantId: string;
  programScope?: string | null;   // the card's program scope; null/absent means no program (single-tenant)
  issuerActiveMember?: boolean;   // is the issuing tenant an active member of the program
  redeemerActiveMember?: boolean; // is the redeeming tenant an active member of the program
}
export interface RedeemEligibility { crossTenant: boolean; eligible: boolean; reason?: 'not_member' | 'scope_not_shared' | 'no_program' }

export function crossTenantRedeemable(input: RedeemEligibilityInput): RedeemEligibility {
  if (input.issuingTenantId === input.redeemingTenantId) return { crossTenant: false, eligible: true };
  const scope = input.programScope || null;
  if (scope !== 'network' && scope !== 'owner_portfolio') return { crossTenant: true, eligible: false, reason: scope ? 'scope_not_shared' : 'no_program' };
  if (!input.issuerActiveMember || !input.redeemerActiveMember) return { crossTenant: true, eligible: false, reason: 'not_member' };
  return { crossTenant: true, eligible: true };
}
