// memberships-core.ts — pure, DB-free membership engine logic shared by the in-memory and Kysely repositories so they
// compute identically. No money is ever floating point; the technician/owner split reconciles to the cent; the credit
// balance is DERIVED from the append-only ledger (reserved holds are subtracted from available, which is what prevents
// reserving or redeeming more than a member owns). Tax and tips are NEVER part of the membership split.

// ── Product types ──
import { splitByPercent } from '@aipowersalon/money';

export const PRODUCT_TYPES = ['recurring', 'fixed_term', 'package', 'discount_club', 'hybrid'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export function isRecurring(t: string): boolean { return t === 'recurring' || t === 'hybrid'; }

// ── Membership lifecycle state machine ──
export const MEMBERSHIP_STATUSES = [
  'pending', 'trial', 'active', 'grace', 'past_due', 'paused', 'canceling', 'canceled', 'expired', 'suspended', 'comped', 'completed',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

// Allowed transitions. Anything not listed is rejected by assertTransition (invalid transitions must never silently apply).
export const TRANSITIONS: Record<MembershipStatus, MembershipStatus[]> = {
  pending:   ['trial', 'active', 'canceled', 'suspended'],
  trial:     ['active', 'canceling', 'canceled', 'past_due', 'suspended'],
  active:    ['grace', 'past_due', 'paused', 'canceling', 'comped', 'completed', 'suspended', 'expired'],
  grace:     ['active', 'past_due', 'canceling', 'canceled', 'suspended'],
  past_due:  ['active', 'grace', 'canceling', 'canceled', 'suspended'],
  paused:    ['active', 'canceling', 'canceled', 'suspended', 'expired'],
  canceling: ['canceled', 'active'],            // active = member reactivated before period end
  comped:    ['active', 'canceled', 'expired'],
  suspended: ['active', 'canceled', 'expired'],
  canceled:  [],                                // terminal
  expired:   [],                                // terminal
  completed: [],                                // terminal (fixed-term fully used)
};

export function canTransition(from: string, to: string): boolean {
  const allowed = TRANSITIONS[from as MembershipStatus];
  return Array.isArray(allowed) && allowed.includes(to as MembershipStatus);
}

export class MembershipTransitionError extends Error {
  constructor(public from: string, public to: string) {
    super(`Invalid membership transition: ${from} → ${to}`);
    this.name = 'MembershipTransitionError';
  }
}

export function assertTransition(from: string, to: string): void {
  if (from === to) return; // idempotent no-op
  if (!canTransition(from, to)) throw new MembershipTransitionError(from, to);
}

// Statuses where benefits are currently usable (booking/redemption allowed). Paused/past_due/canceled/etc. are not.
export function benefitsActive(status: string): boolean {
  return status === 'active' || status === 'trial' || status === 'grace' || status === 'comped';
}

// ── Credit ledger entry types ──
export const LEDGER_ENTRY_TYPES = ['issued', 'reserved', 'redeemed', 'released', 'rolled_over', 'expired', 'restored', 'adjusted'] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export interface LedgerEntry {
  entryType: string;
  quantity?: number;     // service-credit magnitude (always stored positive; signs applied here)
  amountCents?: number;  // dollar-credit magnitude (always stored positive; signs applied here)
  reservationRef?: string | null; // a 'redeemed' entry closes a hold only when it redeems that reservation
}

export interface CreditBalance {
  serviceCreditsGranted: number;
  serviceCreditsRedeemed: number;
  serviceCreditsReserved: number;   // currently held by open reservations
  serviceCreditsExpired: number;
  serviceCreditsAvailable: number;  // granted − redeemed − expired − reserved (+ adjustments)
  dollarCreditsGrantedCents: number;
  dollarCreditsRedeemedCents: number;
  dollarCreditsReservedCents: number;
  dollarCreditsExpiredCents: number;
  dollarCreditsAvailableCents: number;
}

// Derive the live balance by summing the append-only ledger. A reservation holds credits (removed from available); a
// redeem finalizes a hold (consumes it); a release returns it. This is why a member can never reserve/redeem more than
// they own — available already nets out open holds.
export function creditBalance(entries: LedgerEntry[]): CreditBalance {
  let granted = 0, redeemed = 0, expired = 0, reserved = 0, released = 0, adjusted = 0;
  let dGranted = 0, dRedeemed = 0, dExpired = 0, dReserved = 0, dReleased = 0, dAdjusted = 0;
  let redeemedHeldQ = 0, redeemedHeldA = 0;
  for (const e of entries) {
    const q = e.quantity ?? 0;
    const a = e.amountCents ?? 0;
    switch (e.entryType) {
      case 'issued': case 'rolled_over': case 'restored': granted += q; dGranted += a; break;
      case 'redeemed': redeemed += q; dRedeemed += a; if (e.reservationRef) { redeemedHeldQ += q; redeemedHeldA += a; } break;
      case 'expired': expired += q; dExpired += a; break;
      case 'reserved': reserved += q; dReserved += a; break;
      case 'released': released += q; dReleased += a; break;
      case 'adjusted': adjusted += q; dAdjusted += a; break;
      default: break;
    }
  }
  // A reserve adds a hold; releasing OR redeeming THAT reserve removes the hold. A walk-in redeem (no reservation) does not:
  // it used to cancel someone else's open hold, so one credit could be reserved for Friday and redeemed today.
  const heldQ = Math.max(0, reserved - released - redeemedHeldQ);
  const heldA = Math.max(0, dReserved - dReleased - redeemedHeldA);
  return {
    serviceCreditsGranted: granted,
    serviceCreditsRedeemed: redeemed,
    serviceCreditsReserved: heldQ,
    serviceCreditsExpired: expired,
    serviceCreditsAvailable: granted - redeemed - expired - heldQ + adjusted,
    dollarCreditsGrantedCents: dGranted,
    dollarCreditsRedeemedCents: dRedeemed,
    dollarCreditsReservedCents: heldA,
    dollarCreditsExpiredCents: dExpired,
    dollarCreditsAvailableCents: dGranted - dRedeemed - dExpired - heldA + dAdjusted,
  };
}

export function canReserveServiceCredit(entries: LedgerEntry[], quantity = 1): boolean {
  return creditBalance(entries).serviceCreditsAvailable >= quantity;
}

// ── Technician / owner revenue split (integer cents; reconciles exactly; tax & tips are separate) ──
export interface RevenueSplit { techCents: number; ownerCents: number }

// eligibleCents is the PRE-TAX membership amount eligible for the split (never includes tax or tips). The owner share is
// the remainder so techCents + ownerCents === eligibleCents to the cent (no penny drift).
// ONE-PAY (Oct 13 2026): the arithmetic is THE shared percent split (@aipowersalon/money splitByPercent — the one the
// compensation engine's technician / salon split uses); this module cannot import the workforce engine (dependency cycle).
export function splitMembershipRevenue(eligibleCents: number, techPct: number): RevenueSplit {
  const s = splitByPercent(eligibleCents, techPct);
  return { techCents: s.shareCents, ownerCents: s.remainderCents };
}

// Split must total 100% (NUMERIC(5,2), so compare within a half-cent of a percent).
export function isValidSplit(techPct: number, ownerPct: number): boolean {
  return Math.abs(techPct + ownerPct - 100) < 0.005;
}

// ── Upgrade math: customer pays (upgraded member price − included allocated value − member upgrade discount) ──
export function upgradeChargeCents(upgradedMemberPriceCents: number, includedValueCents: number, discountCents = 0): number {
  return Math.max(0, Math.round(upgradedMemberPriceCents) - Math.round(includedValueCents) - Math.max(0, Math.round(discountCents)));
}
