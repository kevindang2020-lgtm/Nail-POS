import type { DealView } from '@aipowersalon/api-contracts/tenant';
export type { DealView };   // owned by packages/api-contracts (Constitution 13 §13)
import type { DealOwnerType, DiscountType, DealStatus, DealSettings } from './deals.core';

// Server-derived request context (tenant/branch/user/role/permissions come from req.ctx, never the client). For a
// technician-initiated request, technicianId is resolved server-side from the session's technician membership.
export interface DealContext {
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
  permissions: string[];
  technicianId?: string | null;
}

export interface CreateDealInput {
  ownerType: DealOwnerType;
  branchId?: string | null;
  technicianId?: string | null;          // required (and server-validated) when ownerType === 'technician'
  title: string;
  shortDescription?: string | null;
  terms?: string | null;
  imageUrl?: string | null;
  discountType: DiscountType;
  discountPercent?: number | null;
  discountCents?: number | null;
  originalPriceCents?: number | null;
  serviceIds?: string[];
  startsAt?: string | null;
  endsAt?: string | null;
  newCustomersOnly?: boolean;
  memberOnly?: boolean;
  minSpendCents?: number | null;
  depositCents?: number | null;
  maxRedemptions?: number | null;
  maxPerCustomer?: number | null;
  stackable?: boolean;
  allowTechSubstitution?: boolean;
  // BUILD_PLAN Phase 5 — the one deals domain
  kind?: 'deal' | 'coupon' | 'automatic' | 'announcement';
  rules?: Record<string, unknown> | null;
  priority?: number;
  stackGroup?: string | null;
  maxDiscountCents?: number | null;
  budgetCents?: number | null;
  channels?: string[] | null;
  requiresCode?: boolean;
  daysOfWeek?: number[] | null;
  validFromMinute?: number | null;
  validToMinute?: number | null;
  bookingLeadMinutes?: number | null;
  /** a coupon's shared code ("SPRING10"); stored hashed, never readable again */
  code?: string | null;
}

/** Booking facts a reservation is judged against (service, when, where it came from). */
export interface ReservationFacts { serviceIds?: string[]; date?: string; startTime?: string; channel?: 'pos' | 'online' | 'customer_app' | 'ai_receptionist'; technicianId?: string | null; spendCents?: number }


export interface ApprovalDecisionInput { reason?: string | null; }
/** Which offers combine under the saved policy, in the pricing engine's own terms (engine/stacking-inspector.ts) —
 *  for an offer marked combinable and for one that is not. Read-only; the POS shows these rows instead of re-deriving them. */
export interface DealStackingExplained { mode: string; combinable: Array<{ benefit: string; combines: string; reason: string; message: string; value?: number | null }>; notCombinable: Array<{ benefit: string; combines: string; reason: string; message: string; value?: number | null }> }
export type DealSettingsView = DealSettings & { stackingExplained?: DealStackingExplained };
