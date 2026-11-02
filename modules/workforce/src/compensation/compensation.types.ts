/**
 * compensation.types.ts — canonical inputs/outputs for the ONE compensation engine (spec §3, §33).
 * Money is integer minor units (cents) everywhere (§25). These types are the single contract every surface
 * (Checkout, Payroll, Tech App, Owner, Reports, Super Admin) calls — no screen recomputes authoritative totals.
 */
export type Cents = number; // integer minor currency units

export type CommissionType = 'percent' | 'fixed';
/** Who funds a discount (§10) — determines whether it reduces the commissionable base. */
export type DiscountFunding = 'proportional' | 'salon_funded' | 'technician_funded' | 'noncommissionable';
/** Supply-charge method (§9). */
export type SupplyMethod = 'none' | 'fixed' | 'percent';
/** Multi-technician allocation method (§11). */
export type AllocationMethod = 'percent' | 'fixed' | 'equal';
/** Tip allocation method (§12). */
export type TipMethod = 'customer_directed' | 'by_service_revenue' | 'by_commission_pool' | 'equal' | 'custom';

/** A technician's share of a single service line's commission pool (§11). */
export interface TechAllocation {
  technicianId: string;
  method: AllocationMethod;
  /** percent (0–100) when method='percent'; cents when method='fixed'; ignored for 'equal'. */
  value?: number;
}

/** One service line as the engine needs it. Prices are pre-tax; tax is supplied separately and never commissionable. */
export interface ServiceLineInput {
  lineId: string;
  serviceId?: string;
  /** gross pre-tax service price (cents). */
  priceCents: Cents;
  /** discount applied to this line (cents, >=0). */
  discountCents?: Cents;
  /** how the discount is funded — governs commissionable-base reduction (§10). default 'proportional'. */
  discountFunding?: DiscountFunding;
  /** tax for this line (cents) — recorded separately, NEVER commissionable (§2). */
  taxCents?: Cents;
  /** supply-charge configuration the salon retains (§9). */
  supply?: { method: SupplyMethod; value: number }; // value: cents for fixed, percent (0–100) for percent
  /** explicitly non-commissionable service charges to remove from the base (§2). */
  otherNoncommissionableCents?: Cents;
  /** the commission policy resolved for this line (the most specific active rule, §4). */
  commission: { type: CommissionType; value: number; /** policy provenance label, e.g. "Technician + Service Override" */ source?: string };
  /** technicians who performed this line and how the commission pool splits among them (§11). default: single primary at 100%. */
  technicians: TechAllocation[];
  /** retail flag — retail commission is handled separately and never mixed with service commission (§5). */
  isRetail?: boolean;
  /** per-line rule provenance (migration 587) — which authored policy priced this line, or null for a default. */
  policyId?: string | null;
  policyVersion?: number | null;
  ruleSource?: string | null;
}

export interface TipInput {
  cardTipCents?: Cents;
  cashTipCents?: Cents;
  method: TipMethod;
  /** for customer_directed/custom: explicit per-tech cents; must total the tip (§12). */
  directed?: { technicianId: string; tipCents: Cents }[];
  /** technicians eligible for proportional/equal split (defaults to the ticket's line technicians). */
  eligibleTechnicianIds?: string[];
}

export interface TicketCompensationInput {
  tenantId: string;
  branchId: string | null;
  ticketId: string;
  serviceLines: ServiceLineInput[];
  tip?: TipInput;
  /** policy provenance for the immutable snapshot (§14). */
  policyId?: string;
  policyVersion?: number;
  engineVersion?: string;
}

/** Per-(line, technician) computed compensation — the atomic, reconcilable unit. */
export interface LineTechCompensation {
  lineId: string;
  technicianId: string;
  commissionableCents: Cents;   // this tech's share of the line commissionable base
  techServiceEarningsCents: Cents;
  allocationLabel: string;      // e.g. "Lead 80%"
}

export interface ServiceLineCompensation {
  lineId: string;
  priceCents: Cents;
  discountCents: Cents;
  discountFunding: DiscountFunding;
  taxCents: Cents;
  supplyCents: Cents;           // salon-retained supply (§9)
  commissionableCents: Cents;   // base actually split (§2)
  techServiceEarningsCents: Cents;
  salonServiceShareCents: Cents;
  salonSupplyCents: Cents;
  perTech: LineTechCompensation[];
  commissionSource?: string;
  excluded: { taxCents: Cents; supplyCents: Cents; otherNoncommissionableCents: Cents }; // shown explicitly (§2)
}

export interface TechnicianTotals {
  technicianId: string;
  serviceEarningsCents: Cents;
  cardTipCents: Cents;
  cashTipCents: Cents;
  retailCommissionCents: Cents;
}

export interface TicketCompensationResult {
  ticketId: string;
  lines: ServiceLineCompensation[];
  /** salon keeps 100% of tips? NO — salon tip share is always 0 (§12). This documents the invariant value. */
  salonTipCents: Cents; // always 0
  totals: {
    grossServiceCents: Cents;
    discountCents: Cents;
    taxCents: Cents;               // recorded separately, not commissionable
    supplyCents: Cents;           // salon-retained
    commissionableCents: Cents;
    techServiceEarningsCents: Cents;
    salonServiceShareCents: Cents;
    cardTipCents: Cents;
    cashTipCents: Cents;
    retailCommissionCents: Cents;
  };
  perTechnician: TechnicianTotals[];
  /** reconciliation flags (§25) — all must be true for a valid result. */
  reconciliation: {
    splitsReconcile: boolean;     // tech + salon == commissionable per line and total
    tipsReconcile: boolean;       // sum of tech tip allocations == total tip
    salonTipIsZero: boolean;      // salon never keeps tips
    noNegativeCommissionable: boolean;
  };
  warnings: string[];
}
